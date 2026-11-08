/**
 * Transaction routes: GET/POST/PATCH/DELETE /api/transactions
 * Rejects writes to closed months. Month status checked inside the same
 * transaction with a row-level lock (SELECT FOR UPDATE) to prevent TOCTOU.
 */
import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';

type TxnType = 'income' | 'expense' | 'transfer_in' | 'transfer_out';
const TXN_TYPES: ReadonlySet<string> = new Set<TxnType>(['income', 'expense', 'transfer_in', 'transfer_out']);

const DATE_RE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

function monthOf(date: string): string {
  return date.slice(0, 7);
}

function assertPositiveInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`"${field}" phải là số nguyên dương.`);
  }
  return value;
}

function assertDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`"${field}" phải dạng YYYY-MM-DD.`);
  }
  return value;
}

function assertTxnType(value: unknown): TxnType {
  if (typeof value !== 'string' || !TXN_TYPES.has(value)) {
    throw new Error(`"type" phải là một trong: ${[...TXN_TYPES].join(', ')}.`);
  }
  return value as TxnType;
}

/**
 * Inside an active transaction: lock the month_plans row FOR UPDATE and
 * verify it is open. Throws a typed error if closed, returns 404-style
 * error object if month does not exist.
 *
 * Returns null on success, or an error descriptor for the caller.
 */
async function checkMonthOpenInTx(
  client: PoolClient,
  month: string,
): Promise<{ code: number; error: string } | null> {
  const row = (await client.query<{ status: string }>(
    `SELECT status FROM month_plans WHERE month = $1 FOR UPDATE`, [month],
  )).rows[0];
  if (!row) {
    return { code: 404, error: `Tháng ${month} chưa được tạo. Mở tháng trước khi ghi giao dịch.` };
  }
  if (row.status === 'closed') {
    return { code: 409, error: `Tháng ${month} đã chốt. Mở lại tháng để ghi giao dịch.` };
  }
  return null;
}

export async function transactionRoutes(app: FastifyInstance, db: Pool): Promise<void> {
  // GET /api/transactions?month=&jarId=&q=
  app.get<{ Querystring: { month?: string; jarId?: string; q?: string } }>(
    '/api/transactions',
    async (req, reply) => {
      const { month, jarId, q } = req.query;
      const conditions: string[] = ['deleted_at IS NULL'];
      const params: unknown[] = [];

      if (month) {
        params.push(`${month}-01`);
        const p1 = params.length;
        params.push(`${month}-31`);
        const p2 = params.length;
        conditions.push(`date >= $${p1} AND date <= $${p2}`);
      }
      if (jarId) {
        const jid = Number(jarId);
        if (!Number.isInteger(jid) || jid <= 0) return reply.code(400).send({ error: '"jarId" không hợp lệ.' });
        params.push(jid);
        conditions.push(`jar_id = $${params.length}`);
      }
      if (q) {
        params.push(`%${q}%`);
        conditions.push(`description ILIKE $${params.length}`);
      }

      const where = conditions.join(' AND ');
      const rows = (await db.query(`SELECT * FROM transactions WHERE ${where} ORDER BY date DESC, id DESC`, params)).rows;
      return reply.send(rows);
    },
  );

  // POST /api/transactions
  app.post('/api/transactions', async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    let date: string, amount: number, type: TxnType, description: string;
    try {
      date = assertDate(body['date'], 'date');
      amount = assertPositiveInt(body['amount'], 'amount');
      type = assertTxnType(body['type']);
      if (typeof body['description'] !== 'string' || body['description'].trim() === '') {
        throw new Error('"description" không được để trống.');
      }
      description = body['description'].trim();
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : 'Dữ liệu không hợp lệ.' });
    }

    const jarId = body['jarId'] != null ? Number(body['jarId']) : null;
    const incomeSourceId = body['incomeSourceId'] != null ? Number(body['incomeSourceId']) : null;
    if (jarId !== null && (!Number.isInteger(jarId) || jarId <= 0)) return reply.code(400).send({ error: 'jarId không hợp lệ.' });
    if (incomeSourceId !== null && (!Number.isInteger(incomeSourceId) || incomeSourceId <= 0)) return reply.code(400).send({ error: 'incomeSourceId không hợp lệ.' });
    const note = typeof body['note'] === 'string' ? body['note'] : null;
    const month = monthOf(date);

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const err = await checkMonthOpenInTx(client, month);
      if (err) {
        await client.query('ROLLBACK');
        return reply.code(err.code).send({ error: err.error });
      }
      if (jarId !== null) {
        const jar = (await client.query<{ kind: string; archived: boolean }>('SELECT kind, archived FROM jars WHERE id=$1', [jarId])).rows[0];
        if (!jar || jar.archived || (type === 'expense' && jar.kind !== 'spending') ||
          ((type === 'transfer_in' || type === 'transfer_out') && jar.kind !== 'saving')) {
          await client.query('ROLLBACK'); return reply.code(400).send({ error: 'Hũ không phù hợp với loại giao dịch.' });
        }
      }
      if (incomeSourceId !== null) {
        const source = (await client.query('SELECT 1 FROM income_sources WHERE id=$1 AND archived=FALSE', [incomeSourceId])).rowCount;
        if (!source || type !== 'income') { await client.query('ROLLBACK'); return reply.code(400).send({ error: 'Nguồn thu không hợp lệ.' }); }
      }
      const row = (await client.query<{ id: number }>(
        `INSERT INTO transactions (date, amount, type, jar_id, income_source_id, description, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [date, amount, type, jarId, incomeSourceId, description, note],
      )).rows[0];
      await client.query('COMMIT');
      return reply.code(201).send({ id: row?.id });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // PATCH /api/transactions/:id
  app.patch<{ Params: { id: string } }>('/api/transactions/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'ID không hợp lệ.' });

    const body = req.body as Record<string, unknown>;
    const fields: string[] = [];
    const params: unknown[] = [];

    let newDate: string | undefined;
    if (body['date'] !== undefined) {
      try { newDate = assertDate(body['date'], 'date'); } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : 'date không hợp lệ.' });
      }
      params.push(newDate);
      fields.push(`date=$${params.length}`);
    }
    if (body['amount'] !== undefined) {
      try { params.push(assertPositiveInt(body['amount'], 'amount')); } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : 'amount không hợp lệ.' });
      }
      fields.push(`amount=$${params.length}`);
    }
    if (body['description'] !== undefined) {
      if (typeof body['description'] !== 'string' || body['description'].trim() === '') {
        return reply.code(400).send({ error: '"description" không được để trống.' });
      }
      params.push(body['description'].trim());
      fields.push(`description=$${params.length}`);
    }
    if (body['note'] !== undefined) {
      params.push(body['note']);
      fields.push(`note=$${params.length}`);
    }
    if (body['incomeSourceId'] !== undefined) {
      const sourceId = body.incomeSourceId === null ? null : Number(body.incomeSourceId);
      if (sourceId !== null && (!Number.isInteger(sourceId) || sourceId <= 0)) return reply.code(400).send({ error: 'incomeSourceId không hợp lệ.' });
      params.push(sourceId); fields.push(`income_source_id=$${params.length}`);
    }
    if (fields.length === 0) return reply.code(400).send({ error: 'Không có trường nào để cập nhật.' });

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // Lock the transaction row first
      const existing = (await client.query<{ id: number; date: string; amount: number; type: TxnType; planned_item_id: number | null }>(
        'SELECT id, date, amount, type, planned_item_id FROM transactions WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [id],
      )).rows[0];
      if (!existing) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Giao dịch không tồn tại.' });
      }
      if (existing.planned_item_id !== null && (body.description !== undefined || body.note !== undefined || body.incomeSourceId !== undefined ||
        (newDate !== undefined && monthOf(newDate) !== monthOf(existing.date)))) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'Giao dịch định kỳ chỉ cho sửa số tiền và ngày trong cùng tháng.' });
      }
      if ((await client.query('SELECT 1 FROM financial_targets WHERE withdrawal_txn_id=$1 OR expense_txn_id=$1', [id])).rowCount) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'Giao dịch thuộc khoản dự kiến. Hoàn tác khoản đó trước.' });
      }
      if (body['incomeSourceId'] !== undefined) {
        if (existing.type !== 'income') { await client.query('ROLLBACK'); return reply.code(400).send({ error: 'Nguồn thu chỉ dùng cho giao dịch income.' }); }
        if (body.incomeSourceId !== null && !(await client.query('SELECT 1 FROM income_sources WHERE id=$1 AND archived=FALSE', [body.incomeSourceId])).rowCount) {
          await client.query('ROLLBACK'); return reply.code(400).send({ error: 'Nguồn thu không tồn tại hoặc đã ẩn.' });
        }
      }

      // Check BOTH months (current date and new date if changed) are open
      const oldMonth = monthOf(existing.date);
      const err1 = await checkMonthOpenInTx(client, oldMonth);
      if (err1) {
        await client.query('ROLLBACK');
        return reply.code(err1.code).send({ error: err1.error });
      }
      if (newDate !== undefined) {
        const newMonth = monthOf(newDate);
        if (newMonth !== oldMonth) {
          const err2 = await checkMonthOpenInTx(client, newMonth);
          if (err2) {
            await client.query('ROLLBACK');
            return reply.code(err2.code).send({ error: err2.error });
          }
        }
      }

      if (existing.planned_item_id !== null && body.amount !== undefined) {
        const item = (await client.query<{ kind: string; debt_id: number | null }>(
          'SELECT kind,debt_id FROM planned_items WHERE id=$1', [existing.planned_item_id])).rows[0];
        if (item?.kind === 'debt_payment' && item.debt_id !== null) {
          const debt = (await client.query<{ current_balance: number | null }>(
            'SELECT current_balance FROM debts WHERE id=$1 FOR UPDATE', [item.debt_id])).rows[0];
          if (debt?.current_balance !== null && debt !== undefined) {
            const balance = debt.current_balance + existing.amount - (body.amount as number);
            if (balance < 0) { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'Số tiền trả nợ vượt dư nợ còn lại.' }); }
            await client.query("UPDATE debts SET current_balance=$1,status=$2,updated_at=NOW() WHERE id=$3",
              [balance, balance === 0 ? 'paid_off' : 'active', item.debt_id]);
          }
        }
      }

      params.push(id);
      await client.query(
        `UPDATE transactions SET ${fields.join(', ')}, updated_at=NOW() WHERE id=$${params.length}`,
        params,
      );
      await client.query('COMMIT');
      return reply.send({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // DELETE /api/transactions/:id — soft delete
  app.delete<{ Params: { id: string } }>('/api/transactions/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'ID không hợp lệ.' });

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const existing = (await client.query<{ id: number; date: string; planned_item_id: number | null }>(
        'SELECT id, date, planned_item_id FROM transactions WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [id],
      )).rows[0];
      if (!existing) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Giao dịch không tồn tại.' });
      }
      if (existing.planned_item_id !== null) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'Giao dịch thuộc khoản định kỳ. Dùng unpay để xóa.' });
      }
      if ((await client.query('SELECT 1 FROM financial_targets WHERE withdrawal_txn_id=$1 OR expense_txn_id=$1', [id])).rowCount) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'Giao dịch thuộc khoản dự kiến. Hoàn tác khoản đó trước.' });
      }

      const month = monthOf(existing.date);
      const err = await checkMonthOpenInTx(client, month);
      if (err) {
        await client.query('ROLLBACK');
        return reply.code(err.code).send({ error: err.error });
      }

      await client.query('UPDATE transactions SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1', [id]);
      await client.query('COMMIT');
      return reply.send({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });
}

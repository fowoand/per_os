/**
 * Planned-item routes: pay / unpay / skip / patch
 * POST  /api/planned-items/:id/pay    body: { amount, date, idempotencyKey? }
 * POST  /api/planned-items/:id/unpay  body: { confirm?: true }  (required if total >= 1_000_000)
 * POST  /api/planned-items/:id/skip
 * PATCH /api/planned-items/:id        body: { scope: 'this_month', ...fields }
 *   scope=this_month: direct edit on this planned_item, is_overridden=true
 *
 * Serialization: planned_items row is locked FOR UPDATE at start of each
 * write operation. Month plan row also locked FOR UPDATE before status check.
 */
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { itemPaymentStatus, debtBalanceAfterPayment } from '../../../../packages/core/src/index.js';
import type { Transaction, PlannedItem } from '../../../../packages/core/src/index.js';

const DATE_RE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const UNPAY_CONFIRM_THRESHOLD = 1_000_000;

interface PlannedItemRow {
  id: number; month: string; template_id: number | null; name: string; kind: string;
  jar_id: number | null; debt_id: number | null; expected_amount: number;
  expected_day: number | null; skipped: boolean; note: string | null; is_overridden: boolean;
}

interface TxnRow {
  id: number; date: string; amount: number; type: string; jar_id: number | null;
  planned_item_id: number | null; description: string; note: string | null;
  deleted_at: string | null; idempotency_key: string | null;
}

function mapItem(r: PlannedItemRow): PlannedItem {
  return {
    id: r.id, month: r.month as PlannedItem['month'], templateId: r.template_id,
    name: r.name, kind: r.kind as PlannedItem['kind'], jarId: r.jar_id, debtId: r.debt_id,
    expectedAmount: r.expected_amount, expectedDay: r.expected_day,
    skipped: r.skipped, note: r.note, isOverridden: r.is_overridden,
  };
}

function mapTxn(r: TxnRow): Transaction & { idempotencyKey: string | null } {
  return {
    id: r.id, date: r.date as Transaction['date'], amount: r.amount,
    type: r.type as Transaction['type'], jarId: r.jar_id,
    plannedItemId: r.planned_item_id, description: r.description,
    note: r.note, deletedAt: r.deleted_at, idempotencyKey: r.idempotency_key,
  };
}

function txnTypeForKind(kind: PlannedItem['kind']): Transaction['type'] {
  switch (kind) {
    case 'income': return 'income';
    case 'transfer_to_saving': return 'transfer_in';
    case 'expense':
    case 'debt_payment': return 'expense';
  }
}

export async function plannedItemRoutes(app: FastifyInstance, db: Pool): Promise<void> {
  app.post('/api/planned-items', async (req, reply) => {
    const b = req.body as Record<string, unknown>;
    const { month, name, kind, amount, jar_id: jarId, debt_id: debtId, expected_day: day, note } = b;
    if (typeof month !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month) ||
        typeof name !== 'string' || !name.trim() ||
        !['income', 'expense', 'transfer_to_saving', 'debt_payment'].includes(kind as string) ||
        typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0 ||
        (jarId !== undefined && jarId !== null && (!Number.isInteger(jarId) || (jarId as number) <= 0)) ||
        (debtId !== undefined && debtId !== null && (!Number.isInteger(debtId) || (debtId as number) <= 0)) ||
        (day !== undefined && day !== null && (!Number.isInteger(day) || (day as number) < 1 || (day as number) > 31)) ||
        (note !== undefined && note !== null && typeof note !== 'string')) {
      return reply.code(400).send({ error: 'Khoản tháng không hợp lệ.' });
    }
    if ((kind === 'expense' || kind === 'transfer_to_saving') && jarId == null) {
      return reply.code(400).send({ error: 'Chọn hũ cho khoản này.' });
    }
    if ((kind === 'debt_payment') !== (debtId != null) || (debtId != null && jarId != null)) {
      return reply.code(400).send({ error: 'Khoản trả nợ phải chọn đúng một khoản nợ, không chọn hũ.' });
    }
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const plan = (await client.query<{ status: string }>(
        'SELECT status FROM month_plans WHERE month=$1 FOR UPDATE', [month],
      )).rows[0];
      if (!plan) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Tháng chưa được mở.' }); }
      if (plan.status !== 'open') { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'Tháng đã chốt.' }); }
      if (jarId != null) {
        const expectedKind = kind === 'transfer_to_saving' ? 'saving' : 'spending';
        const jar = await client.query('SELECT id FROM jars WHERE id=$1 AND kind=$2 AND archived=FALSE', [jarId, expectedKind]);
        if (!jar.rowCount) { await client.query('ROLLBACK'); return reply.code(400).send({ error: 'Hũ không hợp lệ.' }); }
      }
      if (debtId != null) {
        const debt = (await client.query<{ status: string }>('SELECT status FROM debts WHERE id=$1', [debtId])).rows[0];
        if (!debt || debt.status !== 'active') { await client.query('ROLLBACK'); return reply.code(400).send({ error: 'Khoản nợ không tồn tại hoặc đã tất toán.' }); }
        const existing = await client.query('SELECT 1 FROM planned_items WHERE month=$1 AND debt_id=$2 LIMIT 1', [month, debtId]);
        if (existing.rowCount) { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'Tháng này đã có kế hoạch cho khoản nợ.' }); }
      }
      const row = (await client.query<{ id: number }>(
        `INSERT INTO planned_items (month,name,kind,jar_id,debt_id,expected_amount,expected_day,note,is_overridden)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE) RETURNING id`,
        [month, name.trim(), kind, jarId ?? null, debtId ?? null, amount, day ?? null, note ?? null],
      )).rows[0];
      await client.query('COMMIT');
      return reply.code(201).send(row);
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  });

  app.delete<{ Params: { id: string } }>('/api/planned-items/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'ID không hợp lệ.' });
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const item = (await client.query<{ month: string; template_id: number | null }>(
        'SELECT month, template_id FROM planned_items WHERE id=$1 FOR UPDATE', [id],
      )).rows[0];
      if (!item) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Khoản không tồn tại.' }); }
      const plan = (await client.query<{ status: string }>(
        'SELECT status FROM month_plans WHERE month=$1 FOR UPDATE', [item.month],
      )).rows[0];
      if (plan?.status !== 'open') { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'Tháng đã chốt.' }); }
      if (item.template_id !== null) { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'Chỉ xóa được khoản thêm tay.' }); }
      const tx = await client.query('SELECT 1 FROM transactions WHERE planned_item_id=$1 LIMIT 1', [id]);
      if (tx.rowCount) { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'Khoản đã có giao dịch.' }); }
      await client.query('DELETE FROM planned_items WHERE id=$1', [id]);
      await client.query('COMMIT');
      return reply.send({ ok: true });
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  });
  // POST /api/planned-items/:id/pay
  app.post<{ Params: { id: string } }>('/api/planned-items/:id/pay', async (req, reply) => {
    const itemId = Number(req.params.id);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return reply.code(400).send({ error: 'ID không hợp lệ.' });
    }

    const body = req.body as Record<string, unknown>;
    const amount = body['amount'];
    const date = body['date'];
    const idempotencyKey = typeof body['idempotencyKey'] === 'string' ? body['idempotencyKey'] : null;
    const incomeSourceId = body['incomeSourceId'];

    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
      return reply.code(400).send({ error: '"amount" phải là số nguyên dương.' });
    }
    if (typeof date !== 'string' || !DATE_RE.test(date)) {
      return reply.code(400).send({ error: '"date" phải dạng YYYY-MM-DD.' });
    }
    if (incomeSourceId !== undefined && incomeSourceId !== null &&
      (typeof incomeSourceId !== 'number' || !Number.isSafeInteger(incomeSourceId) || incomeSourceId <= 0)) {
      return reply.code(400).send({ error: 'Nguồn thu không hợp lệ.' });
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // Lock the planned_items row to serialize concurrent pay calls
      const itemRow = (await client.query<PlannedItemRow>(
        'SELECT * FROM planned_items WHERE id=$1 FOR UPDATE', [itemId],
      )).rows[0];
      if (!itemRow) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Khoản định kỳ không tồn tại.' });
      }
      const item = mapItem(itemRow);
      if (incomeSourceId != null && item.kind !== 'income') {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'Nguồn thu chỉ dùng cho khoản thu nhập.' });
      }

      // Pay date must belong to item.month
      if (!date.startsWith(item.month)) {
        await client.query('ROLLBACK');
        return reply.code(400).send({
          error: `Ngày thanh toán ${date} không thuộc tháng ${item.month} của khoản này.`,
        });
      }

      // Reject pay on skipped item
      if (item.skipped) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'Khoản đã bị bỏ qua (skipped). Không thể ghi thanh toán.' });
      }

      // Lock and check month plan inside same transaction
      const plan = (await client.query<{ status: string }>(
        'SELECT status FROM month_plans WHERE month=$1 FOR UPDATE', [item.month],
      )).rows[0];
      if (!plan) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: `Tháng ${item.month} chưa được tạo.` });
      }
      if (plan.status === 'closed') {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: `Tháng ${item.month} đã chốt. Mở lại để ghi thanh toán.` });
      }

      // Idempotency: key must match THIS planned item (not any other item)
      if (idempotencyKey) {
        const existing = (await client.query<TxnRow>(
          `SELECT * FROM transactions
           WHERE idempotency_key=$1 AND planned_item_id=$2 AND deleted_at IS NULL`,
          [idempotencyKey, itemId],
        )).rows[0];
        if (existing) {
          await client.query('ROLLBACK');
          return reply.send({ id: existing.id, idempotent: true });
        }
        // Key used for a different item → reject to prevent cross-item confusion
        const otherItem = (await client.query<{ id: number }>(
          `SELECT id FROM transactions
           WHERE idempotency_key=$1 AND deleted_at IS NULL AND (planned_item_id IS NULL OR planned_item_id != $2)
           LIMIT 1`,
          [idempotencyKey, itemId],
        )).rows[0];
        if (otherItem) {
          await client.query('ROLLBACK');
          return reply.code(409).send({
            error: 'idempotencyKey đã được dùng cho một giao dịch khác. Dùng key mới.',
          });
        }
      }

      // If already fully paid: return idempotent response without new txn
      const linkedRows = (await client.query<TxnRow>(
        `SELECT * FROM transactions WHERE planned_item_id=$1`, [itemId],
      )).rows.map(mapTxn);
      const linked: Transaction[] = linkedRows;
      const { status } = itemPaymentStatus(item, linked);
      if (status === 'paid') {
        await client.query('ROLLBACK');
        return reply.send({ message: 'Khoản đã thanh toán đủ.', idempotent: true });
      }

      const txnType = txnTypeForKind(item.kind);
      const description = `${item.name} tháng ${item.month}`;
      if (incomeSourceId != null && !(await client.query(
        'SELECT 1 FROM income_sources WHERE id=$1 AND archived=FALSE', [incomeSourceId])).rowCount) {
        await client.query('ROLLBACK'); return reply.code(400).send({ error: 'Nguồn thu không hợp lệ.' });
      }

      const inserted = (await client.query<{ id: number }>(
        `INSERT INTO transactions (date, amount, type, jar_id, planned_item_id, description, idempotency_key, income_source_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [date, amount, txnType, item.jarId, itemId, description, idempotencyKey, incomeSourceId ?? null],
      )).rows[0];

      // Update debt balance if known (null stays null per spec)
      if (item.kind === 'debt_payment' && item.debtId !== null) {
        const debtRow = (await client.query<{ current_balance: number | null }>(
          'SELECT current_balance FROM debts WHERE id=$1 FOR UPDATE', [item.debtId],
        )).rows[0];
        if (debtRow) {
          const newBalance = debtBalanceAfterPayment(debtRow.current_balance, amount);
          if (newBalance === undefined) {
            await client.query('ROLLBACK');
            return reply.code(409).send({ error: 'Số tiền trả nợ vượt dư nợ còn lại.' });
          }
          if (newBalance !== null && newBalance === 0) {
            await client.query(
              `UPDATE debts SET current_balance=0, status='paid_off', updated_at=NOW() WHERE id=$1`,
              [item.debtId],
            );
          } else if (newBalance !== null) {
            await client.query(
              'UPDATE debts SET current_balance=$1, updated_at=NOW() WHERE id=$2',
              [newBalance, item.debtId],
            );
          }
          // null → no change (spec 5.4: never store/display remaining when unknown)
        }
      }

      await client.query('COMMIT');
      return reply.code(201).send({ id: inserted?.id });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // POST /api/planned-items/:id/unpay
  // body: { confirm?: true } — required when total paid amount >= 1,000,000
  app.post<{ Params: { id: string } }>('/api/planned-items/:id/unpay', async (req, reply) => {
    const itemId = Number(req.params.id);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return reply.code(400).send({ error: 'ID không hợp lệ.' });
    }

    const body = req.body as Record<string, unknown>;
    const confirm = body['confirm'] === true;

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // Lock planned_items row
      const itemRow = (await client.query<PlannedItemRow>(
        'SELECT * FROM planned_items WHERE id=$1 FOR UPDATE', [itemId],
      )).rows[0];
      if (!itemRow) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Khoản định kỳ không tồn tại.' });
      }
      const item = mapItem(itemRow);

      // Lock and check month plan
      const plan = (await client.query<{ status: string }>(
        'SELECT status FROM month_plans WHERE month=$1 FOR UPDATE', [item.month],
      )).rows[0];
      if (plan?.status === 'closed') {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: `Tháng ${item.month} đã chốt.` });
      }

      // Find all active linked transactions
      const linkedRows = (await client.query<TxnRow>(
        `SELECT * FROM transactions WHERE planned_item_id=$1 AND deleted_at IS NULL FOR UPDATE`,
        [itemId],
      )).rows.map(mapTxn);

      const totalPaid = linkedRows.reduce((s, t) => s + t.amount, 0);

      // Confirmation required when total >= threshold
      if (totalPaid >= UNPAY_CONFIRM_THRESHOLD && !confirm) {
        await client.query('ROLLBACK');
        return reply.code(409).send({
          error: `Tổng số tiền bỏ tick ${totalPaid.toLocaleString('vi-VN')}đ ≥ 1.000.000đ. Gửi lại với confirm=true để xác nhận.`,
          requiresConfirm: true,
          totalPaid,
        });
      }

      for (const txn of linkedRows) {
        await client.query('UPDATE transactions SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1', [txn.id]);

        // Reverse debt balance if balance was known
        if (item.kind === 'debt_payment' && item.debtId !== null) {
          const debtRow = (await client.query<{ current_balance: number | null; status: string }>(
            'SELECT current_balance, status FROM debts WHERE id=$1 FOR UPDATE', [item.debtId],
          )).rows[0];
          if (debtRow && debtRow.current_balance !== null) {
            const restored = debtRow.current_balance + txn.amount;
            await client.query(
              `UPDATE debts SET current_balance=$1, status='active', updated_at=NOW() WHERE id=$2`,
              [restored, item.debtId],
            );
          }
        }
      }

      await client.query('COMMIT');
      return reply.send({ ok: true, removed: linkedRows.length });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // POST /api/planned-items/:id/skip
  app.post<{ Params: { id: string } }>('/api/planned-items/:id/skip', async (req, reply) => {
    const itemId = Number(req.params.id);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return reply.code(400).send({ error: 'ID không hợp lệ.' });
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // Lock planned_items row
      const itemRow = (await client.query<PlannedItemRow>(
        'SELECT * FROM planned_items WHERE id=$1 FOR UPDATE', [itemId],
      )).rows[0];
      if (!itemRow) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Khoản định kỳ không tồn tại.' });
      }

      const plan = (await client.query<{ status: string }>(
        'SELECT status FROM month_plans WHERE month=$1 FOR UPDATE', [itemRow.month],
      )).rows[0];
      if (plan?.status === 'closed') {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: `Tháng ${itemRow.month} đã chốt.` });
      }

      await client.query('UPDATE planned_items SET skipped=TRUE, updated_at=NOW() WHERE id=$1', [itemId]);
      await client.query('COMMIT');
      return reply.send({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // PATCH /api/planned-items/:id
  // scope=this_month: direct edit on this item, is_overridden=true (spec §5.2)
  //   Accepted fields: amount, name, expected_day, note, skipped.
  app.patch<{ Params: { id: string } }>('/api/planned-items/:id', async (req, reply) => {
    const itemId = Number(req.params.id);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return reply.code(400).send({ error: 'ID không hợp lệ.' });
    }
    const b = req.body as Record<string, unknown>;
    const scope = b['scope'];
    if (scope !== 'this_month') {
      return reply.code(400).send({ error: '"scope" phải là this_month.' });
    }

    // Validate all accepted optional fields before touching the DB
    const amount = b['amount'];
    if (amount !== undefined && (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0)) {
      return reply.code(400).send({ error: '"amount" phải là số nguyên dương VND.' });
    }
    if ('name' in b && (typeof b['name'] !== 'string' || !(b['name'] as string).trim())) {
      return reply.code(400).send({ error: '"name" phải là chuỗi không rỗng.' });
    }
    if ('expected_day' in b && b['expected_day'] !== null) {
      const ed = b['expected_day'];
      if (typeof ed !== 'number' || !Number.isInteger(ed) || ed < 1 || ed > 31) {
        return reply.code(400).send({ error: '"expected_day" phải từ 1–31 hoặc null.' });
      }
    }
    if ('note' in b && b['note'] !== null && typeof b['note'] !== 'string') {
      return reply.code(400).send({ error: '"note" phải là chuỗi hoặc null.' });
    }
    if ('skipped' in b && typeof b['skipped'] !== 'boolean') {
      return reply.code(400).send({ error: '"skipped" phải là boolean.' });
    }

    // scope=this_month: require at least one field to change
    if (scope === 'this_month') {
      const hasAny = amount !== undefined || ['name', 'expected_day', 'note', 'skipped'].some((f) => f in b);
      if (!hasAny) {
        return reply.code(400).send({ error: 'Không có trường nào để cập nhật.' });
      }
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const itemRow = (await client.query<PlannedItemRow>(
        'SELECT * FROM planned_items WHERE id=$1 FOR UPDATE', [itemId],
      )).rows[0];
      if (!itemRow) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Khoản định kỳ không tồn tại.' });
      }

      // Closed month: reject all edits (both scopes)
      const plan = (await client.query<{ status: string }>(
        'SELECT status FROM month_plans WHERE month=$1 FOR UPDATE', [itemRow.month],
      )).rows[0];
      if (plan?.status === 'closed') {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: `Tháng ${itemRow.month} đã chốt. Mở lại tháng trước khi sửa.` });
      }

      {
        // Direct edit on this item, mark overridden
        const sets: string[] = ['is_overridden=TRUE'];
        const vals: unknown[] = [];
        let i = 1;
        if (amount !== undefined) { sets.push(`expected_amount=$${i++}`); vals.push(amount); }
        for (const f of ['name', 'expected_day', 'note', 'skipped'] as const) {
          if (f in b) { sets.push(`${f}=$${i++}`); vals.push(b[f]); }
        }
        sets.push(`updated_at=NOW()`);
        vals.push(itemId);
        await client.query(`UPDATE planned_items SET ${sets.join(',')} WHERE id=$${i}`, vals);
      }

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

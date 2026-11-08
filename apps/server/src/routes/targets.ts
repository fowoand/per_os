import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

const validId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const validDate = (value: unknown): value is string => typeof value === 'string' &&
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export async function targetRoutes(app: FastifyInstance, db: Pool): Promise<void> {
  app.get('/api/financial-targets', async (_req, reply) => {
    const setting = (await db.query<{ flexible_jar_id: number | null }>(
      'SELECT flexible_jar_id FROM settings WHERE id=1',
    )).rows[0];
    if (!setting?.flexible_jar_id) return reply.code(409).send({ error: 'Chưa cấu hình hũ Linh động.' });
    const targets = (await db.query(`SELECT id,name,target_amount,sort_order,spent_at,actual_amount,
      withdrawal_txn_id,expense_txn_id FROM financial_targets ORDER BY sort_order,id`)).rows;
    return reply.send({ flexibleJarId: setting.flexible_jar_id, targets });
  });

  app.post('/api/financial-targets', async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const { name, amount } = body;
    if (typeof name !== 'string' || !name.trim() || !validId(amount)) {
      return reply.code(400).send({ error: 'Tên và số tiền dự kiến không hợp lệ.' });
    }
    const row = (await db.query<{ id: number }>(`INSERT INTO financial_targets (name,target_amount,sort_order)
      VALUES ($1,$2,(SELECT COALESCE(MAX(sort_order),0)+1 FROM financial_targets)) RETURNING id`,
    [name.trim(), amount])).rows[0];
    return reply.code(201).send(row);
  });

  app.patch<{ Params: { id: string } }>('/api/financial-targets/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const { name, amount } = req.body as Record<string, unknown>;
    if (!validId(id) || typeof name !== 'string' || !name.trim() || !validId(amount)) {
      return reply.code(400).send({ error: 'Khoản dự kiến không hợp lệ.' });
    }
    const result = await db.query(`UPDATE financial_targets SET name=$2,target_amount=$3,updated_at=NOW()
      WHERE id=$1 AND spent_at IS NULL`, [id, name.trim(), amount]);
    if (!result.rowCount) return reply.code(409).send({ error: 'Khoản không tồn tại hoặc đã thực hiện.' });
    return reply.send({ ok: true });
  });

  app.put('/api/financial-targets/order', async (req, reply) => {
    const ids = (req.body as { ids?: unknown }).ids;
    if (!Array.isArray(ids) || !ids.every(validId) || new Set(ids).size !== ids.length) {
      return reply.code(400).send({ error: 'Thứ tự không hợp lệ.' });
    }
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const rows = (await client.query<{ id: number }>('SELECT id FROM financial_targets ORDER BY id FOR UPDATE')).rows;
      if (rows.length !== ids.length || rows.some((row) => !ids.includes(row.id))) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'Danh sách đã thay đổi, hãy tải lại.' });
      }
      for (const [index, id] of ids.entries()) {
        await client.query('UPDATE financial_targets SET sort_order=$2,updated_at=NOW() WHERE id=$1', [id, index + 1]);
      }
      await client.query('COMMIT');
      return reply.send({ ok: true });
    } catch (error) {
      await client.query('ROLLBACK'); throw error;
    } finally { client.release(); }
  });

  app.delete<{ Params: { id: string } }>('/api/financial-targets/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!validId(id)) return reply.code(400).send({ error: 'ID không hợp lệ.' });
    const result = await db.query('DELETE FROM financial_targets WHERE id=$1 AND spent_at IS NULL', [id]);
    if (!result.rowCount) return reply.code(409).send({ error: 'Khoản không tồn tại hoặc đã thực hiện.' });
    return reply.send({ ok: true });
  });

  app.post<{ Params: { id: string } }>('/api/financial-targets/:id/purchase', async (req, reply) => {
    const id = Number(req.params.id);
    const { date, amount } = req.body as Record<string, unknown>;
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
    if (!validId(id) || !validDate(date) || date > today || !validId(amount)) {
      return reply.code(400).send({ error: 'Ngày hoặc số tiền thực chi không hợp lệ.' });
    }
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const target = (await client.query<{ name: string; spent_at: string | null }>(
        'SELECT name,spent_at FROM financial_targets WHERE id=$1 FOR UPDATE', [id],
      )).rows[0];
      if (!target || target.spent_at) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'Khoản không tồn tại hoặc đã thực hiện.' });
      }
      const month = (await client.query<{ status: string }>(
        'SELECT status FROM month_plans WHERE month=$1 FOR UPDATE', [date.slice(0, 7)],
      )).rows[0];
      if (!month || month.status !== 'open') {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'Tháng chưa mở hoặc đã chốt.' });
      }
      const jar = (await client.query<{ id: number; opening_balance: number }>(`SELECT j.id,j.opening_balance
        FROM settings s JOIN jars j ON j.id=s.flexible_jar_id
        WHERE s.id=1 AND j.kind='saving' AND j.archived=FALSE FOR UPDATE OF j`)).rows[0];
      if (!jar) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'Chưa cấu hình hũ Linh động.' });
      }
      const moved = (await client.query<{ balance: number }>(`SELECT COALESCE(SUM(CASE type
        WHEN 'transfer_in' THEN amount WHEN 'transfer_out' THEN -amount ELSE 0 END),0)::bigint AS balance
        FROM transactions WHERE jar_id=$1 AND deleted_at IS NULL AND date <= $2`, [jar.id, today])).rows[0].balance;
      if (jar.opening_balance + moved < amount) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'Hũ Linh động chưa đủ tiền.' });
      }
      const withdrawal = (await client.query<{ id: number }>(`INSERT INTO transactions
        (date,amount,type,jar_id,description) VALUES ($1,$2,'transfer_out',$3,$4) RETURNING id`,
      [date, amount, jar.id, `Rút để chi: ${target.name}`])).rows[0];
      const expense = (await client.query<{ id: number }>(`INSERT INTO transactions
        (date,amount,type,description) VALUES ($1,$2,'expense',$3) RETURNING id`,
      [date, amount, target.name])).rows[0];
      await client.query(`UPDATE financial_targets SET spent_at=$2,actual_amount=$3,
        withdrawal_txn_id=$4,expense_txn_id=$5,updated_at=NOW() WHERE id=$1`,
      [id, date, amount, withdrawal.id, expense.id]);
      await client.query('COMMIT');
      return reply.code(201).send({ ok: true });
    } catch (error) {
      await client.query('ROLLBACK'); throw error;
    } finally { client.release(); }
  });

  app.post<{ Params: { id: string } }>('/api/financial-targets/:id/undo', async (req, reply) => {
    const id = Number(req.params.id);
    if (!validId(id)) return reply.code(400).send({ error: 'ID không hợp lệ.' });
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const target = (await client.query<{ spent_at: string | null; withdrawal_txn_id: number | null; expense_txn_id: number | null }>(
        'SELECT spent_at,withdrawal_txn_id,expense_txn_id FROM financial_targets WHERE id=$1 FOR UPDATE', [id],
      )).rows[0];
      if (!target?.spent_at || !target.withdrawal_txn_id || !target.expense_txn_id) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'Khoản chưa có giao dịch để hoàn tác.' });
      }
      const month = (await client.query<{ status: string }>(
        'SELECT status FROM month_plans WHERE month=$1 FOR UPDATE', [target.spent_at.slice(0, 7)],
      )).rows[0];
      if (month?.status !== 'open') {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'Mở lại tháng trước khi hoàn tác.' });
      }
      const deleted = await client.query('UPDATE transactions SET deleted_at=NOW(),updated_at=NOW() WHERE id=ANY($1) AND deleted_at IS NULL',
        [[target.withdrawal_txn_id, target.expense_txn_id]]);
      if (deleted.rowCount !== 2) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'Cặp giao dịch không còn đầy đủ; chưa hoàn tác.' });
      }
      await client.query(`UPDATE financial_targets SET spent_at=NULL,actual_amount=NULL,
        withdrawal_txn_id=NULL,expense_txn_id=NULL,updated_at=NOW() WHERE id=$1`, [id]);
      await client.query('COMMIT');
      return reply.send({ ok: true });
    } catch (error) {
      await client.query('ROLLBACK'); throw error;
    } finally { client.release(); }
  });
}

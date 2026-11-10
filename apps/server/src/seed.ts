import type { Pool } from 'pg';
import { openDatabase } from './db.js';

export async function seed(db: Pool, openingBalance = 0): Promise<boolean> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(20261106)');
    if ((await client.query('SELECT id FROM settings WHERE id = 1')).rowCount) {
      await client.query('COMMIT');
      return false;
    }
    const existing = await client.query(`SELECT
      EXISTS(SELECT 1 FROM jars) OR EXISTS(SELECT 1 FROM recurring_templates)
      OR EXISTS(SELECT 1 FROM debts) OR EXISTS(SELECT 1 FROM month_plans)
      OR EXISTS(SELECT 1 FROM transactions) OR EXISTS(SELECT 1 FROM financial_targets) AS has_data`);
    if (existing.rows[0].has_data) throw new Error('Dữ liệu tài chính đã tồn tại; cần kiểm tra trước khi khởi tạo.');

    await client.query(`INSERT INTO settings (id, account_opening_balance, account_opening_date, schema_version)
      VALUES (1, $1, '2026-11-01', (SELECT MAX(version) FROM schema_migrations))`, [openingBalance]);

    const jar = async (name: string, kind: 'spending' | 'saving'): Promise<number> => {
      const result = await client.query<{ id: number }>(`INSERT INTO jars (name, kind)
        VALUES ($1, $2) RETURNING id`, [name, kind]);
      return result.rows[0].id;
    };

    const family = await jar('Gia đình', 'spending');
    await jar('Học tập & phát triển', 'spending');
    await jar('Sinh hoạt', 'spending');
    const saving = await jar('Linh động', 'saving');
    await jar('Quỹ khẩn cấp', 'saving');
    await client.query('UPDATE settings SET flexible_jar_id=$1 WHERE id=1', [saving]);

    const debt = await client.query<{ id: number }>(`INSERT INTO debts (name, current_balance, expected_monthly, due_day)
      VALUES ('Khoản nợ', NULL, 2000000, NULL) RETURNING id`);
    const template = async (name: string, kind: string, jarId: number | null, debtId: number | null,
      day: number | null, amount: number): Promise<void> => {
      const result = await client.query<{ id: number }>(`INSERT INTO recurring_templates
        (name, kind, jar_id, debt_id, frequency, day_of_month, start_month, auto_repeat)
        VALUES ($1, $2, $3, $4, 'monthly', $5, '2026-11', TRUE) RETURNING id`,
      [name, kind, jarId, debtId, day]);
      await client.query(`INSERT INTO template_versions (template_id, amount, effective_from)
        VALUES ($1, $2, '2026-11')`, [result.rows[0].id, amount]);
    };
    await template('Lương thực nhận', 'income', null, null, 15, 18_886_350);
    await template('Hỗ trợ mẹ', 'expense', family, null, 15, 8_000_000);
    await template('Trả nợ', 'debt_payment', null, debt.rows[0].id, null, 2_000_000);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const db = await openDatabase();
  try { await seed(db); } finally { await db.end(); }
}

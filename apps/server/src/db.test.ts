import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, schemaVersion } from './db.js';
import { seed } from './seed.js';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('TEST_DATABASE_URL is required for database tests');

let admin: Pool;
let db: Pool;
let schema: string;

beforeEach(async () => {
  admin = new Pool({ connectionString });
  schema = `test_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  db = new Pool({ connectionString, options: `-c search_path=${schema}` });
  await migrate(db);
});

afterEach(async () => {
  await db.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});

describe('Stage 0 database', () => {
  it('migrates repeatedly and preserves data', async () => {
    await seed(db);
    await Promise.all([migrate(db), migrate(db)]);
    expect(await schemaVersion(db)).toBe(9);
    expect((await db.query('SELECT COUNT(*)::int AS count FROM jars')).rows[0]).toEqual({ count: 14 });
    expect((await db.query('SELECT account_opening_date FROM settings')).rows[0])
      .toEqual({ account_opening_date: '2026-11-01' });
  });

  it('migrates existing saving jar and planned purchase without deleting them', async () => {
    await seed(db);
    const jarId = (await db.query<{ id: number }>("SELECT id FROM jars WHERE name='Linh động'")).rows[0].id;
    await db.query(`INSERT INTO financial_targets (name,target_amount,start_month,end_month,saving_jar_id,sort_order)
      VALUES ('Học tiếng Trung',6000000,'2026-11','2027-01',$1,1)`, [jarId]);
    await db.query('ALTER TABLE settings DROP COLUMN flexible_jar_id');
    for (const column of ['sort_order', 'spent_at', 'actual_amount', 'withdrawal_txn_id', 'expense_txn_id']) {
      await db.query(`ALTER TABLE financial_targets DROP COLUMN ${column}`);
    }
    await db.query("UPDATE jars SET name='Tiết kiệm chung' WHERE id=$1", [jarId]);
    await db.query('DELETE FROM schema_migrations WHERE version=7');
    await migrate(db);
    expect((await db.query('SELECT flexible_jar_id FROM settings WHERE id=1')).rows[0].flexible_jar_id).toBe(jarId);
    expect((await db.query('SELECT name FROM jars WHERE id=$1', [jarId])).rows[0].name).toBe('Linh động');
    expect((await db.query('SELECT name,target_amount,sort_order FROM financial_targets')).rows[0])
      .toEqual({ name: 'Học tiếng Trung', target_amount: 6_000_000, sort_order: 1 });
  });

  it('seeds once with exact spec amounts and unknown debt balance', async () => {
    await seed(db);
    await seed(db);
    const rows = await db.query(`SELECT t.name, v.amount, t.day_of_month AS day
      FROM recurring_templates t JOIN template_versions v ON v.template_id = t.id
      ORDER BY t.id`);
    expect(rows.rows).toEqual([
      { name: 'Lương thực nhận', amount: 18_886_350, day: 15 },
      { name: 'Hỗ trợ mẹ', amount: 8_000_000, day: 15 },
      { name: 'Trả nợ', amount: 2_000_000, day: null },
    ]);
    expect((await db.query('SELECT current_balance FROM debts')).rows[0]).toEqual({ current_balance: null });
    expect((await db.query('SELECT COUNT(*)::int AS count FROM recurring_templates')).rows[0])
      .toEqual({ count: 3 });
  });

  it('enforces money and monthly template uniqueness at storage boundary', async () => {
    await seed(db);
    await db.query("INSERT INTO month_plans (month) VALUES ('2026-11')");
    const templateId = (await db.query<{ id: number }>('SELECT id FROM recurring_templates LIMIT 1')).rows[0].id;
    const insert = () => db.query(`INSERT INTO planned_items
      (month, template_id, name, kind, expected_amount)
      VALUES ('2026-11', $1, 'Lương', 'income', 18886350)`, [templateId]);
    await insert();
    await expect(insert()).rejects.toThrow();
    await expect(db.query(`INSERT INTO transactions (date, amount, type, description)
      VALUES ('2026-11-05', 0, 'expense', 'Sai')`)).rejects.toThrow();
    await db.query(`INSERT INTO transactions (date, amount, type, description)
      VALUES ('2026-11-05', 3000000000, 'expense', 'Hợp lệ')`);
    expect((await db.query('SELECT amount FROM transactions')).rows[0]).toEqual({ amount: 3_000_000_000 });
    await expect(db.query('SELECT 9007199254740992::bigint AS amount')).rejects.toThrow('safe integer');
  });
});

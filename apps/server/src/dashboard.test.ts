import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { migrate, schemaVersion } from './db.js';
import { seed } from './seed.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { incomeSourceRoutes } from './routes/income-sources.js';
import { configRoutes } from './routes/config.js';
import { transactionRoutes } from './routes/transactions.js';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('TEST_DATABASE_URL is required');

it('keeps income history, archived sources, and saving transfers distinct', async () => {
  const admin = new Pool({ connectionString });
  const schema = `dash_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const db = new Pool({ connectionString, options: `-c search_path=${schema}` });
  const app = Fastify();
  try {
    await migrate(db); await migrate(db); await seed(db);
    expect(await schemaVersion(db)).toBe(9);
    await db.query("INSERT INTO month_plans (month) VALUES ('2026-11'), ('2026-12')");
    const debt = (await db.query<{ id: number }>('SELECT id FROM debts LIMIT 1')).rows[0];
    const debtTemplate = (await db.query<{ id: number; jar_id: number | null }>("SELECT id, jar_id FROM recurring_templates WHERE kind='debt_payment' LIMIT 1")).rows[0];
    await db.query(`INSERT INTO planned_items (month, template_id, name, kind, jar_id, debt_id, expected_amount)
      VALUES ('2026-11', $1, 'Trả nợ', 'debt_payment', $2, $3, 1500000)`, [debtTemplate.id, debtTemplate.jar_id, debt.id]);
    await db.query('UPDATE debts SET current_balance=9000000 WHERE id=$1', [debt.id]);
    await incomeSourceRoutes(app, db); await configRoutes(app, db);
    await transactionRoutes(app, db); await dashboardRoutes(app, db);
    const source = (await db.query<{ id: number }>("SELECT id FROM income_sources WHERE name='Lương'")).rows[0];
    const saving = (await db.query<{ id: number }>("SELECT id FROM jars WHERE kind='saving' LIMIT 1")).rows[0];
    const post = (date: string, amount: number, type: string, extra = {}) => app.inject({ method: 'POST', url: '/api/transactions', payload: { date, amount, type, description: type, ...extra } });
    expect((await post('2026-11-02', 1000, 'income', { incomeSourceId: source.id })).statusCode).toBe(201);
    expect((await post('2026-11-03', 200, 'expense')).statusCode).toBe(201);
    expect((await post('2026-11-04', 300, 'transfer_in', { jarId: saving.id })).statusCode).toBe(201);
    await app.inject({ method: 'PATCH', url: `/api/income-sources/${source.id}`, payload: { archived: true } });
    const result = (await app.inject({ method: 'GET', url: '/api/dashboard' })).json();
    expect(result.income).toBe(1000);
    expect(result.expense).toBe(200);
    expect(result.totalSaving).toBe(300);
    expect(result.available).toBe(500);
    expect(result.totalDebt).toBe(9000000);
    expect(result.pendingDebtObligations).toBe(1500000);
    expect(result.availableAfterObligations).toBe(-1499500);
    expect(result.sources.find((row: { id: number }) => row.id === source.id)).toMatchObject({ archived: true, total: 1000 });
    expect(result.history[0]).toMatchObject({ income: 1000, expense: 200, savingTransfer: 300, netSaving: 800 });
  } finally {
    await app.close(); await db.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end();
  }
});

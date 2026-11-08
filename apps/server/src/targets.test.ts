import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { migrate } from './db.js';
import { seed } from './seed.js';
import { targetRoutes } from './routes/targets.js';
import { transactionRoutes } from './routes/transactions.js';
import { balancesRoutes } from './routes/balances.js';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('TEST_DATABASE_URL is required');

it('keeps planned purchases independent and records purchase/undo as one pair', async () => {
  const admin = new Pool({ connectionString });
  const schema = `target_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const db = new Pool({ connectionString, options: `-c search_path=${schema}` });
  const app = Fastify();
  try {
    await migrate(db); await seed(db);
    await targetRoutes(app, db); await transactionRoutes(app, db); await balancesRoutes(app, db);
    await db.query("INSERT INTO month_plans (month) VALUES ('2026-11')");
    const list = () => app.inject({ method: 'GET', url: '/api/financial-targets' });
    const jarId = (await list()).json().flexibleJarId;
    const add = async (name: string, amount: number) => (await app.inject({ method: 'POST', url: '/api/financial-targets', payload: { name, amount } })).json().id as number;
    const first = await add('Học tiếng Trung', 6_000_000);
    const second = await add('Mua xe', 10_000_000);
    const temporary = await add('Khoản thử', 100_000);
    expect((await app.inject({ method: 'DELETE', url: `/api/financial-targets/${temporary}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: `/api/financial-targets/${second}`, payload: { name: 'Mua xe', amount: 9_000_000 } })).statusCode).toBe(200);
    expect((await list()).json().targets.map((row: { id: number }) => row.id)).toEqual([first, second]);
    expect((await app.inject({ method: 'PUT', url: '/api/financial-targets/order', payload: { ids: [second, first] } })).statusCode).toBe(200);
    expect((await list()).json().targets.map((row: { id: number }) => row.id)).toEqual([second, first]);
    const purchase = (amount: number) => app.inject({ method: 'POST', url: `/api/financial-targets/${first}/purchase`, payload: { date: '2026-11-08', amount } });
    expect((await purchase(6_200_000)).statusCode).toBe(409);
    expect((await db.query('SELECT COUNT(*)::int AS n FROM transactions')).rows[0].n).toBe(0);
    expect((await app.inject({ method: 'POST', url: '/api/transactions', payload: { date: '2026-11-08', amount: 7_000_000, type: 'transfer_in', jarId, description: 'Góp tiền' } })).statusCode).toBe(201);
    expect((await purchase(6_200_000)).statusCode).toBe(201);
    expect((await purchase(6_200_000)).statusCode).toBe(409);
    const target = (await list()).json().targets.find((row: { id: number }) => row.id === first);
    expect(target).toMatchObject({ target_amount: 6_000_000, actual_amount: 6_200_000 });
    const balances = (await app.inject({ method: 'GET', url: '/api/balances' })).json();
    expect(balances.savingJars.find((jar: { id: number }) => jar.id === jarId).balance).toBe(800_000);
    const rows = (await db.query("SELECT id,type,amount FROM transactions WHERE type IN ('transfer_out','expense') AND deleted_at IS NULL ORDER BY id")).rows;
    expect(rows.map((row) => [row.type, row.amount])).toEqual([['transfer_out', 6_200_000], ['expense', 6_200_000]]);
    expect((await app.inject({ method: 'DELETE', url: `/api/transactions/${rows[0].id}` })).statusCode).toBe(409);
    expect((await app.inject({ method: 'PATCH', url: `/api/transactions/${rows[1].id}`, payload: { amount: 1 } })).statusCode).toBe(409);
    await db.query("UPDATE month_plans SET status='closed' WHERE month='2026-11'");
    expect((await app.inject({ method: 'POST', url: `/api/financial-targets/${first}/undo` })).statusCode).toBe(409);
    await db.query("UPDATE month_plans SET status='open' WHERE month='2026-11'");
    expect((await app.inject({ method: 'POST', url: `/api/financial-targets/${first}/undo` })).statusCode).toBe(200);
    expect((await list()).json().targets.find((row: { id: number }) => row.id === first).spent_at).toBeNull();
    expect((await db.query("SELECT COUNT(*)::int AS n FROM transactions WHERE type IN ('transfer_out','expense') AND deleted_at IS NULL")).rows[0].n).toBe(0);
    expect((await app.inject({ method: 'GET', url: '/api/balances' })).json().savingJars.find((jar: { id: number }) => jar.id === jarId).balance).toBe(7_000_000);
    await db.query("UPDATE month_plans SET status='closed' WHERE month='2026-11'");
    expect((await purchase(6_000_000)).statusCode).toBe(409);
  } finally {
    await app.close(); await db.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end();
  }
});

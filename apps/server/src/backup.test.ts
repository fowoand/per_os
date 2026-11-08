import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { Pool } from 'pg';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { migrate } from './db.js';
import { backupRoutes } from './routes/backup.js';
import { seed } from './seed.js';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('TEST_DATABASE_URL is required');
let admin: Pool;
let db: Pool;
let schema: string;
let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  admin = new Pool({ connectionString });
  schema = `test_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  db = new Pool({ connectionString, options: `-c search_path=${schema}` });
  await migrate(db);
  await seed(db);
  app = Fastify();
  await backupRoutes(app, db);
});

afterEach(async () => {
  await app.close();
  await db.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});

it('exports and restores all tables without changing balances or references', async () => {
  const jarId = (await db.query<{ id: number }>("SELECT id FROM jars WHERE name='Ăn uống'")).rows[0].id;
  await db.query("INSERT INTO month_plans (month) VALUES ('2026-11')");
  await db.query(`INSERT INTO transactions (date,amount,type,jar_id,description)
    VALUES ('2026-11-08',35000,'expense',$1,'Cà phê')`, [jarId]);
  const goalId = (await db.query<{ id: number }>("INSERT INTO goals (type,title) VALUES ('short','Học tập') RETURNING id")).rows[0].id;
  await db.query("INSERT INTO checklist_items (goal_id,title,done) VALUES ($1,'Bài một',TRUE)", [goalId]);
  const entryId = (await db.query<{ id: number }>("INSERT INTO journal_entries (datetime,title,tags) VALUES ('2026-11-08T10:00:00+07:00','Ngày đầu',ARRAY['học tập']) RETURNING id")).rows[0].id;
  await db.query('INSERT INTO journal_goal_links (journal_id,goal_id) VALUES ($1,$2)', [entryId, goalId]);
  const original = (await app.inject({ method: 'GET', url: '/api/export' })).json();
  await db.query("UPDATE jars SET name='Đã đổi' WHERE name='Linh động'");
  expect((await app.inject({ method: 'POST', url: '/api/import', payload: { confirm: false, backup: original } })).statusCode).toBe(400);
  const restored = await app.inject({ method: 'POST', url: '/api/import', payload: { confirm: true, backup: original } });
  expect(restored.statusCode).toBe(200);
  expect((await app.inject({ method: 'GET', url: '/api/export' })).json()).toEqual(original);
  expect((await db.query("SELECT name FROM jars WHERE name='Linh động'")).rowCount).toBe(1);
});

it('rejects malformed import and preserves current data', async () => {
  const original = (await app.inject({ method: 'GET', url: '/api/export' })).json();
  const broken = structuredClone(original);
  broken.tables.jars[0].kind = 'invalid';
  expect((await app.inject({ method: 'POST', url: '/api/import', payload: { confirm: true, backup: broken } })).statusCode).toBe(400);
  expect((await app.inject({ method: 'GET', url: '/api/export' })).json()).toEqual(original);
});

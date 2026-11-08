import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { Pool } from 'pg';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { migrate } from './db.js';
import { lifeRoutes } from './routes/life.js';

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
  app = Fastify();
  await lifeRoutes(app, db);
});

afterEach(async () => {
  await app.close();
  await db.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});

it('tracks checklist progress and linked journal entries', async () => {
  const goal = await app.inject({ method: 'POST', url: '/api/goals', payload: { type: 'long', title: 'Học ngoại ngữ' } });
  expect(goal.statusCode).toBe(201);
  const goalId = (goal.json() as { id: number }).id;
  const item = await app.inject({ method: 'POST', url: `/api/goals/${goalId}/checklist`, payload: { title: 'Hoàn thành bài học' } });
  expect(item.statusCode).toBe(201);
  expect((await app.inject({ method: 'PATCH', url: `/api/checklist/${(item.json() as { id: number }).id}`, payload: { done: true } })).statusCode).toBe(200);
  const entry = await app.inject({ method: 'POST', url: '/api/journal', payload: {
    datetime: '2026-11-08T10:00:00+07:00', title: 'Ngày đầu', tags: ['học tập'], goalIds: [goalId],
  } });
  expect(entry.statusCode).toBe(201);
  expect(((await app.inject({ method: 'GET', url: '/api/goals' })).json() as { checklist_total: number; checklist_done: number }[])[0])
    .toMatchObject({ checklist_total: 1, checklist_done: 1 });
  expect(((await app.inject({ method: 'GET', url: `/api/goals/${goalId}` })).json() as { journal: unknown[] }).journal).toHaveLength(1);
  expect((await app.inject({ method: 'GET', url: '/api/journal?month=2026-11&tag=học tập' })).json() as unknown[]).toHaveLength(1);
  expect((await app.inject({ method: 'GET', url: '/api/journal?month=&q=' })).json() as unknown[]).toHaveLength(1);
  expect((await app.inject({ method: 'GET', url: '/api/journal/summary' })).json()).toMatchObject({ months: [{ period: '2026-11', entries: 1 }] });
  expect((await app.inject({ method: 'GET', url: '/api/journal/calendar' })).json()).toMatchObject([{ date: '2026-11-08', entries: 1 }]);
});

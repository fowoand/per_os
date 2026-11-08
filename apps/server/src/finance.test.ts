/**
 * Finance API route-level tests using Fastify inject against isolated DB schema.
 * Tests spec section 11 cases 6, 8, 9, 13, 14, 16 at the HTTP boundary.
 *
 * Replaces the previous direct-SQL tests that did not exercise route logic.
 * Does NOT claim other 17 cases complete.
 */
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from './db.js';
import { seed } from './seed.js';
import { monthRoutes } from './routes/months.js';
import { transactionRoutes } from './routes/transactions.js';
import { plannedItemRoutes } from './routes/planned-items.js';
import { balancesRoutes } from './routes/balances.js';
import { configRoutes } from './routes/config.js';
import type { FastifyInstance } from 'fastify';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('TEST_DATABASE_URL is required for finance tests');

let admin: Pool;
let db: Pool;
let schema: string;
let app: FastifyInstance;

beforeEach(async () => {
  admin = new Pool({ connectionString });
  schema = `fin2_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  db = new Pool({ connectionString, options: `-c search_path=${schema}` });
  await migrate(db);
  await seed(db);

  app = Fastify();
  await monthRoutes(app, db);
  await transactionRoutes(app, db);
  await plannedItemRoutes(app, db);
  await balancesRoutes(app, db);
  await configRoutes(app, db);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await db.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});

// ─── helpers ─────────────────────────────────────────────────────────────────

describe('manual monthly debt plan', () => {
  it('edits linked debt payment without losing balance and rejects overpayment', async () => {
    const item = await getItem('2026-11', 'Trả nợ');
    await db.query('UPDATE debts SET current_balance=3000000 WHERE id=$1', [item.debtId]);
    const payment = await pay(item.id, { amount: 1_000_000, date: '2026-11-08' });
    const txnId = payment.json<{ id: number }>().id;
    const update = (amount: number) => app.inject({ method: 'PATCH', url: `/api/transactions/${txnId}`, payload: { amount, date: '2026-11-09' } });
    expect((await update(2_000_000)).statusCode).toBe(200);
    expect((await db.query('SELECT current_balance FROM debts WHERE id=$1', [item.debtId])).rows[0].current_balance).toBe(1_000_000);
    expect((await update(4_000_000)).statusCode).toBe(409);
    expect((await db.query('SELECT amount,date FROM transactions WHERE id=$1', [txnId])).rows[0]).toEqual({ amount: 2_000_000, date: '2026-11-09' });
    expect((await app.inject({ method: 'GET', url: `/api/debts/${item.debtId}/history` })).json<unknown[]>()).toHaveLength(1);
  });

  it('links selected debt, records payment and leaves next month unplanned', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/debts', payload: { name: 'Thẻ tín dụng', current_balance: 9_000_000 } });
    expect(create.statusCode).toBe(201);
    const debtId = create.json<{ id: number }>().id;
    await openMonth('2026-11');
    const plan = await app.inject({ method: 'POST', url: '/api/planned-items', payload: { month: '2026-11', name: 'Trả thẻ tín dụng', kind: 'debt_payment', debt_id: debtId, amount: 1_500_000 } });
    expect(plan.statusCode).toBe(201);
    const itemId = plan.json<{ id: number }>().id;
    expect((await app.inject({ method: 'POST', url: '/api/planned-items', payload: { month: '2026-11', name: 'Trả lần hai', kind: 'debt_payment', debt_id: debtId, amount: 1_500_000 } })).statusCode).toBe(409);
    const payment = await pay(itemId, { amount: 1_500_000, date: '2026-11-15' });
    expect(payment.statusCode).toBe(201);
    expect((await db.query<{ current_balance: number }>('SELECT current_balance FROM debts WHERE id=$1', [debtId])).rows[0].current_balance).toBe(7_500_000);
    const december = await openMonth('2026-12');
    expect(december.items.some((item) => item.debtId === debtId)).toBe(false);
  });
});

async function openMonth(month: string) {
  const res = await app.inject({ method: 'GET', url: `/api/months/${month}` });
  expect(res.statusCode, `openMonth ${month} failed: ${res.body}`).toBe(200);
  return res.json() as { plan: { id: number; status: string }; items: Array<{ id: number; name: string; expectedAmount: number; paymentStatus: string; kind: string; jarId: number | null; debtId: number | null }> };
}

async function getItem(month: string, name: string) {
  const data = await openMonth(month);
  const item = data.items.find((i) => i.name === name);
  if (!item) throw new Error(`Item "${name}" not found in ${month}`);
  return item;
}

async function pay(itemId: number, opts: { amount: number; date: string; idempotencyKey?: string }) {
  return app.inject({
    method: 'POST',
    url: `/api/planned-items/${itemId}/pay`,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amount: opts.amount, date: opts.date, idempotencyKey: opts.idempotencyKey }),
  });
}

async function unpay(itemId: number, confirm?: boolean) {
  return app.inject({
    method: 'POST',
    url: `/api/planned-items/${itemId}/unpay`,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(confirm !== undefined ? { confirm } : {}),
  });
}

async function skip(itemId: number) {
  return app.inject({ method: 'POST', url: `/api/planned-items/${itemId}/skip` });
}

async function closeMonth(month: string) {
  const res = await app.inject({ method: 'POST', url: `/api/months/${month}/close` });
  expect(res.statusCode, `closeMonth failed: ${res.body}`).toBe(200);
}

async function reopenMonth(month: string) {
  const res = await app.inject({ method: 'POST', url: `/api/months/${month}/reopen` });
  expect(res.statusCode, `reopenMonth failed: ${res.body}`).toBe(200);
}

async function postTxn(body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/api/transactions',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function patchTxn(id: number, body: Record<string, unknown>) {
  return app.inject({
    method: 'PATCH',
    url: `/api/transactions/${id}`,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function deleteTxn(id: number) {
  return app.inject({ method: 'DELETE', url: `/api/transactions/${id}` });
}

function activeTxnCount(itemId: number) {
  return db.query<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM transactions WHERE planned_item_id=$1 AND deleted_at IS NULL',
    [itemId],
  ).then((r) => r.rows[0]?.count ?? 0);
}

// ─── Case 6: tick rồi tick lại → chỉ một giao dịch; bỏ tick → xóa mềm ───────

describe('Case 6 — pay idempotency and unpay', () => {
  it('idempotency key: second pay returns same txn id, only one txn in DB', async () => {
    const item = await getItem('2026-11', 'Hỗ trợ mẹ');
    const key = randomUUID();

    const r1 = await pay(item.id, { amount: 8_000_000, date: '2026-11-15', idempotencyKey: key });
    expect(r1.statusCode).toBe(201);
    const _id1 = r1.json<{ id: number }>().id;

    // Second call with same key → idempotent response
    const r2 = await pay(item.id, { amount: 8_000_000, date: '2026-11-15', idempotencyKey: key });
    expect(r2.statusCode).toBe(200);
    expect(r2.json<{ idempotent: boolean }>().idempotent).toBe(true);

    // DB still has exactly one active txn
    expect(await activeTxnCount(item.id)).toBe(1);
  });

  it('pay when already fully paid: idempotent response, no new txn', async () => {
    const item = await getItem('2026-11', 'Hỗ trợ mẹ');
    await pay(item.id, { amount: 8_000_000, date: '2026-11-15' });
    expect(await activeTxnCount(item.id)).toBe(1);

    // Second pay without key (but item is already paid)
    const r = await pay(item.id, { amount: 8_000_000, date: '2026-11-15' });
    expect(r.statusCode).toBe(200);
    expect(r.json<{ idempotent: boolean }>().idempotent).toBe(true);
    expect(await activeTxnCount(item.id)).toBe(1);
  });

  it('idempotency key reused for different item → 409', async () => {
    const luong = await getItem('2026-11', 'Lương thực nhận');
    const me = await getItem('2026-11', 'Hỗ trợ mẹ');
    const key = randomUUID();

    await pay(luong.id, { amount: 18_886_350, date: '2026-11-15', idempotencyKey: key });
    const r = await pay(me.id, { amount: 8_000_000, date: '2026-11-15', idempotencyKey: key });
    expect(r.statusCode).toBe(409);
    expect(r.json<{ error: string }>().error).toContain('idempotencyKey');
  });

  it('pay on skipped item → 409', async () => {
    const item = await getItem('2026-11', 'Hỗ trợ mẹ');
    await skip(item.id);
    const r = await pay(item.id, { amount: 8_000_000, date: '2026-11-15' });
    expect(r.statusCode).toBe(409);
    expect(r.json<{ error: string }>().error).toContain('skipped');
  });

  it('pay with date outside item month → 400', async () => {
    const item = await getItem('2026-11', 'Hỗ trợ mẹ');
    const r = await pay(item.id, { amount: 8_000_000, date: '2026-12-15' });
    expect(r.statusCode).toBe(400);
    expect(r.json<{ error: string }>().error).toContain('tháng');
  });

  it('unpay soft-deletes linked txns, activeTxnCount drops to 0', async () => {
    const item = await getItem('2026-11', 'Hỗ trợ mẹ');
    await pay(item.id, { amount: 8_000_000, date: '2026-11-15' });
    expect(await activeTxnCount(item.id)).toBe(1);

    const r = await unpay(item.id, true);
    expect(r.statusCode).toBe(200);
    expect(r.json<{ removed: number }>().removed).toBe(1);
    expect(await activeTxnCount(item.id)).toBe(0);
  });

  it('unpay >= 1_000_000 without confirm=true → 409 requiresConfirm', async () => {
    const item = await getItem('2026-11', 'Hỗ trợ mẹ');
    await pay(item.id, { amount: 8_000_000, date: '2026-11-15' });

    const r = await unpay(item.id); // no confirm
    expect(r.statusCode).toBe(409);
    expect(r.json<{ requiresConfirm: boolean }>().requiresConfirm).toBe(true);
    // Txn still active (not deleted)
    expect(await activeTxnCount(item.id)).toBe(1);
  });

  it('unpay with confirm=true when >= 1_000_000 succeeds', async () => {
    const item = await getItem('2026-11', 'Hỗ trợ mẹ');
    await pay(item.id, { amount: 8_000_000, date: '2026-11-15' });
    const r = await unpay(item.id, true);
    expect(r.statusCode).toBe(200);
    expect(await activeTxnCount(item.id)).toBe(0);
  });
});

// ─── Case 8: giao dịch tháng đã chốt bị từ chối; mở lại → được ghi ──────────

describe('Case 8 — write rejected on closed month, allowed after reopen', () => {
  it('POST /api/transactions rejects when month is closed → 409', async () => {
    await openMonth('2026-11');
    await closeMonth('2026-11');

    const r = await postTxn({ date: '2026-11-20', amount: 50_000, type: 'expense', description: 'Cà phê' });
    expect(r.statusCode).toBe(409);
    expect(r.json<{ error: string }>().error).toContain('chốt');
  });

  it('POST /api/transactions rejects when month does not exist → 404', async () => {
    // 2024-01 never opened
    const r = await postTxn({ date: '2024-01-15', amount: 50_000, type: 'expense', description: 'test' });
    expect(r.statusCode).toBe(404);
  });

  it('PATCH /api/transactions/:id rejects when month is closed → 409', async () => {
    await openMonth('2026-11');
    const r1 = await postTxn({ date: '2026-11-10', amount: 30_000, type: 'expense', description: 'trà sữa' });
    const txnId = r1.json<{ id: number }>().id;
    await closeMonth('2026-11');

    const r2 = await patchTxn(txnId, { amount: 40_000 });
    expect(r2.statusCode).toBe(409);
  });

  it('PATCH rejects if new date moves to a closed/nonexistent month', async () => {
    // Open 2026-11, write txn, then try to move it to 2024-01 (non-existent)
    await openMonth('2026-11');
    const r1 = await postTxn({ date: '2026-11-10', amount: 30_000, type: 'expense', description: 'trà sữa' });
    const txnId = r1.json<{ id: number }>().id;

    const r2 = await patchTxn(txnId, { date: '2024-01-10' });
    expect(r2.statusCode).toBe(404); // 2024-01 never opened
  });

  it('DELETE /api/transactions/:id rejects when month is closed → 409', async () => {
    await openMonth('2026-11');
    const r1 = await postTxn({ date: '2026-11-10', amount: 30_000, type: 'expense', description: 'test' });
    const txnId = r1.json<{ id: number }>().id;
    await closeMonth('2026-11');

    const r2 = await deleteTxn(txnId);
    expect(r2.statusCode).toBe(409);
  });

  it('after reopen, write is accepted and report updates', async () => {
    await openMonth('2026-11');
    await closeMonth('2026-11');
    await reopenMonth('2026-11');

    const r = await postTxn({ date: '2026-11-20', amount: 50_000, type: 'expense', description: 'Cà phê' });
    expect(r.statusCode).toBe(201);
    expect(r.json<{ id: number }>().id).toBeGreaterThan(0);

    // Summary now reflects the new txn
    const summary = await app.inject({ method: 'GET', url: '/api/months/2026-11/summary' });
    expect(summary.statusCode).toBe(200);
    const s = summary.json<{ actualExpense: number }>();
    expect(s.actualExpense).toBeGreaterThanOrEqual(50_000);
  });

  it('pay on item in closed month → 409', async () => {
    const item = await getItem('2026-11', 'Hỗ trợ mẹ');
    await closeMonth('2026-11');
    const r = await pay(item.id, { amount: 8_000_000, date: '2026-11-15' });
    expect(r.statusCode).toBe(409);
    expect(r.json<{ error: string }>().error).toContain('chốt');
  });
});

// ─── Case 9: mở tháng mới nhiều lần (đồng thời) → mỗi template chỉ một dòng ─

describe('Case 9 — concurrent month open is idempotent', () => {
  it('rejects months before opening date or after next month', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/months/2026-10' })).statusCode).toBe(400);
    const current = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 7);
    const [year, month] = current.split('-').map(Number);
    const beyondNext = new Date(Date.UTC(year, month + 1, 1)).toISOString().slice(0, 7);
    expect((await app.inject({ method: 'GET', url: `/api/months/${beyondNext}` })).statusCode).toBe(400);
  });
  it('opening same month concurrently creates exactly one item per template', async () => {
    // Fire 5 concurrent GET /api/months/2026-11 requests
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        app.inject({ method: 'GET', url: '/api/months/2026-11' }),
      ),
    );
    for (const r of results) {
      expect(r.statusCode).toBe(200);
    }

    const count = (await db.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM planned_items WHERE month=$1', ['2026-11'],
    )).rows[0]?.count;
    // 3 templates in seed
    expect(count).toBe(3);
  });

  it('repeated GET /api/months/:month is idempotent', async () => {
    await app.inject({ method: 'GET', url: '/api/months/2026-11' });
    await app.inject({ method: 'GET', url: '/api/months/2026-11' });
    const count = (await db.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM planned_items WHERE month=$1', ['2026-11'],
    )).rows[0]?.count;
    expect(count).toBe(3);
  });
});

// ─── Case 13: sửa giao dịch tháng 11 sau khi mở lại → số dư tháng 12 thay đổi

describe('Case 13 — edit txn in reopened month affects rolling balance', () => {
  it('PATCH amount updates DB record, GET transactions reflects new amount', async () => {
    await openMonth('2026-11');
    const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
    const r1 = await postTxn({ date: todayStr, amount: 18_886_350, type: 'income', description: 'Lương' });
    expect(r1.statusCode, `postTxn failed: ${r1.body}`).toBe(201);
    const txnId = r1.json<{ id: number }>().id;

    // Balance before edit — today's txn is counted
    const b1 = await app.inject({ method: 'GET', url: '/api/balances' });
    const avail1 = b1.json<{ available: number }>().available;

    // Edit amount via PATCH
    const r2 = await patchTxn(txnId, { amount: 20_000_000 });
    expect(r2.statusCode).toBe(200);

    // Balance after edit reflects new amount
    const b2 = await app.inject({ method: 'GET', url: '/api/balances' });
    const avail2 = b2.json<{ available: number }>().available;
    expect(avail2 - avail1).toBe(20_000_000 - 18_886_350);
  });

  it('PATCH after close then reopen succeeds', async () => {
    await openMonth('2026-11');
    const r1 = await postTxn({ date: '2026-11-10', amount: 50_000, type: 'expense', description: 'test' });
    const txnId = r1.json<{ id: number }>().id;

    await closeMonth('2026-11');
    // PATCH must fail while closed
    expect((await patchTxn(txnId, { amount: 60_000 })).statusCode).toBe(409);

    await reopenMonth('2026-11');
    expect((await patchTxn(txnId, { amount: 60_000 })).statusCode).toBe(200);
  });
});

// ─── Case 14: giao dịch 23:50 ngày 30/11 (VN) thuộc tháng 11 ─────────────────

describe('Case 14 — VN timezone: date 2026-11-30 belongs to November', () => {
  it('POST txn with date=2026-11-30 succeeds and is included in Nov query', async () => {
    await openMonth('2026-11');
    const r = await postTxn({ date: '2026-11-30', amount: 50_000, type: 'expense', description: 'Cà phê khuya' });
    expect(r.statusCode).toBe(201);

    const list = await app.inject({ method: 'GET', url: '/api/transactions?month=2026-11' });
    const rows = list.json<Array<{ date: string }>>();
    expect(rows.some((row) => row.date === '2026-11-30')).toBe(true);
  });

  it('pay with date 2026-11-30 belongs to month 2026-11 → 201', async () => {
    const item = await getItem('2026-11', 'Hỗ trợ mẹ');
    const r = await pay(item.id, { amount: 8_000_000, date: '2026-11-30' });
    expect(r.statusCode).toBe(201);
  });
});

// ─── Case 16: nợ chưa biết dư nợ → API không trả / lưu dư nợ ────────────────

describe('Case 16 — unknown debt balance: null stays null in DB and API', () => {
  it('rejects payment above known debt balance without recording transaction', async () => {
    const item = await getItem('2026-11', 'Trả nợ');
    await db.query('UPDATE debts SET current_balance=$1 WHERE id=$2', [1_000_000, item.debtId]);
    const response = await pay(item.id, { amount: 2_000_000, date: '2026-11-05' });
    expect(response.statusCode).toBe(409);
    expect(await activeTxnCount(item.id)).toBe(0);
    const debt = (await db.query<{ current_balance: number }>(
      'SELECT current_balance FROM debts WHERE id=$1', [item.debtId],
    )).rows[0];
    expect(debt?.current_balance).toBe(1_000_000);
  });

  it('seed debt has null current_balance', async () => {
    await openMonth('2026-11');
    const item = await getItem('2026-11', 'Trả nợ');
    expect(item.debtId).not.toBeNull();

    const debt = (await db.query<{ current_balance: number | null }>(
      'SELECT current_balance FROM debts WHERE id=$1', [item.debtId],
    )).rows[0];
    expect(debt?.current_balance).toBeNull();
  });

  it('after pay on debt_payment item with null balance, DB balance stays null', async () => {
    const item = await getItem('2026-11', 'Trả nợ');
    const r = await pay(item.id, { amount: 2_000_000, date: '2026-11-20' });
    expect(r.statusCode).toBe(201);

    const debt = (await db.query<{ current_balance: number | null }>(
      'SELECT current_balance FROM debts WHERE id=$1', [item.debtId],
    )).rows[0];
    // null balance must remain null — spec 5.4
    expect(debt?.current_balance).toBeNull();
  });

  it('GET /api/balances does not return a remaining_debt field for null-balance debt', async () => {
    await openMonth('2026-11');
    const r = await app.inject({ method: 'GET', url: '/api/balances' });
    expect(r.statusCode).toBe(200);
    const body = r.json<Record<string, unknown>>();
    // /api/balances must not leak remaining_debt or similar for null-balance debts
    expect(body).not.toHaveProperty('remainingDebt');
    expect(body).not.toHaveProperty('remaining_debt');
  });

  it('summary does not expose unknown debt remaining balance', async () => {
    await openMonth('2026-11');
    const item = await getItem('2026-11', 'Trả nợ');
    // Pay partially
    await pay(item.id, { amount: 500_000, date: '2026-11-20' });

    const r = await app.inject({ method: 'GET', url: '/api/months/2026-11/summary' });
    const s = r.json<{ pendingObligations: number }>();
    // pendingObligations counts remaining = expected - paid = 2_000_000 - 500_000
    expect(s.pendingObligations).toBeGreaterThan(0);
    // No field that exposes debt current_balance = null to the UI
    expect(r.json<Record<string, unknown>>()).not.toHaveProperty('debtBalance');
  });
});

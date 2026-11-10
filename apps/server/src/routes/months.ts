/**
 * Month routes: GET /api/months/:month, GET /api/months/:month/summary,
 * POST /api/months/:month/close, POST /api/months/:month/reopen.
 */
import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import {
  generateMonthItems,
  computeMonthSummary,
  computeAvailableBalance,
  itemPaymentStatus,
} from '../../../../packages/core/src/index.js';
import type {
  RecurringTemplate,
  TemplateVersion,
  Debt,
  PlannedItem,
  Transaction,
  Jar,
  Month,
} from '../../../../packages/core/src/index.js';

// ─── helpers ────────────────────────────────────────────────────────────────

const MONTH_RE = /^\d{4}-(?:0[1-9]|1[0-2])$/;

function validateMonth(month: string): void {
  if (!MONTH_RE.test(month)) {
    const err = new Error(`Tháng không hợp lệ: "${month}". Dùng định dạng YYYY-MM.`);
    (err as NodeJS.ErrnoException).code = 'INVALID_MONTH';
    throw err;
  }
}

function todayVN(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
}

function currentMonthVN(): Month {
  return todayVN().slice(0, 7) as Month;
}

/** Max allowed month: current + 1 month. */
function maxAllowedMonth(): Month {
  const [year, mo] = currentMonthVN().split('-').map(Number) as [number, number];
  const next = mo === 12 ? `${year + 1}-01` : `${year}-${String(mo + 1).padStart(2, '0')}`;
  return next as Month;
}

function monthAllowed(month: Month): boolean {
  return month <= maxAllowedMonth();
}

// ─── DB row mappers ──────────────────────────────────────────────────────────

interface TemplateRow {
  id: number; name: string; kind: string; jar_id: number | null;
  debt_id: number | null; frequency: string; day_of_month: number | null;
  start_month: string; end_month: string | null; auto_repeat: boolean; note: string | null;
}

interface VersionRow { id: number; template_id: number; amount: number; effective_from: string; }

interface DebtRow {
  id: number; name: string; current_balance: number | null; expected_monthly: number | null;
  due_day: number | null; interest_rate: number | null; status: string;
}

interface PlannedItemRow {
  id: number; month: string; template_id: number | null; name: string; kind: string;
  jar_id: number | null; debt_id: number | null; expected_amount: number;
  expected_day: number | null; skipped: boolean; note: string | null;
  is_overridden: boolean;
}

interface TxnRow {
  id: number; date: string; amount: number; type: string; jar_id: number | null;
  planned_item_id: number | null; description: string; note: string | null;
  deleted_at: string | null;
}

interface JarRow {
  id: number; name: string; kind: string; parent_id: number | null;
  monthly_budget: number | null; opening_balance: number; archived: boolean;
}

function mapTemplate(r: TemplateRow): RecurringTemplate {
  return {
    id: r.id, name: r.name, kind: r.kind as RecurringTemplate['kind'],
    jarId: r.jar_id, debtId: r.debt_id,
    frequency: r.frequency as RecurringTemplate['frequency'],
    dayOfMonth: r.day_of_month, startMonth: r.start_month as Month,
    endMonth: r.end_month as Month | null, autoRepeat: r.auto_repeat, note: r.note,
  };
}

function mapVersion(r: VersionRow): TemplateVersion {
  return { id: r.id, templateId: r.template_id, amount: r.amount, effectiveFrom: r.effective_from as Month };
}

function mapDebt(r: DebtRow): Debt {
  return {
    id: r.id, name: r.name, currentBalance: r.current_balance,
    expectedMonthly: r.expected_monthly, dueDay: r.due_day,
    interestRate: r.interest_rate, status: r.status as Debt['status'],
  };
}

function mapItem(r: PlannedItemRow): PlannedItem {
  return {
    id: r.id, month: r.month as Month, templateId: r.template_id, name: r.name,
    kind: r.kind as PlannedItem['kind'], jarId: r.jar_id, debtId: r.debt_id,
    expectedAmount: r.expected_amount, expectedDay: r.expected_day,
    skipped: r.skipped, note: r.note, isOverridden: r.is_overridden,
  };
}

function mapTxn(r: TxnRow): Transaction {
  return {
    id: r.id, date: r.date as Transaction['date'], amount: r.amount,
    type: r.type as Transaction['type'], jarId: r.jar_id,
    plannedItemId: r.planned_item_id, description: r.description,
    note: r.note, deletedAt: r.deleted_at,
  };
}

function mapJar(r: JarRow): Jar {
  return {
    id: r.id, name: r.name, kind: r.kind as Jar['kind'], parentId: r.parent_id,
    monthlyBudget: r.monthly_budget, openingBalance: r.opening_balance, archived: r.archived,
  };
}

// ─── idempotent month generation (runs inside caller's transaction) ──────────

export async function ensureMonthPlan(client: PoolClient, month: Month): Promise<void> {
  // Grab advisory lock scoped to this month string to prevent concurrent inserts.
  // Lock ID: hash of "month_plan_" + month in a reproducible integer.
  const lockId = monthLockId(month);
  await client.query('SELECT pg_advisory_xact_lock($1)', [lockId]);

  const existing = await client.query<{ status: string }>(
    'SELECT status FROM month_plans WHERE month = $1', [month],
  );
  if (existing.rowCount) return; // already exists

  // Insert month_plan
  await client.query(
    "INSERT INTO month_plans (month, status) VALUES ($1, 'open') ON CONFLICT (month) DO NOTHING",
    [month],
  );
  const [year, number] = month.split('-').map(Number) as [number, number];
  const previous = number === 1 ? `${year - 1}-12` : `${year}-${String(number - 1).padStart(2, '0')}`;
  await client.query(`INSERT INTO jar_month_budgets (month, jar_id, amount)
    SELECT $1, jar_id, amount FROM jar_month_budgets WHERE month=$2
    ON CONFLICT DO NOTHING`, [month, previous]);

  // Load templates, versions, debts, existing items
  const templates = (await client.query<TemplateRow>('SELECT * FROM recurring_templates')).rows.map(mapTemplate);
  const versions = (await client.query<VersionRow>('SELECT * FROM template_versions')).rows.map(mapVersion);
  const debts = (await client.query<DebtRow>('SELECT * FROM debts')).rows.map(mapDebt);
  const existingItems = (await client.query<PlannedItemRow>(
    'SELECT * FROM planned_items WHERE month = $1', [month],
  )).rows.map(mapItem);

  const toCreate = generateMonthItems({ month, templates, allVersions: versions, debts, existingItems });

  for (const item of toCreate) {
    await client.query(
      `INSERT INTO planned_items
        (month, template_id, name, kind, jar_id, debt_id, expected_amount, expected_day)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (month, template_id) DO NOTHING`,
      [month, item.templateId, item.name, item.kind, item.jarId, item.debtId,
       item.expectedAmount, item.expectedDay],
    );
  }
}

function monthLockId(month: Month): number {
  // Simple stable integer: year*100 + monthNum, shifted to avoid collision with other locks.
  const [y, m] = month.split('-').map(Number) as [number, number];
  return 20260000 + y * 100 + m; // small enough for pg_advisory_xact_lock (bigint range is fine)
}

// ─── load full month data for GET /api/months/:month ────────────────────────

async function loadMonthData(db: Pool, month: Month) {
  const plan = (await db.query<{ id: number; month: string; status: string; closed_at: string | null; snapshot_json: unknown }>(
    'SELECT id, month, status, closed_at, snapshot_json FROM month_plans WHERE month = $1', [month],
  )).rows[0];
  if (!plan) return null;

  const items = (await db.query<PlannedItemRow>(
    'SELECT * FROM planned_items WHERE month = $1 ORDER BY id', [month],
  )).rows.map(mapItem);

  const itemIds = items.map((i) => i.id);
  const txns = itemIds.length
    ? (await db.query<TxnRow>(
        `SELECT * FROM transactions WHERE planned_item_id = ANY($1)`, [itemIds],
      )).rows.map(mapTxn)
    : [];

  const itemsWithStatus = items.map((item) => {
    const linked = txns.filter((t) => t.plannedItemId === item.id);
    const { status, paid, remaining } = itemPaymentStatus(item, linked);
    return { ...item, paymentStatus: status, paid, remaining };
  });

  return { plan, items: itemsWithStatus };
}

// ─── build summary ───────────────────────────────────────────────────────────

type Queryable = { query: Pool['query'] };

async function buildSummary(q: Queryable, month: Month) {
  const items = (await q.query<PlannedItemRow>(
    'SELECT * FROM planned_items WHERE month = $1', [month],
  )).rows.map(mapItem);

  const monthTxns = (await q.query<TxnRow>(
    `SELECT * FROM transactions WHERE date >= $1 AND date <= $2`,
    [`${month}-01`, `${month}-31`],
  )).rows.map(mapTxn);

  const allTxns = (await q.query<TxnRow>('SELECT * FROM transactions')).rows.map(mapTxn);
  const settings = (await q.query<{ account_opening_balance: number; account_opening_date: string; schema_version: number }>(
    'SELECT account_opening_balance, account_opening_date, schema_version FROM settings WHERE id = 1',
  )).rows[0];
  if (!settings) throw new Error('Chưa cài đặt tài khoản');

  const jars = (await q.query<JarRow>(`SELECT j.id,j.name,j.kind,j.parent_id,j.opening_balance,j.archived,
    b.amount AS monthly_budget FROM jars j LEFT JOIN jar_month_budgets b ON b.jar_id=j.id AND b.month=$1`, [month])).rows.map(mapJar);

  const itemIds = items.map((i) => i.id);
  const linkedTxns = itemIds.length
    ? (await q.query<TxnRow>(`SELECT * FROM transactions WHERE planned_item_id = ANY($1)`, [itemIds])).rows.map(mapTxn)
    : [];

  const linkedTxnsByItemId = new Map<number, Transaction[]>();
  for (const t of linkedTxns) {
    if (t.plannedItemId === null) continue;
    const list = linkedTxnsByItemId.get(t.plannedItemId) ?? [];
    list.push(t);
    linkedTxnsByItemId.set(t.plannedItemId, list);
  }

  const spendingJars = jars.filter((j) => j.kind === 'spending');

  const today = todayVN() as Transaction['date'];
  const availableBalance = computeAvailableBalance(
    { accountOpeningBalance: settings.account_opening_balance, accountOpeningDate: settings.account_opening_date as Transaction['date'], schemaVersion: settings.schema_version },
    allTxns,
    today,
  );

  return computeMonthSummary({
    items,
    monthTxns,
    linkedTxnsByItemId,
    spendingJars,
    availableBalance,
  });
}

// ─── route registration ──────────────────────────────────────────────────────

export async function monthRoutes(app: FastifyInstance, db: Pool): Promise<void> {
  app.patch<{ Params: { month: string; jarId: string }; Body: { amount?: unknown } }>(
    '/api/months/:month/budgets/:jarId', async (req, reply) => {
      const { month, jarId } = req.params;
      const id = Number(jarId);
      const amount = req.body?.amount;
      if (!MONTH_RE.test(month) || !Number.isSafeInteger(id) || id <= 0 ||
        (amount !== null && (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0))) {
        return reply.code(400).send({ error: 'Tháng, hũ hoặc hạn mức không hợp lệ.' });
      }
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const plan = (await client.query<{ status: string }>('SELECT status FROM month_plans WHERE month=$1 FOR UPDATE', [month])).rows[0];
        if (!plan) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Tháng chưa được mở.' }); }
        if (plan.status === 'closed') { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'Tháng đã chốt.' }); }
        const jar = (await client.query('SELECT 1 FROM jars WHERE id=$1 AND kind=$2 AND archived=FALSE', [id, 'spending'])).rowCount;
        if (!jar) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Hũ chi tiêu không tồn tại.' }); }
        if (amount === null) await client.query('DELETE FROM jar_month_budgets WHERE month=$1 AND jar_id=$2', [month, id]);
        else await client.query(`INSERT INTO jar_month_budgets (month,jar_id,amount) VALUES ($1,$2,$3)
          ON CONFLICT (month,jar_id) DO UPDATE SET amount=$3,updated_at=NOW()`, [month, id, amount]);
        await client.query('COMMIT');
        return reply.send({ month, jarId: id, amount });
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    });
  // GET /api/months/:month — idempotent open/return plan
  app.get<{ Params: { month: string } }>('/api/months/:month', async (req, reply) => {
    const { month } = req.params;
    try { validateMonth(month); } catch {
      return reply.code(400).send({ error: `Tháng không hợp lệ: "${month}". Dùng định dạng YYYY-MM.` });
    }
    const m = month as Month;
    const settings = (await db.query<{ account_opening_date: string }>(
      'SELECT account_opening_date FROM settings WHERE id=1')).rows[0];
    if (!settings) return reply.code(404).send({ error: 'Chưa thiết lập tài khoản.' });
    if (m < settings.account_opening_date.slice(0, 7) || !monthAllowed(m)) {
      return reply.code(400).send({ error: 'Chỉ mở tháng từ ngày bắt đầu đến tháng hiện tại + 1.' });
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await ensureMonthPlan(client, m);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const data = await loadMonthData(db, m);
    if (!data) return reply.code(404).send({ error: 'Không tìm thấy tháng' });
    return reply.send(data);
  });

  // GET /api/months/:month/summary
  app.get<{ Params: { month: string } }>('/api/months/:month/summary', async (req, reply) => {
    const { month } = req.params;
    try { validateMonth(month); } catch {
      return reply.code(400).send({ error: `Tháng không hợp lệ: "${month}".` });
    }
    const m = month as Month;
    const exists = (await db.query('SELECT 1 FROM month_plans WHERE month = $1', [m])).rowCount;
    if (!exists) return reply.code(404).send({ error: `Tháng ${month} chưa được mở.` });
    return reply.send(await buildSummary(db, m));  });

  // POST /api/months/:month/close
  app.post<{ Params: { month: string } }>('/api/months/:month/close', async (req, reply) => {
    const { month } = req.params;
    try { validateMonth(month); } catch {
      return reply.code(400).send({ error: `Tháng không hợp lệ: "${month}".` });
    }
    const m = month as Month;

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // Lock the row to block concurrent transaction writes (which also lock it)
      const plan = (await client.query<{ status: string }>(
        'SELECT status FROM month_plans WHERE month=$1 FOR UPDATE', [m],
      )).rows[0];
      if (!plan) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: `Tháng ${month} chưa được mở.` });
      }
      if (plan.status === 'closed') {
        await client.query('ROLLBACK');
        return reply.send({ message: 'Tháng đã được chốt rồi.' });
      }

      // Build snapshot inside the transaction (consistent read under lock)
      const summary = await buildSummary(client, m);

      await client.query(
        `UPDATE month_plans SET status='closed', closed_at=NOW(), snapshot_json=$2, updated_at=NOW() WHERE month=$1`,
        [m, JSON.stringify(summary)],
      );
      await client.query('COMMIT');
      return reply.send({ message: 'Tháng đã được chốt.' });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // POST /api/months/:month/reopen
  app.post<{ Params: { month: string } }>('/api/months/:month/reopen', async (req, reply) => {
    const { month } = req.params;
    try { validateMonth(month); } catch {
      return reply.code(400).send({ error: `Tháng không hợp lệ: "${month}".` });
    }
    const m = month as Month;
    const plan = (await db.query<{ status: string }>(
      'SELECT status FROM month_plans WHERE month = $1', [m],
    )).rows[0];
    if (!plan) return reply.code(404).send({ error: `Tháng ${month} chưa được mở.` });
    if (plan.status === 'open') return reply.send({ message: 'Tháng đang mở, không cần mở lại.' });
    await db.query(`UPDATE month_plans SET status='open', closed_at=NULL, updated_at=NOW() WHERE month=$1`, [m]);
    return reply.send({ message: 'Tháng đã được mở lại. Cảnh báo: Số liệu các tháng sau sẽ tự cập nhật theo giao dịch.' });
  });
}

/**
 * Config routes: GET/POST/PATCH /api/templates, /api/jars, /api/debts
 *
 * Spec §3 data model, §5.2 versioned template amounts, §7 API list.
 * Template POST: transaction inserts template + first version.
 * Template PATCH scope=this_month: REJECTED — month-specific edits go through
 *   PATCH /api/planned-items/:id with scope=this_month instead.
 * Template PATCH scope=from_month: insert a new template_version (409 on duplicate
 *   effective_from — never mutate existing versions). Cascade to open/untransacted/
 *   non-overridden planned_items in [month, next_later_version_effective_from).
 */
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

// ─── validation ──────────────────────────────────────────────────────────────

const MONTH_RE = /^\d{4}-(?:0[1-9]|1[0-2])$/;
const KINDS_TEMPLATE = new Set(['income', 'expense', 'transfer_to_saving', 'debt_payment']);
const KINDS_JAR = new Set(['spending', 'saving']);
const FREQS = new Set(['monthly', 'once', 'custom']);
const DEBT_STATUSES = new Set(['active', 'paid_off']);

function badMonth(s: unknown): boolean {
  return typeof s !== 'string' || !MONTH_RE.test(s);
}

function badPosInt(n: unknown): boolean {
  return typeof n !== 'number' || !Number.isInteger(n) || n <= 0;
}

function badNonNegInt(n: unknown): boolean {
  return typeof n !== 'number' || !Number.isInteger(n) || n < 0;
}

function badId(n: unknown): boolean {
  return typeof n !== 'number' || !Number.isInteger(n) || n <= 0;
}

function badDayOfMonth(n: unknown): boolean {
  return typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 31;
}

// ─── templates ───────────────────────────────────────────────────────────────

export async function configRoutes(app: FastifyInstance, db: Pool): Promise<void> {
  app.get('/api/settings', async (_req, reply) => {
    const row = (await db.query('SELECT account_opening_balance, account_opening_date FROM settings WHERE id=1')).rows[0];
    return row ?? reply.code(404).send({ error: 'Chưa thiết lập tài khoản.' });
  });

  app.patch('/api/settings', async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const amount = body.account_opening_balance;
    const date = body.account_opening_date;
    if (amount !== undefined && (!Number.isSafeInteger(amount) || (amount as number) < 0)) {
      return reply.code(400).send({ error: 'Số dư đầu kỳ phải là số nguyên không âm.' });
    }
    if (date !== undefined && (typeof date !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(date) ||
      Number.isNaN(Date.parse(date)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) {
      return reply.code(400).send({ error: 'Ngày đầu kỳ không hợp lệ.' });
    }
    if (amount === undefined && date === undefined) return reply.code(400).send({ error: 'Không có thay đổi.' });
    const row = await db.query(`UPDATE settings SET account_opening_balance=COALESCE($1,account_opening_balance),
      account_opening_date=COALESCE($2,account_opening_date),updated_at=NOW() WHERE id=1
      RETURNING account_opening_balance,account_opening_date`, [amount ?? null, date ?? null]);
    return row.rowCount ? row.rows[0] : reply.code(404).send({ error: 'Chưa thiết lập tài khoản.' });
  });

  // GET /api/templates
  app.get('/api/templates', async (_req, reply) => {
    const rows = (await db.query(`
      SELECT rt.*, json_agg(tv ORDER BY tv.effective_from) AS versions
      FROM recurring_templates rt
      LEFT JOIN template_versions tv ON tv.template_id = rt.id
      GROUP BY rt.id
      ORDER BY rt.id
    `)).rows;
    return reply.send(rows);
  });

  // POST /api/templates — creates template + first version atomically
  app.post('/api/templates', async (req, reply) => {
    const b = req.body as Record<string, unknown>;
    const name = b['name'];
    const kind = b['kind'];
    const frequency = b['frequency'];
    const startMonth = b['start_month'];
    const amount = b['amount'];

    if (typeof name !== 'string' || !name.trim()) {
      return reply.code(400).send({ error: '"name" bắt buộc.' });
    }
    if (!KINDS_TEMPLATE.has(kind as string)) {
      return reply.code(400).send({ error: '"kind" phải là income | expense | transfer_to_saving | debt_payment.' });
    }
    if (!FREQS.has(frequency as string)) {
      return reply.code(400).send({ error: '"frequency" phải là monthly | once | custom.' });
    }
    if (badMonth(startMonth)) {
      return reply.code(400).send({ error: '"start_month" phải dạng YYYY-MM.' });
    }
    if (badPosInt(amount)) {
      return reply.code(400).send({ error: '"amount" phải là số nguyên dương VND.' });
    }
    const endMonth = b['end_month'] ?? null;
    if (endMonth !== null && badMonth(endMonth)) {
      return reply.code(400).send({ error: '"end_month" phải dạng YYYY-MM hoặc null.' });
    }
    const jarId = b['jar_id'] ?? null;
    if (jarId !== null && badId(jarId)) {
      return reply.code(400).send({ error: '"jar_id" phải là số nguyên dương.' });
    }
    const debtId = b['debt_id'] ?? null;
    if (debtId !== null && badId(debtId)) {
      return reply.code(400).send({ error: '"debt_id" phải là số nguyên dương.' });
    }
    const dayOfMonth = b['day_of_month'] ?? null;
    if (dayOfMonth !== null && badDayOfMonth(dayOfMonth)) {
      return reply.code(400).send({ error: '"day_of_month" phải từ 1–31.' });
    }
    const autoRepeat = b['auto_repeat'] ?? true;
    if (typeof autoRepeat !== 'boolean') {
      return reply.code(400).send({ error: '"auto_repeat" phải là boolean.' });
    }
    const note = b['note'] ?? null;
    if (note !== null && typeof note !== 'string') {
      return reply.code(400).send({ error: '"note" phải là chuỗi hoặc null.' });
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const tmpl = (await client.query<{ id: number }>(
        `INSERT INTO recurring_templates
           (name, kind, jar_id, debt_id, frequency, day_of_month, start_month, end_month, auto_repeat, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [name, kind, jarId, debtId, frequency, dayOfMonth, startMonth, endMonth, autoRepeat, note],
      )).rows[0];
      await client.query(
        `INSERT INTO template_versions (template_id, amount, effective_from) VALUES ($1,$2,$3)`,
        [tmpl.id, amount, startMonth],
      );
      await client.query('COMMIT');
      return reply.code(201).send({ id: tmpl.id });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // PATCH /api/templates/:id
  //
  // scope=this_month is REJECTED here: month-specific overrides belong to
  //   PATCH /api/planned-items/:id (spec §5.2). Template-level PATCH only
  //   updates global template fields or adds new versions.
  //
  // scope=from_month: validate amount, insert new template_version (409 on
  //   duplicate effective_from), cascade to open/untransacted/non-overridden
  //   planned_items in [month, next_later_version), and update global fields.
  app.patch<{ Params: { id: string } }>('/api/templates/:id', async (req, reply) => {
    const templateId = Number(req.params.id);
    if (!Number.isInteger(templateId) || templateId <= 0) {
      return reply.code(400).send({ error: 'ID không hợp lệ.' });
    }

    const b = req.body as Record<string, unknown>;
    const scope = b['scope'];
    const month = b['month'];

    // scope=this_month on template PATCH is an incorrect combination:
    // month-specific changes must go through PATCH /api/planned-items/:id.
    if (scope === 'this_month') {
      return reply.code(400).send({
        error: 'scope=this_month không hợp lệ ở PATCH /api/templates. Dùng PATCH /api/planned-items/:id để sửa riêng một tháng.',
      });
    }
    if (scope !== 'from_month') {
      return reply.code(400).send({ error: '"scope" phải là from_month.' });
    }
    if (badMonth(month)) {
      return reply.code(400).send({ error: '"month" phải dạng YYYY-MM.' });
    }

    // Validate global template fields (from_month only touches global fields + version)
    const amount = b['amount'];
    const hasAmount = amount !== undefined;
    if (hasAmount && badPosInt(amount)) {
      return reply.code(400).send({ error: '"amount" phải là số nguyên dương VND.' });
    }

    // Validate each accepted global field before SQL
    if ('name' in b && (typeof b['name'] !== 'string' || !(b['name'] as string).trim())) {
      return reply.code(400).send({ error: '"name" phải là chuỗi không rỗng.' });
    }
    if ('kind' in b && !KINDS_TEMPLATE.has(b['kind'] as string)) {
      return reply.code(400).send({ error: '"kind" phải là income | expense | transfer_to_saving | debt_payment.' });
    }
    if ('frequency' in b && !FREQS.has(b['frequency'] as string)) {
      return reply.code(400).send({ error: '"frequency" phải là monthly | once | custom.' });
    }
    if ('start_month' in b && badMonth(b['start_month'])) {
      return reply.code(400).send({ error: '"start_month" phải dạng YYYY-MM.' });
    }
    if ('end_month' in b && b['end_month'] !== null && badMonth(b['end_month'])) {
      return reply.code(400).send({ error: '"end_month" phải dạng YYYY-MM hoặc null.' });
    }
    if ('jar_id' in b && b['jar_id'] !== null && badId(b['jar_id'])) {
      return reply.code(400).send({ error: '"jar_id" phải là số nguyên dương.' });
    }
    if ('debt_id' in b && b['debt_id'] !== null && badId(b['debt_id'])) {
      return reply.code(400).send({ error: '"debt_id" phải là số nguyên dương.' });
    }
    if ('day_of_month' in b && b['day_of_month'] !== null && badDayOfMonth(b['day_of_month'])) {
      return reply.code(400).send({ error: '"day_of_month" phải từ 1–31.' });
    }
    if ('auto_repeat' in b && typeof b['auto_repeat'] !== 'boolean') {
      return reply.code(400).send({ error: '"auto_repeat" phải là boolean.' });
    }
    if ('note' in b && b['note'] !== null && typeof b['note'] !== 'string') {
      return reply.code(400).send({ error: '"note" phải là chuỗi hoặc null.' });
    }

    // Build global template field updates (excludes amount — that goes in template_versions)
    const globalFields = ['name', 'kind', 'frequency', 'jar_id', 'debt_id', 'day_of_month', 'start_month', 'end_month', 'auto_repeat', 'note'] as const;
    const tmplSets: string[] = [];
    const tmplVals: unknown[] = [];
    let pi = 1;
    for (const f of globalFields) {
      if (f in b) { tmplSets.push(`${f}=$${pi++}`); tmplVals.push(b[f]); }
    }

    if (!hasAmount && tmplSets.length === 0) {
      return reply.code(400).send({ error: 'Không có trường nào để cập nhật.' });
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const existing = (await client.query<{ id: number }>(
        'SELECT id FROM recurring_templates WHERE id=$1 FOR UPDATE', [templateId],
      )).rows[0];
      if (!existing) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Template không tồn tại.' });
      }

      // Update global template fields
      if (tmplSets.length > 0) {
        tmplSets.push(`updated_at=NOW()`);
        tmplVals.push(templateId);
        await client.query(
          `UPDATE recurring_templates SET ${tmplSets.join(',')} WHERE id=$${pi}`,
          tmplVals,
        );
      }

      if (hasAmount) {
        // Check for existing version at this effective_from — NEVER mutate
        const dup = (await client.query<{ id: number }>(
          `SELECT id FROM template_versions WHERE template_id=$1 AND effective_from=$2`,
          [templateId, month],
        )).rows[0];
        if (dup) {
          await client.query('ROLLBACK');
          return reply.code(409).send({
            error: `Đã có version hiệu lực từ ${month as string}. Không thể sửa lịch sử version. Tạo version mới với tháng khác.`,
          });
        }

        // Insert new version (immutable history)
        await client.query(
          `INSERT INTO template_versions (template_id, amount, effective_from) VALUES ($1,$2,$3)`,
          [templateId, amount, month],
        );

        // Find the next later version after `month` to bound the cascade range
        const nextVersion = (await client.query<{ effective_from: string }>(
          `SELECT effective_from FROM template_versions
           WHERE template_id=$1 AND effective_from > $2
           ORDER BY effective_from ASC LIMIT 1`,
          [templateId, month],
        )).rows[0];

        // Cascade: open months in [month, nextVersion.effective_from), untransacted, non-overridden
        const cascadeQuery = nextVersion
          ? `UPDATE planned_items pi
             SET expected_amount=$1, updated_at=NOW()
             FROM month_plans mp
             WHERE pi.template_id=$2
               AND pi.month >= $3
               AND pi.month < $4
               AND pi.is_overridden = FALSE
               AND mp.month = pi.month
               AND mp.status = 'open'
               AND NOT EXISTS (
                 SELECT 1 FROM transactions t
                 WHERE t.planned_item_id = pi.id AND t.deleted_at IS NULL
               )`
          : `UPDATE planned_items pi
             SET expected_amount=$1, updated_at=NOW()
             FROM month_plans mp
             WHERE pi.template_id=$2
               AND pi.month >= $3
               AND pi.is_overridden = FALSE
               AND mp.month = pi.month
               AND mp.status = 'open'
               AND NOT EXISTS (
                 SELECT 1 FROM transactions t
                 WHERE t.planned_item_id = pi.id AND t.deleted_at IS NULL
               )`;

        const cascadeParams = nextVersion
          ? [amount, templateId, month, nextVersion.effective_from]
          : [amount, templateId, month];

        await client.query(cascadeQuery, cascadeParams);
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

  // ─── jars ─────────────────────────────────────────────────────────────────

  app.get('/api/jars', async (_req, reply) => {
    const rows = (await db.query('SELECT * FROM jars ORDER BY id')).rows;
    return reply.send(rows);
  });

  app.post('/api/jars', async (req, reply) => {
    const b = req.body as Record<string, unknown>;
    const name = b['name'];
    const kind = b['kind'];
    if (typeof name !== 'string' || !name.trim()) {
      return reply.code(400).send({ error: '"name" bắt buộc.' });
    }
    if (!KINDS_JAR.has(kind as string)) {
      return reply.code(400).send({ error: '"kind" phải là spending | saving.' });
    }
    const parentId = b['parent_id'] ?? null;
    if (parentId !== null && badId(parentId)) {
      return reply.code(400).send({ error: '"parent_id" phải là số nguyên dương.' });
    }
    const monthlyBudget = b['monthly_budget'] ?? null;
    if (monthlyBudget !== null && badNonNegInt(monthlyBudget)) {
      return reply.code(400).send({ error: '"monthly_budget" phải là số nguyên không âm VND.' });
    }
    const openingBalance = b['opening_balance'] ?? 0;
    if (badNonNegInt(openingBalance)) {
      return reply.code(400).send({ error: '"opening_balance" phải là số nguyên không âm VND.' });
    }
    if (parentId !== null) {
      const parent = (await db.query<{ kind: string }>('SELECT kind FROM jars WHERE id=$1 AND archived=FALSE', [parentId])).rows[0];
      if (!parent || parent.kind !== kind || kind !== 'spending') return reply.code(400).send({ error: 'Hũ cha phải là hũ chi tiêu đang dùng.' });
    }

    try {
    const row = (await db.query<{ id: number }>(
      `INSERT INTO jars (name, kind, parent_id, monthly_budget, opening_balance)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [name, kind, parentId, monthlyBudget, openingBalance],
    )).rows[0];
    return reply.code(201).send({ id: row.id });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'Tên hũ đã tồn tại.' });
      throw error;
    }
  });

  app.post('/api/jars/bulk-archive', async (req, reply) => {
    const ids = (req.body as { ids?: unknown })?.ids;
    if (!Array.isArray(ids) || !ids.length || ids.some(badId) || new Set(ids).size !== ids.length) return reply.code(400).send({ error: 'Danh sách hũ không hợp lệ.' });
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      if ((await client.query('SELECT 1 FROM settings WHERE flexible_jar_id=ANY($1::int[])', [ids])).rowCount) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'Không thể ẩn hũ Linh động đang dùng cho dự kiến chi.' });
      }
      const result = await client.query('UPDATE jars SET archived=TRUE, updated_at=NOW() WHERE id=ANY($1::int[]) AND archived=FALSE', [ids]);
      await client.query('COMMIT');
      return reply.send({ archived: result.rowCount });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });

  app.patch<{ Params: { id: string } }>('/api/jars/:id', async (req, reply) => {
    const jarId = Number(req.params.id);
    if (!Number.isInteger(jarId) || jarId <= 0) {
      return reply.code(400).send({ error: 'ID không hợp lệ.' });
    }
    const b = req.body as Record<string, unknown>;

    // Validate each field before building SQL
    if ('name' in b && (typeof b['name'] !== 'string' || !(b['name'] as string).trim())) {
      return reply.code(400).send({ error: '"name" phải là chuỗi không rỗng.' });
    }
    if ('kind' in b && !KINDS_JAR.has(b['kind'] as string)) {
      return reply.code(400).send({ error: '"kind" phải là spending | saving.' });
    }
    if ('parent_id' in b && b['parent_id'] !== null && badId(b['parent_id'])) {
      return reply.code(400).send({ error: '"parent_id" phải là số nguyên dương hoặc null.' });
    }
    if (b['parent_id'] === jarId) return reply.code(400).send({ error: 'Hũ không thể tự làm hũ con.' });
    if ('monthly_budget' in b && b['monthly_budget'] !== null && badNonNegInt(b['monthly_budget'])) {
      return reply.code(400).send({ error: '"monthly_budget" phải là số nguyên không âm VND.' });
    }
    if ('opening_balance' in b && badNonNegInt(b['opening_balance'])) {
      return reply.code(400).send({ error: '"opening_balance" phải là số nguyên không âm VND.' });
    }
    if ('archived' in b && typeof b['archived'] !== 'boolean') {
      return reply.code(400).send({ error: '"archived" phải là boolean.' });
    }

    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    for (const f of ['name', 'kind', 'parent_id', 'monthly_budget', 'opening_balance', 'archived'] as const) {
      if (f in b) { sets.push(`${f}=$${i++}`); vals.push(b[f]); }
    }
    if (sets.length === 0) return reply.code(400).send({ error: 'Không có trường nào để cập nhật.' });
    sets.push(`updated_at=NOW()`);
    vals.push(jarId);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const current = (await client.query<{ kind: string }>('SELECT kind FROM jars WHERE id=$1 FOR UPDATE', [jarId])).rows[0];
      if (!current) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Hũ không tồn tại.' }); }
      if ((b.archived === true || b.kind === 'spending') &&
        (await client.query('SELECT 1 FROM settings WHERE flexible_jar_id=$1', [jarId])).rowCount) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'Không thể ẩn hoặc đổi loại hũ Linh động.' });
      }
      if ('kind' in b && b.kind !== current.kind) {
        const used = (await client.query(`SELECT 1 FROM transactions WHERE jar_id=$1 UNION ALL SELECT 1 FROM planned_items WHERE jar_id=$1 LIMIT 1`, [jarId])).rowCount;
        if (used) { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'Hũ đã có lịch sử, không thể đổi loại.' }); }
      }
      if (b.parent_id != null) {
        const parent = (await client.query<{ kind: string; parent_id: number | null }>('SELECT kind,parent_id FROM jars WHERE id=$1', [b.parent_id])).rows[0];
        if (!parent || parent.kind !== (b.kind ?? current.kind) || parent.parent_id !== null || parent.kind !== 'spending') {
          await client.query('ROLLBACK'); return reply.code(400).send({ error: 'Hũ cha không hợp lệ.' });
        }
      }
      await client.query(`UPDATE jars SET ${sets.join(',')} WHERE id=$${i}`, vals);
      await client.query('COMMIT');
      return reply.send({ ok: true });
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'Tên hũ đã tồn tại.' });
      throw error;
    } finally { client.release(); }
  });

  // ─── debts ────────────────────────────────────────────────────────────────

  app.get('/api/debts', async (_req, reply) => {
    // Spec §5.4, case 16: never expose remaining for null-balance debts
    const rows = (await db.query(
      `SELECT id, name, expected_monthly, due_day, interest_rate, status, current_balance
       FROM debts ORDER BY id`,
    )).rows;
    return reply.send(rows);
  });

  app.get<{ Params: { id: string } }>('/api/debts/:id/history', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'ID không hợp lệ.' });
    if (!(await db.query('SELECT 1 FROM debts WHERE id=$1', [id])).rowCount) return reply.code(404).send({ error: 'Nợ không tồn tại.' });
    const rows = await db.query(`SELECT t.id,t.date,t.amount,t.description,p.month FROM transactions t
      JOIN planned_items p ON p.id=t.planned_item_id
      WHERE p.debt_id=$1 AND t.deleted_at IS NULL ORDER BY t.date DESC,t.id DESC`, [id]);
    return rows.rows;
  });

  app.post('/api/debts', async (req, reply) => {
    const b = req.body as Record<string, unknown>;
    const name = b['name'];
    if (typeof name !== 'string' || !name.trim()) {
      return reply.code(400).send({ error: '"name" bắt buộc.' });
    }
    const expectedMonthly = b['expected_monthly'] ?? null;
    if (expectedMonthly !== null && badPosInt(expectedMonthly)) {
      return reply.code(400).send({ error: '"expected_monthly" phải là số nguyên dương VND hoặc null.' });
    }
    const currentBalance = b['current_balance'] ?? null;
    if (currentBalance !== null && badNonNegInt(currentBalance)) {
      return reply.code(400).send({ error: '"current_balance" phải là số nguyên không âm VND hoặc null.' });
    }
    const dueDay = b['due_day'] ?? null;
    if (dueDay !== null && badDayOfMonth(dueDay)) {
      return reply.code(400).send({ error: '"due_day" phải từ 1–31.' });
    }
    const interestRate = b['interest_rate'] ?? null;
    if (interestRate !== null && typeof interestRate !== 'number') {
      return reply.code(400).send({ error: '"interest_rate" phải là số hoặc null.' });
    }

    const row = (await db.query<{ id: number }>(
      `INSERT INTO debts (name, current_balance, expected_monthly, due_day, interest_rate)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [name, currentBalance, expectedMonthly, dueDay, interestRate],
    )).rows[0];
    return reply.code(201).send({ id: row.id });
  });

  app.patch<{ Params: { id: string } }>('/api/debts/:id', async (req, reply) => {
    const debtId = Number(req.params.id);
    if (!Number.isInteger(debtId) || debtId <= 0) {
      return reply.code(400).send({ error: 'ID không hợp lệ.' });
    }
    const b = req.body as Record<string, unknown>;

    // Validate each field before SQL
    if ('name' in b && (typeof b['name'] !== 'string' || !(b['name'] as string).trim())) {
      return reply.code(400).send({ error: '"name" phải là chuỗi không rỗng.' });
    }
    if ('expected_monthly' in b && b['expected_monthly'] !== null && badPosInt(b['expected_monthly'])) {
      return reply.code(400).send({ error: '"expected_monthly" phải là số nguyên dương VND hoặc null.' });
    }
    if ('current_balance' in b && b['current_balance'] !== null && badNonNegInt(b['current_balance'])) {
      return reply.code(400).send({ error: '"current_balance" phải là số nguyên không âm VND hoặc null.' });
    }
    if ('due_day' in b && b['due_day'] !== null && badDayOfMonth(b['due_day'])) {
      return reply.code(400).send({ error: '"due_day" phải từ 1–31.' });
    }
    if ('interest_rate' in b && b['interest_rate'] !== null && typeof b['interest_rate'] !== 'number') {
      return reply.code(400).send({ error: '"interest_rate" phải là số hoặc null.' });
    }
    if ('status' in b && !DEBT_STATUSES.has(b['status'] as string)) {
      return reply.code(400).send({ error: '"status" phải là active | paid_off.' });
    }

    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    for (const f of ['name', 'current_balance', 'expected_monthly', 'due_day', 'interest_rate', 'status'] as const) {
      if (f in b) { sets.push(`${f}=$${i++}`); vals.push(b[f]); }
    }
    if (sets.length === 0) return reply.code(400).send({ error: 'Không có trường nào để cập nhật.' });
    sets.push(`updated_at=NOW()`);
    vals.push(debtId);
    const result = await db.query(`UPDATE debts SET ${sets.join(',')} WHERE id=$${i}`, vals);
    if (result.rowCount === 0) return reply.code(404).send({ error: 'Nợ không tồn tại.' });
    return reply.send({ ok: true });
  });
}

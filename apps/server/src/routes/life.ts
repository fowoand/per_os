import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const goalTypes = new Set(['long', 'short']);
const goalStatuses = new Set(['todo', 'doing', 'done', 'paused']);
const idOf = (raw: string): number | null => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const textField = (raw: unknown): string | null => typeof raw === 'string' && raw.trim() ? raw.trim() : null;
const optionalDate = (raw: unknown): boolean => raw === null || (typeof raw === 'string' && datePattern.test(raw) &&
  !Number.isNaN(Date.parse(`${raw}T00:00:00Z`)) && new Date(`${raw}T00:00:00Z`).toISOString().slice(0, 10) === raw);

export async function lifeRoutes(app: FastifyInstance, db: Pool): Promise<void> {
  app.get('/api/goals', async () => {
    const goals = await db.query(`SELECT g.*, COUNT(c.id)::int AS checklist_total,
      COUNT(c.id) FILTER (WHERE c.done)::int AS checklist_done
      FROM goals g LEFT JOIN checklist_items c ON c.goal_id=g.id
      GROUP BY g.id ORDER BY g.created_at, g.id`);
    return goals.rows;
  });

  app.post('/api/goals', async (req, reply) => {
    const b = req.body as Record<string, unknown>;
    const title = textField(b.title);
    if (!title || !goalTypes.has(String(b.type)) || (b.parent_goal_id != null && !idOf(String(b.parent_goal_id))) ||
      (b.start_date !== undefined && !optionalDate(b.start_date)) || (b.due_date !== undefined && !optionalDate(b.due_date))) {
      return reply.code(400).send({ error: 'Mục tiêu không hợp lệ.' });
    }
    if (b.parent_goal_id != null && !(await db.query('SELECT 1 FROM goals WHERE id=$1', [b.parent_goal_id])).rowCount) {
      return reply.code(404).send({ error: 'Mục tiêu cha không tồn tại.' });
    }
    const row = await db.query(`INSERT INTO goals (type,parent_goal_id,title,description,start_date,due_date)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [b.type, b.parent_goal_id ?? null, title, typeof b.description === 'string' ? b.description : '', b.start_date ?? null, b.due_date ?? null]);
    return reply.code(201).send(row.rows[0]);
  });

  app.patch<{ Params: { id: string } }>('/api/goals/:id', async (req, reply) => {
    const id = idOf(req.params.id);
    const b = req.body as Record<string, unknown>;
    if (!id || (b.title !== undefined && !textField(b.title)) ||
      (b.status !== undefined && !goalStatuses.has(String(b.status))) ||
      (b.type !== undefined && !goalTypes.has(String(b.type))) ||
      (b.description !== undefined && typeof b.description !== 'string') ||
      (b.start_date !== undefined && !optionalDate(b.start_date)) ||
      (b.due_date !== undefined && !optionalDate(b.due_date))) return reply.code(400).send({ error: 'Mục tiêu không hợp lệ.' });
    const row = await db.query(`UPDATE goals SET title=COALESCE($2,title), description=COALESCE($3,description),
      status=COALESCE($4,status), type=COALESCE($5,type),
      start_date=CASE WHEN $6::boolean THEN $7 ELSE start_date END,
      due_date=CASE WHEN $8::boolean THEN $9 ELSE due_date END, updated_at=NOW()
      WHERE id=$1 RETURNING *`, [id, b.title ?? null, b.description ?? null, b.status ?? null, b.type ?? null,
      b.start_date !== undefined, b.start_date ?? null, b.due_date !== undefined, b.due_date ?? null]);
    return row.rowCount ? row.rows[0] : reply.code(404).send({ error: 'Mục tiêu không tồn tại.' });
  });

  app.get<{ Params: { id: string } }>('/api/goals/:id', async (req, reply) => {
    const id = idOf(req.params.id);
    if (!id) return reply.code(400).send({ error: 'ID không hợp lệ.' });
    const goal = (await db.query('SELECT * FROM goals WHERE id=$1', [id])).rows[0];
    if (!goal) return reply.code(404).send({ error: 'Mục tiêu không tồn tại.' });
    const [checklist, journal] = await Promise.all([
      db.query('SELECT * FROM checklist_items WHERE goal_id=$1 ORDER BY id', [id]),
      db.query(`SELECT j.* FROM journal_entries j JOIN journal_goal_links l ON l.journal_id=j.id
        WHERE l.goal_id=$1 ORDER BY j.datetime DESC, j.id DESC`, [id]),
    ]);
    return { ...goal, checklist: checklist.rows, journal: journal.rows };
  });

  app.post<{ Params: { id: string } }>('/api/goals/:id/checklist', async (req, reply) => {
    const id = idOf(req.params.id);
    const title = textField((req.body as Record<string, unknown>).title);
    if (!id || !title) return reply.code(400).send({ error: 'Checklist không hợp lệ.' });
    const row = await db.query(`INSERT INTO checklist_items (goal_id,title) SELECT id,$2 FROM goals WHERE id=$1 RETURNING *`, [id, title]);
    return row.rowCount ? reply.code(201).send(row.rows[0]) : reply.code(404).send({ error: 'Mục tiêu không tồn tại.' });
  });

  app.patch<{ Params: { id: string } }>('/api/checklist/:id', async (req, reply) => {
    const id = idOf(req.params.id);
    const b = req.body as Record<string, unknown>;
    if (!id || (b.title !== undefined && !textField(b.title)) || (b.done !== undefined && typeof b.done !== 'boolean')) {
      return reply.code(400).send({ error: 'Checklist không hợp lệ.' });
    }
    const row = await db.query(`UPDATE checklist_items SET title=COALESCE($2,title), done=COALESCE($3,done),
      updated_at=NOW() WHERE id=$1 RETURNING *`, [id, b.title ?? null, b.done ?? null]);
    return row.rowCount ? row.rows[0] : reply.code(404).send({ error: 'Checklist không tồn tại.' });
  });

  app.delete<{ Params: { id: string } }>('/api/checklist/:id', async (req, reply) => {
    const id = idOf(req.params.id);
    if (!id) return reply.code(400).send({ error: 'ID không hợp lệ.' });
    const row = await db.query('DELETE FROM checklist_items WHERE id=$1 RETURNING id', [id]);
    return row.rowCount ? { ok: true } : reply.code(404).send({ error: 'Checklist không tồn tại.' });
  });

  app.get<{ Querystring: { month?: string; q?: string; tag?: string } }>('/api/journal', async (req, reply) => {
    const { month, q, tag } = req.query;
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return reply.code(400).send({ error: 'Tháng không hợp lệ.' });
    const rows = await db.query(`SELECT j.*, COALESCE(array_agg(l.goal_id) FILTER (WHERE l.goal_id IS NOT NULL), '{}') AS goal_ids
      FROM journal_entries j LEFT JOIN journal_goal_links l ON l.journal_id=j.id
      WHERE ($1::text IS NULL OR TO_CHAR(j.datetime AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM')=$1)
        AND ($2::text IS NULL OR j.title ILIKE '%'||$2||'%' OR j.content ILIKE '%'||$2||'%')
        AND ($3::text IS NULL OR $3=ANY(j.tags))
      GROUP BY j.id ORDER BY j.datetime DESC,j.id DESC`, [month || null, q || null, tag || null]);
    return rows.rows;
  });

  app.post('/api/journal', async (req, reply) => {
    const b = req.body as Record<string, unknown>;
    const title = textField(b.title);
    const time = typeof b.datetime === 'string' ? Date.parse(b.datetime) : NaN;
    const tags = b.tags === undefined ? [] : b.tags;
    const goalIds = b.goalIds === undefined ? [] : b.goalIds;
    if (!title || !Number.isFinite(time) || !Array.isArray(tags) || tags.some((t) => !textField(t)) ||
      !Array.isArray(goalIds) || goalIds.some((id) => !Number.isInteger(id) || id <= 0) ||
      (b.content !== undefined && typeof b.content !== 'string')) return reply.code(400).send({ error: 'Nhật ký không hợp lệ.' });
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const goalRows = await client.query('SELECT id FROM goals WHERE id=ANY($1::int[])', [goalIds]);
      if (goalRows.rowCount !== new Set(goalIds).size) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'Mục tiêu liên kết không tồn tại.' });
      }
      const entry = (await client.query(`INSERT INTO journal_entries (datetime,title,content,tags)
        VALUES ($1,$2,$3,$4) RETURNING *`, [new Date(time), title, b.content ?? '', tags])).rows[0];
      for (const goalId of new Set(goalIds as number[])) {
        await client.query('INSERT INTO journal_goal_links (journal_id,goal_id) VALUES ($1,$2)', [entry.id, goalId]);
      }
      await client.query('COMMIT');
      return reply.code(201).send(entry);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  });

  app.get('/api/journal/summary', async () => {
    const [months, weeks] = await Promise.all([
      db.query(`SELECT TO_CHAR(datetime AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM') AS period,
        COUNT(*)::int AS entries FROM journal_entries GROUP BY 1 ORDER BY 1 DESC`),
      db.query(`SELECT TO_CHAR(datetime AT TIME ZONE 'Asia/Ho_Chi_Minh','IYYY-"W"IW') AS period,
        COUNT(*)::int AS entries FROM journal_entries GROUP BY 1 ORDER BY 1 DESC`),
    ]);
    return { months: months.rows, weeks: weeks.rows };
  });

  app.get('/api/journal/calendar', async () => {
    const rows = await db.query(`SELECT TO_CHAR(datetime AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD') AS date,
      COUNT(*)::int AS entries FROM journal_entries GROUP BY 1 ORDER BY 1 DESC`);
    return rows.rows;
  });

  app.patch<{ Params: { id: string } }>('/api/journal/:id', async (req, reply) => {
    const id = idOf(req.params.id);
    const b = req.body as Record<string, unknown>;
    const time = b.datetime === undefined ? null : typeof b.datetime === 'string' ? Date.parse(b.datetime) : NaN;
    if (!id || (b.title !== undefined && !textField(b.title)) ||
      (b.content !== undefined && typeof b.content !== 'string') ||
      (b.datetime !== undefined && !Number.isFinite(time)) ||
      (b.tags !== undefined && (!Array.isArray(b.tags) || b.tags.some((tag) => !textField(tag))))) {
      return reply.code(400).send({ error: 'Nhật ký không hợp lệ.' });
    }
    const row = await db.query(`UPDATE journal_entries SET title=COALESCE($2,title),content=COALESCE($3,content),
      datetime=COALESCE($4,datetime),tags=COALESCE($5,tags),updated_at=NOW() WHERE id=$1 RETURNING *`,
      [id, b.title ?? null, b.content ?? null, time === null ? null : new Date(time), b.tags ?? null]);
    return row.rowCount ? row.rows[0] : reply.code(404).send({ error: 'Nhật ký không tồn tại.' });
  });

  app.delete<{ Params: { id: string } }>('/api/journal/:id', async (req, reply) => {
    const id = idOf(req.params.id);
    if (!id) return reply.code(400).send({ error: 'ID không hợp lệ.' });
    const row = await db.query('DELETE FROM journal_entries WHERE id=$1 RETURNING id', [id]);
    return row.rowCount ? { ok: true } : reply.code(404).send({ error: 'Nhật ký không tồn tại.' });
  });
}

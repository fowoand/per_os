import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

function id(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function incomeSourceRoutes(app: FastifyInstance, db: Pool): Promise<void> {
  app.get('/api/income-sources', async (_req, reply) => {
    return reply.send((await db.query('SELECT * FROM income_sources ORDER BY archived, name, id')).rows);
  });

  app.post('/api/income-sources', async (req, reply) => {
    const name = (req.body as Record<string, unknown>)['name'];
    if (typeof name !== 'string' || !name.trim()) return reply.code(400).send({ error: 'Tên nguồn thu bắt buộc.' });
    try {
      const row = (await db.query('INSERT INTO income_sources (name) VALUES ($1) RETURNING *', [name.trim()])).rows[0];
      return reply.code(201).send(row);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'Tên nguồn thu đang được dùng.' });
      throw error;
    }
  });

  app.patch<{ Params: { id: string } }>('/api/income-sources/:id', async (req, reply) => {
    const sourceId = id(req.params.id);
    if (!sourceId) return reply.code(400).send({ error: 'ID không hợp lệ.' });
    const body = req.body as Record<string, unknown>;
    const sets: string[] = [];
    const values: unknown[] = [];
    if ('name' in body) {
      if (typeof body.name !== 'string' || !body.name.trim()) return reply.code(400).send({ error: 'Tên nguồn thu bắt buộc.' });
      values.push(body.name.trim()); sets.push(`name=$${values.length}`);
    }
    if ('archived' in body) {
      if (typeof body.archived !== 'boolean') return reply.code(400).send({ error: 'archived phải là boolean.' });
      values.push(body.archived); sets.push(`archived=$${values.length}`);
    }
    if (!sets.length) return reply.code(400).send({ error: 'Không có trường nào để cập nhật.' });
    values.push(sourceId);
    try {
      const result = await db.query(`UPDATE income_sources SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${values.length} RETURNING *`, values);
      if (!result.rowCount) return reply.code(404).send({ error: 'Nguồn thu không tồn tại.' });
      return reply.send(result.rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'Tên nguồn thu đang được dùng.' });
      throw error;
    }
  });
}

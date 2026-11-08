import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { schemaVersion } from '../db.js';

const tables = [
  'income_sources', 'jars', 'debts', 'recurring_templates', 'template_versions',
  'month_plans', 'planned_items', 'transactions', 'settings', 'financial_targets',
  'goals', 'checklist_items', 'journal_entries', 'journal_goal_links',
] as const;
type Backup = { schema_version: number; tables: Record<string, Record<string, unknown>[]> };

async function snapshot(db: Pool | PoolClient): Promise<Backup> {
  const version = (await db.query<{ version: number }>('SELECT MAX(version)::int AS version FROM schema_migrations')).rows[0].version;
  const data: Backup['tables'] = {};
  for (const table of tables) data[table] = (await db.query(`SELECT * FROM ${table} ORDER BY 1,2`)).rows;
  return { schema_version: version, tables: data };
}

export async function backupRoutes(app: FastifyInstance, db: Pool): Promise<void> {
  app.get('/api/export', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Content-Disposition', 'attachment; filename="personal-os-backup.json"');
    const client = await db.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const backup = await snapshot(client);
      await client.query('COMMIT');
      return backup;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  });

  app.post('/api/import', { bodyLimit: 50 * 1024 * 1024 }, async (req, reply) => {
    const body = req.body as { confirm?: unknown; backup?: unknown } | null;
    const backup = body?.backup as Backup | undefined;
    const currentVersion = await schemaVersion(db);
    if (body?.confirm !== true || !backup || backup.schema_version !== currentVersion ||
      typeof backup.tables !== 'object' || backup.tables === null ||
      tables.some((table) => !Array.isArray(backup.tables[table]) || backup.tables[table].some((row) =>
        typeof row !== 'object' || row === null || Array.isArray(row)))) {
      return reply.code(400).send({ error: 'Bản sao lưu không hợp lệ hoặc khác phiên bản schema.' });
    }
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(`LOCK TABLE ${tables.join(', ')} IN ACCESS EXCLUSIVE MODE`);
      const columns = new Map<string, string[]>();
      for (const table of tables) {
        const result = await client.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 ORDER BY ordinal_position`, [table]);
        columns.set(table, result.rows.map((row) => row.column_name));
      }
      for (const table of [...tables].reverse()) await client.query(`DELETE FROM ${table}`);
      for (const table of tables) {
        const allowed = columns.get(table)!;
        for (const row of backup.tables[table]) {
          const keys = Object.keys(row);
          if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) {
            await client.query('ROLLBACK');
            return reply.code(400).send({ error: `Cột dữ liệu ${table} không hợp lệ.` });
          }
          await client.query(`INSERT INTO ${table} (${allowed.map((key) => `"${key}"`).join(',')})
            VALUES (${allowed.map((_, i) => `$${i + 1}`).join(',')})`, allowed.map((key) => row[key]));
        }
        if (allowed.includes('id')) {
          await client.query(`SELECT setval(pg_get_serial_sequence($1,'id'),
            GREATEST((SELECT COALESCE(MAX(id),0) FROM ${table}),1),
            (SELECT COUNT(*) > 0 FROM ${table}))`, [table]);
        }
      }
      const restored = await snapshot(client);
      if (JSON.stringify(restored.tables) !== JSON.stringify(backup.tables)) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'Dữ liệu khôi phục khác bản sao lưu.' });
      }
      await client.query('COMMIT');
      return { ok: true };
    } catch (error) {
      await client.query('ROLLBACK');
      const code = (error as { code?: string }).code;
      if (code?.startsWith('22') || code?.startsWith('23')) {
        return reply.code(400).send({ error: 'Bản sao lưu chứa dữ liệu không hợp lệ.' });
      }
      throw error;
    } finally { client.release(); }
  });
}

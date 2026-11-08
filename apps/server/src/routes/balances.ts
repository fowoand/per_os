/**
 * GET /api/balances — available balance, saving balances, as of today.
 */
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { computeAvailableBalance, computeSavingBalance } from '../../../../packages/core/src/index.js';
import type { Transaction, Jar } from '../../../../packages/core/src/index.js';

interface TxnRow {
  id: number; date: string; amount: number; type: string; jar_id: number | null;
  planned_item_id: number | null; description: string; note: string | null; deleted_at: string | null;
}

interface JarRow {
  id: number; name: string; kind: string; parent_id: number | null;
  monthly_budget: number | null; opening_balance: number; archived: boolean;
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

export async function balancesRoutes(app: FastifyInstance, db: Pool): Promise<void> {
  app.get('/api/balances', async (_req, reply) => {
    const settingsRow = (await db.query<{
      account_opening_balance: number; account_opening_date: string; schema_version: number;
    }>('SELECT account_opening_balance, account_opening_date, schema_version FROM settings WHERE id=1')).rows[0];
    if (!settingsRow) return reply.code(500).send({ error: 'Chưa cài đặt tài khoản.' });

    const settings = {
      accountOpeningBalance: settingsRow.account_opening_balance,
      accountOpeningDate: settingsRow.account_opening_date as Transaction['date'],
      schemaVersion: settingsRow.schema_version,
    };

    const allTxns = (await db.query<TxnRow>('SELECT * FROM transactions')).rows.map(mapTxn);
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }) as Transaction['date'];

    const available = computeAvailableBalance(settings, allTxns, today);

    const savingJars = (await db.query<JarRow>("SELECT * FROM jars WHERE kind='saving'")).rows.map(mapJar);
    const savingBalances = savingJars.map((jar) => ({
      id: jar.id,
      name: jar.name,
      balance: computeSavingBalance(jar, allTxns),
    }));
    const totalSaving = savingBalances.reduce((s, j) => s + j.balance, 0);

    return reply.send({
      available,
      totalSaving,
      savingJars: savingBalances,
      asOf: today,
      disclaimer: 'Chỉ đúng khi đã nhập đủ giao dịch. Có thể khác số dư ngân hàng.',
    });
  });
}

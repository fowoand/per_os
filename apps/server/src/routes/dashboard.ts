import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

export async function dashboardRoutes(app: FastifyInstance, db: Pool): Promise<void> {
  app.get('/api/dashboard', async (_req, reply) => {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
    const asOf = today;
    const settings = (await db.query<{ account_opening_balance: number; account_opening_date: string }>(
      'SELECT account_opening_balance, account_opening_date FROM settings WHERE id=1',
    )).rows[0];
    if (!settings) return reply.code(500).send({ error: 'Chưa cài đặt tài khoản.' });
    const txns = (await db.query<{ date: string; type: string; amount: number; jar_id: number | null; income_source_id: number | null; planned_item_id: number | null }>(
      'SELECT date,type,amount,jar_id,income_source_id,planned_item_id FROM transactions WHERE deleted_at IS NULL AND date >= $1 AND date <= $2 ORDER BY date',
      [settings.account_opening_date, asOf],
    )).rows;
    const jars = (await db.query<{ id: number; name: string; kind: string; parent_id: number | null; opening_balance: number }>(
      'SELECT id,name,kind,parent_id,opening_balance FROM jars ORDER BY id',
    )).rows;
    const sources = (await db.query<{ id: number; name: string; archived: boolean }>(
      'SELECT id,name,archived FROM income_sources ORDER BY id',
    )).rows;
    const currentMonth = today.slice(0, 7);
    const debtTotals = (await db.query<{ total: number; unknown: number }>(
      `SELECT COALESCE(SUM(current_balance) FILTER (WHERE current_balance IS NOT NULL AND status <> 'paid_off'), 0)::bigint AS total,
              COUNT(*) FILTER (WHERE current_balance IS NULL AND status <> 'paid_off')::int AS unknown
       FROM debts`,
    )).rows[0] ?? { total: 0, unknown: 0 };
    const obligations = (await db.query<{ kind: string; expected_amount: number; paid: number }>(
      `SELECT pi.kind, pi.expected_amount,
              COALESCE(SUM(t.amount) FILTER (WHERE t.deleted_at IS NULL), 0)::bigint AS paid
       FROM planned_items pi
       LEFT JOIN transactions t ON t.planned_item_id = pi.id
       WHERE pi.month = $1 AND pi.skipped = FALSE
       GROUP BY pi.id`,
      [currentMonth],
    )).rows;
    const pendingObligations = obligations
      .filter((item) => item.kind !== 'income')
      .reduce((sum, item) => sum + Math.max(0, item.expected_amount - item.paid), 0);
    const pendingDebtObligations = obligations
      .filter((item) => item.kind === 'debt_payment')
      .reduce((sum, item) => sum + Math.max(0, item.expected_amount - item.paid), 0);
    const history = new Map<string, { month: string; income: number; expense: number; savingTransfer: number; netSaving: number }>();
    const byJar = new Map<number, number>();
    const bySource = new Map<number, number>();
    let income = 0, expense = 0, savingTransfer = 0, fixedExpense = 0;
    for (const txn of txns) {
      const key = txn.date.slice(0, 7);
      const row = history.get(key) ?? { month: key, income: 0, expense: 0, savingTransfer: 0, netSaving: 0 };
      if (txn.type === 'income') {
        income += txn.amount; row.income += txn.amount;
        if (txn.income_source_id !== null) bySource.set(txn.income_source_id, (bySource.get(txn.income_source_id) ?? 0) + txn.amount);
      }
      if (txn.type === 'expense') {
        expense += txn.amount; row.expense += txn.amount;
        if (txn.planned_item_id !== null) fixedExpense += txn.amount;
        if (txn.jar_id !== null) byJar.set(txn.jar_id, (byJar.get(txn.jar_id) ?? 0) + txn.amount);
      }
      if (txn.type === 'transfer_in' || txn.type === 'transfer_out') {
        const amount = txn.type === 'transfer_in' ? txn.amount : -txn.amount;
        savingTransfer += amount; row.savingTransfer += amount;
        if (txn.jar_id !== null) byJar.set(txn.jar_id, (byJar.get(txn.jar_id) ?? 0) + amount);
      }
      row.netSaving = row.income - row.expense;
      history.set(key, row);
    }
    const savingJars = jars.filter((jar) => jar.kind === 'saving');
    const totalSaving = savingJars.reduce((sum, jar) => sum + jar.opening_balance + (byJar.get(jar.id) ?? 0), 0);
    return reply.send({ asOf, available: settings.account_opening_balance + income - expense - savingTransfer,
      totalSaving, income, expense, fixedExpense, savingTransfer,
      totalDebt: debtTotals.total, unknownDebtCount: debtTotals.unknown,
      pendingObligations, pendingDebtObligations,
      availableAfterObligations: settings.account_opening_balance + income - expense - savingTransfer - pendingObligations,
      jars: jars.map((jar) => ({ id: jar.id, name: jar.name, kind: jar.kind,
        total: jar.kind === 'saving' ? jar.opening_balance + (byJar.get(jar.id) ?? 0)
          : (byJar.get(jar.id) ?? 0) + jars.filter((child) => child.parent_id === jar.id).reduce((sum, child) => sum + (byJar.get(child.id) ?? 0), 0) })),
      sources: sources.map((source) => ({ ...source, total: bySource.get(source.id) ?? 0 })),
      history: [...history.values()].sort((a, b) => b.month.localeCompare(a.month)),
      disclaimer: 'Chỉ đúng khi đã nhập đủ giao dịch. Có thể khác số dư ngân hàng.' });
  });
}

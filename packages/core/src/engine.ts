/**
 * Personal OS – domain engine (pure, no DB / HTTP / UI).
 * All money: integer VND. Unknown debt balance: null.
 */
import type {
  Debt,
  Jar,
  LocalDate,
  Month,
  PlannedItem,
  RecurringTemplate,
  Settings,
  TemplateKind,
  TemplateVersion,
  Transaction,
} from './index.js';

// ─── helpers ────────────────────────────────────────────────────────────────

/** "2026-11" ≤ "2026-12" lexicographic compare works for YYYY-MM. */
function monthLe(a: Month, b: Month): boolean {
  return a <= b;
}

/** Extract YYYY-MM from a LocalDate string. */
export function dateToMonth(date: string): Month {
  const m = date.slice(0, 7);
  // ponytail: trusts caller format; add runtime validation at API boundary
  return m as Month;
}

// ─── 5.1 month generation ────────────────────────────────────────────────────

/**
 * Effective amount for template T in month M: the version with the greatest
 * effectiveFrom ≤ M. Returns undefined when no version qualifies — caller
 * must treat this as a data error and must NOT invent a fallback amount.
 */
export function effectiveAmount(
  versions: TemplateVersion[],
  month: Month,
): number | undefined {
  let best: TemplateVersion | undefined;
  for (const v of versions) {
    if (monthLe(v.effectiveFrom, month)) {
      if (best === undefined || v.effectiveFrom > best.effectiveFrom) {
        best = v;
      }
    }
  }
  return best?.amount;
}

export interface GenerateInput {
  month: Month;
  templates: RecurringTemplate[];
  /** All versions for every template in `templates`. */
  allVersions: TemplateVersion[];
  debts: Debt[];
  /** Existing items for month M (used for idempotency check). */
  existingItems: PlannedItem[];
}

export interface GeneratedItem {
  templateId: number;
  name: string;
  kind: TemplateKind;
  jarId: number | null;
  debtId: number | null;
  expectedAmount: number;
  expectedDay: number | null;
}

/**
 * Returns items to CREATE for month M (excludes templates already present in
 * existingItems). Caller owns persistence and idempotency at the DB level.
 * Rules:
 * - paid_off debt template → skip.
 * - Missing qualifying version is a data error; do not omit an obligation.
 */
export function generateMonthItems(input: GenerateInput): GeneratedItem[] {
  const { month, templates, allVersions, debts, existingItems } = input;
  const existingTemplateIds = new Set(
    existingItems.map((i) => i.templateId).filter((id): id is number => id !== null),
  );
  const plannedDebtIds = new Set(existingItems.map((i) => i.debtId).filter((id): id is number => id !== null));
  const debtById = new Map(debts.map((d) => [d.id, d]));

  const result: GeneratedItem[] = [];
  for (const t of templates) {
    if (!t.autoRepeat) continue;
    if (!monthLe(t.startMonth, month)) continue;
    if (t.endMonth !== null && !monthLe(month, t.endMonth)) continue;
    if (existingTemplateIds.has(t.id)) continue; // idempotent
    if (t.kind === 'debt_payment' && t.debtId !== null && plannedDebtIds.has(t.debtId)) continue;

    // Skip debt template whose debt is paid_off
    if (t.kind === 'debt_payment' && t.debtId !== null) {
      const debt = debtById.get(t.debtId);
      if (debt?.status === 'paid_off') continue;
    }

    const versions = allVersions.filter((v) => v.templateId === t.id);
    const amount = effectiveAmount(versions, month);
    if (amount === undefined) throw new Error(`Template ${t.id} has no amount for ${month}`);

    result.push({
      templateId: t.id,
      name: t.name,
      kind: t.kind,
      jarId: t.jarId,
      debtId: t.debtId,
      expectedAmount: amount,
      expectedDay: t.dayOfMonth,
    });
    if (t.kind === 'debt_payment' && t.debtId !== null) plannedDebtIds.add(t.debtId);
  }
  return result;
}

// ─── 5.3 payment status ──────────────────────────────────────────────────────

export type PaymentStatus = 'skipped' | 'unpaid' | 'partial' | 'paid';

export interface PaymentStatusResult {
  status: PaymentStatus;
  paid: number;
  remaining: number;
}

/** Active (non-deleted) transactions linked to a planned item. */
function activePaid(txns: Transaction[]): number {
  return txns
    .filter((t) => t.deletedAt === null)
    .reduce((sum, t) => sum + t.amount, 0);
}

export function itemPaymentStatus(
  item: PlannedItem,
  linkedTxns: Transaction[],
): PaymentStatusResult {
  if (item.skipped) return { status: 'skipped', paid: 0, remaining: 0 };
  const paid = activePaid(linkedTxns);
  if (paid === 0) return { status: 'unpaid', paid: 0, remaining: item.expectedAmount };
  if (paid < item.expectedAmount)
    return { status: 'partial', paid, remaining: item.expectedAmount - paid };
  return { status: 'paid', paid, remaining: 0 };
}

// ─── 6.2 available balance ───────────────────────────────────────────────────

/**
 * Cumulative available balance from account opening through end of `asOf`.
 * Excludes transactions dated after `asOf` and before `accountOpeningDate`.
 * Per spec 6.2: "đến hết ngày hôm nay".
 */
export function computeAvailableBalance(
  settings: Settings,
  allTxns: Transaction[],
  asOf: LocalDate,
): number {
  let balance = settings.accountOpeningBalance;
  for (const t of allTxns) {
    if (t.deletedAt !== null) continue;
    if (t.date < settings.accountOpeningDate) continue;
    if (t.date > asOf) continue;
    switch (t.type) {
      case 'income':
        balance += t.amount;
        break;
      case 'expense':
        balance -= t.amount;
        break;
      case 'transfer_in':
        balance -= t.amount;
        break;
      case 'transfer_out':
        balance += t.amount;
        break;
    }
  }
  return balance;
}

// ─── 6.3 saving balance ──────────────────────────────────────────────────────

/** Balance of one saving jar: opening + transfer_in − transfer_out. */
export function computeSavingBalance(
  jar: Jar,
  allTxns: Transaction[],
): number {
  let balance = jar.openingBalance;
  for (const t of allTxns) {
    if (t.deletedAt !== null) continue;
    if (t.jarId !== jar.id) continue;
    if (t.type === 'transfer_in') balance += t.amount;
    if (t.type === 'transfer_out') balance -= t.amount;
  }
  return balance;
}

// ─── 6.4 jar usage ───────────────────────────────────────────────────────────

/**
 * Total expense transactions in `monthTxns` for jar (non-deleted).
 * Parent jar: sum child jar IDs (caller provides childIds).
 * Pass childIds=[] to query a single leaf jar.
 */
export function computeJarUsed(
  jarId: number,
  childJarIds: number[],
  monthTxns: Transaction[],
): number {
  const ids = childJarIds.length > 0 ? childJarIds : [jarId];
  return monthTxns
    .filter(
      (t) =>
        t.deletedAt === null &&
        t.type === 'expense' &&
        t.jarId !== null &&
        ids.includes(t.jarId),
    )
    .reduce((sum, t) => sum + t.amount, 0);
}

// ─── 6.1 month budget summary ────────────────────────────────────────────────

export interface MonthSummary {
  expectedIncome: number;
  fixedAllocation: number;
  groupAllocation: number;
  unallocated: number;
  actualExpense: number;
  actualSavingTransfer: number;
  /**
   * Remaining obligations: sum of remaining amounts for unpaid/partial
   * expense, debt_payment, and transfer_to_saving items (non-skipped).
   * Income items are NOT obligations.
   */
  pendingObligations: number;
  availableAfterObligations: number;
}

export interface MonthSummaryInput {
  items: PlannedItem[];
  /** All transactions in this month (non-deleted filtering done inside). */
  monthTxns: Transaction[];
  /** All linked transactions per item id. */
  linkedTxnsByItemId: Map<number, Transaction[]>;
  /** Spending jars with the selected month's budget. */
  spendingJars: Jar[];
  /** Current available balance (from computeAvailableBalance). */
  availableBalance: number;
}

export function computeMonthSummary(input: MonthSummaryInput): MonthSummary {
  const {
    items,
    monthTxns,
    linkedTxnsByItemId,
    spendingJars,
    availableBalance,
  } = input;

  // 6.1
  const expectedIncome = items
    .filter((i) => i.kind === 'income')
    .reduce((s, i) => s + i.expectedAmount, 0);

  const fixedAllocation = items
    .filter(
      (i) =>
        !i.skipped && (i.kind === 'expense' ||
        i.kind === 'debt_payment' ||
        i.kind === 'transfer_to_saving'),
    )
    .reduce((s, i) => s + i.expectedAmount, 0);

  const groupAllocation = spendingJars.reduce((sum, jar) => {
    if (jar.monthlyBudget === null) return sum;
    const fixedForJar = items.filter((item) => !item.skipped && item.kind === 'expense' && item.jarId === jar.id)
      .reduce((total, item) => total + item.expectedAmount, 0);
    return sum + Math.max(0, jar.monthlyBudget - fixedForJar);
  }, 0);

  const unallocated = expectedIncome - fixedAllocation - groupAllocation;

  // 6.4
  const activeTxns = monthTxns.filter((t) => t.deletedAt === null);
  const actualExpense = activeTxns
    .filter((t) => t.type === 'expense')
    .reduce((s, t) => s + t.amount, 0);
  const actualSavingTransfer =
    activeTxns.filter((t) => t.type === 'transfer_in').reduce((s, t) => s + t.amount, 0) -
    activeTxns.filter((t) => t.type === 'transfer_out').reduce((s, t) => s + t.amount, 0);

  // Pending obligations: only expense/debt_payment/transfer_to_saving.
  // Income items are expected receipts, not payable obligations.
  let pendingObligations = 0;
  for (const item of items) {
    if (item.kind === 'income') continue;
    if (item.skipped) continue;
    const linked = linkedTxnsByItemId.get(item.id) ?? [];
    const { remaining } = itemPaymentStatus(item, linked);
    pendingObligations += remaining;
  }

  return {
    expectedIncome,
    fixedAllocation,
    groupAllocation,
    unallocated,
    actualExpense,
    actualSavingTransfer,
    pendingObligations,
    availableAfterObligations: availableBalance - pendingObligations,
  };
}

// ─── 5.4 debt balance after payment ─────────────────────────────────────────

/**
 * Returns updated currentBalance after recording `amountPaid`.
 * Returns null if original balance was unknown (null).
 * Returns undefined when payment exceeds a known remaining balance.
 */
export function debtBalanceAfterPayment(
  currentBalance: number | null,
  amountPaid: number,
): number | null | undefined {
  if (currentBalance === null) return null;
  if (amountPaid > currentBalance) return undefined;
  return currentBalance - amountPaid;
}

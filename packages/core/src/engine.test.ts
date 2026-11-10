/**
 * Stage 1 gate – engine.test.ts
 *
 * Coverage status per spec section 11:
 *
 * CORE-VERIFIED (pure functions, no DB/HTTP/UI needed):
 *   Cases 1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14, 15, 16
 *
 * PARTIALLY VERIFIED (core invariant tested; named boundary still needed):
 *   Case  7 – disclaimer text is a UI responsibility
 *   Case  8 – rejecting writes to closed month is server/API; core tests
 *             balance recalculation after the fact
 *   Case 17 – full DB write/read cycle is a server test; core tests that
 *             integer amounts survive JSON round-trip
 *
 * NOT YET VERIFIED (require API/DB/UI tests, written separately):
 *   Case  6 (partial) – server must enforce one txn per tick via idempotencyKey
 *                       or DB unique constraint
 *   Case  8 (partial) – server must reject POST txn when month status=closed
 *   Case 17 (partial) – server POST /api/import then GET must return identical data
 */
import { describe, it, expect } from 'vitest';
import {
  effectiveAmount,
  generateMonthItems,
  itemPaymentStatus,
  computeAvailableBalance,
  computeSavingBalance,
  computeJarUsed,
  computeMonthSummary,
  debtBalanceAfterPayment,
  dateToMonth,
} from './engine.js';
import type {
  Debt,
  Jar,
  LocalDate,
  Month,
  PlannedItem,
  RecurringTemplate,
  Settings,
  TemplateVersion,
  Transaction,
} from './index.js';

// ─── fixtures ────────────────────────────────────────────────────────────────

const TODAY: LocalDate = '2026-11-05';

const SETTINGS: Settings = {
  accountOpeningBalance: 0,
  accountOpeningDate: '2026-11-01',
  schemaVersion: 1,
};

function mkTemplate(
  overrides: Partial<RecurringTemplate> & Pick<RecurringTemplate, 'id' | 'kind'>,
): RecurringTemplate {
  return {
    name: 'Template',
    jarId: null,
    debtId: null,
    frequency: 'monthly',
    dayOfMonth: 15,
    startMonth: '2026-11',
    endMonth: null,
    autoRepeat: true,
    note: null,
    ...overrides,
  };
}

function mkVersion(templateId: number, amount: number, effectiveFrom: Month): TemplateVersion {
  return { id: templateId * 100, templateId, amount, effectiveFrom };
}

function mkItem(
  overrides: Partial<PlannedItem> & Pick<PlannedItem, 'id' | 'kind' | 'expectedAmount'>,
): PlannedItem {
  return {
    month: '2026-11',
    templateId: null,
    name: 'Item',
    jarId: null,
    debtId: null,
    expectedDay: 15,
    skipped: false,
    note: null,
    isOverridden: false,
    ...overrides,
  };
}

function mkTxn(
  overrides: Partial<Transaction> & Pick<Transaction, 'id' | 'type' | 'amount'>,
): Transaction {
  return {
    date: '2026-11-05',
    jarId: null,
    plannedItemId: null,
    description: '',
    note: null,
    deletedAt: null,
    ...overrides,
  };
}

function mkJar(overrides: Partial<Jar> & Pick<Jar, 'id' | 'kind'>): Jar {
  return {
    name: 'Jar',
    parentId: null,
    monthlyBudget: null,
    openingBalance: 0,
    archived: false,
    ...overrides,
  };
}

function mkDebt(overrides: Partial<Debt> & Pick<Debt, 'id'>): Debt {
  return {
    name: 'Debt',
    currentBalance: null,
    expectedMonthly: 2_000_000,
    dueDay: null,
    interestRate: null,
    status: 'active',
    ...overrides,
  };
}

// ─── Case 1: late salary – CORE VERIFIED ─────────────────────────────────────

describe('Case 1: late salary', () => {
  it('available balance = opening when no income txn recorded', () => {
    expect(computeAvailableBalance(SETTINGS, [], TODAY)).toBe(0);
  });

  it('planned income item is unpaid when no linked txn', () => {
    const item = mkItem({ id: 1, kind: 'income', expectedAmount: 18_886_350 });
    expect(itemPaymentStatus(item, []).status).toBe('unpaid');
  });

  it('income item does NOT contribute to pendingObligations', () => {
    // Spec 6.4: obligations are what you must pay out, not receipts you await.
    const incomeItem = mkItem({ id: 1, kind: 'income', expectedAmount: 18_886_350 });
    const summary = computeMonthSummary({
      items: [incomeItem],
      monthTxns: [],
      linkedTxnsByItemId: new Map(),
      spendingJars: [],
      availableBalance: 0,
    });
    expect(summary.pendingObligations).toBe(0);
  });
});

// ─── Case 2: partial transfer to mum – CORE VERIFIED ─────────────────────────

describe('Case 2: partial payment to mum', () => {
  it('status is partial, remaining = 1_000_000', () => {
    const item = mkItem({ id: 2, kind: 'expense', expectedAmount: 8_000_000 });
    const txn = mkTxn({ id: 1, type: 'expense', amount: 7_000_000, plannedItemId: 2 });
    const result = itemPaymentStatus(item, [txn]);
    expect(result.status).toBe('partial');
    expect(result.paid).toBe(7_000_000);
    expect(result.remaining).toBe(1_000_000);
  });
});

// ─── Case 3: debt payment 1.5M – CORE VERIFIED ───────────────────────────────

describe('Case 3: partial debt payment', () => {
  it('status is partial when 1_500_000 paid against 2_000_000', () => {
    const item = mkItem({ id: 3, kind: 'debt_payment', expectedAmount: 2_000_000 });
    const txn = mkTxn({ id: 2, type: 'expense', amount: 1_500_000, plannedItemId: 3 });
    const result = itemPaymentStatus(item, [txn]);
    expect(result.status).toBe('partial');
    expect(result.remaining).toBe(500_000);
  });
});

// ─── Case 4: monthly budget does not create savings ───────────────────────

describe('Case 4: unused monthly budget', () => {
  it('unused spending budget leaves actual saving transfer at zero', () => {
    const summary = computeMonthSummary({
      items: [], monthTxns: [], linkedTxnsByItemId: new Map(),
      spendingJars: [mkJar({ id: 2, kind: 'spending', monthlyBudget: 2_000_000 })],
      availableBalance: 0,
    });
    expect(summary.actualSavingTransfer).toBe(0);
  });
});

// ─── Case 5: template version change – CORE VERIFIED ─────────────────────────

describe('Case 5: template version change from 2027-01', () => {
  const versions: TemplateVersion[] = [
    { id: 1, templateId: 1, amount: 8_000_000, effectiveFrom: '2026-11' },
    { id: 2, templateId: 1, amount: 9_000_000, effectiveFrom: '2027-01' },
  ];

  it('2026-11 uses 8_000_000', () => {
    expect(effectiveAmount(versions, '2026-11')).toBe(8_000_000);
  });

  it('2026-12 uses 8_000_000 (older version still active)', () => {
    expect(effectiveAmount(versions, '2026-12')).toBe(8_000_000);
  });

  it('2027-01 uses 9_000_000 (new version takes effect)', () => {
    expect(effectiveAmount(versions, '2027-01')).toBe(9_000_000);
  });

  it('no qualifying version → undefined, not invented 0', () => {
    expect(effectiveAmount([], '2026-11')).toBeUndefined();
  });

  it('generateMonthItems rejects template with no qualifying version', () => {
    const t = mkTemplate({ id: 99, kind: 'expense' });
    expect(() => generateMonthItems({
      month: '2026-11',
      templates: [t],
      allVersions: [],
      debts: [],
      existingItems: [],
    })).toThrow('Template 99 has no amount for 2026-11');
  });
});

// ─── Case 6: tick idempotency and unpay – CORE VERIFIED (partial) ────────────

describe('Case 6: tick idempotency and unpay', () => {
  it('soft-deleted duplicate txn does NOT contribute to paid total', () => {
    // Core invariant: deletedAt !== null → excluded from activePaid.
    // Boundary (not tested here): server must reject a second tick when item
    // is already paid (via idempotencyKey or status check in DB transaction).
    const item = mkItem({ id: 4, kind: 'expense', expectedAmount: 8_000_000 });
    const activeTxn = mkTxn({ id: 10, type: 'expense', amount: 8_000_000, plannedItemId: 4 });
    const deletedDup = mkTxn({
      id: 11,
      type: 'expense',
      amount: 8_000_000,
      plannedItemId: 4,
      deletedAt: '2026-11-15T10:00:00Z',
    });
    const result = itemPaymentStatus(item, [activeTxn, deletedDup]);
    expect(result.status).toBe('paid');
    expect(result.paid).toBe(8_000_000);
  });

  it('after unpay (soft delete), status returns to unpaid', () => {
    const item = mkItem({ id: 4, kind: 'expense', expectedAmount: 8_000_000 });
    const deletedTxn = mkTxn({
      id: 10,
      type: 'expense',
      amount: 8_000_000,
      plannedItemId: 4,
      deletedAt: '2026-11-15T10:00:00Z',
    });
    const result = itemPaymentStatus(item, [deletedTxn]);
    expect(result.status).toBe('unpaid');
    expect(result.paid).toBe(0);
  });
});

// ─── Case 7: missing transactions – CORE VERIFIED (partial) ──────────────────

describe('Case 7: missing transactions – balance disclaimer', () => {
  it('available balance = opening when no txns recorded', () => {
    // Core: balance is calculated only from recorded transactions; no fallback.
    expect(computeAvailableBalance(SETTINGS, [], TODAY)).toBe(SETTINGS.accountOpeningBalance);
    // Boundary (not tested here): spec requires a fixed disclaimer in the UI
    // — "Chỉ đúng khi đã nhập đủ giao dịch. Có thể khác số dư ngân hàng."
  });
});

// ─── Case 8: closed month – CORE VERIFIED (partial) ──────────────────────────

describe('Case 8: transaction in closed month', () => {
  it('balance recalculates correctly when txn is present (after re-open)', () => {
    // Core: balance is derived from raw txns; adding one changes the total.
    // Boundary (not tested here): server must return 4xx when POSTing a txn
    // to a month with status=closed; re-open endpoint must set status=open.
    const txn = mkTxn({ id: 20, type: 'expense', amount: 500_000, date: '2026-11-04' });
    const before = computeAvailableBalance(SETTINGS, [], TODAY);
    const after  = computeAvailableBalance(SETTINGS, [txn], TODAY);
    expect(after).toBe(before - 500_000);
  });
});

// ─── Case 9: idempotent month generation – CORE VERIFIED ─────────────────────

describe('Case 9: idempotent month generation', () => {
  const template = mkTemplate({ id: 1, kind: 'income' });
  const versions = [mkVersion(1, 18_886_350, '2026-11')];

  it('first call returns one item per eligible template', () => {
    const items = generateMonthItems({
      month: '2026-11',
      templates: [template],
      allVersions: versions,
      debts: [],
      existingItems: [],
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.templateId).toBe(1);
    expect(items[0]?.expectedAmount).toBe(18_886_350);
  });

  it('second call with pre-existing item returns empty (idempotent)', () => {
    const existing: PlannedItem[] = [
      mkItem({ id: 1, kind: 'income', expectedAmount: 18_886_350, templateId: 1 }),
    ];
    const items = generateMonthItems({
      month: '2026-11',
      templates: [template],
      allVersions: versions,
      debts: [],
      existingItems: existing,
    });
    expect(items).toHaveLength(0);
  });
});

// ─── Case 10: saving withdrawal – CORE VERIFIED ──────────────────────────────

describe('Case 10: saving withdrawal (transfer_out)', () => {
  const savingJar = mkJar({ id: 5, kind: 'saving', openingBalance: 5_000_000 });

  it('saving balance decreases after transfer_out', () => {
    const txn = mkTxn({ id: 30, type: 'transfer_out', amount: 2_000_000, jarId: 5 });
    expect(computeSavingBalance(savingJar, [txn])).toBe(3_000_000);
  });

  it('available balance increases (transfer_out credited back to spending account)', () => {
    const txn = mkTxn({ id: 30, type: 'transfer_out', amount: 2_000_000, jarId: 5 });
    const before = computeAvailableBalance(SETTINGS, [], TODAY);
    const after  = computeAvailableBalance(SETTINGS, [txn], TODAY);
    expect(after).toBe(before + 2_000_000);
  });

  it('transfer_out is NOT counted as income (not in actualExpense either)', () => {
    const txn = mkTxn({ id: 30, type: 'transfer_out', amount: 2_000_000, jarId: 5 });
    const summary = computeMonthSummary({
      items: [],
      monthTxns: [txn],
      linkedTxnsByItemId: new Map(),
      spendingJars: [],
      availableBalance: computeAvailableBalance(SETTINGS, [txn], TODAY),
    });
    expect(summary.actualExpense).toBe(0);
    expect(summary.actualSavingTransfer).toBe(-2_000_000); // net withdrawal
  });
});

// ─── Case 11: saving transfer 3M – CORE VERIFIED ─────────────────────────────

describe('Case 11: saving transfer_in 3M', () => {
  const savingJar = mkJar({ id: 6, kind: 'saving' });

  it('saving balance increases', () => {
    const txn = mkTxn({ id: 40, type: 'transfer_in', amount: 3_000_000, jarId: 6 });
    expect(computeSavingBalance(savingJar, [txn])).toBe(3_000_000);
  });

  it('available balance decreases', () => {
    const txn = mkTxn({ id: 40, type: 'transfer_in', amount: 3_000_000, jarId: 6 });
    const bal = computeAvailableBalance(SETTINGS, [txn], TODAY);
    expect(bal).toBe(SETTINGS.accountOpeningBalance - 3_000_000);
  });

  it('not counted in actualExpense', () => {
    const txn = mkTxn({ id: 40, type: 'transfer_in', amount: 3_000_000, jarId: 6 });
    const summary = computeMonthSummary({
      items: [],
      monthTxns: [txn],
      linkedTxnsByItemId: new Map(),
      spendingJars: [],
      availableBalance: computeAvailableBalance(SETTINGS, [txn], TODAY),
    });
    expect(summary.actualExpense).toBe(0);
    expect(summary.actualSavingTransfer).toBe(3_000_000);
  });
});

// ─── Case 12: template end_month – CORE VERIFIED ─────────────────────────────

describe('Case 12: template end_month boundary', () => {
  const template = mkTemplate({ id: 2, kind: 'expense', endMonth: '2027-01' });
  const versions = [mkVersion(2, 1_000_000, '2026-11')];

  it('generates item for 2027-01 (inclusive last month)', () => {
    const items = generateMonthItems({
      month: '2027-01',
      templates: [template],
      allVersions: versions,
      debts: [],
      existingItems: [],
    });
    expect(items).toHaveLength(1);
  });

  it('does NOT generate item for 2027-02 (after end_month)', () => {
    const items = generateMonthItems({
      month: '2027-02',
      templates: [template],
      allVersions: versions,
      debts: [],
      existingItems: [],
    });
    expect(items).toHaveLength(0);
  });
});

// ─── Case 13: re-opened month txn edit – CORE VERIFIED (partial) ─────────────

describe('Case 13: re-opened month txn edit updates downstream balance', () => {
  it('amending txn amount changes cumulative available balance', () => {
    // Core: balance is derived from raw txns; no cached totals to invalidate.
    // Boundary (not tested here): server must enforce month status=open before
    // allowing PATCH /api/transactions/:id.
    const original = mkTxn({ id: 50, type: 'expense', amount: 500_000, date: '2026-11-04' });
    const amended  = mkTxn({ id: 50, type: 'expense', amount: 800_000, date: '2026-11-04' });
    const balBefore = computeAvailableBalance(SETTINGS, [original], TODAY);
    const balAfter  = computeAvailableBalance(SETTINGS, [amended],  TODAY);
    expect(balAfter).toBe(balBefore - 300_000);
  });
});

// ─── Case 14: date-based month assignment – CORE VERIFIED ────────────────────

describe('Case 14: date-based month assignment (Asia/Ho_Chi_Minh)', () => {
  it('dateToMonth extracts YYYY-MM from stored date string', () => {
    // Core: month derived from stored date string.
    // Boundary (not tested here): server receives user-local date at input time
    // ("theo ngày người dùng chọn") and must store the correct date string.
    expect(dateToMonth('2026-11-30')).toBe('2026-11');
    expect(dateToMonth('2026-12-01')).toBe('2026-12');
  });

  it('a 23:50 Nov 30 txn stored as 2026-11-30 belongs to November', () => {
    const txn = mkTxn({ id: 60, type: 'expense', amount: 100_000, date: '2026-11-30' });
    expect(dateToMonth(txn.date)).toBe('2026-11');
  });

  it('future-dated txn excluded from balance when asOf is earlier', () => {
    // spec 6.2: "đến hết ngày hôm nay" — future txns must not inflate balance.
    const futureTxn = mkTxn({ id: 61, type: 'income', amount: 18_886_350, date: '2026-11-15' });
    const balToday  = computeAvailableBalance(SETTINGS, [futureTxn], '2026-11-05');
    const balFuture = computeAvailableBalance(SETTINGS, [futureTxn], '2026-11-15');
    expect(balToday).toBe(0);             // txn in the future, excluded
    expect(balFuture).toBe(18_886_350);   // included once asOf reaches that date
  });
});

// ─── Case 15: flat jar monthly budget ───────────────────────────────────────

describe('Case 15: flat jar monthly budget', () => {
  it('uses only expenses assigned to this jar', () => {
    const monthTxns = [mkTxn({ id: 1, type: 'expense', amount: 500_000, jarId: 2 }),
      mkTxn({ id: 2, type: 'expense', amount: 600_000, jarId: 3 })];
    expect(computeJarUsed(2, [], monthTxns)).toBe(500_000);
    expect(2_000_000 - computeJarUsed(2, [], monthTxns)).toBe(1_500_000);
  });
});

// ─── Case 16: unknown debt balance – CORE VERIFIED ───────────────────────────

describe('Case 16: debt with null currentBalance', () => {
  it('debtBalanceAfterPayment returns null when balance unknown', () => {
    expect(debtBalanceAfterPayment(null, 1_500_000)).toBeNull();
  });

  it('known balance reduces correctly', () => {
    expect(debtBalanceAfterPayment(10_000_000, 2_000_000)).toBe(8_000_000);
  });

  it('payment above known balance is rejected', () => {
    expect(debtBalanceAfterPayment(1_000_000, 2_000_000)).toBeUndefined();
    expect(debtBalanceAfterPayment(1_000_000, 1_000_000)).toBe(0);
  });
  // Boundary (not tested here): API must not return an estimated payoff date
  // or remaining-balance field when currentBalance is null.
});

// ─── Case 17: export/import round-trip – CORE VERIFIED (partial) ─────────────

describe('Case 17: export / import data round-trip', () => {
  it('integer VND amounts survive JSON serialisation unchanged', () => {
    // Core invariant: amounts are plain integers, no float precision loss.
    // Boundary (not tested here): server POST /api/import then GET must return
    // identical rows; that requires a DB-level round-trip test.
    const transactions: Transaction[] = [
      mkTxn({ id: 1, type: 'income',      amount: 18_886_350 }),
      mkTxn({ id: 2, type: 'expense',     amount: 8_000_000  }),
      mkTxn({ id: 3, type: 'transfer_in', amount: 3_000_000  }),
    ];
    const parsed = JSON.parse(JSON.stringify({ transactions })) as { transactions: Transaction[] };
    for (let i = 0; i < transactions.length; i++) {
      expect(parsed.transactions[i]?.amount).toBe(transactions[i]?.amount);
      expect(Number.isInteger(parsed.transactions[i]?.amount)).toBe(true);
    }
  });

  it('available balance from reimported txns equals original', () => {
    const txns: Transaction[] = [
      mkTxn({ id: 1, type: 'income',  amount: 18_886_350 }),
      mkTxn({ id: 2, type: 'expense', amount: 8_000_000  }),
    ];
    const original    = computeAvailableBalance(SETTINGS, txns, TODAY);
    const roundTripped = computeAvailableBalance(
      SETTINGS,
      JSON.parse(JSON.stringify(txns)) as Transaction[],
      TODAY,
    );
    expect(roundTripped).toBe(original);
  });
});

// ─── Supplementary: paid_off debt template skipped – CORE VERIFIED ───────────

describe('Supplementary: paid_off debt template not generated', () => {
  it('does not generate item when debt.status = paid_off', () => {
    const debt = mkDebt({ id: 99, status: 'paid_off', currentBalance: 0 });
    const template = mkTemplate({ id: 5, kind: 'debt_payment', debtId: 99 });
    const versions = [mkVersion(5, 2_000_000, '2026-11')];
    const items = generateMonthItems({
      month: '2026-12',
      templates: [template],
      allVersions: versions,
      debts: [debt],
      existingItems: [],
    });
    expect(items).toHaveLength(0);
  });
});

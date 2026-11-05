export type Month = `${number}-${number}`;
export type LocalDate = `${number}-${number}-${number}`;
export type JarKind = 'spending' | 'saving';
export type TemplateKind = 'income' | 'expense' | 'transfer_to_saving' | 'debt_payment';
export type TransactionType = 'income' | 'expense' | 'transfer_in' | 'transfer_out';
export type PlanStatus = 'open' | 'closed';

export interface Jar {
  id: number;
  name: string;
  kind: JarKind;
  parentId: number | null;
  monthlyBudget: number | null;
  openingBalance: number;
  archived: boolean;
}

export interface RecurringTemplate {
  id: number;
  name: string;
  kind: TemplateKind;
  jarId: number | null;
  debtId: number | null;
  frequency: 'monthly' | 'once' | 'custom';
  dayOfMonth: number | null;
  startMonth: Month;
  endMonth: Month | null;
  autoRepeat: boolean;
  note: string | null;
}

export interface TemplateVersion {
  id: number;
  templateId: number;
  amount: number;
  effectiveFrom: Month;
}

export interface MonthPlan {
  id: number;
  month: Month;
  status: PlanStatus;
  closedAt: string | null;
  snapshotJson: string | null;
}

export interface PlannedItem {
  id: number;
  month: Month;
  templateId: number | null;
  name: string;
  kind: TemplateKind;
  jarId: number | null;
  debtId: number | null;
  expectedAmount: number;
  expectedDay: number | null;
  skipped: boolean;
  note: string | null;
  isOverridden: boolean;
}

export interface Transaction {
  id: number;
  date: LocalDate;
  amount: number;
  type: TransactionType;
  jarId: number | null;
  plannedItemId: number | null;
  description: string;
  note: string | null;
  deletedAt: string | null;
}

export interface Debt {
  id: number;
  name: string;
  currentBalance: number | null;
  expectedMonthly: number;
  dueDay: number | null;
  interestRate: number | null;
  status: 'active' | 'paid_off';
}

export interface Settings {
  accountOpeningBalance: number;
  accountOpeningDate: LocalDate;
  schemaVersion: number;
}

// ponytail: Stage 0 defines data contract; add only operations required by tested Stage 1 rules.
export interface Repository {
  getSettings(): Settings;
  listJars(): Jar[];
  listTemplates(): RecurringTemplate[];
  listTemplateVersions(templateId: number): TemplateVersion[];
}

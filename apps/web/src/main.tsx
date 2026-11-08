import { createRoot } from "react-dom/client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import "./style.css";

type Tab = "dashboard" | "finance" | "transactions" | "goals" | "journal" | "settings";
type IncomeSource = { id: number; name: string; archived: boolean };
type Dashboard = { asOf: string; available: number; availableAfterObligations: number; totalSaving: number; income: number; expense: number; fixedExpense: number; savingTransfer: number; totalDebt: number; unknownDebtCount: number; pendingObligations: number; pendingDebtObligations: number; disclaimer: string; jars: { id: number; name: string; kind: string; total: number }[]; sources: (IncomeSource & { total: number })[]; history: { month: string; income: number; expense: number; savingTransfer: number; netSaving: number }[] };
type Jar = {
  id: number;
  name: string;
  kind: "spending" | "saving";
  parent_id: number | null;
  monthly_budget: number | null;
  opening_balance: number;
  archived: boolean;
};
type Item = {
  id: number;
  templateId?: number | null;
  debtId: number | null;
  name: string;
  kind: string;
  expectedAmount: number;
  expectedDay: number | null;
  skipped: boolean;
  paymentStatus: "unpaid" | "partial" | "paid" | "skipped";
  paid: number;
  remaining: number;
};
type Txn = {
  id: number;
  date: string;
  amount: number;
  type: string;
  jar_id: number | null;
  planned_item_id: number | null;
  income_source_id: number | null;
  description: string;
  note: string | null;
};
type Debt = {
  id: number;
  name: string;
  current_balance: number | null;
  expected_monthly: number | null;
  due_day: number | null;
  interest_rate: number | null;
  status: string;
};
type Summary = {
  expectedIncome: number;
  actualExpense: number;
  pendingObligations: number;
  availableAfterObligations: number;
  unallocated: number;
};
type MonthData = { plan: { status: "open" | "closed" }; items: Item[] };
type Target = { id: number; name: string; target_amount: number; sort_order: number; spent_at: string | null; actual_amount: number | null; withdrawal_txn_id: number | null; expense_txn_id: number | null };
type Template = { id: number; name: string; kind: string; day_of_month: number | null; start_month: string; end_month: string | null; versions: { amount: number; effective_from: string }[] };
type AccountSettings = { account_opening_balance: number; account_opening_date: string };

const API = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const today = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" });
const monthNow = today().slice(0, 7);
const money = (value: number) =>
  `${new Intl.NumberFormat("vi-VN").format(value)}đ`;
const monthLabel = (month: string) =>
  new Intl.DateTimeFormat("vi-VN", { month: "long", year: "numeric" }).format(
    new Date(`${month}-01T00:00:00`),
  );
const api = async <T,>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Không thể kết nối máy chủ.");
  return body as T;
};

function parseQuickEntry(value: string) {
  const match = value.trim().match(/^(\d+(?:[.,]\d+)?)(k|tr|m)?(?:\s+(.+))?$/i);
  if (!match) return null;
  const unit = match[2]?.toLowerCase();
  const number = match[1];
  const raw = Number(!unit && /^\d{1,3}(?:\.\d{3})+$/.test(number) ? number.replaceAll(".", "") : number.replace(",", "."));
  const amount = Math.round(
    raw *
      (unit === "tr" || unit === "m" ? 1_000_000 : unit === "k" ? 1_000 : 1),
  );
  return amount > 0 ? { amount, description: match[3]?.trim() ?? "" } : null;
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<Element | null>(null);
  const titleId = useId();

  useEffect(() => {
    triggerRef.current = document.activeElement;
    const el = ref.current;
    if (!el) return;
    el.showModal();
    return () => {
      el.close();
      (triggerRef.current as HTMLElement | null)?.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="po-modal po-surface"
      aria-labelledby={titleId}
      onClose={(e) => { e.stopPropagation(); onClose(); }}
      onCancel={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="po-modal-head">
        <h2 id={titleId} className="po-section-title">{title}</h2>
        <button className="po-icon-button" onClick={onClose} aria-label="Đóng">×</button>
      </div>
      {children}
    </dialog>
  );
}

function ConfirmStep({
  message,
  onConfirm,
  onCancel,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="po-form">
      <p className="po-note" style={{ margin: 0 }}>{message}</p>
      <div className="confirm-dialog-actions">
        <button className="po-button po-button--quiet" type="button" onClick={onCancel}>Hủy</button>
        <button className="po-button po-button--primary" type="button" onClick={onConfirm}>Xác nhận</button>
      </div>
    </div>
  );
}

function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [month, setMonth] = useState(monthNow);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [sources, setSources] = useState<IncomeSource[]>([]);
  const [data, setData] = useState<MonthData | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [balance, setBalance] = useState<{
    available: number;
    totalSaving: number;
    disclaimer: string;
  } | null>(null);
  const [jars, setJars] = useState<Jar[]>([]);
  const [transactions, setTransactions] = useState<Txn[]>([]);
  const [allTransactions, setAllTransactions] = useState<Txn[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [flexibleJarId, setFlexibleJarId] = useState<number | null>(null);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [accountSettings, setAccountSettings] = useState<AccountSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [undoId, setUndoId] = useState<number | null>(null);
  const [paying, setPaying] = useState<Item | null>(null);
  const [spending, setSpending] = useState(false);
  const [earning, setEarning] = useState(false);
  const [manage, setManage] = useState(false);
  const [confirmMonthAction, setConfirmMonthAction] = useState(false);
  const loadVersion = useRef(0);
  const load = async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    setError("");
    try {
      const m = await api<MonthData>(`/api/months/${month}`);
      const [s, b, j, t, all, d, tg, dash, src, account] = await Promise.all([
        api<Summary>(`/api/months/${month}/summary`),
        api<typeof balance>("/api/balances"),
        api<Jar[]>("/api/jars"),
        api<Txn[]>(`/api/transactions?month=${month}`),
        api<Txn[]>("/api/transactions"),
        api<Debt[]>("/api/debts"),
        api<{ flexibleJarId: number; targets: Target[] }>("/api/financial-targets"),
        api<Dashboard>("/api/dashboard"),
        api<IncomeSource[]>("/api/income-sources"),
        api<AccountSettings>("/api/settings"),
      ]);
      if (version !== loadVersion.current) return;
      setData(m);
      setSummary(s);
      setBalance(b);
      setJars(j);
      setTransactions(t);
      setAllTransactions(all);
      setDebts(d);
      setTargets(tg.targets);
      setFlexibleJarId(tg.flexibleJarId);
      setDashboard(dash);
      setSources(src);
      setAccountSettings(account);
    } catch (e) {
      if (version === loadVersion.current) setError(e instanceof Error ? e.message : "Không tải được dữ liệu.");
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [month]);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => { setToast(""); setUndoId(null); }, 3500);
    return () => window.clearTimeout(id);
  }, [toast]);
  const closeOrReopen = async () => {
    if (!data) return;
    try {
      await api(
        `/api/months/${month}/${data.plan.status === "open" ? "close" : "reopen"}`,
        { method: "POST" },
      );
      setToast(
        data.plan.status === "open" ? "Đã chốt tháng." : "Đã mở lại tháng.",
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể cập nhật tháng.");
    }
  };
  const deleteTxn = async (id: number) => {
    try {
      await api(`/api/transactions/${id}`, { method: "DELETE" });
      setToast("Đã xóa giao dịch.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể xóa giao dịch.");
    }
  };

  const tabLabels: Record<Tab, string> = {
    dashboard: "Dashboard",
    finance: "Tài chính tháng",
    transactions: "Giao dịch",
    goals: "Mục tiêu",
    journal: "Nhật ký",
    settings: "Cài đặt",
  };
  const tabIcons: Record<Tab, string> = {
    dashboard: "◎",
    finance: "₫",
    transactions: "↕",
    goals: "◎",
    journal: "▤",
    settings: "⚙",
  };

  return (
    <div className="app-shell po-canvas">
      {/* Desktop sidebar */}
      <nav className="po-side-nav" aria-label="Điều hướng chính">
        <div className="po-app-brand po-side-brand-gap">
          <span className="po-brand-mark" aria-hidden="true" />
          <span className="po-brand-label">Personal OS</span>
        </div>
        {(["dashboard", "finance", "transactions", "goals", "journal", "settings"] as Tab[]).map((id) => (
          <button
            key={id}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            {tabLabels[id]}
          </button>
        ))}
        <div className="po-side-nav-footer">
          <button className="po-button po-button--quiet" type="button" onClick={() => setEarning(true)}>+ Ghi thu nhập</button>
          <button className="po-button po-button--primary" type="button" onClick={() => setSpending(true)}>+ Ghi chi tiêu</button>
        </div>
      </nav>

      {/* Main workspace */}
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <strong>{tabLabels[tab]}</strong>
            <span className="po-note">{monthLabel(monthNow)} · Tài khoản cá nhân</span>
          </div>
          <div className="quick-actions">
            <button className="po-button secondary-only-desktop" onClick={() => setEarning(true)}>+ Ghi thu nhập</button>
            <button className="po-button po-button--primary" onClick={() => setSpending(true)}>+ Ghi chi tiêu</button>
          </div>
        </header>
        <main className="content">
          {tab === "finance" && (
            <div className="month-row">
              <button
                className="po-button po-button--quiet"
                aria-label="Tháng trước"
                onClick={() => shiftMonth(setMonth, month, -1)}
              >←</button>
              <label className="po-month-picker">
                <span className="po-note">Đang xem</span>
                <input
                  className="po-month-nav-hidden"
                  type="month"
                  aria-label="Chọn tháng"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                />
                <strong className="po-month-nav-label">{monthLabel(month)}</strong>
              </label>
              <button
                className="po-button po-button--quiet"
                aria-label="Tháng sau"
                onClick={() => shiftMonth(setMonth, month, 1)}
              >→</button>
            </div>
          )}
          {loading ? (
            <Loading />
          ) : error ? (
            <ErrorState message={error} retry={load} />
          ) : tab === "dashboard" && dashboard ? (
            <DashboardView data={dashboard} />
          ) : tab === "transactions" ? (
            <TransactionsView transactions={allTransactions} sources={sources} jars={jars} targets={targets} onDelete={deleteTxn} onRefresh={load} onToast={setToast} onError={setError} />
          ) : tab === "goals" ? (
            <GoalsView />
          ) : tab === "journal" ? (
            <JournalView />
          ) : tab === "settings" ? (
            <><AccountPanel settings={accountSettings} onRefresh={load} /><BackupPanel onRefresh={load} onToast={setToast} /><JarsView jars={jars} onRefresh={load} /><TemplateManager jars={jars} debts={debts} month={month} onRefresh={load} /><PlannedPurchases jars={jars} transactions={allTransactions} targets={targets} flexibleJarId={flexibleJarId} onRefresh={load} /><DebtManager debts={debts} onRefresh={load} /><SourceManager sources={sources} onRefresh={load} /></>
          ) : data && summary && balance ? (
            <FinanceView
              key={month}
              data={data}
              summary={summary}
              balance={balance}
              jars={jars}
              debts={debts}
              month={month}
              transactions={transactions}
              targets={targets}
              onPay={setPaying}
              onDelete={deleteTxn}
              onRefresh={load}
              onSpend={() => setSpending(true)}
              onManage={() => setManage(true)}
              onClose={() => setConfirmMonthAction(true)}
              onToast={setToast}
              onError={setError}
            />
          ) : (
            <EmptyState />
          )}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="po-bottom-nav" aria-label="Điều hướng chính">
        {(["dashboard", "finance", "transactions", "goals", "journal", "settings"] as Tab[]).map((id) => (
          <button
            key={id}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            <span className="po-nav-icon" aria-hidden="true">{tabIcons[id]}</span>
            <span className="po-nav-label">{id === "finance" ? "Tài chính" : tabLabels[id]}</span>
          </button>
        ))}
      </nav>

      {paying && (
        <PayModal
          item={paying}
          onClose={() => setPaying(null)}
          onDone={async (message) => {
            setPaying(null);
            setToast(message);
            await load();
          }}
        />
      )}
      {spending && (
        <SpendModal
          jars={jars.filter((j) => j.kind === "spending" && !j.archived)}
          transactions={allTransactions}
          onClose={() => setSpending(false)}
          onDone={async (message) => {
            setSpending(false);
            setToast(message);
            await load();
          }}
          onUndoReady={setUndoId}
        />
      )}
      {earning && <IncomePanel sources={sources} onClose={() => setEarning(false)} onDone={async () => { setEarning(false); setToast("Đã ghi thu nhập."); await load(); }} />}
      {manage && (
        <ManagePanel
          jars={jars}
          items={data?.items ?? []}
          month={month}
          onClose={() => setManage(false)}
          onDone={async (message) => {
            setManage(false);
            setToast(message);
            await load();
          }}
          onError={setError}
        />
      )}
      {confirmMonthAction && data && summary && <Modal title={data.plan.status === "open" ? `Tổng kết ${monthLabel(month)}` : `Mở lại ${monthLabel(month)}?`} onClose={() => setConfirmMonthAction(false)}>
        <div className="po-form"><p>Thu nhập dự kiến: {money(summary.expectedIncome)} · Chi thực tế: {money(summary.actualExpense)} · Nghĩa vụ còn lại: {money(summary.pendingObligations)}.</p>
          {data.plan.status === "closed" && <p className="po-status po-status--warning">Số dư các tháng sau có thể thay đổi khi sửa giao dịch tháng này.</p>}
          <div className="po-form-actions"><button className="po-button po-button--quiet" onClick={() => setConfirmMonthAction(false)}>Hủy</button>
          <button className="po-button po-button--primary" onClick={() => { setConfirmMonthAction(false); void closeOrReopen(); }}>{data.plan.status === "open" ? "Chốt tháng" : "Mở lại tháng"}</button></div>
        </div>
      </Modal>}
      {toast && (
        <div className="po-toast" role="status">
          {toast}
          {undoId !== null && <button className="po-row-action" onClick={async () => {
            const id = undoId;
            setUndoId(null);
            await deleteTxn(id);
          }}>Hoàn tác</button>}
        </div>
      )}
    </div>
  );
}

function shiftMonth(set: (m: string) => void, month: string, delta: number) {
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const index = year * 12 + monthNumber - 1 + delta;
  set(`${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`);
}

function PlannedPurchases({ jars, transactions, targets, flexibleJarId, onRefresh }: {
  jars: Jar[]; transactions: Txn[]; targets: Target[]; flexibleJarId: number | null; onRefresh: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [buying, setBuying] = useState<Target | null>(null);
  const [actual, setActual] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [date, setDate] = useState(today());
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<Target | null>(null);
  const flexible = jars.find((jar) => jar.id === flexibleJarId);
  const balance = flexible ? flexible.opening_balance + transactions
    .filter((txn) => txn.jar_id === flexible.id && txn.date <= today())
    .reduce((sum, txn) => sum + (txn.type === "transfer_in" ? txn.amount : txn.type === "transfer_out" ? -txn.amount : 0), 0) : 0;
  const pending = targets.filter((target) => !target.spent_at);
  const completed = targets.filter((target) => target.spent_at);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const path = editing ? `/api/financial-targets/${editing}` : "/api/financial-targets";
      await api(path, { method: editing ? "PATCH" : "POST", body: JSON.stringify({ name: name.trim(), amount: Number(amount) }) });
      setName(""); setAmount(""); setEditing(null); setError(""); await onRefresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không lưu được khoản dự kiến."); }
  };
  const act = async (path: string, options: RequestInit) => {
    try { await api(path, options); setError(""); await onRefresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không cập nhật được khoản dự kiến."); }
  };
  const move = (target: Target, direction: number) => {
    const index = pending.findIndex((item) => item.id === target.id);
    const next = index + direction;
    if (next < 0 || next >= pending.length) return;
    const ids = [...pending, ...completed].map((item) => item.id);
    [ids[index], ids[next]] = [ids[next], ids[index]];
    void act("/api/financial-targets/order", { method: "PUT", body: JSON.stringify({ ids }) });
  };
  const purchase = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!buying) return;
    try {
      await api(`/api/financial-targets/${buying.id}/purchase`, { method: "POST", body: JSON.stringify({ date, amount: Number(actual) }) });
      setBuying(null); setError(""); await onRefresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không ghi được khoản chi."); }
  };
  const deposit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!flexibleJarId) return;
    try {
      await api("/api/transactions", { method: "POST", body: JSON.stringify({
        date: today(), amount: Number(depositAmount), type: "transfer_in", jarId: flexibleJarId,
        description: "Chuyển vào hũ Linh động",
      }) });
      setDepositAmount(""); setError(""); await onRefresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không chuyển được tiền vào hũ."); }
  };
  return <section className="po-section">
    <div className="po-section-heading"><h2>Dự kiến chi</h2><strong className="po-amount">Hũ Linh động: {money(balance)}</strong></div>
    <p className="po-note">Mỗi khoản được so riêng với số dư hũ. Thứ tự chỉ để cân nhắc, chưa giữ tiền.</p>
    {error && <p role="alert" className="po-status po-status--error">{error}</p>}
    <form className="po-inline-form" onSubmit={deposit}>
      <input className="po-input" aria-label="Số tiền chuyển vào hũ Linh động" required type="number" min="1" step="1" value={depositAmount} onChange={(event) => setDepositAmount(event.target.value)} placeholder="Số tiền góp vào hũ" />
      <button className="po-button" type="submit" disabled={!flexibleJarId}>Chuyển vào hũ</button>
    </form>
    <form className="po-inline-form" onSubmit={save}>
      <input className="po-input" aria-label="Tên khoản dự kiến" required value={name} onChange={(event) => setName(event.target.value)} placeholder="Ví dụ: Học tiếng Trung" />
      <input className="po-input" aria-label="Số tiền dự kiến" required type="number" min="1" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Số tiền" />
      <button className="po-button po-button--primary" type="submit">{editing ? "Lưu thay đổi" : "Thêm dự kiến"}</button>
      {editing && <button type="button" className="po-button po-button--quiet" onClick={() => { setEditing(null); setName(""); setAmount(""); }}>Hủy</button>}
    </form>
    {pending.length === 0 && <p className="po-note">Chưa có khoản dự kiến.</p>}
    <div className="planned-purchases">{pending.map((target) => <div className="target-row" key={target.id}>
      <div><strong>{target.name}</strong><p className="po-amount">{money(target.target_amount)} · {balance >= target.target_amount ? "Đã đủ tiền" : `Cần thêm ${money(target.target_amount - balance)}`}</p></div>
      <div className="target-actions">
        <button type="button" className="po-row-action" aria-label={`Đưa ${target.name} lên`} disabled={pending[0]?.id === target.id} onClick={() => move(target, -1)}>Lên</button>
        <button type="button" className="po-row-action" aria-label={`Đưa ${target.name} xuống`} disabled={pending[pending.length - 1]?.id === target.id} onClick={() => move(target, 1)}>Xuống</button>
        <button type="button" className="po-row-action" onClick={() => { setEditing(target.id); setName(target.name); setAmount(String(target.target_amount)); }}>Sửa</button>
        <button type="button" className="po-row-action" onClick={() => { setBuying(target); setActual(String(target.target_amount)); setDate(today()); }}>Ghi chi</button>
        <button type="button" className="po-row-action po-row-action--danger" onClick={() => setConfirmDelete(target)}>Xóa</button>
      </div>
    </div>)}</div>
    {completed.length > 0 && <><h3 className="po-manage-title">Đã thực hiện</h3><div className="planned-purchases">{completed.map((target) => <div className="target-row" key={target.id}>
      <div><strong>{target.name}</strong><p className="po-note">Dự kiến {money(target.target_amount)} · {target.actual_amount === null ? "Thiếu số thực chi" : `Đã chi ${money(target.actual_amount)}`} · {target.spent_at}</p></div>
      <button type="button" className="po-row-action" onClick={() => void act(`/api/financial-targets/${target.id}/undo`, { method: "POST", body: "{}" })}>Hoàn tác</button>
    </div>)}</div></>}
    {buying && <Modal title={`Ghi chi: ${buying.name}`} onClose={() => setBuying(null)}><form className="po-form" onSubmit={purchase}>
      {error && <p role="alert" className="po-status po-status--error">{error}</p>}
      <label>Số thực chi<input className="po-input" required type="number" min="1" step="1" value={actual} onChange={(event) => setActual(event.target.value)} /></label>
      <label>Ngày chi<input className="po-input" required type="date" max={today()} value={date} onChange={(event) => setDate(event.target.value)} /></label>
      <p className="po-note">Rút từ hũ Linh động và ghi chi tiêu một lần. Hũ phải đủ tiền.</p>
      <div className="po-form-actions"><button className="po-button po-button--primary" type="submit">Xác nhận ghi chi</button></div>
    </form></Modal>}
    {confirmDelete && <Modal title="Xóa khoản dự kiến" onClose={() => setConfirmDelete(null)}>
      <ConfirmStep
        message={`Xóa "${confirmDelete.name}"?`}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => { const t = confirmDelete; setConfirmDelete(null); void act(`/api/financial-targets/${t.id}`, { method: "DELETE" }); }}
      />
    </Modal>}
  </section>;
}

function DashboardView({ data }: { data: Dashboard }) {
  return <div>
    <div className="welcome"><div><p className="po-eyebrow">TỔNG QUAN</p><h1 className="po-welcome-h1">Hôm nay, sổ của bạn</h1><p className="po-note">Snapshot đến {data.asOf}</p></div></div>
    <div className="metrics">
      <div className="po-metric po-surface"><span>Khả dụng sau nghĩa vụ</span><strong className="po-amount">{money(data.availableAfterObligations)}</strong></div>
      <div className="po-metric po-surface po-metric--positive"><span>Tổng tiết kiệm</span><strong className="po-amount">{money(data.totalSaving)}</strong></div>
      <div className="po-metric po-surface"><span>Tổng đã chi</span><strong className="po-amount">{money(data.expense)}</strong></div>
    </div>
    <p className="po-disclaimer">{data.disclaimer}</p>
    <div className="po-split-stats">
      <div><span>Tổng thu nhập</span><strong className="po-amount">{money(data.income)}</strong></div>
      <div><span>Chi cố định xác nhận</span><strong className="po-amount">{money(data.fixedExpense)}</strong></div>
      <div><span>Chuyển tiết kiệm</span><strong className="po-amount">{money(data.savingTransfer)}</strong></div>
    </div>
    <section className="po-section">
      <div className="po-split-stats po-debt-overview-mb">
        <div><span>Tổng dư nợ đã biết</span><strong className="po-amount">{money(data.totalDebt)}</strong></div>
        <div><span>Nghĩa vụ trả nợ tháng này</span><strong className="po-amount">{money(data.pendingDebtObligations)}</strong></div>
        <div><span>Khả dụng sau nghĩa vụ</span><strong className="po-amount">{money(data.availableAfterObligations)}</strong></div>
        {data.unknownDebtCount > 0 && <div style={{ gridColumn: "1/-1" }}><p className="po-note">Chưa biết dư nợ: {data.unknownDebtCount} khoản. Không tính vào tổng dư nợ.</p></div>}
      </div>
    </section>
    <section className="po-section dashboard-grid">
      <div>
        <div className="po-section-heading"><h2>Theo tháng</h2><span>Thu nhập · chi tiêu · tiết kiệm ròng</span></div>
        <div className="history-table">
          <div className="history-head"><span>Tháng</span><span>Thu nhập</span><span>Chi tiêu</span><span>Tiết kiệm ròng</span></div>
          {data.history.map((row) => <div className="history-row" key={row.month}><strong>{monthLabel(row.month)}</strong><span className="po-amount">{money(row.income)}</span><span className="po-amount">{money(row.expense)}</span><b className="po-amount">{money(row.netSaving)}</b></div>)}
        </div>
      </div>
      <div>
        <div className="po-section-heading"><h2>Theo hũ</h2><span>Số liệu hiện tại</span></div>
        <div className="jar-list">{data.jars.map((jar) => <div className="jar-row po-surface" key={jar.id}><div className="jar-title"><strong>{jar.name}</strong><span className="po-note">{jar.kind === "saving" ? "Đang có" : "Đã chi"}</span></div><b className="po-amount">{money(jar.total)}</b></div>)}</div>
      </div>
    </section>
    <section className="po-section"><div className="po-section-heading"><h2>Xu hướng nhiều tháng</h2><span>Thu nhập so với chi tiêu</span></div>
      {data.history.slice(-6).map((row) => {
        const scale = Math.max(row.income, row.expense, 1);
        return <div className="po-list-row" key={row.month}><strong>{monthLabel(row.month)}</strong><div>
          <label className="po-note">Thu {money(row.income)}<progress value={row.income} max={scale} /></label>
          <label className="po-note">Chi {money(row.expense)}<progress value={row.expense} max={scale} /></label>
        </div></div>;
      })}
    </section>
    <section className="po-section">
      <div className="po-section-heading"><h2>Theo nguồn thu</h2><span>Nguồn đang dùng và lịch sử</span></div>
      <div className="jar-list">{data.sources.map((source) => <div className="jar-row po-surface" key={source.id}><div className="jar-title"><strong>{source.name}</strong><span className="po-note">{source.archived ? "Đã ẩn" : "Đang dùng"}</span></div><b className="po-amount">{money(source.total)}</b></div>)}</div>
    </section>
  </div>;
}

function TransactionsView({ transactions, sources, jars, targets, onDelete, onRefresh, onToast, onError }: {
  transactions: Txn[]; sources: IncomeSource[]; jars: Jar[]; targets: Target[]; onDelete: (id: number) => Promise<void>; onRefresh: () => Promise<void>; onToast: (m: string) => void; onError: (m: string) => void;
}) {
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [editingTxn, setEditingTxn] = useState<Txn | null>(null);
  const [query, setQuery] = useState("");
  const [filterMonth, setFilterMonth] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [filterJar, setFilterJar] = useState("");
  const visible = transactions.filter((txn) => (!query || txn.description.toLocaleLowerCase("vi").includes(query.toLocaleLowerCase("vi"))) &&
    (!filterMonth || txn.date.startsWith(filterMonth)) && (!filterDate || txn.date === filterDate) && (!filterJar || txn.jar_id === Number(filterJar)));
  const confirmTxn = confirmId !== null ? transactions.find((t) => t.id === confirmId) : null;
  return <section className="po-section">
    <div className="po-section-heading"><h2>Tất cả giao dịch</h2><span>{visible.length} giao dịch</span></div>
    <div className="po-inline-form"><input className="po-input" aria-label="Tìm nội dung" placeholder="Tìm nội dung" value={query} onChange={(event) => setQuery(event.target.value)} />
      <input className="po-input" aria-label="Lọc tháng" type="month" value={filterMonth} onChange={(event) => setFilterMonth(event.target.value)} />
      <input className="po-input" aria-label="Lọc ngày" type="date" value={filterDate} onChange={(event) => setFilterDate(event.target.value)} />
      <select className="po-input" aria-label="Lọc hũ" value={filterJar} onChange={(event) => setFilterJar(event.target.value)}><option value="">Mọi hũ</option>{jars.map((jar) => <option key={jar.id} value={jar.id}>{jar.name}</option>)}</select></div>
    {visible.length === 0 && <EmptyState compact />}
    <div className="txn-list">{visible.map((t) => <div className="txn-row" key={t.id}>
      <span className={`po-txn-dot${t.type === "income" ? " po-txn-dot--income" : t.type.startsWith("transfer") ? " po-txn-dot--transfer" : ""}`} aria-hidden="true" />
      <div>
        <strong>{t.description}</strong>
        <small className="po-note">{t.date}{t.type === "income" && t.income_source_id ? ` · ${sources.find((s) => s.id === t.income_source_id)?.name ?? "Nguồn đã ẩn"}` : ""}</small>
      </div>
      <b className={`po-amount${t.type === "income" ? " po-amount--positive" : ""}`}>{t.type === "income" ? "+" : "−"}{money(t.amount)}</b>
      {!targets.some((target) => target.withdrawal_txn_id === t.id || target.expense_txn_id === t.id) && <button className="po-row-action" onClick={() => setEditingTxn(t)}>Sửa</button>}
      {!t.planned_item_id && !targets.some((target) => target.withdrawal_txn_id === t.id || target.expense_txn_id === t.id) && <>
        <button className="po-icon-button" onClick={() => setConfirmId(t.id)} aria-label={`Xóa ${t.description}`}>×</button>
      </>}
    </div>)}</div>
    {confirmTxn && <Modal title="Xóa giao dịch" onClose={() => setConfirmId(null)}>
      <ConfirmStep
        message={`Xóa giao dịch "${confirmTxn.description}"?`}
        onCancel={() => setConfirmId(null)}
        onConfirm={async () => { setConfirmId(null); await onDelete(confirmTxn.id); }}
      />
    </Modal>}
    {editingTxn && <EditTxnModal txn={editingTxn} onClose={() => setEditingTxn(null)} onDone={async (msg) => { setEditingTxn(null); onToast(msg); await onRefresh(); }} onError={onError} />}
  </section>;
}

function EditTxnModal({ txn, onClose, onDone, onError }: { txn: Txn; onClose: () => void; onDone: (m: string) => Promise<void>; onError: (m: string) => void }) {
  const [amount, setAmount] = useState(String(txn.amount));
  const [date, setDate] = useState(txn.date);
  const [description, setDescription] = useState(txn.description);
  const [fieldError, setFieldError] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(amount);
    if (!Number.isInteger(n) || n <= 0) { setFieldError("Số tiền phải là số nguyên dương."); return; }
    if (!description.trim()) { setFieldError("Nội dung không được để trống."); return; }
    try {
      await api(`/api/transactions/${txn.id}`, {
        method: "PATCH",
        body: JSON.stringify(txn.planned_item_id ? { amount: n, date } : { amount: n, date, description: description.trim() }),
      });
      await onDone("Đã cập nhật giao dịch.");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Không thể sửa giao dịch.");
      onClose();
    }
  };
  return <Modal title="Sửa giao dịch" onClose={onClose}>
    <form className="po-form" onSubmit={submit}>
      {fieldError && <p role="alert" className="po-status po-status--error">{fieldError}</p>}
      {txn.planned_item_id && <p className="po-note">Thuộc khoản định kỳ. Xóa qua thao tác bỏ tick.</p>}
      <label>Số tiền (VND)<input className="po-input" required type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <label>Ngày<input className="po-input" required type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      {!txn.planned_item_id && <label>Nội dung<input className="po-input" required value={description} onChange={(e) => setDescription(e.target.value)} /></label>}
      <div className="po-form-actions">
        <button className="po-button po-button--quiet" type="button" onClick={onClose}>Hủy</button>
        <button className="po-button po-button--primary" type="submit">Lưu</button>
      </div>
    </form>
  </Modal>;
}

function downloadBackup(data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `personal-os-${today()}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function BackupPanel({ onRefresh, onToast }: { onRefresh: () => Promise<void>; onToast: (message: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState(false);
  const lastExport = localStorage.getItem("lastBackupExport");
  const overdue = !lastExport || Date.now() - Date.parse(lastExport) > 7 * 86400000;
  const exportData = async () => {
    try {
      downloadBackup(await api("/api/export"));
      localStorage.setItem("lastBackupExport", new Date().toISOString());
      setMessage("Đã tải bản sao lưu JSON.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Không thể xuất dữ liệu."); }
  };
  const importData = async () => {
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text()) as unknown;
      downloadBackup(await api("/api/export"));
      await api("/api/import", { method: "POST", body: JSON.stringify({ confirm: true, backup }) });
      setConfirm(false);
      setFile(null);
      onToast("Đã khôi phục dữ liệu.");
      await onRefresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Không thể khôi phục dữ liệu."); }
  };
  return <section className="po-section"><div className="po-section-heading"><h2>Sao lưu và khôi phục</h2></div>
    {overdue && <p className="po-status po-status--warning">Đã quá 7 ngày hoặc chưa xuất JSON. Hãy sao lưu dữ liệu.</p>}
    <div className="po-inline-form"><button className="po-button" onClick={() => void exportData()}>Xuất JSON</button>
      <input className="po-input" aria-label="Chọn file sao lưu" type="file" accept="application/json,.json" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      <button className="po-button" disabled={!file} onClick={() => setConfirm(true)}>Nhập JSON</button></div>
    {message && <p role="status" className="po-note">{message}</p>}
    {confirm && <Modal title="Ghi đè toàn bộ dữ liệu?" onClose={() => setConfirm(false)}><p>Bản hiện tại sẽ được tải xuống trước khi nhập. Hãy giữ file đó để hoàn tác nếu cần.</p>
      <div className="po-form-actions"><button className="po-button po-button--quiet" onClick={() => setConfirm(false)}>Hủy</button>
      <button className="po-button po-button--primary" onClick={() => void importData()}>Sao lưu rồi ghi đè</button></div></Modal>}
  </section>;
}

function AccountPanel({ settings, onRefresh }: { settings: AccountSettings | null; onRefresh: () => Promise<void> }) {
  const [amount, setAmount] = useState(String(settings?.account_opening_balance ?? ""));
  const [date, setDate] = useState(settings?.account_opening_date ?? "");
  const [message, setMessage] = useState("");
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await api("/api/settings", { method: "PATCH", body: JSON.stringify({ account_opening_balance: Number(amount), account_opening_date: date }) });
      setMessage("Đã lưu số dư đầu kỳ.");
      await onRefresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Không thể lưu."); }
  };
  return <section className="po-section"><div className="po-section-heading"><h2>Tài khoản chi tiêu</h2><span>V001 chỉ có một tài khoản</span></div>
    <form className="po-inline-form" onSubmit={(event) => void save(event)}><label>Số dư đầu kỳ<input className="po-input" type="number" min="0" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
      <label>Ngày bắt đầu<input className="po-input" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      <button className="po-button" type="submit">Lưu</button></form>{message && <p role="status" className="po-note">{message}</p>}
  </section>;
}

function TemplateManager({ jars, debts, month, onRefresh }: { jars: Jar[]; debts: Debt[]; month: string; onRefresh: () => Promise<void> }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("expense");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState("");
  const [jarId, setJarId] = useState("");
  const [debtId, setDebtId] = useState("");
  const [endMonths, setEndMonths] = useState<Record<number, string>>({});
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const refresh = async () => { try { setTemplates(await api("/api/templates")); } catch (cause) { setError(cause instanceof Error ? cause.message : "Không tải được khoản mẫu."); } };
  useEffect(() => { void refresh(); }, []);
  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (kind !== "income" && kind !== "debt_payment" && !jarId) { setError("Chọn hũ cho khoản mẫu."); return; }
    if (kind === "debt_payment" && !debtId) { setError("Chọn khoản nợ."); return; }
    try {
      await api("/api/templates", { method: "POST", body: JSON.stringify({ name, kind, amount: Number(amount), day_of_month: day ? Number(day) : null,
        jar_id: jarId ? Number(jarId) : null, debt_id: debtId ? Number(debtId) : null, frequency: "monthly", start_month: month, auto_repeat: true }) });
      setName(""); setAmount(""); setDay(""); setError(""); await refresh(); await onRefresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không tạo được khoản mẫu."); }
  };
  const end = async (template: Template) => {
    try {
      await api(`/api/templates/${template.id}`, { method: "PATCH", body: JSON.stringify({ scope: "from_month", month, end_month: endMonths[template.id] || null }) });
      setError(""); await refresh(); await onRefresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không dừng được khoản mẫu."); }
  };
  const changeAmount = async (template: Template) => {
    const amount = Number(amounts[template.id]);
    if (!Number.isSafeInteger(amount) || amount <= 0) { setError("Số tiền phải là số nguyên dương."); return; }
    try {
      await api(`/api/templates/${template.id}`, { method: "PATCH", body: JSON.stringify({ scope: "from_month", month, amount }) });
      setAmounts((current) => { const next = { ...current }; delete next[template.id]; return next; });
      setError(""); await refresh(); await onRefresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không đổi được số tiền khoản mẫu."); }
  };
  return <section className="po-section"><div className="po-section-heading"><h2>Khoản mẫu hằng tháng</h2><span>Thêm mới hoặc đặt tháng kết thúc</span></div>
    {error && <p role="alert" className="po-status po-status--error">{error}</p>}
    <form className="po-inline-form" onSubmit={(event) => void add(event)}>
      <input className="po-input" aria-label="Tên khoản mẫu" required placeholder="Tên khoản" value={name} onChange={(event) => setName(event.target.value)} />
      <select className="po-input" aria-label="Loại khoản mẫu" value={kind} onChange={(event) => { setKind(event.target.value); setJarId(""); setDebtId(""); }}>
        <option value="income">Thu nhập</option><option value="expense">Chi cố định</option><option value="transfer_to_saving">Chuyển tiết kiệm</option><option value="debt_payment">Trả nợ</option>
      </select>
      <input className="po-input" aria-label="Số tiền khoản mẫu" required type="number" min="1" step="1" placeholder="Số tiền" value={amount} onChange={(event) => setAmount(event.target.value)} />
      <input className="po-input" aria-label="Ngày dự kiến khoản mẫu" type="number" min="1" max="31" placeholder="Ngày trong tháng" value={day} onChange={(event) => setDay(event.target.value)} />
      {(kind === "expense" || kind === "transfer_to_saving") && <select className="po-input" aria-label="Hũ khoản mẫu" value={jarId} onChange={(event) => setJarId(event.target.value)}><option value="">Chọn hũ</option>{jars.filter((jar) => jar.kind === (kind === "expense" ? "spending" : "saving") && !jar.archived).map((jar) => <option key={jar.id} value={jar.id}>{jar.name}</option>)}</select>}
      {kind === "debt_payment" && <select className="po-input" aria-label="Nợ khoản mẫu" value={debtId} onChange={(event) => setDebtId(event.target.value)}><option value="">Chọn nợ</option>{debts.filter((debt) => debt.status === "active").map((debt) => <option key={debt.id} value={debt.id}>{debt.name}</option>)}</select>}
      <button className="po-button" type="submit">Thêm khoản mẫu</button>
    </form>
    {templates.map((template) => <div className="po-list-row template-row" key={template.id}><span><strong>{template.name}</strong><small className="po-note">Từ {template.start_month}; {template.versions.map((version) => `${version.effective_from}: ${money(version.amount)}`).join(" · ")}</small></span>
      <input className="po-input" type="number" min="1" step="1" aria-label={`Số tiền mới ${template.name} từ ${month}`} placeholder={`Từ ${month}`} value={amounts[template.id] ?? ""} onChange={(event) => setAmounts({ ...amounts, [template.id]: event.target.value })} />
      <button className="po-row-action" disabled={!amounts[template.id]} onClick={() => void changeAmount(template)}>Đổi từ tháng này</button>
      <input className="po-input" type="month" aria-label={`Tháng kết thúc ${template.name}`} value={endMonths[template.id] ?? template.end_month ?? ""} onChange={(event) => setEndMonths({ ...endMonths, [template.id]: event.target.value })} />
      <button className="po-row-action" onClick={() => void end(template)}>Lưu</button></div>)}
  </section>;
}

function JarsView({ jars, onRefresh }: { jars: Jar[]; onRefresh: () => Promise<void> }) {
  const [withdrawJar, setWithdrawJar] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [selected, setSelected] = useState<number[]>([]); const [showArchived, setShowArchived] = useState(false); const [name, setName] = useState(""); const [kind, setKind] = useState<"spending" | "saving">("spending"); const [drafts, setDrafts] = useState<Record<number, { name: string; budget: string }>>({}); const [error, setError] = useState("");
  const visible = jars.filter((jar) => jar.archived === showArchived);
  const save = async (jar: Jar) => { const draft = drafts[jar.id]; if (!draft) return; try { await api(`/api/jars/${jar.id}`, { method: "PATCH", body: JSON.stringify({ name: draft.name, monthly_budget: draft.budget ? Number(draft.budget) : null }) }); await onRefresh(); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Không lưu được hũ."); } };
  const add = async (event: React.FormEvent) => { event.preventDefault(); try { await api("/api/jars", { method: "POST", body: JSON.stringify({ name, kind }) }); setName(""); setError(""); await onRefresh(); } catch (e) { setError(e instanceof Error ? e.message : "Không thêm được hũ."); } };
  const archive = async () => { if (selected.length) { try { await api("/api/jars/bulk-archive", { method: "POST", body: JSON.stringify({ ids: selected }) }); setSelected([]); setError(""); await onRefresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Không ẩn được hũ."); } } };
  return <section className="po-section"><div className="po-section-heading"><h2>{showArchived ? "Đã ẩn" : "Đang dùng"}</h2><button className="po-button po-button--quiet" onClick={() => setShowArchived(!showArchived)}>{showArchived ? "Xem đang dùng" : "Xem đã ẩn"}</button></div>{error && <p role="alert" className="po-status po-status--error">{error}</p>}<form className="po-inline-form" onSubmit={add}><input className="po-input" required placeholder="Tên hũ mới" value={name} onChange={(e) => setName(e.target.value)} /><select className="po-input" value={kind} onChange={(e) => setKind(e.target.value as "spending" | "saving")}><option value="spending">Chi tiêu</option><option value="saving">Tiết kiệm</option></select><button className="po-button po-button--primary" type="submit">+ Thêm hũ</button></form>{!showArchived && selected.length > 0 && <button className="po-button po-button--quiet" onClick={() => void archive()}>Ẩn {selected.length} hũ</button>}<div className="jar-table">{visible.map((jar) => <div className="jar-manage-row" key={jar.id}><input type="checkbox" aria-label={`Chọn ${jar.name}`} checked={selected.includes(jar.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, jar.id] : selected.filter((id) => id !== jar.id))} /><input aria-label={`Tên ${jar.name}`} value={drafts[jar.id]?.name ?? jar.name} onChange={(e) => setDrafts({ ...drafts, [jar.id]: { name: e.target.value, budget: drafts[jar.id]?.budget ?? String(jar.monthly_budget ?? "") } })} /><input aria-label={`Ngân sách ${jar.name}`} type="number" min="0" value={drafts[jar.id]?.budget ?? jar.monthly_budget ?? ""} placeholder="Ngân sách" onChange={(e) => setDrafts({ ...drafts, [jar.id]: { name: drafts[jar.id]?.name ?? jar.name, budget: e.target.value } })} /><span className="po-note">{jar.kind === "saving" ? "Tiết kiệm" : "Chi tiêu"}</span><button className="po-row-action" onClick={() => void (showArchived ? api(`/api/jars/${jar.id}`, { method: "PATCH", body: JSON.stringify({ archived: false }) }).then(onRefresh) : save(jar))}>{showArchived ? "Hiện lại" : "Lưu"}</button></div>)}</div>
    <h3>Rút từ hũ tiết kiệm</h3><form className="po-inline-form" onSubmit={async (event) => { event.preventDefault(); try { await api("/api/transactions", { method: "POST", body: JSON.stringify({ date: today(), amount: Number(withdrawAmount), type: "transfer_out", jarId: Number(withdrawJar), description: "Rút tiết kiệm" }) }); setWithdrawAmount(""); await onRefresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Không rút được."); } }}>
      <select className="po-input" required aria-label="Hũ tiết kiệm" value={withdrawJar} onChange={(event) => setWithdrawJar(event.target.value)}><option value="">Chọn hũ</option>{jars.filter((jar) => jar.kind === "saving" && !jar.archived).map((jar) => <option key={jar.id} value={jar.id}>{jar.name}</option>)}</select>
      <input className="po-input" required aria-label="Số tiền rút" type="number" min="1" step="1" value={withdrawAmount} onChange={(event) => setWithdrawAmount(event.target.value)} />
      <button className="po-button" type="submit">Rút về tài khoản</button></form>
  </section>;
}

function IncomePanel({ sources, onClose, onDone }: { sources: IncomeSource[]; onClose: () => void; onDone: () => Promise<void> }) {
  const [amount, setAmount] = useState(""); const [date, setDate] = useState(today()); const [sourceId, setSourceId] = useState(String(sources.find((s) => !s.archived)?.id ?? "")); const [description, setDescription] = useState(""); const [newSource, setNewSource] = useState(""); const [fieldError, setFieldError] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldError("");
    try {
      let id = sourceId ? Number(sourceId) : null;
      if (newSource.trim()) id = (await api<IncomeSource>("/api/income-sources", { method: "POST", body: JSON.stringify({ name: newSource.trim() }) })).id;
      await api("/api/transactions", { method: "POST", body: JSON.stringify({ date, amount: Number(amount), type: "income", incomeSourceId: id, description: description.trim() || "Thu nhập" }) });
      await onDone();
    } catch (e) { setFieldError(e instanceof Error ? e.message : "Không ghi được thu nhập."); }
  };
  return <Modal title="Ghi thu nhập" onClose={onClose}><form className="po-form" onSubmit={submit}>
    {fieldError && <p role="alert" className="po-status po-status--error">{fieldError}</p>}
    <label>Số tiền<input className="po-input" autoFocus required type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
    <label>Ngày<input className="po-input" required type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
    <label>Nguồn thu<select className="po-input" value={sourceId} onChange={(e) => setSourceId(e.target.value)}><option value="">Không chọn nguồn</option>{sources.filter((s) => !s.archived).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <label>Tạo nguồn mới<input className="po-input" value={newSource} onChange={(e) => setNewSource(e.target.value)} placeholder="Ví dụ: Dự án nhỏ" /></label>
    <label>Ghi chú<input className="po-input" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
    <div className="po-form-actions">
      <button className="po-button po-button--quiet" type="button" onClick={onClose}>Hủy</button>
      <button className="po-button po-button--primary" type="submit">Lưu thu nhập</button>
    </div>
  </form></Modal>;
}

function SourceManager({ sources, onRefresh }: { sources: IncomeSource[]; onRefresh: () => Promise<void> }) {
  const [name, setName] = useState(""); const [drafts, setDrafts] = useState<Record<number, string>>({}); const [error, setError] = useState("");
  const add = async (event: React.FormEvent) => { event.preventDefault(); try { await api("/api/income-sources", { method: "POST", body: JSON.stringify({ name }) }); setName(""); setError(""); await onRefresh(); } catch (e) { setError(e instanceof Error ? e.message : "Không tạo được nguồn thu."); } };
  const update = async (source: IncomeSource, body: object) => { try { await api(`/api/income-sources/${source.id}`, { method: "PATCH", body: JSON.stringify(body) }); setError(""); await onRefresh(); } catch (e) { setError(e instanceof Error ? e.message : "Không cập nhật được nguồn thu."); } };
  return <section className="po-section"><div className="po-section-heading"><h2>Nguồn thu nhập</h2><span>Tên nguồn vẫn giữ trong lịch sử khi ẩn</span></div>{error && <p className="po-status po-status--error" role="alert">{error}</p>}<form className="po-inline-form" onSubmit={add}><input className="po-input" required value={name} placeholder="Tên nguồn mới" onChange={(e) => setName(e.target.value)} /><button className="po-button po-button--primary" type="submit">+ Thêm nguồn</button></form><div className="jar-table">{sources.map((source) => <div className="source-row" key={source.id}><input aria-label={`Tên nguồn ${source.name}`} value={drafts[source.id] ?? source.name} onChange={(e) => setDrafts({ ...drafts, [source.id]: e.target.value })} /><button className="po-row-action" onClick={() => void update(source, { name: drafts[source.id] ?? source.name })}>Lưu</button><button className="po-row-action" onClick={() => void update(source, { archived: !source.archived })}>{source.archived ? "Hiện lại" : "Ẩn"}</button></div>)}</div></section>;
}

function DebtManager({ debts, onRefresh }: { debts: Debt[]; onRefresh: () => Promise<void> }) {
  const [rows, setRows] = useState(debts);
  useEffect(() => setRows(debts), [debts]);
  const [name, setName] = useState("");
  const [balance, setBalance] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<{ id: number; date: string; amount: number; description: string }[]>([]);
  const [historyId, setHistoryId] = useState<number | null>(null);
  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await api("/api/debts", { method: "POST", body: JSON.stringify({ name: name.trim(), current_balance: balance ? Number(balance) : null }) });
      setName(""); setBalance(""); setError(""); await onRefresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Không tạo được khoản nợ."); }
  };
  const save = async (debt: Debt) => {
    try {
      await api(`/api/debts/${debt.id}`, { method: "PATCH", body: JSON.stringify({ name: debt.name, current_balance: debt.current_balance, interest_rate: debt.interest_rate }) });
      setError(""); await onRefresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Không cập nhật được khoản nợ."); }
  };
  return <section className="po-section"><div className="po-section-heading"><h2>Các khoản nợ</h2><span>Thiết lập một lần</span></div>
    <p className="po-note">Khai báo tên và dư nợ hiện tại ở đây. Số tiền trả từng tháng cấu hình trong kế hoạch của tháng đó.</p>
    {error && <p className="po-status po-status--error" role="alert">{error}</p>}
    <form className="po-inline-form" onSubmit={add}><input className="po-input" required placeholder="Ví dụ: Thẻ tín dụng" value={name} onChange={(e) => setName(e.target.value)} /><input className="po-input" type="number" min="0" placeholder="Dư nợ hiện tại" value={balance} onChange={(e) => setBalance(e.target.value)} /><button className="po-button po-button--primary" type="submit">+ Thêm khoản nợ</button></form>
    <div className="debt-list">{rows.map((debt) => <div className="debt-row po-surface" key={debt.id}><input aria-label={`Tên khoản nợ ${debt.name}`} value={debt.name} onChange={(e) => setRows(rows.map((x) => x.id === debt.id ? { ...x, name: e.target.value } : x))} /><input aria-label={`Dư nợ ${debt.name}`} type="number" min="0" placeholder="Chưa biết dư nợ" value={debt.current_balance ?? ""} onChange={(e) => setRows(rows.map((x) => x.id === debt.id ? { ...x, current_balance: e.target.value ? Number(e.target.value) : null } : x))} /><input aria-label={`Lãi suất ${debt.name}`} type="number" min="0" step="any" placeholder="Lãi suất (%)" value={debt.interest_rate ?? ""} onChange={(e) => setRows(rows.map((x) => x.id === debt.id ? { ...x, interest_rate: e.target.value ? Number(e.target.value) : null } : x))} /><button className="po-row-action" onClick={() => void save(debt)}>Lưu</button><button className="po-row-action" onClick={async () => { try { setHistory(await api(`/api/debts/${debt.id}/history`)); setHistoryId(debt.id); } catch (cause) { setError(cause instanceof Error ? cause.message : "Không tải được lịch sử."); } }}>Lịch sử</button><small className="po-note">{debt.current_balance === null ? "Chưa biết dư nợ" : `Còn ${money(debt.current_balance)}`}</small></div>)}</div>
    {historyId && <Modal title="Lịch sử trả nợ" onClose={() => setHistoryId(null)}>{history.length === 0 ? <p>Chưa có giao dịch trả nợ.</p> : history.map((item) => <div className="po-list-row" key={item.id}><span>{item.date} · {item.description}</span><strong>{money(item.amount)}</strong></div>)}</Modal>}
  </section>;
}

function MonthlyDebtPlan({ month, debts, items, closed, onRefresh, onPay }: { month: string; debts: Debt[]; items: Item[]; closed: boolean; onRefresh: () => Promise<void>; onPay: (item: Item) => void }) {
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const save = async (debt: Debt, item: Item | undefined) => {
    const text = drafts[debt.id] ?? (item && !item.skipped ? String(item.expectedAmount) : "");
    const amount = Number(text);
    if (!text || !Number.isSafeInteger(amount) || amount <= 0) { setError(`Nhập số tiền trả tháng này cho ${debt.name}.`); return; }
    try {
      if (item) await api(`/api/planned-items/${item.id}`, { method: "PATCH", body: JSON.stringify({ scope: "this_month", amount, skipped: false }) });
      else await api("/api/planned-items", { method: "POST", body: JSON.stringify({ month, name: `Trả ${debt.name}`, kind: "debt_payment", debt_id: debt.id, amount, expected_day: debt.due_day }) });
      setError(""); await onRefresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Không lưu được kế hoạch trả nợ."); }
  };
  const skip = async (item: Item) => {
    try { await api(`/api/planned-items/${item.id}`, { method: "PATCH", body: JSON.stringify({ scope: "this_month", skipped: true }) }); setError(""); await onRefresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Không bỏ qua được khoản nợ."); }
  };
  return <section className="po-section"><div className="po-section-heading"><h2>{`Trả nợ ${monthLabel(month)}`}</h2><span>Mỗi khoản một số tiền riêng trong tháng</span></div>
    {error && <p role="alert" className="po-status po-status--error">{error}</p>}
    {debts.length === 0 && <p className="po-note">Chưa có khoản nợ. Thêm trong Cài đặt trước.</p>}
    <div className="monthly-debts">{debts.filter((debt) => debt.status === "active" || items.some((item) => item.debtId === debt.id)).map((debt) => {
      const item = items.find((entry) => entry.debtId === debt.id);
      return <div className="monthly-debt-row" key={debt.id}><div><strong>{debt.name}</strong><small className="po-note">{debt.current_balance === null ? "Chưa biết dư nợ" : `Còn ${money(debt.current_balance)}`}{item?.skipped ? " · Bỏ qua tháng này" : ""}</small></div><label>Số tiền trả tháng này<input type="number" min="1" step="1" disabled={closed || debt.status === "paid_off"} placeholder="Nhập số tiền" value={drafts[debt.id] ?? (item && !item.skipped ? item.expectedAmount : "")} onChange={(e) => setDrafts({ ...drafts, [debt.id]: e.target.value })} /></label><button className="po-button" disabled={closed || debt.status === "paid_off"} onClick={() => void save(debt, item)}>Lưu kế hoạch</button>{item && !item.skipped && item.paid === 0 && <button className="po-row-action" disabled={closed} onClick={() => void skip(item)}>Không trả tháng này</button>}{item && !item.skipped && item.remaining > 0 && <button className="po-row-action" disabled={closed} onClick={() => onPay(item)}>Ghi đã trả</button>}</div>;
    })}</div>
  </section>;
}

function FinanceView({
  data,
  summary,
  balance,
  jars,
  debts,
  month,
  transactions,
  targets,
  onPay,
  onDelete,
  onRefresh,
  onSpend,
  onManage,
  onClose,
  onToast,
  onError,
}: {
  data: MonthData;
  summary: Summary;
  balance: { available: number; totalSaving: number; disclaimer: string };
  jars: Jar[];
  debts: Debt[];
  month: string;
  transactions: Txn[];
  targets: Target[];
  onPay: (i: Item) => void;
  onDelete: (id: number) => Promise<void>;
  onRefresh: () => Promise<void>;
  onSpend: () => void;
  onManage: () => void;
  onClose: () => void;
  onToast: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [confirmDeleteTxnId, setConfirmDeleteTxnId] = useState<number | null>(null);
  const [editingTxn, setEditingTxn] = useState<Txn | null>(null);
  const [jarDetail, setJarDetail] = useState<Jar | null>(null);
  const [savingTransfer, setSavingTransfer] = useState(false);
  const [savingJarId, setSavingJarId] = useState("");
  const [savingAmount, setSavingAmount] = useState("");
  const [savingDate, setSavingDate] = useState(today());
  const [savingError, setSavingError] = useState("");
  const spendingJars = jars.filter((j) => j.kind === "spending" && !j.archived);
  const topLevelJars = spendingJars.filter((jar) => jar.parent_id === null);
  const used = useMemo(
    () =>
      new Map(
        spendingJars.map((j) => [
          j.id,
          transactions
            .filter((t) => t.type === "expense" && (t.jar_id === j.id || spendingJars.some((child) => child.parent_id === j.id && child.id === t.jar_id)))
            .reduce((n, t) => n + t.amount, 0),
        ]),
      ),
    [spendingJars, transactions],
  );
  const confirmDeleteTxn = confirmDeleteTxnId !== null ? transactions.find((t) => t.id === confirmDeleteTxnId) : null;
  return (
    <>
      <div className="welcome">
        <div>
          <p className="po-eyebrow">{data.plan.status === "closed" ? "THÁNG ĐÃ CHỐT" : "THÁNG ĐANG MỞ"}</p>
          <h1 className="po-welcome-h1">Tài chính</h1>
        </div>
        <div className="quick-actions">
          <button className="po-button" onClick={onManage}>Thiết lập tháng</button>
          <button className="po-pill po-pill--active" onClick={onClose}>{data.plan.status === "open" ? "Chốt tháng" : "Mở lại"}</button>
          {data.plan.status === "open" && <button className="po-button" onClick={() => setSavingTransfer(true)}>Chuyển phần dư vào tiết kiệm</button>}
        </div>
      </div>
      <section className="metrics" aria-label="Tổng quan tài chính">
        <div className="po-metric po-surface"><span>Còn có thể chi</span><strong className="po-amount">{money(summary.availableAfterObligations)}</strong></div>
        <div className="po-metric po-surface"><span>Khả dụng thực tế</span><strong className="po-amount">{money(balance.available)}</strong></div>
        <div className="po-metric po-surface po-metric--positive"><span>Tổng tiết kiệm</span><strong className="po-amount">{money(balance.totalSaving)}</strong></div>
      </section>
      <p className="po-disclaimer">{balance.disclaimer}</p>
      <div className="po-split-stats">
        <div><span>Thu nhập dự kiến</span><strong className="po-amount">{money(summary.expectedIncome)}</strong></div>
        <div><span>Thu nhập chưa nhận</span><strong>{data.items.filter((item) => item.kind === "income" && item.paid === 0).map((item) => item.name).join(", ") || "Không có"}</strong></div>
        <div><span>Nghĩa vụ còn lại</span><strong className="po-amount">{money(summary.pendingObligations)}</strong></div>
        <div><span>Chi tiêu tháng</span><strong className="po-amount">{money(summary.actualExpense)}</strong></div>
      </div>
      <MonthlyDebtPlan month={month} debts={debts} items={data.items} closed={data.plan.status === "closed"} onRefresh={onRefresh} onPay={onPay} />
      <section className="po-section">
        <div className="po-section-heading"><h2>Cần thanh toán</h2><span>{data.items.length} khoản</span></div>
        {data.items.length === 0 ? (
          <EmptyState compact />
        ) : (
          <div className="planned-list">
            {data.items.map((item) => (
              <PlannedRow
                key={item.id}
                item={item}
                onPay={onPay}
                onRefresh={onRefresh}
              />
            ))}
          </div>
        )}
      </section>
      <section className="po-section">
        <div className="po-section-heading"><h2>Hũ chi tiêu</h2><span>Theo tháng</span></div>
        {spendingJars.length === 0 ? (
          <EmptyState compact />
        ) : (
          <div className="jar-list">
            {topLevelJars.map((j) => {
              const children = spendingJars.filter((child) => child.parent_id === j.id);
              return children.length ? <details key={j.id}><summary>{j.name} · {money(used.get(j.id) ?? 0)}</summary>
                <JarRow jar={j} used={used.get(j.id) ?? 0} onView={() => setJarDetail(j)} />
                {children.map((child) => <JarRow key={child.id} jar={child} used={used.get(child.id) ?? 0} onView={() => setJarDetail(child)} />)}
              </details> : <JarRow key={j.id} jar={j} used={used.get(j.id) ?? 0} onView={() => setJarDetail(j)} />;
            })}
          </div>
        )}
      </section>
      <section className="po-section">
        <div className="po-section-heading"><h2>Giao dịch gần đây</h2><span>{transactions.length} giao dịch</span></div>
        {transactions.length === 0 ? (
          <EmptyState compact />
        ) : (
          <div className="txn-list">
            {transactions.slice(0, 8).map((t) => (
              <div className="txn-row" key={t.id}>
                <span className={`po-txn-dot${t.type === "income" ? " po-txn-dot--income" : t.type.startsWith("transfer") ? " po-txn-dot--transfer" : ""}`} aria-hidden="true" />{" "}
                <div>
                  <strong>{t.description}</strong>
                  <small className="po-note">
                    {t.date}
                    {t.planned_item_id ? " · Khoản định kỳ" : ""}
                  </small>
                </div>
                <b className={`po-amount${t.type === "income" ? " po-amount--positive" : ""}`}>
                  {t.type === "income" ? "+" : "−"}
                  {money(t.amount)}
                </b>
                {!targets.some((target) => target.withdrawal_txn_id === t.id || target.expense_txn_id === t.id) && <button className="po-row-action" onClick={() => setEditingTxn(t)}>Sửa</button>}
                {!t.planned_item_id && !targets.some((target) => target.withdrawal_txn_id === t.id || target.expense_txn_id === t.id) && (
                  <>
                    <button
                      className="po-icon-button"
                      aria-label={`Xóa ${t.description}`}
                      onClick={() => setConfirmDeleteTxnId(t.id)}
                    >×</button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
      <button className="po-fab" onClick={onSpend}>
        <span aria-hidden="true">＋</span> Ghi chi tiêu
      </button>
      {confirmDeleteTxn && <Modal title="Xóa giao dịch" onClose={() => setConfirmDeleteTxnId(null)}>
        <ConfirmStep
          message={`Xóa giao dịch "${confirmDeleteTxn.description}"?`}
          onCancel={() => setConfirmDeleteTxnId(null)}
          onConfirm={async () => { setConfirmDeleteTxnId(null); await onDelete(confirmDeleteTxn.id); }}
        />
      </Modal>}
      {editingTxn && <EditTxnModal txn={editingTxn} onClose={() => setEditingTxn(null)} onDone={async (msg) => { setEditingTxn(null); onToast(msg); await onRefresh(); }} onError={onError} />}
      {jarDetail && <Modal title={`Giao dịch hũ ${jarDetail.name}`} onClose={() => setJarDetail(null)}>
        {transactions.filter((txn) => txn.type === "expense" && (txn.jar_id === jarDetail.id || spendingJars.some((child) => child.parent_id === jarDetail.id && child.id === txn.jar_id))).map((txn) =>
          <div className="po-list-row" key={txn.id}><span>{txn.date} · {txn.description}</span><strong>{money(txn.amount)}</strong></div>)}
      </Modal>}
      {savingTransfer && <Modal title="Chuyển phần dư vào tiết kiệm" onClose={() => setSavingTransfer(false)}>
        <form className="po-form" onSubmit={async (event) => { event.preventDefault(); if (!savingDate.startsWith(month)) { setSavingError("Ngày chuyển phải thuộc tháng đang xem."); return; } try {
          await api("/api/transactions", { method: "POST", body: JSON.stringify({ date: savingDate, amount: Number(savingAmount), type: "transfer_in", jarId: Number(savingJarId), description: "Chuyển phần dư vào tiết kiệm" }) });
          setSavingTransfer(false); setSavingAmount(""); onToast("Đã chuyển vào tiết kiệm."); await onRefresh();
        } catch (cause) { setSavingError(cause instanceof Error ? cause.message : "Không chuyển được."); } }}>
          <p className="po-note">Nhập số tiền bạn quyết định chuyển. Không tự lấy từ phần chưa phân bổ.</p>
          {savingError && <p role="alert" className="po-status po-status--error">{savingError}</p>}
          <label>Số tiền<input className="po-input" type="number" min="1" step="1" required value={savingAmount} onChange={(event) => setSavingAmount(event.target.value)} /></label>
          <label>Ngày chuyển<input className="po-input" type="date" required value={savingDate} onChange={(event) => setSavingDate(event.target.value)} /></label>
          <label>Hũ tiết kiệm<select className="po-input" required value={savingJarId} onChange={(event) => setSavingJarId(event.target.value)}><option value="">Chọn hũ</option>{jars.filter((jar) => jar.kind === "saving" && !jar.archived).map((jar) => <option key={jar.id} value={jar.id}>{jar.name}</option>)}</select></label>
          <button className="po-button po-button--primary" type="submit">Xác nhận chuyển</button>
        </form>
      </Modal>}
    </>
  );
}

function PlannedRow({
  item,
  onPay,
  onRefresh,
}: {
  item: Item;
  onPay: (i: Item) => void;
  onRefresh: () => Promise<void>;
}) {
  const [confirmUnpay, setConfirmUnpay] = useState(false);
  const [confirmUnpayForced, setConfirmUnpayForced] = useState<string | null>(null);
  const status = item.skipped
    ? "Bỏ qua"
    : item.paymentStatus === "paid"
      ? "Đã thanh toán"
      : item.paymentStatus === "partial"
        ? `Còn ${money(item.remaining)}`
        : "Chưa thanh toán";
  const handleCheck = () => {
    if (item.paymentStatus === "paid") setConfirmUnpay(true);
    else onPay(item);
  };
  const doUnpay = async (forced: boolean) => {
    try {
      await api(`/api/planned-items/${item.id}/unpay`, {
        method: "POST",
        body: JSON.stringify(forced ? { confirm: true } : {}),
      });
      await onRefresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Không thể bỏ tick.";
      if (!forced && message.includes("confirm=true")) {
        setConfirmUnpay(false);
        setConfirmUnpayForced(message);
      }
      // other errors: modal already closed, nothing else to do
    }
  };
  return (
    <div className={`planned-row ${item.paymentStatus}`}>
      <button
        className={`po-check${item.paymentStatus === "paid" ? " po-check--done" : ""}`}
        aria-label={`${status}: ${item.name}`}
        onClick={handleCheck}
      >
        {item.paymentStatus === "paid" ? "✓" : ""}
      </button>
      <div className="planned-main">
        <strong>{item.name}</strong>
        <small className="po-note">
          {item.expectedDay ? `Ngày ${item.expectedDay} · ` : ""}
          {status} · Đã ghi {money(item.paid)}
        </small>
      </div>
      <b className="po-amount">{money(item.expectedAmount)}</b>
      <button className="po-row-action" onClick={() => onPay(item)}>
        {item.paymentStatus === "paid" ? "Thêm" : "Trả"}
      </button>
      {confirmUnpay && <Modal title="Bỏ tick thanh toán" onClose={() => setConfirmUnpay(false)}>
        <ConfirmStep
          message={`Bỏ tick "${item.name}"? Giao dịch liên kết sẽ bị xóa.`}
          onCancel={() => setConfirmUnpay(false)}
          onConfirm={async () => { setConfirmUnpay(false); await doUnpay(false); }}
        />
      </Modal>}
      {confirmUnpayForced && <Modal title="Xác nhận bỏ tick" onClose={() => setConfirmUnpayForced(null)}>
        <ConfirmStep
          message={`${confirmUnpayForced}\n\nXác nhận bỏ tick?`}
          onCancel={() => setConfirmUnpayForced(null)}
          onConfirm={async () => { setConfirmUnpayForced(null); await doUnpay(true); }}
        />
      </Modal>}
    </div>
  );
}

function JarRow({ jar, used, onView }: { jar: Jar; used: number; onView: () => void }) {
  const budget = jar.monthly_budget ?? 0;
  const percent = budget ? Math.min(130, Math.round((used / budget) * 100)) : 0;
  return (
    <div className="jar-row po-surface">
      <div className="jar-title">
        <strong>{jar.name}</strong>
        <span className="po-note">
          {budget ? `${money(used)} / ${money(budget)}` : money(used)}
        </span>
      </div>
      {budget > 0 && (
        <div className={`po-progress${percent > 100 ? " po-progress--over" : ""}`}>
          <i style={{ width: `${Math.min(100, percent)}%` }} />
        </div>
      )}
      {percent > 100 && (
        <small className="po-status po-status--warning">Vượt ngân sách {money(used - budget)}</small>
      )}
      <button className="po-row-action" onClick={onView}>Xem giao dịch</button>
    </div>
  );
}

function PayModal({
  item,
  onClose,
  onDone,
}: {
  item: Item;
  onClose: () => void;
  onDone: (m: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState(item.remaining || item.expectedAmount);
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFieldError("");
    try {
      await api(`/api/planned-items/${item.id}/pay`, {
        method: "POST",
        body: JSON.stringify({
          amount: Number(amount),
          date,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      await onDone("Đã ghi thanh toán.");
    } catch (e) {
      setFieldError(e instanceof Error ? e.message : "Không thể ghi thanh toán.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Thanh toán · ${item.name}`} onClose={onClose}>
      <form onSubmit={submit} className="po-form">
        {fieldError && <p role="alert" className="po-status po-status--error">{fieldError}</p>}
        <label>
          Số tiền
          <input
            className="po-input"
            autoFocus
            type="number"
            min="1"
            step="1"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
        </label>
        <label>
          Ngày thanh toán
          <input
            className="po-input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <div className="po-form-actions">
          <button className="po-button po-button--quiet" type="button" onClick={onClose}>Hủy</button>
          <button className="po-button po-button--primary" disabled={busy}>
            {busy ? "Đang lưu…" : "Xác nhận thanh toán"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SpendModal({
  jars,
  transactions,
  onClose,
  onDone,
  onUndoReady,
}: {
  jars: Jar[];
  transactions: Txn[];
  onClose: () => void;
  onDone: (m: string) => Promise<void>;
  onUndoReady: (id: number) => void;
}) {
  const [text, setText] = useState("");
  const [date, setDate] = useState(today());
  const [jarId, setJarId] = useState(
    Number(localStorage.getItem("lastJarId") || jars[0]?.id || 0),
  );
  const [jarChosen, setJarChosen] = useState(false);
  const [confirmData, setConfirmData] = useState<{ amount: number; description: string } | null>(null);
  const [fieldError, setFieldError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const parsed = parseQuickEntry(text);
  const keyword = parsed?.description.toLocaleLowerCase("vi").trim() ?? "";
  useEffect(() => {
    if (jarChosen || !keyword) return;
    const similar = transactions.find((txn) => txn.type === "expense" && txn.jar_id !== null &&
      jars.some((jar) => jar.id === txn.jar_id) && txn.description.toLocaleLowerCase("vi").includes(keyword));
    if (similar?.jar_id) setJarId(similar.jar_id);
  }, [keyword, jarChosen, transactions, jars]);
  const selectedJar = jars.find((jar) => jar.id === jarId);
  const budgetJar = jars.find((jar) => jar.id === selectedJar?.parent_id) ?? selectedJar;
  const monthSpent = transactions.filter((txn) => txn.type === "expense" && txn.date.slice(0, 7) === date.slice(0, 7) &&
    (txn.jar_id === budgetJar?.id || jars.some((jar) => jar.parent_id === budgetJar?.id && jar.id === txn.jar_id)))
    .reduce((sum, txn) => sum + txn.amount, 0);
  const exceedsBudget = budgetJar?.monthly_budget != null && monthSpent + (confirmData?.amount ?? 0) > budgetJar.monthly_budget;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!parsed) return;
    setConfirmData({ amount: parsed.amount, description: parsed.description || "Chi tiêu" });
  };

  const confirmAndSave = async () => {
    if (!confirmData) return;
    setConfirmData(null);
    setFieldError("");
    try {
      const saved = await api<{ id: number }>("/api/transactions", {
        method: "POST",
        body: JSON.stringify({
          date,
          amount: confirmData.amount,
          type: "expense",
          jarId: jarId || null,
          description: confirmData.description,
        }),
      });
      localStorage.setItem("lastJarId", String(jarId));
      onUndoReady(saved.id);
      await onDone("Đã lưu giao dịch.");
    } catch (e) {
      setFieldError(e instanceof Error ? e.message : "Không thể lưu giao dịch.");
    }
  };

  return (
    <Modal title="Ghi chi tiêu" onClose={onClose}>
      <form onSubmit={handleSubmit} className="po-form">
        {fieldError && <p role="alert" className="po-status po-status--error">{fieldError}</p>}
        <label>
          Nhập nhanh
          <input
            className="po-input"
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="35k cafe"
            aria-describedby="quick-help"
          />
        </label>
        <small id="quick-help" className="po-note">
          Ví dụ: 35k cafe · 35.000 cà phê · 1tr tiền nhà
        </small>
        {parsed && (
          <div className="po-parse-preview">
            <strong className="po-amount">{money(parsed.amount)}</strong>
            <span className="po-note">{parsed.description || "Chi tiêu"}</span>
          </div>
        )}
        <label>
          Ngày
          <input
            className="po-input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label>
          Hũ
          <select
            className="po-input"
            value={jarId}
            onChange={(e) => { setJarChosen(true); setJarId(Number(e.target.value)); }}
          >
            {jars.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </select>
        </label>
        <div className="po-form-actions">
          <button className="po-button po-button--quiet" type="button" onClick={onClose}>Hủy</button>
          <button className="po-button po-button--primary" disabled={!parsed}>
            Xem và xác nhận
          </button>
        </div>
      </form>
      {confirmData && (
        <Modal title="Xác nhận chi tiêu" onClose={() => setConfirmData(null)}>
          <div className="po-form">
            <div className="po-parse-preview">
              <strong className="po-amount">{money(confirmData.amount)}</strong>
              <span className="po-note">{confirmData.description}</span>
            </div>
            {exceedsBudget && <p className="po-status po-status--warning">Chi này vượt ngân sách {budgetJar?.name}. Vẫn có thể lưu.</p>}
            <div className="confirm-dialog-actions">
              <button className="po-button po-button--quiet" onClick={() => setConfirmData(null)}>Hủy</button>
              <button className="po-button po-button--primary" onClick={() => void confirmAndSave()}>Ghi chi tiêu</button>
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

function ManagePanel({
  jars,
  items,
  month,
  onClose,
  onDone,
  onError,
}: {
  jars: Jar[];
  items: Item[];
  month: string;
  onClose: () => void;
  onDone: (m: string) => Promise<void>;
  onError: (m: string) => void;
}) {
  const [local, setLocal] = useState(jars);
  const [amounts, setAmounts] = useState<Record<number, number>>({});
  const [itemNames, setItemNames] = useState<Record<number, string>>({});
  const [itemDays, setItemDays] = useState<Record<number, number | null>>({});
  const [itemScopes, setItemScopes] = useState<Record<number, "this_month" | "from_month">>({});
  const [newName, setNewName] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [newKind, setNewKind] = useState("expense");
  const [newJarId, setNewJarId] = useState("");
  const [confirmDeleteItem, setConfirmDeleteItem] = useState<Item | null>(null);
  const [panelError, setPanelError] = useState("");
  const saveJar = async (jar: Jar) => {
    try {
      await api(`/api/jars/${jar.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: jar.name,
          monthly_budget: jar.monthly_budget,
        }),
      });
      await onDone("Đã cập nhật hũ.");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Không thể cập nhật hũ.");
    }
  };
  const saveTemplate = async (item: Item) => {
    const amount = amounts[item.id];
    if (!amount && itemNames[item.id] === undefined && itemDays[item.id] === undefined) return;
    try {
      const scope = itemScopes[item.id] ?? "this_month";
      await api(`/api/planned-items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify(scope === "from_month" ? { scope, amount } :
          { scope, amount, name: itemNames[item.id], expected_day: itemDays[item.id] }),
      });
      await onDone("Đã cập nhật khoản tháng này.");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Không thể cập nhật khoản mẫu.");
    }
  };
  const addItem = async (event: React.FormEvent) => {
    event.preventDefault();
    setPanelError("");
    try {
      await api("/api/planned-items", { method: "POST", body: JSON.stringify({
        month, name: newName.trim(), kind: newKind, amount: Number(newAmount),
        jar_id: newJarId ? Number(newJarId) : null,
      }) });
      await onDone("Đã thêm khoản tháng này.");
    } catch (e) { setPanelError(e instanceof Error ? e.message : "Không thể thêm khoản."); }
  };
  const deleteItem = async (item: Item) => {
    try { await api(`/api/planned-items/${item.id}`, { method: "DELETE" }); await onDone("Đã xóa khoản."); }
    catch (e) { onError(e instanceof Error ? e.message : "Không thể xóa khoản."); }
  };
  return (
    <Modal title="Thiết lập" onClose={onClose}>
      <p className="po-note">
        Một tài khoản chi tiêu duy nhất. Dữ liệu tính toán vẫn lấy từ API.
      </p>
      {panelError && <p role="alert" className="po-status po-status--error">{panelError}</p>}
      <h3 className="po-manage-title">Hũ</h3>
      <div className="manage-list">
        {local.map((j) => (
          <div className="po-manage-row" key={j.id}>
            <input
              aria-label={`Tên hũ ${j.name}`}
              value={j.name}
              onChange={(e) =>
                setLocal(
                  local.map((x) =>
                    x.id === j.id ? { ...x, name: e.target.value } : x,
                  ),
                )
              }
            />
            <input
              aria-label={`Ngân sách ${j.name}`}
              type="number"
              min="0"
              value={j.monthly_budget ?? ""}
              placeholder="Ngân sách"
              onChange={(e) =>
                setLocal(
                  local.map((x) =>
                    x.id === j.id
                      ? {
                          ...x,
                          monthly_budget: e.target.value
                            ? Number(e.target.value)
                            : null,
                        }
                      : x,
                  ),
                )
              }
            />
            <button className="po-row-action" onClick={() => void saveJar(j)}>Lưu</button>
          </div>
        ))}
      </div>
      <h3 className="po-manage-title">Khoản khác trong {monthLabel(month)}</h3>
      <form className="target-form po-surface" onSubmit={addItem}>
        <label className="po-note" style={{ fontWeight: 600 }}>Tên khoản<input className="po-input" required value={newName} onChange={(e) => setNewName(e.target.value)} /></label>
        <label className="po-note" style={{ fontWeight: 600 }}>Số tiền<input className="po-input" required type="number" min="1" step="1" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} /></label>
        <label className="po-note" style={{ fontWeight: 600 }}>Loại<select className="po-input" value={newKind} onChange={(e) => { setNewKind(e.target.value); setNewJarId(""); }}><option value="expense">Chi cố định</option><option value="transfer_to_saving">Chuyển tiết kiệm</option><option value="income">Thu nhập</option></select></label>
        {newKind !== "income" && <label className="po-note" style={{ fontWeight: 600 }}>Hũ<select className="po-input" required value={newJarId} onChange={(e) => setNewJarId(e.target.value)}><option value="">Chọn hũ</option>{jars.filter((j) => j.kind === (newKind === "transfer_to_saving" ? "saving" : "spending") && !j.archived).map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}</select></label>}
        <div className="po-form-actions"><button className="po-button" type="submit">Thêm khoản</button></div>
      </form>
      <div className="manage-list">
        {items.filter((item) => item.kind !== "debt_payment").map((item) => (
          <div className="po-manage-row" key={item.id} style={{ gridTemplateColumns: item.templateId === null ? "1fr 110px 44px 44px" : undefined }}>
            <input aria-label={`Tên khoản ${item.name}`} value={itemNames[item.id] ?? item.name} onChange={(e) => setItemNames({ ...itemNames, [item.id]: e.target.value })} />
            <input
              aria-label={`Số tiền ${item.name}`}
              type="number"
              min="1"
              placeholder={String(item.expectedAmount)}
              onChange={(e) =>
                setAmounts({ ...amounts, [item.id]: Number(e.target.value) })
              }
            />
            {item.templateId !== null && <select className="po-input" aria-label={`Phạm vi sửa ${item.name}`} value={itemScopes[item.id] ?? "this_month"} onChange={(event) => setItemScopes({ ...itemScopes, [item.id]: event.target.value as "this_month" | "from_month" })}>
              <option value="this_month">Chỉ tháng này</option><option value="from_month">Từ tháng này</option>
            </select>}
            <button className="po-row-action" onClick={() => void saveTemplate(item)}>Lưu</button>
            {item.templateId === null && <button className="po-row-action po-row-action--danger" onClick={() => setConfirmDeleteItem(item)} aria-label={`Xóa ${item.name}`}>Xóa</button>}
          </div>
        ))}
      </div>
      {confirmDeleteItem && <Modal title="Xóa khoản" onClose={() => setConfirmDeleteItem(null)}>
        <ConfirmStep
          message={`Xóa "${confirmDeleteItem.name}"?`}
          onCancel={() => setConfirmDeleteItem(null)}
          onConfirm={async () => { const item = confirmDeleteItem; setConfirmDeleteItem(null); await deleteItem(item); }}
        />
      </Modal>}
    </Modal>
  );
}

type Goal = { id: number; title: string; type: "long" | "short"; status: "todo" | "doing" | "done" | "paused"; parent_goal_id: number | null; checklist_total: number; checklist_done: number };
type Checklist = { id: number; title: string; done: boolean };
type JournalEntry = { id: number; datetime: string; title: string; content: string; tags: string[]; goal_ids: number[] };

function GoalsView() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ checklist: Checklist[]; journal: JournalEntry[] } | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [type, setType] = useState<"long" | "short">("short");
  const [parentId, setParentId] = useState("");
  const [task, setTask] = useState("");
  const [error, setError] = useState("");
  const refresh = async () => {
    try {
      setGoals(await api<Goal[]>("/api/goals"));
      if (selected) setDetail(await api(`/api/goals/${selected}`));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không tải được mục tiêu."); }
  };
  useEffect(() => { void refresh(); }, [selected]);
  const action = async (path: string, method: string, body: unknown) => {
    try {
      await api(path, { method, body: JSON.stringify(body) });
      setError("");
      await refresh();
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không lưu được mục tiêu."); return false; }
  };
  return <div><section className="po-section"><div className="po-section-heading"><h2>Mục tiêu</h2><span>Tiến độ từ checklist đã hoàn thành</span></div>
    {error && <p role="alert" className="po-status po-status--error">{error}</p>}
    <form className="po-inline-form" onSubmit={(event) => { event.preventDefault(); void action("/api/goals", "POST", { title, type, description, start_date: startDate || null, due_date: dueDate || null, parent_goal_id: parentId ? Number(parentId) : null }).then((ok) => { if (ok) { setTitle(""); setDescription(""); setStartDate(""); setDueDate(""); } }); }}>
      <input className="po-input" required aria-label="Tên mục tiêu" placeholder="Mục tiêu mới" value={title} onChange={(event) => setTitle(event.target.value)} />
      <input className="po-input" aria-label="Mô tả mục tiêu" placeholder="Mô tả" value={description} onChange={(event) => setDescription(event.target.value)} />
      <input className="po-input" aria-label="Ngày bắt đầu mục tiêu" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
      <input className="po-input" aria-label="Hạn mục tiêu" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
      <select className="po-input" aria-label="Loại mục tiêu" value={type} onChange={(event) => setType(event.target.value as "long" | "short")}><option value="short">Ngắn hạn</option><option value="long">Dài hạn</option></select>
      <select className="po-input" aria-label="Mục tiêu cha" value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">Không có mục tiêu cha</option>{goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select>
      <button className="po-button po-button--primary" type="submit">Thêm mục tiêu</button>
    </form>
    <div className="jar-list">{goals.map((goal) => <button className="jar-row po-surface" key={goal.id} onClick={() => setSelected(goal.id)} aria-current={selected === goal.id ? "true" : undefined}>
      <span><strong>{goal.title}</strong><small className="po-note">{goal.type === "long" ? "Dài hạn" : "Ngắn hạn"}{goal.parent_goal_id ? ` · Thuộc ${goals.find((parent) => parent.id === goal.parent_goal_id)?.title ?? "mục tiêu cha"}` : ""}</small></span>
      <span className="po-note">{goal.checklist_done}/{goal.checklist_total} việc</span>
    </button>)}</div></section>
    {selected && detail && <section className="po-section"><div className="po-section-heading"><h2>{goals.find((goal) => goal.id === selected)?.title}</h2></div>
      <label>Trạng thái<select className="po-input" value={goals.find((goal) => goal.id === selected)?.status ?? "todo"} onChange={(event) => void action(`/api/goals/${selected}`, "PATCH", { status: event.target.value })}>
        <option value="todo">Chưa làm</option><option value="doing">Đang làm</option><option value="done">Hoàn thành</option><option value="paused">Tạm dừng</option></select></label>
      <form className="po-inline-form" onSubmit={(event) => { event.preventDefault(); void action(`/api/goals/${selected}/checklist`, "POST", { title: task }).then((ok) => { if (ok) setTask(""); }); }}>
        <input className="po-input" required aria-label="Việc cần làm" placeholder="Việc cần làm" value={task} onChange={(event) => setTask(event.target.value)} /><button className="po-button" type="submit">Thêm việc</button></form>
      {detail.checklist.map((item) => <label className="po-list-row" key={item.id}><span>{item.title}</span><input type="checkbox" checked={item.done} onChange={() => void action(`/api/checklist/${item.id}`, "PATCH", { done: !item.done })} /></label>)}
      <h3>Nhật ký liên quan</h3>{detail.journal.map((entry) => <div className="po-list-row" key={entry.id}><strong>{entry.title}</strong><span className="po-note">{new Date(entry.datetime).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</span></div>)}
    </section>}
  </div>;
}

function JournalView() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [goalId, setGoalId] = useState("");
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [summary, setSummary] = useState<{ months: { period: string; entries: number }[]; weeks: { period: string; entries: number }[] }>({ months: [], weeks: [] });
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [error, setError] = useState("");
  const refresh = async () => {
    try {
      const [journal, allGoals, stats] = await Promise.all([api<JournalEntry[]>(`/api/journal?month=${month}&q=${encodeURIComponent(query)}&tag=${encodeURIComponent(tagFilter)}`), api<Goal[]>("/api/goals"), api<typeof summary>("/api/journal/summary")]);
      setEntries(journal); setGoals(allGoals); setSummary(stats);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không tải được nhật ký."); }
  };
  useEffect(() => { void refresh(); }, [month, query, tagFilter]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await api("/api/journal", { method: "POST", body: JSON.stringify({ datetime: new Date().toISOString(), title, content,
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean), goalIds: goalId ? [Number(goalId)] : [] }) });
      setTitle(""); setContent(""); setTags(""); setGoalId(""); setError(""); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không lưu được nhật ký."); }
  };
  const visible = entries.filter((entry) => !day || new Date(entry.datetime).toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }) === day);
  const calendarMonth = month || monthNow;
  const [calendarYear, calendarNumber] = calendarMonth.split("-").map(Number);
  const calendarDays = new Date(Date.UTC(calendarYear, calendarNumber, 0)).getUTCDate();
  const entryCounts = new Map<string, number>();
  for (const entry of entries) {
    const date = new Date(entry.datetime).toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" });
    entryCounts.set(date, (entryCounts.get(date) ?? 0) + 1);
  }
  return <div><section className="po-section"><div className="po-section-heading"><h2>Nhật ký</h2><span>Nhiều bản ghi mỗi ngày</span></div>
    {error && <p role="alert" className="po-status po-status--error">{error}</p>}
    <form className="po-form" onSubmit={(event) => void save(event)}><label>Tiêu đề<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>Nội dung<textarea value={content} onChange={(event) => setContent(event.target.value)} /></label>
      <label>Tag, ngăn bằng dấu phẩy<input value={tags} onChange={(event) => setTags(event.target.value)} /></label>
      <label>Liên kết mục tiêu<select value={goalId} onChange={(event) => setGoalId(event.target.value)}><option value="">Không liên kết</option>{goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select></label>
      <div className="po-form-actions"><button className="po-button po-button--primary" type="submit">Ghi nhật ký</button></div></form>
  </section><section className="po-section"><div className="po-section-heading"><h2>Timeline và lịch</h2><span>{visible.length} bản ghi</span></div>
    <div className="po-inline-form"><input className="po-input" type="month" aria-label="Lọc tháng nhật ký" value={month} onChange={(event) => setMonth(event.target.value)} />
      <input className="po-input" type="date" aria-label="Lọc ngày nhật ký" value={day} onChange={(event) => { setDay(event.target.value); if (event.target.value) setMonth(event.target.value.slice(0, 7)); }} />
      <input className="po-input" aria-label="Tìm nhật ký" placeholder="Tìm nhật ký" value={query} onChange={(event) => setQuery(event.target.value)} />
      <input className="po-input" aria-label="Lọc tag nhật ký" placeholder="Tag" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)} /></div>
    <div className="journal-calendar" aria-label={`Lịch nhật ký ${calendarMonth}`}>
      {Array.from({ length: calendarDays }, (_, index) => {
        const date = `${calendarMonth}-${String(index + 1).padStart(2, "0")}`;
        const count = entryCounts.get(date) ?? 0;
        return <button className="po-button po-button--quiet" type="button" key={date} aria-pressed={day === date} onClick={() => { setMonth(calendarMonth); setDay(day === date ? "" : date); }}>{index + 1}{count > 0 ? ` · ${count}` : ""}</button>;
      })}
    </div>
    <p className="po-note">Tháng: {summary.months.map((item) => `${item.period} (${item.entries})`).join(" · ") || "Chưa có"}. Tuần: {summary.weeks.map((item) => `${item.period} (${item.entries})`).join(" · ") || "Chưa có"}.</p>
    {visible.map((entry) => <article className="po-surface po-metric" key={entry.id}><span>{new Date(entry.datetime).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</span><h3>{entry.title}</h3><p>{entry.content}</p>
      <small className="po-note">{entry.tags.join(", ")}{entry.goal_ids.map((id) => goals.find((goal) => goal.id === id)?.title).filter(Boolean).join(", ")}</small></article>)}
  </section></div>;
}

function Loading() {
  return (
    <div className="po-state">
      <div className="po-loader" aria-label="Đang tải" role="status" />
      <p>Đang đọc sổ tháng…</p>
    </div>
  );
}

function ErrorState({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  return (
    <div className="po-state">
      <span className="po-state-icon po-state-icon--error" aria-hidden="true">!</span>
      <h2>Không tải được tháng</h2>
      <p>{message}</p>
      <button className="po-button" onClick={retry}>
        Thử lại
      </button>
    </div>
  );
}

function EmptyState({ compact = false }: { compact?: boolean }) {
  return compact ? (
    <div className="po-empty-compact">
      <span aria-hidden="true">—</span>
      <p className="po-note po-empty-inline">Chưa có dữ liệu.</p>
    </div>
  ) : (
    <div className="po-state">
      <span className="po-state-icon" aria-hidden="true">—</span>
      <p>Chưa có dữ liệu cho tháng này.</p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

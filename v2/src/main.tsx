import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { monthlyGoalPoints } from "./monthly-goal";
import { byPoints, filterActivity } from "./activity-view";
import {OnboardingGate,requestKey} from './onboarding';
import {ParentRecovery,RecoveryReset} from './password-recovery';
type Member = {
  id: string;
  name: string;
  emoji: string;
  points: number;
  is_child: number;
};
type Item = {
  id: string;
  kind: "task" | "reward";
  title: string;
  value: number;
  emoji: string;
  category: string;
};
type Entry = {
  id: string;
  member_id: string;
  delta: number;
  label: string;
  kind: string;
  at: string;
  cancelled_by: string | null;
};
type Data = {
  role: "family" | "parent";
  members: Member[];
  catalog: Item[];
  history: Entry[];
  goals: { member_id: string; reward_id: string }[];
  familyGoal: number;
  familyName?: string;
};
type Dialog = {
  kind: string;
  title: string;
  memberId?: string;
  item?: Item;
  entry?: Entry;
  expectedBalance?: number;
  key: string;
};
class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const errors: Record<string, string> = {
  invalid_recovery_code: "קוד השחזור שגוי, נוצל או שפג תוקפו",
  login_required: "יש להיכנס מחדש למשפחה",
  incorrect_password: "סיסמה שגויה",
  parent_required: "פעולה זו זמינה להורה בלבד",
  try_again_later: "יותר מדי ניסיונות כניסה. נסו שוב בעוד 15 דקות",
  insufficient_points_or_invalid_balance: "אין מספיק נקודות לפעולה",
  already_cancelled_or_conflicting_action:
    "הפעולה כבר בוטלה או השתנתה. רעננו את היומן",
  balance_changed_refresh: "היתרה השתנתה ממכשיר אחר. רעננו לפני תיקון",
  authentication_not_configured: "הגדרת הכניסה עדיין לא הושלמה",
  invalid_number: "יש להזין מספר שלם בטווח המותר",
  balance_unchanged: "לא בוצע שינוי ביתרה",
  invalid_text: "יש למלא את כל השדות",
  password_too_short: "יש לבחור סיסמה באורך 4 תווים לפחות",
  invalid_password_role: "יש לבחור סיסמת משפחה או סיסמת הורה",
  item_not_found: "הפריט כבר אינו זמין",
  action_not_found: "הפעולה כבר אינה ביומן",
  invalid_cancellation: "לא ניתן לבטל פעולה זו",
  setup_required: "יש להשלים תחילה את הגדרת הבית",
  setup_login_required: "זמן ההגדרה הסתיים. היכנסו שוב עם סיסמת ההורה",
  setup_invitation_invalid: "קישור ההזמנה אינו תקף או שפג תוקפו. בקשו קישור חדש ממנהל האפליקציה",
  setup_unavailable: "ההזמנה כבר נוצלה או שההגדרה הסתיימה. רעננו להמשך",
  setup_changed_refresh: "הטיוטה השתנתה במכשיר אחר. רעננו כדי לטעון את הגרסה השמורה",
  setup_existing_data: "כבר קיימים נתונים בבית הזה. ההגדרה נעצרה כדי לשמור עליהם",
  invalid_setup_data: "בדקו שמות, סמלים וערכי נקודות. יש להשתמש במספרים שלמים בטווח המותר",
  duplicate_child_name: "יש לבחור שם שונה לכל ילד או ילדה",
  invalid_setup_password: "בחרו סיסמה באורך 4 עד 256 תווים, ללא רווחים בתחילתה או בסופה",
  passwords_must_differ: "סיסמת המשפחה צריכה להיות שונה מסיסמת ההורה",
  instance_binding_mismatch: "הבית אינו מחובר להגדרות הנכונות. פנו למנהל האפליקציה",
};
async function api(
  path: string,
  input?: unknown,
  key?: string,
  method?: string,
) {
  let response: Response;
  try {
    response = await fetch("/api" + path, {
      method: method || (input === undefined ? "GET" : "POST"),
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        ...(input === undefined ? {} : { "Content-Type": "application/json" }),
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: input === undefined ? undefined : JSON.stringify(input),
    });
  } catch {
    throw new Error(
      "לא ניתן להתחבר. בדקו את החיבור ונסו שוב; ניסיון חוזר לא יוסיף פעולה כפולה.",
    );
  }
  const result = await response.json();
  if (!response.ok)
    throw new ApiError(
      response.status,
      errors[result.error] || "לא ניתן להשלים את הפעולה. רעננו ונסו שוב.",
    );
  return result;
}
const n = (x: number) => x.toLocaleString("he-IL");
const tabs = [
  ["home", "🏠", "בית"],
  ["tasks", "✅", "משימות"],
  ["shop", "🎁", "פרסים"],
  ["history", "🕒", "היסטוריה"],
  ["admin", "⚙️", "ניהול"],
];
function Modal({
  dialog,
  busy,
  close,
  submit,
  children,
}: {
  dialog: Dialog;
  busy: boolean;
  close: () => void;
  submit: (form: HTMLFormElement) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      className="modal"
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
      aria-labelledby="dialogTitle"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(e.currentTarget);
        }}
      >
        <h2 id="dialogTitle">{dialog.title}</h2>
        {children}
        <div className="modalButtons">
          <button
            className="button"
            type="button"
            disabled={busy}
            onClick={close}
          >
            חזרה
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "שומר…" : "אישור"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
function App() {
  const [data, setData] = useState<Data | null>(null),
    [login, setLogin] = useState(false),
    [recovering,setRecovering] = useState(false),
    [parentLogin,setParentLogin] = useState(false),
    [loading, setLoading] = useState(true),
    [tab, setTab] = useState("home"),
    [historyExpanded, setHistoryExpanded] = useState(false),
    [historyFrom, setHistoryFrom] = useState(""),
    [historyTo, setHistoryTo] = useState(""),
    [historyType, setHistoryType] = useState("all"),
    [person, setPerson] = useState(""),
    [manage, setManage] = useState("task"),
    [category, setCategory] = useState("all"),
    [dialog, setDialog] = useState<Dialog | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function load() {
    try {
      const fresh: Data = await api("/state");
      setData(fresh);
      setLogin(false);
      setPerson((old) =>
        fresh.members.some((m) => m.id === old)
          ? old
          : fresh.members[0]?.id || "",
      );
      return fresh;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setLogin(true);
        setData(null);
        setDialog(null);
      } else throw e;
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    const timer = setInterval(() => {
      if (!document.hidden) void load().catch((e) => setError(e.message));
    }, 30000);
    const onVisible = () => {
      if (!document.hidden) void load().catch((e) => setError(e.message));
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  useEffect(() => {
    if (data?.role !== "parent" && tab === "admin") setTab("home");
  }, [data?.role, tab]);
  const m = data?.members.find((x) => x.id === person) || {id:"",name:"המשפחה",points:0,emoji:"⭐",is_child:1},
    parent = data?.role === "parent",
    rewards = byPoints(data?.catalog.filter((x) => x.kind === "reward") || []),
    tasks = byPoints(data?.catalog.filter((x) => x.kind === "task") || []),
    goal = rewards.find(
      (r) =>
        r.id === data?.goals.find((g) => g.member_id === person)?.reward_id,
    ),
    total = data?.members.reduce((sum, x) => sum + x.points, 0) || 0,
    monthlyPoints = monthlyGoalPoints(data?.history || []);
  const historySection = useRef<HTMLElement>(null);
  const visibleHistory = filterActivity(data?.history || [], {expanded:historyExpanded,from:historyFrom,to:historyTo,type:historyType});
  function toggleHistory() {
    if (historyExpanded) {
      setHistoryFrom(''); setHistoryTo('');
      requestAnimationFrame(() => historySection.current?.scrollIntoView({block:'start',behavior:'smooth'}));
    }
    setHistoryExpanded(value => !value);
  }
  const historyToggle = () => <button className="button" aria-expanded={historyExpanded} aria-controls="historyList" onClick={toggleHistory}>{historyExpanded ? "הצגת 8 ימים אחרונים ↑" : "הצגת 6 חודשים ↓"}</button>;
  const open = (kind: string, title: string, extra: Partial<Dialog> = {}) => {
    setError("");
    setNotice("");
    setDialog({
      kind,
      title,
      memberId: person,
      key: requestKey(),
      ...extra,
    });
  };
  const navigate = (value: string) => {
    setTab(value);
    setHistoryExpanded(false);
    setError("");
    setNotice("");
    window.scrollTo(0, 0);
  };
  async function execute(
    path: string,
    input: unknown,
    key?: string,
    method?: string,
  ) {
    await api(path, input, key, method);
    const fresh = await load();
    if (fresh) {
      setDialog(null);
      const current = fresh.members.find((x) => x.id === person);
      setNotice(
        goal &&
          m &&
          current &&
          m.points < goal.value &&
          current.points >= goal.value
          ? "🎉 הגעת ליעד! אפשר לבקש מהורה לממש את הפרס."
          : "הפעולה נשמרה ✓",
      );
    }
  }
  async function submit(form: HTMLFormElement) {
    if (!dialog || busy) return;
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(form));
    try {
      const { kind, memberId, item, entry, key } = dialog;
      if (kind === "parent") {
        await execute("/parent/login", { password: values.password });
        setTab("admin");
      }
      if (kind === "task" || kind === "reward")
        await execute(
          kind === "task" ? "/tasks/complete" : "/rewards/redeem",
          { memberId, itemId: item!.id },
          key,
        );
      if (kind === "cancel")
        await execute(
          "/history/cancel",
          { memberId: entry!.member_id, historyId: entry!.id },
          key,
        );
      if (kind === "adjust")
        await execute(
          "/balances/adjust",
          {
            memberId,
            balance: Number(values.balance),
            expectedBalance: Number(values.expected),
            reason: values.reason,
          },
          key,
        );
      if (kind === "familyGoal")
        await execute("/settings", { familyGoal: Number(values.familyGoal) });
      if (kind === "passwords") {
        if (values.newPassword !== values.confirmPassword) throw new Error("הסיסמאות אינן זהות");
        await execute('/passwords',{role:values.role,newPassword:values.newPassword});
        setNotice('הסיסמה עודכנה ✓');
      }
      if (kind === "catalog")
        await execute("/catalog", {
          id: item?.id || dialog.key,
          kind: manage,
          category: values.category || "chores",
          title: values.title,
          value: Number(values.value),
          emoji: values.emoji,
        });
      if (kind === "delete")
        await execute("/catalog", { id: item!.id }, undefined, "DELETE");
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && (e.status === 401 || e.status === 403))
        await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  async function selectGoal(item: Item) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await execute("/goals", { memberId: person, rewardId: item.id });
      setNotice("היעד נבחר! כל נקודה מקרבת אותך אליו 🎯");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const taskCard = (item: Item) => (
    <button
      key={item.id}
      className="task"
      disabled={busy}
      onClick={() => open("task", "איזה יופי! 🎉", { item })}
    >
      <span className="taskIcon">{item.emoji}</span>
      <h3>{item.title}</h3>
      <span className="taskFoot">
        <span className="pts">+{n(item.value)} נק׳</span>
        <span className="roundPlus">+</span>
      </span>
    </button>
  );
  function historyRows(rows: Entry[]) {
    return rows.length ? (
      rows.map((h) => {
        const who = data!.members.find((x) => x.id === h.member_id);
        return (
          <div className="historyItem" key={h.id}>
            <div className="historyLeft">
              <span className="historyIcon">
                {h.kind === "reward"
                  ? "🎁"
                  : h.kind === "undo"
                    ? "↩️"
                    : who?.emoji || "⭐"}
              </span>
              <div>
                <div className="historyName">{h.label}</div>
                <div className="historySub">
                  {who?.name} ·{" "}
                  {new Date(h.at).toLocaleString("he-IL", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
                {h.kind === "legacy" && (
                  <div className="actionHint">יובא מהמערכת הקודמת</div>
                )}
              </div>
            </div>
            <div className="historyActions">
              {h.cancelled_by ? (
                <span className="cancelledTag">בוטל</span>
              ) : (
                parent &&
                !["undo", "legacy"].includes(h.kind) && (
                  <button
                    className="textLink"
                    onClick={() =>
                      open("cancel", "↩️ ביטול פעולה", { entry: h })
                    }
                  >
                    ביטול פעולה
                  </button>
                )
              )}
              <span className={"delta " + (h.delta < 0 ? "neg" : "")}>
                {h.delta > 0 ? "+" : ""}
                {n(h.delta)}
              </span>
            </div>
          </div>
        );
      })
    ) : (
      <div className="empty">הפעילות תופיע כאן אחרי ביצוע משימה 🌟</div>
    );
  }
  function goalBanner() {
    if (!m?.is_child) return null;
    if (!goal)
      return (
        <section className="goalBanner">
          <span className="goalEmoji">🎯</span>
          <div className="goalCopy">
            <strong>מה הפרס הבא שלך, {m.name}?</strong>
            <p>בחרו פרס ונראה כמה נקודות נותרו כדי להגיע אליו!</p>
          </div>
          <button className="button" onClick={() => navigate("shop")}>
            בחירת יעד 🎁
          </button>
        </section>
      );
    const left = Math.max(0, goal.value - m.points),
      pct = Math.min(100, Math.round((m.points / goal.value) * 100));
    return (
      <section className="goalBanner">
        <span className="goalEmoji">{goal.emoji}</span>
        <div className="goalCopy">
          <div className="smallMuted">🎯 היעד שלי</div>
          <strong>{goal.title}</strong>
          <p>
            {left
              ? `עוד ${n(left)} נקודות לפרס שבחרת`
              : "הגעת ליעד! אפשר לבקש מהורה לממש את הפרס 🎉"}
          </p>
          <div className="goalNumbers">
            {n(m.points)} / {n(goal.value)} נקודות <span>{pct}%</span>
          </div>
          <div
            className="goalTrack"
            role="progressbar"
            aria-label="התקדמות ליעד"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div style={{ width: pct + "%" }} />
          </div>
          <span className="goalPhrase">
            {pct >= 75
              ? "כמעט שם! כל הכבוד על ההתקדמות 🌟"
              : "כל משימה קטנה מקרבת אותך לפרס 🌱"}
          </span>
        </div>
        <button className="button" onClick={() => navigate("shop")}>
          שינוי יעד
        </button>
      </section>
    );
  }
  if (recovering) return <RecoveryReset request={api} done={()=>{setRecovering(false);setData(null);setLogin(true);setLoading(false);}} />;
  if (loading)
    return (
      <div className="login card" role="status">
        טוען את הבית שלנו…
      </div>
    );
  if (login)
    return (
      <main className="login card">
        <div className="brand">
          <span className="brandIcon">🌱</span>הבית שלנו
        </div>
        <h1>ברוכים הבאים</h1>
        <p className="smallMuted">{parentLogin?"כניסה ישירה להורה עם סיסמת ההורה הפרטית.":"הזינו את סיסמת המשפחה כדי להיכנס."}</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            const form = e.currentTarget,
              password = new FormData(form).get("password");
            setBusy(true);
            setError("");
            try {
              await api(parentLogin?"/parent/login":"/login", { password });
              await load();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            {parentLogin?"סיסמת הורה":"סיסמת משפחה"}
            <input
              key={parentLogin?"parent":"family"}
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={256}
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary" disabled={busy}>
            {busy ? "נכנסים…" : parentLogin?"כניסת הורה":"כניסה למשפחה"}
          </button>
        </form>
        <button type="button" className="button recoveryLink" onClick={()=>{setParentLogin(!parentLogin);setError('');}}>{parentLogin?"חזרה לכניסת המשפחה":"כניסת הורה"}</button>
        <button type="button" className="button recoveryLink" onClick={()=>setRecovering(true)}>שכחתם את הסיסמה?</button>
      </main>
    );
  if (!data)
    return (
      <main className="login card">
        <p className="error" role="alert">
          {error || "לא ניתן לטעון נתונים"}
        </p>
        <button
          className="button"
          onClick={() => void load().catch((e) => setError(e.message))}
        >
          ניסיון חוזר
        </button>
      </main>
    );
  const visibleTabs = tabs.filter((t) => parent || t[0] !== "admin");
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <span className="brandIcon">🌱</span>
          <div>
            {data.familyName || 'הבית שלנו'}<small>FAMILY REWARDS</small>
          </div>
        </div>
        {visibleTabs.map(([id, icon, label]) => (
          <button
            className={"nav " + (tab === id ? "active" : "")}
            key={id}
            onClick={() => navigate(id)}
          >
            <span>{icon}</span>
            {label}
          </button>
        ))}
        <div className="sideBottom">
          <span className="smallMuted">כל משימה קטנה היא הצלחה 🌱</span>
          <button
            className="textLink"
            disabled={busy}
            onClick={async () => {
              try {
                await api("/logout", {});
                setData(null);
                setLogin(true);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            יציאה מהמשפחה
          </button>
        </div>
      </aside>
      <main className="content">
        <header className="topbar">
          <div>
            <div className="greet">כל משימה קטנה היא הצלחה גדולה 🌱</div>
            <h1 className="heading">
              {
                (
                  {
                    home: `היי ${m.name}! 👋`,
                    tasks: "המשימות שלנו",
                    shop: "חנות הפרסים",
                    history: "מה עשינו לאחרונה?",
                    admin: "ניהול המשפחה",
                  } as Record<string, string>
                )[tab]
              }
            </h1>
          </div>
          <div className="actions">
            <label className="personPicker">
              <select
                className="select"
                aria-label="בחירת ילד"
                value={person}
                onChange={(e) => setPerson(e.target.value)}
              >
                {data.members.map((x) => (
                  <option value={x.id} key={x.id}>
                    {x.emoji} {x.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button"
              disabled={busy}
              onClick={async () => {
                if (parent) {
                  setBusy(true);
                  try {
                    await api("/parent/logout", {});
                    await load();
                    setTab("home");
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                } else open("parent", "🔐 כניסת הורה");
              }}
            >
              {parent ? "🔒 יציאה ממצב הורה" : "🔐 כניסת הורה"}
            </button>
          </div>
        </header>
        {error && !dialog && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="success" role="status">
            {notice}
          </p>
        )}
        {tab === "home" && (
          <>
            <div className="homeOverview">
              <section className="hero">
                <div>
                  <div className="heroTop">⭐ הנקודות של {m.name}</div>
                  <div className="bigPoints">
                    {n(m.points)} <small>נקודות</small>
                  </div>
                </div>
                <div>
                  <div className="heroFooter">
                    <span>היעד החודשי של כל המשפחה</span>
                    <strong>
                      {Math.min(
                        100,
                        Math.round((monthlyPoints / data.familyGoal) * 100),
                      )}
                      %
                    </strong>
                  </div>
                  <div className="progress">
                    <div
                      style={{
                        width:
                          Math.min(100, (monthlyPoints / data.familyGoal) * 100) + "%",
                      }}
                    />
                  </div>
                  <div className="heroFooter" style={{ marginTop: 10 }}>
                    <span>{n(monthlyPoints)} נק׳ צברנו החודש</span>
                    <span>יעד: {n(data.familyGoal)} נק׳</span>
                  </div>
                </div>
              </section>
            </div>
            {goalBanner()}
            <section className="section">
              <div className="sectionHead">
                <h2>משימות שכיף לעשות ✨</h2>
                <button className="textLink" onClick={() => navigate("tasks")}>
                  כל המשימות ←
                </button>
              </div>
              <div className="taskGrid">{tasks.slice(0, 6).map(taskCard)}</div>
            </section>
            <section className="section">
              <div className="sectionHead">
                <div><h2>מה חדש בבית? 🕒</h2><span className="smallMuted">4 הפעולות האחרונות</span></div>
                <button
                  className="textLink"
                  onClick={() => navigate("history")}
                >
                  כל הפעילות ←
                </button>
              </div>
              <div className="card recent">
                {historyRows(data.history.slice(0, 4))}
              </div>
            </section>
          </>
        )}
        {tab === "tasks" && (
          <>
            <ParentRecovery request={api} />
            <div className="filters">
              {[
                ["all", "הכול"],
                ["chores", "🧹 מטלות"],
                ["education", "📚 לימודים"],
                ["behavior", "🌟 התנהגות"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  className={"chip " + (category === id ? "active" : "")}
                  onClick={() => setCategory(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="taskGrid">
              {tasks
                .filter((x) => category === "all" || x.category === category)
                .map(taskCard)}
            </div>
          </>
        )}
        {tab === "shop" && (
          <>
            {goalBanner()}
            <p className="subtitle">
              רק הורה יכול לממש פרס. ילדים יכולים לבחור יעד.
            </p>
            <div className="shopGrid" style={{ marginTop: 20 }}>
              {rewards.map((item) => (
                <section className="reward" key={item.id}>
                  <div className="rewardIcon">{item.emoji}</div>
                  <h3>{item.title}</h3>
                  <span className="pts">{n(item.value)} נק׳</span>
                  {m.is_child === 1 && (
                    <button
                      className={
                        "button " + (goal?.id === item.id ? "selectedGoal" : "")
                      }
                      disabled={busy || goal?.id === item.id}
                      onClick={() => void selectGoal(item)}
                    >
                      {goal?.id === item.id ? "🎯 היעד שלי" : "בחירה כיעד 🎯"}
                    </button>
                  )}
                  {parent && (
                    <button
                      className="button primary"
                      disabled={busy || m.points < item.value}
                      onClick={() =>
                        open("reward", "אישור מימוש פרס 🎁", { item })
                      }
                    >
                      {m.points < item.value ? "אין מספיק נקודות" : "מימוש פרס"}
                    </button>
                  )}
                </section>
              ))}
            </div>
          </>
        )}
        {tab === "history" && (
          <section className="card historySection" ref={historySection}>
            <div className="sectionHead">
              <h2>יומן הנקודות</h2>
              <span className="smallMuted">{historyExpanded ? "6 החודשים האחרונים" : "8 הימים האחרונים"}</span>
            </div>
            <p className="subtitle">
              פעילות ישנה מ־6 חודשים נמחקת אוטומטית. יתרות הנקודות נשמרות.
            </p>
            <div className="historyToolbar">{historyToggle()}</div>
            <div className="historyFilters">
              <label>מתאריך<input type="date" value={historyFrom} onChange={e => {setHistoryFrom(e.target.value);if(e.target.value)setHistoryExpanded(true);}} /></label>
              <label>עד תאריך<input type="date" value={historyTo} min={historyFrom || undefined} onChange={e => {setHistoryTo(e.target.value);if(e.target.value)setHistoryExpanded(true);}} /></label>
              <label>סוג פעולה<select value={historyType} onChange={e => setHistoryType(e.target.value)}><option value="all">כל הסוגים</option><option value="task">פעילויות</option><option value="reward">מימוש פרסים</option><option value="adjust">תיקוני נקודות</option><option value="undo">ביטולים</option></select></label>
              <button className="button ghost" onClick={() => {setHistoryFrom('');setHistoryTo('');setHistoryType('all');}}>ניקוי מסננים</button>
            </div>
            {historyFrom && historyTo && historyFrom > historyTo && <p className="error" role="alert">תאריך הסיום צריך להיות אחרי תאריך ההתחלה.</p>}
            <p className="smallMuted" role="status">{n(visibleHistory.length)} פעולות מוצגות</p>
            {parent && (
              <div className="infoBox">
                לביטול פעולה, בחרו ״ביטול פעולה״ לצידה. כל ביטול מתועד ביומן.
              </div>
            )}
            <div id="historyList" className="recent">{historyRows(visibleHistory)}</div>
            <div className="controlsRow">{historyToggle()}</div>
          </section>
        )}
        {tab === "admin" && parent && (
          <>
            <div className="adminStats">
              <div className="card stat">
                <strong>{n(total)}</strong>
                <span>נקודות המשפחה</span>
              </div>
              <div className="card stat">
                <strong>{n(data.history.length)}</strong>
                <span>פעולות ביומן</span>
              </div>
              <div className="card stat">
                <strong>{n(tasks.length)}</strong>
                <span>משימות</span>
              </div>
            </div>
            <section className="card">
              <h2>סיסמאות</h2>
              <p>עדכון סיסמת המשפחה או סיסמת ההורה.</p>
              <button className="button" onClick={() => open('passwords','עדכון סיסמה')}>עדכון סיסמאות</button>
            </section>
            <div className="filters">
              {[
                ["task", "🧹 ניהול משימות"],
                ["reward", "🎁 ניהול פרסים"],
                ["balances", "⚖️ יתרות ויעדים"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  className={"chip " + (manage === id ? "active" : "")}
                  onClick={() => setManage(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            {manage === "balances" ? (
              <div className="twoCols">
                <section className="card">
                  <h2>תיקון נקודות</h2>
                  <table className="adminTable">
                    <tbody>
                      {data.members.map((x) => (
                        <tr key={x.id}>
                          <td>
                            {x.emoji} {x.name}
                          </td>
                          <td>{n(x.points)} נק׳</td>
                          <td>
                            <button
                              className="button"
                              onClick={() =>
                                open("adjust", `תיקון נקודות — ${x.name}`, {
                                  memberId: x.id,
                                  expectedBalance: x.points,
                                })
                              }
                            >
                              עריכה ✎
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
                <section className="card">
                  <h2>יעד משפחתי</h2>
                  <p>היעד הנוכחי: {n(data.familyGoal)} נקודות</p>
                  <button
                    className="button"
                    onClick={() => open("familyGoal", "עריכת יעד משפחתי")}
                  >
                    עריכת יעד
                  </button>
                </section>
              </div>
            ) : (
              <section className="card">
                <div className="sectionHead">
                  <h2>
                    {manage === "reward" ? "ניהול פרסים" : "ניהול משימות"}
                  </h2>
                  <button
                    className="button primary"
                    onClick={() =>
                      open(
                        "catalog",
                        manage === "reward" ? "הוספת פרס" : "הוספת משימה",
                      )
                    }
                  >
                    + הוספה
                  </button>
                </div>
                <table className="adminTable">
                  <thead>
                    <tr>
                      <th>שם</th>
                      <th>נקודות</th>
                      <th>פעולות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.catalog
                      .filter((x) => x.kind === manage)
                      .sort((a,b) => a.value - b.value)
                      .map((item) => (
                        <tr key={item.id}>
                          <td>
                            {item.emoji} {item.title}
                          </td>
                          <td>{n(item.value)}</td>
                          <td>
                            <button
                              className="button"
                              onClick={() =>
                                open("catalog", "עריכת פריט", { item })
                              }
                            >
                              עריכה
                            </button>{" "}
                            <button
                              className="button ghost"
                              onClick={() =>
                                open("delete", "מחיקת פריט", { item })
                              }
                            >
                              מחיקה
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </section>
            )}
          </>
        )}
      </main>
      <nav className="mobileNav" aria-label="ניווט">
        {visibleTabs.map(([id, icon, label]) => (
          <button
            className={tab === id ? "active" : ""}
            key={id}
            onClick={() => navigate(id)}
          >
            <span className="ic">{icon}</span>
            {label}
          </button>
        ))}
      </nav>
      {dialog && (
        <Modal
          key={dialog.key}
          dialog={dialog}
          busy={busy}
          close={() => {
            setDialog(null);
            setError("");
          }}
          submit={(form) => void submit(form)}
        >
          <div className="formFields">
            {dialog.kind === "parent" && (
              <>
              <label>
                סיסמת הורה
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={256}
                  autoFocus
                />
              </label>
              <button type="button" className="button" onClick={()=>{setDialog(null);setRecovering(true);}}>שכחתי סיסמת הורה</button>
              </>
            )}
            {["task", "reward"].includes(dialog.kind) && (
              <>
                <p>
                  {dialog.kind === "task"
                    ? "לרשום את ביצוע המשימה"
                    : "לממש את הפרס"}{" "}
                  <strong>{dialog.item?.title}</strong> עבור{" "}
                  {data.members.find((x) => x.id === dialog.memberId)?.name}?
                </p>
                <p className="pts">
                  {dialog.kind === "task" ? "+" : "−"}
                  {n(dialog.item!.value)} נקודות
                </p>
              </>
            )}
            {dialog.kind === "cancel" && (
              <>
                <p>
                  לבטל את <strong>{dialog.entry?.label}</strong> עבור{" "}
                  {
                    data.members.find((x) => x.id === dialog.entry?.member_id)
                      ?.name
                  }
                  ?
                </p>
                <div className="infoBox">
                  הביטול ישנה את היתרה ב־{n(-dialog.entry!.delta)} נקודות.
                  הפעולה המקורית תישאר ביומן ותסומן כמבוטלת.
                </div>
              </>
            )}
            {dialog.kind === "adjust" &&
              (() => {
                const who = data.members.find((x) => x.id === dialog.memberId)!;
                return (
                  <>
                    <label>
                      יתרה חדשה
                      <input
                        name="balance"
                        type="number"
                        min="0"
                        max="1000000000"
                        step="1"
                        defaultValue={dialog.expectedBalance}
                        required
                      />
                    </label>
                    <input
                      name="expected"
                      type="hidden"
                      value={dialog.expectedBalance}
                    />
                    <label>
                      סיבה לתיקון
                      <input name="reason" required maxLength={150} />
                    </label>
                  </>
                );
              })()}
            {dialog.kind === "familyGoal" && (
              <label>
                יעד בנקודות
                <input
                  name="familyGoal"
                  type="number"
                  min="1"
                  max="1000000000"
                  step="1"
                  defaultValue={data.familyGoal}
                  required
                />
              </label>
            )}
            {dialog.kind === 'passwords' && (
              <>
                <label>איזו סיסמה לעדכן?<select name="role" defaultValue="family"><option value="family">סיסמת המשפחה</option><option value="parent">סיסמת ההורה</option></select></label>
                <label>סיסמה חדשה<input name="newPassword" type="password" autoComplete="new-password" minLength={4} maxLength={256} required /></label>
                <label>אימות הסיסמה<input name="confirmPassword" type="password" autoComplete="new-password" minLength={4} maxLength={256} required /></label>
                <p>לפחות 4 תווים. אחרי עדכון סיסמת המשפחה, יש להיכנס מחדש במכשירים האחרים. אחרי עדכון סיסמת ההורה, מצבי הורה אחרים ייסגרו.</p>
              </>
            )}
            {dialog.kind === "catalog" && (
              <>
                <label>
                  שם
                  <input
                    name="title"
                    defaultValue={dialog.item?.title || ""}
                    required
                    maxLength={150}
                  />
                </label>
                <label>
                  נקודות
                  <input
                    name="value"
                    type="number"
                    min="1"
                    max="1000000"
                    step="1"
                    defaultValue={dialog.item?.value || 10}
                    required
                  />
                </label>
                <label>
                  אימוג׳י
                  <input
                    name="emoji"
                    defaultValue={dialog.item?.emoji || "⭐"}
                    required
                    maxLength={16}
                  />
                </label>
                {manage === "task" && (
                  <label>
                    קטגוריה
                    <select
                      name="category"
                      defaultValue={dialog.item?.category || "chores"}
                    >
                      <option value="chores">מטלות</option>
                      <option value="education">לימודים</option>
                      <option value="behavior">התנהגות</option>
                    </select>
                  </label>
                )}
              </>
            )}
            {dialog.kind === "delete" && (
              <p>
                למחוק את <strong>{dialog.item?.title}</strong>? הפעולות הקודמות
                יישמרו ביומן.
              </p>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<OnboardingGate request={api}><App /></OnboardingGate>);

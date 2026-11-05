import { useState } from "react";
import { ChildEmojiPicker } from "./child-emoji-picker";

type Member = { id: string; name: string; emoji: string; points: number };
type Props = {
  members: Member[];
  archived: Member[];
  version: number;
  request: (path: string, input?: unknown) => Promise<unknown>;
  updated: () => Promise<unknown>;
  adjust: (member: Member) => void;
};

export function MemberManagement({ members, archived, version, request, updated, adjust }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<{ id: string | null; emoji: string } | null>(null);
  const member = members.find((entry) => entry.id === editor?.id);
  const adding = editor?.id === null;

  async function act(input: Record<string, unknown>) {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      await request("/members", { ...input, version });
      await updated();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function move(index: number, direction: number) {
    const ids = members.map((entry) => entry.id);
    const other = index + direction;
    [ids[index], ids[other]] = [ids[other], ids[index]];
    void act({ action: "reorder", ids });
  }

  return (
    <section className="card memberManagement">
      <div className="sectionHead">
        <h2>המשתתפים בבית</h2>
        <button
          type="button"
          className="button primary"
          disabled={busy || members.length >= 12}
          onClick={() => {
            setError("");
            setEditor({ id: null, emoji: "⭐" });
          }}
        >
          + הוספת ילד/ה
        </button>
      </div>
      <p>בחרו ילד או ילדה לעריכת הפרופיל ולתיקון נקודות.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {members.length >= 12 && <p className="smallMuted">אפשר להוסיף עד 12 משתתפים פעילים.</p>}
      <div className="memberList">
        {members.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="memberSummary"
            aria-pressed={editor?.id === entry.id}
            disabled={busy}
            onClick={() => {
              if (editor?.id === entry.id) return;
              setError("");
              setEditor({ id: entry.id, emoji: entry.emoji });
            }}
          >
            <span className="memberAvatar" aria-hidden="true">{entry.emoji}</span>
            <strong>{entry.name}</strong>
            <span>{entry.points.toLocaleString("he-IL")} נק׳</span>
            <span aria-hidden="true">✎</span>
          </button>
        ))}
      </div>
      {editor && (adding || member) && (
        <div className="memberEditor" key={editor.id ?? "add"}>
          <h3>{member ? "עריכת הפרופיל של " + member.name : "הוספת ילד או ילדה"}</h3>
          {member && (
            <div className="memberBalance">
              <span>יתרה נוכחית · <strong>{member.points.toLocaleString("he-IL")} נק׳</strong></span>
              <button type="button" className="button" disabled={busy} onClick={() => adjust(member)}>
                תיקון נקודות
              </button>
            </div>
          )}
          <form className="formFields" onSubmit={async (event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            const profile = { name: values.get("name"), emoji: editor.emoji };
            const saved = await act(member
              ? { action: "edit", id: member.id, ...profile }
              : { action: "add", points: Number(values.get("points")), ...profile });
            if (saved) setEditor(null);
          }}>
            <label>שם<input name="name" defaultValue={member?.name} autoFocus maxLength={40} required disabled={busy} /></label>
            <ChildEmojiPicker
              value={editor.emoji}
              disabled={busy}
              onChange={(emoji) => setEditor({ ...editor, emoji })}
            />
            {adding && (
              <>
                <label>נקודות התחלה<input name="points" type="number" min={0} max={1000000000} step={1} defaultValue={0} required disabled={busy} /></label>
                <p className="smallMuted">נקודות התחלה אינן נחשבות כהתקדמות ליעד החודשי.</p>
              </>
            )}
            <div className="memberButtons">
              <button className="button primary" disabled={busy || !editor.emoji.trim() || (adding && members.length >= 12)}>
                {adding ? "הוספה" : "שמירת הפרופיל"}
              </button>
              <button type="button" className="button" disabled={busy} onClick={() => setEditor(null)}>סגירה</button>
            </div>
          </form>
          {member && (
            <details className="memberArchived">
              <summary>סדר תצוגה והסרה</summary>
              <p className="smallMuted">המשתתף הראשון ברשימה נבחר כברירת מחדל.</p>
              <div className="memberButtons">
                <button type="button" className="button" disabled={busy || members[0].id === member.id} onClick={() => move(members.indexOf(member), -1)}>העברה למעלה ↑</button>
                <button type="button" className="button" disabled={busy || members.at(-1)?.id === member.id} onClick={() => move(members.indexOf(member), 1)}>העברה למטה ↓</button>
                <button type="button" className="button" disabled={busy || members.length <= 1} onClick={async () => {
                  if (window.confirm("להסיר את " + member.name + " מהמשתתפים הפעילים? הנקודות וההיסטוריה יישמרו ואפשר יהיה להחזיר בהמשך.")) {
                    if (await act({ action: "archive", id: member.id })) setEditor(null);
                  }
                }}>הסרה מהמשתתפים</button>
              </div>
            </details>
          )}
        </div>
      )}
      {archived.length > 0 && (
        <details className="memberArchived">
          <summary>משתתפים שהוסרו ({archived.length})</summary>
          <p>אפשר להחזיר משתתף עם אותה יתרה והיסטוריה.</p>
          {archived.map((entry) => (
            <div className="archivedRow" key={entry.id}>
              <span>{entry.emoji} {entry.name} · {entry.points.toLocaleString("he-IL")} נק׳</span>
              <button type="button" className="button" disabled={busy || members.length >= 12} onClick={() => void act({ action: "restore", id: entry.id })}>
                החזרה למשתתפים
              </button>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}

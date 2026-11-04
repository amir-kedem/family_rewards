type Activity = { id: string; delta: number; kind: string; label: string; at: string; cancelled_by: string | null };
const calendar = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Jerusalem', year:'numeric', month:'2-digit'});
function monthKey(date: Date): string {
  const parts = calendar.formatToParts(date);
  return parts.find(p => p.type === 'year')!.value + '-' + parts.find(p => p.type === 'month')!.value;
}
export function monthlyGoalPoints(history: Activity[], now = new Date()): number {
  const month = monthKey(now);
  return Math.max(0, history.reduce((sum, entry) => {
    const at = new Date(entry.at);
    if (!Number.isFinite(at.getTime()) || monthKey(at) !== month) return sum;
    if (entry.kind === 'reward' || entry.kind === 'undo' || entry.cancelled_by) return sum;
    if (entry.kind === 'legacy' && entry.label.includes('מימוש')) return sum;
    return sum + entry.delta;
  }, 0));
}

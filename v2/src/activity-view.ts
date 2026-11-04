type Activity = { delta: number; kind: string; label: string; at: string; cancelled_by: string | null };
const calendar = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'});
export function activityDate(value: string | Date): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = calendar.formatToParts(date);
  return ['year','month','day'].map(type => parts.find(p => p.type === type)!.value).join('-');
}
export function byPoints<T extends {value: number}>(items: T[]): T[] {
  return [...items].sort((a,b) => a.value - b.value);
}
export function activityType(entry: Activity): string {
  if (entry.kind !== 'legacy') return entry.kind;
  if (entry.label.includes('מימוש')) return 'reward';
  if (entry.label.startsWith('ביטול')) return 'undo';
  return entry.delta > 0 ? 'task' : 'adjust';
}
export function filterActivity<T extends Activity>(rows: T[], options: {expanded: boolean; from: string; to: string; type: string}, now = new Date()): T[] {
  if (options.from && options.to && options.from > options.to) return [];
  return rows.filter(entry => {
    const date = activityDate(entry.at);
    if (!date || (!options.expanded && new Date(entry.at).getTime() < now.getTime() - 8*86400000)) return false;
    if (options.from && date < options.from) return false;
    if (options.to && date > options.to) return false;
    return options.type === 'all' || activityType(entry) === options.type || (options.type === 'undo' && Boolean(entry.cancelled_by));
  });
}

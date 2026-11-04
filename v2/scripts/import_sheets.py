"""Validate exported Google Sheets CSVs and emit a one-time, balance-preserving D1 import."""
import argparse
import csv
import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo('Asia/Jerusalem')

def rows(folder, name, required=True):
    path = folder / (name + '.csv')
    if not path.exists():
        if required:
            raise ValueError(f'Missing {name}.csv')
        return []
    with path.open(encoding='utf-8-sig', newline='') as f:
        return list(csv.DictReader(f))

def number(value, minimum=0, maximum=1_000_000_000):
    try:
        n = Decimal(str(value).strip())
        if not n.is_finite() or n != int(n) or not minimum <= n <= maximum:
            raise ValueError('Number outside supported integer range')
        return int(n)
    except (InvalidOperation, TypeError):
        raise ValueError('Invalid number') from None

def quote(value):
    return "'" + str(value).replace("'", "''") + "'"

def timestamp(row):
    raw = row.get('Timestamp') or f"{row.get('Date', '')} {row.get('Time', '')}"
    parsed = datetime.fromisoformat(raw.strip().replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=TZ)
    return parsed.astimezone(timezone.utc)

def six_month_cutoff(now):
    import calendar
    month = now.month - 6
    year = now.year
    if month < 1:
        month += 12
        year -= 1
    return now.replace(year=year, month=month, day=min(now.day, calendar.monthrange(year, month)[1]))

def build(folder, now=None):
    now = now or datetime.now(timezone.utc)
    cutoff = six_month_cutoff(now)
    members, seen, statements = {}, set(), []
    for row in rows(folder, 'Members'):
        name = row.get('Name', '').strip()
        if not name or name in members:
            raise ValueError('Member names must be present and unique')
        ident = 'm-' + hashlib.sha256(name.encode()).hexdigest()[:20]
        points = number(row.get('Points'))
        members[name] = {'id': ident, 'points': points}
        child = int(name in ['גוני', 'נווה'])
        statements.append(f'INSERT INTO members(id,name,points,is_child) VALUES ({quote(ident)},{quote(name)},{points},{child});')
    if not members:
        raise ValueError('Members.csv is empty')
    catalog_count = 0
    for sheet, kind, category, col in [('Chores','task','chores','Points'), ('Behavior','task','behavior','Points'), ('Education','task','education','Points'), ('Prizes','reward','chores','Price')]:
        for i, row in enumerate(rows(folder, sheet)):
            title = row.get('Title', '').strip()
            if not title:
                raise ValueError(f'Blank title in {sheet} row {i+2}')
            value = number(row.get(col), 1, 1_000_000)
            ident = f'{sheet.lower()}-{i+1}'
            statements.append(f'INSERT INTO catalog(id,kind,category,title,value) VALUES ({quote(ident)},{quote(kind)},{quote(category)},{quote(title)},{value});')
            catalog_count += 1
    def clean(row):
        who = row.get('User', '').strip()
        if who not in members:
            raise ValueError('History refers to an unknown member')
        at = timestamp(row)
        delta = number(row.get('Points'), -1_000_000_000)
        action = row.get('Action', '').strip()
        if not action or not delta:
            raise ValueError('History needs a label and nonzero points')
        return (who, action, delta, at.isoformat(timespec='milliseconds').replace('+00:00','Z')), at
    # MonthlyLedger duplicates History. Keep the maximum occurrence count across the two
    # sources, preserving legitimately repeated actions with identical timestamps.
    sources = []
    skipped = 0
    for sheet in ['History', 'MonthlyLedger']:
        counts = Counter()
        for row in rows(folder, sheet, required=(sheet=='History')):
            entry, at = clean(row)
            if at > now:
                raise ValueError('History contains a future timestamp')
            if at < cutoff:
                skipped += 1
                continue
            counts[entry] += 1
        sources.append(counts)
    combined = sources[0] | sources[1]
    history_count = 0
    for entry, count in combined.items():
        who, action, delta, at = entry
        for occurrence in range(count):
            ident = 'legacy-' + hashlib.sha256(json.dumps([entry, occurrence], ensure_ascii=False).encode()).hexdigest()
            statements.append(f"INSERT INTO history(id,member_id,delta,label,kind,at) VALUES ({quote(ident)},{quote(members[who]['id'])},{delta},{quote(action)},'legacy',{quote(at)});")
            history_count += 1
    # Refuse imports over an existing dataset. Execute once using Wrangler's SQL-file batch.
    guard = ['CREATE TABLE import_guard (empty INTEGER CHECK(empty=1));',
             'INSERT INTO import_guard SELECT CASE WHEN (SELECT COUNT(*) FROM members)+(SELECT COUNT(*) FROM catalog)+(SELECT COUNT(*) FROM history)=0 THEN 1 ELSE 0 END;']
    sql = '\n'.join(guard + statements + ['DROP TABLE import_guard;', ''])
    summary = {'members':len(members),'catalog':catalog_count,'history':history_count,'older_source_rows_skipped':skipped,'total_points':sum(m['points'] for m in members.values())}
    return sql, summary, members

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder', type=Path)
    parser.add_argument('--output', type=Path, default=Path('import.sql'))
    args = parser.parse_args()
    try:
        sql, summary, _ = build(args.folder)
        if args.output.exists():
            raise ValueError('Output already exists; choose a new output path')
        args.output.write_text(sql, encoding='utf-8')
        print(json.dumps(summary, indent=2))
        print('Validated. No remote data was changed. Keep the SQL file private.')
    except (ValueError, OSError) as exc:
        parser.exit(1, f'Import stopped: {exc}\n')

import csv
import importlib.util
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('import_sheets', ROOT / 'scripts/import_sheets.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ImportTests(unittest.TestCase):
    def test_balances_duplicates_timezone_and_repeat_guard(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            def write(name, fields, rows):
                with (folder / (name+'.csv')).open('w', encoding='utf-8', newline='') as f:
                    writer=csv.DictWriter(f, fieldnames=fields);writer.writeheader();writer.writerows(rows)
            write('Members',['Name','Points'],[{'Name':"Test's family",'Points':'175'}])
            for name in ['Chores','Behavior','Education']:
                write(name,['Title','Points'],[])
            write('Prizes',['Title','Price'],[{'Title':'Prize','Price':50}])
            rows=[{'User':"Test's family",'Action':'Task','Points':25,'Timestamp':'2026-11-01 12:00:00'}]*2
            write('History',['User','Action','Points','Timestamp'],rows)
            write('MonthlyLedger',['User','Action','Points','Timestamp'],rows[:1])
            sql, summary, _=module.build(folder,datetime(2026,11,4,tzinfo=timezone.utc))
            db=sqlite3.connect(':memory:');db.executescript((ROOT/'migrations/0001_initial.sql').read_text());db.executescript(sql)
            self.assertEqual(summary['history'],2)
            self.assertEqual(db.execute('SELECT points FROM members').fetchone()[0],175)
            self.assertEqual(db.execute('SELECT at FROM history LIMIT 1').fetchone()[0],'2026-11-01T10:00:00.000Z')
            with self.assertRaises(sqlite3.IntegrityError):
                db.executescript(sql)
            self.assertEqual(db.execute('SELECT points FROM members').fetchone()[0],175)
    def test_invalid_integer(self):
        for value in ['1.5','NaN','-1','nonsense']:
            with self.assertRaises((ValueError,OverflowError)):
                module.number(value)

if __name__ == '__main__':
    unittest.main()

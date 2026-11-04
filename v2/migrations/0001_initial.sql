PRAGMA foreign_keys = ON;
CREATE TABLE members (
 id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
 emoji TEXT NOT NULL DEFAULT '⭐',
 points INTEGER NOT NULL DEFAULT 0 CHECK(points >= 0 AND points <= 9007199254740991),
 is_child INTEGER NOT NULL DEFAULT 1 CHECK(is_child IN (0,1))
);
CREATE TABLE catalog (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('task','reward')),
 category TEXT NOT NULL DEFAULT 'chores', title TEXT NOT NULL,
 value INTEGER NOT NULL CHECK(value > 0 AND value <= 1000000),
 emoji TEXT NOT NULL DEFAULT '⭐', active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE TABLE goals (member_id TEXT PRIMARY KEY REFERENCES members(id), reward_id TEXT NOT NULL REFERENCES catalog(id));
CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id=1), family_goal INTEGER NOT NULL CHECK(family_goal>0));
INSERT INTO settings VALUES (1,5000);
CREATE TABLE history (
 id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id),
 delta INTEGER NOT NULL CHECK(delta != 0), label TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('task','reward','adjust','undo','legacy')),
 at TEXT NOT NULL, undo_of TEXT UNIQUE, cancelled_by TEXT,
 request_key TEXT UNIQUE, request_fingerprint TEXT,
 CHECK((kind='undo' AND undo_of IS NOT NULL) OR (kind!='undo' AND undo_of IS NULL))
);
CREATE INDEX history_at ON history(at);
CREATE TRIGGER validate_history BEFORE INSERT ON history WHEN NEW.kind != 'legacy' BEGIN
 SELECT CASE WHEN NEW.kind='undo' AND NOT EXISTS (
   SELECT 1 FROM history WHERE id=NEW.undo_of AND member_id=NEW.member_id
   AND delta=-NEW.delta AND kind NOT IN ('undo','legacy') AND cancelled_by IS NULL
 ) THEN RAISE(ABORT,'invalid_cancellation') END;
 SELECT CASE WHEN (SELECT points+NEW.delta FROM members WHERE id=NEW.member_id)<0
   THEN RAISE(ABORT,'insufficient_points') END;
END;
CREATE TRIGGER apply_history AFTER INSERT ON history WHEN NEW.kind != 'legacy' BEGIN
 UPDATE members SET points=points+NEW.delta WHERE id=NEW.member_id;
 UPDATE history SET cancelled_by=NEW.id WHERE id=NEW.undo_of;
END;
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('family','parent')), expires_at INTEGER NOT NULL);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE login_attempts (bucket TEXT PRIMARY KEY, failures INTEGER NOT NULL, reset_at INTEGER NOT NULL);

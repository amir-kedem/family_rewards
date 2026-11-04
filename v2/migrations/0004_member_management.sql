CREATE TABLE IF NOT EXISTS member_preferences (
 member_id TEXT PRIMARY KEY REFERENCES members(id),
 position INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1))
);
CREATE TABLE IF NOT EXISTS member_management (id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO member_management VALUES (1,0);
CREATE TABLE IF NOT EXISTS member_update_guard (id INTEGER PRIMARY KEY CHECK(id=1),valid INTEGER NOT NULL CHECK(valid=1));
CREATE TRIGGER IF NOT EXISTS member_active_history BEFORE INSERT ON history WHEN NEW.kind IN ('task','reward') AND EXISTS (SELECT 1 FROM member_preferences WHERE member_id=NEW.member_id AND archived=1) BEGIN SELECT RAISE(ABORT,'member_inactive'); END;

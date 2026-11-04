CREATE TABLE instance_identity (
 id INTEGER PRIMARY KEY CHECK(id=1), instance_id TEXT NOT NULL UNIQUE,
 origin TEXT NOT NULL, schema_version INTEGER NOT NULL DEFAULT 2,
 family_name TEXT NOT NULL DEFAULT 'הבית שלנו'
);
CREATE TABLE onboarding (
 id INTEGER PRIMARY KEY CHECK(id=1),
 state TEXT NOT NULL CHECK(state IN ('pending','claimed','complete')),
 invite_hash TEXT, invite_expires_at INTEGER NOT NULL,
 setup_session_hash TEXT, setup_expires_at INTEGER,
 parent_password_hash TEXT,
 draft_json TEXT NOT NULL DEFAULT '{}', draft_version INTEGER NOT NULL DEFAULT 0,
 completion_key TEXT
);
CREATE TABLE setup_completion_guard (
 id INTEGER PRIMARY KEY CHECK(id=1), valid INTEGER NOT NULL CHECK(valid=1)
);
CREATE TABLE IF NOT EXISTS password_credentials (
 role TEXT PRIMARY KEY CHECK(role IN ('family','parent')), password_hash TEXT NOT NULL
);

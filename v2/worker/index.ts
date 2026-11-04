import { cutoff, digest, hashPassword, verifyPassword } from "./security.ts";
// Structural D1 types keep the Worker and Node/SQLite integration tests dependency-free.
type Statement = {
  bind(...values: unknown[]): Statement;
  first<T = any>(): Promise<T | null>;
  all<T = any>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
};
type Env = {
  DB: {
    prepare(sql: string): Statement;
    batch(statements: Statement[]): Promise<unknown>;
  };
  FAMILY_PASSWORD_HASH: string;
  PARENT_PASSWORD_HASH: string;
};
type Session = {
  token_hash: string;
  role: "family" | "parent";
  expires_at: number;
};
class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const json = (
  value: unknown,
  status = 200,
  extra: Record<string, string> = {},
) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
const fail = (status: number, message: string): never => {
  throw new ApiError(status, message);
};
const integer = (value: unknown, min = 0, max = 1000000) => {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < min ||
    Number(value) > max
  )
    fail(400, "invalid_number");
  return value as number;
};
const text = (value: unknown, max = 150) => {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    fail(400, "invalid_text");
  return (value as string).trim();
};
const cookie = (token: string, parent = false) =>
  `__Host-fr_session=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${parent ? 1800 : 604800}`;
async function body(request: Request) {
  const raw = await request.text();
  if (raw.length > 8192) fail(413, "request_too_large");
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      fail(400, "invalid_json");
    return value;
  } catch {
    fail(400, "invalid_json");
  }
}
async function session(request: Request, env: Env): Promise<Session> {
  const token = request.headers
    .get("Cookie")
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("__Host-fr_session="))
    ?.slice(18);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) fail(401, "login_required");
  const found = await env.DB.prepare(
    "SELECT * FROM sessions WHERE token_hash=? AND expires_at>?",
  )
    .bind(await digest(token!), Date.now())
    .first<Session>();
  if (!found) fail(401, "login_required");
  return found!;
}
async function newSession(
  env: Env,
  role: "family" | "parent",
  previous?: Session,
) {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
  const statements = [
    env.DB.prepare("INSERT INTO sessions VALUES (?,?,?)").bind(
      await digest(token),
      role,
      Date.now() + (role === "parent" ? 1800000 : 604800000),
    ),
  ];
  if (previous)
    statements.push(
      env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(
        previous.token_hash,
      ),
    );
  await env.DB.batch(statements);
  return json({ role }, 200, {
    "Set-Cookie": cookie(token, role === "parent"),
  });
}
async function login(request: Request, env: Env, parent: boolean) {
  const previous = parent ? await session(request, env) : undefined;
  const input = await body(request),
    password = text(input.password, 256);
  const credentials = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='password_credentials'").first();
  const saved = credentials ? await env.DB.prepare("SELECT password_hash FROM password_credentials WHERE role=?").bind(parent ? 'parent' : 'family').first() : null;
  const encoded = saved?.password_hash || (parent ? env.PARENT_PASSWORD_HASH : env.FAMILY_PASSWORD_HASH);
  if (!encoded) fail(503, "authentication_not_configured");
  // A per-role cap bounds online guessing even if an attacker rotates addresses.
  const now = Date.now(),
    bucket = parent ? "parent" : "family";
  await env.DB.prepare(
    "INSERT INTO login_attempts VALUES (?,0,?) ON CONFLICT(bucket) DO UPDATE SET failures=0,reset_at=excluded.reset_at WHERE login_attempts.reset_at<=?",
  )
    .bind(bucket, now + 900000, now)
    .run();
  const row = await env.DB.prepare(
    "SELECT failures FROM login_attempts WHERE bucket=?",
  )
    .bind(bucket)
    .first();
  if (row.failures >= 10) fail(429, "try_again_later");
  // Reserve the attempt before hashing, so parallel requests cannot bypass the limit.
  const result = await env.DB.prepare(
    "UPDATE login_attempts SET failures=failures+1 WHERE bucket=? AND failures<10 RETURNING failures",
  )
    .bind(bucket)
    .first();
  if (!result) fail(429, "try_again_later");
  if (!(await verifyPassword(password, encoded)))
    fail(401, "incorrect_password");
  await env.DB.prepare("DELETE FROM login_attempts WHERE bucket=?")
    .bind(bucket)
    .run();
  return newSession(env, parent ? "parent" : "family", previous);
}
async function cleanup(env: Env, now = new Date()) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM history WHERE at<?").bind(cutoff(now)),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at<=?").bind(
      now.getTime(),
    ),
    env.DB.prepare("DELETE FROM login_attempts WHERE reset_at<=?").bind(
      now.getTime(),
    ),
  ]);
}
async function historyWrite(
  request: Request,
  env: Env,
  input: any,
  delta: number,
  label: string,
  kind: string,
  undoOf: string | null = null,
) {
  const key = text(request.headers.get("Idempotency-Key"), 100);
  const fingerprint = await digest(
    JSON.stringify({ path: new URL(request.url).pathname, input }),
  );
  const existing = await env.DB.prepare(
    "SELECT id,request_fingerprint FROM history WHERE request_key=?",
  )
    .bind(key)
    .first();
  if (existing) {
    if (existing.request_fingerprint !== fingerprint)
      fail(409, "idempotency_key_reused");
    return json({ id: existing.id, replayed: true });
  }
  try {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO history (id,member_id,delta,label,kind,at,undo_of,request_key,request_fingerprint) VALUES (?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        id,
        text(input.memberId),
        delta,
        label,
        kind,
        new Date().toISOString(),
        undoOf,
        key,
        fingerprint,
      )
      .run();
    return json({ id }, 201);
  } catch (error) {
    const replay = await env.DB.prepare(
      "SELECT id,request_fingerprint FROM history WHERE request_key=?",
    )
      .bind(key)
      .first();
    if (replay && replay.request_fingerprint === fingerprint)
      return json({ id: replay.id, replayed: true });
    const message = String(error);
    if (/insufficient_points|CHECK constraint/.test(message))
      fail(409, "insufficient_points_or_invalid_balance");
    if (/invalid_cancellation|UNIQUE constraint/.test(message))
      fail(409, "already_cancelled_or_conflicting_action");
    if (/FOREIGN KEY/.test(message)) fail(404, "member_not_found");
    throw error;
  }
}
async function route(request: Request, env: Env) {
  const url = new URL(request.url),
    path = url.pathname,
    method = request.method;
  if (!path.startsWith("/api/")) return json({ error: "not_found" }, 404);
  if (!["GET", "POST", "PATCH", "DELETE"].includes(method))
    fail(405, "method_not_allowed");
  if (method !== "GET") {
    if (request.headers.get("Origin") !== url.origin)
      fail(403, "invalid_origin");
    if (!request.headers.get("Content-Type")?.startsWith("application/json"))
      fail(415, "json_required");
  }
  if (path === "/api/login" && method === "POST")
    return login(request, env, false);
  if (path === "/api/parent/login" && method === "POST")
    return login(request, env, true);
  const user = await session(request, env);
  const parent = () => {
    if (user.role !== "parent") fail(403, "parent_required");
  };
  if (path === '/api/passwords' && method === 'POST') {
    parent();
    const input = await body(request);
    if (!['family','parent'].includes(input.role)) fail(400,'invalid_password_role');
    const password = text(input.newPassword,256);
    if (password.length < 4) fail(400,'password_too_short');
    const encoded = await hashPassword(password);
    const token = (crypto.randomUUID() + crypto.randomUUID()).replaceAll('-','');
    // Bootstrap the optional credential store only when a parent first changes
    // a password. Existing installs keep using their Worker secrets until then.
    // Rotate affected sessions atomically and keep this parent signed in.
    await env.DB.batch([
      env.DB.prepare("CREATE TABLE IF NOT EXISTS password_credentials (role TEXT PRIMARY KEY CHECK(role IN ('family','parent')), password_hash TEXT NOT NULL)"),
      env.DB.prepare("INSERT INTO password_credentials(role,password_hash) VALUES (?,?) ON CONFLICT(role) DO UPDATE SET password_hash=excluded.password_hash").bind(input.role,encoded),
      env.DB.prepare('DELETE FROM sessions WHERE role=? OR token_hash=?').bind(input.role,user.token_hash),
      env.DB.prepare('INSERT INTO sessions VALUES (?,?,?)').bind(await digest(token),'parent',Date.now()+1800000),
    ]);
    return json({ok:true},200,{'Set-Cookie':cookie(token,true)});
  }
  if (path === "/api/logout" && method === "POST") {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?")
      .bind(user.token_hash)
      .run();
    return json({ ok: true }, 200, {
      "Set-Cookie":
        "__Host-fr_session=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0",
    });
  }
  if (path === "/api/parent/logout" && method === "POST") {
    parent();
    return newSession(env, "family", user);
  }
  if (path === "/api/state" && method === "GET") {
    const [members, catalog, goals, history, settings] = await Promise.all([
      env.DB.prepare("SELECT * FROM members ORDER BY rowid").all(),
      env.DB.prepare(
        "SELECT * FROM catalog WHERE active=1 ORDER BY rowid",
      ).all(),
      env.DB.prepare("SELECT * FROM goals").all(),
      env.DB.prepare(
        "SELECT id,member_id,delta,label,kind,at,undo_of,cancelled_by FROM history WHERE at>=? ORDER BY at DESC,id DESC",
      )
        .bind(cutoff())
        .all(),
      env.DB.prepare("SELECT family_goal FROM settings WHERE id=1").first(),
    ]);
    return json({
      role: user.role,
      members: members.results,
      catalog: catalog.results,
      goals: goals.results,
      history: history.results,
      familyGoal: settings?.family_goal,
    });
  }
  if (
    method === "POST" &&
    ["/api/tasks/complete", "/api/rewards/redeem"].includes(path)
  ) {
    const reward = path.includes("rewards");
    if (reward) parent();
    const input = await body(request);
    const item = await env.DB.prepare(
      "SELECT * FROM catalog WHERE id=? AND kind=? AND active=1",
    )
      .bind(text(input.itemId), reward ? "reward" : "task")
      .first();
    if (!item) fail(404, "item_not_found");
    return historyWrite(
      request,
      env,
      input,
      reward ? -item.value : item.value,
      `${reward ? "מימוש" : "ביצוע"}: ${item.title}`,
      reward ? "reward" : "task",
    );
  }
  if (path === "/api/history/cancel" && method === "POST") {
    parent();
    const input = await body(request);
    const original = await env.DB.prepare(
      "SELECT * FROM history WHERE id=? AND at>=?",
    )
      .bind(text(input.historyId), cutoff())
      .first();
    if (!original) fail(404, "action_not_found");
    if (input.memberId !== original.member_id) fail(400, "member_mismatch");
    return historyWrite(
      request,
      env,
      input,
      -original.delta,
      `ביטול: ${original.label}`,
      "undo",
      original.id,
    );
  }
  if (path === "/api/balances/adjust" && method === "POST") {
    parent();
    const input = await body(request),
      balance = integer(input.balance, 0, 1000000000),
      reason = text(input.reason);
    // Optimistic concurrency: reject stale edits rather than overwrite another device's work.
    const key = text(request.headers.get("Idempotency-Key"), 100),
      fingerprint = await digest(JSON.stringify({ path, input }));
    const replay = await env.DB.prepare(
      "SELECT * FROM history WHERE request_key=?",
    )
      .bind(key)
      .first();
    if (replay) {
      if (replay.request_fingerprint !== fingerprint)
        fail(409, "idempotency_key_reused");
      return json({ id: replay.id, replayed: true });
    }
    const expected = integer(input.expectedBalance, 0, 1000000000),
      delta = balance - expected;
    if (!delta) fail(400, "balance_unchanged");
    const id = crypto.randomUUID();
    try {
      const result = await env.DB.prepare(
        "INSERT INTO history (id,member_id,delta,label,kind,at,request_key,request_fingerprint) SELECT ?,id,?,?,'adjust',?,?,? FROM members WHERE id=? AND points=? RETURNING id",
      )
        .bind(
          id,
          delta,
          `תיקון ידני: ${reason}`,
          new Date().toISOString(),
          key,
          fingerprint,
          text(input.memberId),
          expected,
        )
        .first();
      if (!result) fail(409, "balance_changed_refresh");
      return json({ id }, 201);
    } catch (error) {
      const retry = await env.DB.prepare(
        "SELECT * FROM history WHERE request_key=?",
      )
        .bind(key)
        .first();
      if (retry?.request_fingerprint === fingerprint)
        return json({ id: retry.id, replayed: true });
      throw error;
    }
  }
  if (path === "/api/goals" && method === "POST") {
    const input = await body(request),
      m = await env.DB.prepare("SELECT * FROM members WHERE id=?")
        .bind(text(input.memberId))
        .first();
    if (!m || !m.is_child) fail(400, "child_required");
    const reward = await env.DB.prepare(
      "SELECT id FROM catalog WHERE id=? AND kind='reward' AND active=1",
    )
      .bind(text(input.rewardId))
      .first();
    if (!reward) fail(404, "reward_not_found");
    await env.DB.prepare(
      "INSERT INTO goals VALUES (?,?) ON CONFLICT(member_id) DO UPDATE SET reward_id=excluded.reward_id",
    )
      .bind(m.id, reward.id)
      .run();
    return json({ ok: true });
  }
  if (path === "/api/settings" && method === "POST") {
    parent();
    const input = await body(request);
    await env.DB.prepare("UPDATE settings SET family_goal=? WHERE id=1")
      .bind(integer(input.familyGoal, 1, 1000000000))
      .run();
    return json({ ok: true });
  }
  if (path === "/api/catalog" && method === "POST") {
    parent();
    const input = await body(request);
    if (
      !["task", "reward"].includes(input.kind) ||
      !["chores", "education", "behavior"].includes(input.category)
    )
      fail(400, "invalid_catalog_kind");
    const id = input.id ? text(input.id) : crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO catalog (id,kind,category,title,value,emoji) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,value=excluded.value,emoji=excluded.emoji,category=excluded.category WHERE catalog.kind=excluded.kind AND catalog.active=1",
    )
      .bind(
        id,
        input.kind,
        input.category,
        text(input.title),
        integer(input.value, 1),
        text(input.emoji, 16),
      )
      .run();
    return json({ id });
  }
  if (path === "/api/catalog" && method === "DELETE") {
    parent();
    const input = await body(request),
      id = text(input.id);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM goals WHERE reward_id=?").bind(id),
      env.DB.prepare("UPDATE catalog SET active=0 WHERE id=?").bind(id),
    ]);
    return json({ ok: true });
  }
  fail(404, "not_found");
}
export default {
  async fetch(request: Request, env: Env) {
    try {
      return await route(request, env);
    } catch (error) {
      if (error instanceof ApiError)
        return json({ error: error.message }, error.status);
      console.error("Family Rewards API request failed");
      return json({ error: "internal_error" }, 500);
    }
  },
  async scheduled(
    _event: unknown,
    env: Env,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ) {
    ctx.waitUntil(cleanup(env));
  },
};
export { cleanup };

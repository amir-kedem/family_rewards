import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { pbkdf2Sync } from "node:crypto";
import worker, { cleanup } from "../worker/index.ts";
import { cutoff } from "../worker/security.ts";
function setup() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(
    readFileSync(
      new URL("../migrations/0001_initial.sql", import.meta.url),
      "utf8",
    ),
  );
  sql.exec(
    "INSERT INTO members VALUES ('child','Child','⭐',100,1);INSERT INTO catalog VALUES ('task','task','chores','Task',25,'⭐',1),('prize','reward','chores','Prize',80,'🎁',1)",
  );
  const DB = {
    prepare(query) {
      let args = [];
      const s = {
        bind(...v) {
          args = v;
          return s;
        },
        async first() {
          return sql.prepare(query).get(...args) || null;
        },
        async all() {
          return { results: sql.prepare(query).all(...args) };
        },
        async run() {
          return sql.prepare(query).run(...args);
        },
      };
      return s;
    },
    async batch(statements) {
      sql.exec("BEGIN");
      try {
        const r = [];
        for (const s of statements) r.push(await s.run());
        sql.exec("COMMIT");
        return r;
      } catch (e) {
        sql.exec("ROLLBACK");
        throw e;
      }
    },
  };
  const hash = (p) =>
    `pbkdf2$100000$salt$${pbkdf2Sync(p, "salt", 100000, 32, "sha256").toString("hex")}`;
  const env = {
    DB,
    FAMILY_PASSWORD_HASH: hash("family-test-password"),
    PARENT_PASSWORD_HASH: hash("parent-test-password"),
  };
  let cookie = "";
  async function call(path, input, options = {}) {
    const headers = { Cookie: cookie, ...options.headers };
    if (input !== undefined) {
      headers.Origin = "https://family.test";
      headers["Content-Type"] = "application/json";
    }
    const r = await worker.fetch(
      new Request("https://family.test/api" + path, {
        method: options.method || (input === undefined ? "GET" : "POST"),
        headers,
        body: input === undefined ? undefined : JSON.stringify(input),
      }),
      env,
    );
    const next = r.headers.get("set-cookie");
    if (next) cookie = next.split(";")[0];
    return { status: r.status, data: await r.json(), headers: r.headers };
  }
  const balance = () => sql.prepare("SELECT points FROM members").get().points;
  const login = () => call("/login", { password: "family-test-password" });
  const parent = () =>
    call("/parent/login", { password: "parent-test-password" });
  const action = (path, input, key = crypto.randomUUID()) =>
    call(path, input, { headers: { "Idempotency-Key": key } });
  return { sql, env, call, login, parent, balance, action };
}
test('parent can rotate either password without exposing it or keeping old sessions valid', async () => {
  const f=setup();
  assert.equal((await f.call('/passwords',{role:'family',newPassword:'2468'})).status,401);
  const family=await f.login();
  const oldFamily=family.headers.get('set-cookie').split(';')[0];
  assert.equal((await f.call('/passwords',{role:'family',newPassword:'2468'})).status,403);
  const parentLogin=await f.parent();
  const oldParent=parentLogin.headers.get('set-cookie').split(';')[0];
  assert.equal((await f.call('/passwords',{role:'unknown',newPassword:'2468'})).status,400);
  assert.equal((await f.call('/passwords',{role:'family',newPassword:'123'})).status,400);
  const changed=await f.call('/passwords',{role:'family',newPassword:'2468'});
  assert.equal(changed.status,200);
  assert.deepEqual(changed.data,{ok:true});
  assert.equal((await f.call('/state',undefined,{headers:{Cookie:oldFamily}})).status,401);
  assert.equal((await f.call('/state',undefined,{headers:{Cookie:oldParent}})).status,401);
  assert.equal((await f.call('/state')).data.role,'parent');
  assert.equal((await f.login()).status,401);
  assert.equal((await f.call('/login',{password:'2468'})).status,200);
  await f.parent();
  const currentParent=await f.call('/state');
  assert.equal(currentParent.data.role,'parent');
  const rotated=await f.call('/passwords',{role:'parent',newPassword:'4321'});
  assert.equal(rotated.status,200);
  assert.equal((await f.parent()).status,401);
  assert.equal((await f.call('/parent/login',{password:'4321'})).status,200);
  const state=await f.call('/state');
  assert.equal(JSON.stringify(state.data).includes('password_hash'),false);
  assert.equal(JSON.stringify(state.data).includes('pbkdf2$'),false);
  const saved=f.sql.prepare('SELECT password_hash FROM password_credentials').all();
  assert.equal(saved.length,2);
  assert(saved.every(r=>r.password_hash.startsWith('pbkdf2$100000$')));
});
test("authentication, parent enforcement, cookie security and logout invalidation", async () => {
  const f = setup();
  assert.equal((await f.call("/state")).status, 401);
  assert.equal((await f.call("/login", { password: "wrong" })).status, 401);
  const login = await f.login();
  assert.equal(login.status, 200);
  assert.match(
    login.headers.get("set-cookie"),
    /Secure; HttpOnly; SameSite=Strict/,
  );
  assert.equal(
    (await f.action("/rewards/redeem", { memberId: "child", itemId: "prize" }))
      .status,
    403,
  );
  assert.equal((await f.parent()).status, 200);
  assert.equal((await f.call("/state")).data.role, "parent");
  assert.equal((await f.call("/parent/logout", {})).status, 200);
  assert.equal((await f.call("/state")).data.role, "family");
  await f.call("/logout", {});
  assert.equal((await f.call("/state")).status, 401);
});
test("task retries, older action cancellation, double cancellation and balance protection", async () => {
  const f = setup();
  await f.login();
  const first = await f.action(
    "/tasks/complete",
    { memberId: "child", itemId: "task" },
    "one",
  );
  assert.equal(first.status, 201);
  await f.action(
    "/tasks/complete",
    { memberId: "child", itemId: "task" },
    "one",
  );
  assert.equal(f.balance(), 125);
  await f.action(
    "/tasks/complete",
    { memberId: "child", itemId: "task" },
    "two",
  );
  assert.equal(f.balance(), 150);
  assert.equal(
    (
      await f.action("/history/cancel", {
        memberId: "child",
        historyId: first.data.id,
      })
    ).status,
    403,
  );
  await f.parent();
  assert.equal(
    (
      await f.action("/history/cancel", {
        memberId: "child",
        historyId: first.data.id,
      })
    ).status,
    201,
  );
  assert.equal(f.balance(), 125);
  assert.equal(
    (
      await f.action("/history/cancel", {
        memberId: "child",
        historyId: first.data.id,
      })
    ).status,
    409,
  );
  assert.equal(f.balance(), 125);
  const reward = await f.action("/rewards/redeem", {
    memberId: "child",
    itemId: "prize",
  });
  assert.equal(reward.status, 201);
  assert.equal(f.balance(), 45);
  assert.equal(
    (await f.action("/rewards/redeem", { memberId: "child", itemId: "prize" }))
      .status,
    409,
  );
  assert.equal(f.balance(), 45);
  await f.action("/history/cancel", {
    memberId: "child",
    historyId: reward.data.id,
  });
  assert.equal(f.balance(), 125);
});
test("parallel redemptions cannot overspend; cancellation retry is exactly once", async () => {
  const f = setup();
  await f.login();
  await f.parent();
  const results = await Promise.all([
    f.action("/rewards/redeem", { memberId: "child", itemId: "prize" }),
    f.action("/rewards/redeem", { memberId: "child", itemId: "prize" }),
  ]);
  assert.deepEqual(results.map((x) => x.status).sort(), [201, 409]);
  assert.equal(f.balance(), 20);
  const id = results.find((r) => r.status === 201).data.id;
  const undos = await Promise.all([
    f.action("/history/cancel", { memberId: "child", historyId: id }, "cancel"),
    f.action("/history/cancel", { memberId: "child", historyId: id }, "cancel"),
  ]);
  assert.ok(undos.every((x) => x.status < 300));
  assert.equal(f.balance(), 100);
});
test("stale balance edit and reused idempotency key are rejected", async () => {
  const f = setup();
  await f.login();
  await f.parent();
  const input = {
    memberId: "child",
    balance: 150,
    expectedBalance: 100,
    reason: "Correction",
  };
  assert.equal(
    (await f.action("/balances/adjust", input, "adjust")).status,
    201,
  );
  assert.equal(
    (await f.action("/balances/adjust", input, "adjust")).status,
    200,
  );
  assert.equal(f.balance(), 150);
  assert.equal(
    (await f.action("/balances/adjust", { ...input, balance: 200 }, "adjust"))
      .status,
    409,
  );
  assert.equal(
    (await f.action("/balances/adjust", { ...input, balance: 200 }, "other"))
      .status,
    409,
  );
  assert.equal(f.balance(), 150);
});
test("six calendar month cleanup preserves balances and cancellation marker", async () => {
  const f = setup();
  await f.login();
  const a = await f.action("/tasks/complete", {
    memberId: "child",
    itemId: "task",
  });
  await f.parent();
  await f.action("/history/cancel", {
    memberId: "child",
    historyId: a.data.id,
  });
  f.sql
    .prepare("UPDATE history SET at=? WHERE id=?")
    .run("2026-01-01T00:00:00.000Z", a.data.id);
  const before = f.balance();
  await cleanup(f.env, new Date("2026-11-04T12:00:00Z"));
  assert.equal(f.balance(), before);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM history").get().n, 1);
  assert.equal(
    cutoff(new Date("2026-08-31T12:00:00Z")),
    "2026-02-28T12:00:00.000Z",
  );
});
test("cross-origin writes, malformed input, rate limits and expired sessions", async () => {
  const f = setup();
  const request = new Request("https://family.test/api/login", {
    method: "POST",
    headers: {
      Origin: "https://evil.test",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal((await worker.fetch(request, f.env)).status, 403);
  for (let i = 0; i < 10; i++)
    assert.equal((await f.call("/login", { password: "wrong" })).status, 401);
  assert.equal((await f.login()).status, 429);
  f.sql.exec("DELETE FROM login_attempts");
  await f.login();
  assert.equal(
    (
      await f.action("/tasks/complete", {
        memberId: "child",
        itemId: "missing",
      })
    ).status,
    404,
  );
  assert.equal(
    (await f.call("/tasks/complete", { memberId: "child", itemId: "task" }))
      .status,
    400,
  );
  f.sql.exec("UPDATE sessions SET expires_at=0");
  assert.equal((await f.call("/state")).status, 401);
});
test("goals, catalog management and retired rewards", async () => {
  const f = setup();
  await f.login();
  assert.equal(
    (await f.call("/goals", { memberId: "child", rewardId: "prize" })).status,
    200,
  );
  assert.equal(
    (
      await f.call("/catalog", {
        id: "other",
        kind: "reward",
        category: "chores",
        title: "Other",
        value: 10,
        emoji: "🎁",
      })
    ).status,
    403,
  );
  await f.parent();
  await f.call("/catalog", {
    id: "other",
    kind: "reward",
    category: "chores",
    title: "Other",
    value: 10,
    emoji: "🎁",
  });
  await f.call("/catalog", { id: "prize" }, { method: "DELETE" });
  assert.equal((await f.call("/state")).data.goals.length, 0);
  assert.equal(
    (await f.action("/rewards/redeem", { memberId: "child", itemId: "prize" }))
      .status,
    404,
  );
});

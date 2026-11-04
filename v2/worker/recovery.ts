import {body,fail,json} from './http.ts';
import {digest,hashPassword,verifyPassword} from './security.ts';
type Statement={bind(...values:unknown[]):Statement;first<T=any>():Promise<T|null>;run():Promise<unknown>};
type Env={DB:{prepare(sql:string):Statement;batch(statements:Statement[]):Promise<unknown>};PARENT_PASSWORD_HASH?:string;FAMILY_PASSWORD_HASH?:string};
const codeSchema="CREATE TABLE IF NOT EXISTS parent_recovery (id INTEGER PRIMARY KEY CHECK(id=1), code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL)";
const guardSchema="CREATE TABLE IF NOT EXISTS recovery_guard (id INTEGER PRIMARY KEY CHECK(id=1), valid INTEGER NOT NULL CHECK(valid=1))";
const credentialsSchema="CREATE TABLE IF NOT EXISTS password_credentials (role TEXT PRIMARY KEY CHECK(role IN ('family','parent')), password_hash TEXT NOT NULL)";
async function credential(env:Env,role:'parent'|'family') {
 const table=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='password_credentials'").first();
 const row=table?await env.DB.prepare('SELECT password_hash FROM password_credentials WHERE role=?').bind(role).first():null;
 return row?.password_hash||(role==='parent'?env.PARENT_PASSWORD_HASH:env.FAMILY_PASSWORD_HASH);
}
async function attempt(env:Env,bucket:string) {
 const now=Date.now();
 await env.DB.prepare('INSERT INTO login_attempts VALUES (?,0,?) ON CONFLICT(bucket) DO UPDATE SET failures=0,reset_at=excluded.reset_at WHERE login_attempts.reset_at<=?').bind(bucket,now+900000,now).run();
 const reserved=await env.DB.prepare('UPDATE login_attempts SET failures=failures+1 WHERE bucket=? AND failures<10 RETURNING failures').bind(bucket).first();
 if(!reserved)fail(429,'try_again_later');
}
export async function generateRecovery(request:Request,env:Env,sessionHash:string) {
 const input=await body(request);
 if(typeof input.parentPassword!=='string'||input.parentPassword.length>256)fail(400,'invalid_text');
 await attempt(env,'recovery-generation');
 const encoded=await credential(env,'parent');
 if(!encoded||!await verifyPassword(input.parentPassword,encoded))fail(401,'incorrect_password');
 // This only runs after a parent session and fresh parent-password verification.
 const raw=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
 const expiresAt=Date.now()+365*86400000;
 try { await env.DB.batch([
  env.DB.prepare(codeSchema),env.DB.prepare(guardSchema),env.DB.prepare(credentialsSchema),
  env.DB.prepare("INSERT INTO recovery_guard SELECT 1,CASE WHEN EXISTS (SELECT 1 FROM sessions WHERE token_hash=? AND role='parent' AND expires_at>?) AND COALESCE((SELECT password_hash FROM password_credentials WHERE role='parent'),?)=? THEN 1 ELSE 0 END").bind(sessionHash,Date.now(),env.PARENT_PASSWORD_HASH||'',encoded),
  env.DB.prepare('INSERT INTO parent_recovery VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at').bind(await digest(raw),expiresAt),
  env.DB.prepare("DELETE FROM login_attempts WHERE bucket='recovery-generation'"),
  env.DB.prepare('DELETE FROM recovery_guard WHERE id=1'),
 ]); }catch(error){if(/CHECK constraint|UNIQUE constraint/.test(String(error)))fail(401,'login_required');throw error;}
 return json({code:raw.match(/.{8}/g)!.join('-'),expiresAt});
}
export async function resetParentPassword(request:Request,env:Env) {
 const input=await body(request);
 const password=input.newPassword;
 if(typeof password!=='string'||password.length>256||password.trim()!==password||password.length<4)fail(400,'invalid_setup_password');
 if(typeof input.code!=='string'||input.code.length>100)fail(400,'invalid_recovery_code');
 await attempt(env,'parent-recovery');
 const normalized=input.code.trim().replaceAll('-','').toLowerCase();
 const hash=await digest(normalized);
 const table=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='parent_recovery'").first();
 const found=table?await env.DB.prepare('SELECT code_hash FROM parent_recovery WHERE id=1 AND code_hash=? AND expires_at>?').bind(hash,Date.now()).first():null;
 if(!/^[a-f0-9]{64}$/.test(normalized)||!found)fail(403,'invalid_recovery_code');
 const family=await credential(env,'family');
 if(family&&await verifyPassword(password,family))fail(400,'passwords_must_differ');
 const encoded=await hashPassword(password);
 try {
  // The guard and all changes share one D1 transaction. A concurrent consumer
  // cannot update credentials or revoke sessions after the code was consumed.
  await env.DB.batch([
   env.DB.prepare(guardSchema),env.DB.prepare(credentialsSchema),
   env.DB.prepare('INSERT INTO recovery_guard SELECT 1,CASE WHEN EXISTS (SELECT 1 FROM parent_recovery WHERE id=1 AND code_hash=? AND expires_at>?) THEN 1 ELSE 0 END').bind(hash,Date.now()),
   env.DB.prepare("INSERT INTO password_credentials VALUES ('parent',?) ON CONFLICT(role) DO UPDATE SET password_hash=excluded.password_hash").bind(encoded),
   env.DB.prepare('DELETE FROM sessions'),
   env.DB.prepare('DELETE FROM parent_recovery WHERE id=1'),
   env.DB.prepare("DELETE FROM login_attempts WHERE bucket IN ('parent-recovery','recovery-generation','parent')"),
   env.DB.prepare('DELETE FROM recovery_guard WHERE id=1'),
  ]);
 }catch(error){if(/CHECK constraint|UNIQUE constraint/.test(String(error)))fail(403,'invalid_recovery_code');throw error;}
 return json({ok:true},200,{'Set-Cookie':'__Host-fr_session=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0'});
}

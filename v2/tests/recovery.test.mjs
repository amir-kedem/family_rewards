import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../worker/index.ts';
import {hashPassword,digest} from '../worker/security.ts';
async function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(readFileSync(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8'));
 let queue=Promise.resolve(),beforeBatch;
 const DB={prepare(query){let args=[];const s={bind(...v){args=v;return s;},async first(){return sql.prepare(query).get(...args)||null;},async all(){return{results:sql.prepare(query).all(...args)};},async run(){return sql.prepare(query).run(...args);}};return s;},batch(statements){const go=async()=>{if(beforeBatch){const action=beforeBatch;beforeBatch=undefined;action();}sql.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}};const result=queue.then(go);queue=result.catch(()=>{});return result;}};
 const env={DB,FAMILY_PASSWORD_HASH:await hashPassword('family'),PARENT_PASSWORD_HASH:await hashPassword('parent')};
 let cookie='';
 async function call(path,input,options={}){
  const headers={Cookie:cookie,...(input===undefined?{}:{Origin:'https://family.test','Content-Type':'application/json'}),...options.headers};
  const r=await worker.fetch(new Request('https://family.test/api'+path,{method:input===undefined?'GET':'POST',headers,body:input===undefined?undefined:JSON.stringify(input)}),env);
  if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
  return {status:r.status,data:await r.json(),cookie,headers:r.headers};
 }
 async function loginParent(){await call('/login',{password:'family'});return call('/parent/login',{password:'parent'});}
 async function code(){const r=await call('/recovery/code',{parentPassword:'parent'});assert.equal(r.status,200);return r.data.code;}
 return {sql,env,call,loginParent,code,beforeBatch(fn){beforeBatch=fn;}};
}
test('legacy families keep login and lazily opt into recovery only after authenticated reauthentication',async()=>{
 const f=await fixture();
 assert.equal((await f.call('/setup')).data.required,false);
 assert.equal((await f.call('/recovery/code',{parentPassword:'parent'})).status,401);
 await f.call('/login',{password:'family'});
 assert.equal((await f.call('/recovery/code',{parentPassword:'parent'})).status,403);
 await f.call('/parent/login',{password:'parent'});
 assert.equal((await f.call('/recovery/code',{parentPassword:'bad'})).status,401);
 assert.equal(f.sql.prepare("SELECT name FROM sqlite_master WHERE name='parent_recovery'").get(),undefined);
 const r=await f.call('/recovery/code',{parentPassword:'parent'});
 assert.equal(r.status,200);assert.match(r.data.code,/^[a-f0-9]{8}(-[a-f0-9]{8}){7}$/);
 const saved=f.sql.prepare('SELECT * FROM parent_recovery').get();
 assert.equal(saved.code_hash,await digest(r.data.code.replaceAll('-','')));
 assert(!JSON.stringify(saved).includes(r.data.code));
 assert(r.data.expiresAt>Date.now());
});
test('rotation invalidates old code; public reset is single use and revokes every session without automatic login',async()=>{
 const f=await fixture();const parent=await f.loginParent(),oldParent=parent.cookie;
 const first=await f.code(),second=await f.code();
 await f.call('/login',{password:'family'});const familyCookie=(await f.call('/state')).cookie;
 assert.equal((await f.call('/recovery/reset',{code:first,newPassword:'2468'})).status,403);
 assert.equal((await f.call('/recovery/reset',{code:second,newPassword:'family'})).status,400);
 const result=await f.call('/recovery/reset',{code:second,newPassword:'2468'});
 assert.equal(result.status,200);assert.deepEqual(result.data,{ok:true});
 assert.match(result.headers.get('set-cookie'),/Max-Age=0/);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM sessions').get().n,0);
 assert.equal((await f.call('/state',undefined,{headers:{Cookie:oldParent}})).status,401);
 assert.equal((await f.call('/state',undefined,{headers:{Cookie:familyCookie}})).status,401);
 assert.equal((await f.call('/recovery/reset',{code:second,newPassword:'9876'})).status,403);
 await f.call('/login',{password:'family'});
 assert.equal((await f.call('/parent/login',{password:'parent'})).status,401);
 assert.equal((await f.call('/parent/login',{password:'2468'})).status,200);
});
test('parent recovery preserves family credentials and household data',async()=>{
 const f=await fixture();await f.loginParent();const code=await f.code();
 f.sql.exec("INSERT INTO members(id,name,points) VALUES ('child','Child',190)");
 assert.equal((await f.call('/recovery/reset',{code,newPassword:'2468'})).status,200);
 assert.equal((await f.call('/parent/login',{password:'2468'})).status,200);
 assert.equal((await f.call('/state')).data.members[0].points,190);
 assert.equal((await f.call('/login',{password:'family'})).status,200);
});
test('invalid, expired, oversized, cross-origin and excessive attempts do not consume a valid code',async()=>{
 const f=await fixture();await f.loginParent();const code=await f.code();
 assert.equal((await f.call('/recovery/reset',{code,newPassword:'2468'},{headers:{Origin:'https://evil.test'}})).status,403);
 assert.equal((await f.call('/recovery/reset',{code,newPassword:'2468'},{headers:{'Content-Type':'text/plain'}})).status,415);
 assert.equal((await f.call('/recovery/reset',{code,newPassword:'2468',padding:'a'.repeat(9000)})).status,413);
 f.sql.exec('UPDATE parent_recovery SET expires_at=0');
 assert.equal((await f.call('/recovery/reset',{code,newPassword:'2468'})).status,403);
 f.sql.exec('UPDATE parent_recovery SET expires_at=9999999999999');
 for(let i=0;i<9;i++)assert.equal((await f.call('/recovery/reset',{code:'invalid',newPassword:'2468'})).status,403);
 assert.equal((await f.call('/recovery/reset',{code,newPassword:'2468'})).status,429);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM parent_recovery').get().n,1);
});
test('simultaneous valid recovery attempts consume the code exactly once',async()=>{
 const f=await fixture();await f.loginParent();const code=await f.code();
 const results=await Promise.all([f.call('/recovery/reset',{code,newPassword:'2468'}),f.call('/recovery/reset',{code,newPassword:'9876'})]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,403]);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM parent_recovery').get().n,0);
});
test('a failed recovery transaction retains the code, credentials and sessions for retry',async()=>{
 const f=await fixture();await f.loginParent();const code=await f.code();
 f.sql.exec("CREATE TRIGGER simulate_failure BEFORE INSERT ON password_credentials BEGIN SELECT RAISE(ABORT,'simulated_write_failure');END;");
 assert.equal((await f.call('/recovery/reset',{code,newPassword:'2468'})).status,500);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM parent_recovery').get().n,1);
 assert.equal((await f.call('/state')).data.role,'parent');
 f.sql.exec('DROP TRIGGER simulate_failure');
 assert.equal((await f.call('/recovery/reset',{code,newPassword:'2468'})).status,200);
});
test('generation cannot finish after its parent session is revoked or parent credential changes',async()=>{
 for(const change of ['session','credential']){
  const f=await fixture();await f.loginParent();
  f.beforeBatch(()=>{if(change==='session')f.sql.exec('DELETE FROM sessions');else f.sql.exec("CREATE TABLE password_credentials(role TEXT PRIMARY KEY,password_hash TEXT NOT NULL); INSERT INTO password_credentials VALUES ('parent','changed-credential');");});
  assert.equal((await f.call('/recovery/code',{parentPassword:'parent'})).status,401);
  assert.equal(f.sql.prepare("SELECT name FROM sqlite_master WHERE name='parent_recovery'").get(),undefined);
 }
});

test('a parent can sign in directly without the family password and replace the forgotten family password',async()=>{
 const f=await fixture();
 assert.equal((await f.call('/parent/login',{password:'wrong'})).status,401);
 assert.equal((await f.call('/state')).status,401);
 assert.equal((await f.call('/parent/login',{password:'parent'})).status,200);
 assert.equal((await f.call('/state')).data.role,'parent');
 assert.equal((await f.call('/passwords',{role:'family',newPassword:'1357'})).status,200);
 assert.equal((await f.call('/login',{password:'1357'})).status,200);
});

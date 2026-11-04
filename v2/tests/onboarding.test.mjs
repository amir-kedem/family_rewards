import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../worker/index.ts';
import {digest,hashPassword} from '../worker/security.ts';
const invite='a'.repeat(64),parentPassword='4321',familyPassword='2468';
const draft={familyName:'Test family',children:[{name:'First child',emoji:'⭐',points:190},{name:'Second child',emoji:'🌱',points:140}],catalog:[{kind:'task',category:'education',title:'Read',emoji:'📚',value:20},{kind:'reward',category:'chores',title:'Game',emoji:'🎲',value:100}],familyGoal:1000,step:4};
async function fixture({id='family-one',legacy=false}={}) {
  const sql=new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8'));
  if(!legacy) {
    sql.exec(readFileSync(new URL('../migrations/0002_onboarding.sql',import.meta.url),'utf8'));
    sql.prepare('INSERT INTO instance_identity(id,instance_id,origin) VALUES (1,?,?)').run(id,'https://family.test');
    sql.prepare("INSERT INTO onboarding(id,state,invite_hash,invite_expires_at) VALUES (1,'pending',?,?)").run(await digest(invite),Date.now()+86400000);
  }
  const DB={prepare(query){let args=[];const s={bind(...values){assert(values.length<=100,'D1 bound-parameter limit');args=values;return s;},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){return sql.prepare(query).run(...args);}};return s;},async batch(statements){sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  const env={DB,...(legacy?{}:{INSTANCE_ID:id,INSTANCE_ORIGIN:'https://family.test'}),FAMILY_PASSWORD_HASH:await hashPassword('legacy-family'),PARENT_PASSWORD_HASH:await hashPassword('legacy-parent')};
  const jar=new Map();
  const cookies=()=>[...jar].map(([k,v])=>k+'='+v).join('; ');
  async function call(path,input,options={}) {
    const headers={Cookie:cookies(),...(input===undefined?{}:{Origin:'https://family.test','Content-Type':'application/json'}),...options.headers};
    const request=new Request((options.origin||'https://family.test')+'/api'+path,{method:options.method||(input===undefined?'GET':'POST'),headers,body:input===undefined?undefined:(options.raw??JSON.stringify(input))});
    const response=await worker.fetch(request,env);
    for(const cookie of response.headers.getSetCookie()) {const part=cookie.split(';')[0],i=part.indexOf('=');const key=part.slice(0,i),value=part.slice(i+1);if(value)jar.set(key,value);else jar.delete(key);}
    return {status:response.status,data:await response.json(),headers:response.headers};
  }
  const claim=()=>call('/setup/claim',{token:invite,parentPassword});
  const save=()=>call('/setup/draft',{version:0,draft});
  return {sql,env,call,claim,save,cookies};
}
test('existing installations bypass setup and cannot be claimed, including an empty unprovisioned database',async()=>{
  const f=await fixture({legacy:true});
  assert.deepEqual((await f.call('/setup')).data,{required:false});
  f.sql.exec("INSERT INTO members(id,name,points) VALUES ('existing','Existing',330)");
  assert.equal((await f.claim()).status,404);
  assert.equal((await f.call('/login',{password:'legacy-family'})).status,200);
  assert.equal((await f.call('/state')).data.members[0].points,330);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='onboarding'").get().n,0);
});
test('invalid/expired invitations, origin attacks and oversized byte payloads fail without claiming setup',async()=>{
  const f=await fixture();
  assert.equal((await f.call('/setup/claim',{token:invite,parentPassword},{headers:{Origin:'https://attacker.test'}})).status,403);
  assert.equal((await f.call('/setup/claim',{token:invite,parentPassword},{headers:{'Content-Type':'text/plain'}})).status,415);
  assert.equal((await f.call('/setup/claim',{token:'b'.repeat(64),parentPassword})).status,403);
  assert.equal((await f.call('/setup/claim',{},{raw:JSON.stringify({token:invite,parentPassword,padding:'א'.repeat(5000)})})).status,413);
  f.sql.exec('UPDATE onboarding SET invite_expires_at=0');
  assert.equal((await f.claim()).status,403);
  assert.equal(f.sql.prepare('SELECT state FROM onboarding').get().state,'pending');
});
test('only one simultaneous claim succeeds; owner cookie is secure and invite is consumed',async()=>{
  const f=await fixture();
  const results=await Promise.all([f.claim(),f.claim()]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const success=results.find(r=>r.status===200);
  const cookie=success.headers.get('set-cookie');
  for(const flag of ['__Host-fr_setup=','Secure','HttpOnly','SameSite=Strict','Path=/'])assert(cookie.includes(flag));
  const row=f.sql.prepare('SELECT * FROM onboarding').get();
  assert.equal(row.invite_hash,null);
  assert(row.parent_password_hash.startsWith('pbkdf2$'));
  assert(!JSON.stringify(success.data).includes('password_hash'));
  assert.equal((await f.call('/login',{password:'legacy-family'})).status,409);
  assert.equal((await f.claim()).status,409);
});
test('drafts are private, validated and reject stale concurrent writes; owner can resume after expiry',async()=>{
  const f=await fixture();await f.claim();
  const results=await Promise.all([f.save(),f.save()]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const publicStatus=await f.call('/setup',undefined,{headers:{Cookie:''}});
  assert.equal(publicStatus.data.authorized,false);
  assert.equal(publicStatus.data.draft,undefined);
  assert.equal((await f.call('/setup/draft',{version:1,draft},{headers:{Cookie:''}})).status,401);
  assert.equal((await f.call('/setup/draft',{version:1,draft:{...draft,children:[draft.children[0],draft.children[0]]}})).status,400);
  assert.equal((await f.call('/setup/draft',{version:1,draft:{...draft,catalog:[{...draft.catalog[0],category:'untrusted'}]}})).status,400);
  const old=f.cookies();f.sql.exec('UPDATE onboarding SET setup_expires_at=0');
  assert.equal((await f.call('/setup/draft',{version:1,draft})).status,401);
  assert.equal((await f.call('/setup/resume',{parentPassword:'wrong'})).status,401);
  const resumed=await f.call('/setup/resume',{parentPassword});
  assert.equal(resumed.status,200);assert.equal(resumed.data.version,1);assert.deepEqual(resumed.data.draft,draft);
  assert.equal((await f.call('/setup/draft',{version:1,draft},{headers:{Cookie:old}})).status,401);
});
test('completion is atomic and replay-safe; balances/order survive and passwords are independent',async()=>{
  const f=await fixture();await f.claim();await f.save();
  const setupCookie=f.cookies(),requestId=crypto.randomUUID();
  assert.equal((await f.call('/setup/complete',{version:1,familyPassword:parentPassword,requestId})).status,400);
  const complete=()=>f.call('/setup/complete',{version:1,familyPassword,requestId},{headers:{Cookie:setupCookie}});
  const responses=await Promise.all([complete(),complete()]);
  assert(responses.every(r=>r.status===200));
  assert(responses.every(r=>/^[a-f0-9]{8}(-[a-f0-9]{8}){7}$/.test(r.data.recoveryCode)));
  assert.equal(responses[0].data.recoveryCode,responses[1].data.recoveryCode);
  const raw=responses[0].data.recoveryCode.replaceAll('-','');
  const verifier=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
  const encoded=Array.from(new Uint8Array(verifier),x=>x.toString(16).padStart(2,'0')).join('');
  assert.equal(f.sql.prepare('SELECT code_hash FROM parent_recovery').get().code_hash,encoded);
  assert(!JSON.stringify(f.sql.prepare('SELECT * FROM parent_recovery').all()).includes(raw));

  assert.deepEqual(f.sql.prepare('SELECT name,points FROM members ORDER BY rowid').all().map(r=>[r.name,r.points]),[['First child',190],['Second child',140]]);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM catalog').get().n,2);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM history').get().n,0);
  assert.equal(f.sql.prepare('SELECT parent_password_hash FROM onboarding').get().parent_password_hash,null);
  assert.deepEqual((await f.call('/setup')).data,{required:false});
  assert.equal((await f.call('/setup/draft',{version:1,draft},{headers:{Cookie:setupCookie}})).status,409);
  assert.equal((await f.call('/login',{password:familyPassword})).status,200);
  assert.equal((await f.call('/parent/login',{password:parentPassword})).status,200);
  const state=await f.call('/state');assert.equal(state.data.familyName,'Test family');
  assert(!JSON.stringify(state.data).includes('pbkdf2$'));
  assert.equal((await f.call('/login',{password:'legacy-family'})).status,401);
});
test('failed completion rolls back all writes and can be retried without losing the saved draft',async()=>{
  const f=await fixture();await f.claim();await f.save();
  f.sql.exec("CREATE TRIGGER simulate_failure BEFORE INSERT ON catalog BEGIN SELECT RAISE(ABORT,'simulated failure'); END;");
  const input={version:1,familyPassword,requestId:crypto.randomUUID()};
  assert.equal((await f.call('/setup/complete',input)).status,500);
  for(const name of ['members','catalog','password_credentials','setup_completion_guard'])assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM '+name).get().n,0);
  assert.equal(f.sql.prepare('SELECT state FROM onboarding').get().state,'claimed');
  f.sql.exec('DROP TRIGGER simulate_failure');
  assert.equal((await f.call('/setup/complete',input)).status,200);
});
test('new instance identity fails closed on a wrong family database, host or missing pins',async()=>{
  const f=await fixture(),other=await fixture({id:'family-two'});
  assert.equal((await f.call('/setup',undefined,{origin:'https://wrong.test'})).status,503);
  f.env.DB=other.env.DB;
  assert.equal((await f.call('/setup')).status,503);
  assert.equal(other.sql.prepare('SELECT state FROM onboarding').get().state,'pending');
  f.env.DB=other.env.DB;delete f.env.INSTANCE_ID;delete f.env.INSTANCE_ORIGIN;
  assert.equal((await f.call('/setup')).status,503);
});
test('provisioned setup rejects existing data and rate limits bad invitations',async()=>{
  const f=await fixture();
  for(let i=0;i<20;i++)assert.equal((await f.call('/setup/claim',{token:'b'.repeat(64),parentPassword})).status,403);
  assert.equal((await f.claim()).status,429);
  f.sql.exec("INSERT INTO members(id,name,points) VALUES ('existing','Existing',500)");
  assert.equal((await f.call('/setup')).status,409);
  assert.equal(f.sql.prepare('SELECT points FROM members').get().points,500);
});
test('large catalogs stay within D1 parameter/query limits and HTML-like names stay inert data',async()=>{
  const f=await fixture();await f.claim();
  const custom={...draft,children:[{name:'<script>alert(1)</script>',emoji:'⭐',points:0}],catalog:Array.from({length:100},(_,i)=>({...draft.catalog[0],title:'Activity '+i}))};
  assert.equal((await f.call('/setup/draft',{version:0,draft:custom})).status,200);
  assert.equal((await f.call('/setup/complete',{version:1,familyPassword,requestId:crypto.randomUUID()})).status,200);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM catalog').get().n,100);
  assert.equal(f.sql.prepare('SELECT name FROM members').get().name,'<script>alert(1)</script>');
});

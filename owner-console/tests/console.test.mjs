import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {owner,seal,unseal,digest,body} from '../worker/security.mjs';
import {reserve,advance,view,createHouseholdsClass} from '../worker/households.mjs';
import {provider} from '../worker/cloudflare.mjs';
import {createRouter} from '../worker/router.mjs';
const env={PROVISIONING_ENABLED:'true',INVITATION_KEY:'12'.repeat(32),CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'test-token-do-not-log',WORKERS_SUBDOMAIN:'example',MAX_DATABASES:'10',MAX_HOUSEHOLDS:'8',OWNER_EMAIL:'owner@example.test',CONSOLE_ORIGIN:'https://owner.example.test',ACCESS_TEAM_DOMAIN:'https://example.cloudflareaccess.com',ACCESS_AUD:'b'.repeat(64)};
const initial=readFileSync(new URL('../../v2/migrations/0001_initial.sql',import.meta.url),'utf8').replace(/CREATE TABLE /g,'CREATE TABLE IF NOT EXISTS ').replace(/CREATE INDEX /g,'CREATE INDEX IF NOT EXISTS ').replace(/CREATE TRIGGER /g,'CREATE TRIGGER IF NOT EXISTS ').replace('INSERT INTO settings VALUES','INSERT OR IGNORE INTO settings VALUES');
const release={ready:true,sha:'c'.repeat(40),worker:'export default {fetch(){}}',headers:'/*\n  X-Frame-Options: DENY',assets:[{path:'/index.html',hash:'d'.repeat(32),size:4,base64:'dGVzdA==',type:'text/html'}],migrations:[{name:'0001_initial.sql',sql:initial},...['0002_onboarding.sql','0003_password_recovery.sql'].map(name=>({name,sql:readFileSync(new URL('../../v2/migrations/'+name,import.meta.url),'utf8').replace(/CREATE TABLE (?!IF NOT EXISTS)/g,'CREATE TABLE IF NOT EXISTS ')}))]};
class Storage {
 constructor(){this.map=new Map();this.queue=Promise.resolve();}
 async get(key){return structuredClone(this.map.get(key));}
 async put(key,value){this.map.set(key,structuredClone(value));}
 async setAlarm(value){this.alarm=value;}
 async transaction(fn){let unlock;const previous=this.queue;this.queue=new Promise(r=>unlock=r);await previous;try{return await fn(this);}finally{unlock();}}
}
const requestKey='1'.repeat(32);
async function job(){const storage=new Storage();const job=await reserve(storage,{label:'בית לדוגמה'},requestKey,env,release);return {storage,job};}
function fakeCloudflare(){
 const dbs=new Map(),workers=new Map(),calls=[];let sequence=0;
 const answer=(result,status=200)=>new Response(JSON.stringify({success:status===200,result}),{status,headers:{'Content-Type':'application/json'}});
 const fetcher=async (url,options={})=>{
  const parsed=new URL(url),path=parsed.pathname.replace('/client/v4/accounts/'+env.CLOUDFLARE_ACCOUNT_ID,''),method=options.method||'GET';calls.push({path,method});
  if(parsed.hostname.endsWith('.workers.dev'))return new Response(JSON.stringify({required:true,stage:'pending'}),{headers:{'Content-Type':'application/json'}});
  if(path==='/workers/subdomain')return answer({subdomain:'example'});
  if(path==='/d1/database'&&method==='GET')return answer([...dbs.values()].map(x=>({uuid:x.uuid,name:x.name})));
  if(path==='/d1/database'&&method==='POST'){const {name}=JSON.parse(options.body);const uuid='11111111-1111-4111-8111-'+String(++sequence).padStart(12,'0');dbs.set(uuid,{uuid,name,sql:new DatabaseSync(':memory:')});return answer({uuid,name});}
  const d=/^\/d1\/database\/([a-f0-9-]+)(\/query)?$/.exec(path);
  if(d){const entry=dbs.get(d[1]);assert(entry);if(!d[2])return answer({uuid:entry.uuid,name:entry.name});const {sql,params}=JSON.parse(options.body);try{let results=[],changes=0;if(/^SELECT /i.test(sql))results=entry.sql.prepare(sql).all(...params);else if(params.length)changes=Number(entry.sql.prepare(sql).run(...params).changes);else entry.sql.exec(sql);return answer([{success:true,results,meta:{changes}}]);}catch{return answer(null,500);}}
  const w=/^\/workers\/scripts\/([a-z0-9-]+)(\/(settings|assets-upload-session|subdomain|schedules))?$/.exec(path);
  if(w){const name=w[1],action=w[3];if(action==='settings')return workers.has(name)?answer({bindings:workers.get(name).bindings}):answer(null,404);
   if(action==='assets-upload-session'){assert(workers.has(name));return answer({buckets:[[release.assets[0].hash]],jwt:'upload-token'});}
   if(action==='subdomain'||action==='schedules')return answer({});
   if(method==='PUT'){const metadata=JSON.parse(await options.body.get('metadata').text());assert(metadata.bindings.some(x=>x.type==='d1'));if(metadata.assets){assert.equal(metadata.assets.jwt,'completion-token');assert(metadata.bindings.some(x=>x.type==='assets'));assert.equal(metadata.assets.config._headers,release.headers);}workers.set(name,metadata);return answer({});}}
  if(path==='/workers/assets/upload'){assert.equal(options.headers.Authorization,'Bearer upload-token');assert(options.body.has(release.assets[0].hash));return answer({jwt:'completion-token'});}
  throw Error('Unexpected test request: '+path);
 };return {fetcher,dbs,workers,calls};
}
test('owner authentication verifies signed Access token, audience, expiry, origin and exact email',async()=>{
 const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);const jwk=await crypto.subtle.exportKey('jwk',pair.publicKey);jwk.kid='unit-key';
 const base={iss:env.ACCESS_TEAM_DOMAIN,aud:[env.ACCESS_AUD],email:env.OWNER_EMAIL,sub:'verified-owner',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300};
 const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
 async function token(claims=base){const h=encode({alg:'RS256',kid:'unit-key'}),p=encode(claims),s=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(h+'.'+p));return h+'.'+p+'.'+Buffer.from(s).toString('base64url');}
 const certs=async url=>{assert.equal(url,env.ACCESS_TEAM_DOMAIN+'/cdn-cgi/access/certs');return new Response(JSON.stringify({keys:[jwk]}));};
 const req=t=>new Request(env.CONSOLE_ORIGIN+'/',{headers:{'Cf-Access-Jwt-Assertion':t}});
 assert.equal(await owner(req(await token()),env,certs),env.OWNER_EMAIL);
 for(const changes of [{aud:['wrong']},{email:'another@example.test'},{exp:0},{iss:'https://evil.test'},{iat:Date.now()/1000+500}])await assert.rejects(owner(req(await token({...base,...changes})),env,certs));
 await assert.rejects(owner(req((await token()).slice(0,-5)+'AAAAA'),env,certs));
 await assert.rejects(owner(new Request(env.CONSOLE_ORIGIN),env,certs));
 await assert.rejects(owner(new Request('https://different.test',{headers:{'Cf-Access-Jwt-Assertion':await token()}}),env,certs));
});
test('invitation encryption is authenticated; only a hash/ciphertext is kept in status storage',async()=>{
 const {job:j}=await job(),raw=await unseal(j.invitation,env.INVITATION_KEY);assert.match(raw,/^[a-f0-9]{64}$/);assert.equal(await digest(raw),j.inviteHash);assert(!JSON.stringify(j).includes(raw));assert(!JSON.stringify(view(j)).includes(j.inviteHash));assert(!JSON.stringify(view(j)).includes('invitation'));
 const encrypted=await seal('private token',env.INVITATION_KEY);encrypted.data[0]^=1;await assert.rejects(unseal(encrypted,env.INVITATION_KEY));await assert.rejects(unseal(j.invitation,'34'.repeat(32)));
});
test('two create submissions with one request key reserve exactly one independent household',async()=>{
 const storage=new Storage(),[a,b]=await Promise.all([reserve(storage,{label:'Sample'},requestKey,env,release),reserve(storage,{label:'Sample'},requestKey,env,release)]);assert.equal(a.id,b.id);assert.equal((await storage.get('ids')).length,1);assert(a.workerName.startsWith('fr-house-'));assert.notEqual(a.databaseName,'family-rewards-v2');
 await assert.rejects(reserve(storage,{label:'Other'},requestKey,env,release));
 await assert.rejects(reserve(storage,{label:'Sample',databaseId:'production'},'2'.repeat(32),env,release));
 await assert.rejects(reserve(storage,{label:'Sample'},'../main',env,release));
 await assert.rejects(reserve(storage,{label:'Sample'},'2'.repeat(32),{...env,PROVISIONING_ENABLED:'false'},release));
});
test('provisioning performs ordered isolated creation, tracked idempotent schema and assets deployment',async()=>{
 const {job:j,storage}=await job(),cf=fakeCloudflare(),p=provider(env,cf.fetcher);
 for(let i=0;i<6;i++)await advance(j,storage,env,release,p);
 assert.equal(j.status,'ready');assert.equal(cf.dbs.size,1);assert.equal(cf.workers.size,1);assert.equal(j.origin,'https://'+j.workerName+'.example.workers.dev');
 const db=cf.dbs.get(j.databaseId).sql;assert.equal(db.prepare('SELECT COUNT(*) AS n FROM members').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM d1_migrations').get().n,3);assert.equal(db.prepare('SELECT instance_id FROM instance_identity').get().instance_id,j.id);assert.equal(db.prepare('SELECT invite_hash FROM onboarding').get().invite_hash,j.inviteHash);
 await p.schema(j,release);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM settings').get().n,1);await p.invitationState(j);
 db.exec("UPDATE onboarding SET state='claimed'");await assert.rejects(p.invitationState(j));await assert.rejects(p.schema(j,release));
});
test('an interrupted database creation is never blindly repeated',async()=>{
 const {job:j,storage}=await job();let creates=0;const p={preflight:async()=>{},createDatabase:async()=>{creates++;throw Error('Network interrupted');}};
 await advance(j,storage,env,release,p);await advance(j,storage,env,release,p);assert.equal(j.status,'failed');assert.equal(j.step,'creating_database');assert.equal(view(j).retryable,false);
 j.status='working';await advance(j,storage,env,release,p);assert.equal(creates,1);assert.equal(j.error,'database_creation_needs_review');
});
test('capacity and resource collisions stop before creation; changed bindings stop deployment',async()=>{
 const {job:j,storage}=await job(),cf=fakeCloudflare();for(let i=0;i<10;i++)cf.dbs.set(String(i),{uuid:String(i),name:'existing-'+i});
 await advance(j,storage,env,release,provider(env,cf.fetcher));assert.equal(j.status,'failed');assert.equal(j.error,'database_capacity_reached');assert(!cf.calls.some(x=>x.method==='POST'));
 const f=await job(),other=fakeCloudflare();other.workers.set(f.job.workerName,{bindings:[]});await advance(f.job,f.storage,env,release,provider(env,other.fetcher));assert.equal(f.job.error,'resource_already_exists');
 const g=await job(),third=fakeCloudflare(),p=provider(env,third.fetcher);for(let i=0;i<4;i++)await advance(g.job,g.storage,env,release,p);third.workers.get(g.job.workerName).bindings[0].id='wrong';await advance(g.job,g.storage,env,release,p);assert.equal(g.job.error,'resource_identity_mismatch');assert.equal(view(g.job).retryable,false);
});
test('nonempty household data and a changed approved version cannot be initialized over',async()=>{
 const {job:j,storage}=await job(),cf=fakeCloudflare(),p=provider(env,cf.fetcher);await advance(j,storage,env,release,p);await advance(j,storage,env,release,p);await p.schema(j,release);
 cf.dbs.get(j.databaseId).sql.exec("INSERT INTO members VALUES ('child','Original','⭐',123,1)");await assert.rejects(p.schema(j,release));assert.equal(cf.dbs.get(j.databaseId).sql.prepare('SELECT points FROM members').get().points,123);
 const f=await job();await advance(f.job,f.storage,env,{...release,sha:'e'.repeat(40)},{});assert.equal(f.job.status,'failed');assert.equal(f.job.error,'approved_release_changed');
});
test('private object responses hide invitation data and accept only verified owner forwarding',async()=>{
 const {job:j,storage}=await job(),Households=createHouseholdsClass(release),object=new Households({storage},env);
 const denied=await object.fetch(new Request('https://private/api/households'));assert.equal(denied.status,403);
 const result=await object.fetch(new Request('https://private/api/households',{headers:{'X-Verified-Owner':env.OWNER_EMAIL}}));assert.equal(result.status,200);const text=await result.text();assert(!text.includes(j.inviteHash));assert(!text.includes('test-token'));assert.equal(result.headers.get('Cache-Control'),'no-store');
});
test('body parser rejects oversize, malformed and non-JSON requests',async()=>{
 await assert.rejects(body(new Request('https://test',{method:'POST',body:'{}'})));
 await assert.rejects(body(new Request('https://test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label:'א'.repeat(3000)})})));
 for(const value of ['[]','null','{'])await assert.rejects(body(new Request('https://test',{method:'POST',headers:{'Content-Type':'application/json'},body:value})));
});
test('owner router protects assets and writes, strips credential headers, and never trusts supplied owner identity',async()=>{
 let forwarded,authenticated=0;const router=createRouter(async()=>{authenticated++;return env.OWNER_EMAIL;});
 const bindings={...env,HOUSEHOLDS:{idFromName:()=>1,get:()=>({fetch:async request=>{forwarded=request;return new Response('{}');}})},ASSETS:{fetch:async()=>new Response('<h1>Private</h1>',{headers:{'Content-Type':'text/html'}})}};
 assert.equal((await router.fetch(new Request(env.CONSOLE_ORIGIN+'/api/households',{method:'POST',headers:{Origin:'https://evil.test','Content-Type':'application/json'},body:'{}'}),bindings)).status,403);assert.equal(forwarded,undefined);
 const request=new Request(env.CONSOLE_ORIGIN+'/api/households',{headers:{'X-Verified-Owner':'attacker@test','Cf-Access-Jwt-Assertion':'private-jwt',Cookie:'private-cookie'}});await router.fetch(request,bindings);assert.equal(forwarded.headers.get('X-Verified-Owner'),env.OWNER_EMAIL);assert.equal(forwarded.headers.get('Cookie'),null);assert.equal(forwarded.headers.get('Cf-Access-Jwt-Assertion'),null);
 const page=await router.fetch(new Request(env.CONSOLE_ORIGIN+'/'),bindings);assert.equal(page.headers.get('Cache-Control'),'no-store');assert(page.headers.get('Content-Security-Policy').includes("frame-ancestors 'none'"));assert.equal(authenticated,3);
 const denied=createRouter(async()=>{throw new Error('private internal error');});const response=await denied.fetch(new Request(env.CONSOLE_ORIGIN),bindings);assert.equal(response.status,500);assert(!(await response.text()).includes('private internal error'));
});
test('unclaimed invitation renewal is retry-safe and cannot reclaim an already claimed family',async()=>{
 const {job:j,storage}=await job(),cf=fakeCloudflare(),p=provider(env,cf.fetcher);for(let i=0;i<6;i++)await advance(j,storage,env,release,p);
 const Households=createHouseholdsClass(release),object=new Households({storage},env),originalFetch=globalThis.fetch;globalThis.fetch=cf.fetcher;
 try{
  const request=key=>new Request('https://private/api/households/'+j.id+'/renew',{method:'POST',headers:{'X-Verified-Owner':env.OWNER_EMAIL,'Content-Type':'application/json','Idempotency-Key':key},body:'{}'});
  const [a,b]=await Promise.all([object.fetch(request('2'.repeat(32))),object.fetch(request('2'.repeat(32)))]);assert.equal(a.status,200);assert.equal(b.status,200);const av=await a.json(),bv=await b.json();assert.equal(av.url,bv.url);assert(av.url.startsWith(j.origin+'/#setup='));assert.notEqual((await storage.get('job:'+j.id)).inviteHash,j.inviteHash);
  cf.dbs.get(j.databaseId).sql.exec("UPDATE onboarding SET state='claimed'");assert.equal((await object.fetch(request('3'.repeat(32)))).status,409);
 }finally{globalThis.fetch=originalFetch;}
});
test('reviewed database resolution is restricted to the job’s reserved empty resource',async()=>{
 const {job:j}=await job(),cf=fakeCloudflare(),p=provider(env,cf.fetcher);const id=await p.createDatabase(j);assert.equal(await p.resolveDatabase(j,id),id);
 const other={...j,databaseName:'family-rewards-v2'};await assert.rejects(p.resolveDatabase(other,id));await assert.rejects(p.resolveDatabase(j,'../../original'));
 const db=cf.dbs.get(id);db.name='family-rewards-v2';await assert.rejects(p.resolveDatabase(j,id));
});
test('release export includes only completed households and never includes invitation or private labels',async()=>{
 const {job:j,storage}=await job(),cf=fakeCloudflare(),p=provider(env,cf.fetcher);for(let i=0;i<6;i++)await advance(j,storage,env,release,p);
 const object=new (createHouseholdsClass(release))({storage},env),previous=globalThis.fetch;globalThis.fetch=cf.fetcher;
 const request=()=>new Request('https://private/api/registry',{headers:{'X-Verified-Owner':env.OWNER_EMAIL}});
 try{assert.equal((await (await object.fetch(request())).json()).instances.length,0);cf.dbs.get(j.databaseId).sql.exec("UPDATE onboarding SET state='complete'");const data=await (await object.fetch(request())).json();assert.equal(data.instances.length,1);assert.equal(data.instances[0].origin,j.origin);assert.equal(data.instances[0].buildsDisconnected,true);const text=JSON.stringify(data);for(const privateValue of [j.label,j.inviteHash,env.CLOUDFLARE_API_TOKEN])assert(!text.includes(privateValue));}finally{globalThis.fetch=previous;}
});

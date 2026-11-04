import {digest,hashPassword,verifyPassword} from './security.ts';
import {body,fail,json} from './http.ts';
type Statement={bind(...values:unknown[]):Statement;first<T=any>():Promise<T|null>;all<T=any>():Promise<{results:T[]}>;run():Promise<unknown>};
export type SetupEnv={DB:{prepare(sql:string):Statement;batch(statements:Statement[]):Promise<unknown>};INSTANCE_ID?:string;INSTANCE_ORIGIN?:string};
type Child={name:string;emoji:string;points:number};
type Catalog={kind:'task'|'reward';category:string;title:string;emoji:string;value:number};
export type SetupDraft={familyName:string;children:Child[];catalog:Catalog[];familyGoal:number;step:number};
async function completionRecovery(env:SetupEnv,token:string,requestId:string,replayed=false) {
  // A deterministic code permits an authenticated completion retry without
  // storing the raw code. The setup cookie is a random 256-bit secret.
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(token),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const raw=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('family-rewards-setup-recovery-v1:'+requestId))),x=>x.toString(16).padStart(2,'0')).join('');
  return {raw,code:raw.match(/.{8}/g)!.join('-')};
}
async function completionResponse(env:SetupEnv,token:string,requestId:string,replayed=false) {
  const code=await completionRecovery(env,token,requestId);
  const saved=await env.DB.prepare('SELECT code_hash,expires_at FROM parent_recovery WHERE id=1').first();
  return json({complete:true,...(replayed?{replayed:true}:{}),...(saved?.code_hash===await digest(code.raw)?{recoveryCode:code.code,recoveryExpiresAt:saved.expires_at}:{})});
}
const SESSION_MS=30*60*1000;
const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
const setupCookie=(token:string)=>`__Host-fr_setup=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=1800`;
function cookieToken(request:Request) {
  const value=request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('__Host-fr_setup='))?.slice('__Host-fr_setup='.length);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
async function table(env:SetupEnv,name:string) {
  return Boolean(await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(name).first());
}
export async function verifyInstance(request:Request,env:SetupEnv) {
  if(!env.INSTANCE_ID && !env.INSTANCE_ORIGIN) {
    // Legacy installations remain usable, but a pinned database cannot silently
    // lose its identity checks through an incomplete deployment configuration.
    if(await table(env,'instance_identity')) {
      if(await env.DB.prepare('SELECT id FROM instance_identity WHERE id=1').first()) fail(503,'instance_binding_mismatch');
    }
    return;
  }
  if(!env.INSTANCE_ID || !env.INSTANCE_ORIGIN || new URL(request.url).origin!==env.INSTANCE_ORIGIN || !await table(env,'instance_identity')) fail(503,'instance_binding_mismatch');
  const identity=await env.DB.prepare('SELECT instance_id,origin FROM instance_identity WHERE id=1').first();
  if(!identity || identity.instance_id!==env.INSTANCE_ID || identity.origin!==env.INSTANCE_ORIGIN) fail(503,'instance_binding_mismatch');
}
async function setupRow(env:SetupEnv) {
  if(!await table(env,'onboarding')) return null;
  return env.DB.prepare('SELECT * FROM onboarding WHERE id=1').first();
}
async function assertEmpty(env:SetupEnv) {
  const row=await env.DB.prepare('SELECT (SELECT COUNT(*) FROM members)+(SELECT COUNT(*) FROM catalog)+(SELECT COUNT(*) FROM history) AS count').first();
  if(row.count!==0) fail(409,'setup_existing_data');
}
function password(value:unknown) {
  if(typeof value!=='string' || value.length<4 || value.length>256 || value!==value.trim()) fail(400,'invalid_setup_password');
  return value as string;
}
function text(value:unknown,max:number) {
  if(typeof value!=='string' || !value.trim() || value.length>max || /[\u0000-\u001f]/u.test(value)) fail(400,'invalid_setup_data');
  return value.trim();
}
function number(value:unknown,min:number,max:number):number {
  if(!Number.isSafeInteger(value) || Number(value)<min || Number(value)>max) fail(400,'invalid_setup_data');
  return value as number;
}
export function validateDraft(input:any,final=false):SetupDraft {
  if(!input || typeof input!=='object' || !Array.isArray(input.children) || input.children.length>12 || (final && !input.children.length) || !Array.isArray(input.catalog) || input.catalog.length>100) fail(400,'invalid_setup_data');
  const names=new Set<string>();
  const children=input.children.map((child:any)=>{
    if(!child || typeof child!=='object') fail(400,'invalid_setup_data');
    const name=text(child.name,40),key=name.normalize('NFKC').toLocaleLowerCase();
    if(names.has(key)) fail(400,'duplicate_child_name'); names.add(key);
    return {name,emoji:text(child.emoji,16),points:number(child.points,0,1_000_000_000)};
  });
  const catalog=input.catalog.map((item:any)=>{
    if(!item || !['task','reward'].includes(item.kind) || !['chores','education','behavior'].includes(item.category)) fail(400,'invalid_setup_data');
    return {kind:item.kind,category:item.category,title:text(item.title,150),emoji:text(item.emoji,16),value:number(item.value,1,1_000_000)};
  });
  return {familyName:text(input.familyName,60),children,catalog,familyGoal:number(input.familyGoal,1,1_000_000_000),step:number(input.step,1,4)};
}
function draftOf(row:any):SetupDraft {
  const stored=JSON.parse(row.draft_json);
  return stored.familyName ? stored : {familyName:'הבית שלנו',children:[],catalog:[],familyGoal:5000,step:1};
}
async function reserveAttempt(env:SetupEnv,bucket:string,maximum:number) {
  const now=Date.now();
  await env.DB.prepare('INSERT INTO login_attempts VALUES (?,0,?) ON CONFLICT(bucket) DO UPDATE SET failures=0,reset_at=excluded.reset_at WHERE login_attempts.reset_at<=?').bind(bucket,now+900000,now).run();
  if(!await env.DB.prepare('UPDATE login_attempts SET failures=failures+1 WHERE bucket=? AND failures<? RETURNING failures').bind(bucket,maximum).first()) fail(429,'try_again_later');
}
async function owner(request:Request,row:any,allowComplete=false) {
  const token=cookieToken(request);
  if(!token || row.setup_expires_at<=Date.now() || !row.setup_session_hash || await digest(token)!==row.setup_session_hash || (!allowComplete && row.state!=='claimed')) fail(401,'setup_login_required');
  return token;
}
export async function setupRequired(env:SetupEnv) {
  const row=await setupRow(env);
  return Boolean(row && row.state!=='complete');
}
export async function onboarding(request:Request,env:SetupEnv):Promise<Response> {
  const path=new URL(request.url).pathname;
  const row=await setupRow(env);
  if(path==='/api/setup' && request.method==='GET') {
    if(!row || row.state==='complete') return json({required:false});
    await assertEmpty(env);
    let authorized=false;
    if(row.state==='claimed') { try {await owner(request,row);authorized=true;} catch {} }
    return json({required:true,stage:row.state,authorized,...(authorized?{draft:draftOf(row),version:row.draft_version}:{})});
  }
  if(!row) fail(404,'setup_not_enabled');
  if(!env.INSTANCE_ID || !env.INSTANCE_ORIGIN) fail(503,'instance_binding_mismatch');
  if(request.method!=='POST') fail(405,'method_not_allowed');
  if(path==='/api/setup/claim') {
    if(row.state!=='pending') fail(409,'setup_unavailable');
    await assertEmpty(env);
    await reserveAttempt(env,'setup_claim',20);
    const input=await body(request);
    if(typeof input.token!=='string' || !/^[a-f0-9]{64}$/.test(input.token) || row.invite_expires_at<=Date.now() || await digest(input.token)!==row.invite_hash) fail(403,'setup_invitation_invalid');
    const encoded=await hashPassword(password(input.parentPassword)),token=randomToken();
    const claimed=await env.DB.prepare("UPDATE onboarding SET state='claimed',invite_hash=NULL,parent_password_hash=?,setup_session_hash=?,setup_expires_at=? WHERE id=1 AND state='pending' AND invite_hash=? AND invite_expires_at>? RETURNING id").bind(encoded,await digest(token),Date.now()+SESSION_MS,row.invite_hash,Date.now()).first();
    if(!claimed) fail(409,'setup_unavailable');
    return json({required:true,stage:'claimed',authorized:true,draft:draftOf(row),version:row.draft_version},200,{'Set-Cookie':setupCookie(token)});
  }
  if(path==='/api/setup/resume') {
    if(row.state!=='claimed') fail(409,'setup_unavailable');
    await assertEmpty(env);await reserveAttempt(env,'setup_resume',10);
    const input=await body(request);
    if(!await verifyPassword(password(input.parentPassword),row.parent_password_hash)) fail(401,'incorrect_password');
    const token=randomToken();
    const updated=await env.DB.prepare("UPDATE onboarding SET setup_session_hash=?,setup_expires_at=? WHERE id=1 AND state='claimed' RETURNING id").bind(await digest(token),Date.now()+SESSION_MS).first();
    if(!updated) fail(409,'setup_unavailable');
    return json({required:true,stage:'claimed',authorized:true,draft:draftOf(row),version:row.draft_version},200,{'Set-Cookie':setupCookie(token)});
  }
  const token=await owner(request,row,true);
  if(path==='/api/setup/draft') {
    if(row.state!=='claimed') fail(409,'setup_unavailable');
    const input=await body(request,65536),draft=validateDraft(input.draft);
    const version=number(input.version,0,1_000_000);
    const saved=await env.DB.prepare("UPDATE onboarding SET draft_json=?,draft_version=draft_version+1,setup_expires_at=? WHERE id=1 AND state='claimed' AND draft_version=? AND setup_session_hash=? AND setup_expires_at>? RETURNING draft_version").bind(JSON.stringify(draft),Date.now()+SESSION_MS,version,await digest(token),Date.now()).first();
    if(!saved) fail(409,'setup_changed_refresh');
    return json({draft,version:saved.draft_version},200,{'Set-Cookie':setupCookie(token)});
  }
  if(path==='/api/setup/complete') {
    const input=await body(request);
    if(typeof input.requestId!=='string' || !/^[a-f0-9-]{36}$/.test(input.requestId)) fail(400,'invalid_setup_data');
    if(row.state==='complete') {
      if(row.completion_key===input.requestId) return completionResponse(env,token,input.requestId,true);
      fail(409,'setup_unavailable');
    }
    await assertEmpty(env);
    const draft=validateDraft(draftOf(row),true),version=number(input.version,0,1_000_000);
    if(version!==row.draft_version) fail(409,'setup_changed_refresh');
    const familyPassword=password(input.familyPassword);
    if(await verifyPassword(familyPassword,row.parent_password_hash)) fail(400,'passwords_must_differ');
    const encoded=await hashPassword(familyPassword),parentToken=randomToken(),recovery=await completionRecovery(env,token,input.requestId),recoveryExpiresAt=Date.now()+365*86400000;
    const statements=[env.DB.prepare("INSERT INTO setup_completion_guard SELECT 1,CASE WHEN (SELECT COUNT(*) FROM members)+(SELECT COUNT(*) FROM catalog)+(SELECT COUNT(*) FROM history)=0 AND EXISTS(SELECT 1 FROM onboarding WHERE id=1 AND state='claimed' AND draft_version=? AND setup_session_hash=? AND setup_expires_at>?) THEN 1 ELSE 0 END").bind(version,await digest(token),Date.now())];
    statements.push(env.DB.prepare('INSERT INTO members(id,name,emoji,points,is_child) VALUES '+draft.children.map(()=>'(?,?,?,?,1)').join(',')).bind(...draft.children.flatMap(child=>['m-'+crypto.randomUUID(),child.name,child.emoji,child.points])));
    // Keep each statement below D1's bound-parameter limit and the number of
    // queries per invocation small even for a large starter catalog.
    for(let i=0;i<draft.catalog.length;i+=16) {
      const items=draft.catalog.slice(i,i+16);
      statements.push(env.DB.prepare('INSERT INTO catalog(id,kind,category,title,value,emoji) VALUES '+items.map(()=>'(?,?,?,?,?,?)').join(',')).bind(...items.flatMap(item=>[crypto.randomUUID(),item.kind,item.category,item.title,item.value,item.emoji])));
    }
    statements.push(env.DB.prepare("CREATE TABLE IF NOT EXISTS parent_recovery (id INTEGER PRIMARY KEY CHECK(id=1),code_hash TEXT NOT NULL,expires_at INTEGER NOT NULL)"),env.DB.prepare('INSERT INTO parent_recovery VALUES (1,?,?)').bind(await digest(recovery.raw),recoveryExpiresAt));
    statements.push(env.DB.prepare('UPDATE settings SET family_goal=? WHERE id=1').bind(draft.familyGoal),
      env.DB.prepare('UPDATE instance_identity SET family_name=? WHERE id=1').bind(draft.familyName),
      env.DB.prepare("INSERT INTO password_credentials VALUES ('family',?),('parent',?)").bind(encoded,row.parent_password_hash),
      env.DB.prepare("INSERT INTO sessions VALUES (?,'parent',?)").bind(await digest(parentToken),Date.now()+SESSION_MS),
      env.DB.prepare("UPDATE onboarding SET state='complete',draft_json='{}',parent_password_hash=NULL,completion_key=?,setup_expires_at=? WHERE id=1").bind(input.requestId,Date.now()+300000));
    try { await env.DB.batch(statements); }
    catch(error) {
      const latest=await setupRow(env);
      if(latest?.state==='complete' && latest.completion_key===input.requestId) return completionResponse(env,token,input.requestId,true);
      if(/constraint/i.test(String(error))) fail(409,'setup_changed_refresh');
      throw error;
    }
    const response=await completionResponse(env,token,input.requestId);
    response.headers.append('Set-Cookie',`__Host-fr_session=${parentToken}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=1800`);
    response.headers.append('Set-Cookie','__Host-fr_setup=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0');
    return response;
  }
  fail(404,'not_found');
}

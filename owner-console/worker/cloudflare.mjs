import {fail} from './security.mjs';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
export function provider(env,fetcher=fetch){
 if(!/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID||'')||!env.CLOUDFLARE_API_TOKEN||!/^[a-z0-9-]+$/.test(env.WORKERS_SUBDOMAIN||''))fail(503,'cloudflare_configuration_required');
 const base='https://api.cloudflare.com/client/v4/accounts/'+env.CLOUDFLARE_ACCOUNT_ID;
 const target=job=>{if(!/^house-[a-f0-9]{32}$/.test(job.id)||job.workerName!=='fr-'+job.id||job.databaseName!==job.workerName+'-db'||job.origin!=='https://'+job.workerName+'.'+env.WORKERS_SUBDOMAIN+'.workers.dev')fail(409,'resource_identity_mismatch');};
 async function api(path,method='GET',payload,token=env.CLOUDFLARE_API_TOKEN,missing=false){
  let response;try{response=await fetcher(base+path,{method,redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+token,...(payload instanceof FormData?{}:payload===undefined?{}:{'Content-Type':'application/json'})},body:payload===undefined?undefined:payload instanceof FormData?payload:JSON.stringify(payload)});}catch{fail(502,'cloudflare_request_uncertain');}
  if(missing&&response.status===404)return null;
  if(!response.ok)fail(502,'cloudflare_request_failed');
  let data;try{data=await response.json();}catch{fail(502,'cloudflare_invalid_response');}
  if(data.success!==true)fail(502,'cloudflare_request_failed');return data.result;
 }
 const query=async (job,sql,params=[])=>{target(job);if(!uuid(job.databaseId))fail(409,'database_not_registered');const r=await api('/d1/database/'+job.databaseId+'/query','POST',{sql,params});if(!Array.isArray(r)||r.some(x=>x.success===false))fail(502,'database_query_failed');return r;};
 const settings=job=>{target(job);return api('/workers/scripts/'+job.workerName+'/settings','GET',undefined,undefined,true);};
 function assertSettings(job,data){
  const b=data?.bindings;if(!Array.isArray(b)||b.filter(x=>x.type==='d1').length!==1||!b.some(x=>x.type==='d1'&&x.name==='DB'&&x.id===job.databaseId)||!b.some(x=>x.type==='plain_text'&&x.name==='INSTANCE_ID'&&x.text===job.id)||!b.some(x=>x.type==='plain_text'&&x.name==='INSTANCE_ORIGIN'&&x.text===job.origin))fail(409,'resource_identity_mismatch');
 }
 const bindings=job=>[{type:'d1',name:'DB',id:job.databaseId},{type:'plain_text',name:'INSTANCE_ID',text:job.id},{type:'plain_text',name:'INSTANCE_ORIGIN',text:job.origin}];
 async function putWorker(job,source,assets){
  const form=new FormData();form.append('metadata',new Blob([JSON.stringify({main_module:'family.mjs',compatibility_date:'2026-11-04',bindings:[...bindings(job),...(assets?[{type:'assets',name:'ASSETS'}]:[])],...(assets?{assets}:{})})],{type:'application/json'}));form.append('family.mjs',new Blob([source],{type:'application/javascript+module'}),'family.mjs');await api('/workers/scripts/'+job.workerName,'PUT',form);
 }
 return {
  async preflight(job){
   target(job);
   const sub=await api('/workers/subdomain');if(sub.subdomain!==env.WORKERS_SUBDOMAIN)fail(409,'account_subdomain_mismatch');
   const databases=await api('/d1/database?per_page=100');const cap=Number(env.MAX_DATABASES||10);
   if(!Number.isInteger(cap)||cap<1||cap>10||!Array.isArray(databases)||databases.length>=cap)fail(409,'database_capacity_reached');
   if(databases.some(x=>x.name===job.databaseName)||await settings(job))fail(409,'resource_already_exists');
  },
  async createDatabase(job){target(job);const data=await api('/d1/database','POST',{name:job.databaseName});if(!uuid(data.uuid)||data.name!==job.databaseName)fail(502,'database_creation_uncertain');return data.uuid;},
  async resolveDatabase(job,id){target(job);if(!uuid(id))fail(400,'invalid_database_id');const checked={...job,databaseId:id},info=await api('/d1/database/'+id);if(info.uuid!==id||info.name!==job.databaseName)fail(409,'resource_identity_mismatch');const tables=await query(checked,"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('members','catalog','history')");for(const row of tables[0].results){if(!['members','catalog','history'].includes(row.name))fail(502,'database_query_failed');const count=await query(checked,'SELECT COUNT(*) AS n FROM '+row.name);if(count[0].results[0].n!==0)fail(409,'household_not_empty');}return id;},
  async schema(job,release){
   const info=await api('/d1/database/'+job.databaseId);if(info.uuid!==job.databaseId||info.name!==job.databaseName)fail(409,'resource_identity_mismatch');
   await query(job,'CREATE TABLE IF NOT EXISTS console_provisioning (id INTEGER PRIMARY KEY CHECK(id=1),job_id TEXT NOT NULL);');
   const markers=await query(job,'SELECT job_id FROM console_provisioning WHERE id=1');
   if(markers[0].results.length&&markers[0].results[0].job_id!==job.id)fail(409,'resource_identity_mismatch');
   await query(job,'INSERT OR IGNORE INTO console_provisioning VALUES (1,?)',[job.id]);
   const tables=await query(job,"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('members','catalog','history')");
   for(const row of tables[0].results){if(!['members','catalog','history'].includes(row.name))fail(502,'database_query_failed');const count=await query(job,'SELECT COUNT(*) AS n FROM '+row.name);if(count[0].results[0].n!==0)fail(409,'household_not_empty');}
   await query(job,'CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)');
   for(const migration of release.migrations){await query(job,migration.sql);await query(job,'INSERT OR IGNORE INTO d1_migrations(name) VALUES (?)',[migration.name]);}
   const identity=await query(job,'SELECT instance_id,origin FROM instance_identity WHERE id=1');
   if(identity[0].results.length){if(identity[0].results[0].instance_id!==job.id||identity[0].results[0].origin!==job.origin)fail(409,'resource_identity_mismatch');}
   else await query(job,'INSERT INTO instance_identity(id,instance_id,origin) VALUES (1,?,?)',[job.id,job.origin]);
   const existing=await query(job,'SELECT state,invite_hash FROM onboarding WHERE id=1');
   if(existing[0].results.length){if(existing[0].results[0].state!=='pending'||existing[0].results[0].invite_hash!==job.inviteHash)fail(409,'invitation_state_changed');}
   else await query(job,"INSERT INTO onboarding(id,state,invite_hash,invite_expires_at) VALUES (1,'pending',?,?)",[job.inviteHash,job.expiresAt]);
  },
  async placeholder(job){const current=await settings(job);if(current)assertSettings(job,current);else await putWorker(job,"export default {fetch(){return new Response('Household setup in progress',{status:503})}};");},
  async deploy(job,release){
   assertSettings(job,await settings(job));
   const manifest=Object.fromEntries(release.assets.map(x=>[x.path,{hash:x.hash,size:x.size}]));
   const session=await api('/workers/scripts/'+job.workerName+'/assets-upload-session','POST',{manifest});
   if(!session||!Array.isArray(session.buckets)||typeof session.jwt!=='string'||session.buckets.length>20)fail(502,'asset_session_failed');
   let completion=session.buckets.length?null:session.jwt;
   for(const bucket of session.buckets){if(!Array.isArray(bucket)||bucket.length>1000)fail(502,'asset_session_failed');const form=new FormData();for(const hash of bucket){const asset=release.assets.find(x=>x.hash===hash);if(!asset)fail(502,'unknown_asset_requested');form.append(hash,new Blob([asset.base64],{type:asset.type}),hash);}const result=await api('/workers/assets/upload?base64=true','POST',form,session.jwt);if(typeof result?.jwt==='string')completion=result.jwt;}
   if(!completion)fail(502,'asset_upload_incomplete');
   await putWorker(job,release.worker,{jwt:completion,config:{not_found_handling:'single-page-application',run_worker_first:['/api/*'],_headers:release.headers}});
   await api('/workers/scripts/'+job.workerName+'/subdomain','POST',{enabled:true,previews_enabled:false});
   await api('/workers/scripts/'+job.workerName+'/schedules','PUT',[{cron:'17 1 * * *'}]);
  },
  async verify(job){assertSettings(job,await settings(job));let response;try{response=await fetcher(job.origin+'/api/setup',{redirect:'error',signal:AbortSignal.timeout(15000)});}catch{fail(502,'household_health_pending');}let result;try{result=await response.json();}catch{fail(502,'household_health_pending');}if(!response.ok||result.required!==true||result.stage!=='pending')fail(502,'household_health_pending');},
  async invitationState(job){const r=await query(job,'SELECT state,invite_hash FROM onboarding WHERE id=1');const row=r[0].results[0];if(!row||row.state!=='pending'||row.invite_hash!==job.inviteHash)fail(409,'invitation_already_claimed');if(job.expiresAt<=Date.now())fail(409,'invitation_expired');},
  async setupState(job){const result=await query(job,'SELECT state FROM onboarding WHERE id=1');const state=result[0]?.results[0]?.state;if(!['pending','claimed','complete'].includes(state))fail(409,'invitation_state_changed');return state;},
  async renewInvitation(job,next){
   const result=await query(job,"UPDATE onboarding SET invite_hash=?,invite_expires_at=? WHERE id=1 AND state='pending' AND invite_hash=? AND EXISTS (SELECT 1 FROM instance_identity WHERE id=1 AND instance_id=? AND origin=?) AND (SELECT COUNT(*) FROM members)+(SELECT COUNT(*) FROM catalog)+(SELECT COUNT(*) FROM history)=0",[next.inviteHash,next.expiresAt,job.inviteHash,job.id,job.origin]);
   if(result[0]?.meta?.changes!==1){const current=await query(job,'SELECT state,invite_hash FROM onboarding WHERE id=1');if(current[0]?.results[0]?.state!=='pending'||current[0]?.results[0]?.invite_hash!==next.inviteHash)fail(409,'invitation_already_claimed');}
  },
 };
}

import {body,digest,fail,json,PublicError,random,seal,unseal} from './security.mjs';
import {provider} from './cloudflare.mjs';
export const view=job=>({id:job.id,label:job.label,status:job.status,step:job.step,onboardingState:job.onboardingState||null,createdAt:job.createdAt,updatedAt:job.updatedAt,sourceSha:job.sourceSha,origin:job.origin,workerName:job.workerName,databaseName:job.databaseName,databaseId:job.databaseId||null,expiresAt:job.expiresAt,error:job.error||null,retryable:job.status==='failed'&&job.step!=='creating_database'&&!['resource_identity_mismatch','household_not_empty','resource_already_exists','invitation_state_changed'].includes(job.error)});
export function configured(env,release){
 if(!release?.ready||!/^[a-f0-9]{40}$/.test(release.sha||'')||!release.worker||!release.assets?.length||!release.migrations?.length)fail(503,'approved_release_required');
 if(!/^[a-f0-9]{64}$/i.test(env.INVITATION_KEY||''))fail(503,'invitation_key_required');
 provider(env);const max=Number(env.MAX_HOUSEHOLDS||8);if(!Number.isInteger(max)||max<1||max>8)fail(503,'household_limit_invalid');return max;
}
export async function reserve(storage,input,key,env,release){
 const maximum=configured(env,release);
 if(env.PROVISIONING_ENABLED!=='true')fail(503,'provisioning_not_enabled');
 if(!/^[a-f0-9]{32}$/.test(key||''))fail(400,'invalid_request_key');
 if(Object.keys(input).some(x=>x!=='label')||typeof input.label!=='string'||!input.label.trim()||input.label.length>80)fail(400,'invalid_household_label');
 const token=random(),id='house-'+random().slice(0,32),now=Date.now();
 const job={id,label:input.label.trim(),status:'queued',step:'queued',createdAt:now,updatedAt:now,sourceSha:release.sha,workerName:'fr-'+id,databaseName:'fr-'+id+'-db',origin:'https://fr-'+id+'.'+env.WORKERS_SUBDOMAIN+'.workers.dev',inviteHash:await digest(token),invitation:await seal(token,env.INVITATION_KEY),expiresAt:now+48*3600000};
 return storage.transaction(async tx=>{
  const previous=await tx.get('request:'+key);if(previous){const found=await tx.get('job:'+previous);if(found.label!==job.label)fail(409,'request_key_reused');return found;}
  const ids=await tx.get('ids')||[];if(ids.length>=maximum)fail(409,'household_capacity_reached');
  await tx.put('job:'+id,job);await tx.put('ids',[...ids,id]);await tx.put('request:'+key,id);return job;
 });
}
export async function advance(job,storage,env,release,cf=provider(env)){
 if(job.status==='ready'||job.status==='failed')return;
 const save=async()=>{job.updatedAt=Date.now();await storage.put('job:'+job.id,job);};
 try{
  configured(env,release);if(env.PROVISIONING_ENABLED!=='true')fail(503,'provisioning_not_enabled');
  if(job.sourceSha!==release.sha)fail(409,'approved_release_changed');
  if(job.step==='creating_database')fail(409,'database_creation_needs_review');
  job.status='working';await save();
  if(job.step==='queued'){await cf.preflight(job);job.step='preflight_complete';}
  else if(job.step==='preflight_complete'){
   job.step='creating_database';await save();job.databaseId=await cf.createDatabase(job);job.step='database_created';
  }
  else if(job.step==='database_created'){await cf.schema(job,release);job.step='schema_created';}
  else if(job.step==='schema_created'){await cf.placeholder(job);job.step='worker_created';}
  else if(job.step==='worker_created'){await cf.deploy(job,release);job.step='deployed';}
  else if(job.step==='deployed'){await cf.verify(job);job.status='ready';job.step='ready';}
  else fail(409,'unknown_provisioning_step');
  await save();
 }catch(error){job.status='failed';job.error=error instanceof PublicError?error.message:'provisioning_failed';await save();}
}
export function createHouseholdsClass(release){return class Households {
 constructor(state,env){this.state=state;this.env=env;this.running=null;}
 async fetch(request){
  try{
   if(request.headers.get('X-Verified-Owner')!==this.env.OWNER_EMAIL.toLowerCase())fail(403,'owner_sign_in_required');
   const url=new URL(request.url),method=request.method;
   if(url.pathname==='/api/households'&&method==='GET'){
    const ids=await this.state.storage.get('ids')||[],jobs=[];for(const id of ids)jobs.push(view(await this.state.storage.get('job:'+id)));
    return json({jobs:jobs.reverse(),release:release.ready?release.sha:null,enabled:this.env.PROVISIONING_ENABLED==='true'});
   }
   if(url.pathname==='/api/households'&&method==='POST'){
    const job=await reserve(this.state.storage,await body(request),request.headers.get('Idempotency-Key'),this.env,release);await this.state.storage.setAlarm(Date.now()+100);return json({job:view(job)},202);
   }
   if(url.pathname==='/api/registry'&&method==='GET'){
    const ids=await this.state.storage.get('ids')||[],instances=[];
    for(const id of ids){const job=await this.state.storage.get('job:'+id);if(job.status==='ready'&&await provider(this.env).setupState(job)==='complete')instances.push({id:job.id,workerName:job.workerName,databaseName:job.databaseName,databaseId:job.databaseId,origin:job.origin,managed:true,schemaVersion:2,channel:'production',buildsDisconnected:true});}
    return json({schemaVersion:1,instances});
   }
   const match=/^\/api\/households\/(house-[a-f0-9]{32})\/(retry|invitation|renew|resolve-database|check)$/.exec(url.pathname);
   if(!match||method!=='POST')fail(404,'not_found');
   const input=await body(request);const job=await this.state.storage.get('job:'+match[1]);if(!job)fail(404,'not_found');
   if(match[2]==='resolve-database'){
    if(job.status!=='failed'||job.step!=='creating_database')fail(409,'operator_review_required');
    const databaseId=await provider(this.env).resolveDatabase(job,input.databaseId);job.databaseId=databaseId;job.status='queued';job.step='database_created';job.error=null;await this.state.storage.put('job:'+job.id,job);await this.state.storage.setAlarm(Date.now()+100);return json({job:view(job)},202);
   }
   if(match[2]==='retry'){
    if(!view(job).retryable)fail(409,'operator_review_required');job.status='queued';job.error=null;await this.state.storage.put('job:'+job.id,job);await this.state.storage.setAlarm(Date.now()+100);return json({job:view(job)},202);
   }
   if(job.status!=='ready')fail(409,'household_not_ready');
   if(match[2]==='check'){
    const state=await provider(this.env).setupState(job);const current=await this.state.storage.get('job:'+job.id);current.onboardingState=state;if(state==='complete'){delete current.invitation;delete current.pendingRenewal;}await this.state.storage.put('job:'+job.id,current);return json({job:view(current)});
   }
   if(match[2]==='renew'){
    const key=request.headers.get('Idempotency-Key');if(!/^[a-f0-9]{32}$/.test(key||''))fail(400,'invalid_request_key');
    if(job.lastRenewalKey!==key){
     const token=random(),next={requestKey:key,inviteHash:await digest(token),invitation:await seal(token,this.env.INVITATION_KEY),expiresAt:Date.now()+48*3600000};
     const reserved=await this.state.storage.transaction(async tx=>{const current=await tx.get('job:'+job.id);if(current.lastRenewalKey===key)return {job:current};if(!current.pendingRenewal){current.pendingRenewal=next;await tx.put('job:'+job.id,current);}return {job:current,pending:current.pendingRenewal};});
     if(reserved.pending){
      const pending=reserved.pending;await provider(this.env).renewInvitation(reserved.job,pending);
      const current=await this.state.storage.transaction(async tx=>{const current=await tx.get('job:'+job.id);if(current.lastRenewalKey===pending.requestKey&&current.inviteHash===pending.inviteHash)return current;if(current.pendingRenewal?.inviteHash!==pending.inviteHash)fail(409,'invitation_state_changed');Object.assign(current,{inviteHash:pending.inviteHash,invitation:pending.invitation,expiresAt:pending.expiresAt,lastRenewalKey:pending.requestKey});delete current.pendingRenewal;await tx.put('job:'+job.id,current);return current;});Object.assign(job,current);delete job.pendingRenewal;
     }else Object.assign(job,reserved.job);
    }
   }
   if(job.pendingRenewal)fail(409,'invitation_state_changed');
   await provider(this.env).invitationState(job);const token=await unseal(job.invitation,this.env.INVITATION_KEY);return json({url:job.origin+'/#setup='+token,expiresAt:job.expiresAt});
  }catch(error){return json({error:error instanceof PublicError?error.message:'provisioning_failed'},error instanceof PublicError?error.status:500);}
 }
 async alarm(){
  if(this.running)return this.running;
  this.running=this.run().finally(()=>{this.running=null;});return this.running;
 }
 async run(){
  const ids=await this.state.storage.get('ids')||[];
  for(const id of ids){const job=await this.state.storage.get('job:'+id);if(job.status==='queued'||job.status==='working'){
   // Keep a watchdog alarm before external calls. If creation is interrupted,
   // its saved creating_database step requires explicit operator review.
   await this.state.storage.setAlarm(Date.now()+120000);await advance(job,this.state.storage,this.env,release);await this.state.storage.setAlarm(Date.now()+1000);return;
  }}
 }
};}

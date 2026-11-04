import {validateRegistry,instanceConfig} from './instance-config.mjs';
export function validateRelease(tag,sha) {
  if(typeof tag!=='string' || !/^v\d+\.\d+\.\d+(?:-[a-z0-9]+(?:[.-][a-z0-9]+)*)?$/.test(tag))throw Error('Choose a version tag such as v2.1.0.');
  if(typeof sha!=='string' || !/^[a-f0-9]{40}$/.test(sha))throw Error('A full expected release commit SHA is required.');
  return {tag,sha};
}
export function releaseTargets(registry,scope,selected='') {
  const base=validateRegistry(registry);
  const entries=base.map((entry,i)=>{
    const raw=registry.instances[i];
    if(raw.managed!==true || raw.schemaVersion!==2 || typeof raw.buildsDisconnected!=='boolean' || !['pilot','production'].includes(raw.channel))throw Error('Registry requires managed schema-2 targets, channels and cutover flags.');
    return {...entry,channel:raw.channel,buildsDisconnected:raw.buildsDisconnected};
  });
  const pilots=entries.filter(x=>x.channel==='pilot');
  if(pilots.length!==1)throw Error('Exactly one managed pilot is required.');
  let ids;
  if(scope==='pilot')ids=[];
  else if(scope==='all')ids=entries.filter(x=>x.channel==='production').map(x=>x.id);
  else if(scope==='selected') {
    if(typeof selected!=='string' || selected.length>5000)throw Error('Invalid selected instance list.');
    ids=selected.split(',').map(x=>x.trim());
    if(!ids.length || ids.some(x=>!x || !/^[a-z][a-z0-9-]{2,62}$/.test(x)) || new Set(ids).size!==ids.length)throw Error('Use unique, comma-separated instance IDs.');
    if(ids.some(id=>!entries.some(x=>x.id===id && x.channel==='production')))throw Error('Unknown production instance selected.');
  } else throw Error('Unknown release scope.');
  return [...pilots,...entries.filter(x=>ids.includes(x.id))];
}
export function requireCutover(targets,enabled) {
  if(enabled!=='true' || targets.some(x=>!x.buildsDisconnected))throw Error('Managed releases are not enabled or a target still has automatic builds.');
}
export function assertBindings(target,settings) {
  const bindings=settings?.bindings;
  if(!Array.isArray(bindings))throw Error('Cannot verify existing Worker bindings.');
  const db=bindings.filter(x=>x.type==='d1' && x.name==='DB');
  const text=name=>bindings.find(x=>x.type==='plain_text' && x.name===name)?.text;
  if(db.length!==1 || db[0].id?.toLowerCase()!==target.databaseId || text('INSTANCE_ID')!==target.id || text('INSTANCE_ORIGIN')!==target.origin)throw Error('Existing Worker identity or database differs from registry.');
}
export function releaseConfig(target) {
  const config=instanceConfig({compatibility_date:'2026-11-04',triggers:{crons:['17 1 * * *']},assets:{binding:'ASSETS',not_found_handling:'single-page-application',run_worker_first:['/api/*']}},target,'..');
  config.main='./release-worker.mjs';config.no_bundle=true;
  return config;
}
export async function runRollout(targets,operations) {
  const records=targets.map(x=>({id:x.id,status:'pending',before:[],after:[]}));
  // Verify every destination before the first mutation.
  for(let i=0;i<targets.length;i++) {
    try {records[i].before=await operations.preflight(targets[i]);}
    catch {records[i].status='preflight_failed';await operations.record(records);throw Error('Release preflight failed; nothing deployed.');}
  }
  for(let i=0;i<targets.length;i++) {
    try {
      records[i].status='deploying';await operations.record(records);
      await operations.deploy(targets[i]);
      records[i].after=await operations.verify(targets[i]);
      if(!Array.isArray(records[i].after) || records[i].after.length!==1 || records[i].before.includes(records[i].after[0]))throw Error('Deployment did not activate a new, exclusive Worker version.');
      records[i].status='ready';await operations.record(records);
    } catch {
      records[i].status='failed';await operations.record(records);
      throw Error('Release stopped. Check target results before retrying or rolling back.');
    }
  }
  return records;
}

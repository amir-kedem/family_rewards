import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateRelease,releaseTargets,requireCutover,assertBindings,releaseConfig,runRollout} from '../scripts/release-controls.mjs';
const pilot={id:'family-pilot',workerName:'fr-pilot',databaseName:'fr-pilot-db',databaseId:'11111111-1111-4111-8111-111111111111',origin:'https://pilot.example.test',managed:true,schemaVersion:2,channel:'pilot',buildsDisconnected:true};
const prod={...pilot,id:'family-other',workerName:'fr-other',databaseName:'fr-other-db',databaseId:'22222222-2222-4222-8222-222222222222',origin:'https://other.example.test',channel:'production'};
const registry={schemaVersion:1,instances:[prod,pilot]};
test('release tags and selected IDs cannot inject shell or path syntax',()=>{
  assert.equal(validateRelease('v2.1.0','a'.repeat(40)).tag,'v2.1.0');
  for(const tag of ['main','../v2.0.0','v2.0.0;touch /tmp/pwn','--upload-secrets','v2.0.0\n'])assert.throws(()=>validateRelease(tag,'a'.repeat(40)));
  assert.throws(()=>validateRelease('v2.1.0','main'));
  for(const ids of ['family-other,','family-other,family-other','../../parent','family-missing','family-other;echo hi'])assert.throws(()=>releaseTargets(registry,'selected',ids));
});
test('every release starts with one pilot and rejects duplicate resources or missing readiness',()=>{
  assert.deepEqual(releaseTargets(registry,'all').map(x=>x.id),[pilot.id,prod.id]);
  assert.equal(releaseTargets(registry,'pilot').length,1);
  assert.throws(()=>releaseTargets({schemaVersion:1,instances:[prod]},'all'));
  assert.throws(()=>releaseTargets({schemaVersion:1,instances:[pilot,{...prod,databaseId:pilot.databaseId}]},'all'));
  assert.throws(()=>requireCutover(releaseTargets(registry,'all'),'false'));
  assert.throws(()=>requireCutover([{...pilot,buildsDisconnected:false}],'true'));
  requireCutover(releaseTargets(registry,'all'),'true');
});
test('target settings must match both identity and database; config uses prebuilt bundle only',()=>{
  const bindings=[{type:'d1',name:'DB',id:pilot.databaseId},{type:'plain_text',name:'INSTANCE_ID',text:pilot.id},{type:'plain_text',name:'INSTANCE_ORIGIN',text:pilot.origin}];
  assertBindings(pilot,{bindings});
  for(const index of [0,1,2])assert.throws(()=>assertBindings(pilot,{bindings:bindings.filter((_,i)=>i!==index)}));
  assert.throws(()=>assertBindings(prod,{bindings}));
  const config=releaseConfig(pilot);assert.equal(config.name,pilot.workerName);assert.equal(config.no_bundle,true);assert.equal(config.main,'./release-worker.mjs');assert.equal(config.d1_databases[0].database_id,pilot.databaseId);
});
test('preflight failure prevents every deployment; pilot failure prevents production promotion',async()=>{
  const targets=releaseTargets(registry,'all');const deployed=[];let report;
  await assert.rejects(runRollout(targets,{preflight:async t=>{if(t.id===prod.id)throw Error();return ['old'];},deploy:async t=>deployed.push(t.id),verify:async()=>['new'],record:async r=>report=structuredClone(r)}));
  assert.deepEqual(deployed,[]);assert.equal(report[1].status,'preflight_failed');
  await assert.rejects(runRollout(targets,{preflight:async()=>['old'],deploy:async t=>deployed.push(t.id),verify:async()=>{throw Error();},record:async r=>report=structuredClone(r)}));
  assert.deepEqual(deployed,[pilot.id]);assert.equal(report[0].status,'failed');assert.equal(report[1].status,'pending');
});
test('successful rollout records active versions and preserves sequential order',async()=>{
  const deployed=[];const result=await runRollout(releaseTargets(registry,'all'),{preflight:async()=>['old-version'],deploy:async t=>deployed.push(t.id),verify:async()=>['new-version'],record:async()=>{}});
  assert.deepEqual(deployed,[pilot.id,prod.id]);assert(result.every(r=>r.status==='ready'&&r.before[0]==='old-version'&&r.after[0]==='new-version'));
});
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
test('plan CLI verifies the pinned tag without Cloudflare credentials; apply stays gated',()=>{
  const folder=mkdtempSync(join(tmpdir(),'family-release-'));
  try {
    const root=join(folder,'v2');mkdirSync(join(root,'worker'),{recursive:true});
    writeFileSync(join(root,'worker/index.ts'),'export default {};\n');writeFileSync(join(folder,'.gitignore'),'.private/\n');
    const git=(...args)=>execFileSync('git',['-C',folder,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
    git('init');git('config','user.name','Release Test');git('config','user.email','release@example.test');git('add','.');git('commit','-m','fixture');git('tag','v2.1.0');const sha=git('rev-parse','HEAD');
    mkdirSync(join(root,'dist'));writeFileSync(join(root,'dist/index.html'),'<main>fixture</main>');
    mkdirSync(join(root,'.private'));writeFileSync(join(root,'.private/release-worker.mjs'),'export default {};\n');
    const report=join(folder,'results.json');
    const env={PATH:process.env.PATH,RELEASE_SOURCE:root,RELEASE_REPORT:report,RELEASE_TAG:'v2.1.0',RELEASE_SHA:sha,RELEASE_SCOPE:'all',FAMILY_REWARDS_INSTANCES:JSON.stringify(registry)};
    const script=new URL('../scripts/managed-release.mjs',import.meta.url).pathname;
    execFileSync(process.execPath,[script],{env,stdio:'pipe'});
    const result=JSON.parse(readFileSync(report,'utf8'));assert.equal(result.mode,'plan');assert.equal(result.sha,sha);assert.equal(result.targets[0].id,pilot.id);assert.match(result.workerSha256,/^[a-f0-9]{64}$/);assert.match(result.assetsSha256,/^[a-f0-9]{64}$/);assert(!JSON.stringify(result).includes(pilot.databaseId));
    assert.throws(()=>execFileSync(process.execPath,[script],{env:{...env,RELEASE_SHA:'0'.repeat(40)},stdio:'pipe'}));
    assert.throws(()=>execFileSync(process.execPath,[script],{env:{...env,RELEASE_APPLY:'true',FAMILY_REWARDS_MANAGED_RELEASES_ENABLED:'false'},stdio:'pipe'}));
  } finally {rmSync(folder,{recursive:true,force:true});}
});

test('unchanged active versions cannot be reported as a successful deployment',async()=>{
  let report;await assert.rejects(runRollout([pilot],{preflight:async()=>['old'],deploy:async()=>{},verify:async()=>['old'],record:async r=>report=structuredClone(r)}));assert.equal(report[0].status,'failed');
});

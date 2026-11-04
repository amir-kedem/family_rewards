import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,readdirSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {validateRegistry,instanceConfig} from '../scripts/instance-config.mjs';
const entry={id:'family-example',workerName:'fr-example',databaseName:'fr-example-db',databaseId:'11111111-1111-4111-8111-111111111111',origin:'https://family.example.test'};
const registry={schemaVersion:1,instances:[entry]};
test('registry rejects reused database/worker/origin and hostile deployment names',()=>{
  assert.equal(validateRegistry(registry)[0].id,entry.id);
  for(const field of ['id','workerName','databaseName','databaseId','origin']) {
    const other={id:'family-two',workerName:'fr-two',databaseName:'fr-two-db',databaseId:'22222222-2222-4222-8222-222222222222',origin:'https://second.example.test',[field]:entry[field]};
    assert.throws(()=>validateRegistry({schemaVersion:1,instances:[entry,other]}));
  }
  for(const origin of ['http://family.test','https://user:password@family.test','https://family.test/path','https://family.test/#secret'])assert.throws(()=>validateRegistry({schemaVersion:1,instances:[{...entry,origin}]}));
  assert.throws(()=>validateRegistry({schemaVersion:1,instances:[{...entry,workerName:'../production'}]}));
});
test('instance config pins unique identity and never mutates the template',()=>{
  const template={name:'old',main:'worker/index.ts',assets:{directory:'./dist',binding:'ASSETS'},d1_databases:[{database_id:'old'}]};
  const config=instanceConfig(template,entry);
  assert.equal(template.name,'old');assert.equal(config.name,'fr-example');
  assert.equal(config.d1_databases[0].database_id,entry.databaseId);assert.equal(config.vars.INSTANCE_ID,entry.id);
  assert.equal(config.vars.INSTANCE_ORIGIN,entry.origin);assert.equal(config.preview_urls,false);
});
test('provisioning preparation writes private files, consumes no Cloudflare credentials and refuses overwrite',()=>{
  const folder=mkdtempSync(join(tmpdir(),'family-instance-'));
  try {
    mkdirSync(join(folder,'scripts'));mkdirSync(join(folder,'migrations'));
    for(const file of ['prepare-instance.mjs','instance-config.mjs'])copyFileSync(new URL('../scripts/'+file,import.meta.url),join(folder,'scripts',file));
    copyFileSync(new URL('../wrangler.example.jsonc',import.meta.url),join(folder,'wrangler.example.jsonc'));
    writeFileSync(join(folder,'registry.json'),JSON.stringify(registry));
    const args=[join(folder,'scripts/prepare-instance.mjs'),'--registry',join(folder,'registry.json'),'--instance',entry.id];
    const output=execFileSync(process.execPath,args,{encoding:'utf8',env:{PATH:process.env.PATH}});
    const destination=join(folder,'.private',entry.id),link=readFileSync(join(destination,'setup-link.txt'),'utf8').trim();
    const token=new URL(link).hash.slice('#setup='.length);assert.match(token,/^[a-f0-9]{64}$/);
    assert(!output.includes(token));const seed=readFileSync(join(destination,'invitation.sql'),'utf8');assert(!seed.includes(token));
    assert(seed.includes(createHash('sha256').update(token).digest('hex')));
    if(process.platform!=='win32')assert.equal(statSync(join(destination,'setup-link.txt')).mode&0o777,0o600);
    assert.throws(()=>execFileSync(process.execPath,args,{encoding:'utf8',stdio:'pipe'}));
    const sql=new DatabaseSync(':memory:');
    for(const name of ['0001_initial.sql','0002_onboarding.sql'])sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
    sql.exec(seed);assert.equal(sql.prepare('SELECT instance_id FROM instance_identity').get().instance_id,entry.id);
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM setup_completion_guard').get().n,0);
    assert.throws(()=>sql.exec(seed));
    execFileSync(process.execPath,[...args,'--renew-invitation'],{encoding:'utf8'});
    const renewed=readdirSync(join(folder,'.private')).find(n=>n.startsWith(entry.id+'-renew-'));
    const renewal=readFileSync(join(folder,'.private',renewed,'invitation.sql'),'utf8');
    sql.exec(renewal);
    assert.notEqual(sql.prepare('SELECT invite_hash FROM onboarding').get().invite_hash,createHash('sha256').update(token).digest('hex'));
    sql.exec("UPDATE onboarding SET state='claimed'");
    assert.throws(()=>sql.exec(renewal));
  } finally {rmSync(folder,{recursive:true,force:true});}
});

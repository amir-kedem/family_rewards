// Run only from the trusted default-branch checkout; selected source is a separate checkout.
import {readFileSync,writeFileSync,mkdirSync,realpathSync,existsSync,readdirSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,relative} from 'node:path';
import {execFileSync} from 'node:child_process';
import {validateRelease,releaseTargets,requireCutover,assertBindings,releaseConfig,runRollout} from './release-controls.mjs';
const env=process.env;
const {tag,sha}=validateRelease(env.RELEASE_TAG,env.RELEASE_SHA);
let registry;
try {registry=JSON.parse(env.FAMILY_REWARDS_INSTANCES || '');} catch {throw Error('Cannot read private release registry.');}
const targets=releaseTargets(registry,env.RELEASE_SCOPE,env.RELEASE_IDS || '');
const root=realpathSync(resolve(env.RELEASE_SOURCE || 'release-source/v2'));
const repo=realpathSync(resolve(root,'..'));
if(relative(repo,root)!=='v2' || !existsSync(resolve(root,'worker/index.ts')))throw Error('Release source must be the v2 directory in the selected checkout.');
const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
if(git('rev-parse','HEAD')!==sha || git('rev-parse',`refs/tags/${tag}^{commit}`)!==sha)throw Error('Release tag and checked-out commit do not match expected SHA.');
if(git('status','--porcelain','--untracked-files=no'))throw Error('Tracked release source was modified.');
const bundle=resolve(root,'.private/release-worker.mjs');
if(!existsSync(bundle))throw Error('Build the release Worker bundle before planning or applying.');
const workerSha256=createHash('sha256').update(readFileSync(bundle)).digest('hex');
const assetHash=createHash('sha256');
const dist=resolve(root,'dist');
const hashAssets=(directory,prefix='')=>{
  for(const name of readdirSync(directory).sort()) {
    const path=resolve(directory,name),info=lstatSync(path),key=prefix+name;
    if(info.isSymbolicLink())throw Error('Release assets cannot contain symbolic links.');
    if(info.isDirectory())hashAssets(path,key+'/');
    else if(info.isFile())assetHash.update(key+'\0').update(createHash('sha256').update(readFileSync(path)).digest());
    else throw Error('Unsupported release asset type.');
  }
};
hashAssets(dist);const assetsSha256=assetHash.digest('hex');
const report=resolve(env.RELEASE_REPORT || 'release-results.json');
const record=async records=>writeFileSync(report,JSON.stringify({tag,sha,workerSha256,assetsSha256,mode:env.RELEASE_APPLY==='true'?'apply':'plan',targets:records},null,2)+'\n',{mode:0o600});
if(env.RELEASE_APPLY!=='true') {
  await record(targets.map(x=>({id:x.id,channel:x.channel,status:'planned',cutoverReady:x.buildsDisconnected})));
  console.log(`Plan prepared for ${targets.length} target(s). No Cloudflare changes.`);
} else {
  requireCutover(targets,env.FAMILY_REWARDS_MANAGED_RELEASES_ENABLED);
  if(!/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID || '') || !env.CLOUDFLARE_API_TOKEN)throw Error('Cloudflare release credentials are required.');
  const api=async path=>{
    const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}${path}`,{headers:{Authorization:`Bearer ${env.CLOUDFLARE_API_TOKEN}`},signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error('Cloudflare API request failed.');
    const body=await response.json();if(!body.success)throw Error('Cloudflare API returned an error.');return body.result;
  };
  const versions=async target=>{
    const data=await api(`/workers/scripts/${target.workerName}/deployments`);
    const latest=(Array.isArray(data)?data:data.deployments)?.[0];
    const ids=latest?.versions?.map(x=>x.version_id);
    if(!Array.isArray(ids)||!ids.length||ids.some(x=>typeof x!=='string'||!/^[a-f0-9-]{36}$/i.test(x)))throw Error('Cannot record active Worker versions.');
    return ids;
  };
  const verifyHealth=async target=>{
    const response=await fetch(target.origin+'/api/setup',{redirect:'error',signal:AbortSignal.timeout(20000),headers:{'Cache-Control':'no-cache'}});
    const body=await response.json();
    if(!response.ok || body.required!==false)throw Error('Target is not an initialized, healthy family.');
  };
  const privateDir=resolve(root,'.private');mkdirSync(privateDir,{recursive:true,mode:0o700});
  if(realpathSync(privateDir)!==privateDir)throw Error('Private configuration directory cannot be a symbolic link.');
  await runRollout(targets,{
    preflight:async target=>{assertBindings(target,await api(`/workers/scripts/${target.workerName}/settings`));await verifyHealth(target);return versions(target);},
    deploy:async target=>{
      const config=resolve(privateDir,`release-${target.id}.jsonc`);
      writeFileSync(config,JSON.stringify(releaseConfig(target),null,2)+'\n',{mode:0o600,flag:'wx'});
      // Use the installed, lockfile-pinned Wrangler. Suppress logs containing private target details.
      execFileSync(process.execPath,[resolve(root,'node_modules/wrangler/bin/wrangler.js'),'deploy','--config',config,'--message',`${tag} ${sha}`],{cwd:root,env:{PATH:env.PATH,HOME:env.HOME,CI:'true',CLOUDFLARE_ACCOUNT_ID:env.CLOUDFLARE_ACCOUNT_ID,CLOUDFLARE_API_TOKEN:env.CLOUDFLARE_API_TOKEN,WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe'],timeout:300000});
    },
    verify:async target=>{assertBindings(target,await api(`/workers/scripts/${target.workerName}/settings`));await verifyHealth(target);return versions(target);},
    record,
  });
  console.log(`Release completed for ${targets.length} target(s).`);
}

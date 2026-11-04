// Generates private deployment files. It never calls Cloudflare or deploys.
import {readFileSync,mkdirSync,writeFileSync,existsSync,realpathSync,chmodSync} from 'node:fs';
import {resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHash} from 'node:crypto';
import {validateRegistry,instanceConfig} from './instance-config.mjs';
const args=process.argv.slice(2);
if(![4,5].includes(args.length) || args[0]!=='--registry' || args[2]!=='--instance' || (args.length===5 && args[4]!=='--renew-invitation')) throw Error('Usage: node scripts/prepare-instance.mjs --registry PRIVATE_REGISTRY.json --instance INSTANCE_ID [--renew-invitation]');
const renew=args[4]==='--renew-invitation';
const root=fileURLToPath(new URL('..',import.meta.url));
let registry;
try { registry=JSON.parse(readFileSync(resolve(args[1]),'utf8')); }
catch { throw Error('Cannot read a valid private instance registry JSON file.'); }
const entries=validateRegistry(registry);
const entry=entries.find(item=>item.id===args[3]);
if(!entry) throw Error('Instance is not in the validated private registry.');
const privateRoot=resolve(root,'.private');
mkdirSync(privateRoot,{recursive:true,mode:0o700});
if(realpathSync(privateRoot)!==privateRoot) throw Error('Private output directory must not be a symbolic link.');
chmodSync(privateRoot,0o700);
const destination=resolve(privateRoot,entry.id+(renew?'-renew-'+Date.now()+'-'+randomBytes(3).toString('hex'):''));
if(existsSync(destination)) throw Error('Private instance output already exists; it will not be overwritten.');
mkdirSync(destination,{mode:0o700});
const prefix=relative(destination,root).split(sep).join('/');
const config=instanceConfig(JSON.parse(readFileSync(new URL('../wrangler.example.jsonc',import.meta.url),'utf8')),entry,prefix);
const token=randomBytes(32).toString('hex'),hash=createHash('sha256').update(token).digest('hex');
const expires=Date.now()+48*60*60*1000;
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const seed=renew
  ? `INSERT INTO setup_completion_guard SELECT 1,CASE WHEN (SELECT COUNT(*) FROM members)+(SELECT COUNT(*) FROM catalog)+(SELECT COUNT(*) FROM history)=0 AND EXISTS(SELECT 1 FROM instance_identity WHERE instance_id=${quote(entry.id)} AND origin=${quote(entry.origin)}) AND EXISTS(SELECT 1 FROM onboarding WHERE id=1 AND state='pending') THEN 1 ELSE 0 END;\nUPDATE onboarding SET invite_hash=${quote(hash)},invite_expires_at=${expires} WHERE id=1 AND state='pending';\nDELETE FROM setup_completion_guard WHERE id=1;\n`
  : `INSERT INTO setup_completion_guard SELECT 1,CASE WHEN (SELECT COUNT(*) FROM members)+(SELECT COUNT(*) FROM catalog)+(SELECT COUNT(*) FROM history)=0 AND (SELECT COUNT(*) FROM instance_identity)=0 AND (SELECT COUNT(*) FROM onboarding)=0 THEN 1 ELSE 0 END;\nINSERT INTO instance_identity(id,instance_id,origin) VALUES (1,${quote(entry.id)},${quote(entry.origin)});\nINSERT INTO onboarding(id,state,invite_hash,invite_expires_at) VALUES (1,'pending',${quote(hash)},${expires});\nDELETE FROM setup_completion_guard WHERE id=1;\n`;
for(const [name,content] of [['wrangler.jsonc',JSON.stringify(config,null,2)+'\n'],['invitation.sql',seed],['setup-link.txt',entry.origin+'/#setup='+token+'\n'],['instance.json',JSON.stringify(entry,null,2)+'\n']]) {
  writeFileSync(resolve(destination,name),content,{encoding:'utf8',mode:0o600,flag:'wx'});
}
console.log('Private instance files prepared under '+relative(root,destination)+'. No deployment or remote database change was performed.');
console.log(renew?'Execute the renewal invitation.sql using the registered instance config. It only works before the invitation is claimed.':'Apply migrations using this generated Wrangler config, then execute invitation.sql once against that same new database.');
console.log('The private setup link is in setup-link.txt and expires after 48 hours. Do not publish these files.');

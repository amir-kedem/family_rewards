// Package an explicitly reviewed application commit into the private console.
// This script only builds locally. It never calls Cloudflare or deploys.
import {readFileSync,writeFileSync,mkdirSync,readdirSync,lstatSync} from 'node:fs';
import {resolve,dirname,extname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),app=resolve(root,'v2'),sha=process.env.APPROVED_APP_SHA;
if(!/^[a-f0-9]{40}$/.test(sha||''))throw Error('Set APPROVED_APP_SHA to the full reviewed application commit SHA.');
const run=(command,args,cwd=app)=>execFileSync(command,args,{cwd,stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
if(git('rev-parse',sha+'^{commit}')!==sha)throw Error('Approved application commit is unavailable.');
const inputs=['v2/src','v2/worker','v2/public','v2/migrations','v2/package.json','v2/package-lock.json','v2/vite.config.ts','v2/tsconfig.json'];
if(git('diff','--name-only',sha,'--',...inputs))throw Error('Application inputs differ from the approved commit.');
if(git('status','--porcelain','--untracked-files=all','--ignored','--',...inputs))throw Error('Application inputs must be clean, tracked, and fully reviewed.');
run(process.execPath,['--test',resolve(root,'owner-console/tests/console.test.mjs')]);
run('npm',['test']);run('python3',['-m','unittest','discover','-s','tests','-p','test_*.py']);run('npm',['run','build']);
const generated=resolve(root,'owner-console/generated');mkdirSync(generated,{recursive:true});
const bundled=resolve(app,'.private/owner-console-worker.mjs');mkdirSync(dirname(bundled),{recursive:true,mode:0o700});
run(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--dry-run','--config','wrangler.jsonc','--outfile',bundled]);
const assets=[],types={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.txt':'text/plain'};
function scan(folder){for(const name of readdirSync(folder).sort()){
 const path=resolve(folder,name),stat=lstatSync(path);if(stat.isSymbolicLink())throw Error('Asset symlinks are not allowed.');if(stat.isDirectory()){scan(path);continue;}
 const rel=relative(resolve(app,'dist'),path).replaceAll('\\','/');if(rel==='_headers'||rel==='_redirects'||rel.endsWith('.map'))continue;
 const bytes=readFileSync(path),base64=bytes.toString('base64');assets.push({path:'/'+rel,hash:createHash('sha256').update(base64+extname(path).slice(1)).digest('hex').slice(0,32),size:bytes.length,base64,type:types[extname(path)]||'application/octet-stream'});
}}
scan(resolve(app,'dist'));if(!assets.some(x=>x.path==='/index.html')||assets.length>1000||assets.reduce((sum,x)=>sum+x.size,0)>2*1024*1024)throw Error('Application assets exceed the bounded console package.');
const migrations=readdirSync(resolve(app,'migrations')).filter(x=>/^\d{4}_[a-z0-9_]+\.sql$/.test(x)).sort().map(name=>({name,sql:readFileSync(resolve(app,'migrations',name),'utf8').replace(/CREATE TABLE (?!IF NOT EXISTS)/g,'CREATE TABLE IF NOT EXISTS ').replace(/CREATE INDEX (?!IF NOT EXISTS)/g,'CREATE INDEX IF NOT EXISTS ').replace(/CREATE TRIGGER (?!IF NOT EXISTS)/g,'CREATE TRIGGER IF NOT EXISTS ').replace('INSERT INTO settings VALUES','INSERT OR IGNORE INTO settings VALUES')}));
const worker=readFileSync(bundled,'utf8');const release={ready:true,sha,worker,workerHash:createHash('sha256').update(worker).digest('hex'),assets,migrations,headers:readFileSync(resolve(app,'public/_headers'),'utf8')};
writeFileSync(resolve(generated,'release.mjs'),'export default '+JSON.stringify(release)+';\n');
console.log('Approved household application packaged. No deployment performed.');

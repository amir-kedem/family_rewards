import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {pbkdf2Sync} from 'node:crypto';
import worker from '../worker/index.ts';
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8'));sql.exec("INSERT INTO members VALUES ('one','First','⭐',100,1),('two','Second','🌟',50,1);INSERT INTO catalog VALUES ('task','task','chores','Task',10,'⭐',1),('reward','reward','chores','Reward',20,'🎁',1)");
 let queue=Promise.resolve();const DB={prepare(query){let args=[];const s={bind(...v){args=v;return s;},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){return sql.prepare(query).run(...args);}};return s;},async batch(statements){let unlock;const previous=queue;queue=new Promise(r=>unlock=r);await previous;sql.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}finally{unlock();}}};
 const encode=p=>'pbkdf2$100000$salt$'+pbkdf2Sync(p,'salt',100000,32,'sha256').toString('hex'),env={DB,FAMILY_PASSWORD_HASH:encode('family'),PARENT_PASSWORD_HASH:encode('parent')};let cookie='';
 async function call(path,input,options={}){const response=await worker.fetch(new Request('https://test.example/api'+path,{method:input===undefined?'GET':'POST',headers:{Cookie:cookie,...(input===undefined?{}:{Origin:'https://test.example','Content-Type':'application/json'}),...options.headers},body:input===undefined?undefined:JSON.stringify(input)}),env);if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return {status:response.status,data:await response.json()};}
 const parent=()=>call('/parent/login',{password:'parent'}),state=()=>call('/state'),change=(input,version=0)=>call('/members',{...input,version});return {sql,env,call,parent,state,change};
}
test('members can be added and renamed after setup without inflating monthly history',async()=>{
 const f=fixture();assert.equal((await f.change({action:'add',name:'New',emoji:'⭐'})).status,401);await f.call('/login',{password:'family'});assert.equal((await f.change({action:'add',name:'New',emoji:'⭐'})).status,403);await f.parent();
 assert.equal((await f.state()).data.memberVersion,0);assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='member_preferences'").get().n,0);
 assert.equal((await f.change({action:'add',name:'New',emoji:'🌱',points:70})).status,200);let state=(await f.state()).data;assert.equal(state.members.length,3);assert.equal(state.members[2].points,70);assert.equal(state.history.length,0);assert.equal(state.memberVersion,1);
 const id=state.members[2].id;assert.equal((await f.change({action:'edit',id,name:'Renamed',emoji:'🎈'},1)).status,200);assert.equal(f.sql.prepare('SELECT points FROM members WHERE id=?').get(id).points,70);
 assert.equal((await f.change({action:'add',name:'Renamed',emoji:'⭐'},2)).status,409);assert.equal((await f.change({action:'add',name:'Bad',emoji:'⭐',points:-1},2)).status,400);
});
test('removal hides active membership but retains balances, goals and named history; restore keeps identity',async()=>{
 const f=fixture();await f.parent();await f.call('/tasks/complete',{memberId:'two',itemId:'task'},{headers:{'Idempotency-Key':'before-archive'}});await f.call('/goals',{memberId:'two',rewardId:'reward'});
 assert.equal((await f.change({action:'archive',id:'two'})).status,200);const state=(await f.state()).data;assert.deepEqual(state.members.map(m=>m.id),['one']);assert.equal(state.archivedMembers[0].points,60);assert.equal(state.historyMembers.find(m=>m.id==='two').name,'Second');assert.equal(state.goals[0].member_id,'two');
 assert.equal((await f.call('/tasks/complete',{memberId:'two',itemId:'task'},{headers:{'Idempotency-Key':'after-archive'}})).status,409);assert.equal((await f.call('/goals',{memberId:'two',rewardId:'reward'})).status,400);
 assert.equal((await f.change({action:'archive',id:'one'},1)).status,409);assert.equal((await f.change({action:'restore',id:'two'},1)).status,200);assert.equal((await f.state()).data.members.find(m=>m.id==='two').points,60);
 await f.call('/login',{password:'family'});assert.deepEqual((await f.state()).data.archivedMembers,[]);
});
test('explicit ordering persists; stale and simultaneous management writes cannot overwrite each other',async()=>{
 const f=fixture();await f.parent();assert.equal((await f.change({action:'reorder',ids:['two','one']})).status,200);assert.deepEqual((await f.state()).data.members.map(m=>m.id),['two','one']);assert.equal((await f.change({action:'reorder',ids:['one','one']},1)).status,409);
 const results=await Promise.all([f.change({action:'edit',id:'one',name:'Updated A',emoji:'⭐'},1),f.change({action:'edit',id:'one',name:'Updated B',emoji:'⭐'},1)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal((await f.state()).data.memberVersion,2);
 assert.equal((await f.change({action:'archive',id:'two'},1)).status,409);assert.equal((await f.state()).data.members.length,2);
});

test('first-time removal and an in-flight task are ordered atomically by the database',async()=>{
 const f=fixture();await f.parent();let paused,release;const waiting=new Promise(r=>paused=r),resume=new Promise(r=>release=r),prepare=f.env.DB.prepare;let intercept=true;
 f.env.DB.prepare=query=>{const s=prepare(query);if(intercept&&query.includes("name='member_preferences'")){intercept=false;const first=s.first;s.first=async()=>{const value=await first();paused();await resume;return value;};}return s;};
 const task=f.call('/tasks/complete',{memberId:'two',itemId:'task'},{headers:{'Idempotency-Key':'racing-task'}});await waiting;
 assert.equal((await f.change({action:'archive',id:'two'})).status,200);release();assert.equal((await task).status,409);assert.equal(f.sql.prepare("SELECT points FROM members WHERE id='two'").get().points,50);
});

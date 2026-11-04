import {body,fail,json} from './http.ts';
type Statement={bind(...v:unknown[]):Statement;first<T=any>():Promise<T|null>;all<T=any>():Promise<{results:T[]}>;run():Promise<unknown>};
type Env={DB:{prepare(s:string):Statement;batch(s:Statement[]):Promise<unknown>}};
export async function hasPreferences(env:Env){return Boolean(await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='member_preferences'").first());}
export async function memberState(env:Env){
 if(!await hasPreferences(env)){const all=(await env.DB.prepare('SELECT * FROM members ORDER BY rowid').all()).results;return {active:all,archived:[],historyMembers:all.map(x=>({id:x.id,name:x.name,emoji:x.emoji})),version:0};}
 const all=(await env.DB.prepare('SELECT m.*,COALESCE(p.archived,0) AS archived FROM members m LEFT JOIN member_preferences p ON p.member_id=m.id ORDER BY COALESCE(p.position,m.rowid),m.rowid').all()).results;
 const version=(await env.DB.prepare('SELECT version FROM member_management WHERE id=1').first())?.version||0;
 return {active:all.filter(x=>!x.archived),archived:all.filter(x=>x.archived),historyMembers:all.map(x=>({id:x.id,name:x.name,emoji:x.emoji})),version};
}
export async function isActive(env:Env,id:string){if(!await hasPreferences(env))return true;return !(await env.DB.prepare('SELECT member_id FROM member_preferences WHERE member_id=? AND archived=1').bind(id).first());}
const value=(v:unknown,max:number)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail(400,'invalid_member');return (v as string).trim();};
export async function manageMembers(request:Request,env:Env){
 const input=await body(request);if(!['add','edit','archive','restore','reorder'].includes(input.action)||!Number.isSafeInteger(input.version)||input.version<0)fail(400,'invalid_member');
 const schemas=["CREATE TABLE IF NOT EXISTS member_preferences (member_id TEXT PRIMARY KEY REFERENCES members(id),position INTEGER NOT NULL,archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)))","CREATE TABLE IF NOT EXISTS member_management (id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL DEFAULT 0)","INSERT OR IGNORE INTO member_management VALUES (1,0)","CREATE TABLE IF NOT EXISTS member_update_guard (id INTEGER PRIMARY KEY CHECK(id=1),valid INTEGER NOT NULL CHECK(valid=1))","INSERT OR IGNORE INTO member_preferences SELECT id,rowid,0 FROM members","CREATE TRIGGER IF NOT EXISTS member_active_history BEFORE INSERT ON history WHEN NEW.kind IN ('task','reward') AND EXISTS (SELECT 1 FROM member_preferences WHERE member_id=NEW.member_id AND archived=1) BEGIN SELECT RAISE(ABORT,'member_inactive'); END;"];
 await env.DB.batch(schemas.map(s=>env.DB.prepare(s)));
 const state=await memberState(env),all=[...state.active,...state.archived];if(state.version!==input.version)fail(409,'members_changed_refresh');
 const target=input.action==='add'||input.action==='reorder'?undefined:all.find(x=>x.id===value(input.id,150));if(!['add','reorder'].includes(input.action)&&!target)fail(404,'member_not_found');
 const statements=[env.DB.prepare('INSERT INTO member_update_guard SELECT 1,CASE WHEN EXISTS (SELECT 1 FROM member_management WHERE id=1 AND version=?) THEN 1 ELSE 0 END').bind(input.version)];
 if(input.action==='add'||input.action==='edit'){
  const name=value(input.name,40),emoji=value(input.emoji,16);if(all.some(x=>x.name===name&&x.id!==target?.id))fail(409,'member_name_in_use');
  if(input.action==='add'){
   if(state.active.length>=12||all.length>=50)fail(409,'member_limit_reached');
   const points=input.points??0;if(!Number.isSafeInteger(points)||points<0||points>1_000_000_000)fail(400,'invalid_member');
   const id='m-'+crypto.randomUUID();statements.push(env.DB.prepare('INSERT INTO members(id,name,emoji,points,is_child) VALUES (?,?,?,?,1)').bind(id,name,emoji,points),env.DB.prepare('INSERT INTO member_preferences SELECT ?,COALESCE(MAX(position),0)+1,0 FROM member_preferences').bind(id));
  }else statements.push(env.DB.prepare('UPDATE members SET name=?,emoji=? WHERE id=?').bind(name,emoji,target!.id));
 }else if(input.action==='archive'){
  if(target!.archived)fail(409,'members_changed_refresh');if(state.active.length<=1)fail(409,'last_member_required');
  statements.push(env.DB.prepare('UPDATE member_preferences SET archived=1 WHERE member_id=?').bind(target!.id));
 }else if(input.action==='restore'){
  if(!target!.archived)fail(409,'members_changed_refresh');if(state.active.length>=12)fail(409,'member_limit_reached');statements.push(env.DB.prepare('UPDATE member_preferences SET archived=0 WHERE member_id=?').bind(target!.id));
 }else{
  if(!Array.isArray(input.ids)||input.ids.length!==state.active.length||new Set(input.ids).size!==input.ids.length||input.ids.some((id:unknown)=>typeof id!=='string'||!state.active.some(x=>x.id===id)))fail(409,'members_changed_refresh');
  for(let i=0;i<input.ids.length;i++)statements.push(env.DB.prepare('UPDATE member_preferences SET position=? WHERE member_id=?').bind(i,input.ids[i]));
 }
 statements.push(env.DB.prepare('UPDATE member_management SET version=version+1 WHERE id=1'),env.DB.prepare('DELETE FROM member_update_guard WHERE id=1'));
 try{await env.DB.batch(statements);}catch(error){if(/constraint/i.test(String(error)))fail(409,'members_changed_refresh');throw error;}
 return json({ok:true});
}

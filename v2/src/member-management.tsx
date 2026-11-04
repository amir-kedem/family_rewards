import React,{useState} from 'react';
type Member={id:string;name:string;emoji:string;points:number};
type Props={members:Member[];archived:Member[];version:number;request:(path:string,input?:unknown)=>Promise<any>;updated:()=>Promise<unknown>};
export function MemberManagement({members,archived,version,request,updated}:Props){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function act(input:Record<string,unknown>){if(busy)return false;setBusy(true);setError('');try{await request('/members',{...input,version});await updated();return true;}catch(e){setError((e as Error).message);return false;}finally{setBusy(false);}}
 async function move(index:number,direction:number){const ids=members.map(x=>x.id),other=index+direction;[ids[index],ids[other]]=[ids[other],ids[index]];await act({action:'reorder',ids});}
 return <section className="card memberManagement"><h2>המשתתפים בבית</h2><p>אפשר לעדכן את המשתתפים גם אחרי ההקמה. הסדר כאן הוא הסדר בבחירת הילד; הראשון הוא ברירת המחדל.</p>
 {error&&<p className="error" role="alert">{error}</p>}
 <div className="memberList">{members.map((member,i)=><div className="memberRow" key={member.id+'-'+version}>
  <form className="memberEdit" onSubmit={e=>{e.preventDefault();const values=new FormData(e.currentTarget);void act({action:'edit',id:member.id,name:values.get('name'),emoji:values.get('emoji')});}}>
   <label>שם<input name="name" defaultValue={member.name} maxLength={40} disabled={busy} required /></label><label className="memberEmoji">סמל<input name="emoji" defaultValue={member.emoji} maxLength={16} disabled={busy} required /></label><button className="button" disabled={busy}>שמירה</button>
  </form>
  <div className="memberButtons"><button type="button" className="button" aria-label={'העברת '+member.name+' למעלה'} disabled={busy||i===0} onClick={()=>void move(i,-1)}>↑</button><button type="button" className="button" aria-label={'העברת '+member.name+' למטה'} disabled={busy||i===members.length-1} onClick={()=>void move(i,1)}>↓</button><button type="button" className="button" disabled={busy||members.length<=1} onClick={()=>{if(window.confirm('להסיר את '+member.name+' מהמשתתפים הפעילים? הנקודות וההיסטוריה יישמרו ואפשר יהיה להחזיר בהמשך.'))void act({action:'archive',id:member.id});}}>הסרה מהמשתתפים</button></div>
 </div>)}</div>
 <form className="formFields memberAdd" onSubmit={async e=>{e.preventDefault();const form=e.currentTarget,values=new FormData(form);if(await act({action:'add',name:values.get('name'),emoji:values.get('emoji'),points:Number(values.get('points'))}))form.reset();}}><h3>הוספת ילד או ילדה</h3><div className="memberEdit"><label>שם<input name="name" maxLength={40} required disabled={busy}/></label><label className="memberEmoji">סמל<input name="emoji" defaultValue="⭐" maxLength={16} required disabled={busy}/></label><label>נקודות התחלה<input name="points" type="number" min={0} max={1000000000} step={1} defaultValue={0} required disabled={busy}/></label></div><p className="smallMuted">נקודות התחלה אינן נחשבות כהתקדמות ליעד החודשי. יש להשאיר לפחות משתתף פעיל אחד.</p><button className="button primary" disabled={busy||members.length>=12}>הוספת משתתף/ת</button></form>
 {archived.length>0&&<details className="memberArchived"><summary>משתתפים שהוסרו ({archived.length})</summary><p>הנקודות והפעילות הקודמת נשמרות. אפשר להחזיר משתתף עם אותה יתרה והיסטוריה.</p>{archived.map(member=><div className="archivedRow" key={member.id}><span>{member.emoji} {member.name} · {member.points.toLocaleString('he-IL')} נק׳</span><button className="button" disabled={busy||members.length>=12} onClick={()=>void act({action:'restore',id:member.id})}>החזרה למשתתפים</button></div>)}</details>}
 </section>;
}

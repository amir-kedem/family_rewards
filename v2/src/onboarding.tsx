import React,{useEffect,useState} from 'react';
type Draft={familyName:string;children:{name:string;emoji:string;points:number}[];catalog:{kind:'task'|'reward';category:string;title:string;emoji:string;value:number}[];familyGoal:number;step:number};
type Status={required:boolean;stage?:string;authorized?:boolean;draft?:Draft;version?:number};
type Request=(path:string,input?:unknown)=>Promise<any>;
const initial:Draft={familyName:'הבית שלנו',children:[],catalog:[],familyGoal:5000,step:1};
function requestKey() {
  const bytes=crypto.getRandomValues(new Uint8Array(16));
  bytes[6]=(bytes[6]&15)|64; bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
}
const suggestions:Draft['catalog']=[
  {kind:'task',category:'chores',title:'סידור החדר',emoji:'🧹',value:10},
  {kind:'task',category:'education',title:'קריאה משותפת',emoji:'📚',value:20},
  {kind:'reward',category:'chores',title:'בחירת משחק משפחתי',emoji:'🎲',value:50},
  {kind:'reward',category:'chores',title:'פעילות מיוחדת יחד',emoji:'🎁',value:150},
];
export function OnboardingGate({request,children}:{request:Request;children:React.ReactNode}) {
  const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState('');
  async function check(){setError('');try{setStatus(await request('/setup'));}catch(e){setError((e as Error).message);}}
  useEffect(()=>{void check();},[]);
  if(!status) return <main className="login card"><h1>הבית שלנו 🌱</h1><p role="status">{error || 'טוענים…'}</p>{error&&<button className="button" onClick={()=>void check()}>ניסיון חוזר</button>}</main>;
  return status.required ? <Setup status={status} request={request} done={()=>setStatus({required:false})} /> : children;
}
function Setup({status,request,done}:{status:Status;request:Request;done:()=>void}) {
  const [access,setAccess]=useState(status),[draft,setDraft]=useState<Draft>(status.draft||initial),[version,setVersion]=useState(status.version||0),
    [step,setStep]=useState(status.draft?.step||1),[busy,setBusy]=useState(false),[error,setError]=useState(''),
    [parentPassword,setParentPassword]=useState(''),[parentConfirm,setParentConfirm]=useState(''),
    [familyPassword,setFamilyPassword]=useState(''),[familyConfirm,setFamilyConfirm]=useState(''),
    [requestId]=useState(requestKey),[token]=useState(()=>new URLSearchParams(location.hash.slice(1)).get('setup')||'');
  useEffect(()=>{
    // The invitation is sent in a POST body, never in a query string/referrer.
    if(new URLSearchParams(location.hash.slice(1)).has('setup')) history.replaceState(null,'',location.pathname+location.search);
  },[]);
  function apply(result:Status){setAccess(result);setDraft(result.draft||initial);setVersion(result.version||0);setStep(result.draft?.step||1);}
  function failure(e:unknown){setError((e as Error).message);if((e as {status?:number}).status===401){setAccess({...access,authorized:false});setFamilyPassword('');setFamilyConfirm('');}}
  async function claim(e:React.FormEvent){
    e.preventDefault();if(busy)return;setError('');
    if(access.stage==='pending'&&parentPassword!==parentConfirm){setError('הסיסמאות אינן זהות');return;}
    setBusy(true);try{apply(await request(access.stage==='pending'?'/setup/claim':'/setup/resume',{token,parentPassword}));}catch(e){failure(e);}finally{setParentPassword('');setParentConfirm('');setBusy(false);}
  }
  async function save(next:number){
    if(busy)return;setError('');
    if(step===1&&!draft.children.length){setError('יש להוסיף ילד או ילדה כדי להתחיל');return;}
    setBusy(true);try{const result=await request('/setup/draft',{version,draft:{...draft,step:next}});setDraft(result.draft);setVersion(result.version);setStep(next);}catch(e){failure(e);}finally{setBusy(false);}
  }
  async function finish(e:React.FormEvent){
    e.preventDefault();if(busy)return;setError('');
    if(familyPassword!==familyConfirm){setError('הסיסמאות אינן זהות');return;}
    setBusy(true);try{await request('/setup/complete',{version,familyPassword,requestId});done();}catch(e){failure(e);}finally{setFamilyPassword('');setFamilyConfirm('');setBusy(false);}
  }
  const title=['','הילדים שלנו','פעילויות ופרסים','היעד המשפחתי','סקירה והתחלה'][step];
  const updateChild=(index:number,patch:Partial<Draft['children'][number]>)=>setDraft({...draft,children:draft.children.map((c,i)=>i===index?{...c,...patch}:c)});
  const updateItem=(index:number,patch:Partial<Draft['catalog'][number]>)=>setDraft({...draft,catalog:draft.catalog.map((c,i)=>i===index?{...c,...patch}:c)});
  const move=(index:number,direction:number)=>{const list=[...draft.children];[list[index],list[index+direction]]=[list[index+direction],list[index]];setDraft({...draft,children:list});};
  if(!access.authorized) return <main className="login card setupWizard">
    <h1>{access.stage==='pending'?'ברוכים הבאים לבית שלנו 🌱':'ממשיכים בהגדרת הבית 🌱'}</h1>
    <p>מגדירים את הילדים, הפעילויות והפרסים שמתאימים למשפחה שלכם.</p>
    {access.stage==='pending'&&!token?<p>כדי להתחיל, פתחו את קישור ההזמנה הפרטי שקיבלתם ממנהל האפליקציה.</p>:<form className="formFields" onSubmit={e=>void claim(e)}>
      <label>{access.stage==='pending'?'בחרו סיסמת הורה':'סיסמת ההורה שבחרתם'}<input type="password" minLength={4} maxLength={256} autoComplete={access.stage==='pending'?'new-password':'current-password'} required value={parentPassword} onChange={e=>setParentPassword(e.target.value)} disabled={busy} /></label>
      {access.stage==='pending'&&<><label>אימות סיסמת ההורה<input type="password" minLength={4} maxLength={256} autoComplete="new-password" required value={parentConfirm} onChange={e=>setParentConfirm(e.target.value)} disabled={busy} /></label><p>לפחות 4 תווים. הסיסמה הזאת נשארת אצל ההורים; בהמשך תבחרו קוד נפרד לילדים.</p></>}
      <button className="button primary" disabled={busy}>{busy?'רגע…':access.stage==='pending'?'מתחילים':'המשך הגדרה'}</button>
    </form>}{error&&<p className="error" role="alert">{error}</p>}
  </main>;
  return <main className="card setupWizard">
    <p className="smallMuted">הגדרת הבית · שלב {step} מתוך 4</p><h1>{title}</h1>
    <progress value={step} max={4} aria-label="התקדמות הגדרת הבית" />
    {step===1&&<section className="formFields"><p>הילד הראשון ברשימה יופיע כברירת מחדל. אפשר לשנות את הסדר. יתרת פתיחה לא נספרת כהישג של החודש.</p>
      {draft.children.map((child,i)=><fieldset className="setupRow" key={i}><legend>ילד/ה {i+1}{i===0?' · ברירת מחדל':''}</legend>
        <label>שם<input value={child.name} maxLength={40} onChange={e=>updateChild(i,{name:e.target.value})} disabled={busy}/></label>
        <label>סמל<input value={child.emoji} maxLength={16} onChange={e=>updateChild(i,{emoji:e.target.value})} disabled={busy}/></label>
        <label>יתרת פתיחה<input type="number" min={0} max={1000000000} step={1} value={child.points} onChange={e=>updateChild(i,{points:Number(e.target.value)})} disabled={busy}/></label>
        <div className="toolbar"><button className="button" disabled={busy||i===0} onClick={()=>move(i,-1)} aria-label={'העברת '+(child.name||'ילד')+' למעלה'}>↑</button><button className="button" disabled={busy||i===draft.children.length-1} onClick={()=>move(i,1)} aria-label={'העברת '+(child.name||'ילד')+' למטה'}>↓</button><button className="button ghost" disabled={busy} onClick={()=>setDraft({...draft,children:draft.children.filter((_,n)=>n!==i)})}>הסרה</button></div>
      </fieldset>)}
      <button className="button" disabled={busy||draft.children.length>=12} onClick={()=>setDraft({...draft,children:[...draft.children,{name:'',emoji:'⭐',points:0}]})}>הוספת ילד/ה</button>
    </section>}
    {step===2&&<section className="formFields"><p>אפשר להתחיל מכמה דוגמאות, לערוך אותן או ליצור רשימה משלכם. אפשר להוסיף ולשנות גם אחר כך במצב הורה.</p>
      <div className="setupSuggestions">{suggestions.map((item,i)=><button className="button ghost" key={i} disabled={busy||draft.catalog.length>=100} onClick={()=>setDraft({...draft,catalog:[...draft.catalog,{...item}]})}>הוספה: {item.title} · {item.value} נק׳</button>)}</div>
      {draft.catalog.map((item,i)=><fieldset className="setupRow" key={i}><legend>{item.kind==='task'?'פעילות':'פרס'} {i+1}</legend>
        <label>שם<input value={item.title} maxLength={150} onChange={e=>updateItem(i,{title:e.target.value})} disabled={busy}/></label>
        <label>נקודות<input type="number" min={1} max={1000000} step={1} value={item.value} onChange={e=>updateItem(i,{value:Number(e.target.value)})} disabled={busy}/></label>
        {item.kind==='task'&&<label>קטגוריה<select value={item.category} onChange={e=>updateItem(i,{category:e.target.value})} disabled={busy}><option value="chores">מטלות</option><option value="education">לימודים</option><option value="behavior">התנהגות</option></select></label>}
        <button className="button ghost" disabled={busy} onClick={()=>setDraft({...draft,catalog:draft.catalog.filter((_,n)=>n!==i)})}>הסרה</button>
      </fieldset>)}
      <div className="toolbar">{(['task','reward'] as const).map(kind=><button className="button" key={kind} disabled={busy||draft.catalog.length>=100} onClick={()=>setDraft({...draft,catalog:[...draft.catalog,{kind,category:'chores',title:'',emoji:kind==='task'?'⭐':'🎁',value:10}]})}>{kind==='task'?'הוספת פעילות':'הוספת פרס'}</button>)}</div>
    </section>}
    {step===3&&<section className="formFields"><label>שם הבית<input value={draft.familyName} maxLength={60} onChange={e=>setDraft({...draft,familyName:e.target.value})} disabled={busy}/></label><label>היעד החודשי בנקודות<input type="number" min={1} max={1000000000} step={1} value={draft.familyGoal} onChange={e=>setDraft({...draft,familyGoal:Number(e.target.value)})} disabled={busy}/></label><p>ההתקדמות מחושבת לפי החודש בישראל. נקודות שמרוויחים במהלך החודש מקדמות את היעד; מימוש פרס לא מוריד ממנו.</p></section>}
    {step===4&&<section className="formFields"><h2>{draft.familyName}</h2><p>הסדר והיתרות שבחרתם:</p><ul>{draft.children.map((child,i)=><li key={i}>{child.emoji} {child.name}: {child.points} נק׳{i===0?' · ברירת מחדל':''}</li>)}</ul><p>{draft.catalog.filter(i=>i.kind==='task').length} פעילויות · {draft.catalog.filter(i=>i.kind==='reward').length} פרסים · יעד חודשי {draft.familyGoal} נק׳</p><p>סיסמת ההורה כבר נשמרה. עכשיו בחרו קוד משפחה נפרד שתוכלו לשתף עם הילדים.</p>
      <form onSubmit={e=>void finish(e)}><label>סיסמת המשפחה<input type="password" minLength={4} maxLength={256} autoComplete="new-password" required value={familyPassword} onChange={e=>setFamilyPassword(e.target.value)} disabled={busy}/></label><label>אימות סיסמת המשפחה<input type="password" minLength={4} maxLength={256} autoComplete="new-password" required value={familyConfirm} onChange={e=>setFamilyConfirm(e.target.value)} disabled={busy}/></label><p>לפחות 4 תווים. לאחר ההתחלה אפשר לשתף את כתובת הבית ואת קוד המשפחה עם הילדים. את סיסמת ההורה שומרים אצלכם.</p><button className="button primary" disabled={busy}>{busy?'מכינים את הבית…':'הכול מוכן, מתחילים!'}</button></form>
    </section>}
    {error&&<p className="error" role="alert">{error}</p>}
    <div className="setupNavigation">{step>1&&<button className="button" disabled={busy} onClick={()=>void save(step-1)}>חזרה</button>}{step<4&&<button className="button primary" disabled={busy} onClick={()=>void save(step+1)}>{busy?'שומרים…':'שמירה והמשך'}</button>}</div>
    <p className="smallMuted">הטיוטה נשמרת כשעוברים שלב. אם תצאו, אפשר לחזור עם סיסמת ההורה שבחרתם. להעברת נתונים קיימים בקשו עזרה לפני השלמת ההגדרה.</p>
  </main>;
}

export class PublicError extends Error {constructor(status,code){super(code);this.status=status;}}
export const fail=(status,code)=>{throw new PublicError(status,code);};
export const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');
export const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
export function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'}});}
export async function body(request){
 if(request.headers.get('Content-Type')?.split(';')[0].trim()!=='application/json')fail(415,'json_required');
 const reader=request.body?.getReader();let bytes=0;const chunks=[];
 if(reader)while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>4096){await reader.cancel();fail(413,'request_too_large');}chunks.push(value);}
 try{const all=new Uint8Array(bytes);let at=0;for(const part of chunks){all.set(part,at);at+=part.length;}const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all));if(!result||Array.isArray(result)||typeof result!=='object')throw Error();return result;}catch{fail(400,'invalid_request');}
}
const decode=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9_-]+$/.test(value))throw Error();return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));};
const read=value=>JSON.parse(new TextDecoder().decode(decode(value)));
let certCache;
export async function owner(request,env,fetcher=fetch){
 if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN||'')||!/^[a-f0-9]{64}$/i.test(env.ACCESS_AUD||'')||!env.OWNER_EMAIL||new URL(request.url).origin!==env.CONSOLE_ORIGIN)fail(503,'owner_configuration_required');
 const token=request.headers.get('Cf-Access-Jwt-Assertion');if(!token||token.length>16384)fail(403,'owner_sign_in_required');
 try{
  const [h,p,s,...rest]=token.split('.');if(rest.length)throw Error();const header=read(h),claims=read(p),now=Date.now()/1000;
  if(header.alg!=='RS256'||typeof header.kid!=='string'||claims.iss!==env.ACCESS_TEAM_DOMAIN||!Array.isArray(claims.aud)||!claims.aud.includes(env.ACCESS_AUD)||typeof claims.exp!=='number'||claims.exp<=now||typeof claims.iat!=='number'||claims.iat>now+30||(claims.nbf!==undefined&&(typeof claims.nbf!=='number'||claims.nbf>now+30))||typeof claims.email!=='string'||claims.email.toLowerCase()!==env.OWNER_EMAIL.toLowerCase()||typeof claims.sub!=='string'||!claims.sub)throw Error();
  if(!certCache||certCache.origin!==env.ACCESS_TEAM_DOMAIN||certCache.until<Date.now()){
   const r=await fetcher(env.ACCESS_TEAM_DOMAIN+'/cdn-cgi/access/certs',{redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error();const data=await r.json();if(!Array.isArray(data.keys)||data.keys.length>20)throw Error();certCache={origin:env.ACCESS_TEAM_DOMAIN,keys:data.keys,until:Date.now()+300000};
  }
  const jwk=certCache.keys.find(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.alg||k.alg==='RS256'));if(!jwk)throw Error();
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(s),new TextEncoder().encode(h+'.'+p)))throw Error();
  return claims.email.toLowerCase();
 }catch{fail(403,'owner_sign_in_required');}
}
export async function seal(value,keyHex){
 if(!/^[a-f0-9]{64}$/i.test(keyHex||''))fail(503,'invitation_key_required');
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(keyHex.match(/../g),s=>parseInt(s,16)),'AES-GCM',false,['encrypt']);const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(value)));return {iv:Array.from(iv),data:Array.from(encrypted)};
}
export async function unseal(value,keyHex){
 if(!/^[a-f0-9]{64}$/i.test(keyHex||''))fail(503,'invitation_key_required');
 try{const key=await crypto.subtle.importKey('raw',Uint8Array.from(keyHex.match(/../g),s=>parseInt(s,16)),'AES-GCM',false,['decrypt']);return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(value.iv)},key,new Uint8Array(value.data)));}catch{fail(503,'invitation_unavailable');}
}

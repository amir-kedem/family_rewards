import {owner,fail,json,PublicError} from './security.mjs';
export function createRouter(verify=owner){return {
 async fetch(request,env){
  try{
   const email=await verify(request,env),url=new URL(request.url);
   if(!['GET','POST'].includes(request.method))fail(405,'method_not_allowed');
   if(request.method==='POST'&&request.headers.get('Origin')!==url.origin)fail(403,'invalid_origin');
   if(url.pathname.startsWith('/api/')){
    // Authentication is completed here for every request; original caller
    // headers cannot supply or override the identity forwarded to the object.
    const headers=new Headers(request.headers);headers.delete('Cf-Access-Jwt-Assertion');headers.delete('Cookie');headers.set('X-Verified-Owner',email);
    return env.HOUSEHOLDS.get(env.HOUSEHOLDS.idFromName('owner-registry-v1')).fetch(new Request(request,{headers}));
   }
   if(request.method!=='GET')fail(405,'method_not_allowed');
   const response=await env.ASSETS.fetch(request);const headers=new Headers(response.headers);headers.set('Cache-Control','no-store');headers.set('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");headers.set('Referrer-Policy','no-referrer');headers.set('X-Frame-Options','DENY');headers.set('X-Content-Type-Options','nosniff');headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');return new Response(response.body,{status:response.status,headers});
  }catch(error){return json({error:error instanceof PublicError?error.message:'owner_console_unavailable'},error instanceof PublicError?error.status:500);}
 }
};}

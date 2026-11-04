export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status=status; }
}
export function fail(status: number, message: string): never { throw new ApiError(status,message); }
export function json(value: unknown, status=200, extra: Record<string,string>={}) {
  return new Response(JSON.stringify(value),{status,headers:{
    'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer',
    'X-Frame-Options':'DENY', ...extra,
  }});
}
export async function body(request: Request, maximum=8192): Promise<any> {
  if (Number(request.headers.get('Content-Length')) > maximum) fail(413,'request_too_large');
  const reader=request.body?.getReader();
  if (!reader) fail(400,'invalid_json');
  const chunks: Uint8Array[]=[]; let length=0;
  try {
    while (true) {
      const {done,value}=await reader.read(); if(done) break;
      length+=value.byteLength;
      if(length>maximum) { await reader.cancel(); fail(413,'request_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes=new Uint8Array(length); let position=0;
  for(const chunk of chunks) { bytes.set(chunk,position); position+=chunk.length; }
  try {
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(!value || typeof value!=='object' || Array.isArray(value)) fail(400,'invalid_json');
    return value;
  } catch { fail(400,'invalid_json'); }
}

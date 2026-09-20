import type { Provider } from './types';

export class AppError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function json(data: unknown, status = 200) {
  return Response.json(data, {status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
export function failure(error: unknown) {
  if (error instanceof AppError) return json({error:error.message},error.status);
  if (error instanceof Error && /abort|timeout/i.test(error.name)) return json({error:'The request timed out or was canceled. Try again with a smaller file.'},504);
  return json({error:'The request could not be completed. Please try again.'},500);
}
export async function body(request: Request): Promise<Record<string, unknown>> {
  const origin=request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new AppError('Cross-origin requests are not allowed.',403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new AppError('Expected a JSON request.',415);
  const reader=request.body?.getReader();
  if (!reader) throw new AppError('Missing request body.');
  let bytes=0; const chunks:Uint8Array[]=[];
  while (true) {
    const {value,done}=await reader.read(); if(done)break;
    bytes+=value.length; if(bytes>400_000){await reader.cancel();throw new AppError('Request exceeds the size limit.',413);} chunks.push(value);
  }
  const data=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
  try {const parsed=JSON.parse(new TextDecoder().decode(data)); if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')throw new Error(); return parsed;}
  catch {throw new AppError('Invalid JSON request.');}
}
export function string(value:unknown,name:string,max=1000):string {
  if(typeof value!=='string'||!value.trim()||value.length>max)throw new AppError(`Invalid ${name}.`);
  return value;
}
export function credentials(data:Record<string,unknown>):{key:string;provider:Provider} {
  const key=string(data.key,'API key',500).trim();
  if(!['openai','anthropic','gemini'].includes(String(data.provider)))throw new AppError('Select a supported provider.');
  if(/[\r\n]/.test(key))throw new AppError('Invalid API key.');
  return {key,provider:data.provider as Provider};
}
export async function upstream(url:string,init:RequestInit={},signal?:AbortSignal) {
  const response=await fetch(url,{...init,redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(90_000)]):AbortSignal.timeout(90_000)});
  if(!response.ok){
    // Never return raw provider errors: these can contain user code or credentials.
    await response.body?.cancel();
    if(response.status===401||response.status===403)throw new AppError('Access denied. Check your API key, provider, and model permissions.',401);
    if(response.status===429)throw new AppError('Provider rate limit or quota reached. Check billing or try again later.',429);
    if(response.status===404)throw new AppError('The requested model or repository was not found.',404);
    throw new AppError(`Provider request failed (${response.status}). Try a different model or a smaller input.`,502);
  }
  return response;
}

export async function readJson<T>(response:Response,maxBytes=2_000_000):Promise<T>{
  const reader=response.body?.getReader();if(!reader)throw new AppError('The upstream service returned an empty response.',502);
  const chunks:Uint8Array[]=[];let bytes=0;
  while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>maxBytes){await reader.cancel();throw new AppError('The upstream response exceeds the size limit. Choose a smaller input.',413);}chunks.push(value);}
  const joined=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder().decode(joined)) as T;}catch{throw new AppError('The upstream service returned invalid JSON.',502);}
}

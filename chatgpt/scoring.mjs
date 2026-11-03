import {visualResult} from './visual-result.mjs';
import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import path from 'node:path';import {createHash,randomUUID,randomBytes} from 'node:crypto';
const VISUAL='https://biuuka.com/api/v1/public/visual-score';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const error=code=>Object.assign(Error(code),{code});
function transportError(e){
 if(e.code?.startsWith('score_')||e.code==='network_disabled')return e;
 const code=e.cause?.code||e.code||e.name;
 return error(['ENOTFOUND','EAI_AGAIN'].includes(code)?'score_dns_failed':['CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','SELF_SIGNED_CERT_IN_CHAIN'].includes(code)?'score_tls_failed':['TimeoutError','UND_ERR_CONNECT_TIMEOUT','ETIMEDOUT'].includes(code)?'score_timeout':'score_connection_failed');
}
export function scoringInput(answer){
 if(typeof answer!=='string'||Buffer.byteLength(answer)>2*1024*1024)throw error('score_input_invalid');
 const starts=[...answer.matchAll(/<svg\b/gi)],ends=[...answer.matchAll(/<\/svg\s*>/gi)];
 if(starts.length!==1||ends.length!==1||ends[0].index<starts[0].index)throw error('score_svg_required');
 const svg=answer.slice(starts[0].index,ends[0].index+ends[0][0].length);
 if(Buffer.byteLength(svg)>1048576)throw error('score_too_large');
 // Never silently treat CSS/canvas HTML as a comparable standalone SVG.
 const outside=answer.slice(0,starts[0].index)+answer.slice(ends[0].index+ends[0][0].length);
 if(/<(?:style|script|canvas)\b/i.test(outside))throw error('score_standalone_required');
 if(/<(?:script|foreignObject|image)\b|<!DOCTYPE|<!ENTITY|\bon\w+\s*=|(?:href\s*=\s*["']\s*(?!#)[^"']+)|@import/i.test(svg))throw error('score_unsafe_svg');
 for(const match of svg.matchAll(/url\(\s*([^)]*)\)/gi)){const value=match[1].replace(/&quot;|&#0*34;|&#x0*22;/gi,'"').replace(/&apos;|&#0*39;|&#x0*27;/gi,"'").trim().replace(/^(["'])([\s\S]*)\1$/,'$2').trim();if(!/^#[\w:.-]+$/.test(value))throw error('score_unsafe_svg');}
 return {svg,hash:createHash('sha256').update(svg).digest('hex'),inputKind:/<html\b|<!doctype html/i.test(answer)?'svg-fragment':'svg'};
}
const text=x=>typeof x==='string'?x.slice(0,2000):'';
export function createScoring({state,records,online,fetcher=fetch,now=Date.now}){
 const root=path.join(state,'scores');let active=false,workerFlight=null;const visualTickets=new Map();
 const file=(id,p)=>{if(!uuid.test(id)||!['openenv','openenv-vision','pelicanscore'].includes(p))throw error('score_input_invalid');return path.join(root,id+'-'+p+'.json');};
 const load=async(id,p)=>{try{return JSON.parse(await readFile(file(id,p),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
 const save=async(id,p,value)=>{await mkdir(root,{recursive:true,mode:0o700});const dest=file(id,p),temp=dest+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value),{mode:0o600,flag:'wx'});await rename(temp,dest);return value;};
 const sourceFile=id=>{file(id,'openenv');return path.join(root,id+'-source.json');};
 async function input(id,snapshotSvg){
  const record=await records.get(id);if(!['pelican','pelican-svg'].includes(record.preset)||record.status!=='complete')throw error('score_record_not_ready');
  const originalHash=createHash('sha256').update(record.answer||'').digest('hex');
  let saved;try{saved=JSON.parse(await readFile(sourceFile(id),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(saved){if(saved.originalHash!==originalHash)throw error('score_source_changed');return {...scoringInput(saved.svg),inputKind:'svg-snapshot'};}
  // Existing Biuuka scores retain their input; retired providers do not gate new scoring.
  if(await load(id,'openenv-vision'))return scoringInput(record.answer);
  if(snapshotSvg!==undefined){
   const source=scoringInput(snapshotSvg);if(source.inputKind!=='svg')throw error('score_standalone_required');
   await mkdir(root,{recursive:true,mode:0o700});const dest=sourceFile(id),temp=dest+'.'+randomUUID()+'.tmp';
   await writeFile(temp,JSON.stringify({svg:source.svg,originalHash,inputKind:'svg-snapshot'}),{mode:0o600,flag:'wx'});await rename(temp,dest);
   return {...source,inputKind:'svg-snapshot'};
  }
  return scoringInput(record.answer);
 }
 async function visualRequest(key,svg){
  if(!online())throw error('network_disabled');
  const abort=new AbortController(),timer=setInterval(()=>{if(!online())abort.abort();},200);
  const options={redirect:'error',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(30000)])};
  const decode=async r=>{let size=0,parts=[];for await(const b of r.body){size+=b.length;if(size>262144)throw error('score_response_invalid');parts.push(b);}try{return JSON.parse(Buffer.concat(parts));}catch{throw error('score_response_invalid');}};
  try{
   let headers={};
   if(svg!==undefined){
    const csrf=await fetcher('https://biuuka.com/api/v1/auth/csrf',options);
    if(!csrf.ok)throw error('score_remote_failed');
    const cookie=csrf.headers.getSetCookie().map(c=>c.split(';')[0]).filter(c=>c.startsWith('BIUUKA_SESSION=')).join('; '),data=(await decode(csrf)).data;
    if(!cookie||data?.headerName!=='X-CSRF-TOKEN'||typeof data.token!=='string')throw error('score_response_invalid');
    headers={'Content-Type':'application/json',Cookie:cookie,'X-CSRF-TOKEN':data.token};
   }
   if(!online())throw error('network_disabled');
   const r=await fetcher(svg===undefined?VISUAL+'/'+key:VISUAL,{...options,method:svg===undefined?'GET':'POST',headers,...(svg===undefined?{}:{body:JSON.stringify({requestKey:key,svg})})});
   if(!r.ok){await r.body?.cancel();throw Object.assign(error(r.status===404?'score_not_found':r.status===409?'score_busy':r.status===413?'score_upload_too_large':'score_remote_failed'),{httpStatus:r.status});}
   const data=(await decode(r)).data;if(data?.requestKey!==key)throw error('score_response_invalid');return data;
  }catch(e){if(!online())throw error('network_disabled');throw transportError(e);}finally{clearInterval(timer);}
 }
 async function visualDirect({id,snapshotSvg,refresh=false}){
  if(!online())throw error('network_disabled');if(active)throw error('score_busy');active=true;
  try{const source=await input(id,snapshotSvg);let prior=await load(id,'openenv-vision');
   if(prior&&prior.hash!==source.hash)throw error('score_source_changed');
   if(prior?.status==='completed')return prior;
   if(prior&&!prior.anonymous){
    try{await visualRequest(prior.requestKey);return {legacy:true};}catch(e){if(e.httpStatus!==404)throw e;}
    // The old UI created a local placeholder before login. No server task exists, so allow explicit anonymous submission with the same key.
    prior=await save(id,'openenv-vision',{...prior,anonymous:true,status:'not_submitted',message:''});
    if(refresh)return prior;
   }
   if(refresh&&!prior)throw error('score_not_found');
   const value=prior||{provider:'openenv-vision',anonymous:true,hash:source.hash,inputKind:source.inputKind,requestKey:randomUUID(),status:'submitting',createdAt:new Date().toISOString()};
   await save(id,'openenv-vision',value);
   const querying=!!(prior&&(refresh||prior.status!=='not_submitted'));
   try{
    let data;
    // An existing request is only queried. Even a timeout/restart must never create another model call.
    if(querying)data=await visualRequest(value.requestKey);else data=await visualRequest(value.requestKey,source.svg);
    let projection;if(data.status==='completed')projection=visualResult(data.result);else if(['pending','unknown','failed','rejected','expired'].includes(data.status))projection={status:data.status,message:text(data.message)};else throw error('score_response_invalid');
    return await save(id,'openenv-vision',{...value,...projection,checkedAt:new Date().toISOString()});
   }catch(e){const saved=await save(id,'openenv-vision',{...value,status:e.httpStatus===413||e.httpStatus===404||(!prior&&e.httpStatus===409)?'not_submitted':'unknown',message:e.httpStatus===404?'':e.code||'score_remote_failed',checkedAt:new Date().toISOString()});
    // Confirmed absence is recoverable, but querying must never resubmit.
    if(querying&&e.httpStatus===404)return saved;throw e;}
  }finally{active=false;}
 }
 // Durable opt-in is written by the test lifecycle, never supplied by a browser.
 async function runPending(){
  if(workerFlight||active||!online())return;
  workerFlight=(async()=>{
   for(const record of await records.list()){
    if(!online())break;
    if(record.autoScore!==true||record.preset!=='pelican'||record.status!=='complete'||!record.saved||!record.threadId||record.origin==='svg-import')continue;
    let prior=await load(record.id,'openenv-vision');
    if(prior&&(['completed','failed','rejected','expired'].includes(prior.status)||prior.anonymous===false||prior.retryAt>now()))continue;
    try{await visualDirect({id:record.id});}
    catch(e){
     if(['score_input_invalid','score_svg_required','score_standalone_required','score_unsafe_svg','score_too_large','score_source_changed'].includes(e.code)){
      await save(record.id,'openenv-vision',{...prior,provider:'openenv-vision',status:'failed',message:e.code,checkedAt:new Date().toISOString()});
     }
    }
    prior=await load(record.id,'openenv-vision');
    if(prior){
     // A rejected payload cannot become valid by repeatedly uploading it.
     if(prior.message==='score_upload_too_large')prior.status='failed';
     const attempts=(prior.attempts||0)+1;
     await save(record.id,'openenv-vision',{...prior,attempts,retryAt:now()+(prior.status==='pending'?5000:Math.min(300000,15000*2**Math.min(attempts,5)))});
    }
   }
  })();
  try{await workerFlight;}finally{workerFlight=null;}
 }
 return {
  runPending,
  visualSubmit:args=>visualDirect(args),
  visualRefresh:args=>visualDirect({...args,refresh:true}),
  async visualStart({id,snapshotSvg}){
   if(!online())throw error('network_disabled');if(active)throw error('score_busy');active=true;
   try{const source=await input(id,snapshotSvg),prior=await load(id,'openenv-vision');
    if(prior&&prior.hash!==source.hash)throw error('score_source_changed');
    const requestKey=prior?.requestKey||randomUUID();
    const value=prior||{provider:'openenv-vision',hash:source.hash,inputKind:source.inputKind,requestKey,status:'pending',createdAt:new Date().toISOString()};
    await save(id,'openenv-vision',value);
    for(const [k,t]of visualTickets)if(t.expiresAt<now()||t.id===id)visualTickets.delete(k);
    if(visualTickets.size>=20)throw error('score_busy');
    const ticket=randomBytes(32).toString('hex');visualTickets.set(ticket,{id,requestKey,svg:source.svg,expiresAt:now()+15*60*1000});return {ticket};
   }finally{active=false;}
  },
  async visualInput({ticket}){if(!online())throw error('network_disabled');const t=visualTickets.get(ticket);if(!t||t.expiresAt<=now())throw error('score_ticket_expired');return {requestKey:t.requestKey,svg:t.svg};},
  async visualAccept({ticket,value}){
   if(active)throw error('score_busy');active=true;try{
   if(!online())throw error('network_disabled');const t=visualTickets.get(ticket);if(!t||t.expiresAt<=now()||value?.requestKey!==t.requestKey)throw error('score_ticket_expired');
   const prior=await load(t.id,'openenv-vision');if(!prior||prior.requestKey!==t.requestKey)throw error('score_ticket_expired');
   if(prior.status==='completed')return {saved:true};
   let projection;if(value.status==='completed')projection=visualResult(value.result);else if(['pending','unknown','failed','rejected','expired'].includes(value.status))projection={status:value.status==='rejected'?'failed':value.status,message:text(value.message)};else throw error('score_response_invalid');
   await save(t.id,'openenv-vision',{...prior,...projection,checkedAt:new Date().toISOString()});return {saved:true};
   }finally{active=false;}
  },
  idle:()=>!active&&!workerFlight,
  async export({id,snapshotSvg}){if(active)throw error('score_busy');active=true;try{return {svg:(await input(id,snapshotSvg)).svg};}finally{active=false;}},
  async list(id){await records.get(id);const value=await load(id,'openenv-vision');return {scores:value?[value]:[]};},
  async remove(id){if(active)throw error('score_busy');for(const [key,t]of visualTickets)if(t.id===id)visualTickets.delete(key);await Promise.all([...['openenv','openenv-vision','pelicanscore'].map(p=>rm(file(id,p),{force:true})),rm(sourceFile(id),{force:true})]);},
 };
}

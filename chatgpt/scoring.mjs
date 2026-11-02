import {visualResult} from './visual-result.mjs';
import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import path from 'node:path';import {createHash,randomUUID,randomBytes} from 'node:crypto';
const PUBLIC='https://pelicanscore.com';
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
const number=(x,max=100)=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=max?x:null;
const text=x=>typeof x==='string'?x.slice(0,2000):'';
function publicResult(s){
 if(!s||!uuid.test(s.publicId))throw error('score_response_invalid');
 const result={remoteId:s.publicId,resultUrl:PUBLIC+'/result/'+s.publicId,status:['completed','failed'].includes(s.status)?s.status:'pending',message:'',errorCode:'',httpStatus:null,retryAt:null,retrySource:null};
 if(result.status==='failed')return {...result,machineScore:number(s.machineScore,20),judge:text(s.judgeModel),errorCode:text(s.errorCode),message:s.errorCode==='INVALID_JUDGE_RESPONSE'?'第三方视觉评委返回了无效分数，未生成总分。作品已上传，刷新只查询原任务，不会重复发布。':text(s.errorMessage)||'第三方评分失败'};
 if(result.status!=='completed')return result;
 if(s.isMock===true||s.renderNeedsReview===true)return {...result,status:'unverified',message:'第三方返回模拟评分或待复核结果，未作为正式分数。'};
 const score=number(s.totalScore);if(score===null)throw error('score_response_invalid');
 const details=[];
 for(const [key,label] of [['pelican','鹈鹕'],['bicycle','自行车'],['ridingRelationship','骑乘关系'],['mechanics','机械合理性'],['composition','构图']]){const d=s.judgeResult?.[key];if(d)details.push({name:label,score:number(d.score),maxScore:number(d.maxScore),reason:text(d.reason)});}
 return {...result,score,maxScore:100,mode:'third-party',machineScore:number(s.machineScore,20),visionScore:number(s.visionScore,80),details,feedback:text(s.judgeResult?.summary),version:text(s.scoringVersion),judge:text(s.judgeModel),judgePromptVersion:text(s.judgePromptVersion)};
}
export function createScoring({state,records,online,fetcher=fetch,now=Date.now}){
 const root=path.join(state,'scores');let active=false;const visualTickets=new Map();
 const file=(id,p)=>{if(!uuid.test(id)||!['openenv','openenv-vision','pelicanscore'].includes(p))throw error('score_input_invalid');return path.join(root,id+'-'+p+'.json');};
 const load=async(id,p)=>{try{return JSON.parse(await readFile(file(id,p),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
 const save=async(id,p,value)=>{await mkdir(root,{recursive:true,mode:0o700});const dest=file(id,p),temp=dest+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value),{mode:0o600,flag:'wx'});await rename(temp,dest);return value;};
 const cooldownFile=path.join(root,'pelicanscore-cooldown.json');
 const cooldowns=async()=>{try{return JSON.parse(await readFile(cooldownFile,'utf8'));}catch(e){if(e.code==='ENOENT')return {};throw e;}};
 async function guard(kind){const c=(await cooldowns())[kind];if(c&&Date.parse(c.retryAt)>now())throw Object.assign(error('score_rate_limited'),{httpStatus:429,...c});}
 async function limited(r,kind){
  const raw=r.headers.get('retry-after');let wait=NaN;
  if(raw&&/^\d+$/.test(raw.trim()))wait=Number(raw)*1000;
  else if(raw)wait=Date.parse(raw)-now();
  const official=Number.isFinite(wait)&&wait>=0&&wait<=8640000000000000-now();
  const c={retryAt:new Date(now()+(official?Math.max(1000,wait):60000)).toISOString(),retrySource:official?'server':'local'};
  const all=await cooldowns();all[kind]=c;await mkdir(root,{recursive:true,mode:0o700});
  const temp=cooldownFile+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(all),{mode:0o600,flag:'wx'});await rename(temp,cooldownFile);
  return Object.assign(error('score_rate_limited'),{httpStatus:429,...c});
 }
 async function request(url,body){
  if(!online())throw error('network_disabled');
  const kind=body===undefined?'query':'submit';await guard(kind);
  const abort=new AbortController(),timer=setInterval(()=>{if(!online())abort.abort();},200);
  try{const r=await fetcher(url,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(30000)])});
   if(!r.ok){const rate=r.status===429?await limited(r,kind):null;await r.body?.cancel();if(rate)throw rate;throw Object.assign(error(r.status===429?'score_rate_limited':r.status===403?'score_access_denied':r.status===413?'score_too_large':r.status>=500?'score_remote_failed':'score_http_rejected'),{httpStatus:r.status});}let bytes=0,parts=[];for await(const chunk of r.body){bytes+=chunk.length;if(bytes>262144)throw error('score_response_invalid');parts.push(chunk);}try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw error('score_response_invalid');}
  }catch(e){if(!online())throw error('network_disabled');throw transportError(e);
  }finally{clearInterval(timer);}
 }
 const sourceFile=id=>{file(id,'openenv');return path.join(root,id+'-source.json');};
 async function input(id,snapshotSvg){
  const record=await records.get(id);if(!['pelican','pelican-svg'].includes(record.preset)||record.status!=='complete')throw error('score_record_not_ready');
  const originalHash=createHash('sha256').update(record.answer||'').digest('hex');
  let saved;try{saved=JSON.parse(await readFile(sourceFile(id),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(saved){if(saved.originalHash!==originalHash)throw error('score_source_changed');return {...scoringInput(saved.svg),inputKind:'svg-snapshot'};}
  // Existing scores retain their original input; never change a public submission.
  if(await load(id,'openenv')||await load(id,'openenv-vision')||await load(id,'pelicanscore'))return scoringInput(record.answer);
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
   if(!r.ok){await r.body?.cancel();throw Object.assign(error(r.status===404?'score_not_found':r.status===409?'score_busy':'score_remote_failed'),{httpStatus:r.status});}
   const data=(await decode(r)).data;if(data?.requestKey!==key)throw error('score_response_invalid');return data;
  }catch(e){if(!online())throw error('network_disabled');throw transportError(e);}finally{clearInterval(timer);}
 }
 async function visualDirect({id,snapshotSvg,refresh=false}){
  if(!online())throw error('network_disabled');if(active)throw error('score_busy');active=true;
  try{const source=await input(id,snapshotSvg),prior=await load(id,'openenv-vision');
   if(prior&&prior.hash!==source.hash)throw error('score_source_changed');
   if(prior?.status==='completed')return prior;
   if(prior&&!prior.anonymous){
    try{await visualRequest(prior.requestKey);return {legacy:true};}catch(e){if(e.httpStatus!==404)throw e;}
    // The old UI created a local placeholder before login. No server task exists, so allow explicit anonymous submission with the same key.
    return await save(id,'openenv-vision',{...prior,anonymous:true,status:'not_submitted',message:'旧版仅创建了本机记录，尚未提交；可直接确认评分。'});
   }
   if(refresh&&!prior)throw error('score_not_found');
   const value=prior||{provider:'openenv-vision',anonymous:true,hash:source.hash,inputKind:source.inputKind,requestKey:randomUUID(),status:'submitting',createdAt:new Date().toISOString()};
   await save(id,'openenv-vision',value);
   try{
    let data;
    // An existing request is only queried. Even a timeout/restart must never create another model call.
    if(prior&&(refresh||prior.status!=='not_submitted'))data=await visualRequest(value.requestKey);else data=await visualRequest(value.requestKey,source.svg);
    let projection;if(data.status==='completed')projection=visualResult(data.result);else if(['pending','unknown','failed','rejected','expired'].includes(data.status))projection={status:data.status,message:text(data.message)};else throw error('score_response_invalid');
    return await save(id,'openenv-vision',{...value,...projection,checkedAt:new Date().toISOString()});
   }catch(e){await save(id,'openenv-vision',{...value,status:e.httpStatus===404||(!prior&&e.httpStatus===409)?'not_submitted':'unknown',message:e.httpStatus===404?'尚未取得服务器任务，可确认提交。':e.code||'score_remote_failed',checkedAt:new Date().toISOString()});throw e;}
  }finally{active=false;}
 }
 return {
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
  idle:()=>!active,
  async connection(){
   if(!online())throw error('network_disabled');if(active)throw error('score_busy');active=true;
   const abort=new AbortController(),timer=setInterval(()=>{if(!online())abort.abort();},200),started=Date.now();
   try{const r=await fetcher(PUBLIC+'/score',{method:'GET',redirect:'error',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(12000)])});await r.body?.cancel();return {reachable:r.ok,httpStatus:r.status,elapsedMs:Date.now()-started};}
   catch(e){if(!online())throw error('network_disabled');throw transportError(e);}finally{clearInterval(timer);active=false;}
  },
  async export({id,snapshotSvg}){if(active)throw error('score_busy');active=true;try{return {svg:(await input(id,snapshotSvg)).svg};}finally{active=false;}},
  async import(svg){const source=scoringInput(svg);if(source.inputKind!=='svg'||/<html\b/i.test(svg))throw error('score_standalone_required');return records.put({id:randomUUID(),createdAt:new Date().toISOString(),preset:'pelican-svg',status:'complete',answer:source.svg,origin:'svg-import',threadId:null,saved:false});},
  async list(id){await records.get(id);const values=await Promise.all(['openenv','openenv-vision','pelicanscore'].map(p=>load(id,p)));return {scores:values.filter(Boolean).map(s=>s.status==='unknown'&&s.httpStatus===429?{...s,status:'rate_limited'}:s),cooldowns:await cooldowns()};},
  async remove(id){if(active)throw error('score_busy');for(const [key,t]of visualTickets)if(t.id===id)visualTickets.delete(key);await Promise.all([...['openenv','openenv-vision','pelicanscore'].map(p=>rm(file(id,p),{force:true})),rm(sourceFile(id),{force:true})]);},
  async submit({id,provider,publicConfirmed,snapshotSvg,retryConfirmed}){
   file(id,provider);if(provider!=='pelicanscore')throw error('score_provider_retired');if(provider==='pelicanscore'&&publicConfirmed!==true)throw error('score_public_confirmation_required');
   if(active)throw error('score_busy');if(!online())throw error('network_disabled');active=true;
   try{const source=await input(id,snapshotSvg),prior=await load(id,provider);
    if(prior&&prior.hash!==source.hash)throw error('score_source_changed');
    if(prior&&retryConfirmed!==true)return prior; // Never automatically resend an unknown submission.
    if(prior&&!['unknown','submitting','failed','rate_limited'].includes(prior.status))throw error('score_retry_not_allowed');
    if((prior?.attempts?.length||0)>=20)throw error('score_retry_limit');
    await guard('submit');
    let value={provider,hash:source.hash,inputKind:source.inputKind,createdAt:new Date().toISOString(),status:'submitting'};
    if(prior){const {attempts=[],...previous}=prior;value.attempts=[...attempts,previous];}
    await save(id,provider,value);
    try{
     {const response=await request(PUBLIC+'/api/v1/submissions',{svg:source.svg});value={...value,...publicResult(response.submission)};}
     value.checkedAt=new Date().toISOString();return await save(id,provider,value);
    }catch(e){await save(id,provider,{...value,status:e.code==='score_rate_limited'?'rate_limited':'unknown',...(e.retryAt?{retryAt:e.retryAt,retrySource:e.retrySource}:{}),message:e.code||'score_remote_failed',...(e.httpStatus?{httpStatus:e.httpStatus}:{}),checkedAt:new Date().toISOString()});throw e;}
   }finally{active=false;}
  },
  async refresh({id,provider}){
   file(id,provider);await records.get(id);if(active)throw error('score_busy');const prior=await load(id,provider);if(!prior)throw error('score_not_found');
   if(provider==='openenv')return {...prior,retired:true};
   if(!prior.remoteId||!uuid.test(prior.remoteId))throw error('score_unknown_submission');
   active=true;try{return await save(id,provider,{...prior,...publicResult((await request(PUBLIC+'/api/v1/submissions/'+prior.remoteId)).submission),checkedAt:new Date().toISOString()});}finally{active=false;}
  }
 };
}

import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';
const PUBLIC='https://pelicanscore.com',SELF='https://biuuka.com/partner-score/score';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const error=code=>Object.assign(Error(code),{code});
export function scoringInput(answer){
 if(typeof answer!=='string'||Buffer.byteLength(answer)>2*1024*1024)throw error('score_input_invalid');
 const starts=[...answer.matchAll(/<svg\b/gi)],ends=[...answer.matchAll(/<\/svg\s*>/gi)];
 if(starts.length!==1||ends.length!==1||ends[0].index<starts[0].index)throw error('score_svg_required');
 const svg=answer.slice(starts[0].index,ends[0].index+ends[0][0].length);
 if(Buffer.byteLength(svg)>1048576)throw error('score_too_large');
 // Never silently treat CSS/canvas HTML as a comparable standalone SVG.
 const outside=answer.slice(0,starts[0].index)+answer.slice(ends[0].index+ends[0][0].length);
 if(/<(?:style|script|canvas)\b/i.test(outside))throw error('score_standalone_required');
 if(/<(?:script|foreignObject|image)\b|<!DOCTYPE|<!ENTITY|\bon\w+\s*=|(?:href\s*=\s*["']\s*(?!#)[^"']+)|@import|url\(\s*["']?(?!#)/i.test(svg))throw error('score_unsafe_svg');
 return {svg,hash:createHash('sha256').update(svg).digest('hex'),inputKind:/<html\b|<!doctype html/i.test(answer)?'svg-fragment':'svg'};
}
const number=(x,max=100)=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=max?x:null;
const text=x=>typeof x==='string'?x.slice(0,2000):'';
function publicResult(s){
 if(!s||!uuid.test(s.publicId))throw error('score_response_invalid');
 const result={remoteId:s.publicId,resultUrl:PUBLIC+'/result/'+s.publicId,status:['completed','failed'].includes(s.status)?s.status:'pending'};
 if(result.status==='failed')return {...result,message:text(s.errorMessage)||'第三方评分失败'};
 if(result.status!=='completed')return result;
 if(s.isMock===true||s.renderNeedsReview===true)return {...result,status:'unverified',message:'第三方返回模拟评分或待复核结果，未作为正式分数。'};
 const score=number(s.totalScore);if(score===null)throw error('score_response_invalid');
 const details=[];
 for(const [key,label] of [['pelican','鹈鹕'],['bicycle','自行车'],['ridingRelationship','骑乘关系'],['mechanics','机械合理性'],['composition','构图']]){const d=s.judgeResult?.[key];if(d)details.push({name:label,score:number(d.score),maxScore:number(d.maxScore),reason:text(d.reason)});}
 return {...result,score,maxScore:100,mode:'third-party',machineScore:number(s.machineScore,20),visionScore:number(s.visionScore,80),details,feedback:text(s.judgeResult?.summary),version:text(s.scoringVersion),judge:text(s.judgeModel),judgePromptVersion:text(s.judgePromptVersion)};
}
function structuralResult(s){
 if(s?.provider!=='openenv'||s.mode!=='structure-only'||s.judged!==false||number(s.score)===null)throw error('score_response_invalid');
 const checks=s.breakdown?.structure?.checks;
 return {status:'completed',mode:'structure-only',judged:false,score:s.score,maxScore:100,version:text(s.version),feedback:text(s.feedback),gatePassed:s.gatePassed===true,details:Array.isArray(checks)?checks.slice(0,30).map(c=>({name:text(c.name),passed:c.passed===true,reason:text(c.detail||c.reason)})):[]};
}
export function createScoring({state,records,online,fetcher=fetch,selfUrl=SELF}){
 const root=path.join(state,'scores');let active=false;
 const file=(id,p)=>{if(!uuid.test(id)||!['openenv','pelicanscore'].includes(p))throw error('score_input_invalid');return path.join(root,id+'-'+p+'.json');};
 const load=async(id,p)=>{try{return JSON.parse(await readFile(file(id,p),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
 const save=async(id,p,value)=>{await mkdir(root,{recursive:true,mode:0o700});const dest=file(id,p),temp=dest+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value),{mode:0o600,flag:'wx'});await rename(temp,dest);return value;};
 async function request(url,body){
  if(!online())throw error('network_disabled');
  const abort=new AbortController(),timer=setInterval(()=>{if(!online())abort.abort();},200);
  try{const r=await fetcher(url,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(30000)])});
   if(!r.ok)throw error(r.status===429?'score_rate_limited':'score_remote_failed');let bytes=0,parts=[];for await(const chunk of r.body){bytes+=chunk.length;if(bytes>262144)throw error('score_response_invalid');parts.push(chunk);}return JSON.parse(Buffer.concat(parts).toString('utf8'));
  }finally{clearInterval(timer);}
 }
 async function input(id){const record=await records.get(id);if(!['pelican','pelican-svg'].includes(record.preset)||record.status!=='complete')throw error('score_record_not_ready');return scoringInput(record.answer);}
 return {
  idle:()=>!active,
  async import(svg){const source=scoringInput(svg);if(source.inputKind!=='svg'||/<html\b/i.test(svg))throw error('score_standalone_required');return records.put({id:randomUUID(),createdAt:new Date().toISOString(),preset:'pelican-svg',status:'complete',answer:source.svg,origin:'svg-import',threadId:null,saved:false});},
  async list(id){await records.get(id);const values=await Promise.all(['openenv','pelicanscore'].map(p=>load(id,p)));return {scores:values.filter(Boolean)};},
  async remove(id){if(active)throw error('score_busy');await Promise.all(['openenv','pelicanscore'].map(p=>rm(file(id,p),{force:true})));},
  async submit({id,provider,publicConfirmed}){
   file(id,provider);if(provider==='pelicanscore'&&publicConfirmed!==true)throw error('score_public_confirmation_required');
   if(active)throw error('score_busy');if(!online())throw error('network_disabled');active=true;
   try{const source=await input(id),prior=await load(id,provider);
    if(prior?.hash===source.hash)return prior; // Never resend an unknown public submission.
    let value={provider,hash:source.hash,inputKind:source.inputKind,createdAt:new Date().toISOString(),status:'submitting'};
    if(prior)throw error('score_source_changed');
    await save(id,provider,value);
    try{
     if(provider==='openenv')value={...value,...structuralResult(await request(selfUrl,{svg:source.svg}))};
     else {const response=await request(PUBLIC+'/api/v1/submissions',{svg:source.svg});value={...value,...publicResult(response.submission)};}
     value.checkedAt=new Date().toISOString();return await save(id,provider,value);
    }catch(e){await save(id,provider,{...value,status:provider==='pelicanscore'?'unknown':'failed',message:e.code||'score_remote_failed'});throw e;}
   }finally{active=false;}
  },
  async refresh({id,provider}){
   file(id,provider);await records.get(id);if(active)throw error('score_busy');const prior=await load(id,provider);if(!prior)throw error('score_not_found');
   if(provider==='openenv'){
    if(prior.status!=='failed'&&prior.status!=='submitting')return prior;
    await rm(file(id,provider),{force:true});return this.submit({id,provider});
   }
   if(!prior.remoteId||!uuid.test(prior.remoteId))throw error('score_unknown_submission');
   active=true;try{return await save(id,provider,{...prior,...publicResult((await request(PUBLIC+'/api/v1/submissions/'+prior.remoteId)).submission),checkedAt:new Date().toISOString()});}finally{active=false;}
  }
 };
}

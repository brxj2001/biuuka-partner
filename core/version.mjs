import {VERSION} from '../release.mjs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
export function createVersion({appDir,state,request=fetch,now=Date.now,manual=false,trigger=()=>{},allowed=()=>true,background=()=>true,signal=()=>new AbortController().signal}){
 let cached,flight,startFlight,accepted,lastStart=-Infinity;
 async function versionStatus(explicit=false){
  if(explicit&&!allowed())throw Object.assign(Error(),{code:"network_disabled"});
  if(!explicit&&!background()){const current=await readFile(path.join(appDir,"build-info.json"),"utf8").then(JSON.parse).catch(()=>({}));return cached?.value||{version:VERSION,build:current.build||null,state:"unknown",manualUpdate:manual};}
  if(cached&&now()-cached.at<300000)return cached.value;
  if(flight)return flight;
  const requestSignal=signal();
  flight=(async()=>{const current=await readFile(path.join(appDir,'build-info.json'),'utf8').then(JSON.parse).catch(()=>({}));let latest;
   try{requestSignal.throwIfAborted();if(!allowed()||!explicit&&!background())throw Error("disabled");const r=await request('https://biuuka.com/downloads/biuuka/latest.json',{redirect:'error',signal:AbortSignal.any([requestSignal,AbortSignal.timeout(10000)])});if(!r.ok)throw Error();const text=await r.text();if(text.length>65536)throw Error();const d=JSON.parse(text);if(!/^[a-f0-9]{64}$/.test(d.build)||!/^\d+\.\d+\.\d+$/.test(d.version)||d.updateProtocol!==1)throw Error();latest=d;}catch{}
   const value={version:VERSION,build:current.build||null,latestVersion:latest?.version||null,state:!latest||!current.build?'unknown':latest.build===current.build?'latest':'available',manualUpdate:manual,checkedAt:new Date(now()).toISOString()};cached={at:now(),value};return value;
  })().finally(()=>flight=null);return flight;
 }
 async function status(explicit=false){
  const value=await versionStatus(explicit);if(!state)return value;
  let raw;try{raw=JSON.parse(await readFile(path.join(state,'update-status.json'),'utf8'));}catch{return value;}
  const update={};
  for(const [key,choices] of Object.entries({status:['running','updated','latest','deferred','cancelled'],phase:['checking','downloading','verifying','staging','download_and_verify','wait_idle','switch_files','start_new_version','cleanup','complete','rollback'],reason:['installer_required','update_failed','busy','network_disabled'],code:['EPERM','EACCES','EBUSY','ENOENT','ENOSPC','checksum_mismatch','build_mismatch','download_failed','download_too_large','invalid_archive','startup_failed','startup_timeout','installer_required','unknown']}))if(choices.includes(raw?.[key]))update[key]=raw[key];
  for(const key of ['startedAt','updatedAt','checkedAt'])if(typeof raw?.[key]==='string'&&Number.isFinite(Date.parse(raw[key])))update[key]=raw[key];
  for(const key of ['receivedBytes','totalBytes'])if(Number.isSafeInteger(raw?.[key])&&raw[key]>=0&&raw[key]<=8*1024**2)update[key]=raw[key];
  if(/^\d+\.\d+\.\d+$/.test(raw?.targetVersion||''))update.targetVersion=raw.targetVersion;
  if(update.status==='running'&&(!update.updatedAt||now()-Date.parse(update.updatedAt)>120000))update.status='interrupted';
  return {...value,update};
 }
 return {status,start(){
 if(!allowed())return Promise.reject(Object.assign(Error(),{code:'network_disabled'}));
 if(startFlight)return startFlight;
 if(accepted&&now()-lastStart<60000)return Promise.resolve({...accepted,alreadyScheduled:true,retryAfterSeconds:Math.ceil((60000-(now()-lastStart))/1000)});
 startFlight=(async()=>{if(!manual)throw Object.assign(Error('installer_required'),{code:'installer_required'});cached=undefined;if(flight)await flight;cached=undefined;const result=await status(true);if(!allowed())throw Object.assign(Error(),{code:'network_disabled'});if(result.state!=='available')return {accepted:false,...result};await trigger();lastStart=now();accepted={accepted:true,...result};return accepted;})().finally(()=>startFlight=null);return startFlight;}};
}

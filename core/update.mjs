import {readFile,writeFile,mkdir,rm,rename} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import path from 'node:path';
// Windows readers and antivirus may temporarily deny replacement. Never delete the
// destination to work around a sharing violation: retain the last complete record.
export async function retryFileOperation(operation,action,{wait=ms=>new Promise(r=>setTimeout(r,ms)),attempts=12}={}){
 for(let i=0;;i++)try{return await action();}catch(error){
  error.operation=operation;
  if(!['EPERM','EACCES','EBUSY'].includes(error.code)||i>=attempts-1)throw error;
  await wait(Math.min(50*(i+1),250));
 }
}
export async function writeUpdateProgress(state,value){
 const file=path.join(state,'update-status.json'),temp=file+'.'+randomUUID()+'.tmp';
 try{
  await retryFileOperation('write_progress',()=>writeFile(temp,JSON.stringify(value),{mode:0o600,flag:'w'}));
  await retryFileOperation('write_progress',()=>rename(temp,file));
 }finally{await rm(temp,{force:true,maxRetries:5,retryDelay:100}).catch(()=>{});}
}
export const UPDATE_ORIGIN='https://biuuka.com/downloads/biuuka/';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function unpack(bytes){
  const files=new Map();let offset=0,total=0;
  while(offset+4<=bytes.length&&bytes.readUInt32LE(offset)===0x04034b50){
    if(offset+30>bytes.length)throw Error('invalid_archive');
    const flags=bytes.readUInt16LE(offset+6),method=bytes.readUInt16LE(offset+8),size=bytes.readUInt32LE(offset+18),length=bytes.readUInt32LE(offset+22),n=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28);
    const name=bytes.subarray(offset+30,offset+30+n).toString('utf8'),start=offset+30+n+extra;
    if(flags!==0x800||method!==8||!/^[-a-zA-Z0-9_.]+$/.test(name)||name==='.'||name==='..'||files.has(name)||length>8*1024**2||start+size>bytes.length)throw Error('invalid_archive');
    const data=inflateRawSync(bytes.subarray(start,start+size),{maxOutputLength:8*1024**2});total+=data.length;
    if(data.length!==length||total>32*1024**2)throw Error('invalid_archive');
    files.set(name,data);offset=start+size;
  }
  if(!files.has('cli.mjs')||!files.has('build-info.json')||!files.has('server.mjs'))throw Error('invalid_archive');
  return files;
}
async function fetchBytes(url,max,signal,onProgress){
  const response=await fetch(url,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000),redirect:'error'});
  if(!response.ok)throw Error('download_failed');
  const length=Number(response.headers.get('content-length')),total=Number.isSafeInteger(length)&&length>0&&length<=max?length:null;
  let size=0,last=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>max)throw Error('download_too_large');chunks.push(chunk);if(onProgress&&Date.now()-last>=250){await onProgress({receivedBytes:size,totalBytes:total});last=Date.now();}}if(onProgress)await onProgress({receivedBytes:size,totalBytes:total});return Buffer.concat(chunks);
}
export function compatibleSources(before,after){
 // Download locations and mirror lists do not change the native payload.
 const normalize=value=>{if(!value||Array.isArray(value)||Object.keys(value).length===0)throw Error('invalid_sources');const result={};for(const key of Object.keys(value).sort()){const item=value[key];if(!item||typeof item.binary!=='string')throw Error('invalid_sources');result[key]={binary:item.binary};for(const kind of ['node','codex']){const dep=item[kind];if(!dep?.algorithm||!dep.digest)throw Error('invalid_sources');result[key][kind]={algorithm:dep.algorithm,encoding:dep.encoding||'hex',digest:dep.digest};}}return JSON.stringify(result);};
 try{return normalize(before)===normalize(after);}catch{return false;}
}
export async function stageUpdate(state,current,signal,report=async()=>{}){
  await report({phase:'checking'});
  const meta=JSON.parse((await fetchBytes(UPDATE_ORIGIN+'latest.json',65536,signal)).toString());
  const currentInfo=JSON.parse(await readFile(path.join(current,'build-info.json'),'utf8'));
  if(meta.updateProtocol!==1||!/^\w{64}$/.test(meta.build||'')||meta.build===currentInfo.build)return null;
  // Native runtime/service changes require the explicit installer, never UAC in the background.
  await report({phase:'downloading',targetVersion:meta.version,receivedBytes:0,totalBytes:null});
  const bytes=await fetchBytes(UPDATE_ORIGIN+'biuuka.zip',8*1024**2,signal,progress=>report({phase:'downloading',...progress}));
  await report({phase:'verifying'});
  if(digest(bytes)!==meta.files?.['biuuka.zip']?.sha256)throw Error('checksum_mismatch');
  const files=unpack(bytes),info=JSON.parse(files.get('build-info.json').toString());
  if(info.build!==meta.build||info.updateProtocol!==1)throw Error('build_mismatch');
  if(!compatibleSources(JSON.parse(await readFile(path.join(current,'sources.json'),'utf8')),JSON.parse(files.get('sources.json')?.toString()||'null')))throw Error('installer_required');
  signal?.throwIfAborted();
  await report({phase:'staging'});
  const next=path.join(state,'update-next');await retryFileOperation('prepare_files',()=>rm(next,{recursive:true,force:true,maxRetries:5,retryDelay:100}));await mkdir(next,{recursive:true,mode:0o700});
  for(const [name,data]of files)await retryFileOperation('prepare_files',()=>writeFile(path.join(next,name),data,{mode:0o600}));
  return {next,build:meta.build};
}
export async function selectApplication(base,state){
  const active=path.join(state,'app');
  try{await readFile(path.join(active,'build-info.json'));return active;}catch{return base;}
}

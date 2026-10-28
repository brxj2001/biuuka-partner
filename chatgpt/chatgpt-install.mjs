import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const execute=promisify(execFile);
const run=async(file,args)=> (await execute(file,args,{timeout:12000,maxBuffer:256*1024,windowsHide:true,encoding:'utf8'})).stdout;
const exists=async file=>{try{await access(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const version=value=>typeof value==='string'&&/^[0-9][0-9A-Za-z.+_-]{0,79}$/.test(value)?value:null;
// Only reads application metadata. Never launches ChatGPT or reads its account data.
export async function detectChatGPT({platform=process.platform,home=os.homedir(),execute=run,hasFile=exists,systemRoot=process.env.SystemRoot||'C:\\Windows'}={}){
 const versions=[];let found=false,failed=false;
 if(platform==='darwin'){
  const candidates=new Set(['/Applications/ChatGPT.app',path.join(home,'Applications/ChatGPT.app')]);
  try{const indexed=await execute('/usr/bin/mdfind',['kMDItemCFBundleIdentifier == "com.openai.chat"']);for(const file of indexed.trim().split('\n').slice(0,20))if(path.isAbsolute(file)&&file.endsWith('.app'))candidates.add(file);}catch{/* Standard locations still work when Spotlight is disabled. */}
  for(const app of candidates){try{const plist=path.join(app,'Contents/Info.plist');if(!await hasFile(plist))continue;
   const data=JSON.parse(await execute('/usr/bin/plutil',['-convert','json','-o','-',plist]));
   if(data.CFBundleIdentifier!=='com.openai.chat')continue;found=true;
   versions.push({version:version(data.CFBundleShortVersionString),build:version(data.CFBundleVersion),source:'app_bundle'});
  }catch{failed=true;}}
 }else if(platform==='win32'){
  try{const output=await execute(path.win32.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./chatgpt-install.ps1',import.meta.url))]);
   const data=JSON.parse(output.replace(/^\uFEFF/,'').trim());if(!Array.isArray(data))throw Error('invalid_metadata');
   for(const item of data){if(!/^OpenAI\.ChatGPT(?:-Desktop)?$/i.test(item.name||''))continue;found=true;versions.push({version:version(item.version),build:null,source:'windows_package'});}
  }catch{failed=true;}
 }else return {status:'unsupported',installed:null,versions:[],platform,checkedAt:new Date().toISOString(),scope:'current_user'};
 return {status:found?'detected':failed?'unknown':'not_found',installed:found?true:failed?null:false,versions:versions.filter((v,i,a)=>a.findIndex(x=>JSON.stringify(x)===JSON.stringify(v))===i),platform,checkedAt:new Date().toISOString(),scope:'current_user'};
}
export function createChatGPTDetector({detect=detectChatGPT,now=Date.now}={}){
 let flight,last=-Infinity;
 return ()=>{if(flight)return flight;if(now()-last<5000)return Promise.reject(Object.assign(Error('rate_limited'),{code:'rate_limited'}));last=now();flight=Promise.resolve().then(detect).finally(()=>{flight=null;});return flight;};
}

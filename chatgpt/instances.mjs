import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile);
const run=async(file,args)=>(await exec(file,args,{timeout:10000,maxBuffer:4*1024*1024,windowsHide:true,encoding:'utf8'})).stdout;
// Process names and ancestry only; never read arguments, environment or account data.
export function macRows(text,uid){
 return text.split('\n').filter(s=>s.trim()).map(line=>{
  const m=line.match(/^\s*(-?\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);if(!m)throw Error('invalid_snapshot');
  const [,owner,pid,parent,exe]=m;let kind=null;
  if(Number(owner)===uid){
   if(/\/ChatGPT\.app\/Contents\/MacOS\/ChatGPT$/.test(exe))kind='chatgpt';
   else if(/\/Codex\.app\/Contents\/MacOS\/Codex$/.test(exe))kind='codex-desktop';
   else if(/(?:^|\/)codex(?:-[a-z0-9_-]+)?$/.test(exe))kind='codex-cli';
  }
  return {pid:Number(pid),parent:Number(parent),kind};
 });
}
export function summarize(rows,ownPid){
 if(!Array.isArray(rows)||rows.length>50000)throw Error('invalid_snapshot');
 const map=new Map();for(const r of rows){if(!Number.isSafeInteger(r.pid)||r.pid<=0||!Number.isSafeInteger(r.parent)||r.parent<0||map.has(r.pid))throw Error('invalid_snapshot');map.set(r.pid,r);}
 const kinds=['chatgpt','codex-desktop','codex-cli'];
 const instances=rows.filter(r=>kinds.includes(r.kind)).filter(r=>{
  let parent=r.parent;const seen=new Set([r.pid]);
  while(parent&&map.has(parent)){if(seen.has(parent))throw Error('invalid_snapshot');seen.add(parent);const p=map.get(parent);
   if(parent===ownPid||kinds.includes(p.kind))return false;parent=p.parent;
  }return true;
 }).map(r=>({pid:r.pid,kind:r.kind})).sort((a,b)=>a.pid-b.pid);
 return {instances,counts:{chatgpt:instances.filter(r=>r.kind==='chatgpt').length,codexDesktop:instances.filter(r=>r.kind==='codex-desktop').length,codexCli:instances.filter(r=>r.kind==='codex-cli').length}};
}
export async function detectInstances({platform=process.platform,uid=process.getuid?.(),ownPid=process.pid,execute=run,systemRoot=process.env.SystemRoot||'C:\\Windows'}={}){
 const base={platform,scope:'current_user',checkedAt:new Date().toISOString()};
 if(!['darwin','win32'].includes(platform))return {...base,status:'unsupported',counts:null,instances:[]};
 try{
  let rows,partial=false;
  if(platform==='darwin')rows=macRows(await execute('/bin/ps',['-axo','uid=,pid=,ppid=,comm=']),uid);
  else {const data=JSON.parse((await execute(path.win32.join(systemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./instances.ps1',import.meta.url))])).replace(/^\uFEFF/,''));rows=data.rows;partial=data.partial===true;}
  return {...base,status:partial?'partial':'available',...summarize(rows,ownPid)};
 }catch{return {...base,status:'unknown',counts:null,instances:[]};}
}
export function createInstanceDetector({detect=detectInstances,now=Date.now}={}){
 let flight,cached,last=-Infinity;
 return ()=>{if(flight)return flight;if(cached&&now()-last<5000)return Promise.resolve(cached);flight=Promise.resolve().then(detect).then(value=>{cached=value;last=now();return value;}).finally(()=>{flight=null;});return flight;};
}

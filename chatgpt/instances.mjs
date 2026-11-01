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
   else if(/\/Codex\.app\/Contents\/MacOS\/Codex$/.test(exe))kind='chatgpt';
   else if(/(?:^|\/)codex(?:-[a-z0-9_-]+)?$/.test(exe))kind='codex-cli';
  }
  return {pid:Number(pid),parent:Number(parent),kind,exe:Number(owner)===uid?exe:null};
 });
}
export function summarize(rows,ownPid,{includePaths=false,includeOwned=false}={}){
 if(!Array.isArray(rows)||rows.length>50000)throw Error('invalid_snapshot');
 const map=new Map();for(const r of rows){if(!Number.isSafeInteger(r.pid)||r.pid<=0||!Number.isSafeInteger(r.parent)||r.parent<0||map.has(r.pid))throw Error('invalid_snapshot');map.set(r.pid,r);}
 const kinds=['chatgpt','codex-cli'];
 const partnerInstances=[];const projection=r=>({pid:r.pid,kind:r.kind,name:typeof r.name==='string'?r.name.slice(0,120):r.kind==='chatgpt'?'ChatGPT':'Codex CLI',...(includePaths&&typeof r.exe==='string'?{path:r.exe}:{})});
 const instances=rows.filter(r=>kinds.includes(r.kind)).filter(r=>{
  let parent=r.parent;const seen=new Set([r.pid]);
  while(parent&&map.has(parent)){if(seen.has(parent))throw Error('invalid_snapshot');seen.add(parent);const p=map.get(parent);
   if(parent===ownPid){if(includeOwned)partnerInstances.push(projection(r));return false;}if(kinds.includes(p.kind))return false;parent=p.parent;
  }return true;
 }).map(projection).sort((a,b)=>a.pid-b.pid);
 return {instances,...(includeOwned?{partnerInstances}:{}),counts:{chatgpt:instances.filter(r=>r.kind==='chatgpt').length,codexCli:instances.filter(r=>r.kind==='codex-cli').length}};
}
export async function detectInstances({includePaths=false,includeOwned=false,platform=process.platform,uid=process.getuid?.(),ownPid=process.pid,execute=run,systemRoot=process.env.SystemRoot||'C:\\Windows'}={}){
 const base={platform,scope:'current_user',checkedAt:new Date().toISOString()};
 if(!['darwin','win32'].includes(platform))return {...base,status:'unsupported',counts:null,instances:[]};
 try{
  let rows,partial=false;
  if(platform==='darwin'){
   rows=macRows(await execute('/bin/ps',['-axo','uid=,pid=,ppid=,comm=']),uid);
   const apps=new Map();
   for(const r of rows){
    const match=r.exe?.match(/^(.*\.app)\/Contents\/MacOS\/([^/]+)$/);
    if(!match)continue;
    // Read the running bundle's own identifier and executable, not its display name.
    const [,bundle,binary]=match;
    if(!apps.has(bundle)){
     try{apps.set(bundle,JSON.parse(await execute('/usr/bin/plutil',['-convert','json','-o','-',bundle+'/Contents/Info.plist'])));}catch{apps.set(bundle,null);partial=true;}
    }
    const info=apps.get(bundle);
    r.kind=null;
    if(info&&['com.openai.chat','com.openai.codex'].includes(info.CFBundleIdentifier)&&info.CFBundleExecutable===binary){r.kind='chatgpt';r.name=path.basename(bundle,'.app');}
   }
  }
  else {const data=JSON.parse((await execute(path.win32.join(systemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./instances.ps1',import.meta.url))])).replace(/^\uFEFF/,''));rows=data.rows;partial=data.partial===true;}
  return {...base,status:partial?'partial':'available',...summarize(rows,ownPid,{includePaths,includeOwned})};
 }catch{return {...base,status:'unknown',counts:null,instances:[]};}
}
export function createInstanceDetector({detect=detectInstances,now=Date.now}={}){
 let flight,cached,last=-Infinity;
 return ()=>{if(flight)return flight;if(cached&&now()-last<5000)return Promise.resolve(cached);flight=Promise.resolve().then(detect).then(value=>{cached=value;last=now();return value;}).finally(()=>{flight=null;});return flight;};
}

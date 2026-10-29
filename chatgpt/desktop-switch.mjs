import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import path from 'node:path';
const exec=promisify(execFile);
const codes=['desktop_ambiguous','desktop_identity_unconfirmed','desktop_stop_failed','desktop_start_failed','desktop_window_unavailable'];
const failure=(action,e)=>{const text=String(e?.code||e?.stderr||e?.message||'');const code=codes.find(c=>text.includes(c))||'desktop_'+action+'_failed';return Object.assign(Error(code),{code});};
// One private stdin/stdout channel per switch; no sockets, account data or commands from websites.
export function createDesktopSwitch({codexHome,platform=process.platform,home=os.homedir(),execute=exec,spawnProcess=spawn,requestTimeout=45000}={}){
 let child,pending,buffer='',sequence=0,exited,exitResolve,broken=false,samples=[];
 function stopPending(error){if(pending){clearTimeout(pending.timer);const p=pending;pending=null;p.reject(failure(p.action,error));}}
 function ensureSession(){
  if(child){if(broken)throw failure('inspect');return;}
  broken=false;samples=[];
  const command=path.win32.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  child=spawnProcess(command,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./desktop-switch.ps1',import.meta.url)),'-Action','session'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  exited=new Promise(r=>exitResolve=r);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',chunk=>{
   buffer+=chunk;if(buffer.length>128*1024){broken=true;stopPending();child.kill();return;}
   let end;
   while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);if(!line)continue;
    try{const response=JSON.parse(line);if(!pending||response.id!==pending.id)throw Error();const p=pending;pending=null;clearTimeout(p.timer);if(response.error)p.reject(failure(p.action,{code:response.error}));else p.resolve(response.result);}
    catch{broken=true;stopPending();child.kill();return;}
   }
  });
  // Drain diagnostics but never expose native paths, command lines or signatures.
  child.stderr.resume();child.stdin.on('error',e=>{broken=true;stopPending(e);});
  child.once('error',e=>{broken=true;stopPending(e);exitResolve();});
  child.once('exit',()=>{broken=true;stopPending();exitResolve();});
 }
 async function call(action,descriptor){
  const started=performance.now();try{
  if(platform==='win32'){
   ensureSession();if(pending)throw failure(action);
   return await new Promise((resolve,reject)=>{const id=++sequence;pending={id,action,resolve,reject,timer:setTimeout(()=>{broken=true;stopPending();child.kill();},requestTimeout)};child.stdin.write(JSON.stringify({id,action,descriptor})+'\n');});
  }
  if(platform!=='darwin')return null;
  try{const args=['-l','JavaScript',fileURLToPath(new URL('./desktop-switch-macos.js',import.meta.url)),action];if(descriptor)args.push(JSON.stringify(descriptor));return JSON.parse((await execute('/usr/bin/osascript',args,{timeout:30000,maxBuffer:128*1024,windowsHide:true,encoding:'utf8'})).stdout.trim());}catch(e){throw failure(action,e);}
  }finally{samples.push({action,ms:Math.round(performance.now()-started)});}
 }
 async function close(){
  if(!child)return;const current=child;
  const wait=async()=>{let timer;try{await Promise.race([exited,new Promise((_,reject)=>timer=setTimeout(()=>reject(Object.assign(Error('shutdown_unconfirmed'),{code:'shutdown_unconfirmed'})),2000))]);}finally{clearTimeout(timer);}};
  if(pending){broken=true;stopPending();current.kill();}else current.stdin.end();
  try{await wait();}catch{broken=true;current.kill();await wait();}
  child=null;buffer='';broken=false;
 }

 return {
  async inspect(){const d=await call('inspect');const paths=platform==='win32'?path.win32:path; if(d&&paths.resolve(codexHome)!==paths.resolve(home,'.codex'))throw Object.assign(Error('desktop_custom_home'),{code:'desktop_custom_home'});return d;},
  stop:d=>d?call('stop',d):Promise.resolve(),start:d=>d?call('start',d):Promise.resolve(),close,timings:()=>samples.map(v=>({...v}))
 };
}

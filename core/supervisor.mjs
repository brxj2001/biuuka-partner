import {fork} from 'node:child_process';
import {readFile,writeFile,mkdir,rename,rm,access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {stateDir,migrateState} from './state.mjs';
import {stageUpdate,selectApplication} from './update.mjs';
const exited=p=>p.exitCode!==null||p.signalCode!==null;
const base=path.dirname(fileURLToPath(import.meta.url));
await migrateState();
const active=path.join(stateDir,'app'),old=path.join(stateDir,'update-old');
// Recover a process interruption between the two atomic directory renames.
try{await access(old);try{await access(active);}catch{await rename(old,active);}}catch{}
let child,stopping=false,updating=false,timer,first,updateAbort,cancelEpoch=0;
let current=await selectApplication(base,stateDir);
function launch(folder){const p=fork(path.join(folder,'cli.mjs'),['serve'],{env:{...process.env,BIUUKA_STATE:stateDir,BIUUKA_MANUAL_UPDATE:'1'},stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});child=p;p.on('message',m=>{if(m?.type==='request-update')void check(true);if(m?.type==='cancel-background'){cancelEpoch++;updateAbort?.abort();}});p.once('exit',()=>{if(!updating&&!stopping){clearInterval(timer);process.exitCode=1;}});return p;}
async function healthy(p){for(let i=0;i<40;i++){if(exited(p))throw Error('startup_failed');try{const r=JSON.parse(await readFile(path.join(stateDir,'runtime.json'),'utf8'));if(r.pid===p.pid){const h=await fetch(`http://127.0.0.1:${r.port}/health`,{signal:AbortSignal.timeout(1500)});if(h.ok)return;}}catch{}await new Promise(r=>setTimeout(r,500));}throw Error('startup_timeout');}
async function terminate(p){if(exited(p))return;await new Promise(resolve=>{p.once('exit',resolve);p.kill('SIGTERM');const t=setTimeout(()=>p.kill('SIGKILL'),5000);t.unref();});}
async function check(force=false){
 if(updating||stopping||exited(child))return;updating=true;const epoch=cancelEpoch;let switched=false,hadOld=false,phase="checking";
 try{
  let settings={};try{settings=JSON.parse(await readFile(path.join(stateDir,'settings.json'),'utf8'));}catch{}
  if(epoch!==cancelEpoch||settings.networkEnabled===false||!force&&(settings.autoUpdate===false||settings.engineEnabled===false))return;
  updateAbort=new AbortController();
  phase="download_and_verify";const candidate=await stageUpdate(stateDir,current,updateAbort.signal);if(!candidate)return;
  if(updateAbort.signal.aborted){await rm(candidate.next,{recursive:true,force:true});return;}
  // The child accepts only while idle; after acceptance it rejects new work and exits.
  phase="wait_idle";child.send({type:'prepare-update'});
  for(let i=0;i<120&&!exited(child)&&!updateAbort.signal.aborted;i++){await new Promise(r=>setTimeout(r,500));if(i%10===0&&child.connected&&!exited(child))child.send({type:'prepare-update'});}
  if(updateAbort.signal.aborted||!exited(child)){await rm(candidate.next,{recursive:true,force:true});if(exited(child)&&!stopping)launch(current);return;}
  phase="switch_files";await rm(old,{recursive:true,force:true});
  try{await access(active);await rename(active,old);hadOld=true;}catch(e){if(e.code!=='ENOENT')throw e;}
  await rename(candidate.next,active);switched=true;
  phase="start_new_version";await healthy(launch(active));current=active;
  phase="cleanup";await rm(old,{recursive:true,force:true});
  await writeFile(path.join(stateDir,'update-status.json'),JSON.stringify({status:'updated',build:candidate.build,checkedAt:new Date().toISOString()}),{mode:0o600});
 }catch(e){
  if(switched){await terminate(child);await rm(active,{recursive:true,force:true});if(hadOld)await rename(old,active);current=await selectApplication(base,stateDir);launch(current);}
  else if(exited(child)&&!stopping)launch(current);
  await writeFile(path.join(stateDir,'update-status.json'),JSON.stringify({status:'deferred',reason:e.message==='installer_required'?'installer_required':'update_failed',phase,code:['EPERM','EACCES','EBUSY','ENOENT','ENOSPC'].includes(e.code)?e.code:['checksum_mismatch','build_mismatch','download_failed','download_too_large','invalid_archive','startup_failed','startup_timeout','installer_required'].includes(e.message)?e.message:'unknown',checkedAt:new Date().toISOString()}),{mode:0o600}).catch(()=>{});
 }finally{updating=false;updateAbort=null;}
}
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopping=true;clearInterval(timer);clearTimeout(first);void terminate(child).then(()=>process.exit(0));});
try{await healthy(launch(current));await rm(old,{recursive:true,force:true});}catch{
 updating=true;await terminate(child);
 try{await access(old);await rm(active,{recursive:true,force:true});await rename(old,active);current=active;}catch{await rm(active,{recursive:true,force:true});current=base;}
 await healthy(launch(current));process.exitCode=undefined;updating=false;
}
timer=setInterval(()=>void check(),60*60*1000);timer.unref();
first=setTimeout(()=>void check(),60000);first.unref();


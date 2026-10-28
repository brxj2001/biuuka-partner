import {spawnSync} from 'node:child_process';
import {readFile,writeFile,rename,rm} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
async function legacyTray(state){
 if(process.platform!=='darwin')return null;
 try{
  const pid=Number(await readFile(path.join(state,'tray.lock'),'utf8'));
  if(!Number.isSafeInteger(pid)||pid<=0)return null;
  const config=JSON.parse(await readFile(path.join(state,'config.json'),'utf8'));
  const result=spawnSync('/bin/ps',['-p',String(pid),'-o','uid=,command='],{encoding:'utf8',timeout:1500});
  const match=result.stdout?.trim().match(/^(\d+)\s+(.+)$/);
  if(!match||Number(match[1])!==process.getuid()||!config.node||!config.baseDir)return null;
  if(![config.baseDir,path.join(state,'app')].some(folder=>['launcher.mjs','cli.mjs'].some(name=>match[2]===`${config.node} ${path.join(folder,name)} tray-run`)))return null;
  return {running:true,legacy:true,pid};
 }catch{return null;}
}
export async function readTrayState(state){
 try{const status=JSON.parse(await readFile(path.join(state,'tray-instance.json'),'utf8'));const pid=Number(await readFile(path.join(state,'tray.lock'),'utf8'));
 if(status.pid!==pid||!Number.isSafeInteger(pid)||pid<=0||!/^[a-f0-9]{32}$/.test(status.instance)||Date.now()-status.updatedAt>20000||status.updatedAt>Date.now()+1000)return {running:false};
 process.kill(pid,0);return {running:true,instance:status.instance};
 }catch{return await legacyTray(state)||{running:false};}
}
export async function requestTrayClose(state){
 const current=await readTrayState(state);if(!current.running)return {running:false};
 if(current.legacy){
  const verified=await legacyTray(state);if(!verified||verified.pid!==current.pid)throw Error('Tray changed; retry.');
  process.kill(current.pid,'SIGTERM');
  for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,250));if(!(await legacyTray(state)))return {running:false};}
  throw Error('Legacy tray did not stop.');
 }
 const file=path.join(state,'tray-close.json'),tmp=file+'.'+randomBytes(8).toString('hex');await writeFile(tmp,JSON.stringify({instance:current.instance}),{mode:0o600});await rename(tmp,file);
 // The owning tray exits its own native child. Never kill a PID obtained from a file.
 for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,250));const next=await readTrayState(state);if(!next.running||next.instance!==current.instance)return {running:next.running};}
 throw Error('Tray did not stop; reopen the updated tray and retry.');
}
export async function trayCloseRequested(state,instance){try{return JSON.parse(await readFile(path.join(state,'tray-close.json'),'utf8')).instance===instance;}catch{return false;}}

// Only replace a tray that is still running when the new service becomes healthy.
export async function refreshRunningTray(state,start,{read=readTrayState,close=requestTrayClose}={}){
 if(!(await read(state)).running)return false;
 await close(state);
 await start();
 return true;
}

// Close the interactive process BEFORE its application directory is replaced.
// A persisted handoff also lets the previous app restore the tray after rollback.
export async function prepareTrayForUpdate(state,{read=readTrayState,close=requestTrayClose}={}){
 if(!(await read(state)).running)return false;
 const file=path.join(state,'tray-update-resume.json'),tmp=file+'.'+randomBytes(8).toString('hex');
 await writeFile(tmp,JSON.stringify({resume:true}),{mode:0o600});await rename(tmp,file);
 try{if((await close(state))?.running)throw Error('Tray changed during update');return true;}
 catch(error){await rm(file,{force:true});throw error;}
}
export async function restoreTrayAfterUpdate(state,start,{read=readTrayState}={}){
 const file=path.join(state,'tray-update-resume.json');
 let marker;try{marker=JSON.parse(await readFile(file,'utf8'));}catch{return false;}
 if(marker.resume!==true)return false;
 if(!(await read(state)).running)await start();
 await rm(file,{force:true});return true;
}

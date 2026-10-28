import {VERSION} from '../release.mjs';
import {merchant,DEFAULT_MERCHANT} from '../core/merchant.mjs';
import {randomBytes} from 'node:crypto';
import {trayCloseRequested} from './tray-control.mjs';
import {spawn,spawnSync} from 'node:child_process';
import {readFile,mkdir,open,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {appDir,stateDir,config,localRequest,writePrivate,openUrl} from '../core/runtime.mjs';
import {xml} from '../scripts/install/mac-service.mjs';
export const trayLabel='com.biuuka.tray';
export function trayStatus(health,settings){return {online:health?.service==='biuuka',enabled:health?.service==='biuuka'&&health.engine==='enabled',autoUpdate:settings.autoUpdate!==false,notifications:settings.notifications===true};}
export function trayPlist(node,launcher,state){return `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>Label</key><string>${trayLabel}</string><key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(launcher)}</string><string>tray-run</string></array><key>EnvironmentVariables</key><dict><key>BIUUKA_STATE</key><string>${xml(state)}</string></dict><key>RunAtLoad</key><true/><key>LimitLoadToSessionType</key><string>Aqua</string><key>ProcessType</key><string>Interactive</string></dict></plist>`;}
export async function installMacTray(remove=false){
 const target=`gui/${process.getuid()}/${trayLabel}`,file=path.join(os.homedir(),'Library/LaunchAgents',trayLabel+'.plist');
 spawnSync('/bin/launchctl',['bootout',target],{stdio:'ignore'});
 for(let i=0;spawnSync('/bin/launchctl',['print',target],{stdio:'ignore'}).status===0;i++){if(i>=100)throw Error('Tray is still stopping; retry the installation shortly.');await new Promise(resolve=>setTimeout(resolve,100));}
 if(remove){await rm(file,{force:true});return;}
 const c=await config();await mkdir(path.dirname(file),{recursive:true});await writeFile(file,trayPlist(c.node,path.join(c.baseDir||appDir,'launcher.mjs'),stateDir),{mode:0o600});
 for(const args of [['enable',target],['bootstrap',`gui/${process.getuid()}`,file]]){const result=spawnSync('/bin/launchctl',args,{stdio:'ignore'});if(result.status!==0)throw Error('Tray registration failed; run biuuka tray to retry.');}
}
export async function startTray(){const c=await config();const child=spawn(c.node,[path.join(c.baseDir||appDir,'launcher.mjs'),'tray-run'],{detached:true,stdio:'ignore',windowsHide:true,cwd:stateDir});child.unref();}
export function trayMerchant(value){return merchant(value)||DEFAULT_MERCHANT;}
export async function trayAction(action){
 if(action==='shop'){const c=await config();openUrl(trayMerchant(c.merchant).url);return;}
 const choices={open:['open'],start:['start'],pause:['stop'],'auto-on':['auto-update','on'],'auto-off':['auto-update','off'],'notify-on':['notifications','on'],'notify-off':['notifications','off'],exit:['service-exit']};
 if(action==='updates'){
  await localRequest('/update/status',{});const r=JSON.parse(await readFile(path.join(stateDir,'runtime.json'),'utf8'));openUrl(`http://127.0.0.1:${r.port}/console#settings`);return;
 }
 if(!choices[action])throw Error('Unknown tray action');
 const c=await config();await new Promise((resolve,reject)=>{const child=spawn(c.node,[path.join(c.baseDir||appDir,'launcher.mjs'),...choices[action]],{stdio:'ignore',windowsHide:true});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('Tray action failed; open the console or run biuuka doctor.')));});
}
export async function runTray(){
 if(!['darwin','win32'].includes(process.platform))throw Error('Native tray supports Windows and macOS.');
 await mkdir(stateDir,{recursive:true,mode:0o700});const lock=path.join(stateDir,'tray.lock');
 try {const file=await open(lock,'wx',0o600);await file.writeFile(String(process.pid));await file.close();}catch(e){
  if(e.code!=='EEXIST')throw e;const pid=Number(await readFile(lock,'utf8'));if(!Number.isInteger(pid)||pid<=0)return;
  try{process.kill(pid,0);return;}catch(err){if(err.code!=='ESRCH')return;}
  await rm(lock,{force:true});return runTray();
 }
 const build=await readFile(path.join(appDir,'build-info.json'),'utf8').then(JSON.parse).then(v=>v.build).catch(()=>null);
 let child,timer,watcher,stopped=false;const instance=randomBytes(16).toString('hex');
 const cleanup=async()=>{if(stopped)return;stopped=true;clearTimeout(timer);clearInterval(watcher);if(child&&child.exitCode===null&&child.signalCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill();});if(await readFile(lock,'utf8').catch(()=>'')===String(process.pid))await rm(lock,{force:true});};
 try{
  const c=await config(),launcher=path.join(c.baseDir||appDir,'launcher.mjs'),statusFile=path.join(stateDir,'tray-status.json');
  const refresh=async()=>{let health=null,settings={};try{const r=JSON.parse(await readFile(path.join(stateDir,'runtime.json'),'utf8'));if(!Number.isInteger(r.port)||r.port<1024||r.port>65535)throw Error();const res=await fetch(`http://127.0.0.1:${r.port}/health`,{signal:AbortSignal.timeout(1500)});health=await res.json();}catch{}try{settings=JSON.parse(await readFile(path.join(stateDir,'settings.json'),'utf8'));}catch{}if(!stopped){await writePrivate(statusFile,{...trayStatus(health,settings),merchantName:trayMerchant(c.merchant).name});timer=setTimeout(()=>void refresh().catch(()=>{}),1000);}};
  await refresh();
  child=process.platform==='darwin'?spawn('/usr/bin/osascript',['-l','JavaScript',path.join(appDir,'tray-macos.js'),c.node,launcher,statusFile,path.join(appDir,'brand.png'),VERSION],{stdio:'ignore',cwd:stateDir}):spawn('powershell.exe',['-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File',path.join(appDir,'tray-windows.ps1'),'-Node',c.node,'-Launcher',launcher,'-StatusFile',statusFile,'-AppVersion',VERSION],{stdio:'ignore',windowsHide:true,cwd:stateDir});
  const pulse=async()=>{if(stopped)return;if(await trayCloseRequested(stateDir,instance)){await cleanup();return;}if(!stopped)await writePrivate(path.join(stateDir,'tray-instance.json'),{pid:process.pid,instance,build,updatedAt:Date.now()});};
  await pulse();watcher=setInterval(()=>void pulse().catch(()=>{}),1000);
  process.once('SIGTERM',()=>void cleanup());process.once('SIGINT',()=>void cleanup());
  await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>code===0||stopped?resolve():reject(Error('Native tray exited unexpectedly. Run biuuka tray to retry.')));});
 }finally{await cleanup();}
}

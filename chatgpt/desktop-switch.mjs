import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import path from 'node:path';
const exec=promisify(execFile);
export function createDesktopSwitch({codexHome,platform=process.platform,home=os.homedir(),execute=exec}={}){
 async function call(action,descriptor){
  try{
   let command,args;
   if(platform==='win32'){
    command=path.win32.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    args=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./desktop-switch.ps1',import.meta.url)),'-Action',action];
    if(descriptor)args.push('-Descriptor',Buffer.from(JSON.stringify(descriptor)).toString('base64'));
   }else if(platform==='darwin'){
    command='/usr/bin/osascript';args=['-l','JavaScript',fileURLToPath(new URL('./desktop-switch-macos.js',import.meta.url)),action];if(descriptor)args.push(JSON.stringify(descriptor));
   }else return null;
   const result=await execute(command,args,{timeout:platform==='win32'&&action==='start'?45000:30000,maxBuffer:128*1024,windowsHide:true,encoding:'utf8'});
   return JSON.parse(result.stdout.trim());
  }catch(e){const message=String(e.stderr||e.message);const code=['desktop_ambiguous','desktop_identity_unconfirmed','desktop_stop_failed','desktop_start_failed'].find(c=>message.includes(c))||'desktop_'+(action==='inspect'?'inspect':action)+'_failed';throw Object.assign(Error(code),{code});}
 }
 return {
  async inspect(){const d=await call('inspect');if(d&&path.resolve(codexHome)!==path.resolve(home,'.codex'))throw Object.assign(Error('desktop_custom_home'),{code:'desktop_custom_home'});return d;},
  stop:d=>d?call('stop',d):Promise.resolve(),start:d=>d?call('start',d):Promise.resolve()
 };
}

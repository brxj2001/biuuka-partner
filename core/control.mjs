import {readTrayState,requestTrayClose} from '../tray/tray-control.mjs';
import {merchant,DEFAULT_MERCHANT} from './merchant.mjs';
import {readFile,writeFile,mkdir,rename,rm,readdir,lstat} from 'node:fs/promises';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {createVersion} from './version.mjs';
import {createAccess} from './access.mjs';
const exec=promisify(execFile);
export async function createControl({state,config,appDir}){
 await mkdir(state,{recursive:true,mode:0o700});
 const read=async(name,fallback)=>{try{return JSON.parse(await readFile(path.join(state,name),'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
 const write=async(name,value)=>{const file=path.join(state,name),tmp=file+'.'+randomBytes(8).toString('hex');await writeFile(tmp,JSON.stringify(value),{mode:0o600});await rename(tmp,file);};
 let settings={autoUpdate:true,notifications:false,engineEnabled:true,networkEnabled:true,...await read('settings.json',{})};let outbound=new AbortController();let serial=Promise.resolve(),lastNotice=0,pendingWrites=0;
 const access=createAccess({grants:await read('grants.json',[]),persist:value=>{pendingWrites++;serial=serial.catch(()=>{}).then(()=>write('grants.json',value)).finally(()=>{pendingWrites--;});return serial;}});
 function save(patch){pendingWrites++;serial=serial.catch(()=>{}).then(async()=>{const next={...settings,...patch};await write('settings.json',next);settings=next;if(!settings.engineEnabled||!settings.networkEnabled){outbound.abort();outbound=new AbortController();process.send?.({type:"cancel-background"});}return {...settings};}).finally(()=>{pendingWrites--;});return serial;}
 const safeVersion=async()=>{try{const {stdout}=await exec(config.codex,['--version'],{timeout:5000,windowsHide:true});return stdout.trim().match(/^codex-cli [\w.+-]+$/)?.[0]||'unknown';}catch{return 'unavailable';}};
 async function checkUpdates(){
  if(!settings.engineEnabled||!settings.networkEnabled)throw Object.assign(Error(),{code:"network_disabled"});
  const query=async(url,max=2000000)=>{const r=await fetch(url,{signal:AbortSignal.any([outbound.signal,AbortSignal.timeout(10000)])});if(!r.ok)throw Error();let size=0,parts=[];for await(const b of r.body){size+=b.length;if(size>max)throw Error();parts.push(b);}return JSON.parse(Buffer.concat(parts));};
  const [node,codex,app]=await Promise.allSettled([query('https://nodejs.org/dist/index.json'),query('https://registry.npmjs.org/@openai/codex/latest',100000),query('https://biuuka.com/downloads/biuuka/latest.json',65536)]);
  const currentBuild=await readFile(path.join(appDir,'build-info.json'),'utf8').then(JSON.parse).catch(()=>({}));
  const info={checkedAt:new Date().toISOString(),node:{current:process.version,latest:node.status==='fulfilled'?node.value.find(v=>v.lts)?.version:null},codex:{current:await safeVersion(),latest:codex.status==='fulfilled'?codex.value.version:null},app:{available:app.status==='fulfilled'&&app.value.build!==currentBuild.build,currentBuild:currentBuild.build||null,version:app.status==='fulfilled'?app.value.version:null,build:app.status==='fulfilled'?app.value.build:null},note:'依赖新版本仅提示；需使用经过兼容性校验的安装器更新。'};
  await write('dependency-check.json',info);return info;
 }
 async function cacheSize(){let total=0;try{for(const name of await readdir(path.join(state,'cache'))){const s=await lstat(path.join(state,'cache',name));if(s.isFile())total+=s.size;}}catch(e){if(e.code!=='ENOENT')throw e;}return total;}
 async function notify(origin,title,body){
  if(!settings.engineEnabled||!settings.networkEnabled||!settings.notifications)throw Object.assign(Error(),{code:'notifications_disabled'});
  if(typeof title!=='string'||!title.trim()||title.length>80||typeof body!=='string'||body.length>500)throw Object.assign(Error(),{code:'invalid_notification'});
  if(Date.now()-lastNotice<10000)throw Object.assign(Error(),{code:'notification_rate_limited'});lastNotice=Date.now();
  const heading=`${new URL(origin).hostname} · ${title}`;
  if(process.platform==='darwin')await exec('/usr/bin/osascript',['-e','on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv)\nend run',heading,body],{timeout:10000});
  else if(process.platform==='win32'){
   const payload=Buffer.from(JSON.stringify({title:heading,body}),'utf8').toString('base64');
   const script=`$ErrorActionPreference='Stop'; [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] > $null; [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime] > $null; $d=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json; $xml=New-Object Windows.Data.Xml.Dom.XmlDocument; $xml.LoadXml('<toast><visual><binding template="ToastGeneric"><text></text><text></text></binding></visual></toast>'); $t=$xml.GetElementsByTagName('text'); $null=$t.Item(0).AppendChild($xml.CreateTextNode($d.title)); $null=$t.Item(1).AppendChild($xml.CreateTextNode($d.body)); $n=[Windows.UI.Notifications.ToastNotification]::new($xml); [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Microsoft.Windows.PowerShell').Show($n)`;
   await exec('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{timeout:10000,windowsHide:true});
  }else throw Object.assign(Error(),{code:'notifications_unsupported'});
  return {submitted:true,delivery:'操作系统控制通知位置和显示，勿扰模式可能隐藏通知。'};
 }
 const appUpdate=createVersion({appDir,state,allowed:()=>settings.networkEnabled!==false,background:()=>settings.engineEnabled!==false&&settings.networkEnabled!==false,signal:()=>outbound.signal,manual:process.env.BIUUKA_MANUAL_UPDATE==='1'&&!!process.send,trigger:()=>process.send({type:'request-update'})});
 return {appUpdate,access,idle:()=>pendingWrites===0,enabled:()=>settings.engineEnabled!==false,online:()=>settings.engineEnabled!==false&&settings.networkEnabled!==false,settings:()=>({...settings}),save,notify,checkUpdates,
  async status(){return {tray:{running:(await readTrayState(state)).running},merchant:merchant(config.merchant)||DEFAULT_MERCHANT,dataDirectory:state,codexHome:config.codexHome,settings:{...settings},platform:process.platform,architecture:process.arch,node:process.version,codex:await safeVersion(),cacheBytes:await cacheSize(),grants:access.list(),update:await read('update-status.json',null),dependencies:await read('dependency-check.json',null)};},
  async closeTray(){return requestTrayClose(state);},
  async openTray(){
   if((await readTrayState(state)).running)return {submitted:true};
   await exec(config.node,[path.join(config.baseDir||appDir,'launcher.mjs'),'tray'],{timeout:10000,windowsHide:true,env:{...process.env,BIUUKA_STATE:state}});
   for(let attempt=0;attempt<40;attempt++){
    if((await readTrayState(state)).running)return {submitted:true,running:true};
    await new Promise(resolve=>setTimeout(resolve,200));
   }
   throw Error('Tray did not start; check local tray logs.');
  },
  async clearCache(){await rm(path.join(state,'cache'),{recursive:true,force:true});return {cleared:true};},
  schedule(action){if(!['service-exit','uninstall'].includes(action))throw Error('invalid');setTimeout(()=>{const p=spawn(process.execPath,[path.join(appDir,'cli.mjs'),action],{detached:true,stdio:'ignore',windowsHide:true});p.unref();},300);}
 };
}

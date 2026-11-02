import {readdir,readFile,writeFile,mkdir,rename,stat,realpath} from 'node:fs/promises';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';import {randomUUID} from 'node:crypto';
import {detectInstances} from './instances.mjs';
const exec=promisify(execFile),run=async(f,a)=>(await exec(f,a,{timeout:15000,maxBuffer:1024*1024,windowsHide:true,encoding:'utf8'})).stdout;
const fail=()=>{throw Error('请填写已有应用包或程序文件的绝对路径，最多登记 32 个副本。');};
export function createInstallationInventory({state,codex,baseDir,platform=process.platform,home=os.homedir(),applicationDirs,envPath=process.env.PATH||'',execute=run,detect=()=>detectInstances({includePaths:true,includeOwned:true})}={}){
 const file=path.join(state,'instance-installations.json');let cached,flight,mutation=Promise.resolve();
 const saved=async()=>{try{const value=JSON.parse(await readFile(file,'utf8'));if(!Array.isArray(value)||value.length>32)throw Error();return value.map(r=>{if(!r||!['chatgpt','codex-cli'].includes(r.kind)||typeof r.path!=='string'||!path.isAbsolute(r.path))throw Error();return {kind:r.kind,path:r.path,name:path.basename(r.path)};});}catch(e){if(e.code==='ENOENT')return [];throw Error('实例登记文件无法读取，未覆盖原文件。');}};
 const key=p=>platform==='win32'?p.toLowerCase():p;
 const scan=async()=>{
  const runtime=await detect(),found=new Map(),warnings=[];
  const add=async(input)=>{try{const p=await realpath(input.path),info=await stat(p);if(!info.isFile()&&!(input.kind==='chatgpt'&&p.endsWith('.app')&&info.isDirectory()))return;
   const k=key(p),prior=found.get(k);found.set(k,{...prior,...input,path:p,name:input.name||path.basename(p),exists:true,partner:!!input.partner||!!prior?.partner,manual:!!input.manual||!!prior?.manual,verified:!!input.verified||!!prior?.verified});
  }catch{if(input.partner||input.manual)found.set(key(input.path),{...input,exists:false,verified:false});}};
  if(codex)await add({kind:'codex-cli',path:codex,name:'Codex CLI',source:'partner',partner:true,verified:true});
  for(const directory of envPath.split(path.delimiter).filter(p=>path.isAbsolute(p)).slice(0,64))for(const name of platform==='win32'?['codex.exe','codex.cmd']:['codex'])await add({kind:'codex-cli',path:path.join(directory,name),source:'path',verified:false});
  for(const r of [...runtime.instances||[],...runtime.partnerInstances||[]])if(r.path)await add({kind:r.kind,path:r.path,name:r.name,source:'running',verified:true});
  if(platform==='darwin'){
   const bundles=new Set();for(const directory of applicationDirs||['/Applications',path.join(home,'Applications')])try{for(const name of await readdir(directory))if(name.endsWith('.app'))bundles.add(path.join(directory,name));}catch(e){if(e.code!=='ENOENT')warnings.push('部分应用目录无法读取');}
   try{const output=await execute('/usr/bin/mdfind',['kMDItemCFBundleIdentifier == "com.openai.chat" || kMDItemCFBundleIdentifier == "com.openai.codex"']);for(const p of output.trim().split('\n'))if(path.isAbsolute(p)&&p.endsWith('.app'))bundles.add(p);}catch{warnings.push('系统应用索引不可用，已检查常见安装目录');}
   for(const bundle of [...bundles].slice(0,256))try{const data=JSON.parse(await execute('/usr/bin/plutil',['-convert','json','-o','-',bundle+'/Contents/Info.plist']));if(['com.openai.chat','com.openai.codex'].includes(data.CFBundleIdentifier))await add({kind:'chatgpt',path:bundle,name:path.basename(bundle,'.app'),version:data.CFBundleShortVersionString,source:'system',verified:true});}catch{/* Unrelated application metadata need not be reported. */}
  }else if(platform==='win32'){
   try{const output=JSON.parse((await execute(path.win32.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./installation-inventory.ps1',import.meta.url))])).replace(/^\uFEFF/,''));for(const item of output.items||[])await add({...item,kind:'chatgpt',source:'system',verified:true});if(output.partial)warnings.push('部分系统安装信息无法读取');}catch{warnings.push('系统安装清单暂不可读，保留配置、运行中和手动登记的程序');}
  }
  for(const item of await saved())await add({...item,source:'manual',manual:true,verified:false});
  const normalizeRuntime=async r=>{let p=r.path;if(p&&platform==='darwin'&&r.kind==='chatgpt')p=p.replace(/\.app\/Contents\/.*$/,'.app');try{return key(await realpath(p));}catch{return p?key(p):null;}};
  const running=await Promise.all((runtime.instances||[]).map(async r=>({...r,key:await normalizeRuntime(r)}))),owned=await Promise.all((runtime.partnerInstances||[]).map(async r=>({...r,key:await normalizeRuntime(r)})));
  // Collapse a running macOS executable into its bundle entry.
  for(const [k,item] of found)if(platform==='darwin'&&item.kind==='chatgpt'&&item.path.includes('.app/Contents/')){const bundle=item.path.replace(/\.app\/Contents\/.*$/,'.app');if(found.has(key(bundle)))found.delete(k);}
  // Group only verified desktop entry points in the same installation directory.
  // Different copied directories remain separate even when their names match.
  const grouped=new Map();
  for(const item of found.values()){
   const group=platform==='win32'&&item.kind==='chatgpt'&&item.verified&&/^(chatgpt|codex)\.exe$/i.test(path.basename(item.path))?'desktop:'+key(path.dirname(item.path)):key(item.path);
   if(!grouped.has(group))grouped.set(group,[]);grouped.get(group).push(item);
  }
  const managedRoot=baseDir?await realpath(path.join(baseDir,'runtime')).catch(()=>null):null;
  const installations=[...grouped.values()].map(items=>{
   items.sort((a,b)=>Number(/^chatgpt\.exe$/i.test(path.basename(b.path)))-Number(/^chatgpt\.exe$/i.test(path.basename(a.path))));
   const item=items[0],paths=items.map(i=>i.path),keys=new Set(paths.map(key));
   const relative=managedRoot?path.relative(managedRoot,item.path):null;
   const bundled=item.kind==='codex-cli'&&relative!==null&&relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);
   return {...item,paths,manualPaths:items.filter(i=>i.manual).map(i=>i.path),bundled,partner:items.some(i=>i.partner),pids:running.filter(r=>keys.has(r.key)).map(r=>r.pid),partnerPids:owned.filter(r=>keys.has(r.key)).map(r=>r.pid)};
  });
  return {...runtime,installations,inventoryWarnings:[...new Set(warnings)],inventoryCheckedAt:new Date().toISOString()};
 };
 const list=()=>{if(flight)return flight;if(cached&&Date.now()-cached.at<10000)return Promise.resolve(cached.value);flight=scan().then(value=>{cached={at:Date.now(),value};return value;}).finally(()=>{flight=null;});return flight;};
 list.register=(input)=>{const work=mutation.then(async()=>{if(!input||!['chatgpt','codex-cli'].includes(input.kind)||typeof input.path!=='string'||input.path.length>4096||!path.isAbsolute(input.path)||/[\r\n\0]/.test(input.path))fail();let p,info;try{p=await realpath(input.path);info=await stat(p);}catch{fail();}if(input.kind==='chatgpt'&&platform==='darwin'?!(info.isDirectory()&&p.endsWith('.app')):!info.isFile())fail();if(platform==='win32'&&!/\.(exe|cmd)$/i.test(p))fail();const rows=await saved();if(rows.some(r=>key(r.path)===key(p)))return {registered:true};if(rows.length>=32)fail();rows.push({kind:input.kind,path:p,name:path.basename(p)});await mkdir(state,{recursive:true,mode:0o700});const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(rows),{mode:0o600,flag:'wx'});await rename(temp,file);await flight?.catch(()=>{});cached=null;return {registered:true};});mutation=work.catch(()=>{});return work;};
 list.remove=(input)=>{const work=mutation.then(async()=>{if(typeof input?.path!=='string')fail();const target=await realpath(input.path).catch(()=>input.path);const rows=(await saved()).filter(r=>key(r.path)!==key(target));await mkdir(state,{recursive:true,mode:0o700});const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(rows),{mode:0o600,flag:'wx'});await rename(temp,file);await flight?.catch(()=>{});cached=null;return {removed:true};});mutation=work.catch(()=>{});return work;};
 return list;
}

import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {download} from './setup.mjs';
import {unpack,UPDATE_ORIGIN} from '../../core/update.mjs';
// Build a transferable folder on a connected computer; no credentials are copied.
export async function offlinePack(platform, output, {request=fetch,downloadDependency=download}={}) {
  if(!['win32-x64','win32-arm64','darwin-x64','darwin-arm64'].includes(platform)||!output)throw Error('Provide a supported platform and a NEW output directory.');
  const folder=path.resolve(output);
  await mkdir(folder); // Refuse to overwrite an existing folder.
  try{
    const get=async(name,max)=>{const r=await request(UPDATE_ORIGIN+name,{signal:AbortSignal.timeout(60000),redirect:'error'});if(!r.ok)throw Error('Installer download failed');let size=0;const chunks=[];for await(const c of r.body){size+=c.length;if(size>max)throw Error('Installer too large');chunks.push(c);}return Buffer.concat(chunks);};
    const meta=JSON.parse((await get('latest.json',65536)).toString());
    const verified=async name=>{const b=await get(name,8*1024**2);if(createHash('sha256').update(b).digest('hex')!==meta.files?.[name]?.sha256)throw Error('Installer checksum mismatch');return b;};
    const files=unpack(await verified('biuuka.zip'));
    const sources=JSON.parse(files.get('sources.json').toString())[platform];
    if(!files.has('offline.mjs')||!sources.node.cacheFile||!sources.codex.cacheFile)throw Error('Server installer does not support offline packages yet.');
    const name=platform.startsWith('win32')?'install.cmd':'install.sh';
    await writeFile(path.join(folder,name),await verified(name));
    const cache=path.join(folder,'cache');await mkdir(cache);
    for(const source of [sources.node,sources.codex])await downloadDependency(source,path.join(cache,source.cacheFile));
    await writeFile(path.join(folder,'install-offline.cmd'),'@echo off\r\nsetlocal\r\nset "BIUUKA_OFFLINE_DIR=%~dp0cache"\r\nset "BIUUKA_OFFLINE_ONLY=1"\r\ncall "%~dp0install.cmd"\r\nexit /b %errorlevel%\r\n');
    await writeFile(path.join(folder,'install-offline.sh'),'#!/bin/sh\nset -eu\nHERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexport BIUUKA_OFFLINE_DIR="$HERE/cache" BIUUKA_OFFLINE_ONLY=1\nsh "$HERE/install.sh"\n',{mode:0o700});
    await writeFile(path.join(folder,'说明.txt'),`Biuuka ${meta.version} · ${platform}\n将整个目录复制到目标电脑。Windows 运行 install-offline.cmd；macOS 执行 sh install-offline.sh。\n安装依赖已打包并按固定摘要校验。登录、额度和对话仍需要可连接 OpenAI 的网络。\n不包含任何用户账户或令牌。\n`);
    console.log('Offline folder ready: '+folder);
  }catch(e){await rm(folder,{recursive:true,force:true});throw e;}
}

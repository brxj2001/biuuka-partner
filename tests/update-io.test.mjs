import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import os from 'node:os';import path from 'node:path';
import {spawn} from 'node:child_process';import {once} from 'node:events';
import {retryFileOperation,writeUpdateProgress} from '../core/update.mjs';

test('transient Windows replacement denial retries without deleting the previous receipt',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'biuuka-progress-')),original=fs.rename;
 try{
  const file=path.join(root,'update-status.json');await fs.writeFile(file,'{"status":"running","receivedBytes":144}');let calls=0;
  fs.rename=async(from,to)=>{if(to===file&&calls++<3){assert.equal(JSON.parse(await fs.readFile(file)).receivedBytes,144);throw Object.assign(Error('sharing violation'),{code:'EPERM'});}return original(from,to);};syncBuiltinESMExports();
  await writeUpdateProgress(root,{status:'running',receivedBytes:458});assert.equal(calls,4);assert.equal(JSON.parse(await fs.readFile(file)).receivedBytes,458);assert.deepEqual(await fs.readdir(root),['update-status.json']);
 }finally{fs.rename=original;syncBuiltinESMExports();await fs.rm(root,{recursive:true,force:true});}
});
test('persistent denial is bounded and reports safe operation, unrelated failures are not retried',async()=>{
 let calls=0;await assert.rejects(retryFileOperation('switch_files',async()=>{calls++;throw Object.assign(Error('fixture'),{code:'EACCES'});},{wait:async()=>{}}),{code:'EACCES',operation:'switch_files'});assert.equal(calls,12);
 calls=0;await assert.rejects(retryFileOperation('prepare_files',async()=>{calls++;throw Object.assign(Error('fixture'),{code:'ENOSPC'});},{wait:async()=>{}}),{code:'ENOSPC'});assert.equal(calls,1);
});
test('permanent progress replacement failure preserves old JSON and cleans unique temporary file',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'biuuka-progress-fail-')),original=fs.rename;
 try{await fs.writeFile(path.join(root,'update-status.json'),'{}');fs.rename=async()=>{throw Object.assign(Error('fixture'),{code:'EPERM'});};syncBuiltinESMExports();await assert.rejects(writeUpdateProgress(root,{status:'running'}),{code:'EPERM',operation:'write_progress'});assert.equal(await fs.readFile(path.join(root,'update-status.json'),'utf8'),'{}');assert.deepEqual(await fs.readdir(root),['update-status.json']);}
 finally{fs.rename=original;syncBuiltinESMExports();await fs.rm(root,{recursive:true,force:true});}
});
test('Windows real sharing lock releases while atomic progress writer retries',{skip:process.platform!=='win32'},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'biuuka-progress-win-'));let holder;
 try{const file=path.join(root,'update-status.json');await fs.writeFile(file,'{}');const literal=file.replaceAll("'","''");holder=spawn('powershell.exe',['-NoProfile','-Command',`$f=[IO.File]::Open('${literal}',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite);Write-Output 'locked';Start-Sleep -Milliseconds 800;$f.Dispose()`]);const exit=once(holder,'exit');const [data]=await once(holder.stdout,'data');assert.match(data.toString(),/locked/);await writeUpdateProgress(root,{status:'updated'});await exit;assert.equal(JSON.parse(await fs.readFile(file)).status,'updated');}
 finally{if(holder&&holder.exitCode===null)holder.kill();await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

import {createControl} from '../core/control.mjs';
test('通知偏好在 Windows 短暂占用后保存且重启读取一致',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'biuuka-notify-')),original=fs.rename;
 try{
  const control=await createControl({state:root,config:{},appDir:root});await control.save({notifications:false});
  const file=path.join(root,'settings.json');let calls=0;
  fs.rename=async(from,to)=>{if(to===file&&calls++<2){assert.equal(JSON.parse(await fs.readFile(file)).notifications,false);throw Object.assign(Error('locked'),{code:'EPERM'});}return original(from,to);};syncBuiltinESMExports();
  assert.equal((await control.save({notifications:true})).notifications,true);assert.equal(calls,3);
  const restarted=await createControl({state:root,config:{},appDir:root});assert.equal((await restarted.save({})).notifications,true);
  assert.deepEqual(await fs.readdir(root),['settings.json']);
 }finally{fs.rename=original;syncBuiltinESMExports();await fs.rm(root,{recursive:true,force:true});}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshRunningTray} from './tray-control.mjs';
test('更新保留用户退出托盘的选择',async()=>{
 let called=false;assert.equal(await refreshRunningTray('fixture',()=>{called=true;},{read:async()=>({running:false}),close:async()=>{throw Error('unexpected');}}),false);assert.equal(called,false);
});
test('新托盘必须等待旧托盘退出后启动',async()=>{
 const events=[];assert.equal(await refreshRunningTray('fixture',async()=>events.push('start'),{read:async()=>({running:true}),close:async()=>events.push('close')}),true);assert.deepEqual(events,['close','start']);
});
test('退出失败不能启动重复托盘',async()=>{
 let called=false;await assert.rejects(refreshRunningTray('fixture',()=>{called=true;},{read:async()=>({running:true}),close:async()=>{throw Error('timeout');}}),/timeout/);assert.equal(called,false);
});

import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {readTrayState,requestTrayClose} from './tray-control.mjs';
test('旧版 macOS 托盘按用户与精确启动命令识别，迁移不结束无关进程',{skip:process.platform!=='darwin'},async()=>{
 const state=await mkdtemp(path.join(os.tmpdir(),'biuuka-legacy-tray-'));let child;
 try{
  await writeFile(path.join(state,'config.json'),JSON.stringify({node:process.execPath,baseDir:state}));
  await writeFile(path.join(state,'tray.lock'),String(process.pid));
  assert.deepEqual(await readTrayState(state),{running:false});
  await writeFile(path.join(state,'launcher.mjs'),'setInterval(()=>{},1000);');
  child=spawn(process.execPath,[path.join(state,'launcher.mjs'),'tray-run'],{stdio:'ignore'});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  await writeFile(path.join(state,'tray.lock'),String(child.pid));
  assert.equal((await readTrayState(state)).legacy,true);
  await requestTrayClose(state);assert.equal((await readTrayState(state)).running,false);
 }finally{child?.kill();await rm(state,{recursive:true,force:true});}
});

import {prepareTrayForUpdate,restoreTrayAfterUpdate} from './tray-control.mjs';
import {readFile,access} from 'node:fs/promises';
test('更新在目录切换前关闭托盘并在新服务启动后只恢复一次',async()=>{
 const state=await mkdtemp(path.join(os.tmpdir(),'biuuka-tray-update-'));const events=[];
 try{
  assert.equal(await prepareTrayForUpdate(state,{read:async()=>({running:true}),close:async()=>{assert.equal(JSON.parse(await readFile(path.join(state,'tray-update-resume.json'))).resume,true);events.push('close');return {running:false};}}),true);
  events.push('replace');
  assert.equal(await restoreTrayAfterUpdate(state,async()=>events.push('start'),{read:async()=>({running:false})}),true);
  assert.equal(await restoreTrayAfterUpdate(state,async()=>events.push('duplicate')),false);
  assert.deepEqual(events,['close','replace','start']);
 }finally{await rm(state,{recursive:true,force:true});}
});
test('原本退出的托盘不因更新启动',async()=>{
 const state=await mkdtemp(path.join(os.tmpdir(),'biuuka-tray-update-'));
 try{assert.equal(await prepareTrayForUpdate(state,{read:async()=>({running:false}),close:async()=>{throw Error('unexpected');}}),false);assert.equal(await restoreTrayAfterUpdate(state,async()=>{throw Error('unexpected');}),false);}finally{await rm(state,{recursive:true,force:true});}
});
test('托盘拒绝退出时阻断目录切换且不遗留恢复请求',async()=>{
 const state=await mkdtemp(path.join(os.tmpdir(),'biuuka-tray-update-'));
 try{await assert.rejects(prepareTrayForUpdate(state,{read:async()=>({running:true}),close:async()=>{throw Error('locked');}}),/locked/);await assert.rejects(access(path.join(state,'tray-update-resume.json')));}finally{await rm(state,{recursive:true,force:true});}
});
test('更新回退可恢复托盘，启动失败保留恢复标记供重试',async()=>{
 const state=await mkdtemp(path.join(os.tmpdir(),'biuuka-tray-update-'));
 try{
  await prepareTrayForUpdate(state,{read:async()=>({running:true}),close:async()=>({running:false})});
  await assert.rejects(restoreTrayAfterUpdate(state,async()=>{throw Error('start failed');},{read:async()=>({running:false})}),/start failed/);
  await access(path.join(state,'tray-update-resume.json'));
  let starts=0;assert.equal(await restoreTrayAfterUpdate(state,async()=>{starts++;},{read:async()=>({running:false})}),true);assert.equal(starts,1);
 }finally{await rm(state,{recursive:true,force:true});}
});
test('恢复时已有托盘不重复启动',async()=>{
 const state=await mkdtemp(path.join(os.tmpdir(),'biuuka-tray-update-'));
 try{await prepareTrayForUpdate(state,{read:async()=>({running:true}),close:async()=>({running:false})});assert.equal(await restoreTrayAfterUpdate(state,async()=>{throw Error('duplicate');},{read:async()=>({running:true})}),true);}finally{await rm(state,{recursive:true,force:true});}
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {trayStatus,trayPlist,trayAction,trayMerchant} from '../tray/tray.mjs';
test('tray distinguishes paused engine from offline control without exposing account fields',()=>{
 assert.deepEqual(trayStatus({service:'biuuka',engine:'disabled',token:'secret'},{autoUpdate:false,notifications:true}),{online:true,enabled:false,autoUpdate:false,notifications:true});
 assert.equal(trayStatus(null,{}).online,false);
 assert.equal(trayStatus({service:'biuuka',engine:'enabled'},{}).enabled,true);
 assert.equal(trayStatus({service:'other',engine:'enabled'},{}).enabled,false);
});
test('tray startup remains independent and never restarts after deliberate tray quit',()=>{
 const text=trayPlist('/node & space','/base/launcher.mjs','/state/<user>');
 assert.ok(text.includes('com.biuuka.tray'));assert.ok(text.includes('/node &amp; space'));
 assert.ok(text.includes('/state/&lt;user&gt;'));assert.ok(text.includes('tray-run'));
 assert.ok(!text.includes('KeepAlive'));assert.ok(!text.includes('supervisor.mjs'));
});
test('tray rejects arbitrary commands before reading credentials or starting processes',async()=>{
 for(const action of ['uninstall','rm -rf /','https://example.com',undefined])await assert.rejects(trayAction(action),/Unknown tray action/);
});

test('console tray control uses a fresh instance handshake and leaves unrelated processes alone',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const {readTrayState,requestTrayClose,trayCloseRequested}=await import('../tray/tray-control.mjs');
 const root=await mkdtemp(path.join(os.tmpdir(),'biuuka-tray-')),instance='a'.repeat(32);let timer;
 try{
  assert.equal((await readTrayState(root)).running,false);
  await writeFile(path.join(root,'tray.lock'),String(process.pid));
  await writeFile(path.join(root,'tray-instance.json'),JSON.stringify({pid:process.pid,instance,updatedAt:Date.now()-30000}));assert.equal((await readTrayState(root)).running,false);
  await writeFile(path.join(root,'tray-instance.json'),JSON.stringify({pid:process.pid,instance,updatedAt:Date.now()}));assert.equal((await readTrayState(root)).running,true);
  timer=setInterval(async()=>{if(await trayCloseRequested(root,instance))await rm(path.join(root,'tray.lock'),{force:true});},25);
  assert.deepEqual(await requestTrayClose(root),{running:false});assert.equal(await trayCloseRequested(root,'b'.repeat(32)),false);assert.equal(await trayCloseRequested(root,instance),true);
  process.kill(process.pid,0);
 }finally{clearInterval(timer);await rm(root,{recursive:true,force:true});}
});

test('tray shop keeps trusted installation navigation and rejects arbitrary destinations',()=>{
 assert.deepEqual(trayMerchant({name:'测试店铺',url:'https://demo.biuuka.com/demo-mall?shopId=7&token=secret'}),{name:'测试店铺',url:'https://demo.biuuka.com/demo-mall?shopId=7'});
 for(const url of ['https://biuuka.com.evil.test/','javascript:alert(1)','file:///tmp/test','http://biuuka.com/'])assert.equal(trayMerchant({name:'测试',url}).url,'https://brxj.biuuka.com/');
 assert.equal(trayMerchant(undefined).url,'https://brxj.biuuka.com/');
});

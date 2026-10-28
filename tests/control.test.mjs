import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {createControl} from '../core/control.mjs';
test('control settings and hashed grants persist; cache cleanup preserves account and records',async()=>{
 const state=await mkdtemp(path.join(os.tmpdir(),'biuuka-control-'));const params={state,config:{codex:process.execPath},appDir:state};try{
 const c=await createControl(params);assert.equal(c.enabled(),true);await Promise.all([c.save({engineEnabled:false}),c.save({autoUpdate:false})]);assert.equal(c.enabled(),false);assert.equal((await createControl(params)).settings().autoUpdate,false);
 await assert.rejects(c.notify('https://biuuka.com','fixture','fixture'),e=>e.code==='notifications_disabled');
 const nonce='a'.repeat(48),p=c.access.start('https://external.test',nonce);c.access.approve(p.ticket,'forever',['account']);const g=await c.access.exchange('https://external.test',{ticket:p.ticket,nonce,code:c.access.view(p.ticket).code});const next=await createControl(params);assert.ok(next.access.permits(g.token,g.origin,'account'));assert.ok(!(await readFile(path.join(state,'grants.json'),'utf8')).includes(g.token));await next.access.revoke(g.id);assert.equal((await createControl(params)).access.permits(g.token,g.origin,'account'),false);
 await mkdir(path.join(state,'cache'));await writeFile(path.join(state,'cache','fixture'),'cache');await writeFile(path.join(state,'records.json'),'keep');await c.save({boundaryVersion:1});assert.equal((await createControl(params)).settings().boundaryVersion,1);await c.clearCache();assert.equal(await readFile(path.join(state,'records.json'),'utf8'),'keep');assert.equal(c.enabled(),false);
 }finally{await rm(state,{recursive:true,force:true});}
});

test('opening tray runs only the fixed user launcher and preserves paused engine',async()=>{
 const state=await mkdtemp(path.join(os.tmpdir(),'biuuka-open-tray-'));try{
  await writeFile(path.join(state,'launcher.mjs'),`import fs from 'node:fs';import path from 'node:path';fs.writeFileSync(path.join(process.env.BIUUKA_STATE,'tray-request.json'),JSON.stringify(process.argv.slice(2)));fs.writeFileSync(path.join(process.env.BIUUKA_STATE,'tray.lock'),String(process.ppid));fs.writeFileSync(path.join(process.env.BIUUKA_STATE,'tray-instance.json'),JSON.stringify({pid:process.ppid,instance:'a'.repeat(32),updatedAt:Date.now()}));`);
  const c=await createControl({state,config:{node:process.execPath,baseDir:state,codex:process.execPath},appDir:state});await c.save({engineEnabled:false});
  assert.deepEqual(await c.openTray(),{submitted:true,running:true});assert.equal(c.enabled(),false);assert.deepEqual(JSON.parse(await readFile(path.join(state,'tray-request.json'),'utf8')),['tray']);
  await rm(path.join(state,'tray-instance.json'));await rm(path.join(state,'tray.lock'));await rm(path.join(state,'launcher.mjs'));await assert.rejects(c.openTray());
 }finally{await rm(state,{recursive:true,force:true});}
});

test('network permission persists and blocks background checks and notifications independently of service',async()=>{
 const state=await mkdtemp(path.join(os.tmpdir(),'biuuka-network-control-'));const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;throw Error('unexpected network');};
 try{const options={state,config:{codex:process.execPath},appDir:state},c=await createControl(options);
 await c.save({networkEnabled:false,notifications:true});assert.equal(c.enabled(),true);assert.equal(c.online(),false);
 await assert.rejects(c.checkUpdates(),{code:'network_disabled'});await assert.rejects(c.notify('https://biuuka.com','test','test'),{code:'notifications_disabled'});await c.appUpdate.status();assert.equal(calls,0);
 assert.equal((await createControl(options)).settings().networkEnabled,false);
 await c.save({networkEnabled:true,engineEnabled:false});await assert.rejects(c.checkUpdates(),{code:'network_disabled'});await c.appUpdate.status();assert.equal(calls,0);
 await c.save({engineEnabled:true});assert.equal(c.online(),true);
 }finally{globalThis.fetch=original;await rm(state,{recursive:true,force:true});}
});

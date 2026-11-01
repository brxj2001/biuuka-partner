import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createVersion} from '../core/version.mjs';
test('version compares builds within development version and rate limits manual updates',async()=>{
 const appDir=await mkdtemp(path.join(os.tmpdir(),'biuuka-version-'));let calls=0,triggers=0,time=0;
 try{await writeFile(path.join(appDir,'build-info.json'),JSON.stringify({build:'a'.repeat(64)}));const request=async()=>{calls++;return new Response(JSON.stringify({version:'0.0.1',build:'b'.repeat(64),updateProtocol:1}));};
 const v=createVersion({appDir,request,now:()=>time,manual:true,trigger:()=>triggers++});assert.equal((await v.status()).state,'available');assert.equal((await v.start()).accepted,true);assert.equal(triggers,1);assert.equal((await v.start()).alreadyScheduled,true);assert.equal(triggers,1);assert.equal(calls,2);time=300001;await v.status();assert.equal(calls,3);
 const old=createVersion({appDir,request});await assert.rejects(old.start(),{code:'installer_required'});
 const same=createVersion({appDir,request:async()=>new Response(JSON.stringify({version:'0.0.1',build:'a'.repeat(64),updateProtocol:1})),manual:true});assert.equal((await same.start()).accepted,false);assert.equal((await same.status()).state,'latest');
 const invalid=createVersion({appDir,request:async()=>new Response('{}')});assert.equal((await invalid.status()).state,'unknown');
 }finally{await rm(appDir,{recursive:true,force:true});}
});

test('closed service reads version locally, explicit update works, network denial blocks it',async()=>{
 const appDir=await mkdtemp(path.join(os.tmpdir(),'biuuka-offline-version-'));let calls=0,allowed=true;
 try{await writeFile(path.join(appDir,'build-info.json'),JSON.stringify({build:'a'.repeat(64)}));
 const v=createVersion({appDir,background:()=>false,allowed:()=>allowed,manual:true,request:async()=>{calls++;return new Response(JSON.stringify({version:'0.0.1',build:'b'.repeat(64),updateProtocol:1}));}});
 assert.equal((await v.status()).build,'a'.repeat(64));assert.equal(calls,0);
 assert.equal((await v.start()).accepted,true);assert.equal(calls,1);
 await v.status();assert.equal(calls,1);
 allowed=false;await assert.rejects(v.status(true),{code:'network_disabled'});assert.equal(calls,1);
 }finally{await rm(appDir,{recursive:true,force:true});}
});

test('permission revoked during local version read cannot start a late outbound request',async()=>{
 let allowed=true,calls=0;const v=createVersion({appDir:'/nonexistent-fixture',allowed:()=>allowed,background:()=>allowed,request:async()=>{calls++;throw Error('unexpected');}});
 const pending=v.status();allowed=false;await pending;assert.equal(calls,0);
});

test('failed checks and denied permission do not consume update cooldown; concurrent requests trigger once',async()=>{
 const appDir=await mkdtemp(path.join(os.tmpdir(),'biuuka-update-retry-'));let good=false,allowed=true,triggers=0;
 try{await writeFile(path.join(appDir,'build-info.json'),JSON.stringify({build:'a'.repeat(64)}));
 const v=createVersion({appDir,manual:true,allowed:()=>allowed,request:async()=>good?new Response(JSON.stringify({version:'0.0.1',build:'b'.repeat(64),updateProtocol:1})):new Response('',{status:503}),trigger:()=>triggers++});
 assert.equal((await v.start()).state,'unknown');allowed=false;await assert.rejects(v.start(),{code:'network_disabled'});allowed=true;good=true;
 const results=await Promise.all([v.start(),v.start(),v.start()]);assert.ok(results.every(v=>v.accepted));assert.equal(triggers,1);
 allowed=false;await assert.rejects(v.start(),{code:'network_disabled'});
 }finally{await rm(appDir,{recursive:true,force:true});}
});

test('release metadata matches the packaged service and update manifest',async()=>{
 const {packageBiuuka}=await import('../package.mjs'),{unpack}=await import('../core/update.mjs'),{readFile}=await import('node:fs/promises');
 const {VERSION,RELEASE}=await import('../release.mjs');
 const output=await mkdtemp(path.join(os.tmpdir(),'biuuka-release-'));
 try{
  await packageBiuuka({output});
  const manifest=JSON.parse(await readFile(path.join(output,'latest.json'),'utf8'));
  const files=unpack(await readFile(path.join(output,'biuuka.zip')));
  const metadata=JSON.parse(files.get('release.json'));
  const build=JSON.parse(files.get('build-info.json'));
  assert.equal(manifest.version,VERSION);assert.equal(metadata.version,VERSION);assert.equal(build.version,VERSION);
  assert.equal(manifest.channel,RELEASE.channel);assert.equal(manifest.github,RELEASE.repository);
  assert.equal(manifest.build,build.build);assert.ok(files.has('release.mjs'));
 }finally{await rm(output,{recursive:true,force:true});}
});

test('update progress is fresh despite cached version metadata and projects only safe fields',async()=>{
 const state=await mkdtemp(path.join(os.tmpdir(),'biuuka-progress-'));let calls=0,time=Date.now();
 try{
  await writeFile(path.join(state,'build-info.json'),JSON.stringify({build:'a'.repeat(64)}));
  const v=createVersion({appDir:state,state,now:()=>time,request:async()=>{calls++;return new Response(JSON.stringify({version:'0.0.24',build:'b'.repeat(64),updateProtocol:1}));}});
  const receipt={status:'running',phase:'downloading',receivedBytes:20,totalBytes:100,updatedAt:new Date(time).toISOString(),path:'/private/fixture',token:'fixture-secret',reason:'arbitrary private message'};
  await writeFile(path.join(state,'update-status.json'),JSON.stringify(receipt));
  let result=await v.status();assert.deepEqual(result.update,{status:'running',phase:'downloading',updatedAt:receipt.updatedAt,receivedBytes:20,totalBytes:100});
  receipt.operation='write_progress';receipt.receivedBytes=50;await writeFile(path.join(state,'update-status.json'),JSON.stringify(receipt));
  assert.equal((await v.status()).update.operation,'write_progress');assert.equal((await v.status()).update.receivedBytes,50);assert.equal(calls,1);
  time+=120001;assert.equal((await v.status()).update.status,'interrupted');
  const offline=createVersion({appDir:state,state,background:()=>false,allowed:()=>false,request:()=>assert.fail('offline request')});
  assert.equal((await offline.status()).update.receivedBytes,50);
 }finally{await rm(state,{recursive:true,force:true});}
});

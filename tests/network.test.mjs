import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createNetwork,classify} from '../network/network.mjs';
import {download} from '../scripts/install/setup.mjs';
import {packageBiuuka} from '../package.mjs';
import {offlinePack} from '../scripts/install/offline.mjs';
test('diagnostics distinguish challenges from success, project IP fields and coalesce/cache checks',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'biuuka-net-'));let calls=0,time=0;
 const request=async url=>{calls++;if(url.startsWith('https://ipwho.is/'))return Response.json({success:true,ip:'203.0.113.7',country:'Fixture',connection:{isp:'Fixture ISP'},secret:'must not return'});return new Response('',{status:url.includes('chatgpt')?403:200});};
 try{const check=createNetwork({request,now:()=>time,directory:root});const [a,b]=await Promise.all([check(),check()]);assert.deepEqual(a,b);assert.equal(calls,5);assert.equal(a.checks.find(c=>c.id==='chatgpt').status,'blocked_or_challenge');assert.equal(a.exit.ip,'203.0.113.7');assert.ok(!JSON.stringify(a).includes('must not return'));await check();assert.equal(calls,5);time=300001;await check();assert.equal(calls,10);time=300002;await check(true);assert.equal(calls,15);assert.equal(classify(401),'authentication_required');assert.equal(classify(429),'rate_limited');}
 finally{await rm(root,{recursive:true,force:true});}
});
test('unavailable IP and timeout do not report a working network',async()=>{
 const check=createNetwork({request:async()=>{throw new DOMException('fixture','TimeoutError');}});const r=await check();assert.equal(r.exit.status,'unavailable');assert.ok(r.checks.every(c=>c.status==='timeout'&&c.latencyMs===null));
});
test('invalid mirror falls back to pinned official bytes; offline cache prevents all fetches',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'biuuka-source-')),original=globalThis.fetch,oldDir=process.env.BIUUKA_OFFLINE_DIR,oldOnly=process.env.BIUUKA_OFFLINE_ONLY;const seen=[];
 try{const source={url:'https://official.invalid/file',mirrors:['https://mirror.invalid/file'],algorithm:'sha256',digest:createHash('sha256').update('correct').digest('hex')};globalThis.fetch=async url=>{seen.push(url);return new Response(url.includes('mirror')?'incorrect':'correct');};const result=await download(source,path.join(root,'output'));assert.deepEqual(seen,[...source.mirrors,source.url]);assert.equal(result.source,'official.invalid');
 process.env.BIUUKA_OFFLINE_DIR=root;process.env.BIUUKA_OFFLINE_ONLY='1';await writeFile(path.join(root,'fixture.cache'),'correct');globalThis.fetch=()=>{throw Error('must not fetch');};await download({...source,cacheFile:'fixture.cache'},path.join(root,'cached'));assert.equal(await readFile(path.join(root,'cached'),'utf8'),'correct');await assert.rejects(download({...source,cacheFile:'missing'},path.join(root,'missing-output')),/Offline dependency/);
 }finally{globalThis.fetch=original;for(const [k,v]of [['BIUUKA_OFFLINE_DIR',oldDir],['BIUUKA_OFFLINE_ONLY',oldOnly]]){if(v===undefined)delete process.env[k];else process.env[k]=v;}await rm(root,{recursive:true,force:true});}
});
test('offline folder includes matching embedded installer and both architecture-specific dependencies',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'biuuka-offline-'));
 try{const pkg=path.join(root,'package');await packageBiuuka({output:pkg});const output=path.join(root,'offline'),sources=[];await offlinePack('win32-arm64',output,{request:async url=>new Response(await readFile(path.join(pkg,new URL(url).pathname.split('/').pop()))),downloadDependency:async(s,target)=>{sources.push(s);await writeFile(target,'fixture');}});assert.equal(sources.length,2);assert.ok(sources.every(s=>s.cacheFile.includes('win32-arm64')));assert.match(await readFile(path.join(output,'install-offline.cmd'),'utf8'),/BIUUKA_OFFLINE_ONLY=1/);assert.deepEqual(await readFile(path.join(output,'install.cmd')),await readFile(path.join(pkg,'install.cmd')));await assert.rejects(offlinePack('win32-arm64',output),/exist/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('closing network detection aborts all in-flight probes',async()=>{
 let started=0,aborted=0;
 const network=createNetwork({request:async(url,{signal})=>{started++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted++;reject(signal.reason);},{once:true}));}});
 const pending=network(true);network.cancel();await pending;assert.equal(started,5);assert.equal(aborted,5);
});

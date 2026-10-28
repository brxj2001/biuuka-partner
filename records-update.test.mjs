import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {Records} from './records.mjs';
import {stageUpdate,unpack} from './update.mjs';
import {packageBiuuka} from './package.mjs';
test('records persist, recover interrupted tests, omit content from lists and delete only the selected record',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'biuuka-records-'));try{
 const records=new Records(root),a=await records.begin({preset:'pelican',model:'fixture',effort:'low',prompt:'fixture'}),b=await records.begin({preset:'candy'});
 await records.put({...a,status:'complete',answer:'<html>fixture</html>'});
 const reopened=new Records(root);await reopened.recover();
 assert.equal((await reopened.get(a.id)).answer,'<html>fixture</html>');assert.equal((await reopened.get(b.id)).status,'interrupted');
 assert.ok((await reopened.list()).every(r=>!('answer'in r)&&!('prompt'in r)));
 await assert.rejects(reopened.remove('../config'),/invalid_record/);await reopened.remove(a.id);
 assert.equal((await reopened.list()).length,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('updater checks full package hash and native dependency compatibility before staging',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'biuuka-update-')),original=globalThis.fetch;
 try{
 const output=path.join(root,'package'),current=path.join(root,'current');await packageBiuuka({output});await mkdir(current);
 await writeFile(path.join(current,'build-info.json'),JSON.stringify({build:'old'}));
 await writeFile(path.join(current,'sources.json'),await readFile(new URL('./sources.json',import.meta.url)));
 const metadata=JSON.parse(await readFile(path.join(output,'latest.json'),'utf8')),zip=await readFile(path.join(output,'biuuka.zip'));
 globalThis.fetch=async url=>new Response(url.endsWith('latest.json')?JSON.stringify(metadata):zip);
 const staged=await stageUpdate(root,current);assert.equal(staged.build,metadata.build);assert.ok(unpack(zip).has('supervisor.mjs'));
 assert.equal(JSON.parse(await readFile(path.join(staged.next,'build-info.json'),'utf8')).build,metadata.build);
 metadata.files['biuuka.zip'].sha256='0'.repeat(64);await assert.rejects(stageUpdate(root,current),/checksum/);
 metadata.files['biuuka.zip'].sha256=JSON.parse(await readFile(path.join(output,'latest.json'),'utf8')).files['biuuka.zip'].sha256;
 await writeFile(path.join(current,'sources.json'),'{}');await assert.rejects(stageUpdate(root,current),/installer_required/);
 await assert.rejects(Promise.resolve().then(()=>unpack(Buffer.from('not a zip'))),/invalid_archive/);
 }finally{globalThis.fetch=original;await rm(root,{recursive:true,force:true});}
});

test('trusted website can read/delete its test records while unrelated Codex history stays private; update waits for idle',async()=>{
 const {createServer}=await import('./server.mjs'),{CodexBridge}=await import('./bridge.mjs'),{once}=await import('node:events');
 const root=await mkdtemp(path.join(os.tmpdir(),'biuuka-record-http-')),records=new Records(root),children=[];
 const server=createServer({token:'fixture-token',refreshMs:0,records,network:async()=>({checks:[],exit:{status:'unavailable'}}),bridgeFactory:()=>{const b=new CodexBridge({command:process.execPath,args:[new URL('./fake-codex.mjs',import.meta.url).pathname,'ok'],timeout:3000});children.push(b);return b;}});
 server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${server.address().port}`;
 const http=await import('node:http');
 const call=(route,body={})=>new Promise((resolve,reject)=>{const req=http.request(url+route,{method:'POST',headers:{Host:'127.0.0.1:17322',Origin:'https://biuuka.com','Content-Type':'application/json'}},res=>{const content=new Promise((done,fail)=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>done(text));res.on('error',fail);});resolve({status:res.statusCode,text:()=>content,json:async()=>JSON.parse(await content)});});req.on('error',reject);req.end(JSON.stringify(body));});
 try{
 const response=await call('/test',{model:'fixture-model',effort:'low',preset:'pelican'});assert.equal(server.prepareUpdate(),false);await response.text();
 const list=await (await call('/records')).json();assert.equal(list.records.length,1);const r=await (await call('/record',{id:list.records[0].id})).json();assert.equal(r.status,'complete');assert.ok(r.answer.includes('Pelican'));
 assert.ok(children.every(b=>b.child.exitCode===0));
 assert.equal((await call('/history')).status,403);
 assert.equal((await call('/network')).status,200);assert.equal((await call('/network',{url:'https://arbitrary.invalid'})).status,400);
 await call('/record/delete',{id:r.id});assert.equal((await (await call('/records')).json()).records.length,0);
 assert.equal(server.prepareUpdate(),true);assert.equal((await call('/test',{model:'fixture-model',effort:'low'})).status,409);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));for(const b of children)b.close();await rm(root,{recursive:true,force:true});}
});

test('supervisor recovers a failed switched application and releases its child on shutdown',async()=>{
 const {spawn}=await import('node:child_process'),{once}=await import('node:events'),{cp}=await import('node:fs/promises'),net=await import('node:net');
 const root=await mkdtemp(path.join(os.tmpdir(),'biuuka-supervisor-'));
 const reservation=net.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 let supervisor,pid;
 try{
 await writeFile(path.join(root,'config.json'),JSON.stringify({codex:process.execPath,codexHome:root,port,work:path.join(root,'work')}));
 const active=path.join(root,'app');await mkdir(active);await writeFile(path.join(active,'build-info.json'),'{}');await writeFile(path.join(active,'cli.mjs'),'process.exit(1);');
 const old=path.join(root,'update-old');await mkdir(old);
 for(const name of ['release.mjs','release.json','desktop-switch.mjs','desktop-switch.ps1','desktop-switch-macos.js','accounts.mjs','tray-control.mjs','local-profile.mjs','chatgpt-install.mjs','chatgpt-install.ps1','merchant.mjs','subscription.mjs','version.mjs','live.mjs','ports.mjs','ws.cjs','access.mjs','control.mjs','network.mjs','cli.mjs','runtime.mjs','state.mjs','records.mjs','server.mjs','bridge.mjs','mac-service.mjs'])await cp(new URL('./'+name,import.meta.url),path.join(old,name));
 await writeFile(path.join(old,'build-info.json'),'{}');
 supervisor=spawn(process.execPath,[new URL('./supervisor.mjs',import.meta.url).pathname],{env:{...process.env,BIUUKA_STATE:root},stdio:'ignore'});
 let ready=false;
 for(let i=0;i<100;i++){try{const r=JSON.parse(await readFile(path.join(root,'runtime.json'),'utf8'));const h=await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(500)});if(h.ok){pid=r.pid;ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}
 assert.equal(ready,true);assert.ok((await readFile(path.join(active,'cli.mjs'),'utf8')).includes('Biuuka'));
 const exit=once(supervisor,'exit');supervisor.kill('SIGTERM');await exit;
 assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
 }finally{if(supervisor&&supervisor.exitCode===null&&supervisor.signalCode===null)supervisor.kill('SIGKILL');await rm(root,{recursive:true,force:true});}
});

test('silent update stages verified application, switches while idle and confirms the new service',async()=>{
 const {spawn}=await import('node:child_process'),{once}=await import('node:events'),{cp}=await import('node:fs/promises'),net=await import('node:net');
 const root=await mkdtemp(path.join(os.tmpdir(),'biuuka-update-live-'));let supervisor,pid;
 const reservation=net.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 try{
 const output=path.join(root,'package');await packageBiuuka({output});
 const base=path.join(root,'base');await mkdir(base);for(const [name,bytes]of unpack(await readFile(path.join(output,'biuuka.zip'))))await writeFile(path.join(base,name),bytes);
 await writeFile(path.join(base,'build-info.json'),JSON.stringify({build:'old',updateProtocol:1}));
 await writeFile(path.join(root,'config.json'),JSON.stringify({codex:process.execPath,codexHome:root,port,work:path.join(root,'work')}));
 const preload=path.join(root,'preload.mjs');await writeFile(preload,`import fs from 'node:fs/promises';const original=globalThis.fetch;globalThis.fetch=async(url,options)=>String(url).startsWith('https://biuuka.com/downloads/biuuka/')?new Response(await fs.readFile(${JSON.stringify(output)}+'/'+String(url).split('/').pop())):original(url,options);const timeout=globalThis.setTimeout;globalThis.setTimeout=(fn,ms,...args)=>timeout(fn,ms===60000?50:ms,...args);`);
 supervisor=spawn(process.execPath,['--import',preload,path.join(base,'supervisor.mjs')],{env:{...process.env,BIUUKA_STATE:root},stdio:'ignore'});
 let updated=false;
 for(let i=0;i<200;i++){try{const status=JSON.parse(await readFile(path.join(root,'update-status.json'),'utf8'));if(status.status==='updated'){updated=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}
 assert.equal(updated,true);const runtime=JSON.parse(await readFile(path.join(root,'runtime.json'),'utf8'));pid=runtime.pid;
 assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status,200);await assert.rejects(readFile(path.join(root,'update-old','build-info.json')),{code:'ENOENT'});
 const exit=once(supervisor,'exit');supervisor.kill('SIGTERM');await exit;assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
 }finally{if(supervisor&&supervisor.exitCode===null&&supervisor.signalCode===null)supervisor.kill('SIGKILL');await rm(root,{recursive:true,force:true});}
});

test('linked deletion retains record on failure, blocks running records and preserves unrelated records',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'biuuka-delete-record-'));
 try{
  const records=new Records(root),a=await records.begin({preset:'candy'}),b=await records.begin({preset:'pelican'});
  await assert.rejects(records.remove(a.id,()=>assert.fail('running deletion')),/record_running/);
  await records.put({...a,status:'complete',threadId:'owned-thread'});
  await assert.rejects(records.remove(a.id),/thread_delete_required/);
  await assert.rejects(records.remove(a.id,async()=>{throw Error('codex failed');}),/codex failed/);
  assert.equal((await records.get(a.id)).threadId,'owned-thread');
  await records.remove(a.id,async id=>assert.equal(id,'owned-thread'));
  assert.deepEqual((await records.list()).map(r=>r.id),[b.id]);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('Codex deletion checks ownership, tolerates already deleted threads, and propagates provider failures',async()=>{
 const {CodexBridge}=await import('./bridge.mjs');
 for(const mode of ['owned','foreign','missing','failure']){
  const calls=[],bridge={request:async(method,params)=>{calls.push(method);assert.equal(params.threadId,'linked-thread');if(method==='thread/read'){if(mode==='missing')throw {code:'codex_thread_not_found'};return {thread:{id:'linked-thread',originator:mode==='foreign'?'cli':'biuuka',ephemeral:false}};}if(mode==='failure')throw Error('delete failed');return {};}};
  const operation=CodexBridge.prototype.deleteThread.call(bridge,'linked-thread');
  if(mode==='foreign')await assert.rejects(operation,/thread_ownership_unconfirmed/);
  else if(mode==='failure')await assert.rejects(operation,/delete failed/);
  else await operation;
  assert.equal(calls.includes('thread/delete'),['owned','failure'].includes(mode));
 }
});

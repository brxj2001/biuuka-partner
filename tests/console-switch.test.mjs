import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createServer} from '../core/server.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('scheduled account round blocks updates and yields to a user switch only after query exit',async()=>{
 let entered,release,switched=false,calls=[];
 const started=new Promise(r=>entered=r),exited=new Promise(r=>release=r);
 const server=createServer({token:'fixture',refreshMs:0,accountRefreshMs:20,network:async()=>null,control:{enabled:()=>true},accounts:{
  list:async()=>({accounts:[{id:'first'},{id:'second'}]}),idle:()=>true,close(){},cancel(){},
  refresh:async id=>{calls.push(id);entered();await exited;},switchTo:async()=>{switched=true;return {switched:true};}
 },bridgeFactory:()=>({initialize:async()=>{},profile:async()=>({}),close(){}})});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{await started;assert.equal(server.canPrepareUpdate(),false);
  const result=request(server,'/control/accounts/switch',{id:'second'});await delay(40);assert.equal(switched,false);
  release();assert.equal((await result).status,200);assert.equal(switched,true);assert.deepEqual(calls,['first']);
 }finally{release();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
function request(server,path,body){return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:server.address().port,path,method:body?'POST':'GET',headers:{Host:'127.0.0.1:17322',Authorization:'Bearer fixture','Content-Type':'application/json'}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,text,headers:res.headers}));});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);});}

test('manual bulk query uses the management lock and rejects duplicate requests and extra fields',async()=>{
 let entered,release,calls=0;const started=new Promise(r=>entered=r),done=new Promise(r=>release=r);
 const server=createServer({token:'fixture',refreshMs:0,accountRefreshMs:0,control:{enabled:()=>true},accounts:{idle:()=>true,close(){},refreshAll:async()=>{calls++;entered();await done;return {total:2,succeeded:1,failed:1};}}});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{assert.equal((await request(server,'/control/accounts/refresh-all',{id:'unexpected'})).status,400);
  const first=request(server,'/control/accounts/refresh-all',{});await started;assert.equal(server.canPrepareUpdate(),false);
  assert.equal((await request(server,'/control/accounts/refresh-all',{})).status,409);release();
  const result=await first;assert.equal(result.status,200);assert.deepEqual(JSON.parse(result.text),{total:2,succeeded:1,failed:1});assert.equal(calls,1);
 }finally{release();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('switch preempts hanging poll, waits for exit and suppresses new polls until switch completes',async()=>{
 let entered,exit,complete,called=false,starts=0;
 const started=new Promise(r=>entered=r),exited=new Promise(r=>exit=r),done=new Promise(r=>complete=r);
 const server=createServer({token:'fixture',refreshMs:10,network:async()=>null,control:{enabled:()=>true},accounts:{close(){},idle:()=>true,switchTo:async()=>{called=true;await done;return {switched:true};}},bridgeFactory:()=>{starts++;return {initialize:async()=>{entered();await new Promise(()=>{});},close(){},closeAndWait:()=>exited};}});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{await started;const response=request(server,'/control/accounts/switch',{id:'fixture'});await delay(40);assert.equal(called,false);assert.equal(starts,1);exit();await delay(40);assert.equal(called,true);assert.equal(starts,1);complete();const result=await response;assert.equal(result.status,200);assert.ok(JSON.parse(result.text).backgroundWaitMs<1000);}
 finally{exit();complete();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('unconfirmed background exit blocks account writes on subsequent attempts too',async()=>{
 let starts=0,called=0;const server=createServer({token:'fixture',refreshMs:10,network:async()=>null,control:{enabled:()=>true},accounts:{close(){},idle:()=>true,switchTo:async()=>called++},bridgeFactory:()=>{starts++;return {initialize:async()=>new Promise(()=>{}),close(){},closeAndWait:async()=>{throw Object.assign(Error('shutdown_unconfirmed'),{code:'shutdown_unconfirmed'});}};}});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{for(let i=0;i<2;i++){const r=await request(server,'/control/accounts/switch',{id:'fixture'});assert.equal(r.status,409);assert.equal(JSON.parse(r.text).error,'shutdown_unconfirmed');}await delay(30);assert.equal(called,0);assert.equal(starts,1);}
 finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('exported console serves only manifest assets and keeps strict CSP',async()=>{
 const server=createServer({token:'fixture',refreshMs:0,control:{enabled:()=>false}});server.listen(0,'127.0.0.1');await once(server,'listening');
 try{const r=await request(server,'/console');assert.equal(r.status,200);assert.match(r.headers['content-security-policy'],/sha256-/);assert.doesNotMatch(r.headers['content-security-policy'],/unsafe-inline|unsafe-eval/);const src=r.text.match(/src="(\/_next\/[^\"]+)"/)[1];assert.equal((await request(server,src)).status,200);assert.equal((await request(server,'/_next/not-listed.js')).status,404);assert.notEqual((await request(server,'/_next/../core/server.mjs')).status,200);}
 finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('record preview permits only the hashed receiver in an isolated document',async()=>{
 const server=createServer({token:'fixture',refreshMs:0,control:{enabled:()=>false}});server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const page=await request(server,'/console');assert.match(page.headers['content-security-policy'],/frame-src 'self'/);
  const result=await request(server,'/record-preview');assert.equal(result.status,200);
  const csp=result.headers['content-security-policy'];assert.match(csp,/script-src 'sha256-/);assert.match(csp,/sandbox allow-scripts/);assert.doesNotMatch(csp,/allow-same-origin|script-src[^;]*unsafe-inline/);assert.match(csp,/connect-src 'none'/);assert.match(csp,/frame-src 'none'/);assert.match(csp,/form-action 'none'/);
  assert.ok(!result.text.includes('fixture'));assert.match(result.text,/event.source!==parent/);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

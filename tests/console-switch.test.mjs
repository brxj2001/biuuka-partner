import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createServer} from '../core/server.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function request(server,path,body){return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:server.address().port,path,method:body?'POST':'GET',headers:{Host:'127.0.0.1:17322',Authorization:'Bearer fixture','Content-Type':'application/json'}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,text,headers:res.headers}));});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);});}
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

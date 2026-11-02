import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,chmod} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import https from 'node:https';import {createServer} from '../core/server.mjs';import {prepareIdentity,readIdentity,startHttps,trustIdentity} from '../core/local-https.mjs';import ws from '../vendor/ws/ws.cjs';
const origin='https://brxj.biuuka.com';
const request=(port,ca,{route='/health',headers={},method='GET'}={})=>new Promise((resolve,reject)=>{const req=https.request({hostname:'127.0.0.1',port,path:route,ca,method,headers:{Origin:origin,...headers}},res=>{let body='';res.on('data',v=>body+=v);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));});req.on('error',reject);req.end();});
test('independent loopback certificates and TLS preserve HTTP, origin, management and live boundaries',{skip:process.platform==='win32'},async()=>{
 const state=await mkdtemp(path.join(os.tmpdir(),'biuuka-https-'));let tls,server;
 try{const identity=await prepareIdentity(state);assert.equal((await prepareIdentity(state)).fingerprint,identity.fingerprint);let called=false;await assert.rejects(trustIdentity(state,{platform:'darwin',run:()=>called=true}),/confirmation_required/);assert.equal(called,false);
 server=createServer({token:'fixture-master',port:17322,refreshMs:0,bridgeFactory:()=>{throw Error('no account operation');},network:()=>null});
 // Find a free loopback port without touching the installed service.
 const probe=https.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 tls=await startHttps({state,server,httpPort:17322,ports:[port]});
 const health=await request(port,identity.cert);assert.equal(health.status,200);assert.equal(JSON.parse(health.body).service,'biuuka');assert.equal(health.headers['access-control-allow-origin'],origin);
 assert.equal((await request(port,identity.cert,{headers:{Origin:'https://evil.example'}})).status,403);
 await assert.rejects(request(port,identity.cert,{headers:{Host:'evil.example'}}),{code:'ERR_TLS_CERT_ALTNAME_INVALID'});
 assert.equal((await request(port,identity.cert,{headers:{Authorization:'Bearer fixture-master'},route:'/control/status',method:'POST'})).status,403);
 assert.equal((await request(port,identity.cert,{route:'/control/status',method:'POST'})).status,403);
 const preflight=await request(port,identity.cert,{route:'/account',method:'OPTIONS',headers:{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}});assert.equal(preflight.status,204);
 await assert.rejects(request(port,undefined),/self.signed certificate/);
 await new Promise((resolve,reject)=>{const socket=new ws.WebSocket(`wss://127.0.0.1:${port}/events`,{ca:identity.cert,origin});socket.on('error',reject);socket.on('message',bytes=>{try{assert.equal(JSON.parse(bytes).service,'biuuka');socket.close();resolve();}catch(e){reject(e);}});});
 await chmod(path.join(state,'https/key.pem'),0o644);await assert.rejects(readIdentity(state),/unsafe_permissions/);
 }finally{tls?.close();server?.closeAllConnections();server?.close();await rm(state,{recursive:true,force:true});}
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import http from 'node:http';
import ws from './ws.cjs';
import {createServer} from './server.mjs';
import {createAccess} from './access.mjs';
import {listenAvailable} from './ports.mjs';
const listen=async server=>{server.listen(0,'127.0.0.1');await once(server,'listening');return server.address().port;};
const stop=server=>{server.closeAllConnections();return new Promise(r=>server.close(r));};
test('WS validates Origin, pushes fresh projected profiles and rejects commands',async()=>{
 let count=0;const server=createServer({token:'fixture',refreshMs:30,bridgeFactory:()=>({initialize:async()=>{},profile:async()=>({checkedAt:String(++count),limits:[]}),close(){}})});const port=await listen(server);
 const connect=origin=>new ws(`ws://127.0.0.1:${port}/events`,{origin,headers:{Host:'127.0.0.1:17322'}});
 let client;
 try{
  const bad=connect('https://biuuka.com.evil.test');await once(bad,'open');let leaked=false;bad.on('message',()=>leaked=true);bad.send(JSON.stringify({type:'authorize',token:'invalid'}));const [code]=await once(bad,'close');assert.equal(code,1008);assert.equal(leaked,false);
  const httpOrigin=connect('http://biuuka.com');const rejected=await new Promise(r=>httpOrigin.on('error',r));assert.match(rejected.message,/403/);
  client=connect('https://tenant.uuco-card.com');const [first]=await once(client,'message');assert.equal(JSON.parse(first).service,'biuuka');const [next]=await once(client,'message');assert.ok(JSON.parse(next).profile.checkedAt);assert.ok(count>=1);
  client.send(JSON.stringify({type:'uninstall'}));const [closed]=await once(client,'close');assert.equal(closed,1008);
 }finally{client?.terminate();await stop(server);}
});
test('WS third-party account permission is required; revocation ends subscription',async()=>{
 const access=createAccess(),origin='https://external.test',nonce='a'.repeat(48);const p=access.start(origin,nonce);access.approve(p.ticket,300,['account']);const grant=await access.exchange(origin,{ticket:p.ticket,nonce,code:access.view(p.ticket).code});
 const control={access,enabled:()=>false};const server=createServer({token:'fixture',refreshMs:0,control,bridgeFactory:()=>{throw Error('paused');}});const port=await listen(server);const client=new ws(`ws://127.0.0.1:${port}/events`,{origin,headers:{Host:'127.0.0.1:17322'}});
 try{await once(client,'open');const received=once(client,'message');client.send(JSON.stringify({type:'authorize',token:grant.token}));const [bytes]=await received;assert.equal(JSON.parse(bytes).engine,'disabled');assert.equal(JSON.parse(bytes).profile,null);
  const ended=once(client,'close');await new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,path:'/control/grants/revoke',method:'POST',headers:{Host:'127.0.0.1:17322',Origin:'http://127.0.0.1:17322',Authorization:'Bearer fixture','Content-Type':'application/json'}},res=>{res.resume();res.on('end',resolve);});req.on('error',reject);req.end(JSON.stringify({id:grant.id}));});assert.equal((await ended)[0],1008);
 }finally{client.terminate();await stop(server);}
});
test('occupied primary port falls back without stopping its occupant; all occupied fails',async()=>{
 const occupied=http.createServer((req,res)=>res.end('existing')),primary=await listen(occupied),spare=http.createServer(),secondary=await listen(spare);await stop(spare);let chosen;
 try{chosen=await listenAvailable(()=>http.createServer(),primary,[secondary]);assert.equal(chosen.port,secondary);assert.equal(await(await fetch(`http://127.0.0.1:${primary}`)).text(),'existing');await assert.rejects(listenAvailable(()=>http.createServer(),primary,[secondary]),/occupied/);}
 finally{if(chosen)await stop(chosen.server);await stop(occupied);}
});
test('network refresh pushes snapshots; website updates are first-party and fixed-input only',async()=>{
 let starts=0,enabled=true,probes=0;const report={checkedAt:'fixture',exit:{country:'fixture'}};
 const control={enabled:()=>enabled,appUpdate:{status:async()=>({state:'latest'}),start:async()=>{starts++;return {accepted:true};}}};
 const server=createServer({token:'fixture',refreshMs:0,control,network:async()=>{probes++;return report;},bridgeFactory:()=>{throw Error('paused');}}),port=await listen(server);
 const request=(route,origin,body={})=>new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,path:route,method:'POST',headers:{Host:'127.0.0.1:17322',Origin:origin,'Content-Type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end(JSON.stringify(body));});
 const client=new ws(`ws://127.0.0.1:${port}/events`,{origin:'https://biuuka.com',headers:{Host:'127.0.0.1:17322'}});
 try{await once(client,'message');const next=once(client,'message');assert.equal(await request('/network','https://biuuka.com'),200);assert.deepEqual(JSON.parse((await next)[0]).network,report);
 assert.equal(await request('/update/start','https://evil.test'),403);assert.equal(await request('/update/start','https://biuuka.com',{url:'https://evil.test'}),400);assert.equal(starts,0);assert.equal(await request('/update/start','https://biuuka.com'),200);assert.equal(starts,1);enabled=false;const count=probes;assert.equal(await request('/network','https://biuuka.com'),409);assert.equal(probes,count);
 }finally{client.terminate();await stop(server);}
});

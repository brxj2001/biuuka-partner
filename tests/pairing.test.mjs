import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import http from 'node:http';
import {createAccess,trustedOrigin} from '../core/access.mjs';
import {createServer} from '../core/server.mjs';
test('automatic trust accepts only exact HTTPS roots and subdomain boundaries',()=>{
 for(const s of ['https://biuuka.com','https://a.b.biuuka.com','https://uuco-card.com','https://shop.uuco-card.com'])assert.equal(trustedOrigin(s),true);
 for(const s of ['https://biuuka.com.evil.test','https://evilbiuuka.com','http://biuuka.com','https://biuuka.com:444','https://biuuka.com/path','https://u:p@biuuka.com','null'])assert.equal(trustedOrigin(s),false);
});
test('rolling codes require local approval, exact origin/nonce, current window and bounded attempts',async()=>{
 let now=1000,persisted;const access=createAccess({now:()=>now,persist:async v=>{persisted=structuredClone(v);}}),origin='https://external.test',nonce='a'.repeat(48),p=access.start(origin,nonce);
 assert.equal(await access.exchange(origin,{ticket:p.ticket,nonce,code:access.view(p.ticket).code}),null);
 assert.equal(access.approve(p.ticket,299,['account']),false);assert.equal(access.approve(p.ticket,300,['account']),true);
 const old=access.view(p.ticket).code;now=31000;while(access.view(p.ticket).code===old)now+=30000;
 assert.equal(await access.exchange(origin,{ticket:p.ticket,nonce,code:old}),null);
 assert.equal(await access.exchange('https://other.test',{ticket:p.ticket,nonce,code:access.view(p.ticket).code}),null);
 const grant=await access.exchange(origin,{ticket:p.ticket,nonce,code:access.view(p.ticket).code});assert.ok(grant.token);assert.equal(access.view(p.ticket),null);assert.ok(!JSON.stringify(persisted).includes(grant.token));assert.equal(access.permits(grant.token,origin,'account'),true);assert.equal(access.permits(grant.token,origin,'test'),false);assert.equal(access.permits(grant.token,'https://other.test','account'),false);
 const reload=createAccess({now:()=>now,grants:persisted});assert.equal(reload.permits(grant.token,origin,'account'),true);now+=300001;assert.equal(reload.permits(grant.token,origin,'account'),false);
 const q=access.start(origin,nonce);access.approve(q.ticket,'forever',['test']);for(let i=0;i<5;i++)assert.equal(await access.exchange(origin,{ticket:q.ticket,nonce,code:'bad'}),null);assert.equal(await access.exchange(origin,{ticket:q.ticket,nonce,code:access.view(q.ticket).code}),null);
 const r=access.start(origin,nonce);access.approve(r.ticket,'forever',['test']);const permanent=await access.exchange(origin,{ticket:r.ticket,nonce,code:access.view(r.ticket).code});now+=315360000000;assert.equal(access.permits(permanent.token,origin,'test'),true);await access.revoke(permanent.id);assert.equal(access.permits(permanent.token,origin,'test'),false);
});
test('HTTP access denies bypasses; pause retains control and activation without starting Codex while paused',async()=>{
 let enabled=false,starts=0,acknowledged=false,trayStarts=0;const access=createAccess(),control={access,openTray:async()=>{trayStarts++;return {submitted:true};},enabled:()=>enabled,save:async v=>{if('engineEnabled'in v)enabled=v.engineEnabled;if(v.boundaryVersion===1)acknowledged=true;},status:async()=>({settings:{engineEnabled:enabled}})};
 const server=createServer({token:'master-local',refreshMs:0,control,bridgeFactory:()=>{starts++;return {initialize:async()=>{},profile:async()=>({plan:'fixture'}),close(){}};}});server.listen(0,'127.0.0.1');await once(server,'listening');
 const call=(route,body,headers={})=>new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:route,method:body?'POST':'GET',headers:{Host:'127.0.0.1:17322','Content-Type':'application/json',...headers}},res=>{let text='';res.on('data',p=>text+=p);res.on('end',()=>resolve({status:res.statusCode,text,headers:res.headers,json:()=>JSON.parse(text)}));});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);});
 const site={Origin:'https://other.test'},local={Origin:'http://127.0.0.1:17322'},own={Origin:'https://shop.uuco-card.com'},admin={...local,Authorization:'Bearer master-local'};
 try{
  assert.equal((await call('/account',{},site)).status,401);assert.equal((await call('/account',{},own)).json().error,'engine_disabled');assert.equal(starts,0);
  assert.equal((await call('/health',null,own)).json().engine,'disabled');assert.equal((await call('/control/status',{},own)).status,403);
  assert.equal((await call('/control/boundary/ack',{version:1},own)).status,403);assert.equal(acknowledged,false);
  assert.equal((await call('/control/boundary/ack',{version:2},admin)).status,400);assert.equal((await call('/control/boundary/ack',{version:1},admin)).status,200);assert.equal(acknowledged,true);
  assert.equal((await call('/control/tray/open',{},own)).status,403);assert.equal((await call('/control/tray/open',{},site)).status,403);assert.equal(trayStarts,0);
  assert.equal((await call('/control/tray/open',{command:'arbitrary'},admin)).status,400);assert.equal((await call('/control/tray/open',{},admin)).status,200);assert.equal(trayStarts,1);assert.equal(enabled,false);
  assert.equal((await call('/control/records',{},own)).status,403);assert.deepEqual((await call('/control/records',{},admin)).json(),{records:[]});
  assert.equal((await call('/console',null,own)).status,403);assert.equal((await call('/console',null,{'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'cors'})).status,403);
  const page=await call('/console',null,{'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document'});assert.equal(page.status,200);assert.match(page.headers['content-security-policy'],/frame-ancestors 'none'/);assert.equal(page.headers['access-control-allow-origin'],undefined);
  const nonce='a'.repeat(48),p=(await call('/pair/start',{nonce},site)).json();assert.ok(p.ticket);
  assert.equal((await call('/pair/code',{ticket:p.ticket},site)).status,403);assert.equal((await call('/pair/approve',{ticket:p.ticket,duration:300,scopes:['account']},own)).status,403);
  assert.equal((await call('/pair/approve',{ticket:p.ticket,duration:300,scopes:['account']},local)).status,200);
  const code=(await call('/pair/code',{ticket:p.ticket},local)).json().code;const grant=(await call('/pair/exchange',{ticket:p.ticket,nonce,code},site)).json();const headers={...site,Authorization:'Bearer '+grant.token};
  assert.equal((await call('/engine/start',{},headers)).status,401);assert.equal((await call('/engine/start',{},own)).status,200);assert.equal((await call('/account',{},headers)).status,200);
  assert.equal((await call('/models',{},headers)).status,401);assert.equal((await call('/history',{},headers)).status,403);assert.equal((await call('/control/settings',{autoUpdate:false},headers)).status,403);
  assert.equal((await call('/account',{}, {...headers,Origin:'https://wrong.test'})).status,401);
  await call('/control/grants/revoke',{id:grant.id},admin);assert.equal((await call('/account',{},headers)).status,401);
  await call('/control/engine',{enabled:false},admin);const count=starts;assert.equal((await call('/models',{},own)).json().error,'engine_disabled');assert.equal(starts,count);assert.equal((await call('/control/status',{},admin)).status,200);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('revocation blocks an account response that was already in flight',async()=>{
 const access=createAccess(),origin='https://external.test',nonce='a'.repeat(48);const p=access.start(origin,nonce);access.approve(p.ticket,300,['account']);const grant=await access.exchange(origin,{ticket:p.ticket,nonce,code:access.view(p.ticket).code});
 let release,entered;const started=new Promise(r=>entered=r),held=new Promise(r=>release=r);
 const control={access,enabled:()=>true};const server=createServer({token:'master',refreshMs:0,control,bridgeFactory:()=>({initialize:async()=>{},profile:async()=>{entered();await held;return {email:'must-not-leak@example.invalid'};},close(){}})});server.listen(0,'127.0.0.1');await once(server,'listening');
 const post=(route,headers,body={})=>new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:route,method:'POST',headers:{Host:'127.0.0.1:17322','Content-Type':'application/json',...headers}},res=>{let text='';res.on('data',p=>text+=p);res.on('end',()=>resolve({status:res.statusCode,text:async()=>text}));});req.on('error',reject);req.end(JSON.stringify(body));});
 try{const response=post('/account',{Origin:origin,Authorization:'Bearer '+grant.token});await started;await post('/control/grants/revoke',{Origin:'http://127.0.0.1:17322',Authorization:'Bearer master'},{id:grant.id});release();const r=await response;assert.equal(r.status,401);assert.ok(!(await r.text()).includes('must-not-leak'));}
 finally{release();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import {createLocalProfile} from './local-profile.mjs';
import {createServer} from './server.mjs';
import {once} from 'node:events';
test('offline identity and subscription stay local; quota survives restart without crossing accounts',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'biuuka-offline-'));
 const auth=email=>JSON.stringify({tokens:{account_id:email,id_token:'x.'+Buffer.from(JSON.stringify({email,'https://api.openai.com/auth':{chatgpt_plan_type:'plus',chatgpt_subscription_active_until:'2030-01-01'}})).toString('base64url')+'.x',access_token:'private-token'}});
 try{
  await writeFile(path.join(dir,'auth.json'),auth('one@example.test'));
  const reader=createLocalProfile(dir,dir),first=await reader.read();assert.equal(first.plan,'plus');assert.equal(first.limits.length,0);assert.equal(first.subscription.source,'local_login');
  await reader.save({...first,checkedAt:'2026-10-27T00:00:00Z',limits:[{id:'codex',primary:{usedPercent:25,windowDurationMins:300,resetsAt:123},secondary:null}],secret:'must-not-save'});
  const next=await createLocalProfile(dir,dir).read();assert.equal(next.limits[0].primary.usedPercent,25);assert.equal(next.offline,true);assert.equal(next.checkedAt,'2026-10-27T00:00:00Z');
  assert.doesNotMatch(await readFile(path.join(dir,'account-snapshot.json'),'utf8'),/private-token|must-not-save|one@example/);
  await writeFile(path.join(dir,'auth.json'),auth('two@example.test'));assert.equal((await reader.read()).limits.length,0);
  await writeFile(path.join(dir,'config.toml'),'cli_auth_credentials_store = "keyring"');assert.equal(await reader.read(),null);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('network disabled serves local account and history without bridge; engine off remains minimal',async()=>{
 let enabled=true,calls=0;
 const server=createServer({port:17322,token:'fixture',refreshMs:0,control:{enabled:()=>enabled,online:()=>false,settings:()=>({networkEnabled:false})},localProfile:{read:async()=>({email:'fixture',offline:true})},bridgeFactory:()=>{calls++;throw Error('must not start');},records:{list:async()=>[]}});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const request=route=>new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:route,method:'POST',headers:{host:'127.0.0.1:17322',authorization:'Bearer fixture','content-type':'application/json'}},res=>{let data='';res.on('data',v=>data+=v);res.on('end',()=>resolve({status:res.statusCode,json:async()=>JSON.parse(data)}));});req.on('error',reject);req.end('{}');});
 try{assert.equal((await (await request('/account')).json()).offline,true);assert.equal((await request('/records')).status,200);assert.equal((await request('/network')).status,409);assert.equal((await request('/models')).status,409);assert.equal(calls,0);enabled=false;assert.equal((await request('/account')).status,409);}
 finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import http from 'node:http';
import {detectChatGPT,createChatGPTDetector} from '../chatgpt/chatgpt-install.mjs';
import {createServer} from '../core/server.mjs';
test('Mac reads verified bundle metadata and projects no paths or account fields',async()=>{
 const result=await detectChatGPT({platform:'darwin',home:'/fixture',hasFile:async p=>p.startsWith('/Applications'),execute:async file=>file.endsWith('mdfind')?'':JSON.stringify({CFBundleIdentifier:'com.openai.chat',CFBundleShortVersionString:'1.2.3',CFBundleVersion:'45',private:'secret'})});
 assert.equal(result.installed,true);assert.deepEqual(result.versions,[{version:'1.2.3',build:'45',source:'app_bundle'}]);assert.ok(!JSON.stringify(result).includes('secret'));assert.ok(!JSON.stringify(result).includes('/Applications'));
});
test('absence, metadata failure, and unsupported systems remain distinct',async()=>{
 const base={platform:'darwin',execute:async()=>'',hasFile:async()=>false};assert.equal((await detectChatGPT(base)).status,'not_found');
 assert.equal((await detectChatGPT({...base,hasFile:async()=>true})).status,'unknown');
 assert.equal((await detectChatGPT({platform:'linux'})).installed,null);
 const foreign=await detectChatGPT({...base,hasFile:async()=>true,execute:async f=>f.endsWith('mdfind')?'':JSON.stringify({CFBundleIdentifier:'other'})});assert.equal(foreign.installed,false);
});
test('Windows package projection, failures and hidden bounded execution contract',async()=>{
 const value=await detectChatGPT({platform:'win32',execute:async(file,args)=>{assert.ok(file.endsWith('powershell.exe'));assert.ok(args.includes('-NonInteractive'));return JSON.stringify([{name:'OpenAI.ChatGPT-Desktop',version:'1.2.3.4'},{name:'Other',version:'99'}]);}});
 assert.deepEqual(value.versions,[{version:'1.2.3.4',build:null,source:'windows_package'}]);
 assert.equal((await detectChatGPT({platform:'win32',execute:async()=>{throw Error('private path');}})).status,'unknown');
});
test('detector is lazy, coalesces concurrent work, limits bursts, and rescans on later request',async()=>{
 let n=0,time=0,resolve;const detect=createChatGPTDetector({now:()=>time,detect:()=>{n++;return new Promise(r=>{resolve=r;});}});assert.equal(n,0);
 const a=detect(),b=detect();await Promise.resolve();assert.equal(n,1);resolve({installed:true});assert.deepEqual(await a,await b);await assert.rejects(detect(),{code:'rate_limited'});
 time=5000;const c=detect();await Promise.resolve();assert.equal(n,2);resolve({installed:false});assert.equal((await c).installed,false);
});
test('HTTP detection is explicit, validates origin/body, stops while paused, and never starts Codex',async()=>{
 let calls=0,enabled=false;const server=createServer({token:'local',refreshMs:0,control:{enabled:()=>enabled},bridgeFactory:()=>{throw Error('must not start');},chatgptInstall:async()=>{calls++;return {installed:true};}});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const call=(origin,body={},authorization)=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:server.address().port,path:'/device/chatgpt',method:'POST',headers:{Host:'127.0.0.1:17322','Content-Type':'application/json',...(origin?{Origin:origin}:{}),...(authorization?{Authorization:authorization}:{})}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end(JSON.stringify(body));});
 try{assert.equal(calls,0);assert.equal(await call('https://evil.test'),403);assert.equal(await call('https://biuuka.com.evil.test'),403);assert.equal(await call(undefined),403);assert.equal(await call('https://biuuka.com',{path:'/private'}),400);assert.equal(calls,0);assert.equal(await call('https://shop.biuuka.com'),409);assert.equal(calls,0);enabled=true;assert.equal(await call('https://shop.biuuka.com'),200);assert.equal(await call(undefined,{},'Bearer local'),200);assert.equal(calls,2);}finally{await new Promise(r=>server.close(r));}
});

import test from 'node:test';import assert from 'node:assert/strict';
import {createDesktopSwitch} from '../chatgpt/desktop-switch.mjs';
test('custom Codex home blocks desktop control',async()=>{let calls=0;const d=createDesktopSwitch({platform:'darwin',home:'/Users/test',codexHome:'/custom',execute:async()=>{calls++;return {stdout:JSON.stringify({id:'com.openai.codex',bundle:'/Applications/Codex.app'})};}});await assert.rejects(d.inspect(),/desktop_custom_home/);assert.equal(calls,1);});
test('errors never return native paths or process details',async()=>{const d=createDesktopSwitch({platform:'darwin',execute:async()=>{throw {stderr:'/Users/private desktop_stop_failed'};}});await assert.rejects(d.stop({}),e=>e.code==='desktop_stop_failed'&&!e.message.includes('private'));});

import {EventEmitter} from 'node:events';import {PassThrough,Writable} from 'node:stream';
function processFixture(respond){const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.kill=()=>c.emit('exit',1);c.stdin=new Writable({write(data,enc,done){const q=JSON.parse(data);respond(q,c);done();},final(done){c.emit('exit',0);done();}});return c;}
test('Windows reuses one bounded hidden process and closes before next transaction',async()=>{
 const calls=[],requests=[];const d=createDesktopSwitch({platform:'win32',home:'C:\\fixture',codexHome:'C:\\fixture\\.codex',spawnProcess:(file,args,options)=>{calls.push({file,args,options});return processFixture((q,c)=>{requests.push(q.action);c.stdout.write(JSON.stringify({id:q.id,result:q.action==='inspect'?{exe:'C:\\OpenAI\\ChatGPT.exe'}:{window:'foreground'}})+'\n');});}});
 const app=await d.inspect();await d.stop(app);assert.equal((await d.start(app)).window,'foreground');await d.close();assert.equal(calls.length,1);assert.deepEqual(requests,['inspect','stop','start']);assert.equal(calls[0].options.windowsHide,true);assert.equal(calls[0].args.at(-1),'session');await d.inspect();await d.close();assert.equal(calls.length,2);
});
test('Windows rejects mismatched response IDs and timeouts without accepting a late launch',async()=>{
 for(const behavior of ['wrong','timeout']){let c;const d=createDesktopSwitch({platform:'win32',requestTimeout:20,spawnProcess:()=>c=processFixture((q,p)=>{if(behavior==='wrong')p.stdout.write(JSON.stringify({id:q.id+1,result:{}})+'\n');})});await assert.rejects(d.inspect(),/desktop_inspect_failed/);await assert.rejects(d.start({}),/desktop_inspect_failed/);await d.close();}
});

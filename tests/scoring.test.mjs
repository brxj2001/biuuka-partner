import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,readFile,mkdir,writeFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import{Records}from'../chatgpt/records.mjs';import{createScoring,scoringInput}from'../chatgpt/scoring.mjs';
const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="20" cy="50" r="10"/></svg>',remoteId='11111111-1111-1111-1111-111111111111';
async function fixture(fetcher,options={}){const state=await mkdtemp(path.join(os.tmpdir(),'biuuka-score-')),records=new Records(state);let online=true;const service=createScoring({state,records,online:()=>online,fetcher,...options});const record=await records.begin({preset:'pelican'});Object.assign(record,{status:'complete',saved:true,threadId:'fixture-thread',answer:svg});await records.put(record);return {state,records,service,record,offline:()=>online=false,online:()=>online=true,close:()=>rm(state,{recursive:true,force:true})};}
import http from 'node:http';import{once}from'node:events';import{createServer}from'../core/server.mjs';
test('SVG extraction refuses HTML/CSS substitution and active/external content',()=>{assert.equal(scoringInput('```svg\n'+svg+'\n```').svg,svg);for(const text of ['<html><canvas/></html>','<style>svg{opacity:0}</style>'+svg,svg.replace('<circle','<script/><circle'),svg.replace('<circle','<image href="https://example.invalid/x"/><circle')])assert.throws(()=>scoringInput(text));});
test('quoted local gradient references are allowed; external CSS URLs remain rejected',()=>{assert.doesNotThrow(()=>scoringInput(svg.replace('<circle','<style>.a{fill:url("#gradient")}</style><circle')));assert.throws(()=>scoringInput(svg.replace('<circle','<style>.a{fill:url("https://example.invalid/a")}</style><circle')));});

test('XML serialized local CSS references remain local after quote decoding',()=>{
 assert.doesNotThrow(()=>scoringInput(svg.replace('<circle','<g style="fill:url(&quot;#paint&quot;)"></g><circle')));
 assert.throws(()=>scoringInput(svg.replace('<circle','<g style="fill:url(&quot;https://example.invalid/a&quot;)"></g><circle')),{code:'score_unsafe_svg'});
});

test('visual handoff is scoped, expires, survives a new ticket without replay, and cannot regress completion',async()=>{
 let time=0;const f=await fixture(()=>{throw Error('must not call third party');},{now:()=>time});try{
 const first=await f.service.visualStart({id:f.record.id});const input=await f.service.visualInput(first);
 assert.equal(input.svg,svg);assert.deepEqual(Object.keys(input).sort(),['requestKey','svg']);
 await assert.rejects(f.service.visualInput({ticket:'forged'}),{code:'score_ticket_expired'});
 const second=await f.service.visualStart({id:f.record.id});assert.equal((await f.service.visualInput(second)).requestKey,input.requestKey);
 await assert.rejects(f.service.visualInput(first),{code:'score_ticket_expired'});
 await assert.rejects(f.service.visualAccept({...second,value:{requestKey:remoteId,status:'pending'}}),{code:'score_ticket_expired'});
 const checklist=Object.fromEntries(['subject_recognisable','vehicle_recognisable','riding_posture','coherent_figure','subject_feature_0','subject_feature_1','vehicle_feature_0','vehicle_feature_1','vehicle_feature_2'].map(k=>[k,true]));
 await f.service.visualAccept({...second,value:{requestKey:input.requestKey,status:'completed',result:{mode:'vision',judged:true,gatePassed:true,score:100,breakdown:{judged:true,structure_score:1,semantic_score:1,judge:{checklist,caption:'fixture'}}}}});
 await f.service.visualAccept({...second,value:{requestKey:input.requestKey,status:'pending'}});assert.equal((await f.service.list(f.record.id)).scores[0].status,'completed');
 time=900001;await assert.rejects(f.service.visualInput(second),{code:'score_ticket_expired'});
 const third=await f.service.visualStart({id:f.record.id});f.offline();await assert.rejects(f.service.visualInput(third),{code:'network_disabled'});
 }finally{await f.close();}
});
test('visual bridge accepts only exact mall origin and explicit ticket, never broad control',async()=>{
 const f=await fixture(()=>{throw Error('no remote');});const ticket=await f.service.visualStart({id:f.record.id});const server=createServer({token:'fixture',refreshMs:0,control:{enabled:()=>true,networkEnabled:()=>true},scoring:f.service});server.listen(0,'127.0.0.1');await once(server,'listening');
 async function send(origin,body){return new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:server.address().port,path:'/visual-score/input',method:'POST',headers:{Host:'127.0.0.1:17322','Content-Type':'application/json',...(origin?{Origin:origin}:{})}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end(JSON.stringify(body));});}
 try{for(const origin of [undefined,'https://evil.invalid','https://biuuka.com.evil.invalid','https://shop.biuuka.com'])assert.equal(await send(origin,ticket),403);assert.equal(await send('https://biuuka.com',{ticket:'bad'}),400);assert.equal(await send('https://biuuka.com',{...ticket,id:f.record.id}),400);assert.equal(await send('https://biuuka.com',ticket),200);await f.service.remove(f.record.id);await assert.rejects(f.service.visualInput(ticket),{code:'score_ticket_expired'});}finally{server.closeAllConnections();await new Promise(r=>server.close(r));await f.close();}
});
test('anonymous visual score keeps CSRF but never sends an account or obeys third-party cooldown; queries do not repost',async()=>{
 const calls=[];let key;
 const f=await fixture(async(url,o)=>{calls.push({url,o});if(url.endsWith('/csrf'))return Response.json({data:{headerName:'X-CSRF-TOKEN',token:'fixture'}},{headers:{'Set-Cookie':'BIUUKA_SESSION=anonymous; Path=/; HttpOnly'}});
 if(o.method==='POST'){const body=JSON.parse(o.body);key=body.requestKey;assert.deepEqual(Object.keys(body).sort(),['requestKey','svg']);assert.equal(o.headers.Cookie,'BIUUKA_SESSION=anonymous');assert.equal(o.headers['X-CSRF-TOKEN'],'fixture');}
 return Response.json({data:{requestKey:key,status:'pending'}});});
 try{await f.service.visualSubmit({id:f.record.id});await f.service.visualRefresh({id:f.record.id});await f.service.visualSubmit({id:f.record.id});assert.equal(calls.filter(c=>c.o.method==='POST').length,1);assert.equal(calls.length,4);f.offline();await assert.rejects(f.service.visualRefresh({id:f.record.id}),{code:'network_disabled'});}finally{await f.close();}
});
test('old unsubmitted placeholders migrate only after absence is confirmed, old accepted jobs are never resubmitted',async()=>{
 let found=false,posts=0;const f=await fixture(async(url,o)=>{if(o.method==='POST')posts++;return found?Response.json({data:{requestKey:key,status:'legacy'}}):Response.json({}, {status:404});});let key;
 try{const ticket=await f.service.visualStart({id:f.record.id});key=(await f.service.visualInput(ticket)).requestKey;found=true;assert.equal((await f.service.visualRefresh({id:f.record.id})).legacy,true);found=false;assert.equal((await f.service.visualRefresh({id:f.record.id})).status,'not_submitted');assert.equal(posts,0);}finally{await f.close();}
});

test('retired third-party files and cooldowns are hidden and cannot trigger network requests',async()=>{
 let calls=0;const f=await fixture(async()=>{calls++;throw Error('unexpected request');});
 try{await mkdir(path.join(f.state,'scores'),{recursive:true});const file=path.join(f.state,'scores',f.record.id+'-pelicanscore.json');await writeFile(file,'legacy incomplete JSON');await writeFile(path.join(f.state,'scores','pelicanscore-cooldown.json'),'legacy incomplete JSON');assert.deepEqual(await f.service.list(f.record.id),{scores:[]});f.offline();assert.equal((await f.service.export({id:f.record.id})).svg,svg);assert.equal(calls,0);assert.equal(await readFile(file,'utf8'),'legacy incomplete JSON');assert.equal(f.service.submit,undefined);assert.equal(f.service.refresh,undefined);assert.equal(f.service.connection,undefined);await f.service.remove(f.record.id);await assert.rejects(readFile(file),{code:'ENOENT'});}finally{await f.close();}
});
test('retired routes reject even authorized local clients without calling a provider',async()=>{
 let calls=0;const scoring={submit:async()=>{calls++;},refresh:async()=>{calls++;},connection:async()=>{calls++;}};
 const server=createServer({token:'fixture',refreshMs:0,control:{enabled:()=>false},scoring});server.listen(0,'127.0.0.1');await once(server,'listening');
 try{for(const action of ['submit','refresh','connection','import','visualSubmit','visualRefresh','visualStart']){const status=await new Promise((resolve,reject)=>{const r=http.request({host:'127.0.0.1',port:server.address().port,path:'/control/scoring/'+action,method:'POST',headers:{Host:'127.0.0.1:17322',Authorization:'Bearer fixture','Content-Type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});r.on('error',reject);r.end('{}');});assert.equal(status,400);}assert.equal(calls,0);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('disabling network aborts in-flight Biuuka scoring and preserves the unknown request',async()=>{let started;const ready=new Promise(r=>started=r);const f=await fixture(async(_url,o)=>{started();return new Promise((_resolve,reject)=>o.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));});try{const task=f.service.visualSubmit({id:f.record.id});await ready;f.offline();await assert.rejects(task,{code:'network_disabled'});assert(f.service.idle());assert.equal((await f.service.list(f.record.id)).scores[0].status,'unknown');}finally{await f.close();}});

test('missing task after an uncertain submit returns a clean ready state, then explicit confirmation submits the same key',async()=>{
 let posts=0,key;const f=await fixture(async(url,o)=>{
  if(url.endsWith('/csrf'))return Response.json({data:{headerName:'X-CSRF-TOKEN',token:'fixture'}},{headers:{'Set-Cookie':'BIUUKA_SESSION=anonymous; Path=/'}});
  if(o.method==='POST'){posts++;const sent=JSON.parse(o.body);if(!key)key=sent.requestKey;assert.equal(sent.requestKey,key);if(posts===1)throw Error('connection lost before acceptance');return Response.json({data:{requestKey:key,status:'pending'}});}
  return posts===1?Response.json({}, {status:404}):Response.json({data:{requestKey:key,status:'pending'}});
 });
 try{await assert.rejects(f.service.visualSubmit({id:f.record.id}),{code:'score_connection_failed'});assert.equal((await f.service.list(f.record.id)).scores[0].status,'unknown');
 const recovered=await f.service.visualRefresh({id:f.record.id});assert.equal(recovered.status,'not_submitted');assert.equal(recovered.message,'');assert.equal(posts,1);
 assert.equal((await f.service.visualRefresh({id:f.record.id})).status,'not_submitted');assert.equal(posts,1);
 assert.equal((await f.service.visualSubmit({id:f.record.id})).status,'pending');assert.equal(posts,2);await f.service.visualSubmit({id:f.record.id});assert.equal(posts,2);
 }finally{await f.close();}
});
test('explicit confirmation of an old local placeholder checks absence and submits without a second confirmation',async()=>{
 let posts=0,key;const f=await fixture(async(url,o)=>{if(url.endsWith('/csrf'))return Response.json({data:{headerName:'X-CSRF-TOKEN',token:'fixture'}},{headers:{'Set-Cookie':'BIUUKA_SESSION=anonymous; Path=/'}});if(o.method==='POST'){posts++;assert.equal(JSON.parse(o.body).requestKey,key);return Response.json({data:{requestKey:key,status:'pending'}});}return Response.json({}, {status:404});});
 try{const t=await f.service.visualStart({id:f.record.id});key=(await f.service.visualInput(t)).requestKey;assert.equal((await f.service.visualSubmit({id:f.record.id})).status,'pending');assert.equal(posts,1);}finally{await f.close();}
});
test('an upload rejected with 413 is not an accepted scoring task',async()=>{
 const f=await fixture(async(url)=>url.endsWith('/csrf')?Response.json({data:{headerName:'X-CSRF-TOKEN',token:'fixture'}},{headers:{'Set-Cookie':'BIUUKA_SESSION=anonymous; Path=/'}}):Response.json({}, {status:413}));
 try{await assert.rejects(f.service.visualSubmit({id:f.record.id}),{code:'score_upload_too_large'});const s=(await f.service.list(f.record.id)).scores[0];assert.equal(s.status,'not_submitted');assert.equal(s.message,'score_upload_too_large');}finally{await f.close();}
});

const csrf=()=>Response.json({data:{headerName:'X-CSRF-TOKEN',token:'fixture'}},{headers:{'Set-Cookie':'BIUUKA_SESSION=anonymous; Path=/'}});
test('automatic worker survives restart, pauses offline and never reposts a pending request',async()=>{
 let posts=0,gets=0,key,time=0;
 const fetcher=async(url,o)=>{if(url.endsWith('/csrf'))return csrf();if(o.method==='POST'){posts++;key=JSON.parse(o.body).requestKey;}else gets++;return Response.json({data:{requestKey:key,status:'pending'}});};
 const f=await fixture(fetcher,{now:()=>time});
 try{await f.records.put({...f.record,autoScore:true});f.offline();await f.service.runPending();assert.equal(posts,0);f.online();await Promise.all([f.service.runPending(),f.service.runPending()]);assert.equal(posts,1);
 const restarted=createScoring({state:f.state,records:f.records,online:()=>true,fetcher,now:()=>time});await restarted.runPending();assert.equal(gets,0);time=5001;await restarted.runPending();assert.equal(gets,1);assert.equal(posts,1);
 }finally{await f.close();}
});
test('automatic worker excludes historical, imported, incomplete and unsaved tests',async()=>{
 let calls=0;const f=await fixture(async()=>{calls++;throw Error('unexpected');});
 try{for(const patch of [{},{autoScore:true,preset:'pelican-svg',origin:'svg-import'},{autoScore:true,status:'failed'},{autoScore:true,saved:false},{autoScore:true,preset:'candy'}]){await f.records.put({...f.record,...patch});await f.service.runPending();}assert.equal(calls,0);
 await f.records.put({...f.record,autoScore:true,answer:'<html><canvas/></html>'});await f.service.runPending();assert.equal((await f.service.list(f.record.id)).scores[0].status,'failed');assert.equal(calls,0);
 }finally{await f.close();}
});
test('unknown automatic upload queries before retrying the same key after confirmed absence',async()=>{
 let time=0,posts=0,key;const calls=[];
 const f=await fixture(async(url,o)=>{if(url.endsWith('/csrf'))return csrf();calls.push(o.method);if(o.method==='POST'){posts++;const sent=JSON.parse(o.body);if(key)assert.equal(sent.requestKey,key);key=sent.requestKey;if(posts===1)throw Error('unknown');return Response.json({data:{requestKey:key,status:'pending'}});}return Response.json({}, {status:404});},{now:()=>time});
 try{await f.records.put({...f.record,autoScore:true});await f.service.runPending();time=60001;await f.service.runPending();assert.equal(posts,1);time=300001;await f.service.runPending();assert.equal(posts,2);assert.deepEqual(calls,['POST','GET','POST']);}finally{await f.close();}
});

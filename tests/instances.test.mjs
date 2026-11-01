import test from 'node:test';import assert from 'node:assert/strict';
import {macRows,summarize,detectInstances,createInstanceDetector} from '../chatgpt/instances.mjs';
test('desktop helpers, descendants and partner queries are not additional instances',()=>{
 const rows=[{pid:1,parent:0},{pid:20,parent:1,kind:'chatgpt'},{pid:21,parent:20,kind:'chatgpt'},{pid:30,parent:1,kind:'chatgpt'},{pid:31,parent:30,kind:'codex-cli'},{pid:40,parent:1,kind:'codex-cli'},{pid:41,parent:40,kind:'codex-cli'},{pid:50,parent:1},{pid:51,parent:50},{pid:52,parent:51,kind:'codex-cli'}];
 assert.deepEqual(summarize(rows,50),{instances:[{pid:20,kind:'chatgpt',name:'ChatGPT'},{pid:30,kind:'chatgpt',name:'ChatGPT'},{pid:40,kind:'codex-cli',name:'Codex CLI'}],counts:{chatgpt:2,codexCli:1}});
});
test('macOS distinguishes applications, helpers, CLI and other users without arguments',()=>{
 const rows=macRows('-2 2 1 /usr/sbin/system-service\n501 20 1 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT\n501 30 1 /Applications/Codex.app/Contents/MacOS/Codex\n501 31 30 /Applications/Codex.app/Contents/Frameworks/Codex Helper.app/Contents/MacOS/Codex Helper\n501 40 1 /path with spaces/codex\n502 50 1 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT',501);
 assert.deepEqual(summarize(rows,99).counts,{chatgpt:2,codexCli:1});
 assert.throws(()=>macRows('truncated',501));assert.throws(()=>summarize([{pid:1,parent:1,kind:'codex-cli'}],99));
});
test('failure is unknown, unsupported is explicit and no raw paths escape',async()=>{
 const fail=await detectInstances({platform:'darwin',execute:async()=>{throw Error('private /path');}});assert.equal(fail.status,'unknown');assert.equal(fail.counts,null);assert.ok(!JSON.stringify(fail).includes('private'));
 assert.equal((await detectInstances({platform:'linux'})).status,'unsupported');
 let args;const win=await detectInstances({platform:'win32',execute:async(file,a)=>{args=a;return JSON.stringify({partial:true,rows:[{pid:33,parent:0,kind:'chatgpt',path:'private'}]});}});
 assert.equal(win.status,'partial');assert.equal(win.counts.chatgpt,1);assert.ok(!JSON.stringify(win).includes('private'));assert.ok(args.includes('-File'));
});
test('concurrent calls coalesce and cache for five seconds',async()=>{let calls=0,now=0;const read=createInstanceDetector({detect:async()=>({value:++calls}),now:()=>now});await Promise.all([read(),read()]);await read();assert.equal(calls,1);now=5000;await read();assert.equal(calls,2);});

test('renamed macOS bundles use application identity and executable, not display name',async()=>{
 const commands=[];const result=await detectInstances({platform:'darwin',uid:501,ownPid:999,execute:async(file,args)=>{
  commands.push(file);
  if(file==='/bin/ps')return '501 20 1 /Applications/Work Copy.app/Contents/MacOS/Renamed\n501 30 1 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT\n501 40 1 /Applications/Fake.app/Contents/MacOS/ChatGPT';
  return JSON.stringify(args.at(-1).includes('Work Copy')?{CFBundleIdentifier:'com.openai.codex',CFBundleExecutable:'Renamed'}:args.at(-1).includes('Fake')?{CFBundleIdentifier:'org.example.fake',CFBundleExecutable:'ChatGPT'}:{CFBundleIdentifier:'com.openai.chat',CFBundleExecutable:'ChatGPT'});
 }});assert.equal(result.status,'available');assert.equal(result.counts.chatgpt,2);assert.equal(result.instances[0].name,'Work Copy');assert.ok(commands.every(c=>['/bin/ps','/usr/bin/plutil'].includes(c)));
});

import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat,symlink} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createAccounts,identity,needsTokenRefresh} from '../chatgpt/accounts.mjs';
const credential=name=>JSON.stringify({auth_mode:'chatgpt',tokens:{id_token:'e30.'+Buffer.from(JSON.stringify({email:name+'@example.test','https://api.openai.com/auth':{chatgpt_account_id:name,chatgpt_plan_type:'plus'}})).toString('base64url')+'.sig',access_token:'secret-access-'+name,refresh_token:'secret-refresh-'+name,account_id:name}});
async function fixture(fn,options={}){const state=await mkdtemp(path.join(os.tmpdir(),'biuuka-accounts-')),native=path.join(state,'codex');await mkdir(native);const file=path.join(native,'auth.json');await writeFile(file,credential('first'));let online=true,failNative=false,loginBridge,failCleanup=false,requestHang=false,nativeHang=false,profileThrows=false;
 const bridgeFactory=home=>{const b={listeners:new Set(),account:null,close(){},async closeAndWait(){await options.onBridgeClose?.(home);this.close();},async finish(){},async initialize({requireLogin=true}={}){if(requireLogin){if(requestHang)await new Promise(()=>{});if(nativeHang&&home===native)await new Promise(()=>{});if(failNative&&home===native)throw Error('fixture failure secret');this.account={type:'chatgpt',email:identity(await readFile(path.join(home,'auth.json'),'utf8')).email};if(options.onAccountRead){this.account=(await options.onAccountRead(home,{refreshToken:false},this)).account;if(!this.account)throw Object.assign(Error('chatgpt_login_required'),{code:'chatgpt_login_required'});}}},async profile(){if(profileThrows)throw Error('profile must not run during switch');return {email:this.account.email,plan:'plus',limits:[],limitsStatus:'unavailable'};},async request(method,params){if(method==='account/read'&&options.onAccountRead)return options.onAccountRead(home,params,this);if(method==='account/read'&&requestHang)return new Promise(()=>{});if(method==='account/read')return {account:{type:'chatgpt',email:this.account.email}};if(method==='account/login/start'){loginBridge={b,home};return {authUrl:'https://auth.openai.com/authorize?fixture=true',loginId:'fixture'};}}};return b;};
 const accounts=createAccounts({...options,state,codexHome:native,bridgeFactory,online:()=>online,cleanup:async dir=>{if(failCleanup)throw Object.assign(Error('fixture locked file'),{code:'EBUSY'});await rm(dir,{recursive:true,force:true});}});try{await fn({setRequestHang:v=>requestHang=v,setNativeHang:v=>nativeHang=v,setProfileThrows:v=>profileThrows=v,setCleanupFailure:v=>failCleanup=v,accounts,state,native,file,setOnline:v=>online=v,setFail:v=>failNative=v,getLogin:()=>loginBridge});}finally{await accounts.close();await rm(state,{recursive:true,force:true});}}
test('import/list only expose identity; protected files persist and current deletion is rejected',()=>fixture(async({accounts,state})=>{await accounts.importCurrent();const d=await accounts.list();assert.equal(d.accounts.length,1);assert.equal(d.accounts[0].current,true);assert.ok(!JSON.stringify(d).includes('secret'));if(process.platform!=='win32')assert.equal((await stat(path.join(state,'accounts',d.current,'auth.json'))).mode&0o777,0o600);await assert.rejects(accounts.remove(d.current),/current_account/);await assert.rejects(accounts.refresh('../codex'),/invalid_account/);}));
test('switch preserves previous account, updates native login, leaves sessions alone',()=>fixture(async({accounts,native,file})=>{await accounts.importCurrent();await writeFile(file,credential('second'));await accounts.importCurrent();await writeFile(path.join(native,'session-fixture'),'keep');const first=identity(credential('first')).id;await accounts.switchTo(first);assert.equal(identity(await readFile(file,'utf8')).id,first);assert.equal((await accounts.list()).accounts.length,2);assert.equal(await readFile(path.join(native,'session-fixture'),'utf8'),'keep');}));
test('failed verification restores previous native bytes and does not leak error',()=>fixture(async({accounts,file,setFail})=>{await accounts.importCurrent();const second=credential('second');await writeFile(file,second);setFail(true);await assert.rejects(accounts.switchTo(identity(credential('first')).id),/switch_verification_failed/);assert.equal(await readFile(file,'utf8'),second);}));
test('offline import/list/rename work but remote refresh/switch do not',()=>fixture(async({accounts,setOnline})=>{setOnline(false);await accounts.importCurrent();const id=(await accounts.list()).current;await accounts.rename(id,'个人账号');assert.equal((await accounts.list()).accounts[0].name,'个人账号');await assert.rejects(accounts.refresh(id),/network_disabled/);await assert.rejects(accounts.switchTo(id),/network_disabled/);}));
test('keyring store is not overwritten or silently migrated',()=>fixture(async({accounts,native,file})=>{const before=await readFile(file,'utf8');await writeFile(path.join(native,'config.toml'),'cli_auth_credentials_store = "keyring"');await assert.rejects(accounts.importCurrent(),/credential_store_unsupported/);assert.equal(await readFile(file,'utf8'),before);}));
test('official login stays isolated; completion saves account without switching native',()=>fixture(async({accounts,file,getLogin})=>{await accounts.startLogin();assert.equal((await accounts.list()).login.status,'pending');await assert.rejects(accounts.importCurrent(),/accounts_busy/);const {b,home}=getLogin();await writeFile(path.join(home,'auth.json'),credential('second'));for(const listener of b.listeners)listener({method:'account/login/completed',params:{success:true}});for(let i=0;i<50&&!accounts.idle();i++)await new Promise(r=>setTimeout(r,10));assert.equal((await accounts.list()).accounts[0].email,'second@example.test');assert.equal(identity(await readFile(file,'utf8')).email,'first@example.test');}));
test('cancel removes pending login, no persistent imported account',()=>fixture(async({accounts,getLogin})=>{await accounts.startLogin();const {home}=getLogin();await accounts.cancel();await assert.rejects(stat(home),{code:'ENOENT'});assert.equal((await accounts.list()).accounts.length,0);}));
test('account directory links cannot redirect credential reads/writes',()=>fixture(async({accounts,state,native})=>{await accounts.importCurrent();const id=(await accounts.list()).current,dir=path.join(state,'accounts',id);await rm(dir,{recursive:true});await symlink(native,dir,process.platform==='win32'?'junction':'dir');await assert.rejects(accounts.importCurrent(),/unsafe_account_file/);}));

test('refreshing saved accounts persists each result without switching the native identity',()=>fixture(async({accounts,file})=>{
 await accounts.importCurrent();await writeFile(file,credential('second'));await accounts.importCurrent();
 for(const account of (await accounts.list()).accounts)await accounts.refresh(account.id);
 const result=await accounts.list();assert.equal(result.accounts.length,2);
 for(const account of result.accounts){assert.equal(account.profile.email,account.email);assert.ok(Number.isFinite(Date.parse(account.checkedAt)));}
 assert.equal(await readFile(file,'utf8'),credential('second'));assert.ok(!JSON.stringify(result).includes('secret'));
}));

test('cancel during initialization prevents a later quota request or cache write',()=>{
 let entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 return fixture(async({accounts,setProfileThrows})=>{
  await accounts.importCurrent();const id=(await accounts.list()).current;setProfileThrows(true);
  const refresh=accounts.refresh(id);await started;await accounts.cancel();release();
  await assert.rejects(refresh,/cancelled/);assert.equal((await accounts.list()).accounts[0].checkedAt,null);
 },{onAccountRead:async(home,params,b)=>{entered();await gate;return {account:b.account};}});
});
test('account management is local-master only, including trusted storefronts',async()=>{
 const {createServer}=await import('../core/server.mjs'),{once}=await import('node:events'),http=await import('node:http');let calls=0;
 const server=createServer({token:'fixture',port:17322,refreshMs:0,control:{enabled:()=>true,online:()=>true},accounts:{list:async()=>{calls++;return {accounts:[]};},idle:()=>true,close:async()=>{}},bridgeFactory:()=>{throw Error('unused');}});
 server.listen(0,'127.0.0.1');await once(server,'listening');const call=(origin,token)=>new Promise((resolve,reject)=>{const r=http.request({hostname:'127.0.0.1',port:server.address().port,path:'/control/accounts/list',method:'POST',headers:{Host:'127.0.0.1:17322',Origin:origin,Authorization:'Bearer '+token,'Content-Type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});r.on('error',reject);r.end('{}');});
 try{assert.equal(await call('https://biuuka.com','fixture'),403);assert.equal(await call('http://127.0.0.1:17322','wrong'),403);assert.equal(calls,0);assert.equal(await call('http://127.0.0.1:17322','fixture'),200);assert.equal(calls,1);}finally{await new Promise(r=>server.close(r));}
});

async function settled(accounts){for(let i=0;i<100&&!accounts.idle();i++)await new Promise(r=>setTimeout(r,10));assert.equal(accounts.idle(),true);}
test('successful OAuth survives locked cleanup directory and retains saved account after reopen',()=>fixture(async({accounts,state,native,file,getLogin,setCleanupFailure})=>{
 await accounts.startLogin();const {b,home}=getLogin();await writeFile(path.join(home,'auth.json'),credential('second'));setCleanupFailure(true);
 b.close=()=>{for(const listener of b.listeners)listener({method:'__closed'});};
 for(const listener of b.listeners)listener({method:'account/login/completed',params:{success:true}});
 await settled(accounts);const d=await accounts.list();assert.equal(d.login.status,'complete');assert.equal(d.login.cleanupPending,true);assert.equal(d.accounts.length,1);
 const reopened=createAccounts({state,codexHome:native});assert.equal((await reopened.list()).accounts[0].email,'second@example.test');assert.equal(identity(await readFile(file,'utf8')).email,'first@example.test');
}));
test('process shutdown failure cannot erase a successful OAuth login',()=>fixture(async({accounts,getLogin})=>{
 await accounts.startLogin();const {b,home}=getLogin();await writeFile(path.join(home,'auth.json'),credential('second'));b.finish=async()=>{throw Error('shutdown_unconfirmed');};
 for(const listener of b.listeners){listener({method:'account/login/completed',params:{success:true}});listener({method:'account/login/completed',params:{success:true}});}
 await settled(accounts);assert.equal((await accounts.list()).login.status,'complete');assert.equal((await accounts.list()).accounts.length,1);
}));
test('cancellation cleanup failure is contained and releases the operation lock',()=>fixture(async({accounts,getLogin,setCleanupFailure})=>{
 await accounts.startLogin();const {b}=getLogin();b.close=()=>{for(const listener of b.listeners)listener({method:'__closed'});};setCleanupFailure(true);await accounts.cancel();assert.equal(accounts.idle(),true);assert.equal((await accounts.list()).login.status,'cancelled');await accounts.importCurrent();
}));
test('failed callback and synchronous close notification do not recurse',()=>fixture(async({accounts,getLogin})=>{
 await accounts.startLogin();const {b}=getLogin();let closed=0;b.close=()=>{closed++;for(const listener of b.listeners)listener({method:'__closed'});};for(const listener of b.listeners)listener({method:'account/login/completed',params:{success:false}});await settled(accounts);assert.equal(closed,1);assert.equal((await accounts.list()).login.status,'failed');
}));

test('switch verifies auth without waiting for quota or billing queries',()=>fixture(async({accounts,file,setProfileThrows})=>{
 await accounts.importCurrent();await writeFile(file,credential('second'));setProfileThrows(true);await accounts.switchTo(identity(credential('first')).id);assert.equal(identity(await readFile(file,'utf8')).email,'first@example.test');
}));
test('hung target auth times out, preserves native account, and releases lock',()=>fixture(async({accounts,file,setRequestHang})=>{
 await accounts.importCurrent();await writeFile(file,credential('second'));setRequestHang(true);await assert.rejects(accounts.switchTo(identity(credential('first')).id),/account_timeout/);assert.equal(identity(await readFile(file,'utf8')).email,'second@example.test');assert.equal(accounts.idle(),true);assert.equal((await accounts.list()).operation,null);
},{operationTimeout:40}));
test('hung native verification rolls back within deadline instead of hanging',()=>fixture(async({accounts,file,setNativeHang})=>{
 await accounts.importCurrent();await writeFile(file,credential('second'));setNativeHang(true);await assert.rejects(accounts.switchTo(identity(credential('first')).id),/switch_verification_failed/);assert.equal(identity(await readFile(file,'utf8')).email,'second@example.test');assert.equal(accounts.idle(),true);
},{operationTimeout:40}));

test('desktop stop happens before auth commit and launch after verification',()=>{
 const events=[];let nativeFile;
 const desktop={inspect:async()=>({running:true}),stop:async()=>{events.push('stop');assert.equal(identity(await readFile(nativeFile,'utf8')).email,'second@example.test');},start:async()=>{events.push('start');assert.equal(identity(await readFile(nativeFile,'utf8')).email,'first@example.test');}};
 return fixture(async({accounts,file})=>{nativeFile=file;await accounts.importCurrent();await writeFile(file,credential('second'));const result=await accounts.switchTo(identity(credential('first')).id);assert.deepEqual(events,['stop','start']);assert.equal(result.desktop,'restarted');},{desktop});
});
test('desktop refusing to close never overwrites login or launches another client',()=>{
 const desktop={inspect:async()=>({running:true}),stop:async()=>{throw Object.assign(Error('desktop_stop_failed'),{code:'desktop_stop_failed'});},start:async()=>assert.fail('must not start')};
 return fixture(async({accounts,file})=>{await accounts.importCurrent();await writeFile(file,credential('second'));await assert.rejects(accounts.switchTo(identity(credential('first')).id),/desktop_stop_failed/);assert.equal(identity(await readFile(file,'utf8')).email,'second@example.test');},{desktop});
});
test('launch failure preserves switched login and permits same-account retry',()=>{
 let fail=true;const desktop={inspect:async()=>({running:true}),stop:async()=>{},start:async()=>{if(fail)throw Error('launch');}};
 return fixture(async({accounts,file})=>{await accounts.importCurrent();await writeFile(file,credential('second'));const id=identity(credential('first')).id;await assert.rejects(accounts.switchTo(id),/desktop_start_failed/);assert.equal(identity(await readFile(file,'utf8')).id,id);assert.equal((await accounts.list()).switchResult.status,'start_failed');fail=false;assert.equal((await accounts.switchTo(id)).desktop,'restarted');},{desktop});
});
test('failed native verification restores old login before reopening original desktop',()=>{
 let nativeFile;const desktop={inspect:async()=>({running:true}),stop:async()=>{},start:async()=>assert.equal(identity(await readFile(nativeFile,'utf8')).email,'second@example.test')};
 return fixture(async({accounts,file,setFail})=>{nativeFile=file;await accounts.importCurrent();await writeFile(file,credential('second'));setFail(true);await assert.rejects(accounts.switchTo(identity(credential('first')).id),/switch_verification_failed/);},{desktop});
});

test('switch waits for verification bridge exit before desktop control and reopening',()=>{
 const events=[];
 const desktop={inspect:async()=>{events.push('inspect');return {running:true};},stop:async()=>events.push('stop'),start:async()=>events.push('start')};
 return fixture(async({accounts,file})=>{await accounts.importCurrent();await writeFile(file,credential('second'));await accounts.switchTo(identity(credential('first')).id);assert.deepEqual(events,['inspect','bridge-exited','stop','bridge-exited','start']);},{desktop,onBridgeClose:async()=>{await new Promise(resolve=>setTimeout(resolve,5));events.push('bridge-exited');}});
});

test('successive switches and same-account retry do not force refresh valid saved credentials',()=>{
 const reads=[];
 return fixture(async({accounts,file})=>{
  await accounts.importCurrent();await writeFile(file,credential('second'));await accounts.importCurrent();
  for(const name of ['first','second','second','first']){await accounts.switchTo(identity(credential(name)).id);assert.equal(identity(await readFile(file,'utf8')).id,identity(credential(name)).id);assert.equal(accounts.idle(),true);}
  assert.equal(reads.length,8);
 },{onAccountRead:async(home,params,b)=>{reads.push(home);return {account:params.refreshToken&&reads.length>1?null:{type:'chatgpt',email:b.account.email}};}});
});
test('failed desktop stop and failed start each permit a later switch with the same credentials',()=>{
 let failure='stop';
 const desktop={inspect:async()=>({running:true}),stop:async()=>{if(failure==='stop')throw Object.assign(Error('desktop_stop_failed'),{code:'desktop_stop_failed'});},start:async()=>{if(failure==='start')throw Error('fixture start');}};
 return fixture(async({accounts,file})=>{
  await accounts.importCurrent();await writeFile(file,credential('second'));const target=identity(credential('first')).id;
  await assert.rejects(accounts.switchTo(target),/desktop_stop_failed/);assert.equal(accounts.idle(),true);
  failure='start';await assert.rejects(accounts.switchTo(target),/desktop_start_failed/);assert.equal(accounts.idle(),true);
  failure=null;await accounts.switchTo(target);assert.equal(identity(await readFile(file,'utf8')).id,target);
 },{desktop,onAccountRead:async(home,params,b)=>({account:params.refreshToken?null:{type:'chatgpt',email:b.account.email}})});
});
test('same-account retry verifies native home and preserves its shutdown credential update',()=>{
 let nativeFile,nativeHome,verifiedHome;
 const rotated=JSON.stringify({...JSON.parse(credential('first')),tokens:{...JSON.parse(credential('first')).tokens,access_token:'new-native-access',refresh_token:'new-native-refresh'}});
 const desktop={inspect:async()=>({running:true}),stop:async()=>writeFile(nativeFile,rotated),start:async()=>{}};
 return fixture(async({accounts,file,native})=>{nativeFile=file;nativeHome=native;await accounts.importCurrent();await accounts.switchTo(identity(credential('first')).id);assert.equal(verifiedHome,nativeHome);assert.equal(await readFile(file,'utf8'),rotated);},{desktop,onAccountRead:async(home,params,b)=>{verifiedHome=home;return {account:{type:'chatgpt',email:b.account.email}};}});
});
test('missing target login is not mislabeled as another account and leaves native login intact',()=>fixture(async({accounts,file})=>{
 await accounts.importCurrent();await writeFile(file,credential('second'));await assert.rejects(accounts.switchTo(identity(credential('first')).id),/target_login_unavailable/);assert.equal(await readFile(file,'utf8'),credential('second'));assert.equal(accounts.idle(),true);
},{onAccountRead:async()=>({account:null})}));
test('a genuine different target identity still blocks switching',()=>fixture(async({accounts,file})=>{
 await accounts.importCurrent();await writeFile(file,credential('second'));await assert.rejects(accounts.switchTo(identity(credential('first')).id),/account_mismatch/);assert.equal(await readFile(file,'utf8'),credential('second'));
},{onAccountRead:async()=>({account:{type:'chatgpt',email:'third@example.test'}})}));
test('token refresh is requested only for near-expiry JWTs, not opaque or valid access tokens',()=>{
 const now=1800000000000,raw=exp=>{const v=JSON.parse(credential('first'));v.tokens.access_token='e30.'+Buffer.from(JSON.stringify({exp})).toString('base64url')+'.sig';return JSON.stringify(v);};
 assert.equal(needsTokenRefresh(raw(now/1000+3600),now),false);assert.equal(needsTokenRefresh(raw(now/1000-1),now),true);assert.equal(needsTokenRefresh(raw(now/1000+30),now),true);assert.equal(needsTokenRefresh(credential('first'),now),false);
});

test('switch timing is local, private and contains no identity or credential',()=>fixture(async({accounts,state})=>{
 await accounts.importCurrent();await accounts.switchTo(identity(credential('first')).id);const file=path.join(state,'switch-timing.json'),raw=await readFile(file,'utf8'),timing=JSON.parse(raw);
 assert.equal(timing.success,true);assert.ok(timing.totalMs>=0);assert.ok(timing.stages.some(s=>s.stage==='verify_current'));assert.doesNotMatch(raw,/secret|example|account_id|auth.json/);if(process.platform!=='win32')assert.equal((await stat(file)).mode&0o777,0o600);
}));

test('desktop resources close on preparation failure without closing the client',()=>{
 let closed=0,stopped=0;const desktop={inspect:async()=>{await new Promise(r=>setTimeout(r,15));return {};},stop:async()=>stopped++,close:async()=>closed++};
 return fixture(async({accounts,setFail})=>{await accounts.importCurrent();setFail(true);await assert.rejects(accounts.switchTo(identity(credential('first')).id));assert.equal(closed,1);assert.equal(stopped,0);},{desktop});
});
test('foreground restriction reports background without rolling back or restarting twice',()=>{
 let starts=0,closed=0;const desktop={inspect:async()=>({running:true}),stop:async()=>{},start:async()=>{starts++;return {window:'background'};},close:async()=>closed++};
 return fixture(async({accounts,file})=>{await accounts.importCurrent();await writeFile(file,credential('second'));const result=await accounts.switchTo(identity(credential('first')).id);assert.equal(result.desktop,'background');assert.equal(starts,1);assert.equal(closed,1);assert.equal(identity(await readFile(file,'utf8')).email,'first@example.test');},{desktop});
});

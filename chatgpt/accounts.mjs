import {readFile,writeFile,mkdir,rename,rm,readdir,lstat} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const digest=value=>createHash('sha256').update(value).digest('hex');
const idPattern=/^[a-f0-9]{64}$/;
async function read(file){try{const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size>1048576)fail('unsafe_account_file');return await readFile(file,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function safeDirectory(dir){await mkdir(dir,{recursive:true,mode:0o700});const st=await lstat(dir);if(!st.isDirectory()||st.isSymbolicLink())fail('unsafe_account_file');}
async function write(file,value){await mkdir(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+randomUUID();try{await writeFile(tmp,value,{mode:0o600,flag:'wx'});await rename(tmp,file);}finally{await rm(tmp,{force:true});}}
export function identity(raw){
 try{const a=JSON.parse(raw);if(a.OPENAI_API_KEY||a.auth_mode&&a.auth_mode!=='chatgpt')fail('chatgpt_login_required');const t=a.tokens;
 if(!t||!['id_token','access_token','refresh_token','account_id'].every(k=>typeof t[k]==='string'&&t[k]))fail('chatgpt_login_required');
 const p=JSON.parse(Buffer.from(t.id_token.split('.')[1],'base64url')),auth=p['https://api.openai.com/auth']||{};
 if(typeof p.email!=='string'||p.email.length>256||auth.chatgpt_account_id&&auth.chatgpt_account_id!==t.account_id)fail('invalid_account');
 return {id:digest(t.account_id+'\0'+p.email),email:p.email,plan:typeof auth.chatgpt_plan_type==='string'?auth.chatgpt_plan_type.slice(0,60):'chatgpt'};
 }catch(e){fail(['chatgpt_login_required','invalid_account'].includes(e.code)?e.code:'invalid_account');}
}
// account/read(true) rotates the refresh token; it is not a read-only identity
// check. Refresh only a JWT that is near expiry, leaving opaque tokens to Codex.
export function needsTokenRefresh(raw,now=Date.now()){
 try{const token=JSON.parse(raw).tokens.access_token;const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));return Number.isFinite(claims.exp)&&claims.exp*1000<=now+60000;}catch{return false;}
}
// Only a confirmed file store may be switched. Never shadow a keychain login
// with a different auth.json or change the user's credential-store preference.
export function createAccounts({state,codexHome,bridgeFactory,online=()=>true,operationTimeout=30000,desktop=null,cleanup=dir=>rm(dir,{recursive:true,force:true,maxRetries:8,retryDelay:150})}){
 const root=path.join(state,'accounts'),nativeFile=path.join(codexHome,'auth.json');let locked=false,pending=null,loginResult=null,active=null,operation=null,switchResult=null;
 let queryGeneration=0,queryBlocked=false;
 const home=id=>{if(!idPattern.test(id||''))fail('invalid_account');return path.join(root,id);};
 const auth=id=>path.join(home(id),'auth.json');
 const metadata=id=>path.join(home(id),'account.json');
 async function native(){const config=await read(path.join(codexHome,'config.toml'))||'';if(/^\s*cli_auth_credentials_store\s*=\s*["'](?!file["'])/m.test(config))fail('credential_store_unsupported');return read(nativeFile);}
 async function exclusive(fn){if(queryBlocked)fail('shutdown_unconfirmed');if(locked||pending)fail('accounts_busy');locked=true;try{await safeDirectory(root);return await fn();}finally{locked=false;operation=null;}}
 async function save(raw){const item=identity(raw);await safeDirectory(home(item.id));const old=JSON.parse(await read(metadata(item.id))||'{}');await write(auth(item.id),raw);await write(path.join(home(item.id),'config.toml'),'cli_auth_credentials_store = "file"\n');await write(metadata(item.id),JSON.stringify({...old,...item,name:old.name||'',savedAt:new Date().toISOString()}));return item;}
 async function load(id){await safeDirectory(home(id));const raw=await read(auth(id));if(!raw||identity(raw).id!==id)fail('invalid_account');return raw;}
 async function list(){let current=null,storeError=null;try{const raw=await native();if(raw)current=identity(raw).id;}catch(e){storeError=e.code||'account_unavailable';}
 await safeDirectory(root);const names=await readdir(root).catch(e=>{if(e.code==='ENOENT')return [];throw e;});const accounts=[];
 for(const id of names.filter(n=>idPattern.test(n))){try{const i=identity(await load(id)),m=JSON.parse(await read(metadata(id))||'{}');accounts.push({...i,name:typeof m.name==='string'?m.name.slice(0,60):'',current:id===current,profile:m.profile||null,checkedAt:m.checkedAt||null});}catch{}}
 return {accounts,current,storeError,login:pending?{status:pending.status||'pending',authUrl:pending.authUrl||null}:loginResult,busy:locked,operation,switchResult};}
 async function importCurrent(){return exclusive(async()=>{const raw=await native();if(!raw)fail('chatgpt_login_required');await save(raw);return {imported:true};});}
 async function timed(b,fn){let timer,expired=false;const check=()=>{if(expired)fail('account_timeout');};try{return await Promise.race([Promise.resolve().then(()=>fn(check)),new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(Object.assign(Error('account_timeout'),{code:'account_timeout'}));},operationTimeout);})]);}finally{clearTimeout(timer);try{if(b.closeAndWait)await b.closeAndWait();else b.close();}finally{if(active===b)active=null;}}}
 async function verify(id,useNative=false){
  operation='verify_account';requireOnline();const saved=await load(id),source=useNative?await native():saved;
  if(!source||identity(source).id!==id)fail('account_changed');
  const target=identity(source),b=active=bridgeFactory(useNative?codexHome:home(id));
  await timed(b,async check=>{
   try{await b.initialize();}catch(e){if(e.code==='chatgpt_login_required')fail('target_login_unavailable');throw e;}
   const latest=useNative?await native():await load(id);check();requireOnline();
   if(!latest||identity(latest).id!==id)fail('account_changed');
   const result=needsTokenRefresh(latest)?await b.request('account/read',{refreshToken:true}):{account:b.account};check();requireOnline();
   if(!result?.account)fail('target_login_unavailable');
   if(result.account.type!=='chatgpt'||result.account.email!==target.email)fail('account_mismatch');
  });
  // Read only after the bridge has exited; keep any credentials it refreshed.
  const prepared=useNative?await native():await load(id);
  if(!prepared||identity(prepared).id!==id)fail('account_changed');
  if(useNative)await save(prepared);
  return prepared;
 }
 function requireOnline(){if(!online())fail('network_disabled');}
 async function query(id){
  const generation=queryGeneration;
  const allowed=()=>{requireOnline();if(generation!==queryGeneration)fail('cancelled');};
  allowed();await load(id);const current=await native(),isCurrent=current&&identity(current).id===id;
  allowed();const b=active=bridgeFactory(isCurrent?codexHome:home(id));operation='query_quota';
  return timed(b,async check=>{
   allowed();await b.initialize();check();allowed();const profile=await b.profile();check();allowed();
   if(isCurrent){const latest=await native();check();allowed();if(!latest||identity(latest).id!==id)fail('account_changed');await save(latest);}
   if(identity(await load(id)).id!==id||profile.email!==identity(await load(id)).email)fail('account_mismatch');
   const m=JSON.parse(await read(metadata(id))||'{}');check();allowed();
   await write(metadata(id),JSON.stringify({...m,profile,checkedAt:new Date().toISOString()}));return profile;
  });
 }
 async function refresh(id){return exclusive(()=>query(id));}
 async function refreshAll(){return exclusive(async()=>{
  requireOnline();const generation=queryGeneration,snapshot=await list();
  if(snapshot.storeError)fail(snapshot.storeError);
  const result={total:snapshot.accounts.length,succeeded:0,failed:0};
  for(const account of snapshot.accounts){
   requireOnline();if(generation!==queryGeneration)fail('cancelled');
   try{await query(account.id);result.succeeded++;}
   catch(e){if(e.code==='shutdown_unconfirmed')queryBlocked=true;if(['cancelled','network_disabled','credential_store_unsupported','shutdown_unconfirmed'].includes(e.code))throw e;result.failed++;}
  }
  return result;
 });}
 async function switchTo(id){return exclusive(async()=>{
  const started=performance.now(),stages=[];let stage='prepare',stageStarted=started,success=false;
  const mark=name=>{const now=performance.now();stages.push({stage,ms:Math.round(now-stageStarted)});stage=name;stageStarted=now;operation=name;};
  try{
  requireOnline();await load(id);switchResult=null;mark('save_current');
  let previous=await native();if(previous)await save(previous);
  mark('prepare_target');
  // Read-only desktop preparation overlaps target auth verification. Settle both
  // before cleanup so a failed verification cannot leave a late native session.
  const preparation=await Promise.allSettled([verify(id,!!previous&&identity(previous).id===id),desktop?.inspect()]);
  for(const result of preparation)if(result.status==='rejected')throw result.reason;
  let prepared=preparation[0].value;const client=preparation[1].value;
  let stopped=false,written=false,next;
  try{
   requireOnline();mark('stop_desktop');await desktop?.stop(client);stopped=true;
   // Desktop shutdown may persist rotated credentials. Read/save again only
   // after it exits; never overwrite them with the pre-shutdown snapshot.
   const latest=await native();if(previous&&latest&&identity(previous).id!==identity(latest).id)fail('account_changed');
   previous=latest;if(previous){await save(previous);if(identity(previous).id===id)prepared=previous;}
   mark('write_login');next=prepared;requireOnline();if(await native()!==previous)fail('account_changed');await write(nativeFile,next);written=true;
   mark('verify_current');const b=active=bridgeFactory(codexHome);
   await timed(b,async check=>{await b.initialize();const current=await native();check();requireOnline();if(!current||identity(current).id!==id||b.account.email!==identity(next).email)fail('account_mismatch');await save(current);});
  }catch(error){
   if(written){const current=await native();if(current&&identity(current).id===id){if(previous===null)await rm(nativeFile,{force:true});else await write(nativeFile,previous);}}
   if(stopped&&client?.running){mark('restore_desktop');try{await desktop.start(client);}catch{switchResult={id,status:'restore_failed'};fail('desktop_restore_failed');}}
   if(written)fail('switch_verification_failed');throw error;
  }
  mark('start_desktop');let presentation;
  try{presentation=await desktop?.start(client);const observed=await native();if(!observed||identity(observed).id!==id)fail('account_changed');}catch(error){switchResult={id,status:error.code==='desktop_window_unavailable'?'window_unavailable':'start_failed'};fail(error.code==='desktop_window_unavailable'?'desktop_window_unavailable':'desktop_start_failed');}
  switchResult={id,status:client?(presentation?.window==='background'?'background':'restarted'):'cli_only'};
  success=true;return {switched:true,desktop:switchResult.status};
  }finally{try{await desktop?.close?.();}catch(e){success=false;throw e;}finally{mark('finished');await write(path.join(state,'switch-timing.json'),JSON.stringify({checkedAt:new Date().toISOString(),success,totalMs:Math.round(performance.now()-started),stages,desktopStages:desktop?.timings?.()||[]})).catch(()=>{});}}
 });}
 async function renameAccount(id,name){return exclusive(async()=>{await load(id);if(typeof name!=='string'||name.length>60||/[\x00-\x1f]/.test(name))fail('invalid_name');const m=JSON.parse(await read(metadata(id))||'{}');await write(metadata(id),JSON.stringify({...m,name:name.trim()}));return {renamed:true};});}
 async function remove(id){return exclusive(async()=>{await load(id);const current=await native();if(current&&identity(current).id===id)fail('current_account');await rm(home(id),{recursive:true,force:true});return {removed:true};});}
 // Cleanup must never reject out of an event listener or timer. On Windows
 // Codex may release SQLite files shortly after its process exits.
 async function cleanupLogin(dir){try{await cleanup(dir);return true;}catch{return false;}}
 async function cancel(){
  queryGeneration++;
  active?.close();const p=pending;if(!p)return {cancelled:true};
  if(p.completion){await p.completion;return {cancelled:false};}
  pending=null;clearTimeout(p.timer);p.bridge.close();
  loginResult={status:'cancelled',cleanupPending:!await cleanupLogin(p.home)};
  return {cancelled:true};
 }
 async function startLogin(){return exclusive(async()=>{
  requireOnline();await native();const dir=path.join(root,'login-'+randomUUID());
  await mkdir(dir,{recursive:true,mode:0o700});
  await write(path.join(dir,'config.toml'),'cli_auth_credentials_store = "file"\n');
  const b=bridgeFactory(dir),p={home:dir,bridge:b};pending=p;loginResult=null;
  const finish=success=>{
   if(pending!==p||p.completion)return;
   clearTimeout(p.timer);p.status='saving';
   let saved=false;
   p.completion=Promise.resolve().then(async()=>{
    try{
     if(!success||!online())fail('login_failed');
     // A successful OAuth callback already persisted credentials. Save them
     // before shutting down; a non-zero process exit is not a login failure.
     const raw=await read(path.join(dir,'auth.json'));await save(raw);saved=true;
     loginResult={status:'complete'};
     try{await b.finish();}catch{/* shutdown does not undo the saved account */}
    }catch{loginResult={status:'failed'};}
    finally{
     b.close();
     // Keep an unsaved successful login for diagnosis rather than destroy it.
     const cleaned=success&&!saved?false:await cleanupLogin(dir);
     loginResult={...loginResult,cleanupPending:!cleaned};
     if(pending===p)pending=null;
    }
   }).catch(()=>{loginResult={status:saved?'complete':'failed',cleanupPending:true};if(pending===p)pending=null;});
  };
  b.listeners.add(msg=>{if(msg.method==='account/login/completed')finish(msg.params?.success===true);else if(msg.method==='__closed'&&pending===p)finish(false);});
  try{
   await b.initialize({requireLogin:false});
   const result=await b.request('account/login/start',{type:'chatgpt'});
   const url=new URL(result.authUrl);
   if(url.protocol!=='https:'||!['auth.openai.com','auth0.openai.com','chatgpt.com'].includes(url.hostname))fail('login_failed');
   p.authUrl=url.href;
   if(!p.completion){p.timer=setTimeout(()=>{void cancel().catch(()=>{});},300000);p.timer.unref();}
   return {authUrl:p.authUrl};
  }catch{await cancel();fail('login_failed');}
 });}
 return {list,importCurrent,refresh,refreshAll,switchTo,rename:renameAccount,remove,startLogin,cancel,idle:()=>!locked&&!pending&&!queryBlocked,close:cancel};
}

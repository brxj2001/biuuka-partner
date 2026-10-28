import {VERSION} from './release.mjs';
import http from 'node:http';
import {readSubscription} from './subscription.mjs';
import {createChatGPTDetector} from './chatgpt-install.mjs';
import {attachLive} from './live.mjs';
import { createNetwork } from './network.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PRESETS } from './bridge.mjs';
import { createAccess, trustedOrigin, validOrigin } from './access.mjs';

export {VERSION} from './release.mjs';
export const TRUSTED_SITES = {has:trustedOrigin};
const directory = path.dirname(fileURLToPath(import.meta.url));
export function createServer({ token, port = 17322, bridgeFactory, refreshMs = 10000, records, localProfile, accounts, network = createNetwork(), control, chatgptInstall = createChatGPTDetector() }) {
  const uiInstance=randomBytes(12).toString('hex');
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const access = control?.access || createAccess();
  const enabled=()=>control?.enabled()!==false;
  const online=()=>enabled()&&control?.online?.()!==false;
  const reconcile=()=>{if(!online()){void accounts?.close();if(!enabled())profile=null;profileError=null;networkReport=null;network.cancel?.();readSubscription.cancel();profileBridge?.close("cancelled");activeBridge?.close("cancelled");}else{void refreshProfile();if(refreshMs>0)void refreshNetwork().catch(()=>{});}if(enabled()&&!online())void refreshProfile();live?.broadcast();};
  let activeBridge,activeGrant,live,networkReport,updateInfo;
  const refreshNetwork=async(force=false)=>{if(!online())return null;const report=await network(force);networkReport=online()?report:null;live?.broadcast();return networkReport;};
  const refreshVersion=async()=>{if(control?.appUpdate){updateInfo=await control.appUpdate.status();live?.broadcast();}return updateInfo;};
  let draining = false, accountWaiting=false;
  let busy = false, profile, profileError, profileFlight, profileBridge;
  const refreshProfile = () => {
    if(!enabled()||draining||accounts?.idle()===false)return Promise.resolve();
    if (profileFlight) return profileFlight;
    profileFlight = (async () => {
      let reader, deadline;
      try {
        if(!online()){profile=await localProfile?.read()||null;profileError=null;return;}
        reader = profileBridge = bridgeFactory();
        profile = await Promise.race([
          (async () => { await reader.initialize(); return reader.profile(); })(),
          new Promise((_, reject) => { deadline = setTimeout(() => reject(Object.assign(new Error('timeout'), {code:'timeout'})), 45000); })
        ]);
        if(!enabled())profile=null;
        else if(!online())profile=await localProfile?.read()||null;
        else if(profile.limitsStatus==='available')await localProfile?.save(profile).catch(()=>{});
        profileError = null;
      }
      catch (error) { profile = enabled()?await localProfile?.read()||null:null; profileError = profile?null:error; }
      finally { if(!enabled())profile=null;clearTimeout(deadline); reader?.close(); profileBridge = null; live?.broadcast(); }
    })().finally(() => { profileFlight = null; });
    return profileFlight;
  };
  const removeRecord = id => records.remove(id, async threadId => {
    const bridge=bridgeFactory();
    try { await bridge.initialize({requireLogin:false}); await bridge.deleteThread(threadId); await bridge.finish(); }
    finally { bridge.close(); }
  });
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    let permittedResponse=()=>true;
    const json = (status, value) => { if(!permittedResponse()){status=401;value={error:'pairing_required'};}res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    const origin = `http://${req.headers.host}`;
    if (!hosts.has(req.headers.host)) return json(403, { error: 'origin_rejected' });
    const url = new URL(req.url, origin);
    const requestOrigin=req.headers.origin;
    const website=trustedOrigin(requestOrigin),external=validOrigin(requestOrigin);
    const local=requestOrigin===origin;
    const supplied=Buffer.from(req.headers.authorization||''),expected=Buffer.from(`Bearer ${token}`);
    const master=supplied.length===expected.length&&timingSafeEqual(supplied,expected)&&(local||!requestOrigin&&req.headers['sec-fetch-site']!=='cross-site');
    const grantToken=(req.headers.authorization||'').replace(/^Bearer /,'');
    const publicRoutes=new Map([['/health','GET'],['/device/chatgpt','POST'],['/update/status','POST'],['/update/start','POST'],['/preset','GET'],['/account','POST'],['/models','POST'],['/test','POST'],['/records','POST'],['/record','POST'],['/record/delete','POST'],['/network','POST'],['/engine/start','POST'],['/notify','POST'],['/pair/start','POST'],['/pair/exchange','POST']]);
    const bodyJson=async(max=4096)=>{let size=0,parts=[];for await(const chunk of req){size+=chunk.length;if(size>max)throw Error('invalid_request');parts.push(chunk);}const body=JSON.parse(Buffer.concat(parts));if(!body||typeof body!=='object'||Array.isArray(body))throw Error('invalid_request');return body;};
    // Local console and pairing pages never grant CORS, even to first-party sites.
    if(req.method==='GET'&&['/console','/pair'].includes(url.pathname)){
      if(requestOrigin&&requestOrigin!==origin||req.headers['sec-fetch-dest']==='iframe'||req.headers['sec-fetch-site']==='cross-site'&&req.headers['sec-fetch-mode']!=='navigate')return json(403,{error:'origin_rejected'});
      const name=url.pathname==='/console'?'console.html':'pair.html';
      let body=await readFile(path.join(directory,name),'utf8');
      if(name==='console.html')body=body.replace('__CONSOLE_TOKEN__',token);
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(body);return;
    }
    if(external){
      if(!publicRoutes.has(req.url))return json(403,{error:'scope_rejected'});
      res.setHeader('Access-Control-Allow-Origin',requestOrigin);res.setHeader('Vary','Origin');
      if(req.method==='OPTIONS'){
        const headers=(req.headers['access-control-request-headers']||'').toLowerCase().split(',').map(h=>h.trim()).filter(Boolean);
        if(req.headers['access-control-request-method']!==publicRoutes.get(req.url)||headers.some(h=>!['content-type','authorization'].includes(h)))return json(403,{error:'origin_rejected'});
        res.setHeader('Access-Control-Allow-Methods',publicRoutes.get(req.url));res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Allow-Private-Network','true');res.writeHead(204);res.end();return;
      }
      if(req.method!==publicRoutes.get(req.url))return json(405,{error:'method_rejected'});
    }else if(requestOrigin&&!local||req.headers['sec-fetch-site']==='cross-site')return json(403,{error:'origin_rejected'});
    if(req.method==='POST'&&['/pair/start','/pair/exchange'].includes(req.url)){
      if(!external||req.headers['content-type']!=='application/json')return json(403,{error:'origin_rejected'});
      try{const body=await bodyJson();
        if(req.url==='/pair/start'){if(Object.keys(body).some(k=>k!=='nonce'))return json(400,{error:'invalid_request'});const result=access.start(requestOrigin,body.nonce);return result?json(200,{...result,url:origin+'/pair?ticket='+result.ticket}):json(429,{error:'pairing_rate_limited'});}
        if(Object.keys(body).some(k=>!['ticket','nonce','code'].includes(k)))return json(400,{error:'invalid_request'});
        const result=await access.exchange(requestOrigin,body);return result?json(200,result):json(403,{error:'code_or_approval_invalid'});
      }catch{return json(400,{error:'invalid_request'});}
    }
    if(req.method==='POST'&&['/pair/code','/pair/approve','/pair/cancel'].includes(req.url)){
      if(!local||req.headers['content-type']!=='application/json')return json(403,{error:'origin_rejected'});
      try{const body=await bodyJson();if(req.url==='/pair/code'){const value=access.view(body.ticket);return value?json(200,value):json(410,{error:'expired'});}
        if(req.url==='/pair/cancel'){access.cancel(body.ticket);return json(200,{cancelled:true});}
        return access.approve(body.ticket,body.duration,body.scopes)?json(200,{approved:true}):json(400,{error:'invalid_approval'});
      }catch{return json(400,{error:'invalid_request'});}
    }
    if(req.url==='/device/chatgpt'){
      if(!website&&!master)return json(403,{error:'scope_rejected'});
      if(req.method!=='POST'||req.headers['content-type']!=='application/json')return json(405,{error:'method_rejected'});
      try{const body=await bodyJson();if(Object.keys(body).length)return json(400,{error:'invalid_request'});}
      catch{return json(400,{error:'invalid_request'});}
      if(!enabled())return json(409,{error:'engine_disabled'});
      if(draining)return json(409,{error:'busy'});
      try{return json(200,await chatgptInstall());}catch(e){return json(e.code==='rate_limited'?429:502,{error:e.code==='rate_limited'?'rate_limited':'detection_failed'});}
    }
    if(req.url==='/update/status'||req.url==='/update/start'){
      if(!website&&!master)return json(403,{error:'scope_rejected'});
      if(req.method!=='POST'||req.headers['content-type']!=='application/json')return json(405,{error:'method_rejected'});
      try{const body=await bodyJson();if(Object.keys(body).length)return json(400,{error:'invalid_request'});
        if(!control?.appUpdate)return json(409,{error:'installer_required'});
        return json(200,req.url==='/update/start'?await control.appUpdate.start():await refreshVersion());
      }catch(e){return json(e.code==='update_rate_limited'?429:409,{error:e.code||'update_unavailable'});}
    }
    if(req.method==='GET'&&req.url==='/health'){
      if(external&&!website&&!access.permits(grantToken,requestOrigin,'account')&&!access.permits(grantToken,requestOrigin,'test'))return json(401,{error:'pairing_required'});
      return json(200,{service:'biuuka',uiInstance,version:VERSION,installed:true,engine:enabled()?'enabled':'disabled',networkEnabled:control?.settings?.().networkEnabled!==false,control:!!control,live:true,refreshMs});
    }
    const files={'/brand.svg':['brand.svg','image/svg+xml'],'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css'],'/console.js':['console.js','text/javascript'],'/console.css':['console.css','text/css'],'/pair.js':['pair.js','text/javascript'],'/external-sdk.js':['external-sdk.js','text/javascript']};
    if(req.method==='GET'&&files[req.url]&&!external){const [file,type]=files[req.url];res.writeHead(200,{'Content-Type':type});res.end(await readFile(path.join(directory,file)));return;}
    if(req.url.startsWith('/control/')){
      if(!master||!control)return json(403,{error:'control_required'});
      if(req.method!=='POST'||req.headers['content-type']!=='application/json')return json(405,{error:'method_rejected'});
      try{const input=await bodyJson();
        if(req.url.startsWith('/control/accounts/')){
          if(!accounts)return json(404,{error:'accounts_unavailable'});
          const action=req.url.slice('/control/accounts/'.length),keys={list:[],import:[],login:[],cancel:[],refresh:['id'],switch:['id'],rename:['id','name'],remove:['id']}[action];
          if(!keys||Object.keys(input).some(k=>!keys.includes(k)))return json(400,{error:'invalid_request'});
          if(action==='list'){const result=await accounts.list();return json(200,{...result,operation:accountWaiting?'waiting_for_profile':result.operation});}
          if(action==='cancel')return json(200,await accounts.cancel());
          if(busy||draining)return json(409,{error:'busy'});
          busy=true;
          try{
            if(profileFlight){accountWaiting=true;try{await profileFlight;}finally{accountWaiting=false;}}
            const result=await ({import:()=>accounts.importCurrent(),login:()=>accounts.startLogin(),refresh:()=>accounts.refresh(input.id),switch:()=>accounts.switchTo(input.id),rename:()=>accounts.rename(input.id,input.name),remove:()=>accounts.remove(input.id)})[action]();
            if(action==='switch'){profile=null;profileError=null;live?.broadcast();void refreshProfile();}
            return json(200,result);
          }catch(e){if(action==='switch'){profile=null;profileError=null;live?.broadcast();}const allowed=['desktop_restore_failed','desktop_inspect_failed','desktop_stop_failed','desktop_start_failed','desktop_custom_home','desktop_ambiguous','desktop_identity_unconfirmed','target_login_unavailable','shutdown_unconfirmed','codex_request_failed','account_timeout','accounts_busy','network_disabled','credential_store_unsupported','chatgpt_login_required','invalid_account','invalid_name','current_account','account_changed','account_mismatch','switch_verification_failed','login_failed','unsafe_account_file'];return json(409,{error:allowed.includes(e.code)?e.code:'account_operation_failed'});}
          finally{busy=false;}
        }
        if(req.url==='/control/boundary/ack'){if(input.version!==1)return json(400,{error:'invalid_request'});await control.save({boundaryVersion:1});return json(200,{acknowledged:true});}
        if(req.url==='/control/records')return json(200,{records:records?await records.list():[]});
        if(req.url==='/control/record'){if(!records)return json(404,{error:'records_unavailable'});return json(200,await records.get(input.id));}
        if(req.url==='/control/record/delete'){if(!records)return json(404,{error:'records_unavailable'});if(busy||draining)return json(409,{error:'busy'});busy=true;try{await removeRecord(input.id);return json(200,{deleted:true});}finally{busy=false;}}
        if(req.url==='/control/tray/close'){if(Object.keys(input).length)return json(400,{error:'invalid_request'});return json(200,await control.closeTray());}
        if(req.url==='/control/tray/open'){if(Object.keys(input).length)return json(400,{error:'invalid_request'});return json(200,await control.openTray());}
        if(req.url==='/control/status')return json(200,await control.status());
        if(req.url==='/control/settings'){
          if(Object.keys(input).some(k=>!['autoUpdate','notifications','networkEnabled'].includes(k))||Object.values(input).some(v=>typeof v!=='boolean'))return json(400,{error:'invalid_request'});
          const settings=await control.save(input);reconcile();return json(200,settings);
        }
        if(req.url==='/control/engine'){
          if(typeof input.enabled!=='boolean')return json(400,{error:'invalid_request'});
          await control.save({engineEnabled:input.enabled});
          reconcile();
          live?.broadcast();return json(200,{enabled:enabled()});
        }
        if(req.url==='/control/grants/revoke'){await access.revoke(input.id);if(activeGrant===input.id)activeBridge?.close('cancelled');live?.broadcast();return json(200,{revoked:true});}
        if(req.url==='/control/cache/clear')return json(200,await control.clearCache());
        if(req.url==='/control/updates/check')return json(200,await control.checkUpdates());
        if(req.url==='/control/exit'||req.url==='/control/uninstall'){if(input.confirm!==true)return json(400,{error:'confirmation_required'});control.schedule(req.url.endsWith('exit')?'service-exit':'uninstall');return json(200,{scheduled:true});}
        return json(404,{error:'not_found'});
      }catch(e){return json(e.code==='network_disabled'?409:502,{error:e.code==='network_disabled'?'network_disabled':'control_failed'});}
    }
    const scope=['/account','/network'].includes(req.url)?'account':['/models','/preset','/test'].includes(req.url)?'test':req.url==='/notify'?'notify':null;
    if(!master&&!website&&!(external&&scope&&access.permits(grantToken,requestOrigin,scope)))return json(401,{error:'pairing_required'});
    if(!master&&!website)permittedResponse=()=>access.permits(grantToken,requestOrigin,scope);
    if(!master&&!website&&!scope)return json(403,{error:'scope_rejected'});
    if(req.method==='GET'&&req.url==='/preset')return json(200,{presets:PRESETS});
    if(req.method!=='POST'||req.headers['content-type']!=='application/json')return json(405,{error:'method_rejected'});
    if(req.url==='/engine/start'){
      if(!website&&!master)return json(403,{error:'scope_rejected'});
      try{const input=await bodyJson();if(Object.keys(input).length||!control)return json(400,{error:'invalid_request'});await control.save({engineEnabled:true});reconcile();live?.broadcast();return json(200,{enabled:true});}catch{return json(502,{error:'control_failed'});}
    }
    if(req.url==='/notify'&&!online())return json(409,{error:enabled()?'network_disabled':'engine_disabled'});
    if(req.url==='/notify'){
      try{const input=await bodyJson();if(Object.keys(input).some(k=>!['title','body'].includes(k))||!control)return json(400,{error:'invalid_request'});return json(200,await control.notify(requestOrigin,input.title,input.body));}catch(e){return json(400,{error:['notifications_disabled','notification_rate_limited','invalid_notification','notifications_unsupported'].includes(e.code)?e.code:'notification_failed'});}
    }
    if(!['/models','/account','/history','/test','/chat','/records','/record','/record/delete','/network'].includes(req.url))return json(404,{error:'not_found'});
    if(!enabled())return json(409,{error:'engine_disabled'});
    if(!online()&&!['/account','/records','/record'].includes(req.url))return json(409,{error:'network_disabled'});
    if (busy || draining) return json(409, { error: 'busy' });
    busy = true;
    activeGrant=!master&&!website?access.idFor(grantToken,requestOrigin):null;
    const grantTimer=activeGrant?setInterval(()=>{if(!permittedResponse())activeBridge?.close('cancelled');},1000):null;
    let bridge, record;
    const disconnected = () => bridge?.close('cancelled');
    res.on('close', disconnected);
    try {
      const chunks = []; let size = 0; for await (const chunk of req) {
        size += chunk.length; if (size > 100000) { json(413, { error: 'body_too_large' }); return; }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString('utf8');
      let input; try { input = JSON.parse(body); } catch { json(400, { error: 'invalid_request' }); return; }
      const keys = req.url === '/chat' ? ['model', 'effort', 'prompt'] : req.url === '/test' ? ['model', 'effort', 'preset'] : ['/record','/record/delete'].includes(req.url) ? ['id'] : [];
      if (!input || typeof input !== 'object' || Array.isArray(input) ||
        Object.keys(input).some(key => !keys.includes(key))) { json(400, { error: 'invalid_request' }); return; }
      if (req.url === '/chat' && (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 16000)) { json(400, { error: 'invalid_prompt' }); return; }
      if (['/test', '/chat'].includes(req.url) && (typeof input.model !== 'string' || typeof input.effort !== 'string')) { json(400, { error: 'invalid_request' }); return; }
      if (req.url === '/test' && input.preset !== undefined && !PRESETS.some(p => p.id === input.preset)) { json(400, { error: 'invalid_preset' }); return; }
      if (res.destroyed) return;
      if (req.url === '/network') { json(200, await refreshNetwork()); return; }
      if (req.url === '/account' && (refreshMs > 0 || !online())) {
        if (!online() || !profile || Date.now() - Date.parse(profile.checkedAt) >= refreshMs) await refreshProfile();
        if (profileError) throw profileError;
        json(200, profile); return;
      }
      if(['/records','/record','/record/delete'].includes(req.url)){
        if(!records){json(404,{error:'records_unavailable'});return;}
        if(req.url==='/records'){json(200,{records:await records.list()});return;}
        if(req.url==='/record'){json(200,await records.get(input.id));return;}
        await removeRecord(input.id);json(200,{deleted:true});return;
      }
      if(records&&['/test','/chat'].includes(req.url))record=await records.begin({model:input.model,effort:input.effort,preset:input.preset||'chat',prompt:input.prompt||PRESETS.find(p=>p.id===(input.preset||'pelican'))?.prompt});
      if(!online())throw Error("cancelled");
      bridge = activeBridge = bridgeFactory(); await bridge.initialize();
      if (req.url === '/history') { json(200, await bridge.history()); return; }
      if (req.url === '/account') { json(200, await bridge.profile()); return; }
      if (req.url === '/models') { json(200, { models: await bridge.models() }); return; }
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
      res.flushHeaders();
      const started = Date.now();
      const emit = event => { if(!permittedResponse()){bridge?.close('cancelled');return;}if(record){if(event.type==='delta')record.answer+=event.text||'';if(event.type==='thread'){record.threadId=event.threadId;record.saved=!!event.saved;}} if (!res.destroyed) res.write(JSON.stringify(event) + '\n'); };
      const threadId = req.url === '/chat' ? await bridge.conversation(input.model, input.effort, emit, input.prompt) : await bridge.test(input.model, input.effort, emit, input.preset);
      await bridge.finish();
      if (res.destroyed) return;
      bridge = activeBridge = bridgeFactory(); await bridge.initialize();
      await bridge.verifySaved(threadId);
      await bridge.finish();
      emit({ type: 'thread', threadId, saved: true });
      if(record){record.status='complete';record.elapsedMs=Date.now()-started;await records.put(record);}
      emit({ type: 'done', elapsedMs: Date.now() - started }); res.end();
      if (refreshMs > 0) void refreshProfile();
    } catch (error) {
      if(record){record.status=res.destroyed?'cancelled':'failed';}
      // Never forward provider errors, stderr, account objects or local paths.
      const allowed = new Set(['record_running', 'thread_ownership_unconfirmed', 'invalid_record', 'invalid_prompt', 'invalid_preset', 'chatgpt_login_required', 'invalid_model', 'persistent_required', 'persistence_unconfirmed', 'history_unconfirmed', 'shutdown_unconfirmed', 'timeout', 'output_limit', 'codex_unavailable', 'codex_exited', 'turn_failed', 'codex_request_failed']);
      const code = allowed.has(error.code) ? error.code : 'local_service_error';
      if (!res.destroyed) {
        if (res.headersSent) res.end(JSON.stringify({ type: 'error', error: code }) + '\n');
        else json(502, { error: code });
      }
    } finally { bridge?.close(); activeBridge=null;activeGrant=null;if(grantTimer)clearInterval(grantTimer); if(record&&record.status!=='complete'){if(record.status==='running')record.status=res.destroyed?'cancelled':'interrupted';await records.put(record).catch(()=>{});} busy = false; res.off('close', disconnected); }
  });
  live=attachLive(server,{hosts,token,access,snapshot:()=>({service:'biuuka',version:VERSION,engine:enabled()?'enabled':'disabled',control:!!control,refreshMs,networkRefreshMs:300000,networkEnabled:control?.settings?.().networkEnabled!==false,network:online()?networkReport||null:null,update:updateInfo||null,profile:enabled()?profile||null:null,error:profileError?'account_unavailable':null})});
  server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;server.maxHeadersCount=32;
  let timer;
  server.once('listening', () => {
    if (refreshMs <= 0) return;
    void refreshProfile().catch(() => {});
    timer = setInterval(() => void refreshProfile().catch(() => {}), refreshMs);
    timer.unref();
  });
  const networkTimer=setInterval(()=>{void refreshNetwork(true).catch(()=>{});void refreshVersion().catch(()=>{});},300000);networkTimer.unref();
  server.once('close', () => { void accounts?.close(); clearInterval(networkTimer);clearInterval(timer); profileBridge?.close(); profile = null; });
  server.canPrepareUpdate=()=>!(busy||profileFlight||accounts?.idle()===false||control?.idle?.()===false);
  server.prepareUpdate=()=>{if(!server.canPrepareUpdate())return false;draining=true;clearInterval(timer);return true;};
  return server;
}

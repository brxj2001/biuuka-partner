import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const retryMs=30*60*1000;
export function dateValue(value){
  if(typeof value!=='string'&&typeof value!=='number')return null;
  if(value==='')return null;
  const n=/^\d+(\.\d+)?$/.test(String(value))?Number(value):NaN;
  const ms=Number.isFinite(n)?(n<1e12?n*1000:n):Date.parse(value);
  return Number.isFinite(ms)&&ms>0&&ms<8640000000000000?new Date(ms).toISOString():null;
}
function payload(token){try{if(typeof token!=='string'||token.length>100000)return {};return JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());}catch{return {};}}
export function localSubscription(auth,account){
  const tokens=auth?.tokens;if(!tokens||account?.type!=='chatgpt')return null;
  const id=payload(tokens.id_token),access=payload(tokens.access_token),claims=id['https://api.openai.com/auth']||{};
  // Fail closed on identity ambiguity. Never mix a stale auth file with another active account.
  if(!account.email||id.email!==account.email||claims.chatgpt_plan_type!==account.planType)return null;
  const accountId=tokens.account_id||claims.chatgpt_account_id||access['https://api.openai.com/auth']?.chatgpt_account_id;
  if(typeof accountId!=='string'||!accountId)return null;
  return {tokens,accountId,expiresAt:dateValue(claims.chatgpt_subscription_active_until),checkedAt:dateValue(claims.chatgpt_subscription_last_checked)};
}
export function selectAccount(data,accountId){
  const records=data?.accounts;if(!records||typeof records!=='object')return null;
  for(const [key,node]of Object.entries(records)){
    const a=node?.account||node;
    if(key===accountId||a?.account_id===accountId||a?.id===accountId)return node;
  }
  return null;
}
export function createSubscriptionReader({read=readFile,request=fetch,now=Date.now}={}){
  let entry,controller=new AbortController();
  async function json(url,token,signal){
    signal.throwIfAborted();
    const res=await request(url,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json','User-Agent':'Biuuka/0.0.1'},redirect:'error',credentials:'omit',signal:AbortSignal.any([signal,AbortSignal.timeout(8000)])});
    if(!res.ok){await res.body?.cancel();throw Error(res.status===403?'access_denied':res.status===401?'login_required':'unavailable');}
    let text='';for await(const chunk of res.body){text+=Buffer.from(chunk).toString('utf8');if(text.length>1048576)throw Error('unavailable');}
    return JSON.parse(text);
  }
  const run=async(home,account)=>{
    const signal=controller.signal;
    let local;
    try{
      // Respect explicit keyring configuration instead of reading a possibly stale file.
      let config='';try{config=await read(path.join(home,'config.toml'),'utf8');}catch{}
      if(/^\s*cli_auth_credentials_store\s*=\s*["']keyring["']/m.test(config))return {expiresAt:null,source:null,status:'unavailable',checkedAt:null};
      const raw=await read(path.join(home,'auth.json'),'utf8');if(raw.length>1048576)throw Error();
      local=localSubscription(JSON.parse(raw),account);
    }catch{}
    if(!local){entry=null;return {expiresAt:null,source:null,status:'unavailable',checkedAt:null};}
    if(signal.aborted)return {expiresAt:null,source:null,status:"unavailable",checkedAt:null};
    const key=createHash('sha256').update(home+'\0'+local.accountId+'\0'+local.tokens.id_token+'\0'+local.tokens.access_token).digest('hex');
    if(entry?.key!==key)entry={key,next:0,result:{expiresAt:local.expiresAt,source:local.expiresAt?'local_login':null,status:local.expiresAt?'snapshot':'unavailable',checkedAt:local.checkedAt}};
    const current=entry;
    if(!current.flight&&now()>=current.next&&(!current.result.expiresAt||Date.parse(current.result.expiresAt)<=now())){
      current.next=now()+retryMs;
      current.result={...current.result,status:'checking'};
      current.flight=(async()=>{
        try{
          const token=local.tokens.access_token;if(!token)throw Error('login_required');
          const data=await json('https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27',token,signal);
          const node=selectAccount(data,local.accountId);if(!node)throw Error('account_mismatch');
          let expiresAt=dateValue(node.entitlement?.expires_at||node.account?.expires_at);
          if(!expiresAt||Date.parse(expiresAt)<=now()){
            signal.throwIfAborted();const sub=await json('https://chatgpt.com/backend-api/subscriptions?account_id='+encodeURIComponent(local.accountId),token,signal);
            expiresAt=dateValue(sub.active_until||sub.expires_at)||expiresAt;
          }
          if(!expiresAt)throw Error('unavailable');
          current.result={expiresAt,source:'subscription_api',status:'available',checkedAt:new Date(now()).toISOString()};
        }catch(e){current.result={...current.result,status:current.result.expiresAt?'snapshot':'unavailable',error:['access_denied','login_required','account_mismatch'].includes(e.message)?e.message:'unavailable',attemptedAt:new Date(now()).toISOString()};}
      })().finally(()=>{current.flight=null;});
    }
    return {...current.result};
  };
  run.cancel=()=>{controller.abort();controller=new AbortController();entry=null;};
  return run;
}
export const readSubscription=createSubscriptionReader();

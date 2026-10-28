import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import path from 'node:path';
import {localSubscription} from './subscription.mjs';

// Only local files: never start Codex or refresh credentials in offline mode.
export function createLocalProfile(home,state){
  const file=path.join(state,'account-snapshot.json');
  const text=v=>typeof v==='string'?v.slice(0,256):null;
  const number=v=>Number.isFinite(v)&&typeof v==='number'?v:null;
  const window=v=>v?{usedPercent:number(v.usedPercent),windowDurationMins:number(v.windowDurationMins),resetsAt:number(v.resetsAt)}:null;
  async function identity(){
    try{
      let config='';try{config=await readFile(path.join(home,'config.toml'),'utf8');}catch{}
      if(/^\s*cli_auth_credentials_store\s*=\s*["'](?:keyring|auto)["']/m.test(config))return null;
      const raw=await readFile(path.join(home,'auth.json'),'utf8');if(raw.length>1048576)return null;
      const auth=JSON.parse(raw);if(auth.auth_mode&&auth.auth_mode!=='chatgpt')return null;
      const id=JSON.parse(Buffer.from(auth.tokens.id_token.split('.')[1],'base64url').toString());
      const account={type:'chatgpt',email:text(id.email),planType:text(id['https://api.openai.com/auth']?.chatgpt_plan_type)};
      const local=localSubscription(auth,account);if(!local)return null;
      return {key:createHash('sha256').update(home+'\0'+local.accountId+'\0'+account.email+'\0'+account.planType).digest('hex'),account,local};
    }catch{return null;}
  }
  return {
    async save(profile){
      const current=await identity();if(!current||profile.email!==current.account.email||profile.plan!==current.account.planType)return;
      const snapshot={key:current.key,checkedAt:profile.checkedAt,limits:(profile.limits||[]).slice(0,20).map(v=>({id:text(v.id),name:text(v.name),primary:window(v.primary),secondary:window(v.secondary)}))};
      await mkdir(state,{recursive:true,mode:0o700});const tmp=file+'.'+randomBytes(8).toString('hex');
      await writeFile(tmp,JSON.stringify(snapshot),{mode:0o600});await rename(tmp,file);
    },
    async read(){
      const current=await identity();if(!current)return null;
      let cache;try{const raw=await readFile(file,'utf8');if(raw.length<=65536)cache=JSON.parse(raw);}catch{}
      const matching=cache?.key===current.key&&Number.isFinite(Date.parse(cache?.checkedAt));
      const limits=matching&&Array.isArray(cache.limits)?cache.limits.slice(0,20).map(v=>({id:text(v.id),name:text(v.name),primary:window(v.primary),secondary:window(v.secondary)})):[];
      return {email:current.account.email,plan:current.account.planType,login:'chatgpt',offline:true,limits,limitsStatus:limits.length?'available':'unavailable',checkedAt:matching?cache.checkedAt:null,subscription:{expiresAt:current.local.expiresAt,checkedAt:current.local.checkedAt,source:current.local.expiresAt?'local_login':null,status:current.local.expiresAt?'snapshot':'unavailable'}};
    }
  };
}

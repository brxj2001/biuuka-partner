import {randomBytes,createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
export const trustedOrigin=value=>{try{const u=new URL(value);return u.origin===value&&u.protocol==='https:'&&!u.port&&['biuuka.com','uuco-card.com'].some(root=>u.hostname===root||u.hostname.endsWith('.'+root));}catch{return false;}};
export const validOrigin=value=>{try{const u=new URL(value);return u.origin===value&&u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
const digest=value=>createHash('sha256').update(value).digest('hex');
export const SCOPES=['account','test','notify'];
export function createAccess({now=Date.now,grants=[],persist=async()=>{}}={}){
 const pending=new Map(),saved=new Map(grants.filter(g=>validOrigin(g.origin)&&/^[a-f0-9]{64}$/.test(g.hash)&&Array.isArray(g.scopes)&&g.scopes.every(s=>SCOPES.includes(s))&&(g.expiresAt===null||g.expiresAt>now())).map(g=>[g.id,{id:g.id,hash:g.hash,origin:g.origin,scopes:g.scopes,createdAt:g.createdAt,expiresAt:g.expiresAt}]));let attempts=[];
 const clean=()=>{for(const [key,p]of pending)if(p.expiresAt<=now())pending.delete(key);};
 const flush=()=>persist([...saved.values()]);
 const code=p=>{const h=createHmac('sha256',p.secret).update(String(Math.floor(now()/30000))).digest();return String(h.readUInt32BE(0)%1000000).padStart(6,'0');};
 return {
  start(origin,nonce){clean();if(!validOrigin(origin)||!/^[a-f0-9]{32,128}$/.test(nonce)||pending.size>=100||[...pending.values()].filter(p=>p.origin===origin).length>=3)return null;const id=randomBytes(24).toString('hex');pending.set(id,{origin,nonce,secret:randomBytes(32),expiresAt:now()+300000,tries:0,approved:false});return {ticket:id,expiresAt:now()+300000};},
  view(id){clean();const p=pending.get(id);return p?{origin:p.origin,code:code(p),codeExpiresAt:(Math.floor(now()/30000)+1)*30000,expiresAt:p.expiresAt,approved:p.approved}:null;},
  approve(id,duration,scopes){clean();const p=pending.get(id);if(!p||p.approved||!(duration==='forever'||Number.isInteger(duration)&&duration>=300&&duration<=31536000)||!Array.isArray(scopes)||!scopes.length||scopes.some(s=>!SCOPES.includes(s)))return false;p.approved=true;p.duration=duration;p.scopes=[...new Set(scopes)];return true;},
  async exchange(origin,{ticket,nonce,code:input}){clean();const p=pending.get(ticket);if(!p||p.origin!==origin||p.nonce!==nonce||!p.approved)return null;attempts=attempts.filter(t=>now()-t<60000);if(attempts.length>=30||p.tries>=5)return null;attempts.push(now());p.tries++;const expected=Buffer.from(code(p)),received=Buffer.from(String(input||''));if(received.length!==6||!timingSafeEqual(received,expected))return null;pending.delete(ticket);if(saved.size>=100)return null;const token=randomBytes(32).toString('hex'),grant={id:randomUUID(),hash:digest(token),origin,scopes:p.scopes,createdAt:now(),expiresAt:p.duration==='forever'?null:now()+p.duration*1000};saved.set(grant.id,grant);try{await flush();}catch{saved.delete(grant.id);throw Error('persist_failed');}return {token,id:grant.id,origin,scopes:grant.scopes,expiresAt:grant.expiresAt};},
  permits(token,origin,scope){if(typeof token!=='string'||token.length!==64)return false;const hash=digest(token);return [...saved.values()].some(g=>g.hash===hash&&g.origin===origin&&(g.expiresAt===null||g.expiresAt>now())&&g.scopes.includes(scope));},
  idFor(token,origin){return [...saved.values()].find(g=>g.hash===digest(token)&&g.origin===origin)?.id;},
  list(){return [...saved.values()].map(({hash,...g})=>({...g,expired:g.expiresAt!==null&&g.expiresAt<=now()}));},
  async revoke(id){saved.delete(id);await flush();},
  cancel(id){pending.delete(id);}
 };
}

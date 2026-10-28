import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isIP } from 'node:net';
import { stateDir } from '../core/state.mjs';

export const TARGETS = [
  ['biuuka','Biuuka 下载服务','https://biuuka.com/downloads/biuuka/latest.json'],
  ['mirror','国内下载源','https://registry.npmmirror.com/'],
  ['chatgpt','ChatGPT 网页','https://chatgpt.com/'],
  ['auth','OpenAI 登录','https://auth.openai.com/']
];
export function classify(status) {
  if(status>=200&&status<400)return 'reachable';
  if(status===401)return 'authentication_required';
  if(status===403)return 'blocked_or_challenge';
  if(status===429)return 'rate_limited';
  return 'http_error';
}
// Fixed destinations only. No cookies, credentials, subscription or proxy config is read.
export function createNetwork({request=fetch, now=Date.now, directory=stateDir}={}) {
  let cached, flight,controller=new AbortController();
  async function probe([id,label,url]) {
    const start=now();
    try {
      const response=await request(url,{method:'GET',redirect:'follow',credentials:'omit',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8000)]),headers:{'User-Agent':'Biuuka-network/0.0.1'}});
      await response.body?.cancel();
      return {id,label,status:classify(response.status),httpStatus:response.status,latencyMs:Math.max(0,now()-start)};
    } catch(e) {return {id,label,status:e.name==='TimeoutError'||e.name==='AbortError'?'timeout':'connection_failed',latencyMs:null};}
  }
  async function exitInfo() {
    try {
      const response=await request('https://ipwho.is/?fields=success,ip,country,country_code,region,city,connection.isp,connection.org',{credentials:'omit',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8000)])});
      if(!response.ok){await response.body?.cancel();return {status:'unavailable'};}
      let text='';for await(const chunk of response.body){text+=Buffer.from(chunk).toString('utf8');if(text.length>16384)throw Error('too_large');}
      const d=JSON.parse(text),clean=v=>typeof v==='string'?v.slice(0,160):null;
      if(!d.success||!isIP(d.ip))return {status:'unavailable'};
      return {status:'available',ip:d.ip,country:clean(d.country),countryCode:clean(d.country_code),region:clean(d.region),city:clean(d.city),isp:clean(d.connection?.isp),organization:clean(d.connection?.org)};
    }catch{return {status:'unavailable'};}
  }
  async function source(name){try{const d=JSON.parse(await readFile(path.join(directory,name+'-source.json'),'utf8'));let host=d.source;if(host!=='local-cache')host=new URL(host.includes('://')?host:'https://'+host).hostname;return {name,source:host,verified:d.verified===true};}catch{return {name,source:'existing-or-unknown',verified:false};}}
  const run=async(force=false)=>{
    if(!force&&cached&&now()-Date.parse(cached.checkedAt)<300000)return cached;
    if(flight)return flight;
    flight=(async()=>{const [checks,exit,sources]=await Promise.all([Promise.all(TARGETS.map(probe)),exitInfo(),Promise.all(['node','codex'].map(source))]);
      cached={checkedAt:new Date(now()).toISOString(),cachedForSeconds:300,route:'biuuka-process',latencyKind:'HTTP response headers',ipProvider:'ipwho.is',exit,checks,sources};return cached;
    })().finally(()=>{flight=null;});
    return flight;
  };
  run.cancel=()=>{controller.abort();controller=new AbortController();cached=null;};
  return run;
}

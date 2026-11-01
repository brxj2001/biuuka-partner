// Measure a bounded sample from the actual file, never a mirror homepage.
export async function rankSources(urls,{request=fetch,now=Date.now,timeout=4000,sample=128*1024}={}){
 const results=await Promise.all(urls.map(async(url,index)=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout),start=now();let bytes=0;try{const r=await request(url,{headers:{Range:`bytes=0-${sample-1}`},signal:controller.signal});if(!r.ok){await r.body?.cancel();throw Error('status');}const reader=r.body.getReader();try{while(bytes<sample){const {value,done}=await reader.read();if(done)break;bytes+=value.length;}}finally{await reader.cancel().catch(()=>{});}if(!bytes)throw Error('empty');return {url,index,rate:Math.min(bytes,sample)/Math.max(1,now()-start)};}catch{return {url,index,rate:0};}finally{clearTimeout(timer);controller.abort();}}));
 return results.sort((a,b)=>b.rate-a.rate||a.index-b.index).map(r=>r.url);
}

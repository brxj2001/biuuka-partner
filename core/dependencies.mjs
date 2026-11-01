// The service publishes metadata only; binaries always come from upstream mirrors.
export const CATALOG_URL='https://biuuka.com/downloads/biuuka/dependencies.json';
export const platforms=['darwin-arm64','darwin-x64','win32-arm64','win32-x64'];
export const stable=v=>typeof v==='string'&&/^\d+\.\d+\.\d+$/.test(v);
const tuple=v=>v.replace(/^v/,'').split('.').map(Number);
export function compare(a,b){const x=tuple(a),y=tuple(b);for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]>y[i]?1:-1;}return 0;}
// Fail closed for a new upstream range syntax rather than guessing compatibility.
export function satisfies(version,range){
 if(!stable(version.replace(/^v/,''))||typeof range!=='string')return false;
 return range.split('||').some(part=>{const terms=part.trim().split(/\s+/);return terms.length&&terms.every(term=>{const m=term.match(/^(>=|<=|>|<|=|\^|~)?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);if(!m)return false;const [,op='=',major,minor='0',patch='0']=m,base=`${major}.${minor}.${patch}`,c=compare(version,base);if(op==='>=')return c>=0;if(op==='>')return c>0;if(op==='<=')return c<=0;if(op==='<')return c<0;if(op==='^')return c>=0&&compare(version,`${+major+1}.0.0`)<0;if(op==='~')return c>=0&&compare(version,`${major}.${+minor+1}.0`)<0;return c===0;});});
}
export const nodeCompatible=(version,range)=>satisfies(version,'>=24.0.0')&&satisfies(version,range);
export function mirrors(url){
 const u=new URL(url);
 if(u.origin==='https://registry.npmjs.org')return ['https://registry.npmmirror.com','https://mirrors.huaweicloud.com/repository/npm','https://mirrors.cloud.tencent.com/npm'].map(base=>base+u.pathname);
 if(u.origin==='https://nodejs.org'&&u.pathname.startsWith('/dist/'))return ['https://npmmirror.com/mirrors/node','https://repo.huaweicloud.com/nodejs','https://mirrors.cloud.tencent.com/nodejs-release'].map(base=>base+u.pathname.slice(5));
 throw Error('Untrusted dependency source');
}
export function validateCatalog(data){
 if(data?.format!==1||!stable(data.codex?.version)||!stable(data.node?.recommended)||!nodeCompatible(data.node.recommended,data.codex.nodeRange)||!Number.isFinite(Date.parse(data.checkedAt)))throw Error('Invalid dependency catalog');
 for(const key of platforms){const entry=data.platforms?.[key];if(!entry||!/^[a-z0-9_/-]+(?:\.exe)?$/.test(entry.binary)||entry.binary.split('/').includes('..'))throw Error('Invalid native package');
  const suffix=key.startsWith('darwin')?'tar.gz':'exe',arch=key.split('-')[1];
  const binary=`vendor/${arch==='arm64'?'aarch64':'x86_64'}-${key.startsWith('darwin')?'apple-darwin':'pc-windows-msvc'}/bin/codex${key.startsWith('win')?'.exe':''}`;if(entry.binary!==binary)throw Error('Invalid native executable');
  const expectedNode=`https://nodejs.org/dist/v${data.node.recommended}/`+(key.startsWith('darwin')?`node-v${data.node.recommended}-${key}.tar.gz`:`win-${arch}/node.exe`);
  for(const kind of ['node','codex']){const s=entry[kind],expected=kind==='node'?expectedNode:`https://registry.npmjs.org/@openai/codex/-/codex-${data.codex.version}-${key}.tgz`;
   if(kind==='codex'&&s?.encoding!=='base64')throw Error('Invalid integrity encoding');
   if(s?.url!==expected||s.algorithm!==(kind==='node'?'sha256':'sha512')||!(kind==='node'?/^[a-f0-9]{64}$/.test(s.digest):/^[A-Za-z0-9+/]{86}==$/.test(s.digest))||s.cacheFile!==`${kind}-${kind==='node'?data.node.recommended:data.codex.version}-${key}.${kind==='node'?suffix:'tgz'}`)throw Error('Invalid dependency checksum or path');
   if(JSON.stringify(s.mirrors)!==JSON.stringify(mirrors(expected)))throw Error('Invalid dependency mirrors');
  }
 }
 return data;
}
export async function fetchCatalog({request=fetch,signal}={}){
 const r=await request(CATALOG_URL,{redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('Dependency catalog unavailable');let size=0,parts=[];for await(const b of r.body){size+=b.length;if(size>65536)throw Error('Dependency catalog too large');parts.push(b);}
 const data=validateCatalog(JSON.parse(Buffer.concat(parts)));if(Date.now()-Date.parse(data.checkedAt)>7*86400000||Date.parse(data.checkedAt)>Date.now()+300000)throw Error('Dependency catalog expired');return data;
}

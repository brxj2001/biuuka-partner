let token='';
export function initToken(){const meta=document.querySelector<HTMLMetaElement>('meta[name="console-token"]');if(meta){token=meta.content;meta.remove();}if(!token)throw Error('请运行 biuuka open 重新打开控制台。');}
export async function api<T=Record<string,unknown>>(route:string,body:object={},root='/control/'):Promise<T>{const response=await fetch(root+route,{method:'POST',cache:'no-store',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw Error(result.error||'请求失败');return result;}
export type Window={usedPercent:number;windowDurationMins:number;resetsAt:number};
export type Profile={subscription?:{expiresAt?:string|null;checkedAt?:string|null;source?:string|null;status?:string};plan?:string;limits?:{id:string;primary?:Window;secondary?:Window}[]};
export type Account={id:string;email:string;plan:string;name:string;current:boolean;profile?:Profile;checkedAt?:string};
export type Accounts={accounts:Account[];busy:boolean;operation?:string;storeError?:string;login?:{status:string;authUrl?:string};switchResult?:{status:string}};
export type Status={platform:string;architecture:string;node:string;codex:string;dataDirectory:string;codexHome:string;cacheBytes:number;tray:{running:boolean};settings:{engineEnabled:boolean;networkEnabled:boolean;autoUpdate:boolean;notifications:boolean;boundaryVersion?:number};grants:{id:string;origin:string;scopes:string[];expiresAt:number|null;expired:boolean}[];dependencies?:{node:{latest?:string};codex:{latest?:string};note:string}};
export type Version={version:string;state:string;build?:string};
export type RecordItem={id:string;createdAt:string;preset:string;status:string;answer?:string};

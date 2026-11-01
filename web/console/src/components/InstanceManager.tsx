'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Monitor,RefreshCw} from 'lucide-react';
import {api} from './api';
import {Button,Card,Empty} from './ui';
type Snapshot={status:'available'|'partial'|'unknown'|'unsupported';checkedAt:string;counts:null|{chatgpt:number;codexDesktop:number;codexCli:number};instances:{pid:number;kind:'chatgpt'|'codex-desktop'|'codex-cli'}[]};
const labels={'chatgpt':'ChatGPT 桌面端','codex-desktop':'Codex 桌面端','codex-cli':'Codex CLI / 独立服务'};
export function InstanceManager(){
 const [data,setData]=useState<Snapshot>(),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const mounted=useRef(false),pending=useRef(false);
 const refresh=useCallback(async()=>{if(pending.current)return;pending.current=true;setLoading(true);try{const value=await api<Snapshot>('instances/list');if(mounted.current){setData(value);setError('');}}catch{if(mounted.current){setData(undefined);setError('实例检测失败，请稍后重试。');}}finally{pending.current=false;if(mounted.current)setLoading(false);}},[]);
 useEffect(()=>{mounted.current=true;void refresh();const timer=setInterval(()=>{if(!document.hidden)void refresh();},10000);return()=>{mounted.current=false;clearInterval(timer);};},[refresh]);
 return <><Card><div className="list-row"><div><strong>当前运行实例</strong><p>仅检测本机当前用户，每 10 秒刷新；离开此页面后停止检测。</p></div><Button variant="secondary" disabled={loading} onClick={()=>void refresh()}><RefreshCw size={16}/>{loading?'检测中…':'刷新'}</Button></div><p className="muted">按应用主进程计数，多个窗口不重复计数。过滤辅助进程及伙伴服务启动的查询；独立 Codex CLI 与服务单独统计。不包含浏览器标签页或未启动的安装副本。</p>{data&&<small>检测时间：{new Date(data.checkedAt).toLocaleString('zh-CN')}</small>}</Card>
 {error&&<Card><p role="alert">{error}</p></Card>}
 {data&&data.status!=='available'&&<Card><p role="status">{data.status==='partial'?'部分进程无法读取，以下仅为已识别实例，数量可能不完整。':data.status==='unsupported'?'当前系统尚不支持实例检测。':'无法确认运行实例，请刷新重试；未知状态不表示没有实例。'}</p></Card>}
 {data?.counts&&<><div className="boundary-grid">{[['ChatGPT 桌面端',data.counts.chatgpt],['Codex 桌面端',data.counts.codexDesktop],['Codex CLI / 独立服务',data.counts.codexCli]].map(([name,count])=><Card key={name}><Monitor size={22}/><h2>{name}</h2><strong>{count} 个</strong></Card>)}</div><Card>{data.instances.length?data.instances.map(item=><div className="list-row" key={item.pid}><strong>{labels[item.kind]}</strong><span className="muted">进程 ID：{item.pid}</span></div>):<Empty>当前未检测到运行实例。</Empty>}</Card></>}
 <p className="muted">检测结果仅在本机显示，不上传商城或平台，也不读取账号、命令参数和聊天内容。</p></>;
}

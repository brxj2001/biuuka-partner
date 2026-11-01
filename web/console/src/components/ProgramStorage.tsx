'use client';
import {useEffect,useRef,useState} from 'react';
import {api} from './api';import {Button,Card} from './ui';
type Snapshot={directories:{path:string;roles:string[];bytes:number;files:number;status:'complete'|'partial'|'missing'}[];nodePath:string;codexPath:string;checkedAt:string};
export function ProgramStorage(){
 const [data,setData]=useState<Snapshot>(),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');const mounted=useRef(false),pending=useRef(false);
 async function refresh(){if(pending.current)return;pending.current=true;setBusy(true);setNotice('');try{const value=await api<Snapshot>('storage');if(mounted.current)setData(value);}catch{if(mounted.current)setNotice('程序目录读取失败，请重试。');}finally{pending.current=false;if(mounted.current)setBusy(false);}}
 useEffect(()=>{mounted.current=true;void refresh();return()=>{mounted.current=false;};},[]);
 async function copy(value:string){try{await navigator.clipboard.writeText(value);setNotice('路径已复制，可粘贴到文件管理器查看。');}catch{setNotice('复制失败，请选中下方路径手动复制。');}}
 return <Card><div className="list-row"><div><h2>程序安装与占用</h2><p>安装目录保存服务宿主和运行依赖；自动更新后的运行代码可能位于 .biuuka/app。</p></div><Button variant="secondary" disabled={busy} onClick={()=>void refresh()}>{busy?'统计中…':'刷新占用'}</Button></div>
 {notice&&<p role="status">{notice}</p>}
 {data?.directories.map(d=><div className="list-row" key={d.path}><div style={{minWidth:0}}><strong>{d.roles.map(r=>r==='installation'?'程序安装目录':'当前运行目录').join(' / ')}</strong><p style={{overflowWrap:'anywhere'}}>{d.path}</p><small>{d.status==='missing'?'目录不存在':`${d.status==='partial'?'已统计部分：':''}${(d.bytes/1048576).toFixed(1)} MB · ${d.files} 个文件`}{d.status==='partial'?'（部分路径不可读、为链接或超出统计范围）':''}</small></div><Button variant="ghost" onClick={()=>void copy(d.path)}>复制路径</Button></div>)}
 {data&&<><dl className="details"><dt>Node 程序</dt><dd style={{overflowWrap:'anywhere'}}>{data.nodePath}</dd><dt>Codex CLI 程序</dt><dd style={{overflowWrap:'anywhere'}}>{data.codexPath}</dd></dl><small>统计时间：{new Date(data.checkedAt).toLocaleString('zh-CN')}</small></>}
 <p className="muted">占用按文件大小统计，目录间可能包含相同文件，不相加作为总占用。此处只读取文件信息，不读取文件内容。移除程序请使用下方“卸载 Biuuka”，下载缓存可单独清理。</p>
 </Card>;
}

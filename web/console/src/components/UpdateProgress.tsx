'use client';
import {useEffect,useState} from 'react';
import {api,type Version} from './api';
const phases:Record<string,string>={checking:'检查版本',downloading:'下载安装包',download_and_verify:'下载与校验',verifying:'校验安装包',staging:'准备更新文件',wait_idle:'等待本机任务结束',switch_files:'切换程序',start_new_version:'启动并检查新版本',cleanup:'清理旧版本',complete:'已完成',rollback:'恢复原版本'};
export function UpdateProgress({version,onVersion}:{version?:Version;onVersion:(value:Version)=>void}){
 const [lost,setLost]=useState(false),[tick,setTick]=useState(Date.now());
 useEffect(()=>{let stopped=false,pending=false;const refresh=async()=>{if(pending||document.visibilityState==='hidden')return;pending=true;try{const next=await api<Version>('status',{},'/update/');if(!stopped){onVersion(next);setLost(false);}}catch{if(!stopped)setLost(true);}finally{pending=false;if(!stopped)setTick(Date.now());}};void refresh();const timer=setInterval(()=>void refresh(),1000);return()=>{stopped=true;clearInterval(timer);};},[onVersion]);
 const u=version?.update;if(!u)return <p className="muted">更新时会显示下载、校验与切换进度；旧版更新器不提供过程信息。</p>;
 const terminal=u.status!=='running',download=u.phase==='downloading',percent=download&&u.totalBytes&&u.receivedBytes!=null?Math.min(100,Math.floor(u.receivedBytes/u.totalBytes*100)):undefined;
 const text=u.reason==='installer_required'?'需要重新运行安装器，后台更新无法完成本次升级。':u.reason==='busy'?'本机任务尚未结束，本次更新已推迟；空闲后可重新点击更新。':u.reason==='network_disabled'?'联网授权已关闭，更新已取消。':u.status==='updated'?'更新成功，新版本已启动。':u.status==='latest'?'当前程序已是最新构建。':u.status==='interrupted'?'更新进度长时间未变化，请重新检查或运行安装器。':u.status==='deferred'?'更新失败，保留原程序；可检查网络后重试。':u.status==='cancelled'?'更新已取消。':phases[u.phase||'']||'正在准备更新';
 const seconds=u.startedAt?Math.max(0,Math.floor(((terminal?Date.parse(u.updatedAt||u.checkedAt||''):tick)-Date.parse(u.startedAt))/1000)):null;
 return <div className="info-box" role="status" aria-live="polite"><strong>{text}</strong>{u.targetVersion&&<p>目标版本：{u.targetVersion}</p>}{!terminal&&<progress aria-label="更新进度" max={100} value={percent}/>}<p>{download&&u.receivedBytes!=null?`已下载 ${(u.receivedBytes/1024).toFixed(0)} KB${u.totalBytes?` / ${(u.totalBytes/1024).toFixed(0)} KB · ${percent}%`:''}`:phases[u.phase||'']}{Number.isFinite(seconds)&&seconds!==null?` · 耗时 ${seconds} 秒`:''}</p>{u.code&&<p>原因代码：{u.code}</p>}{u.updatedAt&&<small>最近进度：{new Date(u.updatedAt).toLocaleString('zh-CN')}</small>}{lost&&<p>连接暂时中断，正在等待本机服务恢复；尚未确认更新完成。</p>}</div>;
}

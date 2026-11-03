'use client';
import {VisualScore} from './VisualScore';
import {useEffect,useState} from 'react';
import {api} from './api';
import {Button} from './ui';
import type {VisualScoreResult} from './VisualScore';
export function ScorePanel({id}:{id:string}){
 const [result,setResult]=useState<VisualScoreResult>(),[error,setError]=useState('');
 useEffect(()=>{let stopped=false;setResult(undefined);const load=async()=>{try{const r=await api<{scores:VisualScoreResult[]}>('scoring/list',{id});if(!stopped){setResult(r.scores[0]);setError('');}}catch{if(!stopped)setError('暂时无法读取本机评分结果');}};void load();const timer=setInterval(()=>void load(),5000);return()=>{stopped=true;clearInterval(timer);};},[id]);
 async function download(){try{const {svg}=await api<{svg:string}>('scoring/export',{id});const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'})),a=document.createElement('a');a.href=url;a.download='biuuka-score.svg';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch{setError('暂时无法下载评分作品');}}
 return <section className="score-panel"><h3>作品评分</h3><p className="muted">测试完成后自动评分。关闭联网或服务时暂停，恢复后自动继续。</p>{error&&<p role="status">{error}</p>}<VisualScore result={result}/><Button variant="secondary" onClick={()=>void download()}>下载作品</Button></section>;
}

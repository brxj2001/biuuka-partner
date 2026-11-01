'use client';
import {useEffect,useRef,useState} from 'react';
import {Code2,Eye} from 'lucide-react';
import {Modal} from './ui';
import {api,type RecordItem} from './api';

function markup(answer:string){
 const blocks=[...answer.matchAll(/```(?:html|svg|xml)?\s*\n([\s\S]*?)```/gi)].map(m=>m[1]);
 return [...blocks,answer].find(value=>/^\s*(?:<!doctype\s+html|<html\b|<svg\b|<(?:div|main|section|style|canvas|body)\b)/i.test(value))||null;
}
export function RecordViewer({record,onClose}:{record:RecordItem;onClose:()=>void}){
 const [current,setCurrent]=useState(record),[error,setError]=useState('');
 const answer=current.answer||'',running=current.status==='running',preview=running?null:markup(answer);
 const [view,setView]=useState<'preview'|'source'>(record.status!=='running'&&markup(answer)?'preview':'source');
 const [shown,setShown]=useState(answer),output=useRef<HTMLPreElement>(null),follow=useRef(true);
 useEffect(()=>{
  if(!running)return;
  let stopped=false,timer:ReturnType<typeof setTimeout>;
  const refresh=async()=>{
   if(document.visibilityState==='hidden'){timer=setTimeout(refresh,500);return;}
   try{const next=await api<RecordItem>('record',{id:record.id});if(stopped)return;setCurrent(next);setError('');if(next.status!=='running')return;}
   catch{if(stopped)return;setError('暂时无法更新，正在重试…');}
   timer=setTimeout(refresh,500);
  };
  void refresh();return()=>{stopped=true;clearTimeout(timer);};
 },[record.id,running]);
 useEffect(()=>{
  const reduce=window.matchMedia('(prefers-reduced-motion: reduce)');
  if(!running||reduce.matches){setShown(answer);return;}
  const timer=setInterval(()=>setShown(previous=>{
   if(!answer.startsWith(previous))return answer;
   const rest=Array.from(answer.slice(previous.length));
   return previous+rest.slice(0,Math.max(1,Math.ceil(rest.length/8))).join('');
  }),32);
  return()=>clearInterval(timer);
 },[answer,running]);
 useEffect(()=>{if(follow.current&&output.current)output.current.scrollTop=output.current.scrollHeight;},[shown]);
 const label=error||(running?(answer?'正在输出…':'正在运行，等待回答…'):({complete:'已完成',failed:'测试失败，保留已输出内容',cancelled:'已取消',interrupted:'测试已中断'}[current.status]||''));
 return <Modal title="测试结果" className="record-viewer" onClose={onClose}>
  <div className="result-toolbar"><div className="result-tabs" role="group" aria-label="结果视图">
   {preview&&<button aria-pressed={view==='preview'} onClick={()=>setView('preview')}><Eye size={16}/>效果预览</button>}
   <button aria-pressed={view==='source'} onClick={()=>setView('source')}><Code2 size={16}/>源码 / 回答</button>
  </div><span className="muted" role="status">{label}</span></div>
  {view==='preview'&&preview?<iframe title="测试效果预览" className="result-preview" sandbox="allow-scripts" referrerPolicy="no-referrer" src="/record-preview" onLoad={e=>e.currentTarget.contentWindow?.postMessage({type:'biuuka-record-preview',source:preview},'*')}/>:<pre className="answer" ref={output} onScroll={e=>{const el=e.currentTarget;follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<48;}}><code>{shown||(running?'等待模型输出…':'没有保存的回答')}{running&&<span className="answer-cursor" aria-hidden="true">▍</span>}</code></pre>}
 </Modal>;
}

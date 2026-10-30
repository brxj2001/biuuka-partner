'use client';
import {useState} from 'react';
import {Code2,Eye} from 'lucide-react';
import {Modal} from './ui';

function markup(answer:string){
 const blocks=[...answer.matchAll(/```(?:html|svg|xml)?\s*\n([\s\S]*?)```/gi)].map(m=>m[1]);
 return [...blocks,answer].find(value=>/^\s*(?:<!doctype\s+html|<html\b|<svg\b|<(?:div|main|section|style|canvas|body)\b)/i.test(value))||null;
}
export function RecordViewer({answer,onClose}:{answer:string;onClose:()=>void}){
 const preview=markup(answer),[view,setView]=useState<'preview'|'source'>(preview?'preview':'source');
 return <Modal title="测试结果" className="record-viewer" onClose={onClose}>
  <div className="result-toolbar"><div className="result-tabs" role="group" aria-label="结果视图">
   {preview&&<button aria-pressed={view==='preview'} onClick={()=>setView('preview')}><Eye size={16}/>效果预览</button>}
   <button aria-pressed={view==='source'} onClick={()=>setView('source')}><Code2 size={16}/>源码 / 回答</button>
  </div>{view==='preview'&&<span className="muted">HTML / SVG · 不执行脚本</span>}</div>
  {view==='preview'&&preview?<iframe title="测试效果预览" className="result-preview" sandbox="allow-scripts" referrerPolicy="no-referrer" src="/record-preview" onLoad={e=>e.currentTarget.contentWindow?.postMessage({type:'biuuka-record-preview',source:preview},'*')}/>:<pre className="answer"><code>{answer||'没有保存的回答'}</code></pre>}
 </Modal>;
}

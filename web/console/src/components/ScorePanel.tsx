'use client';
import {VisualScore} from './VisualScore';
import {useEffect,useState,useRef} from 'react';import {api,type RecordItem} from './api';import {Button} from './ui';
type Score={caption?:string;httpStatus?:number;inputKind?:string;provider:string;status:string;score?:number;machineScore?:number;visionScore?:number;mode?:string;resultUrl?:string;checkedAt?:string;feedback?:string;message?:string;version?:string;judge?:string;details?:{name:string;score?:number;maxScore?:number;passed?:boolean;reason?:string}[]};
const messages:Record<string,string>={score_dns_failed:'无法解析评分服务地址，请检查网络。',score_tls_failed:'无法验证评分服务证书，请检查系统时间和网络。',score_timeout:'评分请求超时，请查询原任务。',score_connection_failed:'无法连接评分服务，请检查网络后查询原任务。',score_response_invalid:'评分响应暂不可读，请查询原任务。',score_too_large:'SVG 不能超过 1 MB。',score_svg_required:'请使用单个 SVG 作品评分。',score_standalone_required:'作品依赖 SVG 外的样式或脚本，请使用独立 SVG。',score_unsafe_svg:'SVG 包含脚本、嵌入图像或外部引用，暂不能评分。',score_remote_failed:'评分服务暂不可用，请稍后查询原任务。',network_disabled:'联网或服务已关闭，无法提交评分。',score_busy:'评分服务繁忙，请稍后重试。'};
export function ScorePanel({id,snapshotSvg,inputError}:{id:string;snapshotSvg?:string;inputError?:string}){
 const visualPolls=useRef(0);
 const [scores,setScores]=useState<Score[]>([]),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[visualConfirm,setVisualConfirm]=useState(false),[legacy,setLegacy]=useState(false);
 async function load(){const r=await api<{scores:Score[]}>('scoring/list',{id});setScores(r.scores);}
 async function download(){if(busy)return;setBusy(true);try{const r=await api<{svg:string}>('scoring/export',{id,...(snapshotSvg?{snapshotSvg}:{})});const url=URL.createObjectURL(new Blob([r.svg],{type:'image/svg+xml'})),a=document.createElement('a');a.href=url;a.download='biuuka-score.svg';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice('已下载评分用 SVG，未上传。');}catch(e){setNotice(messages[e instanceof Error?e.message:'']||'评分 SVG 导出失败');}finally{setBusy(false);}}
 useEffect(()=>{visualPolls.current=0;setLegacy(false);void load().catch(()=>setNotice('评分记录读取失败'));},[id]);
 useEffect(()=>{if(busy||legacy||!scores.some(s=>s.provider==='openenv-vision'&&s.status==='pending'))return;const t=setInterval(()=>{if(document.visibilityState==='visible'&&visualPolls.current++<40)void visual(true);},4000);return()=>clearInterval(t);},[id,scores,busy,legacy]);
 async function visual(refresh=false){if(busy)return;setBusy(true);setNotice('');try{const r=await api<{legacy?:boolean}>(refresh?'scoring/visualRefresh':'scoring/visualSubmit',{id,...(!refresh&&snapshotSvg?{snapshotSvg}:{})});if(r.legacy){setLegacy(true);setNotice('这是旧版商城账号任务，需从原商城账号查询；不会自动重复评分。');}else setNotice('');}catch(e){setNotice(messages[e instanceof Error?e.message:'']||'评分暂未完成，请查询原任务。');}finally{setVisualConfirm(false);await load().catch(()=>{});setBusy(false);}}
 async function legacyVisual(){if(busy)return;const popup=window.open('about:blank','_blank');if(popup)popup.opener=null;setBusy(true);try{const r=await api<{ticket:string}>('scoring/visualStart',{id,...(snapshotSvg?{snapshotSvg}:{})});const url='https://biuuka.com/chatgpt#biuuka-score='+encodeURIComponent(r.ticket)+'&port='+window.location.port;if(popup){popup.location.replace(url);setNotice('请在商城窗口登录并确认评分，结果会回到此记录。');}else{setNotice('浏览器阻止了新窗口，请允许本站弹窗后重新点击。');}await load();}catch(e){popup?.close();setNotice(messages[e instanceof Error?e.message:'']||'无法开始视觉评分');}finally{setBusy(false);}}
 return <section className="score-panel"><h3>作品评分</h3>
 {inputError?<p role="status">{messages[inputError]||'无法准备静态 SVG，请切换到效果预览重试。'}</p>:!snapshotSvg?<p role="status">正在准备作品…</p>:null}
 {notice&&<p role="status">{notice}</p>}
 {visualConfirm&&<div role="alert"><p>提交当前作品进行评分？</p><div className="actions"><Button disabled={busy} onClick={()=>void visual()}>确认评分</Button><Button variant="secondary" disabled={busy} onClick={()=>setVisualConfirm(false)}>取消</Button></div></div>}
 {legacy&&<Button disabled={busy} onClick={()=>void legacyVisual()}>查询旧版商城任务</Button>}
 <VisualScore result={scores.find(s=>s.provider==='openenv-vision')} busy={busy} ready={!!snapshotSvg&&!inputError} onSubmit={()=>setVisualConfirm(true)} onRefresh={()=>void visual(true)}/><div className="actions"><Button variant="secondary" disabled={busy||(!snapshotSvg&&!!inputError)} onClick={()=>void download()}>下载作品</Button></div>
 </section>;
}

export function ScoreImport({onImported}:{onImported:(record:RecordItem)=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 return <div><h3>导入 SVG 对比评分</h3><p className="muted">选择已有的独立 SVG 作品，仅保存到本机。打开记录后可使用 Biuuka 作品评分；导入不会生成模型对话或上传。</p><input type="file" accept=".svg,image/svg+xml" aria-label="导入评分 SVG" disabled={busy} onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;if(file.size>1048576){setError('SVG 不能超过 1 MB');return;}setBusy(true);setError('');try{onImported(await api<RecordItem>('scoring/import',{svg:await file.text()}));}catch(err){const key=err instanceof Error?err.message:'';setError(messages[key]||'SVG 导入失败');}finally{setBusy(false);}}}/>{error&&<p role="alert">{error}</p>}<hr/></div>;
}

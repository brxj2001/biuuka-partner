'use client';
import {Button} from './ui';
export type VisualScoreResult={status:string;score?:number;machineScore?:number;visionScore?:number;judge?:string;caption?:string;message?:string;checkedAt?:string;details?:{name:string;passed?:boolean}[]};
export function VisualScore({result,busy,ready,onSubmit,onRefresh}:{result?:VisualScoreResult;busy:boolean;ready:boolean;onSubmit:()=>void;onRefresh:()=>void}){
 const complete=result?.status==='completed';
 return <div className="list-row"><div style={{minWidth:0,width:'100%'}}><strong>自部署 · OpenEnv 视觉评分</strong><p>由硅基流动视觉模型查看静态图片，结合 SVG 结构评分。不加入第三方公开榜单。</p>
 {complete?<><div className="score-summary"><strong>{result.score}<small> / 100</small></strong><div><p>视觉判断 {result.visionScore??'—'} / 65 · 结构检查 {result.machineScore??'—'} / 35</p><p>表示作品符合绘图要求的程度，不代表模型智商。</p></div></div><p className="muted">与 Pelican Score 使用不同评分标准，分数不能直接比较。</p>{result.judge&&<p>视觉评委：{result.judge}</p>}{result.caption&&<details><summary>评委看到的画面</summary><p>{result.caption}</p></details>}{result.details?.length?<details><summary>视觉检查明细</summary>{result.details.map(d=><p key={d.name}>{d.passed?'✓':'✕'} {d.name} · {d.passed?'符合':'未确认符合'}</p>)}</details>:null}</>:<p role="status">{({pending:'正在评分，可查询原任务',submitting:'正在提交',unknown:'暂未取得结果，请查询原任务',failed:'评分失败，未产生完整分数',rate_limited:'评分配额暂不可用'} as Record<string,string>)[result?.status||'']||'尚未评分'}</p>}
 {result?.message&&<p>{result.message}</p>}{result?.checkedAt&&<small>查询时间：{new Date(result.checkedAt).toLocaleString('zh-CN')}</small>}
 <div className="actions">{!complete&&<Button variant="secondary" disabled={busy||(!result&&!ready)} onClick={result?onRefresh:onSubmit}>{busy?'处理中…':result?'查询评分':'开始视觉评分'}</Button>}</div>
 </div></div>;
}

'use client';
export type VisualScoreResult={status:string;score?:number;machineScore?:number;visionScore?:number;judge?:string;caption?:string;message?:string;checkedAt?:string;details?:{name:string;passed?:boolean}[]};
export function VisualScore({result}:{result?:VisualScoreResult}){
 const complete=result?.status==='completed';
 return <div className="list-row"><div style={{minWidth:0,width:'100%'}}><strong>评分结果</strong>
 {complete?<><div className="score-summary"><strong>{result.score}<small> / 100</small></strong><div><p>画面 {result.visionScore??'—'} / 65 · 结构 {result.machineScore??'—'} / 35</p><p>绘图要求符合度</p></div></div>{result.caption&&<details><summary>画面描述</summary><p>{result.caption}</p></details>}{result.details?.length?<details><summary>评分明细</summary>{result.details.map(d=><p key={d.name}>{d.passed?'✓':'✕'} {d.name} · {d.passed?'符合':'未确认符合'}</p>)}</details>:null}</>:<p role="status">{({not_submitted:'等待后台自动提交',rejected:'服务未接受任务',expired:'服务器结果已过期',pending:'正在评分，结果将自动更新',submitting:'正在提交',unknown:'暂未取得结果，后台正在核对原任务',failed:'评分失败，未产生完整分数',rate_limited:'评分配额暂不可用'} as Record<string,string>)[result?.status||'']||'暂无评分结果，新测试完成后自动评分'}</p>}
 {result?.checkedAt&&<small>查询时间：{new Date(result.checkedAt).toLocaleString('zh-CN')}</small>}

 </div></div>;
}

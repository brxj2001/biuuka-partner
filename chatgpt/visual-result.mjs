const labels={subject_recognisable:'能辨认出鹈鹕',vehicle_recognisable:'能辨认出自行车',riding_posture:'骑乘姿态',coherent_figure:'形体连接连贯',subject_feature_0:'长喙',subject_feature_1:'喙下喉囊',vehicle_feature_0:'两个大小相近的车轮',vehicle_feature_1:'连接车轮的车架',vehicle_feature_2:'车把'};
const number=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1;
const text=x=>typeof x==='string'?x.slice(0,2000):'';
export function visualResult(s){
 const fail=()=>{throw Object.assign(Error('score_response_invalid'),{code:'score_response_invalid'});};
 if(!s||s.mode!=='vision'||!s.breakdown)fail();
 if(s.gatePassed===false)return {status:'failed',mode:'vision',message:'SVG 未通过安全或有效绘图检查，未调用视觉评委。',version:text(s.version)};
 const b=s.breakdown,j=b.judge;
 if(s.judged!==true||b.judged!==true||!number(b.structure_score)||!number(b.semantic_score)||!j||j.error||!j.checklist||typeof j.checklist!=='object')fail();
 if(Object.keys(labels).some(k=>typeof j.checklist[k]!=='boolean'))fail();
 const expected=(b.structure_score*.35+b.semantic_score*.65)*100;
 if(typeof s.score!=='number'||!Number.isFinite(s.score)||Math.abs(s.score-expected)>.02)fail();
 return {status:'completed',mode:'vision',score:s.score,maxScore:100,machineScore:Math.round(b.structure_score*3500)/100,visionScore:Math.round(b.semantic_score*6500)/100,machineMax:35,visionMax:65,judge:text(s.model),version:text(s.version),caption:text(j.caption),details:Object.entries(labels).map(([k,name])=>({name,passed:j.checklist[k]})),feedback:'按 OpenEnv 规则评价画面与结构，分数表示作品符合绘图要求的程度。',message:'',httpStatus:null};
}

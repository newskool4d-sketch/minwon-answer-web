import { createHash, randomUUID } from 'node:crypto';

export const fields = [
  ['general','일반행정·교육정책','정책 적용 대상과 담당 기관, 기존 안내를 확인합니다.',['적용 대상','담당 기관','안내 이력']],
  ['curriculum','교육과정·수업·평가','학교급, 학사 운영과 평가 기준을 구분합니다.',['학교급','평가 기준','학교 확인']],
  ['personnel','교원·지방공무원 인사','신분과 적용 규정을 확인하고 제3자 인사정보를 보호합니다.',['신분 구분','적용 규정','인사정보 보호']],
  ['student','학생생활·학교폭력','학생 보호와 확인된 사실, 현재 처리 단계를 먼저 확인합니다.',['학생 보호','처리 단계','절차·권한']],
  ['special','특수교육·통합교육','지원 신청과 절차를 확인하고 장애·건강정보를 최소화합니다.',['지원 신청','지원 절차','민감정보 최소화']],
  ['admission','입학·전학·학교배정','학교급, 신청 단계와 현재 적용 공고를 확인합니다.',['학교급','신청 단계','배정 기준']],
  ['care','돌봄·방과후학교','신청·선정 기준과 운영 방식, 안내 이력을 확인합니다.',['선정 기준','운영 방식','안내 이력']],
  ['facility','시설·안전·체험교육','관리 주체와 안전 조치, 참가·대관·환불 기준을 확인합니다.',['관리 주체','안전 조치','운영 기준']],
  ['health','급식·보건','신고·확인 내용과 조치 이력을 구분합니다.',['확인 내용','조치 이력','건강정보 보호']],
  ['budget','예산·회계·계약','집행·계약 단계, 공개 자료와 감사·신고 소관을 확인합니다.',['집행 단계','공개 자료','신고 소관']],
  ['disclosure','정보공개·개인정보','청구 취지, 제3자 정보와 공개 판단 근거를 구분합니다.',['청구 취지','제3자 정보','공개 근거']],
  ['other','기타·직접 입력','본문에 분야 설명과 담당 기관 확인사항을 적어 주세요.',['분야 설명','담당 기관','확인 사항']]
].map(([id,label,hint,checks]) => ({id,label,hint,checks}));
export const types = ['일반민원','고충민원','제안','예산낭비신고','제도개선','민원·정책 질의응답','국민생각함','선순환 이슈카드'];
export const directions = ['검토 후 결정','수용 가능','일부 수용','수용 곤란','보완 요청','이송·재지정','반복·종결 검토'];
export const stages = ['draft','review','rewrite'];
export const checkKeys = ['facts','privacy','jurisdiction','deadline','sources'];
export const emptyCase = () => Object.fromEntries(['title','field','type','body','facts','questions','actions','department','receivedAt','deadline','evidenceText'].map(k => [k,'']).concat([['direction','검토 후 결정']]));
export const example = {classification:'fictional',case:{...emptyCase(),title:'체험교육 참가 확정 안내 누락',field:'facility',type:'일반민원',direction:'수용 가능',body:'체험교육 프로그램에 신청했으나 결과 안내를 받지 못했습니다. 신청이 정상적으로 처리되었는지와 앞으로의 안내 방법을 알려 주세요. 모든 내용은 가상 사례입니다.',facts:'신청은 정상 접수되어 참가 확정되었습니다. 담당자가 확인한 결과 안내 문자 발송 대상에서 누락된 사실이 확인되었습니다.',questions:'신청이 정상 처리되었나요?\n안내 누락에 대해 어떤 조치를 하나요?',actions:'참가 확정 내용을 다시 안내하고, 발송 결과를 담당자가 확인하는 절차를 보완할 예정입니다.',department:'체험교육 운영팀(가상)',receivedAt:'2026-10-19',deadline:'2026-10-26',evidenceText:'가상 사례의 신청 접수 기록과 안내 이력. 실제 법령이나 실제 사건의 근거가 아닙니다.'}};
export const demoProvider = {id:'demo',name:'데모 · 외부 전송 없음',status:'connected',message:'가상 사례의 작성 흐름만 체험합니다. AI 결과가 아닙니다.',models:[{id:'default',label:'가상 사례 규칙 기반'}],canLogin:false};
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export class AppError extends Error { constructor(code,message,status=400){super(message);this.code=code;this.status=status;} }
export const fail = (code,message,status) => {throw new AppError(code,message,status);};
export const clone = value => structuredClone(value);
export function newState(){return {revision:0,case:emptyCase(),classification:'fictional',selections:Object.fromEntries(stages.map(k=>[k,{provider:'demo',model:'default'}])),providers:[clone(demoProvider)],geminiConnected:false,geminiModels:[],versions:[],currentVersionId:null,running:null};}
export const current = state => state.versions.find(v => v.id===state.currentVersionId) || null;
export const caseHash = state => hash({case:state.case,classification:state.classification});
export function validateCase(value){
  if(!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_CASE','민원 입력 형식을 확인해 주세요.');
  const result=emptyCase();
  for(const key of Object.keys(result)) {if(value[key]!==undefined){if(typeof value[key]!=='string'||value[key].length>30000)fail('INVALID_INPUT','입력은 항목별 30,000자 이내의 텍스트여야 합니다.');result[key]=value[key];}}
  if(result.field && !fields.some(f=>f.id===result.field))fail('INVALID_FIELD','지원하는 민원 분야를 선택해 주세요.');
  if(result.type && !types.includes(result.type))fail('INVALID_TYPE','지원하는 처리 유형을 선택해 주세요.');
  if(!directions.includes(result.direction))fail('INVALID_DIRECTION','답변 방향을 확인해 주세요.');
  return result;
}
export function requireInput(state){if(!state.case.body.trim()||!state.case.field||!state.case.type)fail('INPUT_REQUIRED','민원 본문·분야·처리 유형을 입력하고 저장해 주세요.');}
export function questionList(state){return state.case.questions.split(/\n/).map(x=>x.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim()).filter(Boolean).slice(0,30);}
export function redact(value){
  const redactions=[]; const warnings=[];
  const visit=(v,path='')=>{
    if(typeof v==='string'){
      let text=v; const patterns=[[/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[이메일]','이메일'],[/\b(?:01[016789]|0[2-6][1-5]?)[- .]?\d{3,4}[- .]?\d{4}\b/g,'[연락처]','연락처'],[/\b\d{6}\s*[-–]\s*[1-8]\d{6}\b/g,'[식별번호]','식별번호'],[/(?:성명|이름)\s*[:：]\s*[가-힣]{2,4}/g,'이름: [이름]','이름']];
      for(const [pattern,replacement,label] of patterns){let count=0;text=text.replace(pattern,()=>{count++;return replacement;});if(count)redactions.push({field:path,type:label,count});}
      if(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/u.test(text)){warnings.push('비가시·방향 제어 문자를 제거한 사본입니다. 의미를 직접 확인해 주세요.');text=text.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/gu,'');}
      if(/이전\s*(?:지시|명령).*무시|시스템\s*프롬프트|토큰.*출력|ignore\s+(?:all\s+)?previous/i.test(text))warnings.push('AI 동작을 바꾸려는 외부 입력이 감지되었습니다. 민원 내용으로만 처리하며 본문 반영 여부를 검토합니다.');
      return text;
    }
    if(Array.isArray(v))return v.map((x,i)=>visit(x,`${path}[${i}]`));
    if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,visit(x,path?`${path}.${k}`:k)]));
    return v;
  };
  const result=visit(value);warnings.push('자동 마스킹은 모든 개인정보를 찾지 못합니다. 학교·사건 조합 등 재식별 정보도 직접 확인해 주세요.');
  return {value:result,redactions,warnings:[...new Set(warnings)]};
}
export function makePayload(state,stage,{findingIds=[],instructions=''}={}){
  if(!stages.includes(stage))fail('INVALID_STAGE','작성 단계를 확인해 주세요.');requireInput(state);
  const version=current(state);if(stage!=='draft'&&!version)fail('DRAFT_REQUIRED','먼저 초안을 생성해 주세요.');
  if(typeof instructions!=='string'||instructions.length>5000)fail('INVALID_INSTRUCTION','재작성 지시는 5,000자 이내로 입력해 주세요.');
  if(!Array.isArray(findingIds)||findingIds.some(x=>typeof x!=='string'))fail('INVALID_FINDINGS','반영할 검토 의견을 확인해 주세요.');
  if(stage==='rewrite'&&(!version.review||!reviewValid(state,version)))fail('REVIEW_REQUIRED','현재 답변에 대한 검토를 먼저 실행해 주세요.');
  const selected=(version?.review?.findings||[]).filter(f=>findingIds.includes(f.id));
  return {stage,model:state.selections[stage].model,input:{...state.case,fieldLabel:fields.find(f=>f.id===state.case.field)?.label,fieldChecks:fields.find(f=>f.id===state.case.field)?.checks,classification:state.classification,questionList:questionList(state),verifiedEvidence:(version?.evidence||[]).map(({checkedBy,...evidence})=>evidence)},answer:stage==='draft'?undefined:version.answer,findings:stage==='rewrite'?selected:undefined,instructions};
}
export function appendVersion(state,result,source,parentId=null){
  if(!result||typeof result.answer!=='string'||!result.answer.trim()||result.answer.length>60000)fail('INVALID_AI_OUTPUT','답변 형식이 올바르지 않습니다. 직전 작업을 보존했습니다.',502);
  const parent=current(state);
  const inherited=(parent?.evidence||[]).filter(e=>e.status==='manual'||!e.title||!parent.answer.includes(e.title)||result.answer.includes(e.title));
  const incoming=(Array.isArray(result.evidence)?result.evidence:[]).filter(e=>e&&typeof e==='object').map(e=>({id:randomUUID(),title:String(e.title||''),article:String(e.article||''),url:String(e.url||''),quote:String(e.excerpt||e.quote||''),effectiveDate:String(e.effectiveDate||''),status:'unverified'}));
  const evidence=[...new Map([...clone(inherited),...incoming].map(e=>[`${e.status}:${e.title}:${e.url}`,e])).values()];
  const version={id:randomUUID(),number:state.versions.length+1,answer:result.answer,summary:String(result.summary||''),questions:Array.isArray(result.questions)?result.questions.filter(x=>typeof x==='string'):questionList(state),unresolved:Array.isArray(result.unresolved)?result.unresolved.filter(x=>typeof x==='string'):[],createdAt:new Date().toISOString(),source,parentId,caseHash:caseHash(state),review:null,checks:Object.fromEntries(checkKeys.map(k=>[k,false])),evidence,confirmed:false};
  for(const old of state.versions)old.confirmed=false;state.versions.push(version);state.currentVersionId=version.id;state.revision++;return version;
}
export function demoGenerate(state,stage,payload){
  if(stage==='review'){
    const version=current(state), paragraphs=version.answer.split(/\n\s*\n/).filter(Boolean);
    return {summary:'데모의 규칙 기반 검토입니다. 사실·법령의 진위를 확인한 AI 검토가 아닙니다.',findings:[{id:randomUUID(),severity:'advice',category:'문체',paragraph:'답변 전체',reason:'담당자가 질문별 설명을 더 짧고 명확하게 다듬을 수 있습니다.',suggestion:'핵심 결론과 조치사항을 중심으로 문장을 정리해 주세요.'}],mapping:questionList(state).map((question,i)=>({question,answered:true,paragraph:paragraphs.find(p=>p.includes(`질문 ${i+1}`))||paragraphs[1]||paragraphs[0]||''}))};
  }
  if(stage==='rewrite'){
    const version=current(state);let answer=version.answer;
    if(payload.instructions.includes('간결')||payload.findings?.length)answer=answer.replace('다음과 같이 안내드립니다.','안내드립니다.').replace(/확인된 사실에 따르면,\s*/g,'확인 결과, ');
    return {answer,summary:'선택한 검토 의견을 바탕으로 표현을 정리한 데모 재작성입니다. 새로운 사실은 추가하지 않았습니다.',questions:questionList(state),unresolved:clone(version.unresolved),evidence:[]};
  }
  const c=state.case;const questions=questionList(state);const unresolved=[];
  const fact=c.facts.trim()||'[확인 필요: 처리 사실과 확인 자료]';if(!c.facts.trim())unresolved.push('처리 사실과 확인 자료');
  const action=c.actions.trim()||'[확인 필요: 기관의 조치사항]';if(!c.actions.trim())unresolved.push('기관의 조치사항');
  const parts=[`귀하께서 문의하신 ${c.title.trim()||fields.find(f=>f.id===c.field).label+' 관련 사항'}에 대하여 다음과 같이 안내드립니다.`,`확인된 사실에 따르면, ${fact}`];
  if(questions.length)questions.forEach((q,i)=>parts.push(`질문 ${i+1}. ${q}\n${i===0?fact:action}`));else parts.push(action);
  if(c.direction==='수용 곤란'){parts.push('[확인 필요: 수용 곤란 사유와 근거]');unresolved.push('수용 곤란 사유와 근거');}
  if(questions.length<2)parts.push(action);
  if(c.department.trim())parts.push(`추가 문의 사항은 ${c.department.trim()}에 문의해 주시기 바랍니다.`);else{parts.push('[확인 필요: 문의 부서]');unresolved.push('문의 부서');}
  return {answer:parts.join('\n\n'),summary:'입력한 사실과 조치사항만으로 조립한 가상 사례 데모입니다. AI 생성 결과가 아닙니다.',questions,unresolved,evidence:[]};
}
export function reviewValid(state,version){return Boolean(version?.review&&version.review.versionId===version.id&&version.review.answerHash===hash(version.answer)&&version.review.caseHash===caseHash(state)&&version.caseHash===caseHash(state));}
const finding=(category,reason,suggestion,paragraph='답변 전체')=>({id:randomUUID(),severity:'blocker',category,paragraph,reason,suggestion});
function citationIssues(version){
  const text=version.answer;const titles=[...text.matchAll(/「([^」]+)」/g)].map(m=>m[1]);const article=/제\s*\d+\s*조/.test(text);
  const records=version.evidence.filter(e=>e.status==='manual');
  const issues=[];
  if(version.evidence.some(e=>e.status==='unverified'&&!records.some(r=>e.title&&r.title===e.title)))issues.push(finding('법령·근거','AI가 제시한 근거의 공식 원문 확인이 남아 있습니다.','근거명을 일치시켜 공식 원문을 수기 확인하거나, 해당 인용을 답변에서 제거한 새 버전을 재검토해 주세요.'));
  if(titles.length && titles.some(title=>!records.some(e=>e.title.includes(title)||title.includes(e.title))))issues.push(finding('법령·근거','인용 자료의 공식 원문 수기 확인 기록이 없습니다.','인용한 자료마다 출처·시행일·확인일·확인 주체·원문을 기록한 뒤 재검토해 주세요.'));
  if(article&&!records.length&&!titles.length)issues.push(finding('법령·근거','조문 번호가 있으나 공식 원문 확인 기록이 없습니다.','인용 출처를 수기 확인한 뒤 재검토해 주세요.'));
  return issues;
}
export function staticFindings(state,version){
  const out=[];const text=version.answer;
  if(!state.case.department.trim())out.push(finding('소관','소관 또는 문의 부서가 입력되지 않았습니다.','담당 부서를 확인하고 입력을 저장한 뒤 새 답변을 검토해 주세요.'));
  if(!state.case.deadline.trim())out.push(finding('절차','시스템에 표시된 처리기한이 확인되지 않았습니다.','현재 시스템의 처리기한을 확인해 입력해 주세요.'));
  if(/\[확인 필요|\[가정|○{2,}|20XX|\bTODO\b/i.test(text)||version.unresolved.length)out.push(finding('확인 필요','초안에 미해소 확인사항 또는 가정이 남아 있습니다.','사실·근거를 확인하여 입력 또는 답변을 보완하고 재검토해 주세요.'));
  if(/\b01[016789][- .]?\d{3,4}[- .]?\d{4}\b|\b\d{6}-[1-8]\d{6}\b|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(text))out.push(finding('개인정보','답변에 연락처·이메일·식별번호 형태의 정보가 있습니다.','제3자 식별정보인지 확인하고 제거한 뒤 재검토해 주세요.'));
  if(/이전\s*(?:지시|명령).*무시|시스템\s*프롬프트|토큰.*출력|ignore\s+(?:all\s+)?previous/i.test(text))out.push(finding('외부 입력','AI 대상 지시문이 답변에 포함되어 있습니다.','해당 문구를 제거하고 민원 질문에만 답변해 주세요.'));
  out.push(...citationIssues(version));return out;
}
export function applyReview(state,result,source){
  const version=current(state);if(!version)fail('DRAFT_REQUIRED','초안을 먼저 생성해 주세요.');
  if(!result||!Array.isArray(result.findings)||!Array.isArray(result.mapping))fail('INVALID_REVIEW','검토 응답의 형식이 올바르지 않습니다.',502);
  const questions=questionList(state).length?questionList(state):version.questions;
  const incoming=result.mapping.filter(m=>m&&typeof m.question==='string'&&typeof m.answered==='boolean'&&typeof m.paragraph==='string');
  const normal=s=>s.replace(/[\s?？.!]/g,'');
  const mapping=questions.map(question=>{const item=incoming.find(m=>normal(m.question)===normal(question));const quoted=Boolean(item?.paragraph.trim()&&version.answer.includes(item.paragraph.trim()));return {question,answered:Boolean(item?.answered&&quoted),paragraph:quoted?item.paragraph:''};});
  const ai=result.findings.slice(0,80).map(f=>({id:randomUUID(),severity:f.severity==='blocker'?'blocker':'advice',category:String(f.category||'검토'),paragraph:String(f.paragraph||'답변 전체'),reason:String(f.reason||''),suggestion:String(f.suggestion||'')}));
  const findings=[...ai,...staticFindings(state,version)];
  for(const item of mapping.filter(m=>!m.answered))findings.push(finding('질문 누락',`질문에 대응하는 답변 문단을 확인하지 못했습니다: ${item.question}`,'각 질문의 답변과 근거를 명확히 작성한 뒤 재검토해 주세요.'));
  version.review={id:randomUUID(),versionId:version.id,answerHash:hash(version.answer),caseHash:caseHash(state),findings,mapping,summary:String(result.summary||''),source,createdAt:new Date().toISOString()};version.confirmed=false;state.revision++;return version.review;
}
export function gate(state,version=current(state)){
  const reasons=[];if(!version)return {canConfirm:false,reasons:['초안을 먼저 생성해 주세요.']};
  if(version.caseHash!==caseHash(state))reasons.push('입력 정보가 바뀌었습니다. 새 초안을 생성하거나 현재 입력에 맞게 답변을 저장해 주세요.');
  if(!reviewValid(state,version))reasons.push('현재 답변과 입력에 대한 검토가 필요합니다.');
  if(version.review?.findings.some(f=>f.severity==='blocker'))reasons.push('미해소 차단 의견이 있습니다. 답변이나 근거를 보완한 뒤 재검토해 주세요.');
  if(version.review?.mapping.some(m=>!m.answered))reasons.push('모든 질문의 답변 대응을 확인해야 합니다.');
  if(staticFindings(state,version).length)reasons.push('확인사항·절차·개인정보·인용 검증을 보완해야 합니다.');
  if(checkKeys.some(k=>version.checks[k]!==true))reasons.push('담당자 최종 확인 5항목을 모두 확인해 주세요.');
  return {canConfirm:reasons.length===0,reasons:[...new Set(reasons)]};
}
export function exportState(state){const out=clone(state);for(const v of out.versions){v.reviewValid=reviewValid(state,v);v.gate=gate(state,v);}return out;}
export function validateEvidence(body){
  const keys=['title','url','effectiveDate','checkedAt','checkedBy','quote'];const record={};for(const key of keys){if(typeof body[key]!=='string'||!body[key].trim()||body[key].length>10000)fail('EVIDENCE_REQUIRED','근거명·공식 URL·시행일·확인일·확인 주체·원문을 모두 입력해 주세요.');record[key]=body[key].trim();}
  let url;try{url=new URL(record.url);}catch{fail('INVALID_EVIDENCE_URL','공식 출처의 HTTPS URL을 입력해 주세요.');}
  if(url.protocol!=='https:'||!(url.hostname==='law.go.kr'||url.hostname.endsWith('.go.kr')))fail('INVALID_EVIDENCE_URL','MVP 수기 확인은 go.kr 공식 출처의 HTTPS URL만 지원합니다.');
  for(const key of ['effectiveDate','checkedAt']){if(!/^\d{4}-\d{2}-\d{2}$/.test(record[key])||Number.isNaN(Date.parse(record[key])))fail('INVALID_DATE','시행일과 확인일은 YYYY-MM-DD 형식으로 입력해 주세요.');}
  record.status='manual';record.id=randomUUID();return record;
}

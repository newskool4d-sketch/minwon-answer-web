import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import * as providerModule from './providers.mjs';
import { AppError,fail,fields,types,directions,stages,checkKeys,example,demoProvider,newState,validateCase,requireInput,current,caseHash,hash,clone,redact,makePayload,appendVersion,demoGenerate,applyReview,gate,exportState,validateEvidence } from './domain.mjs';

const publicRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../public');
const randomToken=()=>randomBytes(32).toString('hex');
const sameToken=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};

export function createApp({providerApi=providerModule,sessionTtlMs=30*60*1000}={}){
  const sessions=new Map();
  let cachedProviders=[];
  const server=http.createServer(handler);
  function dropSession(id){const s=sessions.get(id);if(s){s.abort?.abort();s.apiKey=undefined;s.previews.clear();sessions.delete(id);}}
  function expire(){const now=Date.now();for(const [id,s] of sessions){if(now-s.seen>sessionTtlMs)dropSession(id);}}
  const timer=setInterval(expire,30000);timer.unref();
  server.on('close',()=>{clearInterval(timer);for(const id of sessions.keys())dropSession(id);});
  function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
  function makeSession(res){
    if(sessions.size>=32){const oldest=[...sessions.entries()].find(([,s])=>!s.state.running);if(oldest)dropSession(oldest[0]);else fail('SESSION_LIMIT','열린 작업이 너무 많습니다. 사용하지 않는 창을 닫아 주세요.',429);}
    const id=randomToken();const s={id,state:newState(),csrf:randomToken(),seen:Date.now(),apiKey:undefined,previews:new Map(),abort:null};s.state.providers=[clone(demoProvider),...clone(cachedProviders)];sessions.set(id,s);res.setHeader('Set-Cookie',`minwon_session=${id}; HttpOnly; SameSite=Strict; Path=/`);return s;
  }
  function session(req,res){
    const id=req.headers.cookie?.match(/(?:^|;\s*)minwon_session=([a-f0-9]{64})(?:;|$)/)?.[1];let s=id?sessions.get(id):undefined;if(!s)s=makeSession(res);s.seen=Date.now();return s;
  }
  function requireIdle(s){if(s.state.running)fail('BUSY','현재 실행을 완료하거나 취소한 뒤 다시 시도해 주세요.',409);}
  function invalidate(s){for(const v of s.state.versions)v.confirmed=false;s.previews.clear();s.state.revision++;}
  async function body(req){let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>512*1024)fail('BODY_TOO_LARGE','요청이 너무 큽니다. 입력 내용을 줄여 주세요.',413);chunks.push(chunk);}try{const result=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');if(!result||typeof result!=='object'||Array.isArray(result))throw new Error();return result;}catch{fail('INVALID_JSON','요청 형식이 올바르지 않습니다.');}}
  function selection(s,stage){if(!stages.includes(stage))fail('INVALID_STAGE','작성 단계를 확인해 주세요.');return s.state.selections[stage];}
  function consentSnapshot(s,stage,options){const payload=makePayload(s.state,stage,options);const provider=selection(s,stage).provider;const clean=redact(payload);return {payload:clean.value,provider,fingerprint:hash({revision:s.state.revision,payload:clean.value,provider}),...clean};}
  function externalAllowed(s,provider){
    if(s.state.classification==='internal')fail('INTERNAL_DATA_BLOCKED','이 MVP는 비공개·민감 실자료의 외부 AI 전송을 지원하지 않습니다. 가상 사례 또는 공개 비기밀 자료로 검증해 주세요.',403);
    if(provider==='gemini'&&!s.apiKey)fail('GEMINI_KEY_REQUIRED','AI 연결 설정에서 Gemini API Key를 연결해 주세요.',403);
    const status=s.state.providers.find(p=>p.id===provider);if(!status||!['connected'].includes(status.status))fail('PROVIDER_NOT_READY',status?.message||'제공사 연결 상태를 확인해 주세요.',403);
  }
  function decorateGemini(s){
    s.state.providers=s.state.providers.filter(p=>p.id!=='gemini');s.state.providers.push({id:'gemini',name:'Google Gemini API',status:s.apiKey?'connected':'disconnected',message:s.apiKey?'API 키와 모델 목록 확인 완료 · 실제 생성은 별도 동의 필요 · 가상/공개 비기밀 자료만 허용':'사용자 API Key 필요 · 키는 이 세션의 서버 메모리에만 보관합니다.',models:clone(s.state.geminiModels),canLogin:false});s.state.geminiConnected=Boolean(s.apiKey);
  }
  async function handler(req,res){
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cross-Origin-Resource-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'");
    try{
      const port=server.address()?.port;const permitted=[`127.0.0.1:${port}`,`localhost:${port}`];
      if(!permitted.includes(req.headers.host))fail('INVALID_HOST','로컬 주소로 접속해 주세요.',403);
      if(req.headers.origin!==undefined&&!permitted.some(h=>req.headers.origin===`http://${h}`))fail('CROSS_ORIGIN','다른 사이트의 요청은 허용하지 않습니다.',403);
      const url=new URL(req.url,`http://127.0.0.1:${port}`);
      expire();
      const localPageNavigation=req.method==='GET'&&req.headers['sec-fetch-mode']==='navigate'&&req.headers['sec-fetch-dest']==='document'&&!url.pathname.startsWith('/api/');
      if(req.headers['sec-fetch-site']==='cross-site'&&!localPageNavigation)fail('CROSS_SITE','다른 사이트의 요청은 허용하지 않습니다.',403);
      if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{ok:true,version:'0.4.1',storage:'memory-only',deployment:'loopback-only'});
      if(url.pathname.startsWith('/api/')){
        const s=session(req,res);
        if(req.method==='GET'&&url.pathname==='/api/session'){decorateGemini(s);return json(res,200,{state:exportState(s.state),csrfToken:s.csrf});}
        if(req.method==='GET'&&url.pathname==='/api/config')return json(res,200,{fields,types,directions,example});
        if(req.method!=='POST')fail('METHOD_NOT_ALLOWED','허용되지 않은 요청 방식입니다.',405);
        if(!sameToken(req.headers['x-csrf-token'],s.csrf))fail('CSRF_REQUIRED','세션 확인에 실패했습니다. 페이지를 새로 열어 주세요.',403);
        if(!String(req.headers['content-type']||'').startsWith('application/json'))fail('JSON_REQUIRED','JSON 요청만 허용합니다.',415);
        const data=await body(req);const route=url.pathname;
        if(route==='/api/cancel'){s.abort?.abort();return json(res,200,{state:exportState(s.state),message:s.abort?'취소 요청을 보냈습니다.':'실행 중인 작업이 없습니다.'});}
        requireIdle(s);
        if(route==='/api/case'){
          const next=validateCase(data.case);if(!['fictional','public','internal'].includes(data.classification))fail('INVALID_CLASSIFICATION','자료 구분을 확인해 주세요.');
          if(hash({case:next,classification:data.classification})!==caseHash(s.state)){s.state.case=next;s.state.classification=data.classification;invalidate(s);}
        }else if(route==='/api/settings'){
          if(data.selections){for(const stage of stages){const value=data.selections[stage];if(!value||!['demo','claude','codex','gemini'].includes(value.provider)||typeof value.model!=='string'||value.model.length>200)fail('INVALID_SETTINGS','단계별 제공사와 모델을 확인해 주세요.');}s.state.selections=clone(data.selections);}
          if(data.disconnectGemini){s.apiKey=undefined;s.state.geminiModels=[];}
          if(data.geminiKey!==undefined){
            if(typeof data.geminiKey!=='string'||data.geminiKey.trim().length<15||data.geminiKey.length>300)fail('INVALID_KEY','API Key 형식을 확인해 주세요.');
            const key=data.geminiKey.trim();const models=await providerApi.listGeminiModels(key);if(!models.length)fail('NO_MODELS','이 키에서 사용할 수 있는 생성 모델을 확인하지 못했습니다.',403);s.apiKey=key;s.state.geminiModels=models;
          }
          decorateGemini(s);invalidate(s);
        }else if(route==='/api/providers/refresh'){
          cachedProviders=await providerApi.getProviderStatuses();s.state.providers=[clone(demoProvider),...clone(cachedProviders)];decorateGemini(s);s.previews.clear();
        }else if(route==='/api/providers/login'){
          if(!['claude','codex'].includes(data.provider))fail('INVALID_PROVIDER','Claude 또는 Codex를 선택해 주세요.');const login=await providerApi.startLogin(data.provider);return json(res,200,{state:exportState(s.state),...login});
        }else if(route==='/api/preview'){
          const snap=consentSnapshot(s,data.stage,data);if(snap.provider!=='demo')externalAllowed(s,snap.provider);
          const token=randomToken();const expiresAt=Date.now()+5*60*1000;for(const [key,value] of s.previews){if(value.expiresAt<Date.now())s.previews.delete(key);}s.previews.set(token,{...snap,stage:data.stage,approved:false,expiresAt});
          return json(res,200,{state:exportState(s.state),preview:{token,stage:data.stage,provider:snap.provider,text:JSON.stringify(snap.payload,null,2),redactions:snap.redactions,warnings:snap.warnings,expiresAt:new Date(expiresAt).toISOString(),needsConsent:snap.provider!=='demo'}});
        }else if(route==='/api/consent'){
          const preview=s.previews.get(data.previewToken);if(!preview||preview.expiresAt<Date.now())fail('CONSENT_EXPIRED','전송 미리보기를 다시 확인해 주세요.',403);if(data.approved!==true)fail('CONSENT_REQUIRED','외부 전송에 명시적으로 동의해야 합니다.',403);preview.approved=true;
        }else if(route==='/api/run'){
          const snap=consentSnapshot(s,data.stage,data);let payload=snap.payload;
          if(snap.provider!=='demo'){
            externalAllowed(s,snap.provider);const preview=s.previews.get(data.previewToken);
            if(!preview?.approved)fail('CONSENT_REQUIRED','전송 내용을 확인하고 해당 단계의 외부 전송에 동의해 주세요.',403);
            if(preview.expiresAt<Date.now()||preview.stage!==data.stage||preview.provider!==snap.provider||preview.fingerprint!==snap.fingerprint)fail('STALE_CONSENT','입력·모델·답변 또는 선택 의견이 바뀌었습니다. 새 미리보기에 동의해 주세요.',409);
            payload=preview.payload;s.previews.delete(data.previewToken);
          }
          const initialRevision=s.state.revision;const abort=new AbortController();s.abort=abort;s.state.running={stage:data.stage,provider:snap.provider,startedAt:new Date().toISOString()};
          try{
            const result=snap.provider==='demo'?demoGenerate(s.state,data.stage,payload):await providerApi.generate(snap.provider,payload,{signal:abort.signal,apiKey:s.apiKey});
            if(abort.signal.aborted)fail('CANCELLED','실행을 취소했습니다. 이전 버전은 보존되었습니다.',409);
            if(s.state.revision!==initialRevision)fail('STALE_RESULT','입력 변경 뒤 도착한 결과를 반영하지 않았습니다.',409);
            if(data.stage==='review')applyReview(s.state,result,snap.provider);else appendVersion(s.state,result,snap.provider,current(s.state)?.id||null);
            s.previews.clear();
          }finally{s.state.running=null;s.abort=null;}
        }else if(route==='/api/edit'){
          if(data.expectedRevision!==s.state.revision)fail('STALE_EDIT','다른 작업이 먼저 반영되었습니다. 최신 답변을 확인해 주세요.',409);
          if(!current(s.state))fail('DRAFT_REQUIRED','초안을 먼저 생성해 주세요.');
          if(data.resolvedUnresolved!==undefined&&typeof data.resolvedUnresolved!=='boolean')fail('INVALID_INPUT','미해소 확인사항 해결 여부 형식을 확인해 주세요.');
          const base=current(s.state);const resolved=data.resolvedUnresolved===true;appendVersion(s.state,{answer:data.answer,summary:resolved&&base.unresolved.length?'담당자가 수동 편집한 새 버전입니다. 미해소 확인사항 해결을 담당자가 확인했습니다.':'담당자가 수동 편집한 새 버전입니다.',questions:base.questions,unresolved:resolved?[]:clone(base.unresolved),evidence:[]},'manual',base.id);s.previews.clear();
        }else if(route==='/api/restore'){
          const version=s.state.versions.find(v=>v.id===data.versionId);if(!version)fail('VERSION_NOT_FOUND','복원할 버전을 찾을 수 없습니다.',404);
          const restored=appendVersion(s.state,{answer:version.answer,summary:`v${version.number} 본문에서 복원한 새 버전입니다. 재검토가 필요합니다.`,questions:version.questions,unresolved:version.unresolved,evidence:[]},'restored',version.id);restored.evidence=clone(version.evidence);s.previews.clear();
        }else if(route==='/api/checks'){
          const version=current(s.state);if(!version)fail('DRAFT_REQUIRED','초안을 먼저 생성해 주세요.');if(!data.checks||checkKeys.some(k=>typeof data.checks[k]!=='boolean'))fail('INVALID_CHECKS','최종 확인 항목을 확인해 주세요.');version.checks=Object.fromEntries(checkKeys.map(k=>[k,data.checks[k]]));version.confirmed=false;s.previews.clear();s.state.revision++;
        }else if(route==='/api/evidence'){
          const version=current(s.state);if(!version)fail('DRAFT_REQUIRED','초안을 먼저 생성해 주세요.');version.evidence.push(validateEvidence(data));version.review=null;version.confirmed=false;s.previews.clear();s.state.revision++;
        }else if(route==='/api/confirm'){
          const decision=gate(s.state);if(!decision.canConfirm)fail('CONFIRM_BLOCKED',decision.reasons.join(' '),409);current(s.state).confirmed=true;s.previews.clear();s.state.revision++;
        }else if(route==='/api/reset'){
          s.apiKey=undefined;s.previews.clear();s.state=newState();s.state.providers=[clone(demoProvider),...clone(cachedProviders)];decorateGemini(s);
        }else fail('NOT_FOUND','요청한 기능을 찾을 수 없습니다.',404);
        return json(res,200,{state:exportState(s.state)});
      }
      if(req.method!=='GET')fail('METHOD_NOT_ALLOWED','허용되지 않은 요청 방식입니다.',405);
      let requested;try{requested=decodeURIComponent(url.pathname);}catch{fail('NOT_FOUND','페이지를 찾을 수 없습니다.',404);}
      const relative=requested==='/'?'index.html':requested.replace(/^\//,'');
      const target=path.resolve(publicRoot,relative);if(!target.startsWith(publicRoot+path.sep))fail('NOT_FOUND','페이지를 찾을 수 없습니다.',404);
      try{const contents=await readFile(target);res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream'});res.end(contents);}catch{fail('NOT_FOUND','페이지를 찾을 수 없습니다.',404);}
    }catch(error){
      if(res.headersSent){res.end();return;}
      const known=error instanceof AppError||(/^[A-Z][A-Z0-9_]{2,60}$/.test(error?.code||'')&&typeof error.message==='string');
      const code=known?error.code:'REQUEST_FAILED';const message=known?error.message:'작업을 완료하지 못했습니다. 입력과 직전 버전은 보존되었습니다.';
      const status=Number.isInteger(error.status)&&error.status>=400&&error.status<=599?error.status:known?400:500;
      json(res,status,{error:{code,message}});
    }
  }
  return {server,sessions};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.MINWON_PORT||8793);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('MINWON_PORT must be between 1024 and 65535.');
  const {server}=createApp();server.listen(port,'127.0.0.1',()=>process.stdout.write(`민원답변 도우미 MVP: http://127.0.0.1:${port}\n세션 메모리 보관 · 종료 시 작업 삭제 · 실제 발송 기능 없음\n`));
  server.on('error',error=>{process.stderr.write(error.code==='EADDRINUSE'?`포트 ${port} 사용 중입니다. MINWON_PORT를 바꿔 실행해 주세요.\n`:'로컬 서버를 시작하지 못했습니다.\n');process.exitCode=1;});
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
}

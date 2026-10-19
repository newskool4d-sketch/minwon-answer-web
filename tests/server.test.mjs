import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import http from 'node:http';
import {createApp} from '../server/index.mjs';
import {example} from '../server/domain.mjs';

async function setup(t,generate,options={}){
 const calls=[];const providerApi={getProviderStatuses:async()=>[{id:'claude',name:'Claude',status:'connected',message:'테스트 인증 상태',models:[{id:'default',label:'기본'}],canLogin:true},{id:'codex',name:'Codex',status:'setup',message:'격리 미확인',models:[],canLogin:true}],startLogin:async()=>({message:'공식 명령 안내'}),listGeminiModels:async()=>[{id:'models/mock',label:'모의 모델'}],generate:async(...args)=>{calls.push(args);if(generate)return generate(...args);return {answer:'가상 사실만 안내합니다.',summary:'가상',questions:[],unresolved:[],evidence:[]};}};
 const {server}=createApp({providerApi,...options});server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const client=()=>{let cookie='',csrf='';return {async request(route,data,headers={}){const response=await fetch(base+route,{method:data===undefined?'GET':'POST',headers:{...(cookie?{cookie}:{}),...(data===undefined?{}:{'content-type':'application/json','x-csrf-token':csrf}),...headers},body:data===undefined?undefined:JSON.stringify(data)});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];const result=await response.json();if(result.csrfToken)csrf=result.csrfToken;return {status:response.status,...result};}};};
 const c=client();await c.request('/api/session');return {c,client,base,calls};
}
const selections={draft:{provider:'claude',model:'default'},review:{provider:'claude',model:'default'},rewrite:{provider:'claude',model:'default'}};
async function external(c){await c.request('/api/case',example);await c.request('/api/providers/refresh',{});await c.request('/api/settings',{selections});}

test('가상 사례 전체 흐름과 서버 측 확정 차단을 검증한다',async t=>{
 const {c}=await setup(t);await c.request('/api/case',example);let response=await c.request('/api/run',{stage:'draft'});assert.equal(response.status,200);assert.equal(response.state.versions.length,1);response=await c.request('/api/confirm',{});assert.equal(response.error.code,'CONFIRM_BLOCKED');response=await c.request('/api/run',{stage:'review'});assert.equal(response.state.versions[0].review.mapping.length,2);assert.ok(response.state.versions[0].review.mapping.every(m=>m.answered));assert.equal(response.state.versions[0].review.findings.filter(f=>f.severity==='blocker').length,0);
 response=await c.request('/api/checks',{checks:{facts:true,privacy:true,jurisdiction:true,deadline:true,sources:true}});assert.equal(response.state.versions[0].gate.canConfirm,true);response=await c.request('/api/confirm',{});assert.equal(response.state.versions[0].confirmed,true);
 response=await c.request('/api/restore',{versionId:response.state.currentVersionId});assert.equal(response.state.versions.length,2);assert.equal(response.state.versions[1].confirmed,false);assert.equal(response.state.versions[1].review,null);
});
test('수동 편집은 미해소 확인사항을 승계하고 담당자가 해결을 확인할 때만 비운다',async t=>{
 const {c}=await setup(t);await c.request('/api/case',{...example,case:{...example.case,facts:''}});let response=await c.request('/api/run',{stage:'draft'});const unresolved=response.state.versions[0].unresolved;assert.ok(unresolved.includes('처리 사실과 확인 자료'));
 response=await c.request('/api/edit',{answer:'담당자가 고친 답변입니다.',expectedRevision:response.state.revision});assert.equal(response.status,200);assert.deepEqual(response.state.versions[1].unresolved,unresolved);
 const invalid=await c.request('/api/edit',{answer:'다시 고친 답변입니다.',expectedRevision:response.state.revision,resolvedUnresolved:'yes'});assert.equal(invalid.error.code,'INVALID_INPUT');
 response=await c.request('/api/edit',{answer:'다시 고친 답변입니다.',expectedRevision:response.state.revision,resolvedUnresolved:false});assert.equal(response.state.versions.length,3);assert.deepEqual(response.state.versions[2].unresolved,unresolved);
 response=await c.request('/api/edit',{answer:'사실을 확인해 고친 답변입니다.',expectedRevision:response.state.revision,resolvedUnresolved:true});assert.deepEqual(response.state.versions[3].unresolved,[]);
});
test('외부 호출은 서버 동의 없이는 실행되지 않고 승인 receipt는 한 번만 사용된다',async t=>{
 const {c,calls}=await setup(t);await external(c);let response=await c.request('/api/run',{stage:'draft'});assert.equal(response.error.code,'CONSENT_REQUIRED');assert.equal(calls.length,0);
 const {preview}=await c.request('/api/preview',{stage:'draft'});response=await c.request('/api/run',{stage:'draft',previewToken:preview.token});assert.equal(response.error.code,'CONSENT_REQUIRED');await c.request('/api/consent',{previewToken:preview.token,approved:true});response=await c.request('/api/run',{stage:'draft',previewToken:preview.token});assert.equal(response.status,200);assert.equal(calls.length,1);response=await c.request('/api/run',{stage:'draft',previewToken:preview.token});assert.equal(response.error.code,'CONSENT_REQUIRED');assert.equal(calls.length,1);
});
test('승인한 미리보기와 다른 추가지시는 거부하고 원문 마스킹본만 전달한다',async t=>{
 const {c,calls}=await setup(t);await external(c);await c.request('/api/case',{...example,case:{...example.case,body:example.case.body+' 연락처 010-1234-5678'}});let {preview}=await c.request('/api/preview',{stage:'draft',instructions:'간결하게'});assert.equal(preview.text.includes('010-1234-5678'),false);await c.request('/api/consent',{previewToken:preview.token,approved:true});let response=await c.request('/api/run',{stage:'draft',previewToken:preview.token,instructions:'다른 지시'});assert.equal(response.error.code,'STALE_CONSENT');response=await c.request('/api/run',{stage:'draft',previewToken:preview.token,instructions:'간결하게'});assert.equal(response.status,200);assert.equal(JSON.stringify(calls[0][1]).includes('010-1234-5678'),false);
});
test('다른 세션의 전송 동의와 문서에는 접근하지 못한다',async t=>{
 const {c,client,calls}=await setup(t);await external(c);const {preview}=await c.request('/api/preview',{stage:'draft'});await c.request('/api/consent',{previewToken:preview.token,approved:true});const other=client();let response=await other.request('/api/session');assert.equal(response.state.case.body,'');await external(other);response=await other.request('/api/run',{stage:'draft',previewToken:preview.token});assert.equal(response.error.code,'CONSENT_REQUIRED');assert.equal(calls.length,0);
});
test('비공개 실자료 외부 호출과 준비 안 된 제공사는 서버에서 차단한다',async t=>{
 const {c,calls}=await setup(t);await external(c);await c.request('/api/case',{...example,classification:'internal'});let response=await c.request('/api/preview',{stage:'draft'});assert.equal(response.error.code,'INTERNAL_DATA_BLOCKED');assert.equal(calls.length,0);
 await c.request('/api/case',example);await c.request('/api/settings',{selections:{...selections,draft:{provider:'codex',model:'default'}}});response=await c.request('/api/preview',{stage:'draft'});assert.equal(response.error.code,'PROVIDER_NOT_READY');
});
test('CSRF·외부 Origin·DNS 재바인딩 Host 요청을 거부한다',async t=>{
 const {c,base}=await setup(t);let response=await c.request('/api/reset',{}, {'x-csrf-token':''});assert.equal(response.error.code,'CSRF_REQUIRED');response=await c.request('/api/session',undefined,{origin:'https://untrusted.example'});assert.equal(response.error.code,'CROSS_ORIGIN');const raw=await new Promise((resolve,reject)=>{const req=http.get(base+'/api/health',{headers:{Host:'untrusted.example'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);});assert.equal(raw,403);
});
test('로컬 Origin만 허용하고 외부 Origin의 API·화면·preflight 요청은 CORS 헤더와 세션 없이 거부한다',async t=>{
 const {base}=await setup(t);const port=new URL(base).port;const foreign={origin:'https://example.com'};
 const cases=[['/api/session',{headers:foreign}],['/api/session',{method:'OPTIONS',headers:{...foreign,'access-control-request-method':'POST','access-control-request-headers':'content-type,x-csrf-token'}}],['/api/case',{method:'POST',headers:{...foreign,'content-type':'application/json'},body:'{}'}],['/',{headers:foreign}]];
 for(const origin of ['null','http://127.0.0.1',`https://127.0.0.1:${port}`,`http://127.0.0.1:${port}.example.com`,'http://127.0.0.1:1'])cases.push(['/api/session',{headers:{origin}}]);
 for(const [route,init] of cases){const response=await fetch(base+route,init);assert.equal(response.status,403);assert.equal(response.headers.has('access-control-allow-origin'),false);assert.equal(response.headers.has('set-cookie'),false);assert.equal((await response.json()).error.code,'CROSS_ORIGIN');}
 for(const origin of [`http://127.0.0.1:${port}`,`http://localhost:${port}`]){const response=await fetch(base+'/api/session',{headers:{origin}});assert.equal(response.status,200);assert.ok(response.headers.get('set-cookie')?.includes('SameSite=Strict'));}
});
test('외부 링크의 로컬 화면 탐색만 허용하고 API·fetch·POST·변조 Host는 차단한다',async t=>{
 const {base}=await setup(t);const navigation={'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'};
 const raw=(route,method='GET',headers=navigation)=>new Promise((resolve,reject)=>{const req=http.request(base+route,{method,headers},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{let code;if(String(res.headers['content-type']||'').startsWith('application/json')){try{code=JSON.parse(Buffer.concat(chunks).toString('utf8')).error?.code;}catch{}}resolve({status:res.statusCode,code});});});req.on('error',reject);req.end();});
 let response=await raw('/');assert.equal(response.status,200);
 for(const route of ['/api/session','/api/config']){response=await raw(route);assert.equal(response.status,403);assert.equal(response.code,'CROSS_SITE');}
 response=await raw('/','GET',{'sec-fetch-site':'cross-site','sec-fetch-mode':'no-cors','sec-fetch-dest':'empty'});assert.equal(response.status,403);assert.equal(response.code,'CROSS_SITE');
 response=await raw('/','POST');assert.equal(response.status,403);assert.equal(response.code,'CROSS_SITE');
 response=await raw('/','GET',{...navigation,host:'public.example'});assert.equal(response.status,403);assert.equal(response.code,'INVALID_HOST');
});
test('제거한 웹 연결 API는 로컬 세션에서도 찾을 수 없다',async t=>{
 const {c}=await setup(t);for(const route of ['/api/pair','/api/pair/code','/api/pair/revoke','/api/pair/disconnect']){const response=await c.request(route,{});assert.equal(response.status,404);assert.equal(response.error.code,'NOT_FOUND');}
 const response=await c.request('/api/session');assert.equal(response.status,200);
});
test('상태·설정 응답은 실행 파일 확인 항목만 유지하고 웹 연결 기능을 노출하지 않는다',async t=>{
 const {c}=await setup(t);const {status,...health}=await c.request('/api/health');assert.equal(status,200);assert.deepEqual(Object.keys(health).sort(),['deployment','ok','storage','version']);assert.equal(health.ok,true);assert.equal(health.storage,'memory-only');assert.equal(health.deployment,'loopback-only');assert.match(health.version,/^\d+\.\d+\.\d+$/);
 const {status:configStatus,...config}=await c.request('/api/config');assert.equal(configStatus,200);assert.deepEqual(Object.keys(config).sort(),['directions','example','fields','types']);assert.ok(config.fields.length>0);assert.ok(config.types.length>0);
});
test('Gemini 키는 세션·설정 응답에 반환되지 않으며 연결 해제된다',async t=>{
 const {c}=await setup(t);const key='unit-test-not-a-real-api-key';let response=await c.request('/api/settings',{geminiKey:key});assert.equal(response.state.geminiConnected,true);assert.equal(JSON.stringify(response).includes(key),false);response=await c.request('/api/session');assert.equal(JSON.stringify(response).includes(key),false);response=await c.request('/api/settings',{disconnectGemini:true});assert.equal(response.state.geminiConnected,false);
});
test('오류·취소 뒤 직전 정상 버전은 보존되고 동의 없이 재시도하지 않는다',async t=>{
 const {c,calls}=await setup(t,async(_id,_payload,{signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(Object.assign(new Error('취소됨'),{code:'CANCELLED',status:409})),{once:true});}));await c.request('/api/case',example);await c.request('/api/run',{stage:'draft'});await c.request('/api/providers/refresh',{});await c.request('/api/settings',{selections});const {preview}=await c.request('/api/preview',{stage:'draft'});await c.request('/api/consent',{previewToken:preview.token,approved:true});const pending=c.request('/api/run',{stage:'draft',previewToken:preview.token});while(calls.length===0)await new Promise(resolve=>setTimeout(resolve,5));await c.request('/api/cancel',{});const response=await pending;assert.equal(response.error.code,'CANCELLED');const latest=await c.request('/api/session');assert.equal(latest.state.versions.length,1);assert.equal(latest.state.running,null);
});

test('로컬 세션은 마지막 요청 뒤 유휴 시간이 지나면 새 빈 세션으로 바뀐다',async t=>{
 const {c}=await setup(t,undefined,{sessionTtlMs:200});await c.request('/api/case',example);let response=await c.request('/api/session');assert.equal(response.state.case.title,example.case.title);
 await new Promise(resolve=>setTimeout(resolve,260));response=await c.request('/api/session');assert.equal(response.state.case.title,'');assert.equal(response.state.versions.length,0);
});

test('Gemini Key는 연결한 세션에만 남고 다른 로컬 세션은 승계하지 않는다',async t=>{
 const {client}=await setup(t);const a=client();const b=client();await a.request('/api/session');await b.request('/api/session');
 let response=await a.request('/api/settings',{geminiKey:'test-gemini-key-0123456789'});assert.equal(response.state.geminiConnected,true);
 response=await b.request('/api/session');assert.equal(response.state.geminiConnected,false);assert.equal(JSON.stringify(response).includes('test-gemini-key'),false);
});

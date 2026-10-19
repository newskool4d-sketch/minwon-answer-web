import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import http from 'node:http';
import {createApp} from '../server/index.mjs';
import {example} from '../server/domain.mjs';

async function setup(t,generate){
 const calls=[];const providerApi={getProviderStatuses:async()=>[{id:'claude',name:'Claude',status:'connected',message:'테스트 인증 상태',models:[{id:'default',label:'기본'}],canLogin:true},{id:'codex',name:'Codex',status:'setup',message:'격리 미확인',models:[],canLogin:true}],startLogin:async()=>({message:'공식 명령 안내'}),listGeminiModels:async()=>[{id:'models/mock',label:'모의 모델'}],generate:async(...args)=>{calls.push(args);if(generate)return generate(...args);return {answer:'가상 사실만 안내합니다.',summary:'가상',questions:[],unresolved:[],evidence:[]};}};
 const {server}=createApp({providerApi});server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const client=()=>{let cookie='',csrf='';return {async request(route,data,headers={}){const response=await fetch(base+route,{method:data===undefined?'GET':'POST',headers:{...(cookie?{cookie}:{}),...(data===undefined?{}:{'content-type':'application/json','x-csrf-token':csrf}),...headers},body:data===undefined?undefined:JSON.stringify(data)});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];const result=await response.json();if(result.csrfToken)csrf=result.csrfToken;return {status:response.status,...result};}};};
 const c=client();await c.request('/api/session');return {c,client,base,calls};
}
const selections={draft:{provider:'claude',model:'default'},review:{provider:'claude',model:'default'},rewrite:{provider:'claude',model:'default'}};
async function external(c){await c.request('/api/case',example);await c.request('/api/providers/refresh',{});await c.request('/api/settings',{selections});}

test('가상 사례 전체 흐름과 서버 측 확정 차단을 검증한다',async t=>{
 const {c}=await setup(t);await c.request('/api/case',example);let response=await c.request('/api/run',{stage:'draft'});assert.equal(response.status,200);assert.equal(response.state.versions.length,1);response=await c.request('/api/confirm',{});assert.equal(response.error.code,'CONFIRM_BLOCKED');response=await c.request('/api/run',{stage:'review'});assert.equal(response.state.versions[0].review.mapping.length,2);
 response=await c.request('/api/checks',{checks:{facts:true,privacy:true,jurisdiction:true,deadline:true,sources:true}});assert.equal(response.state.versions[0].gate.canConfirm,true);response=await c.request('/api/confirm',{});assert.equal(response.state.versions[0].confirmed,true);
 response=await c.request('/api/restore',{versionId:response.state.currentVersionId});assert.equal(response.state.versions.length,2);assert.equal(response.state.versions[1].confirmed,false);assert.equal(response.state.versions[1].review,null);
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
 const {c,base}=await setup(t);let response=await c.request('/api/reset',{}, {'x-csrf-token':''});assert.equal(response.error.code,'CSRF_REQUIRED');response=await c.request('/api/session',undefined,{origin:'https://untrusted.example'});assert.equal(response.error.code,'INVALID_ORIGIN');const raw=await new Promise((resolve,reject)=>{const req=http.get(base+'/api/health',{headers:{Host:'untrusted.example'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);});assert.equal(raw,403);
});
test('Gemini 키는 세션·설정 응답에 반환되지 않으며 연결 해제된다',async t=>{
 const {c}=await setup(t);const key='unit-test-not-a-real-api-key';let response=await c.request('/api/settings',{geminiKey:key});assert.equal(response.state.geminiConnected,true);assert.equal(JSON.stringify(response).includes(key),false);response=await c.request('/api/session');assert.equal(JSON.stringify(response).includes(key),false);response=await c.request('/api/settings',{disconnectGemini:true});assert.equal(response.state.geminiConnected,false);
});
test('오류·취소 뒤 직전 정상 버전은 보존되고 동의 없이 재시도하지 않는다',async t=>{
 const {c,calls}=await setup(t,async(_id,_payload,{signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(Object.assign(new Error('취소됨'),{code:'CANCELLED',status:409})),{once:true});}));await c.request('/api/case',example);await c.request('/api/run',{stage:'draft'});await c.request('/api/providers/refresh',{});await c.request('/api/settings',{selections});const {preview}=await c.request('/api/preview',{stage:'draft'});await c.request('/api/consent',{previewToken:preview.token,approved:true});const pending=c.request('/api/run',{stage:'draft',previewToken:preview.token});while(calls.length===0)await new Promise(resolve=>setTimeout(resolve,5));await c.request('/api/cancel',{});const response=await pending;assert.equal(response.error.code,'CANCELLED');const latest=await c.request('/api/session');assert.equal(latest.state.versions.length,1);assert.equal(latest.state.running,null);
});

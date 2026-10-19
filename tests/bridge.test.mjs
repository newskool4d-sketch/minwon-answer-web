import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import http from 'node:http';
import {createApp} from '../server/index.mjs';
import {example} from '../server/domain.mjs';

const origin='https://exact.vercel.app';
const foreignOrigin='https://other.vercel.app';
const selections=Object.fromEntries(['draft','review','rewrite'].map(stage=>[stage,{provider:'codex',model:'default'}]));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const denied=response=>assert.ok(response.status>=400&&response.status<500,'요청이 4xx로 거부되어야 합니다.');

async function setup(t,options={}){
  const calls=[];
  const providerApi={
    getProviderStatuses:async()=>[{id:'codex',name:'Codex',status:'connected',message:'모의 인증',models:[{id:'default',label:'기본'}],canLogin:true}],
    startLogin:async()=>({message:'공식 로그인 안내'}),
    listGeminiModels:async()=>[{id:'models/mock',label:'모의 모델'}],
    generate:async(provider,payload)=>{calls.push({provider,stage:payload.stage});return {answer:'가상 사례의 확인된 사실만 안내합니다.',summary:'가상 답변',questions:[],unresolved:[],evidence:[]};}
  };
  const {server}=createApp({providerApi,...options});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  async function request(route,{data,headers={},method=data===undefined?'GET':'POST'}={}){
    const response=await fetch(base+route,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...headers},body:data===undefined?undefined:JSON.stringify(data)});
    const text=await response.text();let result={};if(text){try{result=JSON.parse(text);}catch{assert.fail('JSON 형식의 API 응답이 필요합니다.');}}
    return {status:response.status,headers:response.headers,...result};
  }
  function client({remoteOrigin,sessionToken='',csrfToken=''}={}){
    let cookie='',token=sessionToken,csrf=csrfToken;
    return {
      get cookie(){return cookie;},
      get token(){return token;},
      get csrf(){return csrf;},
      async request(route,data,headers={}){
        const response=await request(route,{data,headers:{...(remoteOrigin?{origin:remoteOrigin,'sec-fetch-site':'cross-site'}:cookie?{cookie}:{}),...(token?{'x-minwon-session':token}:{}),...(data===undefined?{}:{'x-csrf-token':csrf}),...headers}});
        if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
        if(response.csrfToken)csrf=response.csrfToken;
        if(response.sessionToken)token=response.sessionToken;
        return response;
      }
    };
  }
  const local=client();await local.request('/api/session');
  async function issue(){const response=await local.request('/api/pair/code',{origin,approved:true});assert.equal(response.status,200);assert.equal(typeof response.code,'string');assert.ok(response.code.length>=6);assert.equal(response.origin,origin);assert.ok(Number.isFinite(Date.parse(response.expiresAt)));return response;}
  async function pair(){const issued=await issue();const remote=client({remoteOrigin:origin});const response=await remote.request('/api/pair',{code:issued.code});assert.equal(response.status,200);assert.equal(typeof response.sessionToken,'string');assert.ok(response.sessionToken.length>=32);assert.equal(typeof response.csrfToken,'string');assert.equal(response.headers.has('set-cookie'),false);return remote;}
  return {local,request,client,issue,pair,calls,base};
}

test('로컬 승인으로 발급한 일회용 코드는 정확한 웹 Origin에서만 연결된다',async t=>{
  const {local,client,issue}=await setup(t);
  let response=await local.request('/api/pair/code',{origin,approved:false});denied(response);assert.equal(response.error.code,'PAIRING_APPROVAL_REQUIRED');
  response=await local.request('/api/pair/code',{origin,approved:true},{'x-csrf-token':''});denied(response);assert.equal(response.error.code,'CSRF_REQUIRED');
  for(const unsafeOrigin of ['http://exact.vercel.app','https://exact.vercel.app/path','https://user:password@exact.vercel.app','https://exact.vercel.app:444','null','*']){
    response=await local.request('/api/pair/code',{origin:unsafeOrigin,approved:true});denied(response);assert.equal(response.error.code,'INVALID_WEB_ORIGIN');
  }
  const issued=await issue();
  response=await client({remoteOrigin:foreignOrigin}).request('/api/pair',{code:issued.code});denied(response);
  const remote=client({remoteOrigin:origin});response=await remote.request('/api/pair',{code:issued.code});assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),origin);assert.equal(response.headers.has('access-control-allow-credentials'),false);
  response=await client({remoteOrigin:origin}).request('/api/pair',{code:issued.code});denied(response);assert.equal(response.error.code,'PAIRING_INVALID');
  response=await client({remoteOrigin:origin}).request('/api/pair',{code:'000000'});denied(response);
});

test('웹 세션은 로컬 내용·Gemini API 키 및 다른 웹 세션을 승계하지 않는다',async t=>{
  const {local,pair}=await setup(t);await local.request('/api/case',example);
  await local.request('/api/settings',{geminiKey:'fixture-only-not-a-real-api-key'});
  const remote=await pair();let response=await remote.request('/api/session');assert.equal(response.status,200);assert.equal(response.state.case.body,'');assert.equal(response.state.geminiConnected,false);assert.equal(response.headers.has('set-cookie'),false);
  response=await remote.request('/api/config');assert.equal(response.status,200);assert.ok(response.fields.length>0);
  await remote.request('/api/case',{...example,case:{...example.case,body:'별도 웹 세션의 가상 사례입니다.'}});
  response=await local.request('/api/session');assert.equal(response.state.case.body,example.case.body);assert.equal(response.state.geminiConnected,true);
  const another=await pair();response=await another.request('/api/session');assert.equal(response.state.case.body,'');assert.equal(response.state.geminiConnected,false);
});

test('웹 API는 정확한 Origin·bearer·CSRF가 모두 필요하고 로컬 쿠키로 우회되지 않는다',async t=>{
  const {local,pair,request}=await setup(t);const remote=await pair();
  let response=await request('/api/session',{headers:{origin,'sec-fetch-site':'cross-site',cookie:local.cookie}});denied(response);assert.equal(response.error.code,'BRIDGE_SESSION_REQUIRED');
  response=await request('/api/session',{headers:{'x-minwon-session':remote.token}});denied(response);
  response=await request('/api/session',{headers:{origin:foreignOrigin,'x-minwon-session':remote.token}});denied(response);
  response=await request('/api/session',{headers:{origin,'x-minwon-session':'invalid-session-token'}});denied(response);
  response=await remote.request('/api/reset',{}, {'x-csrf-token':''});denied(response);assert.equal(response.error.code,'CSRF_REQUIRED');
  response=await remote.request('/api/pair/code',{origin,approved:true});denied(response);assert.equal(response.error.code,'LOCAL_ONLY');
  response=await remote.request('/api/pair/revoke',{});denied(response);assert.equal(response.error.code,'LOCAL_ONLY');
  response=await local.request('/api/pair/disconnect',{});denied(response);assert.equal(response.error.code,'REMOTE_ONLY');
});

test('CORS preflight는 승인 Origin과 허용 method·header에만 열리고 자격 증명을 허용하지 않는다',async t=>{
  const {request,issue}=await setup(t);
  let response=await request('/api/session',{method:'OPTIONS',headers:{origin,'access-control-request-method':'GET'}});denied(response);assert.equal(response.headers.has('access-control-allow-origin'),false);
  await issue();
  response=await request('/api/session',{method:'OPTIONS',headers:{origin,'access-control-request-method':'POST','access-control-request-headers':'content-type,x-csrf-token,x-minwon-session,accept','sec-fetch-site':'cross-site'}});assert.ok([200,204].includes(response.status));assert.equal(response.headers.get('access-control-allow-origin'),origin);assert.equal(response.headers.has('access-control-allow-credentials'),false);
  assert.ok(response.headers.get('access-control-allow-methods')?.includes('POST'));assert.equal(response.headers.get('access-control-allow-methods')?.includes('DELETE'),false);
  for(const headers of [{origin:foreignOrigin,'access-control-request-method':'POST'},{origin,'access-control-request-method':'DELETE'},{origin,'access-control-request-method':'POST','access-control-request-headers':'authorization'}]){
    response=await request('/api/session',{method:'OPTIONS',headers});denied(response);
  }
});

test('원격 연결 뒤에도 DNS 재바인딩 Host와 외부 페이지의 정적 파일 접근을 거부한다',async t=>{
  const {base,pair,request}=await setup(t);const remote=await pair();
  const status=await new Promise((resolve,reject)=>{const req=http.get(base+'/api/session',{headers:{host:'public.example',origin,'x-minwon-session':remote.token}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);});assert.equal(status,403);
  const response=await request('/',{headers:{origin,'x-minwon-session':remote.token,'sec-fetch-site':'cross-site'}});denied(response);
});

test('원격 연결 해제와 로컬 전체 해제는 세션 및 미사용 코드를 폐기한다',async t=>{
  const {local,pair,issue,client}=await setup(t);const first=await pair();let response=await first.request('/api/pair/disconnect',{});assert.equal(response.status,200);response=await first.request('/api/session');denied(response);
  const second=await pair();const issued=await issue();response=await local.request('/api/pair/revoke',{});assert.equal(response.status,200);
  response=await second.request('/api/session');denied(response);
  response=await client({remoteOrigin:origin}).request('/api/pair',{code:issued.code});denied(response);
  response=await local.request('/api/session');assert.equal(response.status,200);
});

test('만료된 일회용 코드는 타이머 정리 전 요청 시점에도 거부한다',async t=>{
  const {issue,client}=await setup(t,{pairTtlMs:25});const issued=await issue();await pause(45);const response=await client({remoteOrigin:origin}).request('/api/pair',{code:issued.code});denied(response);
});

test('유휴 만료된 웹 세션은 새 로컬 세션으로 대체되지 않고 거부한다',async t=>{
  const {pair}=await setup(t,{sessionTtlMs:200});const remote=await pair();await pause(240);const response=await remote.request('/api/session');denied(response);assert.equal(response.headers.has('set-cookie'),false);
});

test('웹 연결에서도 단계별 AI 전송 동의·1회 사용·세션 격리·비공개 자료 차단을 유지한다',async t=>{
  const {pair,calls}=await setup(t);const remote=await pair();
  async function configure(client){await client.request('/api/case',example);await client.request('/api/providers/refresh',{});await client.request('/api/settings',{selections});}
  await configure(remote);let response=await remote.request('/api/run',{stage:'draft'});denied(response);assert.equal(response.error.code,'CONSENT_REQUIRED');assert.equal(calls.length,0);
  const {preview}=await remote.request('/api/preview',{stage:'draft'});await remote.request('/api/consent',{previewToken:preview.token,approved:true});
  const other=await pair();await configure(other);response=await other.request('/api/run',{stage:'draft',previewToken:preview.token});denied(response);assert.equal(response.error.code,'CONSENT_REQUIRED');assert.equal(calls.length,0);
  response=await remote.request('/api/run',{stage:'draft',previewToken:preview.token});assert.equal(response.status,200);assert.equal(calls.length,1);assert.equal(response.state.versions.length,1);
  response=await remote.request('/api/run',{stage:'draft',previewToken:preview.token});denied(response);assert.equal(response.error.code,'CONSENT_REQUIRED');assert.equal(calls.length,1);
  await remote.request('/api/case',{...example,classification:'internal'});response=await remote.request('/api/preview',{stage:'draft'});denied(response);assert.equal(response.error.code,'INTERNAL_DATA_BLOCKED');assert.equal(calls.length,1);
});

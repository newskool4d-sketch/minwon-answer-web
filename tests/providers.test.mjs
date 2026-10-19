import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { access } from 'node:fs/promises';
import { createProviderService, validateProviderOutput, buildClaudeArgs } from '../server/providers.mjs';

const answer = { answer: '확인한 운영 기준에 따라 안내드립니다.', summary: '가상 답변', questions: ['운영 기준은 무엇인가요?'], unresolved: [], evidence: [] };
const payload = { stage: 'draft', input: { field: '일반행정', complaint: '가상 민원: 운영 기준을 알려 주세요.' } };
const help = buildClaudeArgs('draft').join(' ');
const paths = { claude: 'C:/fixed/claude.exe', node: 'C:/fixed/node.exe', codex: 'C:/fixed/codex.js', codexNative: 'C:/fixed/codex.exe' };
const codexHome = 'C:/fixed/minwon-codex-home';
const codexHelp = '--ignore-user-config --ignore-rules --strict-config --ephemeral --json --output-schema --color';
const codexCatalog = [{ slug: 'codex-test', default_reasoning_level: 'medium', supported_reasoning_levels: [{ effort: 'medium', description: 'Test' }] }];
const key = 'test-key-not-a-real-secret';

function fakeCli({ authMethod = 'claude.ai', generation = { structured_output: answer }, exitCode = 0, hang = false, helpText = help, splitUnicode = false } = {}) {
  const calls = [];
  const spawnImpl = (binary, args, options) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const call = { binary, args, options, input: '', killed: false };
    calls.push(call);
    child.stdin.setEncoding('utf8');
    child.stdin.on('data', value => { call.input += value; });
    child.kill = () => { call.killed = true; queueMicrotask(() => child.emit('close', 1)); return true; };
    child.stdin.on('finish', () => queueMicrotask(() => {
      if (args.includes('status') && args.includes('auth')) {
        child.stdout.end(JSON.stringify({ loggedIn: authMethod !== 'none', authMethod }));
      } else if (args.includes('status') && args.includes('login')) {
        child.stderr.end('Logged in using ChatGPT');
      } else if (args.includes('--version')) {
        child.stdout.end('codex-cli 0.160.0');
      } else if (args.includes('debug') && args.includes('models') && args.includes('--bundled')) {
        child.stdout.end(JSON.stringify(codexCatalog));
      } else if (args.includes('exec') && args.includes('--help')) {
        child.stdout.end(codexHelp);
      } else if (args.includes('--help')) {
        child.stdout.end(helpText);
      } else {
        if (hang) return;
        const text = args.includes('exec')
          ? [{ type: 'thread.started', thread_id: 'test-thread' }, { type: 'turn.started' }, { type: 'item.completed', item: { id: 'answer', type: 'agent_message', text: JSON.stringify(answer) } }, { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }].map(item => JSON.stringify(item)).join('\n') + '\n'
          : typeof generation === 'string' ? generation : JSON.stringify(generation);
        if (splitUnicode) {
          const bytes = Buffer.from(text);
          for (let index = 0; index < bytes.length; index += 7) child.stdout.write(bytes.subarray(index, index + 7));
          child.stdout.end();
        } else child.stdout.end(text);
        child.emit('close', exitCode);
        return;
      }
      child.emit('close', 0);
    }));
    return child;
  };
  return { spawnImpl, calls };
}

function service(options = {}) {
  const mock = fakeCli(options);
  return { ...mock, provider: createProviderService({ spawnImpl: mock.spawnImpl, exists: async path => !/(?:^|[\\/])AGENTS(?:\.override)?\.md$/i.test(path), paths, codexHome,
    environment: { PATH: 'safe', USERPROFILE: 'C:/user', ANTHROPIC_API_KEY: 'must-not-forward', OPENAI_API_KEY: 'must-not-forward', CLAUDE_CODE_OAUTH_TOKEN: 'must-not-forward', NODE_OPTIONS: '--require unsafe', CODEX_HOME: 'C:/unsafe/globalhome' } }) };
}

function modelResponse(extra = {}) {
  return { models: [
    { name: 'models/gemini-test', displayName: 'Test Gemini', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/embed-only', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/../../host', supportedGenerationMethods: ['generateContent'] },
  ], ...extra };
}

test('출력은 필수 필드·중복 의견·실제 인용문을 검증한다', () => {
  assert.deepEqual(validateProviderOutput('draft', answer), answer);
  assert.throws(() => validateProviderOutput('draft', { ...answer, answer: '' }), { code: 'INVALID_PROVIDER_OUTPUT' });
  assert.throws(() => validateProviderOutput('review', { summary: '', findings: [], mapping: [{ question: '질문', answered: true, paragraph: '없는 인용문' }] }, { answer: answer.answer }), { code: 'INVALID_PROVIDER_OUTPUT' });
  const finding = { id: 'one', severity: 'blocker', category: '사실', paragraph: '', reason: '미확인', suggestion: '근거 확인' };
  assert.throws(() => validateProviderOutput('review', { summary: '', findings: [finding, finding], mapping: [] }), { code: 'INVALID_PROVIDER_OUTPUT' });
});

test('AI가 근거를 검증 완료로 반환해도 미검증으로 고정한다', () => {
  const result = validateProviderOutput('draft', { ...answer, evidence: [{ title: '가상 자료', status: 'verified', verifiedBy: 'AI' }] });
  assert.equal(result.evidence[0].status, 'unverified');
  assert.equal('verifiedBy' in result.evidence[0], false);
});

test('상태 조회는 본인 구독 인증과 Codex의 버전·격리 기능을 확인한다', async () => {
  const { provider } = service();
  const states = await provider.getProviderStatuses();
  assert.equal(states.find(item => item.id === 'claude').status, 'connected');
  assert.equal(states.find(item => item.id === 'codex').status, 'connected');
  assert.match(states.find(item => item.id === 'codex').message, /로그인 확인/);
  assert.deepEqual(states.find(item => item.id === 'codex').models.map(item => item.id), ['default']);
  assert.equal(states.find(item => item.id === 'gemini').status, 'setup');
  const apiAuthenticated = await service({ authMethod: 'api_key' }).provider.getProviderStatuses();
  assert.equal(apiAuthenticated.find(item => item.id === 'claude').status, 'disconnected');
});

test('필수 CLI 격리 옵션이 없으면 연결됨을 표시하지 않는다', async () => {
  const { provider } = service({ helpText: 'old CLI' });
  const status = (await provider.getProviderStatuses()).find(item => item.id === 'claude');
  assert.equal(status.status, 'setup');
  await assert.rejects(provider.generate('claude', payload), { code: 'PROVIDER_NOT_CONNECTED' });
});

test('로그인 버튼은 공식 사용자 단말 절차만 안내하며 프로세스를 자동 실행하지 않는다', async () => {
  const { provider, calls } = service();
  assert.match((await provider.startLogin('claude')).message, /claude auth login/);
  assert.match((await provider.startLogin('codex')).message, /codex-login\.ps1/);
  assert.equal(calls.length, 0);
});

test('Claude는 stdin·고정 argv·비영속·빈 도구·정제 환경을 사용하고 임시 영역을 정리한다', async () => {
  const { provider, calls } = service({ splitUnicode: true });
  const result = await provider.generate('claude', { ...payload, input: { complaint: '$(비밀) `명령` 한글 가상 민원' } });
  assert.deepEqual(result, answer);
  const generation = calls.find(call => call.args.includes('-p'));
  assert.equal(generation.binary, paths.claude);
  assert.equal(generation.options.shell, false);
  assert.equal(generation.options.windowsHide, true);
  assert.equal(generation.args.includes('--no-session-persistence'), true);
  assert.equal(generation.args.includes('--bare'), false);
  assert.equal(generation.args[generation.args.indexOf('--tools') + 1], '');
  assert.equal(generation.args.includes('--safe-mode'), true);
  assert.equal(generation.args.includes('--strict-mcp-config'), true);
  assert.equal(generation.args.some(value => value.includes('$(비밀)')), false);
  assert.match(generation.input, /\$\(비밀\)/);
  for (const name of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'NODE_OPTIONS']) assert.equal(generation.options.env[name], undefined);
  await assert.rejects(access(generation.options.cwd), { code: 'ENOENT' });
});

test('잘못된 CLI 출력은 민감 원문을 노출하지 않고 거부한다', async () => {
  const { provider } = service({ generation: `not-json ${key}` });
  await assert.rejects(provider.generate('claude', payload), error => error.code === 'INVALID_PROVIDER_OUTPUT' && !error.message.includes(key));
});

test('취소는 대기 중 CLI를 종료하고 정상 결과로 처리하지 않는다', async () => {
  const { provider, calls } = service({ hang: true });
  const controller = new AbortController();
  const result = provider.generate('claude', payload, { signal: controller.signal });
  const timer = setTimeout(() => controller.abort(), 20);
  try { await assert.rejects(result, { code: 'GENERATION_ABORTED' }); } finally { clearTimeout(timer); }
  assert.equal(calls.find(call => call.args.includes('-p')).killed, true);
});

test('Codex는 격리 기능 확인 후 공식 네이티브 실행부로만 프롬프트를 전달한다', async () => {
  const { provider, calls } = service();
  assert.deepEqual(await provider.generate('codex', payload), answer);
  const generation = calls.find(call => call.args.includes('exec') && !call.args.includes('--help'));
  assert.equal(generation.binary, paths.codexNative);
  assert.equal(generation.options.shell, false);
  assert.equal(generation.args.includes('--ephemeral'), true);
  assert.match(generation.input, /가상 민원/);
});

test('Gemini 모델 목록은 공식 고정 host와 key header를 사용하고 generateContent만 남긴다', async () => {
  const calls = [];
  const provider = createProviderService({ fetchImpl: async (url, init) => { calls.push({ url, init }); return Response.json(modelResponse()); } });
  assert.deepEqual(await provider.listGeminiModels(key), [{ id: 'models/gemini-test', label: 'Test Gemini' }]);
  assert.equal(new URL(calls[0].url).origin, 'https://generativelanguage.googleapis.com');
  assert.equal(calls[0].url.includes(key), false);
  assert.equal(calls[0].init.headers['x-goog-api-key'], key);
  assert.equal(calls[0].init.redirect, 'error');
});

test('Gemini는 실제 조회 모델로만 스키마 생성하고 도구를 부여하지 않는다', async () => {
  const calls = [];
  const provider = createProviderService({ fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return Response.json(init.method === 'GET' ? modelResponse() : { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(answer) }] } }] });
  } });
  assert.deepEqual(await provider.generate('gemini', { ...payload, model: 'models/gemini-test' }, { apiKey: key }), answer);
  const body = JSON.parse(calls[1].init.body);
  assert.equal(calls[1].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent');
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal('tools' in body, false);
  await assert.rejects(provider.generate('gemini', { ...payload, model: 'models/not-returned' }, { apiKey: key }), { code: 'MODEL_UNAVAILABLE' });
  assert.equal(calls.filter(item => item.init.method === 'POST').length, 1);
});

test('Gemini 중단·차단·오류는 부분 결과와 제공사 원문을 반환하지 않는다', async () => {
  const blocked = createProviderService({ fetchImpl: async (url, init) => Response.json(init.method === 'GET' ? modelResponse() : { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: JSON.stringify(answer) }] } }] }) });
  await assert.rejects(blocked.generate('gemini', { ...payload, model: 'models/gemini-test' }, { apiKey: key }), { code: 'PROVIDER_INCOMPLETE_OUTPUT' });
  const denied = createProviderService({ fetchImpl: async () => new Response(JSON.stringify({ error: `provider-content ${key}` }), { status: 403 }) });
  await assert.rejects(denied.listGeminiModels(key), error => error.code === 'GEMINI_FORBIDDEN' && !error.message.includes(key) && !error.message.includes('provider-content'));
});

test('Gemini 모델 페이지 토큰은 인코딩하고 중복 모델을 제거한다', async () => {
  const calls = [];
  const provider = createProviderService({ fetchImpl: async url => { calls.push(url); return Response.json(modelResponse(calls.length === 1 ? { nextPageToken: 'token&part=2' } : {})); } });
  assert.equal((await provider.listGeminiModels(key)).length, 1);
  assert.match(calls[1], /pageToken=token%26part%3D2/);
});

test('이미 취소한 요청·잘못된 stage는 제공사 호출 전에 거부한다', async () => {
  let called = false;
  const provider = createProviderService({ fetchImpl: async () => { called = true; return Response.json(modelResponse()); } });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(provider.generate('gemini', payload, { signal: controller.signal, apiKey: key }), { code: 'GENERATION_ABORTED' });
  await assert.rejects(provider.generate('gemini', { ...payload, stage: 'send' }, { apiKey: key }), { code: 'INVALID_GENERATION_REQUEST' });
  assert.equal(called, false);
});

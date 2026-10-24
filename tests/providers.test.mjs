import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { access } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createProviderService, validateProviderOutput, buildClaudeArgs, claudeHelpHasFlag } from '../server/providers.mjs';

const answer = { answer: '확인한 운영 기준에 따라 안내드립니다.', summary: '가상 답변', questions: ['운영 기준은 무엇인가요?'], unresolved: [], evidence: [] };
const payload = { stage: 'draft', input: { field: '일반행정', complaint: '가상 민원: 운영 기준을 알려 주세요.' } };
// Real `claude --help` output of the installed 2.1.301, not text derived from buildClaudeArgs.
const help = readFileSync(new URL('./fixtures/claude-help-2.1.301.txt', import.meta.url), 'utf8');
const claudeFlags = ['--safe-mode', '--restricted', '--no-session-persistence', '--tools', '--strict-mcp-config', '--permission-prompts', '--json-schema'];
const claudeChildEnv = { CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', DISABLE_ERROR_REPORTING: '1', DISABLE_AUTOUPDATER: '1' };
const paths = { claude: 'C:/fixed/claude.exe', node: 'C:/fixed/node.exe', codex: 'C:/fixed/codex.js', codexNative: 'C:/fixed/codex.exe' };
const codexHome = 'C:/fixed/minwon-codex-home';
const codexHelp = '--ignore-user-config --ignore-rules --strict-config --ephemeral --json --output-schema --color';
const codexCatalog = [{ slug: 'codex-test', default_reasoning_level: 'medium', supported_reasoning_levels: [{ effort: 'medium', description: 'Test' }] }];
const key = 'test-key-not-a-real-secret';

function fakeCli({ authMethod = 'claude.ai', generation = { structured_output: answer }, exitCode = 0, hang = false, helpText = help, splitUnicode = false, claudeVersion = '2.1.301 (Claude Code)' } = {}) {
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
        child.stdout.end(binary === paths.claude ? claudeVersion : 'codex-cli 0.160.0');
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
  return { ...mock, provider: createProviderService({ spawnImpl: mock.spawnImpl, exists: async path => !/(?:^|[\\/])AGENTS(?:\.override)?\.md$/i.test(path), paths, codexHome, claudeVersionPolicy: options.claudeVersionPolicy,
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

test('Claude 옵션 확인은 실제 2.1.301 help의 옵션 정의 줄만 인정한다', async () => {
  for (const flag of claudeFlags) assert.equal(claudeHelpHasFlag(help, flag), true, flag);
  for (const flag of buildClaudeArgs('draft').filter(value => value.startsWith('--'))) assert.equal(claudeHelpHasFlag(help, flag), true, `실제 help에 있는 옵션만 사용: ${flag}`);
  assert.match(help, /^ {2}-p, --print\b/m);
  // The definition line is removed but other options' descriptions still mention the flag.
  const withoutStrict = help.replace(/^ {2}--strict-mcp-config\b.*$/m, '');
  assert.equal(withoutStrict.includes('--strict-mcp-config'), true);
  assert.equal(claudeHelpHasFlag(withoutStrict, '--strict-mcp-config'), false);
  assert.equal(claudeHelpHasFlag(help.replace(/^ {2}--system-prompt <.*$/m, ''), '--system-prompt'), false, '--system-prompt-snapshot는 다른 옵션이다');
  // Description continuation lines are indented 6+ spaces; a flag mentioned there must not count as defined.
  assert.equal(claudeHelpHasFlag(`${withoutStrict}\n      --strict-mcp-config continues a description\n`, '--strict-mcp-config'), false);
  const { provider, calls } = service({ helpText: withoutStrict });
  assert.equal((await provider.getProviderStatuses()).find(item => item.id === 'claude').status, 'setup');
  await assert.rejects(provider.generate('claude', payload), { code: 'PROVIDER_NOT_CONNECTED' });
  assert.equal(calls.some(call => call.args.includes('-p')), false);
});

test('Claude argv는 고정 순서의 격리 옵션 뒤에 시스템 지침과 스키마를 둔다', () => {
  for (const stage of ['draft', 'review']) {
    const args = buildClaudeArgs(stage);
    assert.deepEqual(args.slice(0, 21), ['--safe-mode', '--restricted', '-p', '--output-format', 'json',
      '--no-session-persistence', '--disable-slash-commands', '--no-chrome',
      '--tools', '', '--disallowedTools', 'mcp__*', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--settings', '{"disableAllHooks":true}', '--permission-mode', 'dontAsk', '--permission-prompts', 'none']);
    assert.equal(args.length, 25);
    assert.equal(args[21], '--system-prompt');
    assert.match(args[22], /민원 답변/);
    assert.equal(args[23], '--json-schema');
    assert.deepEqual(JSON.parse(args[24]).required, stage === 'review' ? ['findings', 'mapping', 'summary'] : ['answer', 'summary', 'questions', 'unresolved', 'evidence']);
  }
});

test('Claude 버전은 최소 기능 버전 미만이면 setup, 검증 목록 밖이면 정책에 따라 경고 또는 제한한다', async () => {
  for (const claudeVersion of ['2.1.258 (Claude Code)', '1.9.999 (Claude Code)', 'unexpected-private-output']) {
    const { provider, calls } = service({ claudeVersion });
    const status = (await provider.getProviderStatuses()).find(item => item.id === 'claude');
    assert.equal(status.status, 'setup', claudeVersion);
    assert.match(status.message, /2\.1\.259/);
    assert.equal(status.message.includes('unexpected-private-output'), false);
    await assert.rejects(provider.generate('claude', payload), { code: 'PROVIDER_NOT_CONNECTED' });
    assert.equal(calls.some(call => call.args.includes('-p')), false);
  }
  const warned = (await service({ claudeVersion: '2.1.400 (Claude Code)' }).provider.getProviderStatuses()).find(item => item.id === 'claude');
  assert.equal(warned.status, 'connected');
  assert.match(warned.message, /검증 버전과 다름.*2\.1\.400.*2\.1\.301/);
  const strict = service({ claudeVersion: '2.1.400 (Claude Code)', claudeVersionPolicy: 'strict' });
  const limited = (await strict.provider.getProviderStatuses()).find(item => item.id === 'claude');
  assert.equal(limited.status, 'setup');
  assert.match(limited.message, /검증 버전과 다릅니다.*2\.1\.400.*2\.1\.301/);
  await assert.rejects(strict.provider.generate('claude', payload), { code: 'PROVIDER_NOT_CONNECTED' });
  const verified = (await service({ claudeVersionPolicy: 'strict' }).provider.getProviderStatuses()).find(item => item.id === 'claude');
  assert.equal(verified.status, 'connected');
  assert.doesNotMatch(verified.message, /검증 버전과 다름/);
});

test('Claude 로그인 버튼은 공식 사용자 단말 절차만 안내하며 프로세스를 실행하지 않는다', async () => {
  const { provider, calls } = service();
  assert.match((await provider.startLogin('claude')).message, /claude auth login/);
  assert.equal(calls.length, 0);
});

function loginWindowService({ platform = 'win32', scriptExists = true, spawnFails = false, scriptPath } = {}) {
  const calls = [];
  const children = [];
  const spawnImpl = (binary, args, options) => {
    const child = new EventEmitter();
    child.unref = () => {};
    calls.push({ binary, args, options });
    children.push(child);
    queueMicrotask(() => child.emit(spawnFails ? 'error' : 'spawn', spawnFails ? new Error('spawn failed') : undefined));
    return child;
  };
  const codexLoginScript = scriptPath || 'C:\\Users\\tester\\AppData\\Local\\Programs\\minwon-answer\\0.5.0\\codex-login.ps1';
  const provider = createProviderService({ spawnImpl, exists: async path => scriptExists || path !== codexLoginScript, paths, codexHome, codexLoginScript, platform,
    environment: { SYSTEMROOT: 'C:\\Windows', LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local', USERPROFILE: 'C:\\Users\\tester', HTTPS_PROXY: 'http://proxy.example:8080' } });
  return { provider, calls, children, codexLoginScript };
}

test('Codex 로그인 버튼은 앱 전용 폴더로 공식 로그인 창을 한 번에 하나만 연다', async () => {
  const { provider, calls, children, codexLoginScript } = loginWindowService();
  let result = await provider.startLogin('codex');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].binary, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(calls[0].args, ['/d', '/s', '/c', `"start "민원답변 도우미 Codex 로그인" /wait "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "${codexLoginScript}" -CodexHome "${codexHome}" -Pause"`]);
  assert.equal(calls[0].options.windowsVerbatimArguments, true);assert.equal(calls[0].options.windowsHide, true);assert.equal(calls[0].options.stdio, 'ignore');assert.equal(calls[0].options.detached, undefined);
  assert.equal(calls[0].options.env.HTTPS_PROXY, 'http://proxy.example:8080');
  assert.match(result.message, /로그인 창\(PowerShell\)을 열었습니다/);assert.match(result.message, /%LOCALAPPDATA%\\Programs\\minwon-answer\\0\.5\.0\\codex-login\.ps1/);assert.doesNotMatch(result.message, /tester/);
  result = await provider.startLogin('codex');
  assert.equal(calls.length, 1);assert.match(result.message, /이미 Codex 로그인 창이 열려 있습니다/);
  children[0].emit('exit', 0);
  await provider.startLogin('codex');
  assert.equal(calls.length, 2);
});

test('Codex 로그인 창을 열 수 없으면 실행하지 않고 직접 실행 명령을 안내한다', async () => {
  for (const options of [{ platform: 'linux' }, { scriptExists: false }, { scriptPath: 'C:\\Users\\A&B\\AppData\\Local\\Programs\\minwon-answer\\0.5.0\\codex-login.ps1' }]) {
    const { provider, calls } = loginWindowService(options);
    const result = await provider.startLogin('codex');
    assert.equal(calls.length, 0);assert.match(result.message, /-ExecutionPolicy Bypass -File/);assert.match(result.message, /자동으로 열 수 없습니다/);
  }
  const failing = loginWindowService({ spawnFails: true });
  assert.match((await failing.provider.startLogin('codex')).message, /로그인 창을 열지 못했습니다/);
  assert.equal(failing.calls.length, 1);
  await failing.provider.startLogin('codex');
  assert.equal(failing.calls.length, 2);
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
  for (const call of calls.filter(item => item.binary === paths.claude)) for (const [name, value] of Object.entries(claudeChildEnv)) assert.equal(call.options.env[name], value, name);
  for (const name of ['DISABLE_TELEMETRY', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'CODEX_HOME']) assert.equal(generation.options.env[name], undefined, name);
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
  // Abort only once the generation CLI (-p) has started, so the kill path is always exercised.
  const deadline = Date.now() + 5000;
  while (!calls.some(call => call.args.includes('-p')) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  controller.abort();
  await assert.rejects(result, { code: 'GENERATION_ABORTED' });
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

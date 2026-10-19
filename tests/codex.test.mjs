import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { access } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { buildCodexCatalog, createCodexEventReader, createProviderService } from '../server/providers.mjs';

const answer = { answer: '가상 안내: 확인한 운영 기준에 따라 답변드립니다. 한글·이모지 🌱', summary: '가상 답변', questions: ['기준은 무엇인가요?'], unresolved: [], evidence: [] };
const payload = { stage: 'draft', model: 'default', input: { field: '일반행정', complaint: '가상 민원 $(실행금지) `명령 아님` 한글 🌱' } };
const paths = { claude: 'C:/fixed/claude.exe', node: 'C:/fixed/node.exe', codex: 'C:/fixed/codex.js', codexNative: 'C:/fixed/codex.exe' };
const codexHome = 'C:/fixed/minwon-codex-home';
const requiredFlags = ['--ignore-user-config', '--ignore-rules', '--strict-config', '--ephemeral', '--json', '--output-schema', '--color'];
const catalog = [{
  slug: 'codex-test', display_name: 'Test Codex', default_reasoning_level: 'medium',
  supported_reasoning_levels: [{ effort: 'low', description: 'Quick' }, { effort: 'medium', description: 'Balanced' }, { effort: 'high', description: 'Thorough' }],
  shell_type: 'local', apply_patch_tool_type: 'freeform', experimental_supported_tools: ['web_search', 'mcp'],
  supports_search_tool: true, include_skills_usage_instructions: true, include_plugin_usage_instructions: true,
  include_apps_usage_instructions: true, node_repl_disabled: false, input_modalities: ['text', 'image'], tool_mode: 'auto',
}];
const blockedCapabilities = {
  shell_type: 'disabled', apply_patch_tool_type: null, experimental_supported_tools: [],
  supports_search_tool: false, include_skills_usage_instructions: false, include_plugin_usage_instructions: false,
  include_apps_usage_instructions: false, node_repl_disabled: true, input_modalities: ['text'], tool_mode: 'direct',
};
const events = (output = answer) => [
  { type: 'thread.started', thread_id: 'fictional-thread' },
  { type: 'turn.started' },
  { type: 'item.started', item: { id: 'reasoning', type: 'reasoning', text: '' } },
  { type: 'item.updated', item: { id: 'reasoning', type: 'reasoning', text: '검토 중' } },
  { type: 'item.completed', item: { id: 'reasoning', type: 'reasoning', text: '가상 자료만 사용' } },
  { type: 'item.completed', item: { id: 'answer', type: 'agent_message', text: JSON.stringify(output) } },
  { type: 'turn.completed', usage: { input_tokens: 2, output_tokens: 3 } },
];
const jsonl = values => values.map(value => JSON.stringify(value)).join('\n');

test('공식 catalog 배열의 모델·추론 수준을 보존하고 도구 기능만 제한한다', () => {
  const original = structuredClone(catalog);
  const restricted = buildCodexCatalog(catalog);
  assert.equal(Array.isArray(restricted), true);
  assert.notEqual(restricted, catalog);
  assert.notEqual(restricted[0], catalog[0]);
  assert.equal(restricted[0].slug, original[0].slug);
  assert.equal(restricted[0].display_name, original[0].display_name);
  assert.equal(restricted[0].default_reasoning_level, 'medium');
  assert.deepEqual(restricted[0].supported_reasoning_levels, original[0].supported_reasoning_levels);
  for (const [key, value] of Object.entries(blockedCapabilities)) assert.deepEqual(restricted[0][key], value, key);
  assert.deepEqual(catalog, original, '공식 원본을 제자리에서 변경하지 않는다');
});

test('catalog 객체의 envelope와 여러 모델을 유지하며 각 모델을 제한한다', () => {
  const envelope = { models: [...catalog, { ...catalog[0], slug: 'second-model', default_reasoning_level: 'high' }], version: 'fixture-v1' };
  const restricted = buildCodexCatalog(envelope);
  assert.equal(Array.isArray(restricted), false);
  assert.equal(restricted.version, 'fixture-v1');
  assert.deepEqual(restricted.models.map(model => model.slug), ['codex-test', 'second-model']);
  assert.equal(restricted.models[1].default_reasoning_level, 'high');
  for (const model of restricted.models) for (const [key, value] of Object.entries(blockedCapabilities)) assert.deepEqual(model[key], value);
  assert.equal(envelope.models[1].shell_type, 'local');
});

test('공식 모델 목록을 확인할 수 없는 catalog는 격리 가능으로 간주하지 않는다', () => {
  for (const value of [null, [], {}, { models: [] }, { models: 'invalid' }, [null], [{ display_name: 'missing slug' }]]) {
    assert.throws(() => buildCodexCatalog(value), { code: 'CODEX_CAPABILITIES_UNAVAILABLE' });
  }
});

test('JSONL reader는 분할 줄·한글·마지막 개행 없는 정상 완료를 읽는다', () => {
  const reader = createCodexEventReader();
  const source = jsonl(events());
  for (let index = 0; index < source.length; index += 3) reader.push(source.slice(index, index + 3));
  const result = reader.finish();
  assert.deepEqual(result.output, answer);
  assert.deepEqual(result.diagnostic, { threadId: 'fictional-thread', events: 7, toolEvents: 0, completed: true });
  assert.equal(JSON.stringify(result.diagnostic).includes(answer.answer), false);
});

test('JSONL reader는 reasoning을 답변으로 사용하지 않고 빈 줄·CRLF를 처리한다', () => {
  const reader = createCodexEventReader();
  reader.push('\r\n');
  reader.push(jsonl(events()).replaceAll('\n', '\r\n') + '\r\n\r\n');
  assert.deepEqual(reader.finish().output, answer);
});

test('Codex 재연결 error item 뒤 정상 최종 JSON·완료가 오면 category 알림만 남기고 성공한다', () => {
  const notices = [];
  const reader = createCodexEventReader({ onProviderNotice: notice => notices.push(notice) });
  const reconnect = { type: 'item.completed', item: { id: 'notice', type: 'error', message: 'Reconnecting stream: private-fixture-body https://fixture.invalid/private-token' } };
  reader.push(jsonl([...events().slice(0, 2), reconnect, ...events().slice(2)]) + '\n');
  const result = reader.finish();
  assert.deepEqual(result.output, answer);
  assert.equal(result.diagnostic.completed, true);
  assert.equal(result.diagnostic.toolEvents, 0);
  assert.equal(result.diagnostic.events, 8);
  assert.deepEqual(notices, [{ category: 'network' }]);
  assert.equal(JSON.stringify({ notices, diagnostic: result.diagnostic }).includes('private-fixture'), false);
  assert.equal(JSON.stringify({ notices, diagnostic: result.diagnostic }).includes('private-token'), false);
});

test('재연결 알림만 있거나 이후 fatal 오류·실패한 turn은 완료 응답으로 승격하지 않는다', () => {
  const reconnect = { type: 'item.completed', item: { id: 'notice', type: 'error', message: 'Reconnecting network: do-not-leak-private-fixture' } };
  const finalAnswer = events().find(event => event.item?.type === 'agent_message');
  for (const tail of [
    [],
    [{ type: 'turn.completed' }],
    [finalAnswer],
    [finalAnswer, { type: 'error', message: 'do-not-leak-private-fixture' }, { type: 'turn.completed' }],
    [finalAnswer, { type: 'turn.failed', error: { message: 'do-not-leak-private-fixture' } }],
  ]) {
    const notices = [];
    const reader = createCodexEventReader({ onProviderNotice: notice => notices.push(notice) });
    reader.push(jsonl([{ type: 'turn.started' }, reconnect, ...tail]) + '\n');
    assert.throws(() => reader.finish(), error => error.code === 'PROVIDER_INCOMPLETE_OUTPUT' && !error.message.includes('private-fixture'));
    assert.deepEqual(notices, [{ category: 'network' }]);
  }
});

test('도구 item은 시작·수정·완료 어느 시점이든 즉시 차단한다', () => {
  for (const type of ['item.started', 'item.updated', 'item.completed']) {
    for (const itemType of ['command_execution', 'file_change', 'mcp_tool_call', 'web_search', 'image_view', 'todo_list', 'unknown_tool']) {
      const reader = createCodexEventReader();
      const value = { type, item: { id: 'blocked', type: itemType, command: 'do-not-run', text: '가상 비신뢰 원문' } };
      assert.throws(() => reader.push(JSON.stringify(value) + '\n'), error => error.code === 'CODEX_TOOL_EVENT_BLOCKED' && !error.message.includes('do-not-run') && !error.message.includes('가상 비신뢰 원문'), `${type}/${itemType}`);
    }
  }
});

test('알 수 없는 이벤트와 도구형 item 누락도 정상 응답으로 처리하지 않는다', () => {
  for (const value of [{ type: 'tool.started' }, { type: 'future.event' }, { type: 'item.started', item: {} }, { type: 'item.completed' }]) {
    const reader = createCodexEventReader();
    assert.throws(() => reader.push(JSON.stringify(value) + '\n'), { code: 'CODEX_TOOL_EVENT_BLOCKED' });
  }
});

test('실패·오류·미완료·답변 없는 turn은 부분 결과를 성공으로 돌려주지 않는다', () => {
  const complete = events();
  for (const values of [
    complete.slice(0, -1),
    [...complete.slice(0, -1), { type: 'turn.failed', error: { message: 'do-not-leak-provider-detail' } }],
    [...complete, { type: 'error', message: 'do-not-leak-provider-detail' }],
    [{ type: 'turn.started' }, { type: 'turn.completed' }],
    [],
  ]) {
    const reader = createCodexEventReader();
    reader.push(jsonl(values));
    assert.throws(() => reader.finish(), error => error.code === 'PROVIDER_INCOMPLETE_OUTPUT' && !error.message.includes('do-not-leak-provider-detail'));
  }
});

test('JSONL의 잘못된 JSON 또는 구조화 답변은 원문 없이 거부한다', () => {
  const invalidLine = createCodexEventReader();
  assert.throws(() => invalidLine.push('not-json secret-fixture\n'), error => error.code === 'INVALID_PROVIDER_OUTPUT' && !error.message.includes('secret-fixture'));
  const invalidAnswer = createCodexEventReader();
  invalidAnswer.push(jsonl([{ type: 'item.completed', item: { type: 'agent_message', text: 'not-json secret-fixture' } }, { type: 'turn.completed' }]));
  assert.throws(() => invalidAnswer.finish(), error => error.code === 'INVALID_PROVIDER_OUTPUT' && !error.message.includes('secret-fixture'));
});

function snapshotFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...snapshotFiles(path));
    else if (entry.isFile()) files.push({ path, text: readFileSync(path, 'utf8') });
  }
  return files;
}

function fakeCodex({ version = 'codex-cli 0.160.0', help = requiredFlags.join(' '), models = catalog, loggedIn = true, outputEvents = events(), splitBytes = false, hang = false, onGeneration, stdinError = false, deferClose = false, instructionsFile } = {}) {
  const calls = [];
  const spawnImpl = (binary, args, options) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    const generation = args.includes('exec') && !args.includes('--help');
    const schemaPath = generation ? args[args.indexOf('--output-schema') + 1] : '';
    const call = { binary, args, options, input: '', killed: false, files: generation ? snapshotFiles(dirname(schemaPath)) : [] };
    call.close = (code = 1) => child.emit('close', code);
    calls.push(call);
    child.stdin.setEncoding('utf8');
    child.stdin.on('data', value => { call.input += value; });
    child.kill = () => { call.killed = true; if (!generation || !deferClose) queueMicrotask(() => child.emit('close', 1)); return true; };
    child.stdin.on('finish', () => queueMicrotask(() => {
      if (args.includes('login') && args.includes('status')) child.stderr.end(loggedIn ? 'Logged in using ChatGPT' : 'Not logged in');
      else if (args.includes('--version')) child.stdout.end(version);
      else if (args.includes('--help')) child.stdout.end(help);
      else if (args.includes('debug') && args.includes('models') && args.includes('--bundled')) child.stdout.end(JSON.stringify(models));
      else if (generation) {
        onGeneration?.();
        if (stdinError) { child.stdin.emit('error', Object.assign(new Error('EPIPE private-fixture-body'), { code: 'EPIPE' })); return; }
        if (hang) return;
        const bytes = Buffer.from(jsonl(outputEvents) + '\n');
        if (splitBytes) { for (let index = 0; index < bytes.length; index++) child.stdout.write(bytes.subarray(index, index + 1)); child.stdout.end(); }
        else child.stdout.end(bytes);
      } else child.stdout.end('{}');
      child.emit('close', 0);
    }));
    return child;
  };
  const provider = createProviderService({ spawnImpl, exists: async path => {
    const instructions = /(?:^|[\\/])(AGENTS(?:\.override)?\.md)$/i.exec(path);
    if (instructions) return instructions[1] === instructionsFile;
    return path !== paths.claude;
  }, paths, codexHome, environment: {
    PATH: 'safe', USERPROFILE: 'C:/fixture-user', OPENAI_API_KEY: 'must-not-forward', OPENAI_BASE_URL: 'https://untrusted.invalid',
    ANTHROPIC_API_KEY: 'must-not-forward', CLAUDE_CODE_OAUTH_TOKEN: 'must-not-forward', CODEX_HOME: 'C:/unsafe/globalhome',
    NODE_OPTIONS: '--require unsafe', NODE_PATH: 'C:/unsafe', HTTP_PROXY: 'http://untrusted.invalid',
  } });
  return { provider, calls };
}

async function assertTemporaryFilesRemoved(generation) {
  await assert.rejects(access(generation.options.cwd), { code: 'ENOENT' });
  const schemaPath = generation.args[generation.args.indexOf('--output-schema') + 1];
  await assert.rejects(access(dirname(schemaPath)), { code: 'ENOENT' });
  for (const file of generation.files) await assert.rejects(access(file.path), { code: 'ENOENT' });
}

test('Codex 상태는 ChatGPT 인증·검증 버전·필수 flags·공식 catalog 모두 있어야 connected다', async () => {
  const { provider, calls } = fakeCodex();
  const status = (await provider.getProviderStatuses()).find(item => item.id === 'codex');
  assert.equal(status.status, 'connected');
  assert.deepEqual(status.models.map(item => item.id), ['default']);
  assert.equal(calls.some(call => call.args.includes('--version')), true);
  assert.equal(calls.some(call => call.args.includes('exec') && call.args.includes('--help')), true);
  assert.equal(calls.some(call => call.args.includes('debug') && call.args.includes('models') && call.args.includes('--bundled')), true);
  assert.equal(calls.some(call => call.input.includes('가상 민원')), false);
  for (const call of calls) assert.equal(resolve(call.options.env.CODEX_HOME), resolve(codexHome), '모든 Codex probe는 앱 전용 홈을 사용한다');
});

test('앱 전용 Codex 홈의 AGENTS·override가 있으면 setup으로 제한하고 생성을 거부한다', async () => {
  for (const instructionsFile of ['AGENTS.md', 'AGENTS.override.md']) {
    const { provider, calls } = fakeCodex({ instructionsFile });
    const status = (await provider.getProviderStatuses()).find(item => item.id === 'codex');
    assert.equal(status.status, 'setup');
    assert.match(status.message, /앱 전용 Codex 폴더.*사용자 지침/);
    await assert.rejects(provider.generate('codex', payload), { code: 'PROVIDER_NOT_CONNECTED' });
    assert.equal(calls.some(call => call.args.includes('exec') && !call.args.includes('--help')), false, instructionsFile);
    assert.equal(calls.some(call => call.input.includes('가상 민원')), false, '사용자 자료가 native CLI로 전달되지 않는다');
  }
});

test('인증·버전·격리 flag·모델 기능 누락이면 Codex 연결과 생성을 허용하지 않는다', async () => {
  for (const options of [{ loggedIn: false }, { version: 'codex-cli 0.159.0' }, { help: '--json --ephemeral' }, { models: [] }]) {
    const { provider, calls } = fakeCodex(options);
    const status = (await provider.getProviderStatuses()).find(item => item.id === 'codex');
    assert.notEqual(status.status, 'connected');
    await assert.rejects(provider.generate('codex', payload), { code: 'PROVIDER_NOT_CONNECTED' });
    assert.equal(calls.some(call => call.args.includes('exec') && !call.args.includes('--help')), false);
  }
});

test('Codex 생성은 고정 native argv·stdin·정제 환경과 임시 격리 catalog를 사용한다', async () => {
  const { provider, calls } = fakeCodex({ splitBytes: true });
  assert.deepEqual(await provider.generate('codex', payload), answer);
  const generation = calls.find(call => call.args.includes('exec') && !call.args.includes('--help'));
  assert.equal(generation.binary, paths.codexNative);
  assert.notEqual(generation.binary, paths.node);
  assert.equal(generation.options.shell, false);
  assert.equal(generation.options.windowsHide, true);
  for (const flag of requiredFlags) assert.equal(generation.args.includes(flag), true, flag);
  assert.equal(generation.args[generation.args.indexOf('--color') + 1], 'never');
  assert.equal(generation.args.at(-1), '-');
  assert.equal(generation.args.some(value => value.includes('$(실행금지)')), false);
  assert.match(generation.input, /\$\(실행금지\)/);
  assert.match(generation.input, /한글 🌱/);
  for (const name of ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'NODE_OPTIONS', 'NODE_PATH', 'HTTP_PROXY']) assert.equal(generation.options.env[name], undefined, name);
  assert.equal(resolve(generation.options.env.CODEX_HOME), resolve(codexHome));
  assert.notEqual(resolve(generation.options.env.CODEX_HOME), resolve('C:/unsafe/globalhome'));
  const schemaPath = generation.args[generation.args.indexOf('--output-schema') + 1];
  assert.equal(generation.files.some(file => file.path === schemaPath && JSON.parse(file.text).type === 'object'), true);
  const parsedCatalog = generation.files.map(file => { try { return JSON.parse(file.text); } catch { return null; } }).find(value => Array.isArray(value) || Array.isArray(value?.models));
  const restricted = Array.isArray(parsedCatalog) ? parsedCatalog : parsedCatalog?.models;
  assert.ok(restricted?.length, '실행 전에 별도 제한 catalog를 기록한다');
  for (const [key, value] of Object.entries(blockedCapabilities)) assert.deepEqual(restricted[0][key], value, key);
  assert.equal(generation.files.some(file => /한국 교육행정|민원 답변/.test(file.text)), true, '별도 시스템 지침 파일을 사용한다');
  await assertTemporaryFilesRemoved(generation);
});

test('Codex 도구 이벤트는 성공 JSON 뒤에 있어도 차단하고 임시 파일을 정리한다', async () => {
  const { provider, calls } = fakeCodex({ outputEvents: [...events().slice(0, -1), { type: 'item.started', item: { type: 'command_execution', command: 'secret-command-fixture' } }, { type: 'turn.completed' }] });
  await assert.rejects(provider.generate('codex', payload), error => error.code === 'CODEX_TOOL_EVENT_BLOCKED' && !error.message.includes('secret-command-fixture'));
  const generation = calls.find(call => call.args.includes('exec') && !call.args.includes('--help'));
  assert.equal(generation.killed, true);
  await assertTemporaryFilesRemoved(generation);
});

test('Codex 실패 turn은 정상 답변을 반환하지 않고 임시 파일을 정리한다', async () => {
  const { provider, calls } = fakeCodex({ outputEvents: [...events().slice(0, -1), { type: 'turn.failed', error: { message: 'do-not-leak-fixture' } }] });
  await assert.rejects(provider.generate('codex', payload), error => error.code === 'PROVIDER_INCOMPLETE_OUTPUT' && !error.message.includes('do-not-leak-fixture'));
  const generation = calls.find(call => call.args.includes('exec') && !call.args.includes('--help'));
  await assertTemporaryFilesRemoved(generation);
});

test('Codex 실행 취소는 프로세스를 종료하고 입력·원문을 반환하지 않는다', async () => {
  const controller = new AbortController();
  const { provider, calls } = fakeCodex({ hang: true, onGeneration: () => controller.abort() });
  const result = provider.generate('codex', payload, { signal: controller.signal });
  await assert.rejects(result, { code: 'GENERATION_ABORTED' });
  const generation = calls.find(call => call.args.includes('exec') && !call.args.includes('--help'));
  assert.ok(generation, '취소 전에 가상 CLI 실행을 시작했다');
  assert.equal(generation.killed, true);
  await assertTemporaryFilesRemoved(generation);
});

test('이미 취소한 Codex 요청은 인증 probe와 생성 프로세스도 실행하지 않는다', async () => {
  const { provider, calls } = fakeCodex();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(provider.generate('codex', payload, { signal: controller.signal }), { code: 'GENERATION_ABORTED' });
  assert.equal(calls.length, 0);
});

test('stdin EPIPE는 native 종료를 기다리는 동안 임시 자료를 보존하고 close 뒤 제거한다', async () => {
  let started;
  const generationStarted = new Promise(resolve => { started = resolve; });
  const { provider, calls } = fakeCodex({ stdinError: true, deferClose: true, onGeneration: started });
  let settled = false;
  const outcome = provider.generate('codex', payload)
    .then(value => ({ value }), error => ({ error }))
    .finally(() => { settled = true; });
  await generationStarted;
  const generation = calls.find(call => call.args.includes('exec') && !call.args.includes('--help'));
  try {
    assert.equal(generation.killed, true, 'stdin 오류 직후 native 종료를 요청한다');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false, 'native close 확인 전에는 생성 Promise를 완료하지 않는다');
    await access(generation.options.cwd);
    const schemaPath = generation.args[generation.args.indexOf('--output-schema') + 1];
    await access(dirname(schemaPath));
    for (const file of generation.files) await access(file.path);
  } finally { generation.close(1); }
  const result = await outcome;
  assert.equal(result.error?.code, 'CLI_INPUT_FAILED');
  assert.equal(result.error?.message.includes('private-fixture-body'), false);
  assert.equal('value' in result, false);
  await assertTemporaryFilesRemoved(generation);
});

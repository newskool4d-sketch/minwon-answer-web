const $ = (id) => document.getElementById(id);
const stageNames = { draft: '초안 생성', review: '답변 검토', rewrite: '재작성' };
const providerNames = { demo: '데모', claude: 'Claude', codex: 'Codex', gemini: 'Gemini' };
const caseKeys = ['title', 'field', 'type', 'direction', 'body', 'facts', 'questions', 'actions', 'department', 'receivedAt', 'deadline', 'evidenceText'];
const statusNames = { connected: '연결됨', disconnected: '미연결', unavailable: '사용 불가', not_checked: '미확인', setup: '설정 필요', not_installed: '프로그램 미설치', needs_setup: '설정 필요', setup_required: '설정 필요', unverified: '미검증', expired: '인증 만료', limited: '사용량 제한', blocked: '사용 제한', authenticated: '인증 확인', ready: '사용 준비됨' };
const hosted = !['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);
const localApiBase = 'http://127.0.0.1:8793';
const connectionHelp = '브라우저의 로컬 기기 접근 허용, 내 PC 로컬 프로그램 실행(8793), 로컬 웹 연결 관리에서 이 웹 주소의 접근 허용을 확인하세요. 작성 내용은 화면에 유지됩니다.';
let state;
let config;
let csrfToken = '';
let remoteSessionToken = '';
let appReady = false;
let connectionBusy = false;
let issuedCodeTimer;
let busy = false;
let pendingRun = false;
let caseDirty = false;
let answerDirty = false;
let viewId = null;
let selectedFindings = new Set();
let renderedReviewId = null;
let renderedEditVersionId = null;
let pendingPreview = null;
let pendingArguments = null;
let answerFont = 17;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function notice(message, error = false) {
  const target = $(error ? 'error-notice' : 'notice');
  target.textContent = message;
  target.hidden = !message;
  if (!error) $('error-notice').hidden = true;
}

function fail(error) {
  const message = error?.message || '요청을 완료하지 못했습니다. 입력은 유지됩니다.';
  notice(error?.code ? `${error.code} · ${message}` : message, true);
}

async function api(path, body, { acceptState = true } = {}) {
  if (hosted && !remoteSessionToken) throw Object.assign(new Error('내 PC에 먼저 연결하세요. 작성 내용은 화면에 유지됩니다.'), { code: 'LOCAL_CONNECTION_REQUIRED' });
  const options = { credentials: hosted ? 'omit' : 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store', referrerPolicy: 'no-referrer' };
  if (hosted) { options.mode = 'cors'; options.targetAddressSpace = 'loopback'; options.headers['X-Minwon-Session'] = remoteSessionToken; }
  if (body !== undefined) {
    options.method = 'POST';
    options.headers['Content-Type'] = 'application/json';
    options.headers['X-CSRF-Token'] = csrfToken;
    options.body = JSON.stringify(body);
  }
  let response;
  try { response = await fetch(hosted ? localApiBase + path : path, options); }
  catch { throw Object.assign(new Error(hosted ? connectionHelp : '로컬 서버에 연결할 수 없습니다. 서버 실행 상태를 확인한 뒤 다시 시도하세요. 작성 내용은 화면에 유지됩니다.'), { code: 'NETWORK_ERROR' }); }
  let result;
  try { result = await response.json(); }
  catch { throw Object.assign(new Error('서버 응답 형식을 확인할 수 없습니다. 이전 입력과 답변을 유지합니다.'), { code: 'INVALID_RESPONSE' }); }
  if (!response.ok || result.error) {
    if (hosted && (response.status === 401 || result.error?.code === 'BRIDGE_SESSION_REQUIRED')) {
      remoteSessionToken = ''; csrfToken = ''; appReady = false;
      updateConnectionUi(); openConnection();
    }
    throw Object.assign(new Error(result.error?.message || `요청이 거부되었습니다 (${response.status}).`), { code: result.error?.code || `HTTP_${response.status}` });
  }
  if (result.csrfToken) csrfToken = result.csrfToken;
  if (acceptState && result.state) {
    state = result.state;
    render();
  }
  return result;
}

async function task(label, action) {
  if (busy) return;
  if (!appReady) { if (hosted) openConnection(); return; }
  busy = true;
  $('error-notice').hidden = true;
  setBusy(label);
  try { return await action(); }
  catch (error) { fail(error); }
  finally { busy = false; pendingRun = false; setBusy(); render(); }
}

function setBusy(label = '') {
  $('run-status').hidden = !label;
  $('run-status-text').textContent = label ? `${label}… 작성 내용과 직전 답변을 유지합니다.` : '';
  $('cancel-run').hidden = !pendingRun;
  $('case-fields').disabled = busy || !appReady;
  const controls = ['save-case', 'load-example', 'settings-open', 'reset-open', 'save-answer', 'edit-resolved', 'restore-version', 'save-checks', 'confirm-button', 'refresh-providers', 'connect-gemini', 'disconnect-gemini', 'web-manager-open', 'connection-disconnect'];
  for (const id of controls) $(id).disabled = busy || !appReady;
  $('answer-editor').readOnly = busy || !isCurrent();
  $('rewrite-instructions').disabled = busy;
  $('version-select').disabled = busy;
  $('human-checks').disabled = busy || !isCurrent();
  for (const control of document.querySelectorAll('#evidence-form input, #evidence-form textarea, #evidence-form button, #model-form select, #model-form button, .quick-prompts button, #review-findings input')) control.disabled = busy;
  for (const button of document.querySelectorAll('#provider-connections button')) button.disabled = busy || !state?.providers?.find((provider) => provider.id === button.dataset.provider)?.canLogin;
  $('issue-pair-code').disabled = hosted || busy || !appReady || !$('pair-code-approved').checked;
  for (const id of ['allowed-web-origin', 'pair-code-approved', 'revoke-web-connections']) $(id).disabled = hosted || busy || !appReady;
}

function currentVersion() { return state?.versions?.find((version) => version.id === state.currentVersionId); }
function viewedVersion() { return state?.versions?.find((version) => version.id === viewId) || currentVersion(); }
function isCurrent() { return !viewId || viewId === state?.currentVersionId; }
function option(value, label) { const node = element('option', label); node.value = value; return node; }
function labelOf(value) { return typeof value === 'string' ? value : value.label || value.name || value.id; }
function valueOf(value) { return typeof value === 'string' ? value : value.id || value.value || value.label; }

function fillSelect(select, items, placeholder) {
  select.replaceChildren();
  if (placeholder) select.append(option('', placeholder));
  for (const item of items || []) select.append(option(valueOf(item), labelOf(item)));
}

function hydrateCase() {
  if (!state) return;
  const form = $('case-form');
  $('field-search').value = '';
  fillSelect($('case-field'), config.fields, '민원 분야를 선택하세요');
  fillSelect($('case-type'), config.types, '처리 유형 선택');
  fillSelect($('case-direction'), config.directions);
  for (const key of caseKeys) if (form.elements.namedItem(key)) form.elements.namedItem(key).value = state.case[key] || '';
  $('classification').value = state.classification || 'fictional';
  caseDirty = false;
  fieldHelp();
  dirtyIndicators();
}

function readCase() {
  const values = {};
  for (const key of caseKeys) values[key] = $('case-form').elements.namedItem(key).value;
  return values;
}

function fieldHelp() {
  const field = config?.fields?.find((item) => item.id === $('case-field').value);
  $('field-hint').textContent = field?.hint || '분야를 선택하면 확인할 사항을 안내합니다.';
  $('field-checks').replaceChildren(...(field?.checks || []).map((text) => element('li', text)));
  $('classification-hint').textContent = $('classification').value === 'internal'
    ? '이 MVP는 실제 민원·비공개·민감 자료의 외부 AI 전송을 차단합니다. 가상 사례나 공개 비기밀 자료로 검증하세요.'
    : 'fictional' === $('classification').value ? '가상 자료로 먼저 작성 흐름을 확인해보세요.' : '공개되어 있고 비기밀인 내용인지 확인하세요. 공개 자료에도 개인정보가 포함될 수 있습니다.';
}

function dirtyIndicators() {
  $('input-state').textContent = caseDirty ? '변경사항 있음' : state?.case?.body ? '현재 세션에 저장됨' : '입력 중';
  $('save-hint').textContent = caseDirty ? '생성 전에 변경사항을 저장합니다.' : '현재 세션의 메모리에만 저장';
  $('save-answer').disabled = busy || !answerDirty || !isCurrent();
  $('confirm-button').disabled = busy || caseDirty || answerDirty || !isCurrent() || !currentVersion()?.gate?.canConfirm || Boolean(currentVersion()?.confirmed);
  $('copy-final').disabled = caseDirty || answerDirty || !isCurrent() || !currentVersion()?.confirmed;
  $('rewrite-button').disabled = busy || !isCurrent() || !currentVersion()?.reviewValid || caseDirty || answerDirty;
  if (caseDirty || answerDirty) {
    $('workflow-state').textContent = '수정 중 · 저장 후 재검토';
    $('review-count').textContent = '수정됨 · 재검토 필요';
  }
}

function markCaseDirty() { caseDirty = true; fieldHelp(); dirtyIndicators(); }

async function saveCase() {
  const values = readCase();
  await api('/api/case', { case: values, classification: $('classification').value });
  caseDirty = false;
  render();
}

async function saveAnswer() {
  if (!answerDirty || !currentVersion()) return;
  const answer = $('answer-editor').value;
  const resolvedUnresolved = Boolean(currentVersion().unresolved?.length) && $('edit-resolved').checked;
  await api('/api/edit', { answer, expectedRevision: state.revision, resolvedUnresolved });
  $('edit-resolved').checked = false;
  answerDirty = false;
  viewId = state.currentVersionId;
  render({ syncAnswer: true });
}

function formattedTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function sourceLabel(source) {
  if (typeof source === 'object' && source) return `${providerNames[source.provider] || source.provider || ''}${source.model ? ` · ${source.model}` : ''}`;
  return providerNames[source] || ({ manual: '담당자 수동 편집', restore: '이전 버전 복원', restored: '이전 버전에서 복원' })[source] || String(source || '미확인');
}

function render({ syncAnswer = false } = {}) {
  if (!state || !appReady) return;
  const version = viewedVersion();
  if (viewId && !state.versions.some((item) => item.id === viewId)) viewId = state.currentVersionId;
  $('empty-answer').hidden = Boolean(version);
  $('answer-content').hidden = !version;
  const draftProvider = state.selections?.draft?.provider || 'demo';
  $('mode-badge').textContent = draftProvider === 'demo' ? '데모 · 외부 전송 없음' : `${providerNames[draftProvider] || draftProvider} 선택 · 실행 전 전송 확인`;
  $('mode-badge').className = `badge ${draftProvider === 'demo' ? 'demo' : ''}`;
  $('stage-models').replaceChildren(...Object.keys(stageNames).map((stage) => {
    const selection = state.selections?.[stage] || { provider: 'demo', model: 'default' };
    return element('span', `${stageNames[stage]} · ${providerNames[selection.provider] || selection.provider}${selection.model === 'default' ? '' : ` / ${selection.model}`}`);
  }));
  $('draft-button').disabled = busy || !isCurrent();
  $('review-button').disabled = busy || !version || !isCurrent();
  $('rewrite-button').disabled = busy || !version || !isCurrent() || !version.reviewValid || caseDirty || answerDirty;
  $('save-checks').disabled = busy || !version || !isCurrent();
  for (const control of document.querySelectorAll('#evidence-form input, #evidence-form textarea, #evidence-form button')) control.disabled = busy || !version || !isCurrent();
  let workflow = '입력 중';
  let step = 'draft';
  if (version) {
    step = version.confirmed ? 'confirm' : version.reviewValid ? 'rewrite' : 'review';
    workflow = version.confirmed ? '담당자 확정' : version.reviewValid ? (version.gate?.canConfirm ? '검토 완료 · 확정 가능' : '검토 완료 · 보완 필요') : '검토 필요';
    if (!isCurrent()) workflow = `이전 버전 v${version.number} 열람 중`;
  }
  $('workflow-state').textContent = workflow;
  $('workflow-state').className = `badge ${version?.confirmed ? 'confirmed' : ''}`;
  let passed = true;
  for (const name of ['draft', 'review', 'rewrite', 'confirm']) {
    const item = $(`step-${name}`);
    if (name === step) { item.setAttribute('aria-current', 'step'); passed = false; }
    else item.removeAttribute('aria-current');
    item.classList.toggle('done', passed);
  }
  if (version) {
    const previousValue = $('version-select').value;
    $('version-select').replaceChildren(...[...state.versions].reverse().map((item) => option(item.id, `v${item.number} · ${sourceLabel(item.source)}${item.confirmed ? ' · 확정' : ''}${item.id === state.currentVersionId ? ' · 현재' : ''}`)));
    $('version-select').value = viewId || state.currentVersionId || previousValue;
    if (!answerDirty || syncAnswer) $('answer-editor').value = version.answer || '';
    $('answer-editor').readOnly = busy || !isCurrent();
    $('answer-source').textContent = `${sourceLabel(version.source)}${String(typeof version.source === 'object' ? version.source?.provider : version.source).includes('demo') ? ' · 가상 결과' : ''}`;
    $('answer-time').textContent = formattedTime(version.createdAt);
    $('restore-version').hidden = isCurrent();
    $('return-current').hidden = isCurrent();
    $('save-answer').hidden = !isCurrent();
    $('restore-version').disabled = busy;
    $('answer-edit-hint').textContent = isCurrent() ? '직접 수정한 내용은 새 버전으로 저장됩니다. 저장 후 재검토가 필요합니다.' : '이전 버전을 읽고 있습니다. 복원하면 새 버전이 만들어집니다.';
    const editUnresolved = isCurrent() ? version.unresolved || [] : [];
    if (renderedEditVersionId !== version.id) { $('edit-resolved').checked = false; renderedEditVersionId = version.id; }
    $('edit-unresolved').hidden = !editUnresolved.length;
    $('edit-unresolved-list').replaceChildren(...editUnresolved.map((item) => element('li', item)));
    renderReview(version);
    renderVerification(version);
    renderDiff(version);
    countCharacters();
  }
  $('disconnect-gemini').disabled = busy || !state.geminiConnected;
  dirtyIndicators();
}

function countCharacters() { $('char-count').textContent = `${$('answer-editor').value.length.toLocaleString('ko-KR')}자 (공백 포함)`; }

function renderReview(version) {
  const review = version.review;
  const valid = version.reviewValid && !caseDirty && !answerDirty;
  const findings = review?.findings || [];
  if (renderedReviewId !== review?.id) {
    selectedFindings = new Set(findings.map((finding) => finding.id));
    renderedReviewId = review?.id || null;
  }
  const blockers = findings.filter((finding) => finding.severity === 'blocker').length;
  const advice = findings.length - blockers;
  $('review-count').textContent = review ? `${valid ? '' : '만료 · '}차단 ${blockers} · 권고 ${advice}` : '검토 필요';
  $('review-summary').textContent = review ? `${valid ? '' : '현재 입력 또는 본문에 다시 검토가 필요합니다.\n'}${review.summary || '검토 결과를 확인하세요.'}` : '현재 답변을 검토하면 질문 대응과 확인사항을 보여줍니다.';
  const draftSelection = state.selections?.draft;
  const reviewSelection = state.selections?.review;
  const same = draftSelection?.provider === reviewSelection?.provider && draftSelection?.model === reviewSelection?.model;
  const reviewProvider = typeof review?.source === 'object' ? review.source?.provider : review?.source;
  const reviewMethod = reviewProvider === 'demo' ? '규칙 기반 점검' : same ? 'AI 자체 검토' : '다른 모델 검토';
  $('review-provenance').textContent = review ? `${sourceLabel(review.source)} · ${reviewMethod} · 사실·법령의 검증 완료를 뜻하지 않습니다.` : '';
  const nodes = [];
  if (review && !findings.length) nodes.push(element('p', '검토 의견이 없습니다. 담당자 확인과 서버의 확정 조건을 계속 확인하세요.', 'help'));
  for (const finding of findings) {
    const article = element('article', null, 'finding');
    const heading = element('div', null, 'finding-heading');
    const label = element('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedFindings.has(finding.id);
    checkbox.disabled = busy || !isCurrent() || !valid;
    checkbox.addEventListener('change', () => checkbox.checked ? selectedFindings.add(finding.id) : selectedFindings.delete(finding.id));
    label.append(checkbox, element('span', `${finding.category || '확인사항'} · 재작성에 반영`));
    heading.append(element('span', finding.severity === 'blocker' ? '차단' : '권고', `badge ${finding.severity === 'blocker' ? 'blocker' : 'advice'}`), label);
    article.append(heading);
    if (finding.paragraph !== undefined && finding.paragraph !== null) article.append(element('p', `대상 위치 · ${typeof finding.paragraph === 'number' ? `${finding.paragraph} 문단` : finding.paragraph}`, 'location'));
    article.append(element('p', finding.reason || '문제 사유 확인 필요'));
    if (finding.suggestion) article.append(element('p', finding.suggestion, 'suggestion'));
    nodes.push(article);
  }
  $('review-findings').replaceChildren(...nodes);
  const mappingContainer = $('question-mapping');
  mappingContainer.replaceChildren();
  if (review?.mapping?.length) {
    mappingContainer.append(element('h3', '질문별 답변 대조'));
    const wrap = element('div', null, 'table-wrap');
    const table = document.createElement('table');
    const caption = element('caption', '민원 요구사항과 답변 대응 현황', 'sr-only');
    const head = document.createElement('thead');
    const row = document.createElement('tr');
    for (const label of ['질문·요구사항', '대응', '답변 위치']) { const cell = element('th', label); cell.scope = 'col'; row.append(cell); }
    head.append(row);
    const body = document.createElement('tbody');
    for (const mapping of review.mapping) {
      const tr = document.createElement('tr');
      tr.append(element('td', mapping.question), element('td', mapping.answered ? '✓ 대응' : '! 미대응'), element('td', mapping.paragraph || '확인 필요'));
      body.append(tr);
    }
    table.append(caption, head, body); wrap.append(table); mappingContainer.append(wrap);
  }
}

function renderVerification(version) {
  const unresolved = version.unresolved || [];
  $('unresolved-items').replaceChildren();
  if (unresolved.length) {
    $('unresolved-items').append(element('h3', '확인 필요 항목'));
    $('unresolved-items').append(elementList(unresolved.map((item) => typeof item === 'string' ? item : item.message || item.item || item.description || JSON.stringify(item)), 'warning-list'));
  }
  const entries = [];
  for (const evidence of version.evidence || []) {
    const entry = element('div', null, 'evidence-entry');
    entry.append(element('strong', evidence.title || '근거 자료'), element('p', `상태: ${evidence.status || '수기 확인'} · 기준일: ${evidence.effectiveDate || '미입력'} · 확인일: ${evidence.checkedAt || '미입력'}`));
    if (evidence.checkedBy) entry.append(element('p', `확인 주체: ${evidence.checkedBy}`));
    if (evidence.url) {
      try {
        const url = new URL(evidence.url);
        if (url.protocol === 'https:' || url.protocol === 'http:') {
          const link = element('a', '공식 원문 열기 ↗'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; entry.append(link);
        }
      } catch { entry.append(element('p', '출처 URL 형식 확인 필요')); }
    }
    if (evidence.quote) entry.append(element('p', evidence.quote));
    entries.push(entry);
  }
  $('evidence-list').replaceChildren(...entries);
  for (const input of $('human-checks').querySelectorAll('input')) { input.checked = Boolean(version.checks?.[input.name]); input.disabled = busy || !isCurrent(); }
  const gate = version.gate || { canConfirm: false, reasons: ['서버 확정 조건을 확인할 수 없습니다.'] };
  const reasons = [...(gate.reasons || [])];
  if (caseDirty || answerDirty) reasons.unshift('변경사항을 저장한 뒤 현재 버전을 재검토하세요.');
  if (!isCurrent()) reasons.unshift('이전 버전은 확정할 수 없습니다. 현재 버전으로 돌아가거나 복원하세요.');
  $('gate-count').textContent = version.confirmed ? '확정됨' : `${reasons.length}개 확인 필요`;
  $('gate-reasons').replaceChildren(...(version.confirmed ? ['✓ 현재 버전을 담당자가 확정했습니다.'] : reasons.length ? reasons : ['✓ 현재 버전의 확정 조건을 충족했습니다.']).map((reason) => element('li', reason)));
  $('gate-reasons').classList.toggle('ready', version.confirmed || !reasons.length);
  $('confirm-button').textContent = version.confirmed ? '✓ 담당자 확정됨' : '이 답변을 담당자 확정';
}

function elementList(items, className) { const list = element('ul', null, className); for (const item of items) list.append(element('li', item)); return list; }

// Paragraph LCS keeps unchanged context readable and renders all source text as text nodes.
function renderDiff(version) {
  const previous = state.versions.find((item) => item.id === version.parentId);
  $('answer-diff').replaceChildren();
  if (!previous) { $('answer-diff').append(element('p', '첫 버전입니다. 재작성·수동 수정 후 비교할 수 있습니다.', 'help')); return; }
  const before = (previous.answer || '').split(/\n\s*\n/);
  const after = (version.answer || '').split(/\n\s*\n/);
  const changes = [];
  if (before.length * after.length > 40000) {
    changes.push({ text: previous.answer, kind: 'removed' }, { text: version.answer, kind: 'added' });
  } else {
    const matrix = Array.from({ length: before.length + 1 }, () => new Uint16Array(after.length + 1));
    for (let i = before.length - 1; i >= 0; i--) for (let j = after.length - 1; j >= 0; j--) matrix[i][j] = before[i] === after[j] ? matrix[i + 1][j + 1] + 1 : Math.max(matrix[i + 1][j], matrix[i][j + 1]);
    let i = 0; let j = 0;
    while (i < before.length || j < after.length) {
      if (i < before.length && j < after.length && before[i] === after[j]) { changes.push({ text: before[i++], kind: 'unchanged' }); j++; }
      else if (i < before.length && (j === after.length || matrix[i + 1][j] >= matrix[i][j + 1])) changes.push({ text: before[i++], kind: 'removed' });
      else changes.push({ text: after[j++], kind: 'added' });
    }
  }
  $('answer-diff').append(element('p', `v${previous.number} → v${version.number}${version.summary ? ` · ${version.summary}` : ''}`, 'help'));
  for (const change of changes) {
    const paragraph = element('div', null, `diff-paragraph diff-${change.kind}`);
    if (change.kind !== 'unchanged') paragraph.append(element('span', change.kind === 'added' ? '+ 추가된 문단' : '− 삭제된 문단', 'diff-label'));
    paragraph.append(document.createTextNode(change.text));
    $('answer-diff').append(paragraph);
  }
}

async function prepareStage(stage) {
  if (!isCurrent()) return;
  await task(stageNames[stage], async () => {
    if (caseDirty) await saveCase();
    if (answerDirty) await saveAnswer();
    const args = { stage, findingIds: [...selectedFindings], instructions: $('rewrite-instructions').value };
    const result = await api('/api/preview', args);
    if (result.preview.needsConsent) {
      pendingPreview = result.preview;
      pendingArguments = args;
      showConsent(result.preview);
    } else await runStage(args, result.preview.token);
  });
}

function showConsent(preview) {
  $('consent-approved').checked = false;
  $('consent-run').disabled = true;
  $('consent-provider').textContent = `${stageNames[preview.stage]} → ${providerNames[preview.provider] || preview.provider}`;
  $('consent-payload').value = preview.text || '';
  const warnings = [...(preview.warnings || []).map(labelOf)];
  if (preview.redactions?.length) warnings.unshift(`${preview.redactions.length}건의 자동 마스킹 정보가 있습니다. 남은 식별정보를 직접 확인하세요.`);
  $('consent-warnings').replaceChildren(...warnings.map((warning) => element('li', warning)));
  $('consent-dialog').showModal();
}

async function runStage(args, previewToken) {
  pendingRun = true;
  setBusy(stageNames[args.stage]);
  await api('/api/run', { ...args, previewToken });
  viewId = state.currentVersionId;
  answerDirty = false;
  render({ syncAnswer: true });
  if (args.stage === 'review') {
    $('review-panel').open = true;
    notice('현재 버전의 검토를 마쳤습니다. 차단 의견과 질문별 대조표를 확인하세요.');
  } else {
    if (args.stage === 'rewrite') $('diff-panel').open = true;
    notice(`${stageNames[args.stage]} 완료. 사실·근거를 직접 확인하고 현재 버전을 검토하세요.${args.stage === 'draft' && state.selections.draft.provider === 'demo' ? ' 데모는 실제 AI 생성이 아닌 가상 작성 흐름입니다.' : ''}`);
  }
}

function renderSettings() {
  const items = [];
  for (const id of ['claude', 'codex']) {
    const provider = state.providers.find((item) => item.id === id) || { id, status: 'not_checked', message: '연결 상태 다시 확인을 눌러 공식 프로그램의 로그인 상태를 확인해 주세요.' };
    const row = element('div', null, 'provider-item');
    const detail = element('div', null, 'provider-detail');
    detail.append(element('h3', providerNames[id]), element('span', statusNames[provider.status] || provider.status, `badge ${provider.status === 'connected' ? 'demo' : ''}`), element('p', provider.message || '', 'help'));
    const button = element('button', id === 'codex' ? 'ChatGPT로 로그인' : 'Claude 공식 로그인', 'button secondary');
    button.type = 'button'; button.dataset.provider = id; button.disabled = busy || !provider.canLogin;
    button.addEventListener('click', () => login(id));
    row.append(detail, button); items.push(row);
  }
  $('provider-connections').replaceChildren(...items);
  $('gemini-status').textContent = state.geminiConnected ? '✓ API 키 연결됨 · 실제 생성은 실행 버튼으로 별도 요청합니다.' : '현재 세션에 연결된 API 키가 없습니다.';
  $('disconnect-gemini').disabled = busy || !state.geminiConnected;
  const settings = [];
  for (const stage of Object.keys(stageNames)) {
    const row = element('div', null, 'model-selection');
    const label = element('label', stageNames[stage]); label.htmlFor = `provider-${stage}`;
    const columns = element('div', null, 'form-row');
    const left = document.createElement('div'); const right = document.createElement('div');
    const select = document.createElement('select'); select.id = `provider-${stage}`; select.setAttribute('aria-label', `${stageNames[stage]} 제공사`);
    for (const id of ['demo', 'claude', 'codex', 'gemini']) {
      const item = state.providers.find((provider) => provider.id === id);
      select.append(option(id, id === 'demo' ? '데모 · 외부 전송 없음' : `${providerNames[id]} · ${id === 'gemini' ? state.geminiConnected ? 'API 연결됨' : '미연결' : statusNames[item?.status] || item?.status || '미확인'}`));
    }
    select.value = state.selections?.[stage]?.provider || 'demo';
    const model = document.createElement('select'); model.id = `model-${stage}`; model.setAttribute('aria-label', `${stageNames[stage]} 모델`);
    select.addEventListener('change', () => updateModelSelect(stage));
    left.append(select); right.append(model); columns.append(left, right); row.append(label, columns); settings.push(row);
  }
  $('model-selections').replaceChildren(...settings);
  for (const stage of Object.keys(stageNames)) updateModelSelect(stage, state.selections?.[stage]?.model);
}

function updateModelSelect(stage, selected) {
  const id = $(`provider-${stage}`).value;
  const provider = state.providers.find((item) => item.id === id);
  const models = id === 'gemini' ? state.geminiModels : provider?.models;
  const select = $(`model-${stage}`);
  fillSelect(select, models || []);
  if (!select.options.length) select.append(option('', '연결 후 모델 확인'));
  if (selected && [...select.options].some((item) => item.value === selected)) select.value = selected;
}

async function login(provider) {
  await task('공식 로그인 준비', async () => {
    const result = await api('/api/providers/login', { provider });
    $('login-message').textContent = result.message || '공식 프로그램에서 로그인을 완료한 뒤 연결 상태를 다시 확인하세요.';
    $('login-link').hidden = true;
    if (result.url) {
      try {
        const url = new URL(result.url);
        const trusted = ['claude.ai', 'console.anthropic.com', 'platform.claude.com', 'auth.openai.com', 'chatgpt.com', 'openai.com'];
        if (url.protocol === 'https:' && trusted.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
          $('login-link').href = url.href; $('login-link').hidden = false;
        } else $('login-message').textContent += ' 공식 프로그램이 안내하는 로그인 창을 직접 확인하세요.';
      } catch { $('login-message').textContent += ' 로그인 주소 형식을 확인할 수 없습니다.'; }
    }
    renderSettings();
  });
}

function plainText(value) {
  return String(value || '')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*(?:---+|\*\*\*+|___+)\s*$/gm, '')
    .replace(/^```[^\n]*\n?/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1').replace(/~~([^~]+)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '• ');
}

async function copyAnswer(confirmed) {
  const version = viewedVersion();
  if (!version) return;
  if (confirmed && (!currentVersion()?.confirmed || !isCurrent() || caseDirty || answerDirty)) return;
  const text = confirmed ? plainText(version.answer) : `[검토 전 초안${sourceLabel(version.source).includes('데모') ? ' · 가상 결과' : ''}]\n\n${plainText($('answer-editor').value)}`;
  try { await navigator.clipboard.writeText(text); notice(confirmed ? '확정 답변 본문을 복사했습니다.' : '검토 전 초안 표시를 포함해 복사했습니다.'); }
  catch { fail(Object.assign(new Error('클립보드 권한을 확인하거나, 답변 본문을 직접 선택해 복사하세요.'), { code: 'CLIPBOARD_UNAVAILABLE' })); }
}

function exportText() {
  const version = viewedVersion();
  const final = version?.confirmed && isCurrent() && !caseDirty && !answerDirty;
  return { body: plainText($('answer-editor').value), status: final ? `담당자 확정${sourceLabel(version.source).includes('데모') ? ' · 가상 결과' : ''}` : `검토 전 초안${sourceLabel(version?.source).includes('데모') ? ' · 가상 결과' : ''}` };
}

function hasRetainedWork() { return caseDirty || answerDirty || Boolean($('case-body').value.trim() || $('answer-editor').value.trim()); }

function updateConnectionUi() {
  document.body.classList.toggle('is-disconnected', !appReady);
  $('workbench').inert = !appReady;
  $('connection-open').hidden = !hosted;
  $('connection-open').textContent = appReady ? '새 연결' : '내 PC 연결';
  $('connection-disconnect').hidden = !hosted || !remoteSessionToken;
  $('connection-disconnect').disabled = busy || connectionBusy;
  $('web-manager-open').hidden = hosted || config?.capabilities?.webPairing !== true;
  $('web-manager-open').disabled = busy || !appReady;
  $('connection-indicator').textContent = hosted ? appReady ? '웹 화면 · 내 PC 연결됨' : '웹 화면 · 내 PC 미연결' : '내 PC에서 작업 중';
  $('session-note').textContent = hosted
    ? '웹은 화면을 제공합니다. 작성 내용은 내 PC 서버와 이 브라우저 탭의 메모리에서 처리되며 새로고침하면 다시 연결해야 합니다.'
    : '작성 내용은 현재 세션의 메모리에서만 보관됩니다. 서버를 종료하면 사라집니다.';
  $('connection-retry').hidden = !remoteSessionToken;
  $('retained-work').hidden = !hasRetainedWork();
  setBusy();
}

function connectionMessage(message, error = false) {
  const target = $(error ? 'connection-error' : 'connection-message');
  target.textContent = message;
  target.hidden = !message;
  if (!error) $('connection-error').hidden = true;
}

function openConnection() {
  if (!hosted) return;
  for (const id of ['settings-dialog', 'consent-dialog', 'reset-dialog']) if ($(id).open) $(id).close();
  $('web-origin').value = location.origin;
  $('pair-code').value = '';
  $('retained-work').hidden = !hasRetainedWork();
  $('connection-retry').hidden = !remoteSessionToken;
  if (!$('connection-dialog').open) $('connection-dialog').showModal();
}

function clearIssuedCode() {
  clearTimeout(issuedCodeTimer);
  $('issued-pair-code').value = '';
  $('issued-code-section').hidden = true;
  $('issued-code-details').textContent = '';
}

function openWebManager() {
  if (hosted || !appReady || busy || config?.capabilities?.webPairing !== true) return;
  $('pair-code-approved').checked = false;
  $('issue-pair-code').disabled = true;
  $('web-manager-message').hidden = true;
  clearIssuedCode();
  if (!$('web-manager-dialog').open) $('web-manager-dialog').showModal();
}

async function loadWorkspace() {
  // Commit both responses together so a failed reconnect never replaces the displayed work.
  const results = await Promise.all([
    api('/api/config', undefined, { acceptState: false }),
    api('/api/session', undefined, { acceptState: false }),
  ]);
  if (!results[1].state || !Array.isArray(results[0].fields)) throw Object.assign(new Error('작성 공간 응답을 확인할 수 없습니다. 이전 작업은 화면에 유지됩니다.'), { code: 'INVALID_RESPONSE' });
  config = results[0]; state = results[1].state;
  caseDirty = false; answerDirty = false; viewId = null;
  selectedFindings.clear(); renderedReviewId = null;
  $('rewrite-instructions').value = '';
  if (!currentVersion()) $('answer-editor').value = '';
  appReady = true;
  hydrateCase(); updateConnectionUi(); render({ syncAnswer: true });
}

async function connectFromCode(event) {
  event.preventDefault();
  if (!hosted || connectionBusy || busy) return;
  const code = $('pair-code').value.trim();
  if (!code) { $('pair-code').focus(); return; }
  if (hasRetainedWork() && !window.confirm('기존 화면의 작업을 새 연결 세션으로 바꿀까요? 필요한 입력·답변은 먼저 현재 작업 내려받기로 보관하세요. 취소하면 화면을 유지합니다.')) return;
  connectionBusy = true;
  $('pair-connect').disabled = true;
  $('connection-retry').disabled = true;
  connectionMessage('내 PC의 연결 허용과 코드를 확인하는 중입니다.');
  try {
    // The only unauthenticated cross-origin request: one explicit user gesture, fixed loopback.
    const request = fetch(`${localApiBase}/api/pair`, {
      method: 'POST', credentials: 'omit', mode: 'cors', targetAddressSpace: 'loopback',
      cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(20_000),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
    });
    $('pair-code').value = '';
    let response;
    try { response = await request; } catch { throw Object.assign(new Error(connectionHelp), { code: 'LOCAL_CONNECTION_FAILED' }); }
    let result;
    try { result = await response.json(); } catch { throw Object.assign(new Error(`연결 응답을 확인할 수 없습니다. ${connectionHelp}`), { code: 'INVALID_RESPONSE' }); }
    if (!response.ok || result.error) throw Object.assign(new Error(`${result.error?.message || '연결 코드가 거부되었습니다.'} ${connectionHelp}`), { code: result.error?.code || 'PAIRING_FAILED' });
    if (typeof result.sessionToken !== 'string' || !result.sessionToken || typeof result.csrfToken !== 'string' || !result.csrfToken) throw Object.assign(new Error('연결 인증 응답이 올바르지 않습니다. 로컬에서 새 코드를 발급하세요.'), { code: 'INVALID_PAIR_RESPONSE' });
    remoteSessionToken = result.sessionToken;
    csrfToken = result.csrfToken;
    await loadWorkspace();
    $('connection-dialog').close();
    notice('내 PC의 작성 공간에 연결했습니다. AI 외부 전송은 각 단계에서 별도로 확인합니다.');
  } catch (error) {
    connectionMessage(`${error.code || 'CONNECTION_FAILED'} · ${error.message}`, true);
    $('connection-retry').hidden = !remoteSessionToken;
  } finally {
    connectionBusy = false;
    $('pair-connect').disabled = false;
    $('connection-retry').disabled = false;
  }
}

function bindConnectionEvents() {
  $('connection-open').addEventListener('click', openConnection);
  $('web-manager-open').addEventListener('click', openWebManager);
  $('pair-form').addEventListener('submit', connectFromCode);
  $('connection-dialog').addEventListener('close', () => { $('pair-code').value = ''; });
  $('connection-retry').addEventListener('click', async () => {
    if (!remoteSessionToken || connectionBusy || busy) return;
    if (hasRetainedWork() && !window.confirm('기존 화면의 작업을 연결된 세션으로 바꿀까요? 필요한 내용을 먼저 내려받으세요.')) return;
    connectionBusy = true; $('connection-retry').disabled = true;
    try { await loadWorkspace(); $('connection-dialog').close(); notice('내 PC의 작성 공간을 다시 불러왔습니다.'); }
    catch (error) { connectionMessage(`${error.code || 'CONNECTION_FAILED'} · ${error.message}`, true); }
    finally { connectionBusy = false; $('connection-retry').disabled = false; }
  });
  $('copy-web-origin').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.origin); connectionMessage('현재 웹 주소를 복사했습니다. 로컬 웹 연결 관리에 붙여 넣으세요.'); }
    catch { connectionMessage('주소를 직접 선택해 복사하세요. 클립보드 권한을 확인할 수 없습니다.', true); $('web-origin').select(); }
  });
  $('connection-disconnect').addEventListener('click', async () => {
    if (!hosted || connectionBusy || busy || !remoteSessionToken) return;
    if (hasRetainedWork() && !window.confirm('내 PC 연결을 해제할까요? 웹 세션은 끝나며 화면의 입력·답변은 내려받을 수 있도록 유지합니다.')) return;
    connectionBusy = true; $('connection-disconnect').disabled = true;
    let message = '내 PC 연결을 해제했습니다. 화면의 기존 작업은 유지됩니다.';
    let disconnected = false;
    try { const result = await api('/api/pair/disconnect', {}); message = result.message || message; disconnected = true; }
    catch { message = '이 탭의 연결정보를 비웠습니다. 서버의 연결 해제는 확인하지 못했으므로 로컬 웹 연결 관리에서 모든 연결 해제를 사용하세요. 화면의 작업은 유지됩니다.'; }
    finally {
      remoteSessionToken = ''; csrfToken = ''; appReady = false; connectionBusy = false;
      $('gemini-key').value = ''; updateConnectionUi(); openConnection(); connectionMessage(message, !disconnected);
    }
  });
  $('download-retained-work').addEventListener('click', () => {
    const labels = { title: '제목', field: '분야', type: '처리 유형', direction: '답변 방향', body: '민원 본문', facts: '확인된 사실', questions: '요구사항과 질문', actions: '조치·계획', department: '담당 기관·부서', receivedAt: '접수일', deadline: '처리기한', evidenceText: '근거 입력' };
    const values = readCase();
    const text = ['현재 화면의 작업 보관 · 검토 전 초안', ...caseKeys.filter(key => values[key]).map(key => `${labels[key]}\n${values[key]}`), `답변 본문\n${$('answer-editor').value}`].join('\n\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'minwon-answer-연결전-작업.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1500);
  });
  $('pair-code-approved').addEventListener('change', () => { $('issue-pair-code').disabled = !$('pair-code-approved').checked || busy; });
  $('pair-code-form').addEventListener('submit', event => {
    event.preventDefault();
    if (hosted || !appReady || !$('pair-code-approved').checked || busy || config?.capabilities?.webPairing !== true) return;
    let origin;
    try {
      const value = $('allowed-web-origin').value.trim().replace(/\/$/, ''); const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || value !== url.origin) throw new Error();
      origin = url.origin;
    } catch { $('web-manager-message').textContent = '경로·쿼리가 없는 정확한 HTTPS 웹 주소를 입력하세요.'; $('web-manager-message').hidden = false; return; }
    task('웹 연결 코드 발급', async () => {
      try {
        clearIssuedCode();
        const result = await api('/api/pair/code', { origin, approved: true });
        $('issued-pair-code').value = result.code;
        $('issued-code-section').hidden = false;
        $('issued-code-details').textContent = `${result.origin || origin} · 만료 ${formattedTime(result.expiresAt)} · 한 번만 사용 가능`;
        $('pair-code-approved').checked = false;
        $('issue-pair-code').disabled = true;
        $('web-manager-message').textContent = '코드를 직접 복사하여 허용한 웹 화면에 입력하세요.'; $('web-manager-message').hidden = false;
        issuedCodeTimer = setTimeout(() => { clearIssuedCode(); $('web-manager-message').textContent = '연결 코드의 표시 시간이 끝났습니다. 필요한 경우 다시 허용해 발급하세요.'; }, Math.max(0, Math.min(300_000, new Date(result.expiresAt).getTime() - Date.now())));
      } catch (error) { $('web-manager-message').textContent = `${error.code || 'PAIR_CODE_FAILED'} · ${error.message}`; $('web-manager-message').hidden = false; throw error; }
    });
  });
  $('copy-pair-code').addEventListener('click', async () => {
    if (!$('issued-pair-code').value) return;
    try { await navigator.clipboard.writeText($('issued-pair-code').value); $('web-manager-message').textContent = '일회용 코드를 복사했습니다. 허용한 웹 화면에만 입력하세요.'; }
    catch { $('web-manager-message').textContent = '코드를 직접 선택해 복사하세요. 클립보드 권한을 확인할 수 없습니다.'; $('issued-pair-code').select(); }
    $('web-manager-message').hidden = false;
  });
  $('revoke-web-connections').addEventListener('click', () => {
    if (hosted || !appReady || busy || config?.capabilities?.webPairing !== true) return;
    task('모든 웹 연결 해제', async () => {
      try { const result = await api('/api/pair/revoke', {}); clearIssuedCode(); $('pair-code-approved').checked = false; $('issue-pair-code').disabled = true; $('web-manager-message').textContent = result.message || '모든 웹 연결·발급 코드를 해제했습니다. 로컬 작성 내용은 유지됩니다.'; $('web-manager-message').hidden = false; }
      catch (error) { $('web-manager-message').textContent = `${error.code || 'REVOKE_FAILED'} · ${error.message}`; $('web-manager-message').hidden = false; throw error; }
    });
  });
  $('web-manager-dialog').addEventListener('close', () => { clearIssuedCode(); $('pair-code-approved').checked = false; $('issue-pair-code').disabled = true; });
  window.addEventListener('hashchange', () => { if (location.hash === '#web-connection') openWebManager(); });
}

function bindEvents() {
  $('case-form').addEventListener('input', (event) => { if (event.target.id !== 'field-search') markCaseDirty(); });
  $('case-form').addEventListener('change', (event) => { if (event.target.id !== 'field-search') markCaseDirty(); });
  $('field-search').addEventListener('input', () => {
    const previous = $('case-field').value;
    const query = $('field-search').value.trim().toLocaleLowerCase('ko-KR');
    const fields = config.fields.filter((field) => field.id === previous || field.label.toLocaleLowerCase('ko-KR').includes(query));
    fillSelect($('case-field'), fields, query && fields.length === 0 ? '검색 결과 없음' : '민원 분야를 선택하세요');
    $('case-field').value = previous;
  });
  $('case-form').addEventListener('submit', (event) => { event.preventDefault(); task('입력 저장', async () => { await saveCase(); notice('입력을 현재 세션에 저장했습니다. 변경된 입력의 답변은 다시 검토해주세요.'); }); });
  $('load-example').addEventListener('click', () => {
    if ((caseDirty || answerDirty || state.case?.body || state.versions.length) && !window.confirm('현재 입력을 가상 예시로 바꿀까요? 기존 답변 버전은 남지만 현재 검토·확정이 만료됩니다.')) return;
    task('가상 예시 불러오기', async () => { await api('/api/case', config.example); hydrateCase(); notice('실제 민원인 정보가 없는 가상 예시를 불러왔습니다. 초안 생성을 눌러 작성 흐름을 확인하세요.'); });
  });
  for (const stage of Object.keys(stageNames)) $(`${stage}-button`).addEventListener('click', () => prepareStage(stage));
  $('save-answer').addEventListener('click', () => task('수동 수정 저장', async () => { await saveAnswer(); notice('수정 내용을 새 버전으로 저장했습니다. 현재 버전을 다시 검토하세요.'); }));
  $('answer-editor').addEventListener('input', () => { answerDirty = true; countCharacters(); dirtyIndicators(); $('rewrite-button').disabled = true; });
  $('version-select').addEventListener('change', () => {
    if (answerDirty && !window.confirm('저장하지 않은 답변 수정을 버리고 다른 버전을 볼까요?')) { $('version-select').value = viewId || state.currentVersionId; return; }
    answerDirty = false; viewId = $('version-select').value; render({ syncAnswer: true });
  });
  $('return-current').addEventListener('click', () => { viewId = state.currentVersionId; answerDirty = false; render({ syncAnswer: true }); });
  $('restore-version').addEventListener('click', () => task('이전 버전 복원', async () => { await api('/api/restore', { versionId: viewId }); viewId = state.currentVersionId; answerDirty = false; render({ syncAnswer: true }); notice('이전 본문을 새 버전으로 복원했습니다. 검토와 확정을 다시 진행하세요.'); }));
  $('cancel-run').addEventListener('click', async () => {
    $('cancel-run').disabled = true;
    try { await api('/api/cancel', {}); notice('실행 취소를 요청했습니다. 입력과 직전 정상 버전을 유지합니다.'); }
    catch (error) { fail(error); }
    finally { $('cancel-run').disabled = false; }
  });
  $('settings-open').addEventListener('click', () => { renderSettings(); $('settings-dialog').showModal(); });
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => $(button.dataset.close).close()));
  $('refresh-providers').addEventListener('click', () => task('공식 인증 상태 확인', async () => { await api('/api/providers/refresh', {}); renderSettings(); $('login-message').textContent = '공식 프로그램의 연결 상태를 다시 확인했습니다. 실제 생성 성공 여부와는 별개입니다.'; }));
  $('gemini-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const key = $('gemini-key').value.trim();
    if (!key) { $('gemini-key').focus(); return; }
    task('Gemini 모델 목록 확인', async () => {
      // Keep no key copy in UI state; clear the password immediately after starting the request.
      const request = api('/api/settings', { geminiKey: key });
      $('gemini-key').value = '';
      await request; renderSettings(); notice('Gemini API 연결을 확인했습니다. 실자료 전송 제한은 계속 적용됩니다.');
    });
  });
  $('disconnect-gemini').addEventListener('click', () => task('Gemini 연결 해제', async () => { await api('/api/settings', { disconnectGemini: true }); $('gemini-key').value = ''; renderSettings(); notice('현재 세션의 Gemini 키 연결을 해제했습니다.'); }));
  $('model-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const selections = {};
    for (const stage of Object.keys(stageNames)) selections[stage] = { provider: $(`provider-${stage}`).value, model: $(`model-${stage}`).value };
    task('단계별 AI 설정 저장', async () => { await api('/api/settings', { selections }); $('settings-dialog').close(); notice('단계별 AI 설정을 저장했습니다. 외부 전송은 각 실행 전에 별도로 확인합니다.'); });
  });
  $('consent-approved').addEventListener('change', () => { $('consent-run').disabled = !$('consent-approved').checked; });
  $('consent-dialog').addEventListener('close', () => { $('consent-approved').checked = false; $('consent-payload').value = ''; pendingPreview = null; pendingArguments = null; });
  $('consent-run').addEventListener('click', async () => {
    if (!$('consent-approved').checked || !pendingPreview || busy) return;
    const preview = pendingPreview; const args = pendingArguments;
    $('consent-dialog').close();
    await task(stageNames[args.stage], async () => { await api('/api/consent', { previewToken: preview.token, approved: true }); await runStage(args, preview.token); });
  });
  document.querySelectorAll('[data-instruction]').forEach((button) => button.addEventListener('click', () => { const textarea = $('rewrite-instructions'); textarea.value = `${textarea.value.trim()}${textarea.value.trim() ? '\n' : ''}${button.dataset.instruction}`; textarea.focus(); }));
  $('save-checks').addEventListener('click', () => task('담당자 점검 저장', async () => {
    const checks = {};
    for (const input of $('human-checks').querySelectorAll('input')) checks[input.name] = input.checked;
    if (answerDirty) await saveAnswer();
    await api('/api/checks', { checks }); notice('담당자 점검을 저장했습니다. 차단 의견은 점검 체크만으로 해소되지 않습니다.');
  }));
  $('evidence-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!$('evidence-form').reportValidity() || !isCurrent()) return;
    const evidence = Object.fromEntries(new FormData($('evidence-form')));
    task('수기 확인 근거 저장', async () => { if (answerDirty) await saveAnswer(); await api('/api/evidence', evidence); $('evidence-form').reset(); notice('공식 근거의 수기 확인을 추가했습니다. 현재 버전을 재검토하세요.'); });
  });
  $('confirm-button').addEventListener('click', () => task('담당자 확정', async () => {
    if (caseDirty || answerDirty || !isCurrent()) throw new Error('현재 입력과 답변을 저장하고 재검토한 뒤 확정하세요.');
    await api('/api/confirm', {}); notice('현재 답변을 담당자 확정했습니다. 기관의 결재·발송은 별도로 진행하세요.');
  }));
  $('copy-draft').addEventListener('click', () => copyAnswer(false));
  $('copy-final').addEventListener('click', () => copyAnswer(true));
  $('download-answer').addEventListener('click', () => {
    const data = exportText(); const format = $('export-format').value;
    const title = state.case.title || '민원답변';
    const content = format === 'md' ? `# ${title}\n\n${data.status}\n\n${data.body}\n` : `${data.status}\n${title}\n\n${data.body}\n`;
    const blob = new Blob(['\uFEFF', content], { type: format === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `민원답변-v${viewedVersion()?.number || 1}-${data.status.startsWith('담당자 확정') ? '확정' : '초안'}.${format}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1500);
  });
  $('print-answer').addEventListener('click', () => { const data = exportText(); $('print-status').textContent = data.status; $('print-title').textContent = state.case.title || '민원 답변'; $('print-body').textContent = data.body; window.print(); });
  $('font-smaller').addEventListener('click', () => { answerFont = Math.max(15, answerFont - 1); document.documentElement.style.setProperty('--answer-size', `${answerFont}px`); });
  $('font-larger').addEventListener('click', () => { answerFont = Math.min(25, answerFont + 1); document.documentElement.style.setProperty('--answer-size', `${answerFont}px`); });
  $('focus-toggle').addEventListener('click', () => { const enabled = document.body.classList.toggle('focus-mode'); $('focus-toggle').setAttribute('aria-pressed', String(enabled)); $('focus-toggle').textContent = enabled ? '집중 읽기 종료' : '집중 읽기'; });
  $('reset-open').addEventListener('click', () => $('reset-dialog').showModal());
  $('reset-session').addEventListener('click', () => { $('reset-dialog').close(); task('현재 세션 비우기', async () => { await api('/api/reset', {}); viewId = null; answerDirty = false; caseDirty = false; selectedFindings.clear(); renderedReviewId = null; hydrateCase(); render({ syncAnswer: true }); $('rewrite-instructions').value = ''; $('gemini-key').value = ''; notice('현재 세션을 비웠습니다.'); }); });
  window.addEventListener('beforeunload', (event) => { if (caseDirty || answerDirty || busy) { event.preventDefault(); event.returnValue = ''; } });
}

async function init() {
  bindEvents(); bindConnectionEvents(); updateConnectionUi();
  if (hosted) { openConnection(); return; }
  try {
    await loadWorkspace();
    if (location.hash === '#web-connection') openWebManager();
  } catch (error) { appReady = false; updateConnectionUi(); fail(error); }
}

init();

// Work file format shared by the browser (export) and the server (import validation). No DOM access here.
export const WORK_FORMAT = 'minwon-answer-work';
export const WORK_FORMAT_VERSION = 1;
export const WORK_FILE_MAX_BYTES = 8 * 1024 * 1024;
export const WORK_MAX_VERSIONS = 300;
const caseKeys = ['title', 'field', 'type', 'direction', 'body', 'facts', 'questions', 'actions', 'department', 'receivedAt', 'deadline', 'evidenceText'];
const checkKeys = ['facts', 'privacy', 'jurisdiction', 'deadline', 'sources'];

const strings = (list) => (Array.isArray(list) ? list.filter((item) => typeof item === 'string') : []);
const pick = (source, keys) => Object.fromEntries(keys.map((key) => [key, source?.[key]]));

// Whitelist copy of the last state the screen received; derived fields (gate, reviewValid) and connection settings are left out.
export function buildWorkFile(state, { appVersion, exportedAt }) {
  return {
    format: WORK_FORMAT,
    formatVersion: WORK_FORMAT_VERSION,
    appVersion: String(appVersion || ''),
    exportedAt,
    classification: state.classification,
    case: pick(state.case, caseKeys),
    currentVersionId: state.currentVersionId ?? null,
    versions: (state.versions || []).map((version) => ({
      ...pick(version, ['id', 'number', 'answer', 'summary', 'createdAt', 'source', 'parentId', 'caseHash', 'confirmed']),
      questions: strings(version.questions),
      unresolved: strings(version.unresolved),
      checks: Object.fromEntries(checkKeys.map((key) => [key, version.checks?.[key] === true])),
      evidence: (version.evidence || []).map((item) => pick(item, ['status', 'title', 'article', 'url', 'quote', 'effectiveDate', 'checkedAt', 'checkedBy'])),
      review: version.review ? {
        ...pick(version.review, ['id', 'versionId', 'answerHash', 'caseHash', 'summary', 'source', 'createdAt']),
        findings: (version.review.findings || []).map((item) => pick(item, ['id', 'severity', 'category', 'paragraph', 'reason', 'suggestion'])),
        mapping: (version.review.mapping || []).map((item) => pick(item, ['question', 'answered', 'paragraph'])),
      } : null,
    })),
  };
}

export function hasWork(state) {
  if (!state) return false;
  return Boolean(state.versions?.length) || caseKeys.some((key) => key !== 'direction' && String(state.case?.[key] || '').trim());
}

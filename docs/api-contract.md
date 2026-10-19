# MVP API 계약

Node 표준 라이브러리 기반 로컬 웹 앱. npm 패키지 설치 없음. 정적 프런트엔드 ES module. 모든 API 응답은 JSON, 성공 `{state,...}`, 실패 `{error:{code,message}}`. 읽기 GET `/api/session`은 `{state,csrfToken}`. 변경 POST는 `X-CSRF-Token` 헤더 필요. 세션 쿠키 HttpOnly/SameSite Strict. 서버는 127.0.0.1만.

state:
```json
{
  "revision":0,
  "case":{"title":"","field":"","type":"","direction":"검토 후 결정","body":"","facts":"","questions":"","actions":"","department":"","receivedAt":"","deadline":"","evidenceText":""},
  "classification":"fictional",
  "selections":{"draft":{"provider":"demo","model":"default"},"review":{"provider":"demo","model":"default"},"rewrite":{"provider":"demo","model":"default"}},
  "providers":[{"id":"demo","name":"데모 · 외부 전송 없음","status":"connected","message":"가상 사례의 작성 흐름만 체험합니다.","models":[{"id":"default","label":"가상 사례 규칙 기반"}],"canLogin":false}],
  "geminiConnected":false,"geminiModels":[],
  "versions":[],"currentVersionId":null,"running":null
}
```

version: `{id,number,answer,summary,questions:[],unresolved:[],createdAt,source,parentId,caseHash,review:null,checks:{facts:false,privacy:false,jurisdiction:false,deadline:false,sources:false},evidence:[],confirmed:false}`.
review: `{id,versionId,answerHash,caseHash,findings:[{id,severity:'blocker'|'advice',category,paragraph,reason,suggestion}],mapping:[{question,answered,paragraph}],summary,source,createdAt}`. `reviewValid`와 `gate:{canConfirm,reasons:[]}`는 각 version의 서버 계산 값. 질문은 case.questions의 줄 단위 또는 모델 추출 결과. `currentVersionId`로 현재 버전을 선택.

POST API:
- `/api/case` `{case,classification:'fictional'|'public'|'internal'}` : 입력 변경, 기존 검토·확정 무효. 완료한 편집 후 저장해야 생성 가능.
- `/api/settings` `{selections}` : 각 단계별 제공사·모델. `geminiKey` 제공시 세션 메모리에 보관하고 모델 목록 조회. `disconnectGemini:true`면 제거. 키 반환 안 함. 미확인 billing MVP로 Gemini는 fictional/public만 허용.
- `/api/providers/refresh` `{}` : 공식 CLI 상태 갱신. 자동 실 AI 호출 없음.
- `/api/providers/login` `{provider}` : 사용자 명시 클릭에서만 공식 로그인. `{state,message,url?}` 반환.
- `/api/preview` `{stage:'draft'|'review'|'rewrite',findingIds:[],instructions:''}` : `{state,preview:{token,stage,provider,text,redactions:[],warnings:[],expiresAt,needsConsent}}`. 마스킹한 서버 payload 미리보기. demo는 동의 없이 run 가능. external token은 5분·현재 revision·현재버전·제공사·지시/의견 선택에 바인딩.
- `/api/consent` `{previewToken,approved:true}` : 서버 receipt 승인. 키/본문 로그 저장 안 함.
- `/api/run` `{stage,previewToken?,findingIds:[],instructions:''}` : 데모 또는 외부 실행 후 새 버전/검토 반영. 외부는 동의 receipt 필수, 한 번 소비. 실패시 직전 상태 보존. 리뷰는 current 버전에 연결. 재작성은 새 버전으로 append. 서버의 정적 검토를 AI 결과에 병합.
- `/api/cancel` `{}` : 실행 취소.
- `/api/edit` `{answer,expectedRevision}` : 현재 답변을 새 수동 편집 버전으로 저장. 검토/확정 초기화.
- `/api/restore` `{versionId}` : 해당 본문을 새 버전으로 복원, 검토/확정 초기화.
- `/api/checks` `{checks:{facts,privacy,jurisdiction,deadline,sources}}` : 현재 버전의 담당자 체크. 차단 의견은 이 체크로 해소되지 않음.
- `/api/evidence` `{title,url,effectiveDate,checkedAt,checkedBy,quote}` : 담당자 수기 확인 근거 추가. 공식 URL·날짜·확인 주체/인용문 필수. 현재 버전 검토/확정 무효. AI가 만든 evidence는 자동 검증 취급 안 함.
- `/api/confirm` `{}` : 서버 gate canConfirm true만 확정. 데모도 가상 결과로 표시.
- `/api/reset` `{}` : 현재 세션 지우고 새 빈 문서(키도 메모리 삭제). 사용자 확인 버튼.

클라이언트 정적 설정 GET `/api/config` -> `{fields:[{id,label,hint,checks:[]}],types:[],directions:[],example:{case,classification},capabilities:{webPairing:true}}`. field id는 `general,curriculum,personnel,student,special,admission,care,facility,health,budget,disclosure,other`. 파일 읽기/첨부 파싱·기관 공식 발송은 MVP 외.

Vercel에는 정적 화면만 배포한다. 로컬 companion 기본 주소는 `http://127.0.0.1:8793`. 로컬 쿠키 세션과 웹 연결 세션은 별개이며 사례·API Key를 공유하지 않는다. 웹 연결은 정확히 승인한 HTTPS Origin과 메모리 전용 `X-Minwon-Session` 토큰에 바인딩되고 변경 요청의 CSRF 검사도 유지한다. 연결 토큰·인증 정보는 URL·디스크·Vercel 환경변수에 저장하지 않는다.

- POST `/api/pair/code` 로컬 전용 `{origin,approved:true}`: 로컬 쿠키·CSRF와 명시 동의 필요. 정확한 HTTPS Origin에 유효한 5분 일회용 코드 반환.
- POST `/api/pair` 승인된 원격 Origin에서 `{code}`: 코드를 소비하고 독립 세션의 `{sessionToken,csrfToken}` 반환. 쿠키 미발급.
- POST `/api/pair/disconnect` 원격 세션·CSRF 필요: 현재 연결 폐기.
- POST `/api/pair/revoke` 로컬 전용·CSRF 필요: 모든 웹 연결과 미사용 코드 폐기.

세션 유휴 30분 만료. 원격 최초 로드는 연결 요청을 자동 전송하지 않는다. 사용자가 코드를 입력한 이후에만 고정 loopback 주소로 CORS 요청한다. 브라우저의 로컬 기기 접근 권한이 추가로 필요할 수 있다. 상세 운용은 [배포 안내](DEPLOYMENT.md) 참조.

클라이언트는 textarea/input 값 textContent 중심으로 안전 렌더링. 답변 수동편집 저장 후 run. 상태 변경 응답마다 전체 state 교체. 외부 미리보기 동의 모달은 단계마다 기본 미체크. 드롭다운 provider demo/claude/codex/gemini. 취소 버튼은 run pending에서도 별도 요청 가능. 폼 보관은 브라우저 메모리만, localStorage/IndexedDB 금지.

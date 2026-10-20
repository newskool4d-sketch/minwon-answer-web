# minwon-answer 작업 현황 및 다음 과제

- 정리 기준일: 2026-10-20
- 저장소: [newskool4d-sketch/minwon-answer-web](https://github.com/newskool4d-sketch/minwon-answer-web) — 공개(2026-10-20 확인). 공개 유지 여부는 3장 5번 과제에서 확정
- 현재 릴리스: [v0.4.1](https://github.com/newskool4d-sketch/minwon-answer-web/releases/tag/v0.4.1)
- 웹 화면(Vercel `minwon-answer-web.vercel.app`): 프로젝트 삭제(2026-10-20). 웹 연결 기능은 v0.4.1에서 제거

## 1. 완료한 작업

### v0.3.0 (2026-10-19)

- 민원 분야 선택과 **초안 생성 → 검토 → 재작성 → 담당자 확정** 흐름. 실제 발송 기능 없음
- 단계별 AI 제공사 설정, 전송 미리보기·단계별 동의, 가상 사례 우선, 실자료 외부 전송 차단
- Vercel 웹과 로컬 앱을 잇는 PC 연결 코드 기능(v0.4.1에서 제거)
- Windows x64 실행 파일(앱 + Node.js 런타임, self-test 포함). 첫 실행 시 `%LOCALAPPDATA%\Programs\minwon-answer\<버전>`에 사용자 단위로 설치하고 시작 메뉴 바로가기 '민원답변 도우미' 생성(관리자 권한 불필요)

### v0.4.0 (2026-10-20)

| 구분 | 내용 |
|---|---|
| 확정 게이트 | 질문 대조 0건이면 확정 불가. 데모 검토는 '질문 N.' 단락에 답변이 있을 때만 대응으로 판정. 수동 편집 시 미해소 확인사항 승계, 담당자가 해결을 체크할 때만 해제(AI 초안·재작성은 모델이 돌려준 목록으로 대체). 마스킹 표기(`[연락처]` 등)와 대괄호 표기 `[확인필요]`·`[확인 요망]`·`[미확인]` 차단 |
| 근거·방향 | 법령명 + 제N조 쌍을 공식 원문 수기 확인 기록과 대조. 괄호 없는 인용은 법령명이 법·법률·시행령·시행규칙·규칙·조례로 끝날 때 대조. 하위 법령 기록으로 법률 조문 대체 불가. 답변 방향별 최소 요건을 키워드로 확인(이송·재지정은 이송 기관, 수용 곤란·일부 수용은 사유, 보완 요청은 보완 내용·기한) |
| Codex | npm 설치본 → 공식 독립 설치 위치(`%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`) 순으로 감지. 로그인 확인 전 버전 확인(0.160.0). 감지 위치(홈 기준)·버전·설치 명령 안내. 개인 스킬 목록 유입 차단(개발 PC에서 `debug prompt-input`으로 측정한 모델 입력 23,990자 → 6,719자) |
| Claude Code | 버전 정책 warn(최소 2.1.259, 검증 2.1.301, 상수로 strict 전환 가능). 격리 옵션 줄 단위 확인, 실제 2.1.301 help로 고정 테스트. 개인 지침·오류 보고·자동 업데이트 끄는 환경변수 3종 |
| 검증 | 자동 테스트 76개 통과, 구문 검사 통과. 빌드 시 EXE self-test 통과. GitHub 릴리스에서 내려받은 EXE의 SHA-256이 `.sha256`·자산 digest와 일치 |
| 배포 파일 | `minwon-answer-0.4.0-win-x64.exe` 34,234,368 bytes, SHA-256 `cabb7fb5f3ca3be914488abc39c530d012f07db47f7bf6244b5b471c013ca5b8`. Authenticode 서명 없음(SmartScreen 경고 가능) |

### v0.4.1 (2026-10-20)

| 구분 | 내용 |
|---|---|
| 서버 | 웹 연결 API 4개(`/api/pair*`)·원격 세션·CORS 제거. 로컬 출처(`http://127.0.0.1:<port>`·`http://localhost:<port>`)가 아닌 Origin의 요청은 CORS 헤더 없이 403 `CROSS_ORIGIN`. Host 검사·사이트 간 요청 차단·CSRF·단계별 동의는 유지 |
| 화면 | 웹 연결 모드·'웹 연결 관리'·PC 연결 코드 대화상자 제거. 같은 출처 호출만 사용 |
| 파일 | `vercel.json`·`scripts/build-web.mjs`·`tests/bridge.test.mjs` 삭제, `npm run build` 제거. `docs/DEPLOYMENT.md`는 '로컬 실행과 보안 경계'로 재작성, README·`docs/WINDOWS-EXE.md`·`docs/api-contract.md` 갱신 |
| 검증 | 자동 테스트 72개 통과(웹 연결 테스트 10개 삭제, 로컬 경계·세션 만료·키 분리 테스트 6개 추가), 구문 검사 통과. 로컬 화면에서 콘솔 오류 0건, 가상 예시 초안·검토 정상. 빌드 시 EXE self-test 통과. GitHub 릴리스에서 내려받은 EXE의 SHA-256이 `.sha256`·자산 digest와 일치 |
| 배포 파일 | `minwon-answer-0.4.1-win-x64.exe` 34,228,224 bytes, SHA-256 `d03113e57afd856ff1482a3bf98f102589261bb331199983918317fbb90ec1aa`. Authenticode 서명 없음(SmartScreen 경고 가능) |

## 2. 현재 동작 방식

| 항목 | 내용 |
|---|---|
| 실행 | 설치본이 로컬 서버(`http://127.0.0.1:8793`, `MINWON_PORT`로 변경 가능)를 실행하고 화면 제공. AI 호출은 로컬 서버가 처리. v0.5.0(개발 중)부터 콘솔 없이 WebView2 앱 창으로 열고, 런타임이 없으면 기본 브라우저로 대체 |
| Codex | 앱 전용 홈 `%LOCALAPPDATA%\minwon-answer\codex-home`. CLI 0.160.0 정확히 필요, npm 설치본 우선(npm 설치가 0.160.0이 아니면 독립 설치가 있어도 setup). 최초 로그인은 설치 폴더의 `codex-login.ps1` 실행. v0.5.0(개발 중)부터 ‘ChatGPT로 로그인’ 버튼이 이 스크립트를 PowerShell 창으로 열고 서버의 앱 전용 홈을 인자로 전달 |
| Claude Code | 네이티브 설치 경로 `~\.local\bin\claude.exe`에서만 감지(npm 등 다른 설치 방식은 미감지). 사용자 PC의 Claude Code 로그인(`~/.claude`)을 공유하며 앱 전용 분리 없음, 사용자가 지정한 `CLAUDE_CONFIG_DIR`은 전달하지 않음. claude.ai 로그인만 허용. 실행 옵션으로 개인 설정·지침·도구 비활성(기관 관리 정책은 그대로 적용) |
| Gemini | 사용자 API Key, 세션 메모리에만 보관 |
| 작업 세션 | 서버 메모리에만 보관. 서버 종료 시, 또는 마지막 요청 후 30분이 지나면 삭제 |
| 내보내기 | 답변 본문 txt·md 내려받기와 인쇄 가능. v0.5.0(개발 중)부터 작업 전체(입력·버전·검토·근거·점검)를 JSON으로 내보내고 불러오기 가능(불러오면 확정 해제), 앱 창을 닫을 때 내보내지 않은 작업 확인 |
| 실자료 | 자료 구분을 '실제 민원·내부 자료'로 고르면 외부 AI 전송 차단. 담당자 선택 기준이며 내용으로 판별하지 않음 |
| 접근 경계 | 로컬 화면 전용(v0.4.1부터). 화면과 API는 같은 출처에서만 동작하고, 다른 출처의 API 요청은 403. 다른 사이트에서는 링크로 로컬 첫 화면을 여는 것만 허용 |

알려진 제약: 서버는 홈 폴더 기준(`AppData\Local`)으로 Codex 홈을 계산하고 `codex-login.ps1`은 직접 실행할 때 `$env:LOCALAPPDATA`를 씀. AppData 폴더 리디렉션 환경에서는 두 경로가 달라질 수 있음(v0.5.0의 앱 버튼 실행은 서버 경로를 넘겨 일치시킴).

## 3. 다음 과제(우선순위)

1. **작업 유실 방지**: 로컬 세션 30분 만료 분리 또는 연장, 내부 검토표 내보내기(작업 전체 내보내기·불러오기는 v0.5.0에서 구현, 릴리스 전)
2. **앱 안 로그인·로그아웃**: Codex 로그아웃(`codex logout`) 실행, Claude는 보이는 콘솔로 `claude auth login` 실행 후 상태 확인(Codex 로그인 창 열기는 v0.5.0에서 구현, 릴리스 전)
3. **검사 정밀도 보정**(실제 답변 표본 필요)
   - 정상 답변 오차단: 경찰서·보건소 이송, 같은 기관 과·팀 재지정, '같은 법·동법' 인용, '헌법' 인용
   - 놓치는 경우: '○○규정·훈령·고시·지침 제N조' 같은 괄호 없는 인용, 관계없는 수기 확인 기록이 1건이라도 있으면 조문 번호만 있는 인용이 통과
   - AI 재작성이 미해소 목록을 비워 돌려주면 담당자 확인 없이 해제됨
4. **번들 Node.js 보안 업데이트**: v24.14.1 이후 24.x 보안 릴리스(2026-10-19 조회: v24.17.0·v24.18.1, 10-21 보안 릴리스 예고) 반영 후 재빌드
5. **배포 신뢰**: 코드 서명 인증서, 저장소 공개 여부 확정
6. **로컬 경계 보강**: 같은 PC의 다른 포트(같은 사이트)에서 Origin 없이 보내는 `/api/` GET도 거부할지 검토(현재는 `Cross-Origin-Resource-Policy: same-origin`으로 응답 읽기만 차단)

## 4. 로그인 방식 검토 결과(2026-10-19 공식 문서 조회 기준, 변동 가능)

- **OpenAI**: 현재 Codex CLI 로그인도 브라우저 OAuth(localhost 콜백) 방식. 단기안은 앱이 로컬 전용으로 `codex login`을 실행하는 방식. SIWC는 공식 안내상 Plus·Pro 명시, 유료·호스팅 앱은 대기 명단 대상 → 기관 계정(Edu·Business) 적격 여부를 착수 전 확인
- **Claude**: 공식 정책상 제3자 앱의 claude.ai 로그인 제공과 자격증명 수집·저장·중개 불허(사전 승인 예외). 사용자 본인의 수정 없는 Claude Code 로그인 사용은 허용 형태. 동료 배포가 '제품에서 Claude Code 실행'(상용 약관 필요)에 해당하는지, API Key 인증 거부가 '내장 인증 제한'에 해당하는지는 유권해석 필요
- **Gemini**: 사용자 API Key 방식 유지

## 5. 기관·제공사 확인이 필요한 결정(코드 과제 아님)

- 실자료 처리 경로: 기관 승인 AI, 승인된 비식별 절차, 로컬 모델 중 선택 — 유권해석 필요
- Claude 동료 배포 약관과 소비자 계정(Pro·Max) 데이터 정책 — 유권해석 필요
- OpenAI SIWC 적격성

## 6. 유지할 안전·운영 기준

- 사용자가 요청한 단계에서만 외부 AI로 전송하고, 전송 전 내용을 보여 주고 동의를 받음
- 실제 민원·비공개 자료는 정해진 제한을 유지하고 테스트에는 가상 사례 사용
- 제공사 토큰·API Key를 로그·Git·오류 메시지·공유 문서에 노출하지 않음
- 한 사용자의 구독·인증 권한을 다른 사용자의 요청에 공유하지 않음
- AI 초안은 담당자 검토를 거치며, 앱에서 민원 답변을 자동 발송하지 않음

## 공식 참고 자료

- [OpenAI: Sign in with ChatGPT 통합 안내](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)
- [OpenAI: Sign in with ChatGPT 이용 약관](https://openai.com/policies/sign-in-with-chatgpt-terms/)
- [OpenAI: Codex 로그인(ChatGPT·디바이스 코드)](https://learn.chatgpt.com/docs/auth)
- [OpenAI: SIWC 토큰을 Codex app-server에 전달하는 방법](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)
- [Anthropic: Claude Code 로그인 안내](https://code.claude.com/docs/en/getting-started#authenticate)
- [Anthropic: Claude Code 법률·준수(인증·자격증명 사용, 제품에서 제공 조건)](https://code.claude.com/docs/en/legal-and-compliance)
- [Anthropic: Agent SDK 개요(제3자 claude.ai 로그인 안내)](https://code.claude.com/docs/en/agent-sdk/overview)
- [Anthropic: 데이터 사용(학습·보관)](https://code.claude.com/docs/en/data-usage)
- [Anthropic: Claude 구독과 API 과금 구분](https://support.claude.com/en/articles/9876003-i-have-a-paid-claude-subscription-pro-max-team-or-enterprise-plans-why-is-claude-api-usage-billed-separately-from-my-paid-claude-plan)

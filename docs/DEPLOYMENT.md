# 로컬 실행과 보안 경계

## 구성

로컬 Node 프로그램(`server/index.mjs`)이 화면 파일(`public/`) 제공과 API·세션·AI 요청 처리를 모두 맡는다. 별도 웹 배포·클라우드 저장·터널·공용 CLI 인증 서버는 구성하지 않는다. 추가 npm 의존성은 없다.

- 바인딩: `127.0.0.1`만. 기본 포트 8793, `MINWON_PORT`로 1024~65535 범위에서 변경
- 접속: 같은 PC의 브라우저에서 `http://127.0.0.1:8793` 또는 `http://localhost:8793`
- Windows 실행 파일도 같은 서버를 실행하고 로컬 화면을 앱 창(WebView2)으로 연다. 다른 PC·외부망 접속은 지원하지 않는다.

## Windows 앱 창

- 앱 창은 로컬 화면(`http://127.0.0.1:<port>`)만 표시한다. 다른 주소로의 이동은 막고, `http(s)` 외부 링크(법령 원문·GitHub)는 기본 브라우저로 넘긴다. 새 창은 열지 않는다
- WebView2는 InPrivate 모드로 실행해 쿠키·캐시·저장소를 디스크에 남기지 않는다. 개발자 도구·자동 완성·비밀번호 저장·호스트 개체·웹 메시지를 끄고 권한 요청은 모두 거부한다
- 로컬 서버는 콘솔 창 없이 실행되고, 앱 창을 닫거나 런처가 비정상 종료되면 Windows 작업 개체로 함께 종료된다(서버가 실행한 AI CLI 포함)
- 창을 닫기 전에 화면에 파일로 내보내지 않은 작업이나 실행 중인 AI 작업이 있는지 묻고, 있으면 확인창을 띄운다
- WebView2 런타임이 없거나 초기화에 실패하면 기본 브라우저로 화면을 열고 작은 실행 창으로 서버를 종료한다

## 요청 검사

| 순서 | 검사 | 허용 조건 | 거부 |
|---|---|---|---|
| 1 | Host | `127.0.0.1:<port>`·`localhost:<port>`만 허용(DNS 재바인딩 방지) | 403 `INVALID_HOST` |
| 2 | Origin | 헤더가 있으면 `http://127.0.0.1:<port>`·`http://localhost:<port>`와 정확히 일치해야 함. CORS 헤더를 보내지 않으며 preflight도 거부 | 403 `CROSS_ORIGIN` |
| 3 | Sec-Fetch-Site | `cross-site`는 `/api/` 외 경로의 최상위 문서 GET 탐색(링크로 로컬 화면 열기)만 허용 | 403 `CROSS_SITE` |
| 4 | CSRF | `/api/` POST에 세션별 `X-CSRF-Token` 필요(시간 일정 비교). `/api/` 외 경로의 POST는 405 | 403 `CSRF_REQUIRED` |
| 5 | 형식 | POST는 `application/json`, 본문 512KB 이하(`/api/import`만 8MB 이하) | 415 `JSON_REQUIRED`·413 `BODY_TOO_LARGE` |

브라우저가 보내는 Origin·Sec-Fetch-Site로 다른 사이트의 API 요청을 거부하고, 다른 사이트에서는 링크로 로컬 화면을 여는 최상위 탐색만 가능하다. 같은 PC의 다른 포트(같은 사이트)에서 Origin 없이 보내는 GET은 서버에 닿을 수 있으나 `Cross-Origin-Resource-Policy: same-origin`으로 응답 읽기가 차단된다. 화면은 같은 출처의 `fetch`(`credentials: 'same-origin'`)로만 API를 호출한다.

## 세션

- 쿠키 `minwon_session`: `HttpOnly; SameSite=Strict; Path=/`
- 세션 상태(민원·답변 버전·검토·Gemini Key)는 서버 메모리에만 보관. 디스크·URL·localStorage·IndexedDB에 저장하지 않음
- 작업 파일: 사용자가 ‘작업 내보내기’를 누를 때만 화면이 마지막으로 받은 상태로 JSON 파일을 만든다(Gemini Key·AI 연결 설정·전송 동의·CSRF 토큰 제외). ‘작업 불러오기’는 허용 항목만 다시 검증해 새로 만들고(하나라도 틀리면 전체 거부), 확정을 해제하고, 수기 확인 근거를 추가 때와 같은 기준으로 재검증하며, 자료 구분을 그대로 유지한다
- 외부 AI CLI 실행 때 만드는 임시 폴더(작업 폴더·출력 스키마·CLI 상태)는 실행이 끝나면 삭제
- 30분 유휴 만료(요청 시에도 확인). 동시 세션 최대 32개, 초과 시 실행 중이 아닌 가장 오래된 세션부터 정리
- 세션 간 민원·전송 동의·Gemini Key를 공유하지 않음. 서버 종료 시 모든 세션 삭제

## 외부 AI 전송

- 단계(초안·검토·재작성)마다 서버가 마스킹한 전송 미리보기 → 사용자 명시 동의 → 실행
- 동의는 5분 유효·1회 사용이며 revision·제공사·payload 지문에 묶임. 입력·모델·답변·선택 의견이 바뀌면 다시 동의
- `internal`(비공개·민감 실자료)은 외부 전송 차단. 데모는 외부 전송 없음
- Gemini는 사용자 API Key 필요. 키는 세션 메모리에만 두고 응답에 반환하지 않음

## 응답 헤더

`Content-Security-Policy`(`default-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'`, `form-action 'self'` 등), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-origin`, `Cache-Control: no-store`.

## 인증과 운영 범위

Codex는 앱 전용 `%LOCALAPPDATA%/minwon-answer/codex-home`의 공식 로그인만 사용한다. 로그인은 사용자가 ‘ChatGPT로 로그인’을 누를 때만 동봉한 `codex-login.ps1`을 보이는 PowerShell 창으로 열어 공식 `codex login`을 실행하며(서버가 쓰는 앱 전용 폴더를 인자로 전달), 앱은 로그인 토큰을 받지 않는다. 인증정보를 다른 서버·GitHub로 복사·공유하지 않는다. 다른 사용자·다른 PC는 각자 로컬 프로그램과 본인 로그인이 필요하다. 로컬 통합이 상용 호스팅용 SIWC 자격을 증명하지는 않는다.

- [Codex 로컬 인증 경계](https://learn.chatgpt.com/docs/app-server#auth-endpoints)
- [별도 웹 SIWC](https://developers.openai.com/siwc/website)

검증은 가상 사례로 수행한다. 기관 실자료 운영 승인·개인정보 적합성·법적 결재·공식 발송은 별도 범위다.

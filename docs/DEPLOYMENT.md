# 배포와 로컬 연결

## 구성

Vercel에는 화면 파일만 배포한다. 로컬 Node 프로그램은 `127.0.0.1:8793`에서 실행하고 AI 요청·인증·민원 세션을 처리한다. 웹 화면이 읽는 민원·답변은 브라우저 메모리와 로컬 서버 메모리에 존재한다. 별도 클라우드 저장·터널·공용 CLI 인증 서버는 구성하지 않는다.

`node scripts/build-web.mjs`는 `public/index.html`, `public/app.js`, `public/styles.css`만 `dist`로 복사한다. 서버 코드·로그인 스크립트·인증 저장소는 정적 배포물에 들어가지 않는다. 추가 npm 의존성은 없다.

## 연결 순서

1. 로컬 프로그램 실행 후 로컬 화면을 연다.
2. 웹 화면의 정확한 HTTPS origin을 로컬 연결 관리에 입력한다.
3. 연결 권한을 명시적으로 확인하고 코드를 발급한다.
4. 웹 화면에서 5분 이내에 코드를 입력한다. 브라우저가 이 기기 접근 권한을 요청하면 사용자가 해당 웹 주소를 확인하고 허용한다.
5. AI 요청은 기존의 전송 미리보기·단계별 동의를 다시 거친다. PC 연결 승인은 AI 전송 동의가 아니다.

연결 코드와 bearer는 브라우저 메모리만 사용하며 query·fragment·localStorage·IndexedDB·로그에 저장하지 않는다. 코드 기본 표시는 password 필드이며 복사는 사용자 클릭으로만 실행한다. 연결 종료·새로고침 후에는 다시 연결한다.

## API 경계

| 경로 | 허용 주체 | 조건·결과 |
|---|---|---|
| `POST /api/pair/code` | 로컬 쿠키 세션 | CSRF + `{origin, approved:true}`. 정확한 HTTPS 기본 포트 origin만 허용. 코드 5분 만료 |
| `POST /api/pair` | 승인된 웹 origin | `{code}`를 한 번 교환하여 별도의 웹 세션·CSRF 수신. 로컬 세션·API Key를 승계하지 않음 |
| 기존 `/api/*` | 연결된 웹 세션 | 정확한 Origin + `X-Minwon-Session`, POST는 `X-CSRF-Token` 추가. 원격 쿠키 fallback 없음 |
| `POST /api/pair/disconnect` | 현재 웹 세션 | 현재 세션·실행·API Key·bearer 폐기 |
| `POST /api/pair/revoke` | 로컬 쿠키 세션 | CSRF 확인 후 모든 웹 세션·미사용 코드 폐기 |

웹 origin은 코드 발급 시 사용자가 로컬 화면에서 승인한 값에 한정한다. CORS Origin 반사나 `*.vercel.app` 와일드카드는 사용하지 않는다. preflight는 승인 origin의 GET/POST와 필요한 헤더만 허용하며 credentials를 허용하지 않는다. DNS 재바인딩 방지를 위한 루프백 Host 검사·127.0.0.1 바인딩을 유지한다.

세션은 30분 유휴 만료이며 요청 시에도 만료를 확인한다. 외부 AI 전송 미리보기는 revision/provider/payload와 묶인 1회 승인이 필요하다. 실제 민원·비공개 자료의 외부 전송 차단, 재작성 후 재검토, 담당자 최종 확인을 유지한다.

## 브라우저 조건

HTTPS 페이지의 루프백 연결에는 표준 CORS와 브라우저의 로컬 기기 접근 정책이 적용된다. Chrome은 LNA 권한을 도입했고 WebSocket에도 적용하므로 WS를 우회 수단으로 사용하지 않는다. 권한 거절·브리지 종료·만료 시 연결 안내를 표시한다. HTTP 단위 테스트가 실제 브라우저의 권한 허용을 대신하지 않는다.

- [Chrome LNA](https://developer.chrome.com/blog/local-network-access)
- [Chrome 145 권한 분리](https://developer.chrome.com/release-notes/145)
- [Chrome 147 WebSocket 적용](https://developer.chrome.com/release-notes/147)
- [Fetch CORS](https://fetch.spec.whatwg.org/#http-cors-protocol)

## 인증과 운영 범위

Codex는 앱 전용 `%LOCALAPPDATA%/minwon-answer/codex-home`의 공식 로그인만 사용한다. 인증정보를 Vercel·GitHub로 복사·공유하지 않는다. 다른 사용자·다른 PC는 각자 로컬 프로그램과 본인 로그인이 필요하다. 로컬 통합이 상용 호스팅용 SIWC 자격을 증명하지는 않는다.

- [Codex 로컬 인증 경계](https://learn.chatgpt.com/docs/app-server#auth-endpoints)
- [별도 웹 SIWC](https://developers.openai.com/siwc/website)

검증은 가상 사례로 수행한다. 기관 실자료 운영 승인·개인정보 적합성·법적 결재·공식 발송은 별도 범위다.

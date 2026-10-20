# 민원답변 도우미 · minwon-answer

교육행정 민원의 초안 생성 → 검토 → 재작성 → 담당자 확인을 지원하는 웹 앱입니다. 12개 분야와 8개 처리 유형, 질문별 대응 점검, 의견 선택, 버전 비교를 제공합니다.

## 실행 구조

- 사용자 PC에서 실행한 Node 프로그램이 화면 제공과 민원·답변·세션·AI 요청 처리를 모두 맡습니다.
- 로컬 프로그램은 `127.0.0.1`에만 바인딩합니다. Windows 실행 파일은 이 화면(`http://127.0.0.1:8793`)을 프로그램 자체 창으로 열고, 소스에서 실행할 때는 같은 PC의 브라우저로 엽니다.
- Codex·Claude는 PC의 공식 CLI 로그인, Gemini는 세션용 사용자 API Key를 사용합니다.
- 세션 작업 데이터는 로컬 서버 메모리와 화면에만 있습니다(외부 AI CLI 실행용 임시 폴더는 실행 후 삭제). 이어서 작업하려면 사용자가 ‘작업 내보내기’로 파일에 저장합니다. 외부 AI 전송은 단계별 미리보기·동의 후 선택한 제공사로만 이뤄집니다.
- 다른 사이트에서 보낸 API 요청은 거부합니다.

## 처음 사용하기

### Windows 실행 파일

GitHub Releases에서 `minwon-answer-<버전>-win-x64.exe`를 내려받아 실행합니다. 첫 실행 때 현재 사용자 앱 폴더에 앱을 풀고 시작 메뉴 바로가기를 만든 다음 **민원답변 도우미** 창을 엽니다. Node.js를 별도로 설치하지 않아도 됩니다.

- 실행 파일은 PC 안에서만 동작하며 앱 창에서 초안·검토·재작성을 모두 사용할 수 있습니다. 앱 창은 Windows의 Microsoft Edge WebView2 런타임을 사용하고, 런타임이 없으면 기본 브라우저로 화면을 엽니다.
- Codex·Claude CLI와 사용자 로그인이 설치 PC에 있어야 합니다. EXE에는 AI 로그인 정보나 API Key를 넣지 않습니다.
- 앱 창을 닫으면 로컬 서버가 끝나고 작업이 삭제됩니다. 파일로 내보내지 않은 작업이 있으면 닫기 전에 확인합니다.
- 설치·라이선스·검증 정보는 [Windows 실행 파일 안내](docs/WINDOWS-EXE.md)를 참고하세요.

### 소스에서 실행

Node.js 22 이상이 필요합니다. 추가 npm 패키지 설치는 없습니다.

```powershell
git clone https://github.com/newskool4d-sketch/minwon-answer-web.git
Set-Location -LiteralPath '.\minwon-answer-web'
node server/index.mjs
```

1. 로컬 화면 `http://127.0.0.1:8793`을 엽니다.
2. Codex 최초 연결은 AI 연결 설정에서 ‘연결 상태 다시 확인’ 후 Codex의 ‘ChatGPT로 로그인’을 눌러 열리는 로그인 창(PowerShell, `codex-login.ps1`)에서 공식 ChatGPT 로그인을 완료합니다. 창이 열리지 않으면 `powershell -NoProfile -ExecutionPolicy Bypass -File .\codex-login.ps1`을 직접 실행합니다. 앱 전용 Codex 홈을 사용하며 기존 인증정보를 복사하지 않습니다. Claude는 공식 Claude Code의 본인 구독 로그인을 사용합니다. Claude Code는 2.1.259 이상이 필요하며 검증 버전은 2.1.301입니다(목록 밖 버전은 경고와 함께 연결).
3. 가상 예시로 시작하여 AI 연결 설정과 단계별 전송 미리보기를 확인합니다.

로컬 프로그램은 `127.0.0.1`에만 바인딩하므로 같은 PC에서만 접속할 수 있습니다. 다른 PC에서 이용하려면 그 PC에서도 프로그램과 본인 로그인이 필요합니다.

## 데이터와 연결 경계

- 접속 주소(Host)와 요청 출처(Origin)가 로컬 주소(`127.0.0.1`·`localhost`의 실행 포트)가 아니면 거부합니다. CORS 요청은 허용하지 않습니다.
- 세션: HttpOnly·SameSite=Strict 쿠키와 CSRF 토큰을 함께 확인합니다. 기본 30분 유휴 만료.
- 세션 간에 민원·전송 동의·Gemini Key를 공유하지 않습니다.
- 서버 종료·세션 만료 시 작업이 사라집니다. ‘작업 내보내기’로 입력·답변 버전·검토·근거를 파일에 저장하고 ‘작업 불러오기’로 이어서 작업할 수 있습니다. 불러온 작업은 확정이 해제되며, 파일에는 Gemini Key·AI 연결 설정·전송 동의가 들어가지 않습니다.
- 실제 민원·비공개·민감 자료의 외부 AI 전송은 MVP에서 계속 차단합니다. 자동 마스킹·동의만으로 실자료 운영을 허용하지 않습니다.
- 재작성 후에는 현재 버전을 다시 검토해야 하며 기관 결재·실제 민원 발송을 자동 처리하지 않습니다.

## Codex 로그인

공식 네이티브 Codex CLI 0.160.0의 검증된 기능을 사용합니다. 다른 버전은 호환·격리 검증 전 `setup` 상태로 제한합니다. 별도 패키지를 자동 설치하거나 모델을 임의로 대체하지 않습니다.

- 사전 준비: 사용자가 직접 `npm install -g @openai/codex@0.160.0`을 실행합니다. 앱은 npm 설치의 네이티브 실행 파일을 먼저 찾고, 없으면 공식 독립 설치 프로그램의 기본 위치 `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe`를 사용합니다.
- 어느 위치든 `codex --version`이 정확히 `codex-cli 0.160.0`이어야 합니다. 다르면 로그인 확인 전에 감지 위치(홈 기준 표기)·감지 버전·필요 버전·설치 명령을 안내하고 `setup`으로 제한합니다. npm 설치가 있으면 그 설치가 우선 적용되므로, npm 설치가 0.160.0이 아니면 독립 설치가 있어도 `setup`이 됩니다.
- Codex 데스크톱 앱이 관리하는 `%LOCALAPPDATA%\OpenAI\Codex\bin\...` 실행 파일은 사용하지 않습니다.

앱 전용 홈은 `%LOCALAPPDATA%\minwon-answer\codex-home`입니다. 해당 홈의 개인 지침 파일을 발견하면 생성을 차단합니다. 셸·패치·검색·REPL·이미지 기능과 개인 설정을 제한하고 실행별 임시 자료를 정리합니다. 이는 OS 전체 읽기 접근 차단을 뜻하지 않습니다.

기존 로컬/오픈소스 CLI 인증과 상용 호스팅용 SIWC는 구분합니다. 이 앱은 개인 PC에서 실행하며 로그인·모델 호출을 대행하는 중계 서버가 없습니다. [공식 인증 경계](https://learn.chatgpt.com/docs/app-server#auth-endpoints).

## 개발·검증

```powershell
npm test
npm run check
```

인증 파일·로컬 작업 기록·실호출 보고서는 Git에 포함하지 않습니다.

`scripts/smoke-codex.mjs --live-fictional`과 `scripts/smoke-claude.mjs --live-fictional`은 실제 외부 전송과 구독 사용량을 발생시키므로 사용자의 명시적인 가상 실호출 요청이 있을 때만 실행합니다. 두 스크립트 모두 `--live-fictional` 없이 실행하면 호출 없이 종료 코드 2로 끝납니다.

로컬 실행 구조와 보안 경계는 [로컬 실행과 보안 경계](docs/DEPLOYMENT.md)를 참고하세요.

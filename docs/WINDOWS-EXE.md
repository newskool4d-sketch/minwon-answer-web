# Windows 실행 파일

## 사용자 실행

GitHub Releases에서 `minwon-answer-<버전>-win-x64.exe`를 내려받아 실행합니다. 설치는 현재 사용자 계정의 `%LOCALAPPDATA%\Programs\minwon-answer\<버전>`에만 이뤄지고 관리자 권한은 필요하지 않습니다. 첫 실행은 설치를 마친 뒤 설치된 프로그램을 다시 실행해 **민원답변 도우미** 창을 엽니다. 이후 시작 메뉴의 **민원답변 도우미** 바로가기를 이용할 수 있습니다.

EXE는 자체 압축 실행 파일입니다. 앱 코드와 Node.js 런타임, 앱 창용 WebView2 구성 파일을 포함하며 별도 Node.js 설치는 필요하지 않습니다. 로컬 서버는 콘솔 창 없이 실행되고, 앱 창을 닫으면 서버가 끝나고 세션 메모리가 지워집니다. 이미 실행 중일 때 다시 실행하면 열려 있는 창을 앞으로 가져옵니다.

필요 환경: Windows 10·11 x64, .NET Framework 4.6.2 이상(Windows 10·11 기본 포함), Microsoft Edge WebView2 런타임(Windows 11 기본 포함, Windows 10도 대부분 설치됨). WebView2 런타임이 없거나 앱 창을 준비하지 못하면 기본 브라우저로 화면을 열고, 작은 실행 창에서 프로그램을 종료합니다.

## 작업 보관

- 작업 세션은 서버 메모리에만 있으므로 앱을 닫거나 30분 동안 사용하지 않으면 사라집니다.
- 화면 위쪽의 **작업 내보내기**는 입력·자료 구분·답변 버전·검토 결과·근거 기록·담당자 점검을 JSON 파일로 내려받습니다. Gemini Key·AI 연결 설정·전송 동의는 넣지 않습니다. 파일에 민원 내용이 들어 있으므로 안전한 곳에 보관합니다.
- **작업 불러오기**는 내보낸 파일을 검증한 뒤 현재 작업을 바꿉니다. 확정은 해제되므로 검토 결과를 확인하고 다시 확정합니다. 수기 확인 근거는 추가할 때와 같은 기준으로 다시 확인하고, 형식이 하나라도 틀리면 파일 전체를 거부합니다.
- 앱 창을 닫을 때 파일로 내보내지 않은 작업, 추가하지 않은 근거 입력, 저장하지 않은 담당자 점검, 내려받는 중이거나 실패한 작업 파일, 실행 중인 AI 작업이 있으면 확인창을 띄웁니다. 같은 경우 Windows 다시 시작·로그아웃도 이유를 표시하며 잠시 멈춥니다.
- 로컬 서버가 예기치 않게 종료되어도 앱 창은 열린 채로 남아, 화면에 남은 작업을 ‘작업 내보내기’로 저장할 수 있습니다.

## 로그인·자료 경계

- Codex와 Claude CLI는 사용자가 PC에 설치하고 본인 계정으로 로그인해야 합니다. EXE는 로그인 파일·인증 토큰을 포함하거나 다른 PC로 복사하지 않습니다.
- Codex 앱 전용 로그인 데이터는 `%LOCALAPPDATA%\minwon-answer\codex-home`에 유지되며 프로그램 설치 폴더와 분리됩니다. 최초 로그인은 앱의 **AI 연결 설정**에서 **연결 상태 다시 확인**을 누른 뒤 Codex의 **ChatGPT로 로그인**을 누릅니다. 설치 폴더의 `codex-login.ps1`이 PowerShell 창으로 열리고, 이 창이 앱 전용 Codex 폴더에서 공식 `codex login`을 실행합니다. 브라우저에서 로그인을 마친 뒤 창의 안내에 따라 Enter로 닫고 **연결 상태 다시 확인**을 누릅니다. 로그인 창은 앱이 실행한 창이므로 로그인을 마칠 때까지 앱을 닫지 않습니다.
- 로그인 창이 열리지 않으면 PowerShell에서 `powershell -NoProfile -ExecutionPolicy Bypass -File "<설치 폴더>\codex-login.ps1"`을 직접 실행합니다(기본 실행 정책에서는 스크립트를 바로 실행할 수 없음). 설치 폴더는 `%LOCALAPPDATA%\Programs\minwon-answer\<버전>`이고, 같은 버전을 다시 빌드한 실행 파일이면 `<버전>-<빌드 식별자 8자>`입니다. 앱의 로그인 안내 문구에 실제 경로가 표시됩니다.
- 민원 작업 세션은 서버 메모리에만 남고 서버가 종료되면 지워집니다. 실제 민원·비공개 실자료의 외부 AI 전송 차단과 단계별 동의는 기존 정책을 유지합니다.
- 앱 창은 같은 PC의 로컬 화면(기본 `http://127.0.0.1:8793`, `MINWON_PORT`로 변경 가능)만 표시합니다. 법령 원문 같은 외부 링크는 기본 브라우저에서 열립니다. 로컬 서버는 다른 사이트에서 보낸 API 요청을 거부합니다.
- 앱 창(WebView2)은 InPrivate 모드로 실행해 쿠키·캐시를 디스크에 남기지 않고, 자동 완성과 비밀번호 저장을 끕니다.
- Google Gemini는 별도의 사용자 API Key를 계속 요구합니다. 키는 실행 파일에 포함되지 않습니다.

## 설치·제거

- 프로그램 버전별 파일: `%LOCALAPPDATA%\Programs\minwon-answer\<버전>`
- 앱 창 구성 요소 데이터: `%LOCALAPPDATA%\minwon-answer\webview2`
- 시작 메뉴 바로가기: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\민원답변 도우미.lnk`
- 제거하려면 앱 창을 먼저 닫고 시작 메뉴 바로가기와 프로그램 버전 폴더, 앱 창 구성 요소 데이터 폴더를 직접 삭제합니다. Codex 로그인 폴더는 별도이며 이 제거 과정에서 지워지지 않습니다.
- 새 버전은 별도 버전 폴더에 설치됩니다. 같은 버전을 다시 빌드한 실행 파일은 기존 설치본을 실행하지 않고 `<버전>-<빌드 식별자 8자>` 폴더에 따로 설치됩니다(빌드 식별자는 앱 자료 묶음의 SHA-256 앞 12자, 설치 폴더의 `app-version.txt` 둘째 줄). 기존 버전을 정리할 때는 해당 버전 폴더만 확인해 삭제합니다.

## 빌드·검증

```powershell
npm test
npm run check
npm run build:win
```

빌드는 Windows 기본 .NET Framework C# 컴파일러로 창 프로그램(x64) 런처를 만듭니다. npm 패키지를 새로 설치하지 않습니다. 빌드 스크립트는 로컬 Node.js의 버전과 SHA-256을 공식 Node.js v24.14.1 Windows x64 바이너리의 고정값과 대조한 뒤 번들에 포함합니다. `licenses/nodejs-v24.14.1-LICENSE.txt`를 실행 파일에 함께 넣습니다.

앱 창은 Microsoft의 WebView2 SDK 1.0.4258.31 중 3개 파일만 사용합니다. `vendor/webview2/1.0.4258.31/`의 `Microsoft.Web.WebView2.Core.dll`·`Microsoft.Web.WebView2.WinForms.dll`(net462)과 `WebView2Loader.dll`(win-x64)입니다. 이 파일들은 nuget.org의 `Microsoft.Web.WebView2` 1.0.4258.31 패키지에서 꺼냈습니다. 패키지 SHA-512가 nuget.org 카탈로그 값과 일치했고, 3개 파일 모두 Microsoft Corporation Authenticode 서명이 유효했습니다(2026-10-20 확인). 빌드 스크립트는 3개 파일의 SHA-256 고정값을 대조한 뒤 포함하고, `licenses/webview2-sdk-1.0.4258.31-LICENSE.txt`를 함께 넣습니다.

`build:win`은 생성된 EXE에서 `--self-test`를 실행해 다음 항목을 확인합니다.

- 격리 폴더에 풀기, Node 버전
- 별도 프로세스에서 WebView2 구성 파일 불러오기와 런타임 버전
- 로컬 `/api/health`(서버 버전이 실행 파일 버전과 같은지 포함), 첫 화면, 설정 API

결과물은 `release-output/`에 저장되고 `.sha256` 파일도 생성됩니다. 단위 테스트는 초안→검토→재작성 흐름, 작업 파일 불러오기 검증, 외부 연결 차단을 별도로 확인합니다. 앱 창 동작(닫기 확인, 외부 링크, 내려받기·인쇄)은 실제 실행으로 확인합니다.

현재 릴리스 실행 파일은 코드 서명 인증서가 없어 Authenticode 서명되지 않습니다. GitHub Release의 SHA-256 파일과 대조할 수 있습니다. 공개 후 Windows SmartScreen 경고가 표시될 수 있습니다.

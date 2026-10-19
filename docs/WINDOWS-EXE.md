# Windows 실행 파일

## 사용자 실행

GitHub Releases에서 `minwon-answer-<버전>-win-x64.exe`를 내려받아 실행합니다. 설치는 현재 사용자 계정의 `%LOCALAPPDATA%\Programs\minwon-answer\<버전>`에만 이뤄지고 관리자 권한은 필요하지 않습니다. 첫 실행은 같은 폴더의 로컬 서버를 시작하고 `http://127.0.0.1:8793`을 기본 브라우저에서 엽니다. 이후 시작 메뉴의 **민원답변 도우미** 바로가기를 이용할 수 있습니다.

EXE는 자체 압축 실행 파일입니다. 앱 코드와 Node.js 런타임을 포함하며 별도 Node.js 설치는 필요하지 않습니다. 콘솔 창은 서버가 실행되는 동안 열어 둡니다. `Ctrl+C`를 누르면 서버가 끝나고 세션 메모리가 지워집니다.

## 로그인·자료 경계

- Codex와 Claude CLI는 사용자가 PC에 설치하고 본인 계정으로 로그인해야 합니다. EXE는 로그인 파일·인증 토큰을 포함하거나 다른 PC로 복사하지 않습니다.
- Codex 앱 전용 로그인 데이터는 `%LOCALAPPDATA%\minwon-answer\codex-home`에 유지되며 프로그램 설치 폴더와 분리됩니다.
- 민원 작업 세션은 서버 메모리에만 남고 서버가 종료되면 지워집니다. 실제 민원·비공개 실자료의 외부 AI 전송 차단과 단계별 동의는 기존 정책을 유지합니다.
- 이 실행 파일은 로컬 화면을 엽니다. Vercel 웹 화면에서 PC AI에 연결하는 방식과는 별개이며, EXE에서는 PC 연결 코드가 필요하지 않습니다.
- Google Gemini는 별도의 사용자 API Key를 계속 요구합니다. 키는 실행 파일에 포함되지 않습니다.

## 설치·제거

- 프로그램 버전별 파일: `%LOCALAPPDATA%\Programs\minwon-answer\<버전>`
- 시작 메뉴 바로가기: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\민원답변 도우미.lnk`
- 제거하려면 실행 중인 콘솔 창을 먼저 닫고 시작 메뉴 바로가기와 프로그램 버전 폴더를 직접 삭제합니다. Codex 로그인 폴더는 별도이며 이 제거 과정에서 지워지지 않습니다.
- 새 버전은 별도 버전 폴더에 설치됩니다. 기존 버전을 정리할 때는 해당 버전 폴더만 확인해 삭제합니다.

## 빌드·검증

```powershell
npm test
npm run check
npm run build:win
```

빌드는 Windows 기본 .NET Framework C# 컴파일러와 자체 압축 런처를 사용합니다. npm 패키지를 새로 설치하지 않습니다. 빌드 스크립트는 로컬 Node.js의 버전과 SHA-256을 공식 Node.js v24.14.1 Windows x64 바이너리의 고정값과 대조한 뒤 번들에 포함합니다. `licenses/nodejs-v24.14.1-LICENSE.txt`를 실행 파일에 함께 넣습니다.

`build:win`은 생성된 EXE에서 `--self-test`를 실행해 격리 폴더에 풀기, Node 버전, 로컬 `/api/health`, 첫 화면, 설정 API를 확인합니다. 결과물은 `release-output/`에 저장되고 `.sha256` 파일도 생성됩니다. 단위 테스트는 초안→검토→재작성 흐름과 외부 연결 차단을 별도로 확인합니다.

현재 릴리스 실행 파일은 코드 서명 인증서가 없어 Authenticode 서명되지 않습니다. GitHub Release의 SHA-256 파일과 대조할 수 있습니다. 공개 후 Windows SmartScreen 경고가 표시될 수 있습니다.

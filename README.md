# carInEn

Firebase 기반 차량 인포테인먼트 데모 프로젝트입니다.  
웹 프론트엔드와 Firebase Functions를 함께 사용하며, 사용자 전환, 차량 프로필 관리, 로그 업로드, 날씨 조회, 지도 탐색, 챗봇 화면을 포함합니다.

## 개요

이 프로젝트는 다음 흐름을 중심으로 동작합니다.

- Firebase Authentication으로 사용자 로그인 및 세션 관리
- Firestore와 Storage를 이용한 사용자 설정 및 로그 데이터 저장
- Firebase Functions를 이용한 권한 관리와 로그 후처리
- Kakao 지도 API를 이용한 메인 지도 및 내비게이션 화면 구성
- OpenWeather API를 이용한 날씨 정보 표시
- OpenAI API를 이용한 챗봇 응답 생성

## 주요 기능

- 메인 대시보드
- 사용자 전환 및 회원 가입
- 차량 프로필 수정
- 관리자 권한 기반 회원 역할 변경
- 주행 로그 업로드 및 파싱
- 현재 위치 기반 날씨 조회
- 목적지 검색 및 경로 안내
- AI 챗봇 화면

## 프로젝트 구조

```text
public/
  auth/                  인증 및 세션 처리
  chatbot/               AI 챗봇 화면
  config/                프론트엔드 로컬 설정 파일
  firebase/              Firebase 초기화
  navigation/            지도 및 경로 안내
  settings/              로그 업로드/조회
  user-switch/           사용자 전환/회원가입
  vehicle/               차량 프로필 및 관리자 메뉴
  weather/               날씨 화면
functions/
  config/                Functions 로컬 설정 파일
  index.js               Firebase Functions 엔트리
firestore.rules          Firestore 보안 규칙
storage.rules            Storage 보안 규칙
firebase.json            Firebase 배포 설정
```

## 사전 준비

다음 항목이 설치되어 있어야 합니다.

- Node.js 20 이상
- npm
- Firebase CLI
- Git
- 로컬 웹 서버
  예: VS Code Live Server

필요한 외부 서비스 키 또는 설정은 아래와 같습니다.

- Firebase Web App 설정값
- Firebase 프로젝트 ID
- Kakao JavaScript 키
- Kakao REST API 키
- OpenWeather API 키
- OpenAI API 키

## 처음 실행하는 방법

### 1. 저장소 받기

```bash
git clone <repository-url>
cd carInEn
```

### 2. Functions 의존성 설치

```bash
cd functions
npm install
cd ..
```

### 3. 로컬 설정 파일 만들기

예시 파일을 복사해서 실제 설정 파일을 만듭니다.

```powershell
Copy-Item public\config\app-config.example.js public\config\app-config.js
Copy-Item functions\config\runtime-config.example.js functions\config\runtime-config.js
```

설정 파일은 Git에 올라가지 않도록 `.gitignore`에 포함되어 있습니다.

- `public/config/app-config.js`
- `functions/config/runtime-config.js`

### 4. 로컬 설정값 채우기

#### `public/config/app-config.js`

프론트엔드에서 사용하는 값을 넣습니다.

- Firebase Web 설정값
- 관리자 이메일
- Kakao 지도 키
- OpenWeather 키
- OpenAI 키

#### `functions/config/runtime-config.js`

서버 측에서 사용하는 값을 넣습니다.

- 기본 SSAFY 사용자 UID
- 관리자 이메일

## 실행 방법

### 프론트엔드 실행

`public/index.html`을 로컬 웹 서버로 실행합니다.

예:

- VS Code Live Server로 `public/index.html` 열기

주의:

- 브라우저에서 파일을 직접 더블클릭해 여는 방식보다 로컬 서버 실행을 권장합니다.
- 모듈 import와 외부 API 로딩 때문에 로컬 서버 환경이 더 안정적입니다.

### Firebase Functions 실행

필요하면 에뮬레이터 또는 배포 환경에서 Functions를 실행합니다.

```bash
cd functions
npm run serve
```

## Firebase 관련 주의사항

다음 값들은 서로 일치해야 합니다.

- `public/config/app-config.js`의 `firebase.projectId`
- `.firebaserc`의 기본 프로젝트
- 실제 Firebase 콘솔 프로젝트

프로젝트가 다르면 업로드, 조회, 인증에서 권한 문제가 발생할 수 있습니다.

## 배포 또는 규칙 반영

Firestore 규칙만 반영하려면:

```bash
firebase deploy --only firestore:rules
```

Functions까지 함께 반영하려면:

```bash
firebase deploy --only functions
```

## Git에 올리기 전에 확인할 것

- 실제 설정 파일이 Git 추적 대상이 아닌지 확인
- `functions/node_modules`가 올라가지 않는지 확인
- 서비스 계정 키 JSON 파일이 없는지 확인
- OpenAI 키처럼 이미 노출된 키는 재발급 후 교체

확인 예시:

```bash
git status
```

다음 파일은 일반적으로 Git에 올라가면 안 됩니다.

- `public/config/app-config.js`
- `functions/config/runtime-config.js`
- `functions/node_modules/`
- 서비스 계정 키 JSON 파일

## 트러블슈팅

### 1. `Missing or insufficient permissions`

다음 항목을 확인합니다.

- Firebase 프로젝트 ID가 일치하는지
- Firestore 규칙이 올바른 프로젝트에 배포됐는지
- 현재 로그인한 계정 권한이 맞는지

### 2. 프록시 환경 때문에 Firebase CLI가 실패하는 경우

PowerShell에서 아래를 실행한 뒤 다시 시도합니다.

```powershell
Remove-Item Env:HTTP_PROXY -ErrorAction SilentlyContinue
Remove-Item Env:HTTPS_PROXY -ErrorAction SilentlyContinue
Remove-Item Env:ALL_PROXY -ErrorAction SilentlyContinue
Remove-Item Env:GIT_HTTP_PROXY -ErrorAction SilentlyContinue
Remove-Item Env:GIT_HTTPS_PROXY -ErrorAction SilentlyContinue
```

### 3. 지도 또는 날씨가 표시되지 않는 경우

- Kakao API 키가 올바른지 확인
- OpenWeather API 키가 올바른지 확인
- 브라우저 위치 권한이 허용됐는지 확인

### 4. 챗봇 응답이 오지 않는 경우

- OpenAI API 키가 올바른지 확인
- API 사용량 제한이나 과금 상태를 확인
- 브라우저 콘솔과 네트워크 요청 실패 여부를 확인

## 참고

- 예시 설정 파일은 문서용 샘플입니다.
- 실제 개인 정보와 API 키는 로컬 설정 파일에만 넣어 사용해야 합니다.
- 공개 저장소로 운영할 경우 민감한 키는 반드시 재발급하는 것을 권장합니다.

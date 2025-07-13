# 🏆 LEGENDS ARENA - AI Character Battle Game

> AI가 생성한 캐릭터들로 펼치는 환상적인 배틀 게임!

## 🎮 게임 소개

LEGENDS ARENA는 AI 기술을 활용한 혁신적인 캐릭터 배틀 게임입니다. 플레이어는 자신만의 독특한 캐릭터를 생성하고, 다른 플레이어들의 캐릭터와 치열한 전투를 벌일 수 있습니다.

### ✨ 주요 기능

- 🤖 **AI 캐릭터 생성**: Google Gemini AI로 캐릭터 스토리와 스킬 자동 생성
- 🎨 **AI 이미지 생성**: Hugging Face FLUX 모델로 캐릭터 이미지 생성
- ⚔️ **실시간 전투 시스템**: 턴제 기반의 전략적 배틀
- 📖 **소설형 전투 로그**: AI가 생성하는 생동감 넘치는 전투 스토리
- 🏅 **랭킹 시스템**: 승률 기반 캐릭터 랭킹
- 🔥 **Firebase 연동**: 실시간 데이터 동기화 및 사용자 관리

## 🚀 배포 방법

### Netlify 배포 (권장)

이 프로젝트는 Netlify에 최적화되어 있습니다!

#### 빠른 배포
```bash
# 1. 저장소 클론
git clone <your-repo-url>
cd character-battle

# 2. 의존성 설치
npm install

# 3. Netlify CLI 설치 (전역)
npm install -g netlify-cli

# 4. Netlify 로그인
netlify login

# 5. 배포
npm run deploy:prod
```

#### Windows 사용자용 배치 스크립트
```bash
# 간편 배포 스크립트 실행
deploy-netlify.bat
```

### 환경 변수 설정

Netlify 대시보드에서 다음 환경 변수들을 설정하세요:

```env
HF_TOKEN=your_hugging_face_token
GEMINI_API_KEY=your_gemini_api_key
```

자세한 배포 가이드는 [NETLIFY_DEPLOYMENT.md](./NETLIFY_DEPLOYMENT.md)를 참고하세요.

## 🛠️ 기술 스택

### Frontend
- **HTML5/CSS3/JavaScript**: 모던 웹 표준
- **Firebase SDK**: 실시간 데이터베이스 및 인증

### Backend
- **Node.js + Express**: 서버 프레임워크
- **Netlify Functions**: 서버리스 API
- **Firebase Firestore**: NoSQL 데이터베이스

### AI Services
- **Google Gemini**: 텍스트 생성 (캐릭터 스토리, 전투 로그)
- **Hugging Face FLUX**: 이미지 생성

## 📁 프로젝트 구조

```
character-battle/
├── 📄 index.html              # 메인 HTML 파일
├── 🎨 style.css               # 스타일시트
├── ⚡ app.js                  # 메인 JavaScript 로직
├── 🖥️ server.js               # Express 서버
├── 📦 package.json            # 의존성 관리
├── 🌐 netlify.toml            # Netlify 설정
├── 📁 functions/
│   └── 🔧 api.js              # Netlify Functions
├── 📋 NETLIFY_DEPLOYMENT.md   # 배포 가이드
├── 🚀 deploy-netlify.bat      # Windows 배포 스크립트
└── 📝 README.md               # 프로젝트 문서
```

## 🎯 게임 플레이 가이드

### 1. 캐릭터 생성
1. 로그인 후 "새 캐릭터 생성" 클릭
2. 캐릭터 이름과 컨셉 입력
3. AI가 자동으로 스토리, 스킬, 이미지 생성
4. 마음에 들면 "저장" 클릭

### 2. 전투 참여
1. 생성된 캐릭터 선택
2. "전투 시작" 버튼 클릭
3. 상대방 자동 매칭 또는 직접 선택
4. 전투용 스킬 2개 선택
5. 전투 시작!

### 3. 전투 시스템
- 턴제 기반 전투
- 스킬별 고유한 효과
- 실시간 전투 진행도 표시
- AI가 생성하는 생동감 넘치는 전투 로그

## 🏅 랭킹 시스템

- 승률 기반 캐릭터 랭킹
- 실시간 순위 업데이트
- 상위 랭커 캐릭터 정보 확인 가능

## 🔧 로컬 개발

### 개발 환경 설정
```bash
# 저장소 클론
git clone <your-repo-url>
cd character-battle

# 의존성 설치
npm install

# 환경 변수 설정
cp .env.example .env
# .env 파일에 API 키 입력

# 로컬 서버 시작
npm run dev
```

### 개발 서버 URL
- **Frontend**: http://localhost:8888
- **Functions**: http://localhost:8888/.netlify/functions/api

## 🤝 기여하기

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 라이선스

This project is licensed under the ISC License.

## 📞 지원

문제가 발생하거나 질문이 있으시면:
- GitHub Issues에 문제 보고
- 개발자에게 직접 연락

---

**즐거운 게임 되세요! 🎮⚔️**
# 🚀 Netlify 배포 가이드

이 프로젝트는 Netlify에 배포할 준비가 완료되었습니다!

## 📋 배포 전 체크리스트

✅ **완료된 설정들:**
- `netlify.toml` 설정 파일 ✓
- `functions/api.js` Netlify Functions 설정 ✓
- `server.js`에서 Express 앱 export ✓
- `serverless-http` 의존성 설치 ✓
- `.gitignore`에 환경 변수 파일 제외 ✓

## 🔧 배포 단계

### 1. GitHub 저장소 생성
```bash
# Git 초기화 (아직 안 했다면)
git init

# 파일 추가
git add .
git commit -m "Initial commit for Netlify deployment"

# GitHub 저장소와 연결
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git push -u origin main
```

### 2. Netlify 배포

#### 방법 A: Netlify 웹사이트에서 배포
1. [Netlify](https://netlify.com)에 로그인
2. "New site from Git" 클릭
3. GitHub 저장소 선택
4. 빌드 설정 확인:
   - **Build command**: `npm install`
   - **Publish directory**: `.`
5. "Deploy site" 클릭

#### 방법 B: Netlify CLI로 배포
```bash
# Netlify CLI 로그인
netlify login

# 사이트 초기화
netlify init

# 배포
netlify deploy

# 프로덕션 배포
netlify deploy --prod
```

### 3. 환경 변수 설정

Netlify 대시보드에서 환경 변수를 설정해야 합니다:

1. Netlify 사이트 대시보드 → **Site settings**
2. **Environment variables** 섹션
3. 다음 변수들을 추가:
   - `HF_TOKEN`: Hugging Face API 토큰
   - `GEMINI_API_KEY`: Google Gemini API 키
   - 기타 필요한 API 키들

## 🌐 배포 후 확인사항

### 기능 테스트
- [ ] 로그인/회원가입 기능
- [ ] 캐릭터 생성 기능
- [ ] 이미지 생성 API 동작
- [ ] Firebase 연동 확인
- [ ] 전투 시스템 동작

### 성능 최적화
- [ ] 이미지 최적화
- [ ] 번들 크기 확인
- [ ] 로딩 속도 테스트

## 🔍 문제 해결

### 일반적인 문제들

1. **Functions 오류**
   - Netlify Functions 로그 확인: `netlify functions:log`
   - 환경 변수 설정 확인

2. **빌드 실패**
   - `package.json`의 의존성 확인
   - Node.js 버전 호환성 확인

3. **API 호출 실패**
   - CORS 설정 확인
   - API 엔드포인트 URL 확인

### 로그 확인
```bash
# Netlify 함수 로그 확인
netlify functions:log

# 빌드 로그 확인
netlify open --site
```

## 📱 도메인 설정 (선택사항)

### 커스텀 도메인 연결
1. Netlify 대시보드 → **Domain settings**
2. **Add custom domain** 클릭
3. 도메인 입력 및 DNS 설정
4. SSL 인증서 자동 생성 확인

## 🚀 배포 완료!

배포가 완료되면 다음과 같은 URL을 받게 됩니다:
- **임시 URL**: `https://random-name-123456.netlify.app`
- **커스텀 도메인** (설정한 경우): `https://yourdomain.com`

## 📞 지원

문제가 발생하면:
1. Netlify 대시보드의 빌드 로그 확인
2. Functions 로그 확인
3. 환경 변수 설정 재확인
4. GitHub Issues에 문제 보고

---

**축하합니다! 🎉 AI Character Battle 게임이 성공적으로 배포되었습니다!**
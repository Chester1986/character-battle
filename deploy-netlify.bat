@echo off
echo ========================================
echo    AI Character Battle - Netlify 배포
echo ========================================
echo.

echo 1. 의존성 설치 중...
npm install
if %errorlevel% neq 0 (
    echo ❌ npm install 실패!
    pause
    exit /b 1
)

echo.
echo 2. Git 상태 확인...
git status

echo.
echo 3. 변경사항 커밋 (선택사항)
set /p commit_msg="커밋 메시지를 입력하세요 (Enter로 건너뛰기): "
if not "%commit_msg%"=="" (
    git add .
    git commit -m "%commit_msg%"
    git push
    echo ✅ Git 푸시 완료!
)

echo.
echo 4. Netlify 배포 옵션을 선택하세요:
echo [1] 테스트 배포 (Draft)
echo [2] 프로덕션 배포
echo [3] 로컬 개발 서버 시작
echo [4] 취소
echo.
set /p choice="선택 (1-4): "

if "%choice%"=="1" (
    echo 📤 테스트 배포 시작...
    netlify deploy
    echo ✅ 테스트 배포 완료! 미리보기 URL을 확인하세요.
) else if "%choice%"=="2" (
    echo 🚀 프로덕션 배포 시작...
    netlify deploy --prod
    echo ✅ 프로덕션 배포 완료!
) else if "%choice%"=="3" (
    echo 🔧 로컬 개발 서버 시작...
    netlify dev
) else (
    echo 배포가 취소되었습니다.
)

echo.
echo 배포 스크립트 완료!
pause
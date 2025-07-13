@echo off

echo Stopping any existing servers on port 3000 and 4000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000') do (
    echo Killing process %%a on port 3000
    taskkill /f /pid %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :4000') do (
    echo Killing process %%a on port 4000
    taskkill /f /pid %%a >nul 2>&1
)

echo Installing dependencies...
call npm install

echo.
echo Generating SSL certificate...
node generate-cert.js

echo.
echo Starting server in a new window...
start "AI Character Battle Server" cmd /k "node server.js"

rem Give the server a moment to start up
echo Waiting for server to start...
timeout /t 8 /nobreak >nul

echo.
echo Opening browser at https://localhost:3000
start https://localhost:3000

echo.
echo Setup complete. The server is running in a separate window.

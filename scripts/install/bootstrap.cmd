@echo off
setlocal
set "BIUUKA_GITHUB_INSTALL=%TEMP%\biuuka-github-%RANDOM%-%RANDOM%.ps1"
curl.exe --fail --location --proto "=https" --tlsv1.2 https://raw.githubusercontent.com/brxj2001/biuuka-partner/main/scripts/install/github-install.ps1 -o "%BIUUKA_GITHUB_INSTALL%"
if errorlevel 1 exit /b 1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%BIUUKA_GITHUB_INSTALL%" -InstallSource "%~1"
set "BIUUKA_CODE=%ERRORLEVEL%"
del "%BIUUKA_GITHUB_INSTALL%" >nul 2>&1
exit /b %BIUUKA_CODE%

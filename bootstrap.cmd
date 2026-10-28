@echo off
setlocal
set "BIUUKA_INSTALL=%TEMP%\biuuka-server-%RANDOM%-%RANDOM%.cmd"
curl.exe -fL https://biuuka.com/downloads/biuuka/install.cmd -o "%BIUUKA_INSTALL%"
if errorlevel 1 exit /b 1
call "%BIUUKA_INSTALL%" "%~1"
set "BIUUKA_CODE=%ERRORLEVEL%"
del "%BIUUKA_INSTALL%" >nul 2>&1
exit /b %BIUUKA_CODE%

@echo off
REM ============================================================================
REM  launch-gpu.bat — open the WebGPU build forced onto the DISCRETE GPU.
REM
REM  On an Optimus laptop the browser must place its GPU process on the NVIDIA
REM  card. Chromium's --force-high-performance-gpu flag does this; a dedicated
REM  --user-data-dir guarantees a fresh process so the flag actually takes
REM  effect (opening a tab in an already-running browser would not).
REM ============================================================================
setlocal
cd /d "%~dp0"

echo Starting local server on http://localhost:8199 ...
start "PPS server" /min cmd /c "python -m http.server 8199"
ping -n 2 127.0.0.1 >nul

set "URL=http://localhost:8199/gpu.html"
set "PROFILE=%TEMP%\pps-gpu-profile"

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
set "CHROMEX=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
set "EDGE2=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

if exist "%CHROME%"  ( start "" "%CHROME%"  --force-high-performance-gpu --new-window --user-data-dir="%PROFILE%" "%URL%" & goto done )
if exist "%CHROMEX%" ( start "" "%CHROMEX%" --force-high-performance-gpu --new-window --user-data-dir="%PROFILE%" "%URL%" & goto done )
if exist "%EDGE%"    ( start "" "%EDGE%"    --force-high-performance-gpu --new-window --user-data-dir="%PROFILE%" "%URL%" & goto done )
if exist "%EDGE2%"   ( start "" "%EDGE2%"   --force-high-performance-gpu --new-window --user-data-dir="%PROFILE%" "%URL%" & goto done )

echo Chrome/Edge not found in the usual locations - opening the default browser.
echo (It may fall back to the integrated GPU.)
start "" "%URL%"

:done
echo.
echo Opened %URL% on the high-performance GPU.
echo The in-app badge (top-right) should now name your NVIDIA RTX 3080.
echo If it still shows Intel, run install-gpu-preference.ps1 once, then relaunch.
echo.
pause
endlocal

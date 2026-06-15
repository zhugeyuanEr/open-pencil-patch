@echo off
rem Build OpenPencil Tauri release installer on Windows.
rem
rem This wraps `bun run tauri build` so the MSVC environment is loaded
rem via vcvars64.bat. Without it, the Rust compiler cannot find link.exe
rem and the build fails with `linker 'link.exe' not found`.
rem
rem Usage: scripts\release-build.bat
rem Output: desktop\target\release\bundle\{nsis,msi}\OpenPencil_*.exe

setlocal
call "C:\VSBuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1
if errorlevel 1 (
  echo Failed to load vcvars64.bat. Adjust the path above if MSVC is installed elsewhere.
  exit /b 1
)
set "PATH=C:\soft\nvm\v22.14.0\node_modules\bun\bin;%PATH%"
cd /d "%~dp0\.."
bun run tauri build
endlocal

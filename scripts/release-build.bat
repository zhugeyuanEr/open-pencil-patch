@echo off
rem Build OpenPencil Tauri release installer on Windows.
rem
rem This wraps `bun run tauri build` so the MSVC environment is loaded
rem via vcvars64.bat. Without it, the Rust compiler cannot find link.exe
rem and the build fails with `linker 'link.exe' not found`.
rem
rem Usage: scripts\release-build.bat
rem Optional: set VCVARS64=C:\path\to\vcvars64.bat and BUN_EXE=C:\path\to\bun.exe
rem Output: desktop\target\release\bundle\{nsis,msi}\OpenPencil_*.exe

setlocal
set "VCVARS=%VCVARS64%"
if not defined VCVARS (
  set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
  if exist "%VSWHERE%" (
    for /f "usebackq delims=" %%I in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSINSTALL=%%I"
  )
  if defined VSINSTALL set "VCVARS=%VSINSTALL%\VC\Auxiliary\Build\vcvars64.bat"
)
if not defined VCVARS (
  echo Could not find vcvars64.bat. Install MSVC Build Tools or set VCVARS64 to its full path.
  exit /b 1
)
if not exist "%VCVARS%" (
  echo vcvars64.bat not found: "%VCVARS%"
  echo Set VCVARS64 to the correct full path.
  exit /b 1
)

call "%VCVARS%" >nul 2>&1
if errorlevel 1 (
  echo Failed to load vcvars64.bat: "%VCVARS%"
  exit /b 1
)

set "BUN=%BUN_EXE%"
if not defined BUN (
  for /f "delims=" %%I in ('where bun 2^>nul') do if not defined BUN set "BUN=%%I"
)
if not defined BUN (
  echo Could not find bun. Add bun to PATH or set BUN_EXE to bun.exe.
  exit /b 1
)

cd /d "%~dp0\.."
"%BUN%" run tauri build
endlocal

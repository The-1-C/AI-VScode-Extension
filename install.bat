@echo off
echo Installing AI Agent extension...
echo.

:: Check for npm
where npm >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Error: npm not found. Please install Node.js first.
    pause
    exit /b 1
)

:: Install dependencies
echo Installing dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo Error: Failed to install dependencies
    pause
    exit /b 1
)

:: Compile
echo Compiling TypeScript...
call npm run compile
if %ERRORLEVEL% neq 0 (
    echo Error: Compilation failed
    pause
    exit /b 1
)

:: Package (with flags to skip prompts)
echo Packaging extension...
call npx vsce package --no-dependencies --skip-license
if %ERRORLEVEL% neq 0 (
    echo Error: Packaging failed
    pause
    exit /b 1
)

:: Find the vsix file
for %%f in (*.vsix) do set VSIX_FILE=%%f

if "%VSIX_FILE%"=="" (
    echo Error: No .vsix file found
    pause
    exit /b 1
)

:: Install to VS Code
echo Installing %VSIX_FILE% to VS Code...
call code --install-extension "%VSIX_FILE%" --force

if %ERRORLEVEL% neq 0 (
    echo.
    echo Note: 'code' command not found in PATH.
    echo Please manually install: %VSIX_FILE%
    echo.
    echo In VS Code: Extensions ^> ... ^> Install from VSIX
    pause
    exit /b 1
)

echo.
echo ========================================
echo Installation complete!
echo.
echo IMPORTANT: Restart VS Code now!
echo.
echo To use:
echo 1. Start LM Studio with a model loaded
echo 2. Start the LM Studio server (port 1234)
echo 3. Look for the robot icon in the left sidebar
echo    or press Ctrl+Shift+A
echo ========================================
pause

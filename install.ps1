# AI Agent Extension Installer
Write-Host "Installing AI Agent extension..." -ForegroundColor Cyan
Write-Host ""

# Check for npm
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "Error: npm not found. Please install Node.js first." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Install dependencies
Write-Host "Installing dependencies..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Failed to install dependencies" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Compile
Write-Host "Compiling TypeScript..." -ForegroundColor Yellow
npm run compile
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Compilation failed" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Package (skip prompts)
Write-Host "Packaging extension..." -ForegroundColor Yellow
npx vsce package --no-dependencies --skip-license
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Packaging failed" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Find vsix file
$vsix = Get-ChildItem -Filter "*.vsix" | Select-Object -First 1
if (-not $vsix) {
    Write-Host "Error: No .vsix file found" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Install to VS Code
Write-Host "Installing $($vsix.Name) to VS Code..." -ForegroundColor Yellow

# Try to find code command
$codeCmd = Get-Command code -ErrorAction SilentlyContinue
if ($codeCmd) {
    code --install-extension $vsix.FullName --force
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Warning: Install command returned an error" -ForegroundColor Yellow
    }
} else {
    Write-Host ""
    Write-Host "Note: 'code' command not found in PATH." -ForegroundColor Yellow
    Write-Host "Please manually install: $($vsix.Name)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "In VS Code: Extensions > ... > Install from VSIX" -ForegroundColor White
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "Installation complete!" -ForegroundColor Green
Write-Host ""
Write-Host "IMPORTANT: Restart VS Code now!" -ForegroundColor Red
Write-Host ""
Write-Host "To use:" -ForegroundColor White
Write-Host "1. Start LM Studio with a model loaded" -ForegroundColor White
Write-Host "2. Start the LM Studio server (port 1234)" -ForegroundColor White  
Write-Host "3. Look for the robot icon in the left sidebar" -ForegroundColor White
Write-Host "   or press Ctrl+Shift+A" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Read-Host "Press Enter to exit"

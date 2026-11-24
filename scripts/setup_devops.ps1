# ==============================================================
# RESPONSAI - DevOps, Jenkins & Jira Setup Script (Windows PowerShell)
# ==============================================================

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " RESPONSAI - CI/CD & JIRA SETUP AUTOMATION" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 1. Environment file preparation
$backendEnv = "backend\.env"
$backendEnvExample = "backend\.env.example"

if (-not (Test-Path $backendEnv)) {
    if (Test-Path $backendEnvExample) {
        Copy-Item $backendEnvExample $backendEnv
        Write-Host "[✓] Created backend\.env from template. Configure Jira API keys in backend\.env if needed." -ForegroundColor Green
    }
} else {
    Write-Host "[i] backend\.env already exists." -ForegroundColor Yellow
}

# 2. Check Git Remote
Write-Host "`nChecking Git Remote Configuration..." -ForegroundColor Cyan
try {
    $remoteUrl = git remote get-url origin
    Write-Host "Current Git Remote: $remoteUrl" -ForegroundColor White
    if ($remoteUrl -like "*guruvardhan8374*") {
        Write-Host "[!] Notice: Remote is still pointing to your friend's repo." -ForegroundColor Yellow
        Write-Host "    To update, run: git remote set-url origin https://github.com/<your-username>/AI-Ambulance-Dispatch.git" -ForegroundColor Yellow
    }
} catch {
    Write-Host "[!] Git remote check skipped or not a git repository." -ForegroundColor DarkGray
}

# 3. Test Docker Daemon
Write-Host "`nChecking Docker Engine..." -ForegroundColor Cyan
try {
    docker info > $null 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[✓] Docker is running and available." -ForegroundColor Green
    } else {
        Write-Host "[!] Docker does not appear to be running. Please start Docker Desktop." -ForegroundColor Red
    }
} catch {
    Write-Host "[!] Docker command failed. Ensure Docker is installed." -ForegroundColor Red
}

Write-Host "`nJenkins and Jira integrations are configured in:" -ForegroundColor Cyan
Write-Host " - Pipeline: Jenkinsfile (SCM dynamic checkout, linting, Docker build/deploy, Jira hooks)" -ForegroundColor White
Write-Host " - Jira Service: backend\app\services\jira_service.py" -ForegroundColor White
Write-Host " - Jira API Router: /api/v1/integrations/jira" -ForegroundColor White
Write-Host "`nSetup complete!" -ForegroundColor Green


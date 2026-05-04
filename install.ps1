$ErrorActionPreference = "Stop"

$Repo = "Tiny-cyber/batch-color-approve"
$InstallDir = "$env:USERPROFILE\Projects\批色助手"
$WorkDir = "$env:USERPROFILE\Desktop\工作台\一键批色"
$LauncherFile = "$WorkDir\一键批色.bat"

Write-Host "=============================="
Write-Host "  一键批色助手 — 安装脚本"
Write-Host "=============================="
Write-Host ""

# 检查 Node.js
$nodePath = Get-Command node -ErrorAction SilentlyContinue
if ($nodePath) {
    $nodeVer = & node -v
    Write-Host "√ Node.js $nodeVer"
} else {
    Write-Host "未检测到 Node.js，正在安装..."
    $arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
    $nodeUrl = "https://nodejs.org/dist/v22.15.0/node-v22.15.0-$arch.msi"
    $msiPath = "$env:TEMP\node-install.msi"
    Write-Host "  下载 Node.js LTS..."
    Invoke-WebRequest -Uri $nodeUrl -OutFile $msiPath
    Write-Host "  安装中（需要管理员权限）..."
    Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /qn" -Wait -Verb RunAs
    Remove-Item $msiPath -ErrorAction SilentlyContinue
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
    $nodeVer = & node -v
    Write-Host "√ Node.js $nodeVer 安装完成"
}

# 检查 git
$gitPath = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitPath) {
    Write-Host ""
    Write-Host "× 未检测到 Git，请先安装: https://git-scm.com/download/win"
    Write-Host "  安装后重新运行本脚本"
    Read-Host "按回车退出"
    exit 1
}

# 克隆或更新
if (Test-Path "$InstallDir\.git") {
    Write-Host "已存在，拉取最新..."
    Push-Location $InstallDir
    & git pull
    Pop-Location
} else {
    Write-Host "克隆项目..."
    New-Item -ItemType Directory -Path (Split-Path $InstallDir) -Force | Out-Null
    & git clone "https://github.com/$Repo.git" $InstallDir
}

# 安装依赖
Write-Host "安装依赖..."
Push-Location $InstallDir
cmd /c "npm install --production"
Pop-Location

# 创建工作台目录
New-Item -ItemType Directory -Path "$WorkDir\批色报告" -Force | Out-Null

# 生成 启动调试浏览器.bat
$browserBat = @"
@echo off
echo 正在启动调试浏览器...

set CHROME=
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe

if "%CHROME%"=="" (
    echo 未找到 Chrome，请先安装 Google Chrome
    pause
    exit /b 1
)

start "" "%CHROME%" --remote-debugging-port=9222 --user-data-dir="%USERPROFILE%\chrome-debug-profile" --no-first-run --no-default-browser-check "https://sso.geiwohuo.com/#/mes-app/future/factory/purchase/batch-color-management" "https://www.kdocs.cn"

echo.
echo 浏览器已启动，请完成以下操作：
echo   1. 登录 SHEIN 供应商系统（夏锦棠账号）
echo   2. 打开共享表格（2026批色表）
echo.
echo 登录完成后，以后直接双击「一键批色.bat」即可
pause
"@
[System.IO.File]::WriteAllText("$WorkDir\启动调试浏览器.bat", $browserBat, [System.Text.Encoding]::Default)

# 生成 一键批色.bat
$batContent = @"
@echo off

powershell -NoProfile -Command "(Get-Date).AddDays(-1).ToString('yyyy-MM-dd')" > %TEMP%\yesterday.txt
set /p YESTERDAY=<%TEMP%\yesterday.txt
del %TEMP%\yesterday.txt

echo ==============================
echo   一键批色助手
echo ==============================
echo.
echo 请输入日期（格式 YYYY-MM-DD）
echo 直接按回车 = 昨天 (%YESTERDAY%)
echo 输入 all = 处理全部待批色
echo.
set /p input_date=日期:
echo.

cd /d "$InstallDir"
chcp 65001 >nul

if "%input_date%"=="" (
    node batch-approve.js %YESTERDAY% --submit
) else if /i "%input_date%"=="all" (
    node batch-approve.js --all --submit
) else (
    node batch-approve.js %input_date% --submit
)

echo.
pause
"@
[System.IO.File]::WriteAllText($LauncherFile, $batContent, [System.Text.Encoding]::Default)

Write-Host ""
Write-Host "=============================="
Write-Host "  安装完成！"
Write-Host "=============================="
Write-Host ""
Write-Host "位置: $WorkDir"
Write-Host "  启动调试浏览器.bat — 首次使用先双击这个，登录一次"
Write-Host "  一键批色.bat       — 以后每天双击这个就行"
Write-Host "  批色报告\          — 每次运行自动生成报告"

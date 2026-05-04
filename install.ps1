$ErrorActionPreference = "Stop"

$Repo = "Tiny-cyber/batch-color-approve"
$InstallDir = "$env:USERPROFILE\Projects\批色助手"
$WorkDir = "$env:USERPROFILE\Desktop\工作台\电商\一键批色"
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

# 生成 .bat 启动器
$batContent = @"
@echo off
chcp 65001 >nul
cd /d "$InstallDir"

echo ==============================
echo   一键批色助手
echo ==============================
echo.

:: 计算昨天日期
for /f "tokens=*" %%a in ('powershell -NoProfile -Command "(Get-Date).AddDays(-1).ToString('yyyy-MM-dd')"') do set YESTERDAY=%%a

echo 请输入日期（格式 YYYY-MM-DD）
echo 直接按回车 = 昨天 (%YESTERDAY%)
echo 输入 all = 处理全部待批色
echo.
set /p input_date=日期:
echo.

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
[System.IO.File]::WriteAllText($LauncherFile, $batContent, [System.Text.UTF8Encoding]::new($false))

Write-Host ""
Write-Host "=============================="
Write-Host "  安装完成！"
Write-Host "=============================="
Write-Host ""
Write-Host "位置: $WorkDir"
Write-Host "  一键批色.bat  — 双击运行"
Write-Host "  批色报告\     — 每次运行自动生成报告"
Write-Host ""
Write-Host "使用前确保："
Write-Host "  1. Chrome 以 --remote-debugging-port=9222 启动"
Write-Host "  2. 浏览器中打开并登录 sso.geiwohuo.com"
Write-Host "  3. 浏览器中打开共享表格 (kdocs.cn)"

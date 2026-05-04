# 一键批色助手 - Windows 安装脚本
# 用法: irm https://raw.githubusercontent.com/Tiny-cyber/batch-color-approve/main/install.ps1 | iex

$ErrorActionPreference = "Stop"

Set-ExecutionPolicy Bypass -Scope Process -Force

Write-Host "=============================="
Write-Host "  一键批色助手 - Windows 安装"
Write-Host "==============================`n"

# 1. 检查 Node.js
if (Get-Command node -ErrorAction SilentlyContinue) {
    Write-Host "[OK] Node.js: $(node -v)"
} else {
    Write-Host "Node.js 未安装，正在自动安装..."
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
        $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
        if (Get-Command node -ErrorAction SilentlyContinue) {
            Write-Host "[OK] Node.js 已安装: $(node -v)"
        } else {
            Write-Host "[!] Node.js 安装完成，但需要重新打开终端才能生效"
            Write-Host "    请关掉这个窗口，重新运行安装命令"
            Read-Host "按回车退出"
            exit 1
        }
    } else {
        Write-Host "[!] 请手动安装 Node.js: https://nodejs.org/"
        Read-Host "按回车退出"
        exit 1
    }
}

# 2. 检查 Git
if (Get-Command git -ErrorAction SilentlyContinue) {
    Write-Host "[OK] Git: $(git --version)"
} else {
    Write-Host "Git 未安装，正在自动安装..."
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        winget install Git.Git --accept-source-agreements --accept-package-agreements
        $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
        if (Get-Command git -ErrorAction SilentlyContinue) {
            Write-Host "[OK] Git 已安装"
        } else {
            Write-Host "[!] Git 安装完成，但需要重新打开终端才能生效"
            Write-Host "    请关掉这个窗口，重新运行安装命令"
            Read-Host "按回车退出"
            exit 1
        }
    } else {
        Write-Host "[!] 请手动安装 Git: https://git-scm.com/"
        Read-Host "按回车退出"
        exit 1
    }
}

# 3. 下载项目
$installDir = "$HOME\Projects\批色助手"
if (Test-Path "$installDir\.git") {
    Write-Host "[OK] 项目已存在，更新中..."
    Set-Location $installDir
    git pull
} else {
    if (Test-Path $installDir) {
        Write-Host "检测到旧版本（非 git），清理后重新下载..."
        Remove-Item -Recurse -Force $installDir
    }
    Write-Host "下载项目..."
    New-Item -ItemType Directory -Path "$HOME\Projects" -Force | Out-Null
    git clone https://github.com/Tiny-cyber/batch-color-approve.git $installDir
    Set-Location $installDir
}

# 4. 安装依赖
Write-Host "安装依赖..."
npm install --silent
Write-Host "[OK] 依赖安装完成"

# 5. 用 install.js 创建工作台目录和桌面脚本
Write-Host "创建桌面快捷脚本..."
node install.js

Read-Host "`n按回车关闭"

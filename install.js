const fs = require('fs');
const path = require('path');
const os = require('os');

const home = os.homedir();
const projectDir = __dirname;

console.log('==============================');
console.log('  一键批色助手 - 安装');
console.log('==============================\n');

// 1. 检查浏览器
const browserPaths = [
  { path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', name: 'Chrome' },
  { path: path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'), name: 'Chrome' },
  { path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', name: 'Edge' },
  { path: 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', name: 'Edge' },
];

let browser = null;
for (const b of browserPaths) {
  if (fs.existsSync(b.path)) {
    browser = b;
    break;
  }
}

if (!browser) {
  console.log('× 未检测到 Chrome 或 Edge');
  process.exit(1);
}
console.log(`√ 检测到 ${browser.name}`);

// 2. 创建工作台目录
const workDir = path.join(home, 'Desktop', '工作台', '一键批色');
const reportDir = path.join(workDir, '批色报告');
fs.mkdirSync(reportDir, { recursive: true });
console.log('√ 工作台目录已创建');

// 3. 创建浏览器调试模式启动脚本
const debugBat = path.join(workDir, '启动调试浏览器.bat');
fs.writeFileSync(debugBat, [
  '@echo off',
  'chcp 65001 >nul',
  `title 调试浏览器 - ${browser.name}`,
  `start "" "${browser.path}" --remote-debugging-port=9222 --user-data-dir="${path.join(home, '.chrome-debug-profile')}" --no-first-run --no-default-browser-check "https://sso.geiwohuo.com/#/mes-app/future/factory/purchase/batch-color-management" "https://www.kdocs.cn"`,
  '',
  'echo.',
  'echo 浏览器已启动，请完成以下操作：',
  'echo   1. 登录 SHEIN 供应商系统（夏锦棠账号）',
  'echo   2. 打开共享表格（2026批色表）',
  'echo.',
  'echo 登录完成后，以后直接双击「一键批色.bat」即可',
  'pause',
].join('\r\n'), 'utf8');
console.log(`√ 调试浏览器启动脚本已创建（使用 ${browser.name}）`);

// 4. 创建一键批色脚本
const batchBat = path.join(workDir, '一键批色.bat');
fs.writeFileSync(batchBat, [
  '@echo off',
  'chcp 65001 >nul',
  'title 一键批色助手',
  `cd /d "${projectDir}"`,
  '',
  'echo ==============================',
  'echo   一键批色助手',
  'echo ==============================',
  'echo.',
  '',
  'for /f "usebackq" %%a in (`powershell -command "(Get-Date).AddDays(-1).ToString(\'yyyy-MM-dd\')"`) do set YESTERDAY=%%a',
  '',
  'echo 请输入日期（格式 YYYY-MM-DD）',
  'echo   直接按回车 = 昨天 %YESTERDAY%',
  'echo   输入 all = 处理全部待批色',
  'echo.',
  'set /p "INPUT_DATE=> "',
  'if "%INPUT_DATE%"=="" set "INPUT_DATE=%YESTERDAY%"',
  '',
  'if /i "%INPUT_DATE%"=="all" (',
  '    node batch-approve.js --all --submit',
  ') else (',
  '    node batch-approve.js %INPUT_DATE% --submit',
  ')',
  '',
  'echo.',
  'pause',
].join('\r\n'), 'utf8');
console.log('√ 一键批色脚本已创建');

// 完成
console.log('\n==============================');
console.log('  √ 安装完成！');
console.log('==============================\n');
console.log('还差最后一步（只需做一次）：');
console.log(`  1. 双击 桌面\\工作台\\一键批色\\启动调试浏览器.bat`);
console.log('  2. 在弹出的浏览器里登录 SHEIN 系统 + 打开共享表格\n');
console.log('之后每次使用：');
console.log('  双击 桌面\\工作台\\一键批色\\一键批色.bat');
console.log(`  报告自动保存到 桌面\\工作台\\一键批色\\批色报告\\\n`);

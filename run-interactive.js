const readline = require('readline');
const { execSync } = require('child_process');

const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1);
const ymd = yesterday.toISOString().slice(0, 10);

console.log('==============================');
console.log('  一键批色助手');
console.log('==============================');
console.log('');
console.log('请输入日期（格式 YYYY-MM-DD）');
console.log(`  直接按回车 = 昨天 ${ymd}`);
console.log('  输入 all = 处理全部待批色');
console.log('');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('日期: ', (answer) => {
  rl.close();
  console.log('');
  const input = answer.trim() || ymd;
  try {
    if (input.toLowerCase() === 'all') {
      execSync('node batch-approve.js --all --submit', { stdio: 'inherit' });
    } else {
      execSync(`node batch-approve.js ${input} --submit`, { stdio: 'inherit' });
    }
  } catch (e) {
    // batch-approve.js already prints its own errors
  }
});

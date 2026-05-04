#!/bin/bash
set -e

REPO="Tiny-cyber/batch-color-approve"
INSTALL_DIR="$HOME/Projects/批色助手"
COMMAND_FILE="$HOME/Desktop/一键批色.command"

echo "=============================="
echo "  一键批色助手 — 安装脚本"
echo "=============================="
echo ""

# 检查 Node.js
if command -v node &>/dev/null; then
  echo "✓ Node.js $(node -v)"
elif [ -d "$HOME/.nvm" ]; then
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  if command -v node &>/dev/null; then
    echo "✓ Node.js $(node -v) (via nvm)"
  else
    echo "nvm 已安装但没有 Node，正在安装..."
    nvm install --lts
  fi
else
  echo "未检测到 Node.js，正在通过 nvm 安装..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm install --lts
  echo "✓ Node.js $(node -v) 安装完成"
fi

NODE_BIN=$(dirname "$(which node)")

# 克隆或更新
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "已存在，拉取最新..."
  cd "$INSTALL_DIR"
  git pull
else
  echo "克隆项目..."
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "https://github.com/$REPO.git" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# 安装依赖
echo "安装依赖..."
npm install --production

# 生成 .command 启动器
cat > "$COMMAND_FILE" << EOF
#!/bin/zsh
export PATH="$NODE_BIN:\$PATH"
cd "$INSTALL_DIR"

echo "=============================="
echo "  一键批色助手"
echo "=============================="
echo ""

YESTERDAY=\$(date -v-1d +%Y-%m-%d)

echo "请输入日期（格式 YYYY-MM-DD）"
echo "直接按回车 = 昨天 (\$YESTERDAY)"
echo "输入 all = 处理全部待批色"
echo ""
printf "日期: "
read input_date

echo ""

if [ -z "\$input_date" ]; then
  node batch-approve.js "\$YESTERDAY" --submit
elif [ "\$input_date" = "all" ] || [ "\$input_date" = "ALL" ]; then
  node batch-approve.js --all --submit
else
  node batch-approve.js "\$input_date" --submit
fi

echo ""
echo "按回车关闭窗口..."
read
EOF
chmod +x "$COMMAND_FILE"

# 报告目录
mkdir -p "$HOME/Desktop/工作台/一键批色/批色报告"

echo ""
echo "=============================="
echo "  安装完成！"
echo "=============================="
echo ""
echo "桌面快捷方式: $COMMAND_FILE"
echo ""
echo "使用前确保："
echo "  1. Chrome 以 --remote-debugging-port=9222 启动"
echo "  2. 浏览器中打开并登录 sso.geiwohuo.com"
echo "  3. 浏览器中打开共享表格 (kdocs.cn)"
echo ""
echo "双击桌面「一键批色.command」即可使用"

#!/bin/zsh
export PATH="/Users/tinypity/.nvm/versions/node/v24.13.1/bin:$PATH"
cd /Users/tinypity/Projects/批色助手

echo "=============================="
echo "  一键批色助手"
echo "=============================="
echo ""

YESTERDAY=$(date -v-1d +%Y-%m-%d)

echo "请输入日期（格式 YYYY-MM-DD）"
echo "直接按回车 = 昨天 ($YESTERDAY)"
echo "输入 all = 处理全部待批色"
echo ""
printf "日期: "
read input_date

echo ""

if [ -z "$input_date" ]; then
  node batch-approve.js "$YESTERDAY" --submit
elif [ "$input_date" = "all" ] || [ "$input_date" = "ALL" ]; then
  node batch-approve.js --all --submit
else
  node batch-approve.js "$input_date" --submit
fi

echo ""
echo "按回车关闭窗口..."
read

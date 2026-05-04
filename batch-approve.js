#!/usr/bin/env node
'use strict';

// 批色助手 — 从共享表格读取待批色款号，逐个去 SHEIN 系统提交批色
//
// 用法：
//   node batch-approve.js 2026-04-30 --submit
//   node batch-approve.js --all --submit
//   node batch-approve.js --orders=29073171,29098706 --submit

const http = require('http');
const { WebSocket } = require('ws');
const fs = require('fs');
const path = require('path');

const CDP_PORT = 9222;

// ============================================================
// CDP 工具函数
// ============================================================

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

async function findPage(urlPattern) {
  const json = await httpGet(`http://127.0.0.1:${CDP_PORT}/json/list`);
  const pages = JSON.parse(json);
  return pages.find(p => p.type === 'page' && p.url.includes(urlPattern) && p.webSocketDebuggerUrl);
}

function connectWs(page) {
  return new Promise((resolve, reject) => {
    const w = new WebSocket(page.webSocketDebuggerUrl);
    w.on('open', () => resolve(w));
    w.on('error', reject);
  });
}

function cdpSend(ws, method, params = {}, timeout = 30000) {
  const id = Math.floor(Math.random() * 1e6);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), timeout);
    const handler = raw => {
      const msg = JSON.parse(raw.toString());
      if (msg.id === id) {
        clearTimeout(t);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(ws, code, timeout = 30000) {
  const r = await cdpSend(ws, 'Runtime.evaluate', {
    expression: code,
    awaitPromise: true,
    returnByValue: true,
  }, timeout);
  if (r.result?.exceptionDetails) {
    const desc = r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text;
    throw new Error(`JS evaluate 出错: ${desc}`);
  }
  return r.result?.result?.value;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function excelSerialToDate(serial) {
  if (typeof serial === 'string') {
    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(serial)) return serial.replace(/\//g, '-');
    const cnMatch = serial.match(/^(\d{1,2})月(\d{1,2})日?$/);
    if (cnMatch) {
      const year = new Date().getFullYear();
      return `${year}-${cnMatch[1].padStart(2, '0')}-${cnMatch[2].padStart(2, '0')}`;
    }
    const n = parseFloat(serial);
    if (isNaN(n)) return null;
    serial = n;
  }
  if (typeof serial !== 'number' || serial < 40000 || serial > 50000) return null;
  const d = new Date((serial - 25569) * 86400000);
  return ymd(d);
}

// ============================================================
// Step 1: 从共享表格读取待批色款号
// ============================================================

async function readKdocs(ws, targetDate, allDates) {
  console.log('读取共享表格数据...');

  try { await cdpSend(ws, 'Emulation.setFocusEmulationEnabled', { enabled: true }); } catch {}
  try { await cdpSend(ws, 'Page.enable'); } catch {}

  try {
    await evaluate(ws, '1+1', 10000);
  } catch {
    console.log('  共享表格标签页唤醒中，稍等...');
    await sleep(2000);
    await evaluate(ws, '1+1', 10000);
  }

  const TARGET_SHEET = '2026批色表';

  const sheetName = await evaluate(ws, `(async () => {
    try {
      const app = WPSOpenApi.Application;
      let sheet = await app.ActiveSheet;
      let name = await sheet.Name;
      if (name !== '${TARGET_SHEET}') {
        const wb = await app.ActiveWorkbook;
        const sheets = await wb.Sheets;
        sheet = await sheets.Item('${TARGET_SHEET}');
        await sheet.Activate();
        name = await sheet.Name;
      }
      return name;
    } catch (e) {
      return '__ERROR__' + e.message;
    }
  })()`, 45000);

  if (typeof sheetName === 'string' && sheetName.startsWith('__ERROR__')) {
    throw new Error(`共享表格找不到 sheet "${TARGET_SHEET}": ${sheetName.slice(9)}`);
  }
  console.log(`  sheet: ${sheetName}`);

  const rowCount = await evaluate(ws, `(async () => {
    const app = WPSOpenApi.Application;
    const sheet = await app.ActiveSheet;
    const usedRange = await sheet.UsedRange;
    const rows = await usedRange.Rows;
    return await rows.Count;
  })()`, 45000);
  console.log(`  总行数: ${rowCount}`);

  const BATCH_SIZE = 50;
  const endRow = Math.min(rowCount, 15000);
  const pending = [];

  // 从尾部往前定位目标日期的起始行
  let scanStart;
  if (allDates) {
    scanStart = Math.max(3, endRow - 2000);
  } else {
    scanStart = endRow;
    for (let probe = endRow; probe >= 3; probe -= 200) {
      const probeFrom = Math.max(3, probe - 199);
      let probeData;
      try {
        probeData = await evaluate(ws, `(async () => {
          const sheet = await WPSOpenApi.Application.ActiveSheet;
          const range = await sheet.Range('A${probeFrom}:A${probe}');
          return JSON.stringify(await range.Value2);
        })()`, 60000);
      } catch { break; }
      if (!probeData) break;
      let probeDates;
      try { probeDates = JSON.parse(probeData); } catch { break; }
      if (!probeDates || probeDates.length === 0) break;

      let foundTarget = false;
      for (let i = 0; i < probeDates.length; i++) {
        const val = Array.isArray(probeDates[i]) ? probeDates[i][0] : probeDates[i];
        const ds = excelSerialToDate(val);
        if (ds === targetDate) {
          scanStart = probeFrom + i;
          foundTarget = true;
          break;
        }
      }
      if (foundTarget) break;
      const firstVal = Array.isArray(probeDates[0]) ? probeDates[0][0] : probeDates[0];
      const firstDate = excelSerialToDate(firstVal);
      if (firstDate && firstDate < targetDate) break;

      await sleep(300);
    }
    if (scanStart >= endRow) {
      console.log(`  共享表格中没有找到日期 ${targetDate} 的数据`);
      return [];
    }
    console.log(`  日期 ${targetDate} 从第 ${scanStart} 行开始`);
  }
  const scanEnd = endRow;

  for (let from = scanStart; from <= scanEnd; from += BATCH_SIZE) {
    const to = Math.min(from + BATCH_SIZE - 1, scanEnd);

    let batchData;
    let batchSuccess = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) {
          try { await evaluate(ws, '1+1', 15000); } catch {}
          await sleep(2000);
        }
        batchData = await evaluate(ws, `(async () => {
          const sheet = await WPSOpenApi.Application.ActiveSheet;
          const range = await sheet.Range('A${from}:I${to}');
          return JSON.stringify(await range.Value2);
        })()`, 90000);
        batchSuccess = true;
        break;
      } catch (e) {
        if (attempt < 2) {
          console.log(`  共享表格读取超时，正在重试... (${attempt + 1}/3)`);
        }
      }
    }

    if (!batchSuccess) {
      console.log(`  行 ${from}-${to} 多次重试仍然超时，跳过`);
      continue;
    }

    if (!batchData) break;

    let rows;
    try { rows = JSON.parse(batchData); } catch { break; }
    if (!rows || rows.length === 0) break;

    let passedTarget = false;
    for (let i = 0; i < rows.length; i++) {
      const dateVal = rows[i][0];
      const kuanhao = rows[i][1];
      const result = rows[i][8];

      if (!kuanhao || kuanhao === '款号') continue;
      if (!dateVal && !kuanhao) continue;

      const dateStr = excelSerialToDate(dateVal);
      if (!allDates && dateStr && dateStr !== targetDate) {
        if (dateStr > targetDate) { passedTarget = true; break; }
        continue;
      }

      if (result && (String(result).includes('已批色') || String(result).includes('已经批色'))) continue;

      pending.push({
        date: dateStr || '未知日期',
        kuanhao: String(kuanhao).trim(),
        kdocsRow: from + i,
      });
    }

    if (passedTarget) break;
    const hasData = rows.some(r => r[0] || r[1]);
    if (!hasData) break;
    if (from + BATCH_SIZE <= scanEnd) await sleep(300);
  }

  // 去重（同款号可能有多行，收集所有行号）
  const byKuanhao = new Map();
  for (const item of pending) {
    if (!byKuanhao.has(item.kuanhao)) {
      byKuanhao.set(item.kuanhao, { ...item, kdocsRows: [item.kdocsRow] });
    } else {
      byKuanhao.get(item.kuanhao).kdocsRows.push(item.kdocsRow);
    }
  }

  return [...byKuanhao.values()];
}

// ============================================================
// Step 2: 用款号去 SHEIN 查找对应的待批色记录
// ============================================================

async function findSheinRecords(wsSso, kuanhao) {
  const result = await evaluate(wsSso, `(async () => {
    try {
      const resp = await fetch('/mes-app/api/materialColorCheck/colorCheckList', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'language': 'CN',
          'mes-site': '0',
          'supplier-id': '2106838'
        },
        body: JSON.stringify({
          produceOrderId: '${kuanhao}',
          pageNo: 1,
          pageSize: 50,
          tabType: 1
        }),
        credentials: 'include'
      });
      const data = await resp.json();
      return JSON.stringify(data);
    } catch (e) {
      return JSON.stringify({ code: -1, msg: e.message });
    }
  })()`);

  const data = JSON.parse(result);
  if (data.code !== 0) return [];
  return data.info?.recoders || [];
}

// ============================================================
// Step 3: 获取详情 + 物料信息 + 提交
// ============================================================

async function getDetail(ws, faPmOrderNo, materialSku) {
  const result = await evaluate(ws, `(async () => {
    try {
      const resp = await fetch('/pub/pm/order/getPmOrderDetail', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'voc-version': '3.31.0',
          'x-lt-language': 'CN'
        },
        body: JSON.stringify({
          faPmOrderNo: '${faPmOrderNo}',
          materialSku: '${materialSku}'
        })
      });
      const data = await resp.json();
      return JSON.stringify(data);
    } catch (e) {
      return JSON.stringify({ code: -1, msg: e.message });
    }
  })()`);
  return JSON.parse(result);
}

async function getMaterialInfo(ws, bizNo) {
  const result = await evaluate(ws, `(async () => {
    try {
      const resp = await fetch('/pub/fabric/getMaterialInfo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'voc-version': '3.31.0',
          'x-lt-language': 'CN'
        },
        body: JSON.stringify({ bizNo: '${bizNo}', bizType: 1 })
      });
      const data = await resp.json();
      return JSON.stringify(data);
    } catch (e) {
      return JSON.stringify({ code: -1, msg: e.message });
    }
  })()`);
  return JSON.parse(result);
}

async function submitApproval(ws, body) {
  const bodyJson = JSON.stringify(JSON.stringify(body));
  const result = await evaluate(ws, `(async () => {
    try {
      const resp = await fetch('/pub/pm/order/submitOrSave', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'voc-version': '3.31.0',
          'x-lt-language': 'CN'
        },
        body: ${bodyJson}
      });
      const data = await resp.json();
      return JSON.stringify(data);
    } catch (e) {
      return JSON.stringify({ code: -1, msg: e.message });
    }
  })()`);
  return JSON.parse(result);
}

async function writeBackKdocs(ws, rows) {
  if (!ws || !rows || rows.length === 0) return;
  for (const row of rows) {
    for (let retry = 0; retry < 3; retry++) {
      try {
        await evaluate(ws, `(async()=>{
          const s = await WPSOpenApi.Application.ActiveSheet;
          const r = await s.Range('I${row}');
          r.Value2 = '已批色';
        })()`, 45000);
        break;
      } catch {
        if (retry < 2) await sleep(2000);
      }
    }
  }
}

function buildSubmitBody(detailInfo, materialWeight) {
  const bom = detailInfo.faPmBomSingleDetailVOList[0].faPmBomDetailVOList[0];
  const bomVO = bom.faPmBomVO;

  return {
    faPmMeasureInfoDTO: {
      materialSku: detailInfo.currentMaterialSku,
      faPmBomId: bomVO.faPmBomId,
      colorLevel: 1,
      colorLevelName: '4级及以上',
      bomPmState: 2,
      defectiveDescription: '',
      defectiveTypeNameList: [],
      imageIdList: [],
      faPmBomMaterialDto: {
        weightMeasureValue: String(materialWeight || ''),
        straightMeasureValue: '',
        horizontalMeasureValue: '',
      },
      faPmFabricMsgDTOList: [],
    },
    materialSku: detailInfo.currentMaterialSku,
    isSubmit: 1,
    proofType: detailInfo.faPmVO.proofType,
    faPmOrderNo: detailInfo.faPmInfoVO.faPmOrderNo,
    version: detailInfo.faPmVO.version,
  };
}

// ============================================================
// 自动认证
// ============================================================

async function autoAuth(wsSso) {
  const ssoHash = await evaluate(wsSso, 'location.hash');
  if (!ssoHash || !ssoHash.includes('batch-color-management')) {
    console.log('  导航到批色管理页面...');
    await evaluate(wsSso, `location.hash = '#/mes-app/future/factory/purchase/batch-color-management'`);
    await sleep(5000);
  }

  let btnPos = null;
  for (let i = 0; i < 20; i++) {
    btnPos = await evaluate(wsSso, `(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '去自批');
      if (!btn) return null;
      const rect = btn.getBoundingClientRect();
      return { x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2) };
    })()`);
    if (btnPos) break;
    await sleep(2000);
  }

  if (!btnPos) return null;

  await cdpSend(wsSso, 'Page.enable');
  await cdpSend(wsSso, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: btnPos.x, y: btnPos.y, button: 'left', clickCount: 1 });
  await sleep(100);
  await cdpSend(wsSso, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: btnPos.x, y: btnPos.y, button: 'left', clickCount: 1 });

  let newVocpub = null;
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    const pj = await httpGet(`http://127.0.0.1:${CDP_PORT}/json/list`);
    const allPages = JSON.parse(pj);
    const vocPages = allPages.filter(p => p.type === 'page' && p.url.includes('vocpub.dotfashion.cn') && p.webSocketDebuggerUrl);
    if (vocPages.length > 0) {
      newVocpub = vocPages[vocPages.length - 1];
      break;
    }
  }

  if (newVocpub) await sleep(3000);
  return newVocpub;
}

// ============================================================
// Main
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const doSubmit = args.includes('--submit');
  const allDates = args.includes('--all');
  const dateArg = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const ordersArg = args.find(a => a.startsWith('--orders='));
  const manualOrders = ordersArg ? ordersArg.slice(9).split(',').map(s => s.trim()) : null;

  const yesterday = new Date(Date.now() - 86400000);
  const targetDate = dateArg || ymd(yesterday);

  if (allDates) {
    console.log(`模式: 全部日期待批色`);
  } else {
    console.log(`目标日期: ${targetDate}`);
  }
  console.log(`模式: ${doSubmit ? '提交批色' : 'DRY RUN（加 --submit 真正提交）'}\n`);

  // 连接浏览器
  console.log('连接浏览器...');
  try {
    await httpGet(`http://127.0.0.1:${CDP_PORT}/json/list`);
  } catch {
    console.error('错误: 无法连接浏览器');
    process.exit(1);
  }

  const kdocsPage = await findPage('kdocs.cn');
  const ssoPage = await findPage('sso.geiwohuo.com');
  let vocpubPage = await findPage('vocpub.dotfashion.cn');

  if (!kdocsPage && !manualOrders) {
    console.error('错误: 找不到共享表格标签页');
    process.exit(1);
  }
  if (!ssoPage) {
    console.error('错误: 找不到 SHEIN 系统标签页，请在浏览器中打开 sso.geiwohuo.com 并登录');
    process.exit(1);
  }

  // 如果审批页面没开，自动认证打开
  if (!vocpubPage) {
    console.log('  审批页面未打开，自动认证中...');
    const wsSsoTemp = await connectWs(ssoPage);
    vocpubPage = await autoAuth(wsSsoTemp);
    wsSsoTemp.close();
    if (!vocpubPage) {
      console.error('错误: SHEIN 系统未登录，请在浏览器中登录后重试');
      process.exit(1);
    }
    console.log('  认证成功');
  }

  console.log('  共享表格: ' + (kdocsPage ? '已连接' : '(跳过)'));
  console.log('  SHEIN系统: 已连接');
  console.log('  审批页面: 已连接\n');

  const wsKdocs = kdocsPage ? await connectWs(kdocsPage) : null;
  const wsSso = await connectWs(ssoPage);
  let wsVocpub = await connectWs(vocpubPage);

  try {
    // Step 1: 从 kdocs 获取待批色款号
    let kdocsItems;
    if (manualOrders) {
      kdocsItems = manualOrders.map(k => ({ kuanhao: k, kdocsRows: [] }));
      console.log(`手动指定: ${manualOrders.length} 个款号\n`);
    } else {
      kdocsItems = await readKdocs(wsKdocs, targetDate, allDates);
      console.log(`共享表格: ${kdocsItems.length} 个款号待批色\n`);
      if (kdocsItems.length === 0) {
        console.log('没有待批色数据，退出');
        return;
      }
    }

    // Step 2: 逐个款号去 SHEIN 查找 + 提交
    console.log('开始批色...\n');
    let totalSubmitted = 0;
    let totalSuccess = 0;
    let totalFailed = 0;
    const results = [];
    const notFound = [];
    let interrupted = false;
    let authChecked = false;

    function onInterrupt() {
      interrupted = true;
      console.log('\n\n检测到中断，正在保存已完成部分的报告...');
    }
    process.on('SIGINT', onInterrupt);
    process.on('SIGTERM', onInterrupt);

    for (let ki = 0; ki < kdocsItems.length; ki++) {
      if (interrupted) break;

      const item = kdocsItems[ki];
      const kuanhao = item.kuanhao;

      const records = await findSheinRecords(wsSso, kuanhao);

      if (records.length === 0) {
        console.log(`  ${ki + 1}/${kdocsItems.length} 款号 ${kuanhao} — SHEIN 没有待批色记录，跳过`);
        notFound.push(kuanhao);
        continue;
      }

      for (const rec of records) {
        if (interrupted) break;
        totalSubmitted++;
        const bizOrderNo = rec.bizOrderNo;
        const materialSku = rec.materialSku;

        if (!doSubmit) {
          console.log(`  [DRY RUN] ${bizOrderNo} / ${materialSku}`);
          continue;
        }

        // 第一条先验证认证
        if (!authChecked) {
          authChecked = true;
          const authCheck = await getDetail(wsVocpub, bizOrderNo, materialSku);
          if (authCheck.code !== 0) {
            console.log('SHEIN 登录已过期，自动重新认证...');
            const newPage = await autoAuth(wsSso);
            if (!newPage) {
              console.error('错误: 重新认证失败，请在浏览器中登录后重试');
              return;
            }
            wsVocpub.close();
            wsVocpub = await connectWs(newPage);
            console.log('认证成功，继续处理\n');
          }
        }

        // 提交，失败重试一次
        let ok = false;
        for (let attempt = 0; attempt < 2 && !ok; attempt++) {
          try {
            if (attempt > 0) {
              console.log(`  重试 ${bizOrderNo}...`);
              await sleep(2000);
            }

            const detailResp = await getDetail(wsVocpub, bizOrderNo, materialSku);
            if (detailResp.code !== 0) {
              throw new Error(detailResp.msg || '获取详情失败');
            }

            const matData = await getMaterialInfo(wsVocpub, bizOrderNo);
            let weight = '';
            if (matData.code === 0 && matData.info?.list) {
              // 按 materialSku 匹配当前物料的克重，不是取第一个
              const match = matData.info.list.find(m => m.materialSku === materialSku);
              const target = match || matData.info.list[0];
              if (target?.weightStandardValue && target.weightStandardValue > 0) {
                weight = target.weightStandardValue;
              }
            }

            const body = buildSubmitBody(detailResp.info, weight);
            const submitResp = await submitApproval(wsVocpub, body);

            if (submitResp.code === 0) {
              console.log(`  ${ki + 1}/${kdocsItems.length} ✅ ${bizOrderNo} / ${materialSku} — 克重 ${weight || '无'}`);
              totalSuccess++;
              results.push({ bizOrderNo, materialSku, kuanhao, weight, status: 'ok' });
              ok = true;
            } else {
              throw new Error(submitResp.msg || '提交失败');
            }
          } catch (e) {
            if (attempt === 1) {
              console.log(`  ${ki + 1}/${kdocsItems.length} ❌ ${bizOrderNo} — ${e.message}`);
              totalFailed++;
              results.push({ bizOrderNo, materialSku, kuanhao, status: 'fail', error: e.message });
            }
          }
        }

        await sleep(800);
      }

      // 回写 kdocs（每个款号处理完立即回写，确保中断后不重复）
      if (doSubmit && item.kdocsRows && wsKdocs) {
        const thisKuanhaoOk = results.some(r => r.kuanhao === kuanhao && r.status === 'ok');
        if (thisKuanhaoOk) {
          await writeBackKdocs(wsKdocs, item.kdocsRows);
        }
      }
    }

    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onInterrupt);

    // 汇报
    const okResults = results.filter(r => r.status === 'ok');
    const failResults = results.filter(r => r.status === 'fail');
    const unprocessed = kdocsItems.slice(results.length > 0 ?
      kdocsItems.findIndex(item => !results.some(r => r.kuanhao === item.kuanhao) && !notFound.includes(item.kuanhao)) : kdocsItems.length
    ).filter(item => !results.some(r => r.kuanhao === item.kuanhao) && !notFound.includes(item.kuanhao));

    console.log(`\n${'='.repeat(50)}`);
    console.log(`  批色报告 — ${allDates ? '全部日期' : targetDate}${interrupted ? '（中断）' : ''}`);
    console.log(`${'='.repeat(50)}`);
    console.log(`  共享表格款号: ${kdocsItems.length} 个`);
    console.log(`  成功: ${totalSuccess} 条`);
    if (totalFailed > 0) console.log(`  失败: ${totalFailed} 条`);
    if (notFound.length > 0) console.log(`  SHEIN 暂无记录: ${notFound.length} 个款号`);
    if (interrupted && unprocessed.length > 0) console.log(`  未处理: ${unprocessed.length} 个款号`);
    console.log(`  色差: 4级及以上（全部）`);
    console.log(`  克重: 系统原克重（全部）`);

    if (notFound.length > 0) {
      console.log(`\n  SHEIN 暂无待批色记录的款号:`);
      for (const k of notFound) console.log(`    ${k}`);
    }
    if (failResults.length > 0) {
      console.log(`\n  失败明细:`);
      for (const f of failResults) console.log(`    ${f.bizOrderNo}: ${f.error}`);
    }
    if (interrupted && unprocessed.length > 0) {
      console.log(`\n  未处理的款号（重新运行即可继续）:`);
      for (const item of unprocessed) console.log(`    ${item.kuanhao}`);
    }
    console.log('');

    // 保存报告（同一天追加到同一个文件）
    if (doSubmit && results.length > 0) {
      const reportDir = path.join(require('os').homedir(), 'Desktop', '工作台', '电商', '一键批色', '批色报告');
      fs.mkdirSync(reportDir, { recursive: true });
      const reportFile = path.join(reportDir, `批色报告_${allDates ? ymd(new Date()) : targetDate}.txt`);

      const lines = [];
      const isAppend = fs.existsSync(reportFile);
      if (isAppend) {
        lines.push('');
        lines.push(`${'─'.repeat(40)}`);
      }
      lines.push(`[${new Date().toLocaleTimeString('zh-CN')}] 批色 ${totalSuccess} 条${totalFailed > 0 ? `，失败 ${totalFailed} 条` : ''}${interrupted ? '（中断）' : ''}`);
      for (const r of results) {
        const icon = r.status === 'ok' ? '✓' : '✗';
        lines.push(`  ${icon} ${r.bizOrderNo} / ${r.materialSku}${r.status === 'ok' ? ` — 克重 ${r.weight || '无'}` : ` — ${r.error}`}`);
      }
      if (notFound.length > 0) {
        lines.push(`  SHEIN 暂无记录: ${notFound.join(', ')}`);
      }

      if (isAppend) {
        fs.appendFileSync(reportFile, lines.join('\n') + '\n', 'utf8');
      } else {
        const header = `批色报告 — ${allDates ? '全部日期' : targetDate}\n色差: 4级及以上 | 克重: 系统原克重\n`;
        fs.writeFileSync(reportFile, '﻿' + header + lines.join('\n') + '\n', 'utf8');
      }
      console.log(`报告已${isAppend ? '追加' : '保存'}: ${reportFile}`);
    }
  } finally {
    if (wsKdocs) wsKdocs.close();
    wsSso.close();
    wsVocpub.close();
  }
}

main().catch(e => {
  console.error(`\n致命错误: ${e.message}`);
  process.exit(1);
});

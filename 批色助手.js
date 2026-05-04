// 唐欢批色自动化助手 — 浏览器 console 注入脚本
//
// 适用场景：希音 FOB 供应商系统（夏锦棠9211 账号）下，自动批"待自批"的色样
// 系统数据流：
//   1. 列表 API：sso.geiwohuo.com 域，POST /mes-app/api/materialColorCheck/colorCheckList
//   2. 详情 API：vocpub.dotfashion.cn 域，POST /pub/pm/order/getPmOrderDetail
//   3. 物料信息：vocpub.dotfashion.cn 域，POST /pub/fabric/getMaterialInfo  (拿 weightStandardValue 参考克重)
//   4. 提交 API：vocpub.dotfashion.cn 域，POST /pub/pm/order/submitOrSave
//
// 使用方法：
//   1. 浏览器登录希音供应商后台 sso.geiwohuo.com（用夏锦棠账号）
//   2. 打开 物料管理 → 批色管理
//   3. F12 打开 console，粘贴本脚本全部内容回车
//   4. 列表查询：       pibao.list()
//   5. 看一条详情：     pibao.detail('MLSH-29080437-001', 'M01154021')      (要在 vocpub 域)
//   6. Dry run：       pibao.dryRun('MLSH-29080437-001', 'M01154021')      (默认用参考克重)
//   7. 真保存（不审核）：pibao.save('MLSH-29080437-001', 'M01154021')
//   8. 真审核通过：     pibao.submitPass('MLSH-29080437-001', 'M01154021')
//   9. 批量：           pibao.batchSubmit([{orderNo,sku,weight?},...], { reallySubmit:true })
//
// 安全设计：
//   - dryRun 永远不发请求
//   - save (isSubmit=0) 保存草稿，不进入审核完成流程，可被覆盖
//   - submitPass (isSubmit=1) 才是真自批通过，记录从待批列表消失
//   - batchSubmit 默认 reallySubmit:false（dry run），必须显式 true 才真发

(() => {
  const SSO_HOST = 'sso.geiwohuo.com';
  const VOC_HOST = 'vocpub.dotfashion.cn';
  const isSSO = location.host === SSO_HOST;
  const isVOC = location.host === VOC_HOST;

  function api(path) {
    if (path.startsWith('/mes-app')) return 'https://' + SSO_HOST + path;
    return 'https://' + VOC_HOST + path;
  }

  function checkDomain(needHost, action) {
    if (location.host !== needHost) {
      throw new Error(`❌ ${action} 必须在 https://${needHost}/ 页面里跑（当前在 ${location.host}）`);
    }
  }

  async function postJSON(url, body, extraHeaders = {}) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'accept': 'application/json',
        ...extraHeaders,
      },
      body: JSON.stringify(body),
      credentials: 'include',
    });
    return resp.json();
  }

  // ============================================================
  // 列表（sso 域）
  // ============================================================
  async function list(opts = {}) {
    checkDomain(SSO_HOST, '查询待批色列表');
    const today = new Date();
    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const start = opts.from || ymd(new Date(today.getTime() - 7*86400e3));
    const end = opts.to || ymd(today);
    const data = await postJSON(api('/mes-app/api/materialColorCheck/colorCheckList'), {
      createTimeStart: start, createTimeEnd: end,
      pageNo: opts.pageNo || 1, pageSize: opts.pageSize || 50,
      tabType: opts.tabType ?? 1,        // 1 = 待批色
    }, { 'language': 'CN', 'mes-site': '0', 'supplier-id': '2106838' });
    if (data.code !== 0) throw new Error(`列表 API 失败 code=${data.code} msg=${data.msg}`);
    const records = data.info?.recoders || [];
    console.log(`📋 共 ${records.length} 条 (page ${data.info.pageNo}, ${start} ~ ${end})`);
    console.table(records.map(r => ({
      colorCheckNo: r.colorCheckNo,
      bizOrderNo: r.bizOrderNo,
      materialSku: r.materialSku,
      materialType: r.materialType,
      supplierCode: r.supplierCode,
      colorCheckStatusDesc: r.colorCheckStatusDesc,
      backTime: r.backTime,
      createTime: r.createTime,
    })));
    return records;
  }

  // ============================================================
  // 详情（vocpub 域）
  // ============================================================
  async function detail(faPmOrderNo, materialSku) {
    checkDomain(VOC_HOST, '查询批色详情');
    const data = await postJSON(api('/pub/pm/order/getPmOrderDetail'), { faPmOrderNo, materialSku }, {
      'voc-version': '3.31.0', 'x-lt-language': 'CN',
    });
    if (data.code !== 0) throw new Error(`详情 API 失败 code=${data.code} msg=${data.msg}`);
    return data.info;
  }

  // 物料信息（拿参考克重 weightStandardValue）
  async function materialInfo(bizNo) {
    checkDomain(VOC_HOST, '查询物料信息');
    const data = await postJSON(api('/pub/fabric/getMaterialInfo'), { bizNo, bizType: 1 }, {
      'voc-version': '3.31.0', 'x-lt-language': 'CN',
    });
    if (data.code !== 0) throw new Error(`物料信息 API 失败 code=${data.code} msg=${data.msg}`);
    return data.info?.list || [];
  }

  // ============================================================
  // 构造提交 body（不发送）
  // ============================================================
  function buildBody(detailInfo, opts = {}) {
    const bom = detailInfo.faPmBomSingleDetailVOList[0].faPmBomDetailVOList[0];
    const bomVO = bom.faPmBomVO;

    const colorLevel = opts.colorLevel ?? 1;       // 1=4级及以上, 2=3-4级, 3=3级, 4=3级及以下
    const colorLevelName = ['', '4级及以上', '3-4级', '3级', '3级及以下'][colorLevel];
    const isPass = opts.pass !== false;            // 默认通过

    const measureDTO = {
      materialSku: detailInfo.currentMaterialSku,
      faPmBomId: bomVO.faPmBomId,
      colorLevel,
      colorLevelName,
      bomPmState: isPass ? 2 : 8,                  // 2=自批通过, 8=自批不通过
      defectiveDescription: opts.defectiveDescription || '',
      defectiveTypeNameList: opts.defectiveTypeNameList || [],
      imageIdList: opts.imageIdList || [],
      faPmBomMaterialDto: {
        weightMeasureValue: String(opts.weight ?? ''),
        straightMeasureValue: opts.straight || '',
        horizontalMeasureValue: opts.horizontal || '',
      },
      faPmFabricMsgDTOList: [],
    };

    return {
      faPmMeasureInfoDTO: measureDTO,
      materialSku: detailInfo.currentMaterialSku,
      isSubmit: opts.isSubmit ?? 0,
      proofType: detailInfo.faPmVO.proofType,
      faPmOrderNo: detailInfo.faPmInfoVO.faPmOrderNo,
      version: detailInfo.faPmVO.version,
    };
  }

  // 取参考克重（fallback：详情里 fabricList 第一项的标准值，否则物料 API）
  async function resolveDefaultWeight(orderNo) {
    try {
      const list = await materialInfo(orderNo);
      const w = list[0]?.weightStandardValue;
      if (w) return String(w);
    } catch (e) {
      console.warn('取参考克重失败，需要手动传 weight:', e.message);
    }
    return null;
  }

  // ============================================================
  // Dry run / Save / SubmitPass
  // ============================================================
  async function dryRun(orderNo, sku, weight, opts = {}) {
    checkDomain(VOC_HOST, 'Dry run');
    const det = await detail(orderNo, sku);
    let w = weight;
    if (w == null) {
      w = await resolveDefaultWeight(orderNo);
      if (w) console.log(`📦 weight 未传，使用参考克重 ${w}`);
    }
    const body = buildBody(det, { weight: w, ...opts, isSubmit: 0 });
    console.log('🧪 DRY RUN — body 构造完成（未发送）：');
    console.log(JSON.stringify(body, null, 2));
    return body;
  }

  async function save(orderNo, sku, weight, opts = {}) {
    checkDomain(VOC_HOST, '保存批色');
    const det = await detail(orderNo, sku);
    let w = weight;
    if (w == null) w = await resolveDefaultWeight(orderNo);
    const body = buildBody(det, { weight: w, ...opts, isSubmit: 0 });
    const data = await postJSON(api('/pub/pm/order/submitOrSave'), body, {
      'voc-version': '3.31.0', 'x-lt-language': 'CN',
    });
    console.log(`💾 ${orderNo} ${sku} → 保存：`, data);
    return data;
  }

  async function submitPass(orderNo, sku, weight, opts = {}) {
    checkDomain(VOC_HOST, '提交批色');
    const det = await detail(orderNo, sku);
    let w = weight;
    if (w == null) w = await resolveDefaultWeight(orderNo);
    const body = buildBody(det, { weight: w, pass: true, ...opts, isSubmit: 1 });
    const data = await postJSON(api('/pub/pm/order/submitOrSave'), body, {
      'voc-version': '3.31.0', 'x-lt-language': 'CN',
    });
    if (data.code === 0) {
      console.log(`✅ ${orderNo} ${sku} 自批通过`);
    } else {
      console.warn(`⚠️ ${orderNo} ${sku} 提交失败：`, data);
    }
    return data;
  }

  // ============================================================
  // 批量（必须 reallySubmit:true 才真发）
  // ============================================================
  async function batchSubmit(items, opts = {}) {
    checkDomain(VOC_HOST, '批量提交');
    if (!opts.reallySubmit) {
      console.log(`🧪 DRY RUN 批量 ${items.length} 条（reallySubmit:false 不会真发）`);
    }
    const results = [];
    for (const it of items) {
      try {
        const fn = opts.reallySubmit ? submitPass : dryRun;
        const r = await fn(it.orderNo, it.sku, it.weight, it.opts || {});
        results.push({ ...it, ok: opts.reallySubmit ? (r.code === 0) : true, resp: r });
      } catch (e) {
        results.push({ ...it, ok: false, err: e.message });
        console.error(`❌ ${it.orderNo} ${it.sku}:`, e.message);
      }
      await new Promise(r => setTimeout(r, 800));
    }
    if (opts.reallySubmit) {
      const okCount = results.filter(r => r.ok).length;
      console.log(`完成：${okCount}/${results.length} 成功`);
    }
    return results;
  }

  // 安装到 window
  window.pibao = { list, detail, materialInfo, dryRun, save, submitPass, batchSubmit, buildBody };

  console.log('%c✅ 批色助手已就绪', 'color:green;font-size:14px;font-weight:bold');
  console.log('当前域：', location.host);
  console.log('可用方法：');
  if (isSSO) console.log('  pibao.list()                                       — 拉待批色列表');
  if (isVOC) {
    console.log('  pibao.detail(orderNo, sku)                         — 查详情');
    console.log('  pibao.materialInfo(orderNo)                        — 查物料(取参考克重)');
    console.log('  pibao.dryRun(orderNo, sku [, weight])              — Dry run，只打印不发');
    console.log('  pibao.save(orderNo, sku [, weight])                — 真保存（isSubmit=0 不审核）');
    console.log('  pibao.submitPass(orderNo, sku [, weight])          — 真审核通过（isSubmit=1）');
    console.log('  pibao.batchSubmit([...], { reallySubmit: true })   — 批量真审核');
  }
  if (!isSSO && !isVOC) {
    console.warn('⚠️ 当前域不是 sso.geiwohuo.com 也不是 vocpub.dotfashion.cn，所有方法都不可用');
  }
})();

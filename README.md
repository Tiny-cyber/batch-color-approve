# 唐欢批色自动化助手

替代唐欢"FOB账号批色"的 1-2 小时/天手动点击。

## 业务背景

唐欢每天的工作之一是登录希音 FOB 供应商系统（账号 夏锦棠9211），进入 **物料管理 → 批色管理**，把"待自批"列表里的几十到上百条记录一条一条点"去自批"，弹出页面里默认值是「色差 4 级及以上 + 原克重 + 审核通过」，她确认无误就提交。每天耗时 1-2 小时，零判断。

## 系统结构

整条链路跨 3 个域名：

| 步骤 | 域名 | API |
|---|---|---|
| 列表 | `sso.geiwohuo.com` | `POST /mes-app/api/materialColorCheck/colorCheckList` |
| 详情 | `vocpub.dotfashion.cn` | `POST /pub/pm/order/getPmOrderDetail` |
| 提交 | `vocpub.dotfashion.cn` | `POST /pub/pm/order/submitOrSave` |

跨域 + Cookie 鉴权，所以脚本只能在浏览器 console 里跑（不能用本地 Node 直接跑，除非把两套 cookie 都导出）。

## 使用流程

1. **登录**：浏览器登录 `https://sso.geiwohuo.com`（账号 夏锦棠9211）
2. **进入批色管理**：物料管理 → 批色管理
3. **F12 打开 console**，把 `批色助手.js` 全部粘贴进去回车
4. 在 sso 页面跑 `pibao.list()` 拉清单
5. 切到 vocpub 域（点任意一条"去自批"会跳到 `vocpub.dotfashion.cn` 标签页），把脚本再注入一次
6. 在 vocpub 页面跑 `pibao.dryRun(orderNo, sku, weight)` 验证 body
7. 没问题后跑 `pibao.submitPass(orderNo, sku, weight)` 真审核

## 安全等级（从安全到危险）

| 函数 | 行为 | 后果 |
|---|---|---|
| `pibao.list()` | 只读列表 | 完全安全 |
| `pibao.detail(orderNo, sku)` | 只读详情 | 完全安全 |
| `pibao.dryRun(...)` | 构造 body 不发送 | 完全安全 |
| `pibao.save(...)` | 保存草稿 isSubmit=0 | 不进入审核流程，可被覆盖 |
| `pibao.submitPass(...)` | **真审核** isSubmit=1 | 该条记录从待批列表消失，进入"已自批" |
| `pibao.batchSubmit([...], {reallySubmit:true})` | 批量真审核 | 同上，但批量 |

**第一次真跑前先 dry run 看一遍 body**，确认无误再 submitPass 一条。

## 关键字段映射

```js
// 提交 body（PUB 单 DTO 格式，不是 List）
{
  faPmMeasureInfoDTO: {
    materialSku: "M01154021",          // 物料 SKU
    faPmBomId: "7000000000034943372",  // BOM ID（详情接口给）
    colorLevel: 1,                      // 1=4级及以上, 2=3-4级, 3=3级, 4=3级及以下
    colorLevelName: "4级及以上",
    bomPmState: 2,                      // 2=自批通过, 8=自批不通过
    defectiveDescription: "",           // 不通过时必填
    defectiveTypeNameList: [],          // 不通过时必填
    imageIdList: [],                    // 不通过时必填（疵点图）
    faPmBomMaterialDto: {
      weightMeasureValue: "220.00",     // 克重实测值（必填）
      straightMeasureValue: "",         // 直弹实测值（选填）
      horizontalMeasureValue: ""        // 横弹实测值（选填）
    },
    faPmFabricMsgDTOList: []
  },
  materialSku: "M01154021",
  isSubmit: 1,                          // 0=保存, 1=提交并审核
  proofType: 1,                          // 详情给
  faPmOrderNo: "MLSH-29080437-001",
  version: 1                             // 详情给（乐观锁）
}
```

## 状态枚举

```js
G = {
  PASS: 5,           // 内部审核通过
  BACK: 7,           // 让步接收
  FINAL: 4,          // 内部审核不通过
  NOT_RECEIVE: 6,    // 我没收到
  SELF_PASS: 2,      // 自批通过 ← 唐欢工作填这个
  SELF_FINAL: 8,     // 自批不通过
}

UW = {            // supplierPmType
  YES: 1,            // 自批 ← 唐欢的订单都是这个
  NO: 2,             // 非自批
  SELF: 3,           // 自批稽查
}

colorLevel = {
  1: "4级及以上",     // 默认/合格
  2: "3-4级",
  3: "3级",
  4: "3级及以下",
}

弹性 (straight/horizontal) = "无弹" | "低弹" | "中弹" | "高弹"
```

## 克重容差规则

`POST /material/weigh/conf/getMatchWeigh` 返回每个面料类的 ±% 偏差线。常规规则是 ±5%（克重要求±5%，例：要求100克 → 95-105 可接受）。提交前要不要做客户端校验：先不做，让 SHEIN 服务端校验，避免脚本判断逻辑跟服务端不一致。

## 待解决

1. **克重实测值从哪来？** 共享表（kdocs cguCGuy5FRVS）里有"克重(g/m²)"列，但 4-25 那批是空的。SHEIN 详情接口里 `weightMeasureValue` 也是空。猜测工厂会另传一份给 SHEIN（或上传图片要 SHEIN 这边人工读图填值）。**这一步暂未自动化**——脚本要求调用方传入 weight 参数。
2. **共享表写回**：脚本目前不操作 kdocs。提交完 SHEIN 后，唐欢仍需手动到共享表把"批色结果"改成"已批色"。kdocs 写回需要单独搞 OAuth 或者 wps-sdk。
3. **跨域调用**：list 和 submit 在不同域，所以脚本必须在两个页面分别注入。后续可考虑写浏览器扩展或本地 Node 脚本（导出双份 cookie）。

## 文件清单

- `批色助手.js` — 浏览器 console 注入脚本
- `README.md` — 本文档

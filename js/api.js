// ============================================================
// A股基本面分析 — 数据层
// 全部浏览器端直接调用公开接口，无后端代理，无 Key。
// 已实测（2026-11-09，curl + Origin 头）：
//   东财 push2 行情 / push2his K线 / datacenter 财报 / 腾讯 qt / 腾讯 smartbox
// 两个已修正的实测结论：
//   ① push2delay 的价格字段单位是“元”（f43=1443.73），不是 ×100；代码里有 >5000 自动除 100 的防御。
//   ② push2his K 线在部分出口 IP 上持续返回 rc=102，本文件已接腾讯 fqkline 作自动备用源。
// 东财搜索接口 search-api-web 两条路径均返回 404，弃用，改用腾讯 smartbox（JSONP）。
// ============================================================

// ---------- 市场代码 ----------
function emMarket(code) {
  // 东财 secid 市场码：1=上交所（5/6/9开头，5 为上交所 ETF 如 515220），0=深交所（0/2/3开头），2=北交所（8/4开头）
  // 2026-11-09 实测修正：5 开头此前误判为深市，导致煤炭ETF 515220 行情/K线取不到数；
  // secid=1.515220 实测返回 f43=1.208（与腾讯 sh515220 一致），0.515220 无数据。
  if (code === "000300") return 1; // 沪深300 指数在沪市
  if (/^[569]/.test(code)) return 1;
  if (/^[84]/.test(code)) return 2;
  return 0;
}
function txMarket(code) {
  if (code === "000300") return "sh"; // 沪深300 指数在沪市，通用映射会误判为深市（sz000300 无数据）
  if (/^[569]/.test(code)) return "sh";
  if (/^[84]/.test(code)) return "bj";
  return "sz";
}
function secid(code) { return emMarket(code) + "." + code; }
// F10 表用的 SECUCODE 是“代码.市场后缀”格式（600519.SH / 000001.SZ / 430001.BJ），
// 与 push2 的 secid（1.600519）正好相反，不要混用。
function secucode(code) {
  const m = emMarket(code);
  return code + "." + (m === 1 ? "SH" : m === 0 ? "SZ" : "BJ");
}
function txSymbol(code) { return txMarket(code) + code; }

// ---------- 通用 fetch（带 Referer/Origin，提高东财成功率）----------
async function emFetch(url) {
  const r = await fetch(url, {
    headers: {
      "Referer": "https://quote.eastmoney.com/",
      "Origin": "https://quote.eastmoney.com",
    },
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  if (j && typeof j.rc === "number" && j.rc !== 0) throw new Error("东财返回 rc=" + j.rc);
  return j;
}

// ---------- 1. 搜索（腾讯 smartbox，JSONP：无 CORS，用 <script> 加载）----------
// 返回 [{code, name, market}]，只保留 A 股（sh/sz/bj），过滤港股/美股。
function searchStocks(keyword) {
  return new Promise((resolve) => {
    if (!keyword || !keyword.trim()) return resolve([]);
    const cb = "sb_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
    const script = document.createElement("script");
    const timer = setTimeout(() => { cleanup(); resolve([]); }, 8000);
    function cleanup() {
      clearTimeout(timer);
      delete window[cb];
      script.remove();
    }
    window[cb] = () => {
      // smartbox 返回的是 v_hint="..." 全局变量，不是回调；用全局变量读
      cleanup();
      const raw = window.v_hint || "";
      const out = [];
      for (const part of raw.split("^")) {
        const seg = part.split("~");
        if (seg.length < 3) continue;
        const mkt = seg[0], code = seg[1], name = seg[2];
        if (!/^(sh|sz|bj)$/.test(mkt)) continue;      // 只留 A 股
        if (!/^\d{6}$/.test(code)) continue;
        out.push({ code, name, market: mkt });
      }
      resolve(out.slice(0, 10));
    };
    script.onerror = () => { cleanup(); resolve([]); };
    // 用 onload 触发读取 v_hint（script 标签加载即执行赋值）
    script.onload = window[cb];
    script.src = API.TX_SUGGEST + encodeURIComponent(keyword.trim());
    document.head.appendChild(script);
  });
}

// ---------- 2. 东财实时行情（现价/OHLC/量额/市值/行业/概念/股息率）----------
// push2 会 302 跳到 push2delay；push2delay 的价格/金额字段单位是“元”，不是 ×100
// （2026-11-09 实测：f43=1443.73、f60=1453.00、f116=1.80万亿，均与现价一致）。
// 防御性处理：若某天返回 ×100 口径（f43 > 5000，A 股现价从未超过 5000 元），自动除以 100。
// f62 不是涨跌幅，涨跌幅用现价/昨收自算。f47 量（手），f48 额（元）。
function normPrice(v) { return v > 5000 ? v / 100 : v; }
async function fetchEmQuote(code) {
  const fields = [
    "f43", "f44", "f45", "f46", "f47", "f48",   // 现价/最高/最低/今开/量/额
    "f57", "f58", "f60", "f62", "f71",          // 代码/名称/昨收/（f62 备用）/f71 备用价
    "f84", "f85", "f116", "f117", "f126",       // 总股本/流通股本/总市值/流通市值/股息率
    "f127", "f128", "f129",                     // 行业/地域/概念
  ].join(",");
  const url = API.EM_QUOTE + "?secid=" + secid(code) + "&fields=" + fields
    + "&ut=bd1d9ddb04089700cf9c27f6f742628&fltt=2&invt=2";
  const j = await emFetch(url);
  const d = j.data;
  if (!d) throw new Error("东财行情无数据：" + code);
  const price = normPrice(d.f43), prev = normPrice(d.f60);
  return {
    code: d.f57, name: d.f58,
    price, prevClose: prev,
    open: normPrice(d.f46), high: normPrice(d.f44), low: normPrice(d.f45),
    volume: d.f47, amount: d.f48,
    changePct: prev ? (price - prev) / prev * 100 : 0,
    totalShares: d.f84, floatShares: d.f85,
    totalMcap: d.f116, floatMcap: d.f117,   // 元
    divYield: d.f126,                       // %，东财口径
    industry: d.f127, region: d.f128, concepts: d.f129,
  };
}

// ---------- 3. 腾讯行情（PE-TTM / PB / 换手 / 振幅 / 涨跌停；批量）----------
// qt.gtimg.cn 返回 GBK 编码、~ 分隔。关键下标（经 a-stock-data 技能与实测确认）：
// [1]=名称 [3]=现价 [4]=昨收 [5]=今开 [31]=涨跌额 [32]=涨跌幅% [33]=最高 [34]=最低
// [36]=量（手） [37]=成交额（万） [38]=换手率% [39]=PE-TTM [43]=振幅% [44]=总市值（亿）
// [45]=流通市值（亿） [46]=PB [47]=涨停价 [48]=跌停价 [49]=量比 [52]=PE静态 [65]=ROE
async function fetchTxQuotes(codes) {
  if (!codes.length) return {};
  const q = codes.map(txSymbol).join(",");
  const r = await fetch(API.TX_QUOTE + q, { headers: { "Referer": "https://gu.qq.com/" } });
  if (!r.ok) throw new Error("腾讯行情 HTTP " + r.status);
  const buf = await r.arrayBuffer();
  const text = new TextDecoder("gbk").decode(buf);
  const out = {};
  for (const m of text.matchAll(/v_(\w+?)="([^"]*)"/g)) {
    const sym = m[1].replace(/^s[hz]/, "").replace(/^bj/, "");
    const v = m[2].split("~");
    if (v.length < 40) continue;
    out[sym] = {
      name: v[1],
      price: parseFloat(v[3]) || 0,
      prevClose: parseFloat(v[4]) || 0,
      open: parseFloat(v[5]) || 0,
      changeAmt: parseFloat(v[31]) || 0,
      changePct: parseFloat(v[32]) || 0,
      high: parseFloat(v[33]) || 0,
      low: parseFloat(v[34]) || 0,
      volume: parseFloat(v[36]) || 0,       // 手
      amountWan: parseFloat(v[37]) || 0,    // 万元
      turnover: parseFloat(v[38]) || 0,     // 换手率 %
      peTtm: parseFloat(v[39]) || 0,
      amplitude: parseFloat(v[43]) || 0,
      totalMcapYi: parseFloat(v[44]) || 0,  // 亿元
      floatMcapYi: parseFloat(v[45]) || 0,
      pb: parseFloat(v[46]) || 0,
      limitUp: parseFloat(v[47]) || 0,
      limitDown: parseFloat(v[48]) || 0,
      volRatio: parseFloat(v[49]) || 0,
      peStatic: parseFloat(v[52]) || 0,
      roe: parseFloat(v[65]) || 0,
    };
  }
  return out;
}

// ---------- 4. K 线（日/周/月，前复权）----------
// 主源：东财 push2his（klt 101/102/103，等比前复权，含成交额/换手）。
// 注意：push2his 在部分出口 IP 上会持续返回 rc=102（2026-11-09 实测），
// 此时自动降级到腾讯 fqkline（qfq，等差口径：逐次减去累计分红；
// 近 2 年窗口的失真很小，高分红股早期价格会被压低，图表会注明来源）。
// 返回的数组带一个 .source 属性（"eastmoney" / "tencent"），两源都失败时抛错。
// klines 每行（东财）：日期,开,收,高,低,量,额,振幅,涨跌幅,涨跌额,换手率
// 腾讯每行：[日期,开,收,高,低,量]，无成交额/振幅/换手，涨跌幅由收盘价自算。
async function fetchKlineEM(code, klt, limit, secidOverride) {
  const url = API.EM_KLINE + "?secid=" + (secidOverride || secid(code))
    + "&klt=" + klt + "&fqt=1&lmt=" + limit
    + "&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"
    + "&ut=bd1d9ddb04089700cf9c27f6f742628&fltt=2&invt=2";
  const j = await emFetch(url);
  const kl = (j.data && j.data.klines) || [];
  if (!kl.length) throw new Error("东财 K 线无数据（rc=" + j.rc + "）");
  const rows = kl.map((line) => {
    const p = line.split(",");
    return {
      date: p[0], open: +p[1], close: +p[2], high: +p[3], low: +p[4],
      volume: +p[5], amount: +p[6], amplitude: +p[7],
      changePct: +p[8], changeAmt: +p[9], turnover: +p[10],
    };
  });
  rows.source = "eastmoney";
  return rows;
}
async function fetchKlineTX(code, klt, limit, symbolOverride) {
  const period = klt === 102 ? "week" : klt === 103 ? "month" : "day";
  const symbol = symbolOverride || txSymbol(code);
  const param = symbol + "," + period + ",,," + Math.min(limit, 640) + ",qfq";
  let lastErr = null;
  for (const base of API.TX_KLINE_HOSTS) {
    try {
      const r = await fetch(base + "?param=" + encodeURIComponent(param), {
        headers: { "Referer": "https://gu.qq.com/" },
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      if (j.code !== 0) throw new Error("腾讯 K 线 code=" + j.code);
      const node = (j.data || {})[symbol] || {};
      const items = node["qfq" + period] || node[period] || [];
      if (!items.length) throw new Error("腾讯 K 线无数据");
      const rows = items.map((it, i, arr) => {
        const prevClose = i > 0 ? parseFloat(arr[i - 1][2]) : null;
        const close = parseFloat(it[2]);
        return {
          date: String(it[0]).slice(0, 10),
          open: parseFloat(it[1]), close, high: parseFloat(it[3]), low: parseFloat(it[4]),
          volume: parseFloat(it[5]), amount: null, amplitude: null,
          changePct: prevClose ? (close - prevClose) / prevClose * 100 : 0,
          changeAmt: prevClose ? close - prevClose : 0, turnover: null,
        };
      });
      rows.source = "tencent";
      return rows;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("腾讯 K 线不可用");
}
async function fetchKline(code, klt = 101, limit = 500, override) {
  try {
    return await fetchKlineEM(code, klt, limit, override && override.secid);
  } catch (e) {
    // 东财失败（常见 rc=102 限流）→ 腾讯备用源
    return await fetchKlineTX(code, klt, limit, override && override.symbol);
  }
}

// ---------- 5. 东财数据中心（通用）----------
// reportName + columns + filter + sort。columns 写错会报 9501“返回字段不存在”。
async function emDatacenter(reportName, columns, filter, opts = {}) {
  const params = new URLSearchParams({
    reportName, columns,
    filter: filter || "",
    pageNumber: String(opts.pageNumber || 1),
    pageSize: String(opts.pageSize || 20),
    sortColumns: opts.sortColumns || "",
    sortTypes: opts.sortTypes || "",
  });
  // 部分 F10 表（如 RPT_F10_FN_MAINOP）只在 source=F10&client=PC 下有配置
  if (opts.source) params.set("source", opts.source);
  if (opts.client) params.set("client", opts.client);
  const r = await fetch(API.EM_DATACENTER + "?" + params.toString(), {
    headers: { "Referer": "https://data.eastmoney.com/", "Origin": "https://data.eastmoney.com" },
  });
  if (!r.ok) throw new Error("数据中心 HTTP " + r.status);
  const j = await r.json();
  if (!j.success) throw new Error("数据中心：" + (j.message || "未知错误"));
  return (j.result && j.result.data) || [];
}

// 利润表（LICO 口径）：REPORTDATE（无下划线）、TOTAL_OPERATE_INCOME（营业总收入）、
// PARENT_NETPROFIT（归母净利润）、BASIC_EPS、DEDUCT_BASIC_EPS（扣非 EPS）、
// BPS（每股净资产）、WEIGHTAVG_ROE（加权 ROE，%）、MGJYXJJE（每股经营现金流）。
// 季度行是年内累计值。注意：LICO 口径没有营业成本/毛利/营业利润，见 fetchIncomeFull。
function fetchIncome(code, pageSize = 60) {
  return emDatacenter(
    "RPT_LICO_FN_CPD",
    "SECURITY_CODE,SECURITY_NAME_ABBR,REPORTDATE,TOTAL_OPERATE_INCOME,PARENT_NETPROFIT,BASIC_EPS,DEDUCT_BASIC_EPS,BPS,WEIGHTAVG_ROE,MGJYXJJE",
    '(SECURITY_CODE="' + code + '")',
    { pageSize, sortColumns: "REPORTDATE", sortTypes: "-1" }
  );
}
// 利润表（DMSK 全口径）：OPERATE_COST（营业成本）、OPERATE_PROFIT（营业利润）、
// TOTAL_PROFIT（利润总额）、DEDUCT_PARENT_NETPROFIT（扣非归母净利润）、
// FINANCE_EXPENSE（财务费用，负值=净利息收入）、SALE_EXPENSE、MANAGE_EXPENSE、
// INVEST_INCOME（投资收益）、INCOME_TAX（所得税）。用于毛利率/EBIT/费用结构。
function fetchIncomeFull(code, pageSize = 60) {
  return emDatacenter(
    "RPT_DMSK_FN_INCOME",
    "SECURITY_CODE,REPORT_DATE,TOTAL_OPERATE_INCOME,OPERATE_COST,OPERATE_PROFIT,TOTAL_PROFIT,PARENT_NETPROFIT,DEDUCT_PARENT_NETPROFIT,FINANCE_EXPENSE,SALE_EXPENSE,MANAGE_EXPENSE,INVEST_INCOME,INCOME_TAX",
    '(SECURITY_CODE="' + code + '")',
    { pageSize, sortColumns: "REPORT_DATE", sortTypes: "-1" }
  );
}
// 资产负债表：REPORT_DATE（有下划线）、TOTAL_ASSETS、TOTAL_LIABILITIES、
// TOTAL_EQUITY、MONETARYFUNDS（货币资金）、INVENTORY（存货）、
// CURRENT_RATIO（流动比率，接口返回的是百分比，需 ÷100）、DEBT_ASSET_RATIO（资产负债率，%）、
// SHORT_LOAN（短期借款）、ACCOUNTS_RECE（应收账款）、ACCOUNTS_PAYABLE（应付账款）、FIXED_ASSET（固定资产）、
// ADVANCE_RECEIVABLES（预收款项，2020 年后约等于合同负债，CbOP 应计用；2026-11-09 实测 DMSK 表含此字段）
function fetchBalance(code, pageSize = 60) {
  return emDatacenter(
    "RPT_DMSK_FN_BALANCE",
    "SECURITY_CODE,REPORT_DATE,TOTAL_ASSETS,TOTAL_LIABILITIES,TOTAL_EQUITY,MONETARYFUNDS,INVENTORY,CURRENT_RATIO,DEBT_ASSET_RATIO,SHORT_LOAN,ACCOUNTS_RECE,ACCOUNTS_PAYABLE,FIXED_ASSET,ADVANCE_RECEIVABLES",
    '(SECURITY_CODE="' + code + '")',
    { pageSize, sortColumns: "REPORT_DATE", sortTypes: "-1" }
  );
}
// 现金流量表：REPORT_DATE、NETCASH_OPERATE（经营）、NETCASH_INVEST（投资）、NETCASH_FINANCE（筹资）、
// CONSTRUCT_LONG_ASSET（购建长期资产支付的现金 = CAPEX）
function fetchCashflow(code, pageSize = 60) {
  return emDatacenter(
    "RPT_DMSK_FN_CASHFLOW",
    "SECURITY_CODE,REPORT_DATE,NETCASH_OPERATE,NETCASH_INVEST,NETCASH_FINANCE,CONSTRUCT_LONG_ASSET",
    '(SECURITY_CODE="' + code + '")',
    { pageSize, sortColumns: "REPORT_DATE", sortTypes: "-1" }
  );
}
// 分红历史：PRETAX_BONUS_RMB 是“每 10 股派息（元，税前）”，IMPL_PLAN_PROFILE 是文字方案
// （如“10派280.2423元(含税)”）。TRANSFER_RATIO 字段不存在，不要用。
function fetchDividends(code, pageSize = 30) {
  return emDatacenter(
    "RPT_SHAREBONUS_DET",
    "SECURITY_CODE,EX_DIVIDEND_DATE,PRETAX_BONUS_RMB,BONUS_RATIO,IT_RATIO,IMPL_PLAN_PROFILE,ASSIGN_PROGRESS",
    '(SECURITY_CODE="' + code + '")',
    { pageSize, sortColumns: "EX_DIVIDEND_DATE", sortTypes: "-1" }
  );
}
// 财报预约披露日历：FIRST_APPOINT_DATE 首次预约，ACTUAL_PUBLISH_DATE 实际发布，
// REPORT_TYPE_NAME 如“2026年 三季报”，IS_PUBLISH 1=已发布，RESIDUAL_DAYS 剩余天数
function fetchCalendar(code, pageSize = 12) {
  return emDatacenter(
    "RPT_PUBLIC_BS_APPOIN",
    "SECURITY_CODE,SECURITY_NAME_ABBR,REPORT_YEAR,REPORT_TYPE,REPORT_TYPE_NAME,FIRST_APPOINT_DATE,ACTUAL_PUBLISH_DATE,IS_PUBLISH,RESIDUAL_DAYS",
    '(SECURITY_CODE="' + code + '")',
    { pageSize, sortColumns: "FIRST_APPOINT_DATE", sortTypes: "-1" }
  );
}
// 全市场近期待披露（日历页用）：只取未发布、按预约日升序
function fetchUpcomingCalendar(pageSize = 30) {
  return emDatacenter(
    "RPT_PUBLIC_BS_APPOIN",
    "SECURITY_CODE,SECURITY_NAME_ABBR,REPORT_YEAR,REPORT_TYPE,REPORT_TYPE_NAME,FIRST_APPOINT_DATE,ACTUAL_PUBLISH_DATE,IS_PUBLISH,RESIDUAL_DAYS",
    '(IS_PUBLISH="0")',
    { pageSize, sortColumns: "FIRST_APPOINT_DATE", sortTypes: "1" }
  );
}
// 业绩预告：PREDICT_FINANCE 预测指标，ADD_AMP_LOWER/UPPER 增长幅度下限/上限，
// PREDICT_AMT_LOWER/UPPER 预测金额，PREDICT_TYPE 如“预增”，PREDICT_CONTENT 原文
function fetchForecast(code, pageSize = 6) {
  return emDatacenter(
    "RPT_PUBLIC_OP_NEWPREDICT",
    "SECURITY_CODE,NOTICE_DATE,REPORT_DATE,PREDICT_FINANCE,PREDICT_AMT_LOWER,PREDICT_AMT_UPPER,ADD_AMP_LOWER,ADD_AMP_UPPER,PREDICT_TYPE,PREDICT_CONTENT",
    '(SECURITY_CODE="' + code + '")',
    { pageSize, sortColumns: "NOTICE_DATE", sortTypes: "-1" }
  );
}

// ---------- 5b. 公司简介（东财 F10）----------
// RPT_F10_BASIC_ORGINFO，columns=ALL 实测（2026-11-09，茅台）：
// 除 ORG_PROFILE 外还返回 LISTING_DATE（上市日期）、FOUND_DATE（成立日期）、
// MAIN_BUSINESS（主营业务）、BUSINESS_SCOPE（经营范围）、EMP_NUM（员工数）、
// CHAIRMAN（董事长）、PRESIDENT（总经理）、LEGAL_PERSON（法人）、SECRETARY（董秘）、
// ACTUAL_HOLDER（实际控制人）、REG_CAPITAL（注册资本）、ORG_TEL/ORG_EMAIL/ORG_WEB、
// ADDRESS、INDUSTRYCSRC1（证监会行业）、BOARD_NAME_LEVEL（东财三级行业）。
// ETF（如 515220）无此表记录，返回 []，调用方按无简介处理，不要当错误抛。
async function fetchCompanyProfile(code) {
  const rows = await emDatacenter(
    "RPT_F10_BASIC_ORGINFO",
    "ALL",
    '(SECURITY_CODE="' + code + '")',
    { pageSize: 1 }
  );
  return (rows && rows[0]) || null;
}

// ---------- 5c. 主营业务构成（东财 F10）----------
// RPT_F10_FN_MAINOP，2026-11-09 实测（茅台，source=F10&client=PC）：
// 字段名注意：日期是 REPORT_DATE（带下划线）、构成名是 ITEM_NAME（不是 MAINOP_NAME）；
// MAINOP_TYPE：1=按行业（如“酒类”）、2=按产品（茅台酒 MBI_RATIO 0.8622、系列酒 0.1372）、
// 3=按地区（国内 0.9869、国外 0.0125）。另有 GROSS_RPOFIT_RATIO（毛利率）、MAIN_BUSINESS_COST。
// filter 必须用 SECUCODE="600519.SH"（带市场后缀）。最新报告期一行一组。
async function fetchMainop(code) {
  const rows = await emDatacenter(
    "RPT_F10_FN_MAINOP",
    "SECUCODE,SECURITY_CODE,REPORT_DATE,MAINOP_TYPE,ITEM_NAME,MAIN_BUSINESS_INCOME,MBI_RATIO,MAIN_BUSINESS_COST,MAIN_BUSINESS_RPOFIT,MBR_RATIO,GROSS_RPOFIT_RATIO",
    '(SECUCODE="' + secucode(code) + '")',
    { pageSize: 40, sortColumns: "REPORT_DATE", sortTypes: "-1", source: "F10", client: "PC" }
  );
  return rows || [];
}

// ---------- 6. 市场异动（涨幅榜前 N）----------
// push2 clist，fid=f3 按涨跌幅降序。偶发 502，调用方重试一次。
async function fetchMovers(limit = 12) {
  const url = API.EM_CLIST
    + "?fid=f3&po=1&pz=" + limit + "&pn=1&np=1&fltt=2&invt=2"
    + "&fs=m:1+t:2,m:1+t:23,m:0+t:6,m:0+t:80"
    + "&fields=f12,f13,f14,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13,f14,f15,f16,f17,f18,f19,f20,f21,f22,f23"
    + "&ut=bd1d9ddb04089700cf9c27f6f742628";
  const j = await emFetch(url);
  const diff = (j.data && j.data.diff) || [];
  return diff.map((it) => ({
    code: it.f12, name: it.f14,
    price: it.f2, changePct: it.f3,
  }));
}

// ---------- 7. 行业 / 概念板块（热力图用）----------
// push2 clist fs=m:90+t:2（行业，2026-11-09 实测 496 个）/ m:90+t:3（概念，531 个）
// f12=板块代码（BKxxxx），f14=名称，f2=最新价，f3=涨跌幅%，f8=换手率%，f20=总市值
async function fetchBoards(kind = "industry", limit = 500) {
  const fs = kind === "concept" ? "m:90+t:3" : "m:90+t:2";
  const url = API.EM_CLIST
    + "?fid=f3&po=1&pz=" + limit + "&pn=1&np=1&fltt=2&invt=2"
    + "&fs=" + fs
    + "&fields=f12,f14,f2,f3,f8,f20"
    + "&ut=bd1d9ddb04089700cf9c27f6f742628";
  const j = await emFetch(url);
  const diff = (j.data && j.data.diff) || [];
  return diff.map((it) => ({
    code: it.f12, name: it.f14,
    price: it.f2, changePct: it.f3, turnover: it.f8, totalMcap: it.f20,
  }));
}

// ---------- 8. 全市场扫描（低估雷达用）----------
// push2 clist 全市场（2026-11-09 实测 5563 只），fid=f9 按 PE 升序
// f9=PE（静态，实测与腾讯[52]一致，不是 PE-TTM）、f23=PB、f20=总市值、f21=流通市值、f8=换手率%
// clist 无 ROE、无股息率（f126 在 clist 里恒为 0，f129 口径未确认勿用）；ROE 需腾讯 qt 批量补。
async function fetchMarketScan(limit = 200) {
  const url = API.EM_CLIST
    + "?fid=f9&po=1&pz=" + limit + "&pn=1&np=1&fltt=2&invt=2"
    + "&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23"
    + "&fields=f12,f14,f2,f3,f8,f9,f20,f21,f23"
    + "&ut=bd1d9ddb04089700cf9c27f6f742628";
  const j = await emFetch(url);
  const diff = (j.data && j.data.diff) || [];
  return diff.map((it) => ({
    code: it.f12, name: it.f14,
    price: it.f2, changePct: it.f3, turnover: it.f8,
    pe: it.f9, pb: it.f23, totalMcap: it.f20, floatMcap: it.f21,
  }));
}

// ---------- 9. 沪深300 成分股（目标价用）----------
// 2026-11-09 实测：push2 clist fs=b:MK000300 在本机出口持续 rc=102（疑似该 fs 无效），
// 正确来源是 datacenter RPT_INDEX_CONSTITUENT（source=HSF10&client=WEB）：
// filter=(INDEX_CODE="000300")，pageSize=300，一次返回 300 只不重复（TRADE_DATE 是纳入日期）。
// 该表只有代码/名称，无 PE/市值——PE 与市值由调用方用腾讯 qt 分批补（见 renderHs300）。
async function fetchHs300Constituents() {
  const rows = await emDatacenter(
    "RPT_INDEX_CONSTITUENT",
    "SECURITY_CODE,SECURITY_NAME_ABBR,TRADE_DATE,SECUCODE",
    '(INDEX_CODE="000300")',
    { pageSize: 300, sortColumns: "TRADE_DATE", sortTypes: "-1", source: "HSF10", client: "WEB" }
  );
  const seen = new Set();
  const out = [];
  for (const r of rows || []) {
    const code = r.SECURITY_CODE;
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push({ code, name: r.SECURITY_NAME_ABBR });
  }
  return out;
}
// ---------- 9b. 指数成分股（通用，热力图用）----------
// RPT_INDEX_CONSTITUENT（source=HSF10&client=WEB），2026-11-09 实测 6 个指数均可用：
//   000300 沪深300=300 只、000001 上证指数≈2255 只、399001 深证成指=500 只、
//   399006 创业板指=100 只、000688 科创50=50 只、000905 中证500=500 只。
// 注意：表里同一代码可能多行（不同纳入日期），按代码去重；成分只有代码/名称，无市值。
// 勿用 clist fs=b:MKxxxx：000300 在本机出口持续 rc=102。
async function fetchIndexConstituents(indexCode) {
  const out = [];
  const seen = new Set();
  for (let page = 1; page <= 8; page++) {
    let rows;
    try {
      rows = await emDatacenter(
        "RPT_INDEX_CONSTITUENT",
        "SECURITY_CODE,SECURITY_NAME_ABBR,TRADE_DATE,SECUCODE",
        '(INDEX_CODE="' + indexCode + '")',
        { pageNumber: page, pageSize: 500, sortColumns: "TRADE_DATE", sortTypes: "-1", source: "HSF10", client: "WEB" }
      );
    } catch (e) {
      // 成分总数恰为 pageSize 整数倍时（如深证成指/中证500 各 500 只），翻到空页会报
      // success=false“返回数据为空”（code 9201），视为已取完；第 1 页失败才是真错误。
      if (page > 1 && /返回数据为空/.test(String(e.message || e))) break;
      throw e;
    }
    for (const r of rows || []) {
      const code = r.SECURITY_CODE;
      if (!code || seen.has(code)) continue;
      seen.add(code);
      out.push({ code, name: r.SECURITY_NAME_ABBR });
    }
    if (!rows || rows.length < 500) break;
  }
  return out;
}

// ---------- 9c. 东财批量行情（热力图用）----------
// push2 ulist.np/get（会 302 跳到 push2delay），secids 逗号分隔（1.600519=沪市，0.000001=深市）。
// 2026-11-09 茅台实测（与腾讯前复权日K对照，收盘 1444.99）：
//   f3 当日涨跌幅 -0.55（对照 -0.55 ✓）；f109 5日涨跌幅 0.41（对照 0.41 ✓）；
//   f110 20日涨跌幅 12.19（对照 12.19 ✓）；f24 60日涨跌幅 10.37（对照 10.37 ✓）；
//   f160 年初至今 7.04（qfq 对照 7.10，差 0.06pp 为分红复权口径差 ✓）。
//   f100 申万二级行业名（如“白酒Ⅱ”）；f20 总市值（元）；f21 流通市值（元）；
//   f124 单只行情更新时间戳（秒；实测盘后不变，茅台 16:11:40、沪指 15:34:36）。
// 分批拉：每批 ≤250 只（URL 过长会被截断），调用方用 fetchEmQuotesChunked。
// 热力图批量拉数：VM 出口代理偶发 502/空回复，单次请求失败重试一次（间隔 1.5s）
async function fetchWithRetry(fn) {
  try { return await fn(); }
  catch (e) { await new Promise((r) => setTimeout(r, 1500)); return await fn(); }
}
async function fetchEmQuotesBatch(secids) {
  const url = API.EM_ULIST + "?secids=" + secids.join(",")
    + "&fields=f2,f3,f12,f14,f20,f21,f24,f100,f109,f110,f124,f160"
    + "&fltt=2&invt=2&ut=bd1d9ddb04089700cf9c27f6f742628";
  const j = await fetchWithRetry(() => emFetch(url));
  const diff = (j.data && j.data.diff) || [];
  const out = {};
  for (const it of diff) {
    if (!it.f12) continue;
    out[it.f12] = {
      code: it.f12, name: it.f14, price: it.f2,
      changePct: it.f3, chg5d: it.f109, chg20d: it.f110, chg60d: it.f24, chgYtd: it.f160,
      totalMcap: it.f20, floatMcap: it.f21,
      industry: it.f100 || "未分类",
      updatedAt: it.f124,
    };
  }
  return out;
}
async function fetchEmQuotesChunked(codes, chunkSize = 250) {
  const out = {};
  for (let i = 0; i < codes.length; i += chunkSize) {
    const part = codes.slice(i, i + chunkSize);
    Object.assign(out, await fetchEmQuotesBatch(part.map((c) => secid(c))));
  }
  return out;
}
// 腾讯 qt 分批（每批 100 只），合并返回 {code: quote}
async function fetchTxQuotesChunked(codes, chunkSize = 100) {
  const out = {};
  for (let i = 0; i < codes.length; i += chunkSize) {
    const part = await fetchTxQuotes(codes.slice(i, i + chunkSize));
    Object.assign(out, part);
  }
  return out;
}

// ---------- 10. 沪深300 长 K 线（年度回报用）----------
// 东财 push2his lmt=4000（约 16 年日线）；失败则降级腾讯按 2 年分段拉（2010 年至今）。
// 腾讯 fqkline 支持起止日期：param=sh000300,day,2010-01-04,2011-12-30,640,qfq（2026-11-09 实测每段约 480 行）。
async function fetchKlineTXRange(symbol, period, startDate, endDate) {
  const param = symbol + "," + period + "," + startDate + "," + endDate + ",640,qfq";
  let lastErr = null;
  for (const base of API.TX_KLINE_HOSTS) {
    try {
      const r = await fetch(base + "?param=" + encodeURIComponent(param), {
        headers: { "Referer": "https://gu.qq.com/" },
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      if (j.code !== 0) throw new Error("腾讯 K 线 code=" + j.code);
      const node = (j.data || {})[symbol] || {};
      const items = node["qfq" + period] || node[period] || [];
      if (!items.length) throw new Error("腾讯 K 线无数据");
      const rows = items.map((it, i, arr) => {
        const prevClose = i > 0 ? parseFloat(arr[i - 1][2]) : null;
        const close = parseFloat(it[2]);
        return {
          date: String(it[0]).slice(0, 10),
          open: parseFloat(it[1]), close, high: parseFloat(it[3]), low: parseFloat(it[4]),
          volume: parseFloat(it[5]), amount: null, amplitude: null,
          changePct: prevClose ? (close - prevClose) / prevClose * 100 : 0,
          changeAmt: prevClose ? close - prevClose : 0, turnover: null,
        };
      });
      rows.source = "tencent-range";
      return rows;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("腾讯 K 线不可用");
}
async function fetchHs300LongKline() {
  // 注意：不能走 fetchKline（它在东财失败时会自动降级腾讯 640 根，约 2.5 年，catch 永远触发不了）；
  // 这里直接调 fetchKlineEM，失败才进腾讯分段拉取。
  try {
    return await fetchKlineEM(API.HS300_CODE, 101, 4000, "1.000300");
  } catch (e) {
    const segs = [];
    const endY = new Date().getFullYear();
    for (let y = 2010; y <= endY; y += 2) {
      const s = y + "-01-01", en = Math.min(y + 1, endY) + "-12-31";
      try {
        const rows = await fetchKlineTXRange("sh000300", "day", s, en);
        segs.push(...rows);
      } catch (e2) { /* 单段失败跳过 */ }
    }
    if (!segs.length) throw e;
    const seen = new Set();
    const out = [];
    for (const r of segs.sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
      if (!seen.has(r.date)) { seen.add(r.date); out.push(r); }
    }
    out.source = "tencent-range";
    return out;
  }
}

// ---------- 11. 板块指数 K 线（行业历史用）----------
// 板块 secid = 90.BKxxxx（2026-11-09 实测：90.BK0429 行情 rc=0，名称“交运设备”）。
// push2his 偶发 rc=102，调用方应重试 2 次。
async function fetchBoardKline(boardCode, klt = 101, limit = 250) {
  const secidOverride = "90." + boardCode;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetchKlineEM(boardCode, klt, limit, secidOverride);
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
}

// ---------- 12. 研报（分析师预测 / 情绪用）----------
// reportapi /report/list：code/stockCode 参数不生效（2026-11-09 实测：
// 带 code 查 600519 返回 hits=0，不带 code 返回全市场研报，每条自带 stockCode）。
// 做法：拉最近 N 天全市场研报（每页 100 条，默认 2 页），客户端按 stockCode 筛选。
// 每条含：标题/机构/发布日/评级（emRatingName，如“买入”）/评级变化、
// predictThisYearEps / predictNextYearEps / predictNextTwoYearEps（元）及对应 PE、
// indvAimPriceT/L（分析师目标价，多数为空）。
// 覆盖说明：只覆盖窗口内有新研报的股票；冷门股可能 90 天内无研报，属实标明。
async function fetchReports(code, days = 90, pages = 3) {
  const end = new Date();
  const begin = new Date();
  begin.setDate(begin.getDate() - days);
  const fmt = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const out = [];
  for (let pageNo = 1; pageNo <= pages; pageNo++) {
    const url = API.EM_REPORT_LIST
      + "?qType=0&beginTime=" + fmt(begin) + "&endTime=" + fmt(end)
      + "&pageNo=" + pageNo + "&pageSize=100";
    const r = await fetch(url, { headers: { "Referer": "https://data.eastmoney.com/" } });
    if (!r.ok) throw new Error("研报接口 HTTP " + r.status);
    const j = await r.json();
    const data = (j && j.data) || [];
    for (const it of data) {
      if (String(it.stockCode) === String(code)) {
        out.push({
          title: it.title, org: it.orgSName || it.orgName, orgFull: it.orgName,
          publishDate: (it.publishDate || "").slice(0, 10),
          rating: it.emRatingName || it.sRatingName || "",
          ratingChange: it.ratingChange,
          epsThisYear: num2orNull(it.predictThisYearEps),
          peThisYear: num2orNull(it.predictThisYearPe),
          epsNextYear: num2orNull(it.predictNextYearEps),
          peNextYear: num2orNull(it.predictNextYearPe),
          epsNext2Year: num2orNull(it.predictNextTwoYearEps),
          peNext2Year: num2orNull(it.predictNextTwoYearPe),
          aimPriceT: num2orNull(it.indvAimPriceT),
          aimPriceL: num2orNull(it.indvAimPriceL),
          researcher: it.researcher || "",
          reportCount: it.count,
        });
      }
    }
    if (data.length < 100) break;
  }
  out.sort((a, b) => String(b.publishDate).localeCompare(String(a.publishDate)));
  return out;
}
function num2orNull(v) { const n = parseFloat(v); return isFinite(n) && n !== 0 ? n : null; }

// ---------- 13. 十大股东 / 机构持仓（v6：同源季度快照，见 js/holders.js）----------
// 2026-11-09 实测结论（v6 复测确认）：
// ① 东财 F10 PageAjax（emweb.securities.eastmoney.com/PC_HSF10/ShareholderResearch/PageAjax）
//    curl 能返回十大股东 sdgd / 十大流通股东 sdltgd / 股东户数 gdrs / 基金持仓 jjcg /
//    机构持股汇总 jgcc，但响应无 Access-Control-Allow-Origin，浏览器 fetch 会被 CORS 拦截；
// ② datacenter 无十大股东表：22 个候选表名（RPT_F10_MAIN_HOLDER、RPT_F10_MAIN_HOLDER2、
//    RPT_F10_HOLDER_TOTAL、RPT_F10_SDGD、RPT_F10_SDLTGD、RPT_F10_JJCG、RPT_F10_JGCC、
//    RPT_FUND_HOLD_STOCK、RPT_MUTUAL_HOLD_STOCK 等）换 columns/filter 重测均报 9501；
// ③ 雪球 top_holders.json 对本机出口 IP 返回 403 且需登录态；
// ④ push2/clist 无股东名字段（f129 口径未确认、f135 未验证定义，均不可用）。
// 因此 v6 采用“同源季度快照”：tools/refresh_holders.py 用 curl 拉 PageAjax，
// 写成 data/holders/<code>.json 随站部署，浏览器只读同源 JSON（js/holders.js 的 holdersLoad）。
// 本文件不再提供 fetchHolders（旧的抛错 stub 已删除）；若日后东财放开 CORS，
// 可在此实现直调并替换 holdersLoad。

// ---------- 一只股票的全部数据（并行拉取，单项失败不拖垮整页）----------
async function fetchStockAll(code) {
  const out = { code, errors: {} };
  const jobs = [
    ["quote", fetchEmQuote(code)],
    ["tx", fetchTxQuotes([code]).then((m) => m[code] || null)],
    ["klineD", fetchKline(code, 101, 1000)],
    ["klineW", fetchKline(code, 102, 200)],
    ["klineM", fetchKline(code, 103, 120)],
    ["indexKline", fetchKline("000300", 101, 250, { secid: "1.000300", symbol: "sh000300" })], // 沪深300 日线（Beta/周期性用；000300 必须走沪市前缀，通用映射会误判为深市）
    ["income", fetchIncome(code)],
    ["incomeFull", fetchIncomeFull(code)],
    ["balance", fetchBalance(code)],
    ["cashflow", fetchCashflow(code)],
    ["dividends", fetchDividends(code)],
    ["calendar", fetchCalendar(code)],
    ["forecast", fetchForecast(code)],
    ["profile", fetchCompanyProfile(code)],
    ["mainop", fetchMainop(code)],
  ];
  const results = await Promise.allSettled(jobs.map((j) => j[1]));
  jobs.forEach((j, i) => {
    if (results[i].status === "fulfilled") out[j[0]] = results[i].value;
    else { out[j[0]] = null; out.errors[j[0]] = String(results[i].reason && results[i].reason.message || results[i].reason); }
  });
  return out;
}

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
  // 东财 secid 市场码：1=上交所（6/9开头），0=深交所（0/2/3开头），2=北交所（8/4开头）
  if (/^[69]/.test(code)) return 1;
  if (/^[84]/.test(code)) return 2;
  return 0;
}
function txMarket(code) {
  if (/^[69]/.test(code)) return "sh";
  if (/^[84]/.test(code)) return "bj";
  return "sz";
}
function secid(code) { return emMarket(code) + "." + code; }
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
// SHORT_LOAN（短期借款）、ACCOUNTS_RECE（应收账款）、ACCOUNTS_PAYABLE（应付账款）、FIXED_ASSET（固定资产）
function fetchBalance(code, pageSize = 60) {
  return emDatacenter(
    "RPT_DMSK_FN_BALANCE",
    "SECURITY_CODE,REPORT_DATE,TOTAL_ASSETS,TOTAL_LIABILITIES,TOTAL_EQUITY,MONETARYFUNDS,INVENTORY,CURRENT_RATIO,DEBT_ASSET_RATIO,SHORT_LOAN,ACCOUNTS_RECE,ACCOUNTS_PAYABLE,FIXED_ASSET",
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
  ];
  const results = await Promise.allSettled(jobs.map((j) => j[1]));
  jobs.forEach((j, i) => {
    if (results[i].status === "fulfilled") out[j[0]] = results[i].value;
    else { out[j[0]] = null; out.errors[j[0]] = String(results[i].reason && results[i].reason.message || results[i].reason); }
  });
  return out;
}

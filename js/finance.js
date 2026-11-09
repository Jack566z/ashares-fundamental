// ============================================================
// A股基本面分析 — 财务计算
// TTM、指标、六维评分、DCF。所有公式与阈值都在页面“打分指南”里公开。
// 注意：东财季度行是“年内累计值”（Q3 = 1~9 月），TTM 须用
//   TTM = 本期累计 + 上年全年 − 上年同期累计，不能直接拿季度值当 TTM。
// 金额单位：东财财报字段均为“元”。
// ============================================================

// ---------- 日期工具 ----------
function parseDate(s) { return s ? new Date(String(s).slice(0, 10) + "T00:00:00") : null; }
function reportKey(s) { return String(s || "").slice(0, 10); } // YYYY-MM-DD
function reportMonth(s) { return parseInt(String(s || "").slice(5, 7), 10) || 0; }
function reportYear(s) { return parseInt(String(s || "").slice(0, 4), 10) || 0; }
function dateField(row) { return row.REPORTDATE || row.REPORT_DATE || ""; }
function num(v) { const n = parseFloat(v); return isFinite(n) ? n : 0; }

// ---------- TTM ----------
// rows：按日期倒序的利润表/现金流表行；field：字段名。
// 返回 { value, basis }；basis 说明 TTM 由哪几期拼成，数据不足返回 null。
function calcTTM(rows, field) {
  if (!rows || !rows.length) return null;
  const byKey = {};
  for (const r of rows) byKey[reportKey(dateField(r))] = r;
  const latest = rows[0];
  const d = dateField(latest);
  const y = reportYear(d), m = reportMonth(d);
  const latestVal = num(latest[field]);
  if (m === 12) return { value: latestVal, basis: y + "年报" };
  // 季度：TTM = 本期累计 + 上年全年 − 上年同期累计
  const fy = byKey[y - 1 + "-12-31"];
  const sameQ = byKey[(y - 1) + "-" + String(m).padStart(2, "0") + "-" + (m === 3 ? "31" : "30")];
  if (!fy || !sameQ) return null;
  const v = latestVal + num(fy[field]) - num(sameQ[field]);
  return { value: v, basis: d.slice(0, 7) + "累计 + " + (y - 1) + "全年 − 上年同期" };
}
// 同比：取同一报告期去年同期的累计值
function yoyGrowth(rows, field) {
  if (!rows || rows.length < 2) return null;
  const byKey = {};
  for (const r of rows) byKey[reportKey(dateField(r))] = r;
  const latest = rows[0];
  const d = dateField(latest);
  const y = reportYear(d), m = reportMonth(d);
  const prevKey = (y - 1) + "-" + String(m).padStart(2, "0") + "-" + (m === 3 ? "31" : "30");
  const prev = byKey[prevKey];
  if (!prev) return null;
  const cur = num(latest[field]), old = num(prev[field]);
  if (!old) return null;
  return { growth: (cur - old) / Math.abs(old), cur, prev: old };
}
// 年报行（12-31）倒序
function annualRows(rows) {
  return (rows || []).filter((r) => reportMonth(dateField(r)) === 12);
}
// 近 3 年归母净利润复合增速（年报口径）
function profitCAGR(rows, years = 3) {
  const ann = annualRows(rows);
  if (ann.length < years + 1) return null;
  const first = num(ann[years].PARENT_NETPROFIT);
  const last = num(ann[0].PARENT_NETPROFIT);
  if (first <= 0 || last <= 0) return null;
  return Math.pow(last / first, 1 / years) - 1;
}

// ---------- 核心指标 ----------
// data: fetchStockAll 的返回。返回 metrics 对象，缺失项为 null 并附注原因。
function calcMetrics(data) {
  const m = { hasFinancials: false, notes: [] };
  const inc = data.income || [], bal = data.balance || [], cf = data.cashflow || [];

  // 估值（腾讯 qt）
  const tx = data.tx || {};
  m.peTtm = tx.peTtm || null;
  m.peStatic = tx.peStatic || null;
  m.pb = tx.pb || null;
  m.turnover = tx.turnover || null;
  m.roeTx = tx.roe || null;

  // 行情（东财 + 腾讯）。价格以腾讯为准（单位明确是元）；
  // 东财提供腾讯没有的股息率、行业、概念、总股本。
  const q = data.quote || {};
  m.price = (tx.price || null) ?? (q.price || null);
  m.prevClose = (tx.prevClose || null) ?? (q.prevClose || null);
  m.changePct = tx.changePct != null ? tx.changePct : (q.changePct != null ? q.changePct : null);
  m.totalMcap = q.totalMcap || (tx.totalMcapYi ? tx.totalMcapYi * 1e8 : null);
  m.floatMcap = q.floatMcap || (tx.floatMcapYi ? tx.floatMcapYi * 1e8 : null);
  m.totalShares = q.totalShares || null;
  m.divYieldEm = q.divYield || null;   // 东财口径股息率 %
  m.industry = q.industry || "";
  m.concepts = q.concepts || "";

  if (!inc.length) {
    m.notes.push("该标的无财报数据（ETF/指数类不披露三大表），盈利/负债/成长/分红维度不适用");
    return m;
  }
  m.hasFinancials = true;

  const ttmRev = calcTTM(inc, "TOTAL_OPERATE_INCOME");
  const ttmProfit = calcTTM(inc, "PARENT_NETPROFIT");
  const ttmEps = ttmProfit && m.totalShares ? ttmProfit.value / m.totalShares : null;
  m.ttmRevenue = ttmRev ? ttmRev.value : null;
  m.ttmProfit = ttmProfit ? ttmProfit.value : null;
  m.ttmEps = ttmEps;
  m.ttmBasis = ttmRev ? ttmRev.basis : "";

  const revYoy = yoyGrowth(inc, "TOTAL_OPERATE_INCOME");
  const profYoy = yoyGrowth(inc, "PARENT_NETPROFIT");
  m.revGrowth = revYoy ? revYoy.growth : null;
  m.profitGrowth = profYoy ? profYoy.growth : null;
  m.profitCagr3 = profitCAGR(inc, 3);

  // 资产负债（最新一期）
  const b = bal[0] || {};
  m.totalAssets = num(b.TOTAL_ASSETS) || null;
  m.totalLiab = num(b.TOTAL_LIABILITIES) || null;
  m.totalEquity = num(b.TOTAL_EQUITY) || null;
  m.cash = num(b.MONETARYFUNDS) || null;
  m.inventory = num(b.INVENTORY) || null;
  m.debtRatio = (m.totalAssets && m.totalLiab != null) ? m.totalLiab / m.totalAssets : null;
  m.netDebt = (m.totalLiab != null && m.cash != null) ? m.totalLiab - m.cash : null;

  // 盈利能力
  m.roe = (m.ttmProfit != null && m.totalEquity) ? m.ttmProfit / m.totalEquity : null;
  m.netMargin = (m.ttmProfit != null && m.ttmRevenue) ? m.ttmProfit / m.ttmRevenue : null;

  // 现金流 TTM
  const ttmOp = calcTTM(cf, "NETCASH_OPERATE");
  const ttmInv = calcTTM(cf, "NETCASH_INVEST");
  m.ttmOpCf = ttmOp ? ttmOp.value : null;
  m.ttmInvCf = ttmInv ? ttmInv.value : null;
  m.ttmFcf = (m.ttmOpCf != null && m.ttmInvCf != null) ? m.ttmOpCf + m.ttmInvCf : null;
  // 经营现金流 / 净利润（现金含量）
  m.cfCoverage = (m.ttmOpCf != null && m.ttmProfit) ? m.ttmOpCf / m.ttmProfit : null;

  // 分红：近 12 个月每股派息（PRETAX_BONUS_RMB 是“每 10 股派息”，除以 10）
  const divs = data.dividends || [];
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  let dps12m = 0, divCount12m = 0;
  for (const d of divs) {
    const dt = parseDate(d.EX_DIVIDEND_DATE);
    if (dt && dt >= oneYearAgo) { dps12m += num(d.PRETAX_BONUS_RMB) / 10; divCount12m++; }
  }
  m.dps12m = divCount12m ? dps12m : null;
  m.divYieldCalc = (m.dps12m != null && m.price) ? m.dps12m / m.price * 100 : null;
  m.divYield = m.divYieldEm != null ? m.divYieldEm : m.divYieldCalc;
  m.payout = (m.dps12m != null && ttmEps) ? m.dps12m / ttmEps : null;
  m.divYears = divs.length;

  // 年报历史（演变图/表用）
  m.annual = annualRows(inc).slice(0, 10).map((r) => ({
    year: reportYear(dateField(r)),
    revenue: num(r.TOTAL_OPERATE_INCOME),
    profit: num(r.PARENT_NETPROFIT),
    eps: num(r.BASIC_EPS),
  })).reverse();

  return m;
}

// ---------- 六维评分（满分 100）----------
// 每个维度返回 { score, max, detail }；detail 是打分依据的文字。
function scoreStock(m, klineD) {
  const dims = {};
  const band = (v, table) => {
    if (v == null || !isFinite(v)) return { s: 0, why: "无数据" };
    for (const [test, s, why] of table) if (test(v)) return { s, why };
    return { s: 0, why: "超出区间" };
  };

  // 估值 20 = PE-TTM 12 + PB 8
  const pe = band(m.peTtm, [
    [(v) => v > 0 && v < 10, 12, "PE-TTM < 10"],
    [(v) => v >= 10 && v < 15, 10, "PE-TTM 10~15"],
    [(v) => v >= 15 && v < 20, 8, "PE-TTM 15~20"],
    [(v) => v >= 20 && v < 30, 6, "PE-TTM 20~30"],
    [(v) => v >= 30 && v < 50, 3, "PE-TTM 30~50"],
    [(v) => v >= 50, 0, "PE-TTM ≥ 50"],
    [(v) => v <= 0, 0, "PE-TTM ≤ 0（亏损）"],
  ]);
  const pb = band(m.pb, [
    [(v) => v > 0 && v < 1, 8, "PB < 1"],
    [(v) => v >= 1 && v < 2, 6, "PB 1~2"],
    [(v) => v >= 2 && v < 4, 4, "PB 2~4"],
    [(v) => v >= 4 && v < 8, 2, "PB 4~8"],
    [(v) => v >= 8, 0, "PB ≥ 8"],
  ]);
  dims.valuation = {
    score: pe.s + pb.s, max: 20,
    detail: "PE-TTM " + (m.peTtm != null ? m.peTtm.toFixed(2) : "—") + "（" + pe.why + "，" + pe.s + "分）"
      + "；PB " + (m.pb != null ? m.pb.toFixed(2) : "—") + "（" + pb.why + "，" + pb.s + "分）",
  };

  // 盈利 25 = ROE 15 + 净利率 10
  const roe = band(m.roe != null ? m.roe * 100 : null, [
    [(v) => v > 20, 15, "ROE > 20%"],
    [(v) => v > 15, 12, "ROE 15~20%"],
    [(v) => v > 10, 9, "ROE 10~15%"],
    [(v) => v > 5, 5, "ROE 5~10%"],
    [(v) => v <= 5, 2, "ROE ≤ 5%"],
  ]);
  const nm = band(m.netMargin != null ? m.netMargin * 100 : null, [
    [(v) => v > 20, 10, "净利率 > 20%"],
    [(v) => v > 10, 7, "净利率 10~20%"],
    [(v) => v > 5, 4, "净利率 5~10%"],
    [(v) => v <= 5, 1, "净利率 ≤ 5%"],
  ]);
  dims.profitability = {
    score: roe.s + nm.s, max: 25,
    detail: "ROE（TTM）" + (m.roe != null ? (m.roe * 100).toFixed(1) + "%" : "—") + "（" + roe.why + "，" + roe.s + "分）"
      + "；净利率（TTM）" + (m.netMargin != null ? (m.netMargin * 100).toFixed(1) + "%" : "—") + "（" + nm.why + "，" + nm.s + "分）",
  };

  // 负债 15 = 资产负债率 12 + 现金含量 3
  const dr = band(m.debtRatio != null ? m.debtRatio * 100 : null, [
    [(v) => v < 30, 12, "资产负债率 < 30%"],
    [(v) => v < 50, 9, "资产负债率 30~50%"],
    [(v) => v < 70, 6, "资产负债率 50~70%"],
    [(v) => v >= 70, 3, "资产负债率 ≥ 70%"],
  ]);
  const cfc = band(m.cfCoverage, [
    [(v) => v > 1, 3, "经营现金流/净利润 > 1"],
    [(v) => v > 0.5, 2, "经营现金流/净利润 0.5~1"],
    [(v) => v <= 0.5, 0, "经营现金流/净利润 ≤ 0.5"],
  ]);
  dims.debt = {
    score: dr.s + cfc.s, max: 15,
    detail: "资产负债率 " + (m.debtRatio != null ? (m.debtRatio * 100).toFixed(1) + "%" : "—") + "（" + dr.why + "，" + dr.s + "分）"
      + "；经营现金流/净利润 " + (m.cfCoverage != null ? m.cfCoverage.toFixed(2) : "—") + "（" + cfc.why + "，" + cfc.s + "分）",
  };

  // 成长 20 = 营收增速 10 + 利润增速 10（TTM 同比）
  const rg = band(m.revGrowth != null ? m.revGrowth * 100 : null, [
    [(v) => v > 20, 10, "营收 TTM 同比 > 20%"],
    [(v) => v > 10, 8, "营收 TTM 同比 10~20%"],
    [(v) => v > 0, 5, "营收 TTM 同比 0~10%"],
    [(v) => v <= 0, 1, "营收 TTM 同比 ≤ 0"],
  ]);
  const pg = band(m.profitGrowth != null ? m.profitGrowth * 100 : null, [
    [(v) => v > 20, 10, "利润 TTM 同比 > 20%"],
    [(v) => v > 10, 8, "利润 TTM 同比 10~20%"],
    [(v) => v > 0, 5, "利润 TTM 同比 0~10%"],
    [(v) => v <= 0, 1, "利润 TTM 同比 ≤ 0"],
  ]);
  dims.growth = {
    score: rg.s + pg.s, max: 20,
    detail: "营收 TTM 同比 " + (m.revGrowth != null ? (m.revGrowth * 100).toFixed(1) + "%" : "—") + "（" + rg.why + "，" + rg.s + "分）"
      + "；归母利润 TTM 同比 " + (m.profitGrowth != null ? (m.profitGrowth * 100).toFixed(1) + "%" : "—") + "（" + pg.why + "，" + pg.s + "分）",
  };

  // 分红 10 = 股息率
  const dv = band(m.divYield, [
    [(v) => v > 4, 10, "股息率 > 4%"],
    [(v) => v > 3, 8, "股息率 3~4%"],
    [(v) => v > 2, 6, "股息率 2~3%"],
    [(v) => v > 1, 4, "股息率 1~2%"],
    [(v) => v > 0, 2, "股息率 0~1%"],
    [(v) => v <= 0, 0, "无分红"],
  ]);
  dims.dividend = {
    score: dv.s, max: 10,
    detail: "股息率 " + (m.divYield != null ? m.divYield.toFixed(2) + "%" : "—") + "（" + dv.why + "，" + dv.s + "分）"
      + "；近 12 个月每股派息 " + (m.dps12m != null ? m.dps12m.toFixed(2) + " 元" : "—")
      + "；派息率 " + (m.payout != null ? (m.payout * 100).toFixed(0) + "%" : "—"),
  };

  // 技术 10 = 站上 MA60 4 + MA20>MA60 3 + 距 52 周高点 3（K 线前复权口径）
  let tech = 0; const techWhy = [];
  if (klineD && klineD.length >= 60) {
    const closes = klineD.map((k) => k.close);
    const ma = (n) => closes.slice(-n).reduce((a, b) => a + b, 0) / n;
    const last = closes[closes.length - 1];
    const ma20 = ma(20), ma60 = ma(60);
    const hi52 = Math.max(...closes.slice(-250));
    if (last > ma60) { tech += 4; techWhy.push("收盘价站上 MA60（+4）"); }
    else techWhy.push("收盘价在 MA60 下方（+0）");
    if (ma20 > ma60) { tech += 3; techWhy.push("MA20 > MA60 多头排列（+3）"); }
    else techWhy.push("MA20 ≤ MA60（+0）");
    const dist = hi52 ? (last / hi52 - 1) * 100 : null;
    if (dist != null && dist > -10) { tech += 3; techWhy.push("距 52 周高点 " + dist.toFixed(1) + "%（+3）"); }
    else if (dist != null && dist > -20) { tech += 2; techWhy.push("距 52 周高点 " + dist.toFixed(1) + "%（+2）"); }
    else techWhy.push("距 52 周高点 " + (dist != null ? dist.toFixed(1) + "%" : "—") + "（+0）");
  } else {
    techWhy.push("K 线不足 60 根，技术维度暂无数据");
  }
  dims.technical = { score: tech, max: 10, detail: techWhy.join("；") };

  // ETF / 无财报：盈利、负债、成长、分红不适用，只算估值 + 技术
  let total = 0, totalMax = 100, applicable = ["valuation", "profitability", "debt", "growth", "dividend", "technical"];
  if (!m.hasFinancials) {
    applicable = ["valuation", "technical"];
    for (const key of ["profitability", "debt", "growth", "dividend"]) {
      dims[key] = { score: 0, max: dims[key].max, detail: "不适用（该标的无财报数据）", na: true };
    }
    totalMax = 30;
  }
  for (const key of applicable) total += dims[key].score;
  const grade = totalMax === 100
    ? (total >= 80 ? "优秀" : total >= 65 ? "良好" : total >= 50 ? "一般" : total >= 35 ? "偏弱" : "较弱")
    : (total / totalMax >= 0.8 ? "优秀" : total / totalMax >= 0.65 ? "良好" : total / totalMax >= 0.5 ? "一般" : "偏弱");
  return { dims, total, totalMax, grade, partial: !m.hasFinancials };
}

// ---------- DCF ----------
// 自由现金流 FCF（TTM）= 经营现金流 + 投资现金流（投资流通常为负）。
// 预测 5 年按增长率 g 复利，永续增长率 gt，折现率 WACC。
// 企业价值 = 未来 5 年 FCF 现值 + 终值现值；股权价值 = 企业价值 − 净负债；
// 内在价值/股 = 股权价值 / 总股本。
function calcDCF(m, opts) {
  const wacc = opts.wacc, years = opts.growthYears, gt = opts.terminalGrowth;
  let g = opts.growth;
  if (g == null) {
    g = m.profitCagr3 != null ? Math.max(0, Math.min(0.15, m.profitCagr3)) : 0.05;
  }
  const res = { wacc, growth: g, terminalGrowth: gt, years, fcf0: m.ttmFcf, usable: false, reason: "" };
  if (m.ttmFcf == null) { res.reason = "无自由现金流数据（现金流表缺失）"; return res; }
  if (m.ttmFcf <= 0) { res.reason = "TTM 自由现金流为负（" + fmtMoney(m.ttmFcf) + "），DCF 不适用"; return res; }
  if (!m.totalShares) { res.reason = "无总股本数据"; return res; }
  if (wacc <= gt) { res.reason = "WACC 必须大于永续增长率"; return res; }
  const rows = [];
  let pvSum = 0;
  for (let t = 1; t <= years; t++) {
    const fcf = m.ttmFcf * Math.pow(1 + g, t);
    const pv = fcf / Math.pow(1 + wacc, t);
    pvSum += pv;
    rows.push({ year: t, fcf, pv });
  }
  const fcfLast = rows[rows.length - 1].fcf;
  const tv = fcfLast * (1 + gt) / (wacc - gt);
  const pvTv = tv / Math.pow(1 + wacc, years);
  const ev = pvSum + pvTv;
  const netDebt = m.netDebt || 0;
  const equityValue = ev - netDebt;
  const perShare = equityValue / m.totalShares;
  return {
    ...res, usable: true, rows, pvSum, tv, pvTv, ev, netDebt, equityValue, perShare,
    upside: m.price ? (perShare / m.price - 1) * 100 : null,
    growthSource: opts.growth == null
      ? (m.profitCagr3 != null ? "自动：近 3 年归母利润复合增速 " + (m.profitCagr3 * 100).toFixed(1) + "%（限 0~15%）" : "自动：无 3 年增速，默认 5%")
      : "手动输入",
  };
}

// ---------- 格式化 ----------
function fmtMoney(v) {
  if (v == null || !isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e12) return (v / 1e12).toFixed(2) + " 万亿";
  if (a >= 1e8) return (v / 1e8).toFixed(2) + " 亿";
  if (a >= 1e4) return (v / 1e4).toFixed(2) + " 万";
  return v.toFixed(2);
}
function fmtPct(v, digits = 2) {
  if (v == null || !isFinite(v)) return "—";
  return (v * 100).toFixed(digits) + "%";
}
function fmtNum(v, digits = 2) {
  if (v == null || !isFinite(v)) return "—";
  return v.toFixed(digits);
}

// ============================================================
// 扩展指标（AleInversor 子模块全量对照）
// 本段新增：估值倍数、盈利（毛利/EBIT/ROIC/ROCE/五年中位数）、负债、
// 成长 CAGR、 分红 CAGR、 技术指标（RSI/MACD/ADX/随机/KD/威廉/布林）、
// 回撤统计、Beta vs 沪深300、历史 PE、EPS 预测。
// 数据缺口一律返回 null 并在页面标“暂不可用”，不造数。
// 关键口径：
//   EBIT ≈ 营业利润 + 财务费用（财务费用为负时为净利息收入，EBIT 略低于营业利润）
//   EBITDA 不可算：折旧摊销未从公开接口获得 → EV/EBITDA、Deuda/EBITDA、毛利率外的
//   Margen EBITDA 均标暂不可用。
//   速动比率/现金比率不可算：流动资产/流动负债未单独披露（只有流动比率 CURRENT_RATIO 直接值）。
//   EV = 总市值 + 总负债 − 货币资金（总负债作有息负债的代理，偏保守）。
//   ROIC ≈ NOPAT / (净资产+总负债)，NOPAT = 营业利润 × (1 − 所得税率)，所得税率 = 所得税/利润总额。
//   ROCE ≈ EBIT / (净资产+总负债)。
// ============================================================

// ---------- 合并利润表（LICO 口径 EPS/BPS/ROE + DMSK 口径成本/利润/费用）----------
function mergeIncome(licoRows, dmskRows) {
  const byDate = {};
  const put = (row, src) => {
    const d = reportKey(dateField(row));
    if (!d) return;
    byDate[d] = byDate[d] || { date: d };
    for (const k of Object.keys(row)) {
      if (row[k] != null && byDate[d][k] == null) byDate[d][k] = row[k];
    }
  };
  (licoRows || []).forEach((r) => put(r, "L"));
  (dmskRows || []).forEach((r) => put(r, "D"));
  const rows = Object.values(byDate).sort((a, b) => (a.date < b.date ? 1 : -1));
  return rows;
}
// 年报序列 [{year, value}]（升序）
function annualSeries(rows, field) {
  return (rows || [])
    .filter((r) => reportMonth(r.date || dateField(r)) === 12)
    .map((r) => ({ year: reportYear(r.date || dateField(r)), value: num(r[field]) }))
    .sort((a, b) => a.year - b.year);
}
// CAGR：年报序列近 N 年（要求首尾都 >0）
function cagrFromAnnual(series, years) {
  if (!series || series.length < 2) return null;
  const last = series[series.length - 1];
  const first = series.find((x) => x.year === last.year - years);
  if (!first || first.value <= 0 || last.value <= 0) return null;
  return { value: Math.pow(last.value / first.value, 1 / years) - 1, from: first.year, to: last.year, n: series.length };
}
function median(arr) {
  const a = (arr || []).filter((v) => v != null && isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}
function emaSeries(values, period) {
  const k = 2 / (period + 1);
  const out = [];
  let prev = null;
  values.forEach((v, i) => {
    if (v == null) { out.push(null); return; }
    if (prev == null) {
      if (i >= period - 1) {
        let s = 0, c = 0;
        for (let j = i - period + 1; j <= i; j++) { if (values[j] != null) { s += values[j]; c++; } }
        prev = c ? s / c : v;
      } else { out.push(null); return; }
    } else prev = v * k + prev * (1 - k);
    out.push(prev);
  });
  return out;
}
function smaSeries(values, period) {
  const out = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { out.push(null); continue; }
    let s = 0, c = 0;
    for (let j = i - period + 1; j <= i; j++) { if (values[j] != null) { s += values[j]; c++; } }
    out.push(c === period ? s / period : null);
  }
  return out;
}
function stdSeries(values, period) {
  const out = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { out.push(null); continue; }
    const w = values.slice(i - period + 1, i + 1);
    if (w.some((v) => v == null)) { out.push(null); continue; }
    const m = w.reduce((a, b) => a + b, 0) / period;
    const variance = w.reduce((a, b) => a + (b - m) * (b - m), 0) / period;
    out.push(Math.sqrt(variance));
  }
  return out;
}

// ---------- 扩展指标主函数 ----------
function calcExtended(data, m) {
  const ext = { na: {} }; // na: {key: reason} 暂不可用的子项及原因
  const na = (key, reason) => { ext.na[key] = reason; };
  const inc = mergeIncome(data.income, data.incomeFull);
  const bal = data.balance || [];
  const cf = data.cashflow || [];
  const klineD = data.klineD || [];
  const hasFin = !!inc.length;

  // ===== 估值倍数 =====
  const val = {};
  if (m.price != null && m.totalMcap) {
    val.ps = m.ttmRevenue ? m.totalMcap / m.ttmRevenue : null;                 // P/S
    val.pFcf = m.ttmFcf && m.ttmFcf > 0 ? m.totalMcap / m.ttmFcf : null;        // P/FCF
    val.earnYield = m.peTtm && m.peTtm > 0 ? 100 / m.peTtm : null;              // Earnings Yield %
    val.fcfYield = m.ttmFcf != null ? m.ttmFcf / m.totalMcap * 100 : null;      // FCF Yield %
    val.ev = (m.totalLiab != null && m.cash != null) ? m.totalMcap + m.totalLiab - m.cash : null;
    const ebitTtmObj = calcTTM(inc, "OPERATE_PROFIT");
    const finTtmObj = calcTTM(inc, "FINANCE_EXPENSE");
    val.ebitTtm = ebitTtmObj ? ebitTtmObj.value + (finTtmObj ? finTtmObj.value : 0) : null;
    val.evEbit = (val.ev != null && val.ebitTtm && val.ebitTtm > 0) ? val.ev / val.ebitTtm : null;
    val.evFcf = (val.ev != null && m.ttmFcf && m.ttmFcf > 0) ? val.ev / m.ttmFcf : null;
    val.evSales = (val.ev != null && m.ttmRevenue) ? val.ev / m.ttmRevenue : null;
    val.peg = (m.peTtm && m.peTtm > 0 && m.profitGrowth != null && m.profitGrowth > 0)
      ? m.peTtm / (m.profitGrowth * 100) : null;
    if (val.peg == null) na("peg", m.profitGrowth != null && m.profitGrowth <= 0 ? "利润 TTM 同比 ≤ 0，PEG 无意义" : "无利润增速数据");
  } else {
    na("multiples", "无市值/价格数据");
  }
  val.evEbitda = null; na("evEbitda", "折旧摊销未从公开接口获得，EBITDA 无法计算");
  val.perNtm = null; na("perNtm", "A 股无公开一致预期 EPS 数据， forward PE 无法计算");
  ext.valuation = val;

  // ===== 盈利 =====
  const prof = {};
  if (hasFin) {
    const ttm = (f) => { const r = calcTTM(inc, f); return r ? r.value : null; };
    const rev = ttm("TOTAL_OPERATE_INCOME"), cost = ttm("OPERATE_COST");
    const opProfit = ttm("OPERATE_PROFIT"), totalProfit = ttm("TOTAL_PROFIT");
    const finExp = ttm("FINANCE_EXPENSE"), tax = ttm("INCOME_TAX");
    const ebit = (opProfit != null) ? opProfit + (finExp || 0) : null;
    prof.grossMargin = (rev && cost != null) ? (rev - cost) / rev : null;
    prof.ebitMargin = (ebit != null && rev) ? ebit / rev : null;
    prof.opMargin = (opProfit != null && rev) ? opProfit / rev : null;
    prof.netMargin = m.netMargin;
    prof.fcfMargin = (m.ttmFcf != null && rev) ? m.ttmFcf / rev : null;
    prof.ebitdaMargin = null; na("ebitdaMargin", "折旧摊销未从公开接口获得");
    const assets = m.totalAssets, equity = m.totalEquity, liab = m.totalLiab;
    prof.roa = (m.ttmProfit != null && assets) ? m.ttmProfit / assets : null;
    const taxRate = (tax != null && totalProfit) ? tax / totalProfit : null;
    const nopat = (opProfit != null && taxRate != null) ? opProfit * (1 - taxRate) : null;
    const invested = (equity != null && liab != null) ? equity + liab : null;
    prof.roic = (nopat != null && invested) ? nopat / invested : null;
    prof.roce = (ebit != null && invested) ? ebit / invested : null;
    prof.taxRate = taxRate;
    prof.ebit = ebit;
    // 五年中位数（年报口径）
    const ann = annualRows(inc);
    const licoAnn = annualRows(data.income || []);
    const roe5 = licoAnn.slice(-5).map((r) => num(r.WEIGHTAVG_ROE)).filter((v) => v);
    prof.roeMedian5 = median(roe5.map((v) => v / 100));
    prof.roeHist5 = licoAnn.slice(-5).map((r) => ({ year: reportYear(dateField(r)), value: num(r.WEIGHTAVG_ROE) / 100 }));
    const balAnn = annualRows(bal);
    const balByYear = {};
    balAnn.forEach((r) => { balByYear[reportYear(dateField(r))] = r; });
    const roicH = [], roceH = [];
    for (const r of ann) {
      const y = reportYear(dateField(r));
      const b = balByYear[y];
      if (!b) continue;
      const assetsY = num(b.TOTAL_ASSETS);
      const opY = num(r.OPERATE_PROFIT), finY = num(r.FINANCE_EXPENSE), taxY = num(r.INCOME_TAX), tpY = num(r.TOTAL_PROFIT);
      if (!assetsY) continue;
      const ebitY = opY + finY;
      const trY = tpY ? taxY / tpY : null;
      if (trY != null) roicH.push({ year: y, value: opY * (1 - trY) / assetsY });
      roceH.push({ year: y, value: ebitY / assetsY });
    }
    prof.roicMedian5 = median(roicH.slice(-5).map((x) => x.value));
    prof.roceMedian5 = median(roceH.slice(-5).map((x) => x.value));
    prof.roicHist = roicH; prof.roceHist = roceH;
    prof.marginHist = ann.map((r) => {
      const revY = num(r.TOTAL_OPERATE_INCOME), costY = num(r.OPERATE_COST);
      const opY = num(r.OPERATE_PROFIT), netY = num(r.PARENT_NETPROFIT);
      return {
        year: reportYear(dateField(r)),
        gross: revY ? (revY - costY) / revY : null,
        ebit: revY ? (opY + num(r.FINANCE_EXPENSE)) / revY : null,
        net: revY ? netY / revY : null,
      };
    });
  } else {
    na("profitability", "该标的无财报数据（ETF/指数类）");
  }
  ext.profitability = prof;

  // ===== 负债 =====
  const debt = {};
  if (hasFin) {
    const eq = m.totalEquity, liab = m.totalLiab, assets = m.totalAssets;
    debt.deRatio = (liab != null && eq) ? liab / eq : null;
    debt.debtAssets = m.debtRatio;
    const netDebt = m.netDebt;
    debt.netDebt = netDebt;
    debt.netDebtFcf = (netDebt != null && m.ttmFcf && m.ttmFcf > 0) ? netDebt / m.ttmFcf : null;
    debt.netDebtEbitda = null; na("netDebtEbitda", "折旧摊销未从公开接口获得，EBITDA 无法计算");
    debt.fcfToDebt = (m.ttmFcf != null && liab) ? m.ttmFcf / liab : null;
    debt.netDebtPctAssets = (netDebt != null && assets) ? netDebt / assets : null;
    const b0 = bal[0] || {};
    debt.currentRatio = b0.CURRENT_RATIO != null ? num(b0.CURRENT_RATIO) / 100 : null;
    debt.quickRatio = null; na("quickRatio", "流动资产/流动负债未单独披露，速动比率无法计算");
    debt.cashRatio = null; na("cashRatio", "流动负债未单独披露，现金比率无法计算");
    const finExpTtm = calcTTM(inc, "FINANCE_EXPENSE");
    const ebitTtm = prof.ebit;
    if (finExpTtm && finExpTtm.value > 0 && ebitTtm != null) {
      debt.interestCoverage = ebitTtm / finExpTtm.value;
    } else {
      debt.interestCoverage = null;
      na("interestCoverage", finExpTtm && finExpTtm.value <= 0 ? "财务费用为负（净利息收入），无利息负担" : "无财务费用数据");
    }
    debt.financeExpenseTtm = finExpTtm ? finExpTtm.value : null;
    debt.shortLoan = num(b0.SHORT_LOAN) || 0;
    debt.accPayable = num(b0.ACCOUNTS_PAYABLE) || 0;
    debt.otherLiab = (liab != null) ? liab - debt.shortLoan - debt.accPayable : null;
    debt.longDebtToEquity = null; na("longDebtToEquity", "长期借款未单独披露（只有短期借款与应付账款）");
    debt.hist = annualRows(bal).map((r) => ({
      year: reportYear(dateField(r)),
      total: num(r.TOTAL_LIABILITIES),
      net: num(r.TOTAL_LIABILITIES) - num(r.MONETARYFUNDS),
      cash: num(r.MONETARYFUNDS),
      shortLoan: num(r.SHORT_LOAN),
    }));
  } else {
    na("debt", "该标的无财报数据（ETF/指数类）");
  }
  ext.debt = debt;

  // ===== 成长 CAGR =====
  const growth = {};
  if (hasFin) {
    const ann = annualRows(inc);
    const byField = (field) => ann.map((r) => ({ year: reportYear(dateField(r)), value: num(r[field]) })).sort((a, b) => a.year - b.year);
    const cagrRow = (field, label) => {
      const s = byField(field);
      const out = { label };
      [3, 5, 10].forEach((n) => { out["cagr" + n] = cagrFromAnnual(s, n); });
      return out;
    };
    growth.rows = [
      cagrRow("TOTAL_OPERATE_INCOME", "营收"),
      cagrRow("OPERATE_PROFIT", "营业利润（EBIT 代理）"),
      cagrRow("PARENT_NETPROFIT", "归母净利润"),
      cagrRow("BASIC_EPS", "EPS"),
    ];
    const cfAnn = annualRows(cf);
    const cfBy = (field) => cfAnn.map((r) => ({ year: reportYear(dateField(r)), value: num(r[field]) })).sort((a, b) => a.year - b.year);
    const cagrCf = (field, label) => {
      const s = cfBy(field);
      const out = { label };
      [3, 5, 10].forEach((n) => { out["cagr" + n] = cagrFromAnnual(s, n); });
      return out;
    };
    growth.rows.push(cagrCf("NETCASH_OPERATE", "经营现金流 CFO"));
    const fcfAnn = cfAnn.map((r) => ({ year: reportYear(dateField(r)), value: num(r.NETCASH_OPERATE) + num(r.NETCASH_INVEST) })).sort((a, b) => a.year - b.year);
    const fcfRow = { label: "自由现金流 FCF" };
    [3, 5, 10].forEach((n) => { fcfRow["cagr" + n] = cagrFromAnnual(fcfAnn, n); });
    growth.rows.push(fcfRow);
    growth.rows.push(cagrCf("CONSTRUCT_LONG_ASSET", "CAPEX（购建长期资产）"));
    const balAnn = annualRows(bal);
    const cashS = balAnn.map((r) => ({ year: reportYear(dateField(r)), value: num(r.MONETARYFUNDS) })).sort((a, b) => a.year - b.year);
    const cashRow = { label: "货币资金" };
    [3, 5, 10].forEach((n) => { cashRow["cagr" + n] = cagrFromAnnual(cashS, n); });
    growth.rows.push(cashRow);
    growth.ebitda = null; na("growthEbitda", "折旧摊销未从公开接口获得，EBITDA 无法计算");
    growth.shares = null; na("growthShares", "历史总股本未披露（只有当前总股本）");
    growth.retained = null; na("growthRetained", "未分配利润未单独披露");
    growth.quarterly = [];
    const byKeyQ = {};
    inc.forEach((r) => { byKeyQ[reportKey(r.date || dateField(r))] = r; });
    const sortedQ = inc.slice(0, 12);
    for (const r of sortedQ) {
      const d = r.date || dateField(r);
      const y = reportYear(d), mo = reportMonth(d);
      const prevKey = (y - 1) + "-" + String(mo).padStart(2, "0") + "-" + (mo === 3 ? "31" : "30");
      const prev = byKeyQ[prevKey];
      if (!prev) continue;
      const revG = num(prev.TOTAL_OPERATE_INCOME) ? (num(r.TOTAL_OPERATE_INCOME) - num(prev.TOTAL_OPERATE_INCOME)) / Math.abs(num(prev.TOTAL_OPERATE_INCOME)) : null;
      const profG = num(prev.PARENT_NETPROFIT) ? (num(r.PARENT_NETPROFIT) - num(prev.PARENT_NETPROFIT)) / Math.abs(num(prev.PARENT_NETPROFIT)) : null;
      growth.quarterly.push({ date: d.slice(0, 10), revGrowth: revG, profitGrowth: profG });
    }
  } else {
    na("growth", "该标的无财报数据（ETF/指数类）");
  }
  ext.growth = growth;

  // ===== 分红 =====
  const div = {};
  {
    const rows = (data.dividends || []).slice().sort((a, b) => String(a.EX_DIVIDEND_DATE || "").localeCompare(String(b.EX_DIVIDEND_DATE || "")));
    const byYear = {};
    for (const r of rows) {
      const y = String(r.EX_DIVIDEND_DATE || "").slice(0, 4);
      if (!/^\d{4}$/.test(y)) continue;
      byYear[y] = (byYear[y] || 0) + num(r.PRETAX_BONUS_RMB);
    }
    const years = Object.keys(byYear).sort();
    div.byYear = years.map((y) => ({ year: y, per10: byYear[y] }));
    div.yearsPaying = years.length;
    let consec = 0;
    for (let i = years.length - 1; i > 0; i--) {
      if (byYear[years[i]] > byYear[years[i - 1]]) consec++;
      else break;
    }
    div.consecGrowthYears = years.length >= 2 ? consec : 0;
    const dpsSeries = years.map((y) => ({ year: parseInt(y, 10), value: byYear[y] / 10 })).filter((x) => x.value > 0);
    div.cagr3 = cagrFromAnnual(dpsSeries, 3);
    div.cagr5 = cagrFromAnnual(dpsSeries, 5);
    div.cagr10 = cagrFromAnnual(dpsSeries, 10);
    div.payoutFcf = (m.dps12m != null && m.ttmFcf && m.totalShares) ? (m.dps12m * m.totalShares) / m.ttmFcf : null;
    if (rows.length >= 2) {
      const first = new Date(rows[0].EX_DIVIDEND_DATE), last = new Date(rows[rows.length - 1].EX_DIVIDEND_DATE);
      const spanY = Math.max(1, (last - first) / (365.25 * 864e5));
      const perYear = rows.length / spanY;
      div.frequency = perYear >= 1.5 ? "一年多次（约每年 " + perYear.toFixed(1) + " 次）" : "一年一次";
    } else div.frequency = rows.length ? "一年一次" : "无分红记录";
    div.lastExDate = rows.length ? String(rows[rows.length - 1].EX_DIVIDEND_DATE || "").slice(0, 10) : null;
    div.lastPlan = rows.length ? rows[rows.length - 1].IMPL_PLAN_PROFILE : null;
    div.weiss = null; na("weiss", "Weiss 公允价值区间是 AleInversor 专有指标，无公开算法");
  }
  ext.dividend = div;

  // ===== 技术指标 =====
  const tech = {};
  if (klineD.length >= 30) {
    const closes = klineD.map((k) => k.close);
    const highs = klineD.map((k) => k.high);
    const lows = klineD.map((k) => k.low);
    const n = closes.length;
    const last = (arr) => arr[arr.length - 1];
    const ma = (p) => { const s = smaSeries(closes, p); return last(s); };
    tech.ma5 = ma(5); tech.ma10 = ma(10); tech.ma20 = ma(20); tech.ma50 = ma(50);
    tech.ma60 = ma(60); tech.ma120 = ma(120); tech.ma200 = ma(200); tech.ma250 = ma(250);
    tech.ma1000 = n >= 1000 ? ma(1000) : null;
    if (tech.ma1000 == null) na("ma1000", "需 1000 根日线，当前仅 " + n + " 根");
    const bbMid = smaSeries(closes, 20), bbStd = stdSeries(closes, 20);
    tech.bollMid = last(bbMid);
    tech.bollUp = (last(bbMid) != null && last(bbStd) != null) ? last(bbMid) + 2 * last(bbStd) : null;
    tech.bollLow = (last(bbMid) != null && last(bbStd) != null) ? last(bbMid) - 2 * last(bbStd) : null;
    tech.bollSeries = { mid: bbMid, up: bbMid.map((v, i) => (v != null && bbStd[i] != null ? v + 2 * bbStd[i] : null)), low: bbMid.map((v, i) => (v != null && bbStd[i] != null ? v - 2 * bbStd[i] : null)) };
    tech.rsi = calcRSI(closes, 14);
    tech.rsiSeries = rsiSeries(closes, 14);
    const ema12 = emaSeries(closes, 12), ema26 = emaSeries(closes, 26);
    const dif = closes.map((_, i) => (ema12[i] != null && ema26[i] != null ? ema12[i] - ema26[i] : null));
    const dea = emaSeries(dif, 9);
    tech.macd = { dif: last(dif), dea: last(dea), hist: (last(dif) != null && last(dea) != null) ? (last(dif) - last(dea)) * 2 : null, difSeries: dif, deaSeries: dea };
    tech.adx = calcADX(klineD, 14);
    tech.stoch = calcStoch(highs, lows, closes, 14);
    const st = stochSeries(highs, lows, closes, 14);
    tech.stochKSeries = st.k; tech.stochDSeries = st.d;
    tech.williams = calcWilliams(highs, lows, closes, 14);
    tech.williamsSeries = williamsSeries(highs, lows, closes, 14);
    const w60 = klineD.slice(-60);
    tech.support60 = Math.min(...w60.map((k) => k.low));
    tech.resist60 = Math.max(...w60.map((k) => k.high));
    const w250 = klineD.slice(-250);
    tech.high52 = Math.max(...w250.map((k) => k.high));
    tech.low52 = Math.min(...w250.map((k) => k.low));
    const sig = [];
    const price = closes[n - 1];
    if (tech.ma50 != null && tech.ma200 != null) {
      const prevMa50 = smaSeries(closes.slice(0, -1), 50).pop();
      const prevMa200 = smaSeries(closes.slice(0, -1), 200).pop();
      if (prevMa50 != null && prevMa200 != null) {
        if (tech.ma50 > tech.ma200 && prevMa50 <= prevMa200) sig.push("GOLDEN CROSS（金叉：MA50 上穿 MA200）");
        if (tech.ma50 < tech.ma200 && prevMa50 >= prevMa200) sig.push("DEATH CROSS（死叉：MA50 下穿 MA200）");
      }
    }
    if (tech.macd.dif != null && tech.macd.dea != null) {
      const pd = dif[dif.length - 2], ps = dea[dea.length - 2];
      if (pd != null && ps != null) {
        if (tech.macd.dif > tech.macd.dea && pd <= ps) sig.push("MACD 金叉");
        if (tech.macd.dif < tech.macd.dea && pd >= ps) sig.push("MACD 死叉");
      }
    }
    if (tech.rsi != null) {
      if (tech.rsi >= 70) sig.push("RSI 超买（" + tech.rsi.toFixed(1) + "）");
      else if (tech.rsi <= 30) sig.push("RSI 超卖（" + tech.rsi.toFixed(1) + "）");
    }
    if (tech.ma20 != null && tech.ma60 != null) sig.push(tech.ma20 > tech.ma60 ? "均线多头（MA20 > MA60）" : "均线空头（MA20 ≤ MA60）");
    if (price > tech.ma60) sig.push("站上 MA60"); else sig.push("位于 MA60 下方");
    tech.signals = sig;
    let bull = 0, bear = 0;
    if (tech.rsi != null) { if (tech.rsi > 50) bull++; else bear++; }
    if (tech.macd.dif != null && tech.macd.dea != null) { if (tech.macd.dif > tech.macd.dea) bull++; else bear++; }
    if (tech.ma20 != null && tech.ma60 != null) { if (tech.ma20 > tech.ma60) bull++; else bear++; }
    if (price > tech.ma60) bull++; else bear++;
    if (tech.stoch != null && tech.stoch.k != null) { if (tech.stoch.k > 50) bull++; else bear++; }
    tech.trend = bull > bear + 1 ? "ALCISTA（偏多）" : bear > bull + 1 ? "BAJISTA（偏空）" : "MIXTO（中性）";
  } else {
    na("technical", "K 线不足 30 根");
  }
  ext.technical = tech;

  // ===== 回撤统计 =====
  const dd = {};
  if (klineD.length >= 30) {
    const closes = klineD.map((k) => k.close);
    const dates = klineD.map((k) => k.date);
    let peak = -Infinity, peakIdx = 0, maxDd = 0, maxDdPeakIdx = 0, maxDdTroughIdx = 0;
    const ddSeries = [];
    closes.forEach((c, i) => {
      if (c > peak) { peak = c; peakIdx = i; }
      const d = c / peak - 1;
      ddSeries.push(d);
      if (d < maxDd) { maxDd = d; maxDdPeakIdx = peakIdx; maxDdTroughIdx = i; }
    });
    dd.maxDrawdown = maxDd;
    dd.peakDate = dates[maxDdPeakIdx];
    dd.troughDate = dates[maxDdTroughIdx];
    let recDays = null;
    for (let i = maxDdTroughIdx + 1; i < closes.length; i++) {
      if (closes[i] >= closes[maxDdPeakIdx]) { recDays = i - maxDdTroughIdx; break; }
    }
    dd.recoveryDays = recDays;
    dd.currentDrawdown = ddSeries[ddSeries.length - 1];
    dd.avgDrawdown = ddSeries.reduce((a, b) => a + b, 0) / ddSeries.length;
    const underwater = ddSeries.filter((v) => v < -0.001).length;
    dd.timeUnderwater = underwater / ddSeries.length;
    const rets = [];
    for (let i = 1; i < closes.length; i++) rets.push(closes[i] / closes[i - 1] - 1);
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance = rets.reduce((a, b) => a + (b - mean) * (b - mean), 0) / rets.length;
    const volDaily = Math.sqrt(variance);
    dd.annualVol = volDaily * Math.sqrt(250);
    const periodRet = closes[closes.length - 1] / closes[0] - 1;
    const annRet = Math.pow(closes[closes.length - 1] / closes[0], 250 / closes.length) - 1;
    dd.periodReturn = periodRet;
    dd.annualReturn = annRet;
    dd.calmar = maxDd < 0 ? annRet / Math.abs(maxDd) : null;
    dd.sharpe = volDaily > 0 ? (mean * 250) / (volDaily * Math.sqrt(250)) : null;
    let maxDown = 0, cur = 0;
    for (const r of rets) { if (r < 0) { cur++; maxDown = Math.max(maxDown, cur); } else cur = 0; }
    dd.maxDownDays = maxDown;
    dd.days = closes.length;
    dd.ddSeries = ddSeries;
  } else {
    na("drawdown", "K 线不足 30 根");
  }
  ext.drawdown = dd;

  // ===== 周期性：Beta vs 沪深300 =====
  const cyc = {};
  {
    const idx = data.indexKline || [];
    if (klineD.length >= 60 && idx.length >= 60) {
      const idxMap = {};
      idx.forEach((k) => { idxMap[k.date] = k.close; });
      const pairs = [];
      for (let i = 1; i < klineD.length; i++) {
        const d0 = klineD[i - 1].date, d1 = klineD[i].date;
        if (idxMap[d0] == null || idxMap[d1] == null) continue;
        pairs.push({
          rs: klineD[i].close / klineD[i - 1].close - 1,
          ri: idxMap[d1] / idxMap[d0] - 1,
        });
      }
      if (pairs.length >= 60) {
        const ms = pairs.reduce((a, p) => a + p.rs, 0) / pairs.length;
        const mi = pairs.reduce((a, p) => a + p.ri, 0) / pairs.length;
        let cov = 0, varI = 0, varS = 0;
        for (const p of pairs) {
          cov += (p.rs - ms) * (p.ri - mi);
          varI += (p.ri - mi) * (p.ri - mi);
          varS += (p.rs - ms) * (p.rs - ms);
        }
        cov /= pairs.length; varI /= pairs.length; varS /= pairs.length;
        cyc.beta = varI > 0 ? cov / varI : null;
        cyc.corr = (varI > 0 && varS > 0) ? cov / Math.sqrt(varI * varS) : null;
        cyc.days = pairs.length;
        const first = klineD[klineD.length - pairs.length - 1];
        const stockRet = klineD[klineD.length - 1].close / first.close - 1;
        const idxDates = idx.map((k) => k.date);
        const i0 = idxDates.indexOf(first.date);
        const idxRet = i0 >= 0 ? idx[idx.length - 1].close / idx[i0].close - 1 : null;
        cyc.stockReturn = stockRet;
        cyc.indexReturn = idxRet;
        cyc.relativeReturn = idxRet != null ? stockRet - idxRet : null;
        cyc.verdict = cyc.beta == null ? "—"
          : cyc.beta > 1.2 ? "高 Beta：比大盘波动更大，周期性/进攻性强"
          : cyc.beta > 0.8 ? "Beta 接近 1：跟随大盘"
          : "低 Beta：比大盘波动小，偏防御";
      } else na("beta", "与沪深300可对齐的交易日不足 60 个");
    } else na("beta", "个股或沪深300 K 线不足 60 根");
  }
  ext.cyclicality = cyc;

  // ===== 历史 PE（年末收盘价 / 当年 EPS）=====
  const peHist = {};
  {
    const ann = annualRows(data.income || []);
    const rows = [];
    const kByYear = {};
    (data.klineD || []).forEach((k) => {
      const y = parseInt(String(k.date).slice(0, 4), 10);
      kByYear[y] = k.close;
    });
    for (const r of ann) {
      const y = reportYear(dateField(r));
      const eps = num(r.BASIC_EPS);
      const close = kByYear[y];
      if (eps > 0 && close) rows.push({ year: y, pe: close / eps, close, eps });
    }
    peHist.rows = rows.sort((a, b) => a.year - b.year);
    peHist.median5 = median(rows.slice(-5).map((x) => x.pe));
    peHist.median10 = median(rows.slice(-10).map((x) => x.pe));
    peHist.current = m.peTtm;
    if (!rows.length) na("peHist", "无年报 EPS 或年末收盘价");
  }
  ext.peHistory = peHist;

  // ===== EPS 预测（自设增速 + 退出 PE；非分析师一致预期）=====
  ext.epsProjection = function (growthPct, years, exitPe) {
    const eps0 = m.ttmEps;
    if (eps0 == null || eps0 <= 0) return { usable: false, reason: "无 TTM EPS" };
    const g = growthPct / 100;
    const epsN = eps0 * Math.pow(1 + g, years);
    const priceN = epsN * exitPe;
    return {
      usable: true, eps0, growth: g, years, exitPe, epsN, priceN,
      upside: m.price ? (priceN / m.price - 1) * 100 : null,
      verdict: priceN > (m.price || 0) * 1.2 ? "MUY ATRACTIVO（预测价高于现价 20% 以上）"
        : priceN > (m.price || 0) ? "INTERESANTE（预测价高于现价）" : "POCO ATRACTIVO（预测价低于现价）",
      note: "用自设增速与退出 PE 推算，非分析师一致预期；A 股无公开一致预期 EPS 数据。",
    };
  };

  return ext;
}

// ---------- RSI(14) Wilder（单值）----------
function calcRSI(closes, period = 14) {
  const s = rsiSeries(closes, period);
  return s.length ? s[s.length - 1] : null;
}
// RSI 完整序列（Wilder 平滑，逐根推进；前 period 根为 null）
function rsiSeries(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch > 0) gain += ch; else loss -= ch;
  }
  let avgGain = gain / period, avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(ch, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-ch, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}
// Stochastic %K/%D 完整序列
function stochSeries(highs, lows, closes, period = 14) {
  const k = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const hh = Math.max(...highs.slice(i - period + 1, i + 1));
    const ll = Math.min(...lows.slice(i - period + 1, i + 1));
    k[i] = hh === ll ? 50 : (closes[i] - ll) / (hh - ll) * 100;
  }
  const d = new Array(closes.length).fill(null);
  for (let i = period + 1; i < closes.length; i++) {
    if (k[i] != null && k[i - 1] != null && k[i - 2] != null) d[i] = (k[i] + k[i - 1] + k[i - 2]) / 3;
  }
  return { k, d };
}
// Williams %R 完整序列
function williamsSeries(highs, lows, closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const hh = Math.max(...highs.slice(i - period + 1, i + 1));
    const ll = Math.min(...lows.slice(i - period + 1, i + 1));
    out[i] = hh === ll ? null : (hh - closes[i]) / (hh - ll) * -100;
  }
  return out;
}
// ---------- ADX(14) Wilder ----------
function calcADX(klines, period = 14) {
  if (klines.length < period * 2 + 1) return null;
  const tr = [], plusDM = [], minusDM = [];
  for (let i = 1; i < klines.length; i++) {
    const h = klines[i].high, l = klines[i].low, pc = klines[i - 1].close;
    const ph = klines[i - 1].high, pl = klines[i - 1].low;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    const up = h - ph, dn = pl - l;
    plusDM.push(up > dn && up > 0 ? up : 0);
    minusDM.push(dn > up && dn > 0 ? dn : 0);
  }
  const wilder = (arr) => {
    const out = [];
    let s = 0;
    for (let i = 0; i < period; i++) s += arr[i];
    out.push(s);
    for (let i = period; i < arr.length; i++) out.push(out[out.length - 1] - out[out.length - 1] / period + arr[i]);
    return out;
  };
  const sTR = wilder(tr), sP = wilder(plusDM), sM = wilder(minusDM);
  const dx = [];
  let lastPdi = 0, lastMdi = 0;
  for (let i = 0; i < sTR.length; i++) {
    const pdi = sTR[i] ? 100 * sP[i] / sTR[i] : 0;
    const mdi = sTR[i] ? 100 * sM[i] / sTR[i] : 0;
    const sum = pdi + mdi;
    dx.push(sum ? 100 * Math.abs(pdi - mdi) / sum : 0);
    if (i === sTR.length - 1) { lastPdi = pdi; lastMdi = mdi; }
  }
  if (dx.length < period) return null;
  let adx = 0;
  for (let i = 0; i < period; i++) adx += dx[i];
  adx /= period;
  for (let i = period; i < dx.length; i++) adx = (adx * (period - 1) + dx[i]) / period;
  return { adx, plusDI: lastPdi, minusDI: lastMdi };
}
// ---------- Stochastic(14,3,3) ----------
function calcStoch(highs, lows, closes, period = 14) {
  if (closes.length < period) return null;
  const kRaw = [];
  for (let i = period - 1; i < closes.length; i++) {
    const hh = Math.max(...highs.slice(i - period + 1, i + 1));
    const ll = Math.min(...lows.slice(i - period + 1, i + 1));
    kRaw.push(hh === ll ? 50 : (closes[i] - ll) / (hh - ll) * 100);
  }
  const sma = (arr, p) => {
    if (arr.length < p) return null;
    return arr.slice(-p).reduce((a, b) => a + b, 0) / p;
  };
  return { k: lastOf(kRaw), d: sma(kRaw, 3) };
}
// ---------- Williams %R(14) ----------
function calcWilliams(highs, lows, closes, period = 14) {
  if (closes.length < period) return null;
  const i = closes.length - 1;
  const hh = Math.max(...highs.slice(i - period + 1, i + 1));
  const ll = Math.min(...lows.slice(i - period + 1, i + 1));
  if (hh === ll) return null;
  return (hh - closes[i]) / (hh - ll) * -100;
}
function lastOf(arr) { return arr.length ? arr[arr.length - 1] : null; }

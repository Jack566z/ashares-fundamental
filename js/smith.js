// ---------- 特里·史密斯方法 v7（按 AleInversor 图版重做）----------
// 图版：分析一家公司（评分环 x/10 + 星级 + 总分/49 + 13 行标准表）、
// 多家公司的排名（质量40/增长20/估值20/预期20）、特里·史密斯的标准（三原则+逐行标准+得分方式）。
// 口径：全部用东财 F10 三大报表年报序列算（季度锚点 2026Q3、年报锚点 2025 年报，
// 与本站其他模块同口径）；年报行 = 季度表里的 12 月行（annualRows）。
// 诚实标注：算不出的项（稀释 SBC、ROCE vs WACC、EV/EBITDA）标 N/A 并写原因，不编数。
// 满分口径：12 行标准各最多 4 分（去年 1 + 中位/CAGR 1 + 趋势 1 + 稳定 1），
// ROCE>WACC 单独 1 分，合计 49 分；N/A 项不计入分母（按图版规则：按可测量项计分）。

function smithNum(v) { const n = parseFloat(v); return isFinite(n) ? n : null; }

// 年报序列（升序，近 N 年）：每行含原始字段 + 派生指标
function smithBuildAnnual(data, m, years) {
  const inc = mergeIncome(data.income || [], data.incomeFull || []);
  const bal = data.balance || [];
  const cf = data.cashflow || [];
  // 取近 years+1 个年报：算 N 年 CAGR 需要首尾 N+1 个点（如 10 年 CAGR 需 2015→2025 共 11 个年报）；
  // 注意 annualRows 返回降序（最新在前），取前 years+1 行再升序；中位/趋势/稳定按全序列算，页上注明序列年份范围。
  const incAnn = annualRows(inc).slice(0, years + 1);
  const balByYear = {};
  annualRows(bal).forEach((r) => { balByYear[reportYear(dateField(r))] = r; });
  const cfByYear = {};
  annualRows(cf).forEach((r) => { cfByYear[reportYear(dateField(r))] = r; });
  const epsByYear = {};
  annualRows(data.income || []).forEach((r) => { epsByYear[reportYear(dateField(r))] = smithNum(r.BASIC_EPS); });
  const out = [];
  for (const r of incAnn) {
    const y = reportYear(dateField(r));
    const b = balByYear[y] || {};
    const c = cfByYear[y] || {};
    const rev = smithNum(r.TOTAL_OPERATE_INCOME);
    const cost = smithNum(r.OPERATE_COST);
    const op = smithNum(r.OPERATE_PROFIT);
    const fin = smithNum(r.FINANCE_EXPENSE);
    const net = smithNum(r.PARENT_NETPROFIT);
    const assets = smithNum(b.TOTAL_ASSETS);
    const liab = smithNum(b.TOTAL_LIABILITIES);
    const cash = smithNum(b.MONETARYFUNDS);
    const opCf = smithNum(c.NETCASH_OPERATE);
    const capex = smithNum(c.CONSTRUCT_LONG_ASSET);
    const ebit = (op != null) ? op + (fin || 0) : null;
    const fcf = (opCf != null && capex != null) ? opCf - capex : null;
    out.push({
      year: y,
      rev, net, op, fin, ebit, assets, liab, cash, opCf, capex, fcf,
      eps: epsByYear[y] != null ? epsByYear[y] : null,
      // 每股自由现金流：以当前总股本折算（历史总股本未披露），页上会注明
      fcfPs: (fcf != null && m.totalShares) ? fcf / m.totalShares : null,
      roce: (ebit != null && assets) ? ebit / assets : null,
      gross: (rev != null && cost != null) ? (rev - cost) / rev : null,
      opMargin: (rev != null && op != null) ? op / rev : null,
      cashConv: (fcf != null && net != null && net !== 0) ? fcf / net : null,
      intCover: (op != null && fin != null) ? (fin <= 0 ? Infinity : op / fin) : null,
      netDebt: (liab != null && cash != null) ? liab - cash : null,
      netDebtFcf: null, // 下面填（需 fcf）
      capexSales: (capex != null && rev != null && rev !== 0) ? capex / rev : null,
      capexOpCf: (capex != null && opCf != null && opCf !== 0) ? capex / opCf : null,
      fcfYield: (fcf != null && m.totalMcap) ? fcf / m.totalMcap : null,
    });
  }
  out.forEach((r) => {
    r.netDebtFcf = (r.netDebt != null && r.fcf != null && r.fcf > 0) ? r.netDebt / r.fcf : null;
  });
  return out.sort((a, b) => a.year - b.year);
}

// YoY 序列（升序，长度 = 年数-1）
function smithYoY(series, field) {
  const out = [];
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1][field], b = series[i][field];
    out.push((a != null && b != null && a !== 0) ? b / a - 1 : null);
  }
  return out;
}
// 10 年 CAGR（要求首尾 >0）
function smithCAGR(series, field, years) {
  const s = series.filter((r) => r[field] != null);
  if (s.length < 2) return null;
  const last = s[s.length - 1];
  const first = s.find((r) => r.year === last.year - years);
  if (!first || first[field] <= 0 || last[field] <= 0) return null;
  return Math.pow(last[field] / first[field], 1 / years) - 1;
}
// 稳定性：变异系数 CV=std/|mean|；均值<=0 或跨零时按符号一致性兜底
function smithStability(values) {
  const v = (values || []).filter((x) => x != null && isFinite(x));
  if (v.length < 5) return { label: "数据不足", pts: 0, na: true };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  if (mean <= 0 || v.some((x) => x < 0)) {
    const allSameSign = v.every((x) => x > 0) || v.every((x) => x < 0);
    const mx = Math.max(...v.map(Math.abs)), mn = Math.min(...v.map(Math.abs));
    if (allSameSign && mn > 0 && mx / mn < 2) return { label: "稳定", pts: 0.5, na: false };
    return { label: "不稳定", pts: 0, na: false };
  }
  const sd = Math.sqrt(v.reduce((a, x) => a + (x - mean) * (x - mean), 0) / v.length);
  const cv = sd / mean;
  if (cv <= 0.15) return { label: "非常稳定", pts: 1, na: false };
  if (cv <= 0.3) return { label: "稳定", pts: 0.5, na: false };
  if (cv <= 0.6) return { label: "一般", pts: 0.25, na: false };
  return { label: "不稳定", pts: 0, na: false };
}
// 趋势：近 3 年均值 vs 前 3 年均值（higher=true 时上升为改善，false 时下降为改善）
function smithTrend(values, higher) {
  const v = (values || []).filter((x) => x != null && isFinite(x));
  if (v.length < 6) return { improved: null, label: "序列不足", na: true };
  const last3 = v.slice(-3), prev3 = v.slice(-6, -3);
  const m1 = last3.reduce((a, b) => a + b, 0) / 3;
  const m0 = prev3.reduce((a, b) => a + b, 0) / 3;
  const improved = higher ? m1 > m0 : m1 < m0;
  return { improved, label: improved ? "▲ 改善" : "▼ 恶化", na: false, last3mean: m1, prev3mean: m0 };
}

// 单行打分：last（去年）1 分 + mid（中位/CAGR）1 分 + 趋势 1 分 + 稳定 1 分
function smithScoreRow(def, series, horizon) {
  const vals = series.map((r) => r[def.field]).filter((v) => v != null && isFinite(v));
  let last = series.length ? series[series.length - 1][def.field] : null;
  if (def.midType === "cagr") {
    // 增长项的"去年"是最新一年同比增速，不是原值水平（原值当百分比会显示 34907908285200.0% 这类错数）；
    // 仅当首尾均为正时同比才有意义，FCF 为负的年份记 N/A（不计分母）。
    const yoy = smithYoY(series, def.field);
    const prev = series.length > 1 ? series[series.length - 2][def.field] : null;
    const lv = yoy.length ? yoy[yoy.length - 1] : null;
    last = (lv != null && last != null && last > 0 && prev != null && prev > 0) ? lv : null;
  }
  const lastOk = last != null && isFinite(last);
  let mid = null, midOk = false;
  if (def.midType === "cagr") {
    mid = smithCAGR(series, def.field, horizon);
    midOk = mid != null;
  } else {
    mid = median(vals);
    midOk = mid != null;
  }
  const pass = (v) => v != null && (def.better === "high" ? v > def.req : v < def.req);
  const trend = smithTrend(series.map((r) => r[def.field]), def.better === "high");
  const stabVals = def.stabField === "yoy" ? smithYoY(series, def.field) : vals;
  const stab = smithStability(stabVals);
  let pts = 0, max = 4;
  const parts = { last: null, mid: null, trend: null, stab: null };
  if (lastOk) { parts.last = pass(last) ? 1 : 0; pts += parts.last; } else { max -= 1; parts.last = "na"; }
  if (midOk) { parts.mid = pass(mid) ? 1 : 0; pts += parts.mid; } else { max -= 1; parts.mid = "na"; }
  if (!trend.na) { parts.trend = trend.improved ? 1 : 0; pts += parts.trend; } else { max -= 1; parts.trend = "na"; }
  if (!stab.na) { parts.stab = stab.pts; pts += stab.pts; } else { max -= 1; parts.stab = "na"; }
  return {
    key: def.key, label: def.label, sub: def.sub, reqText: def.reqText,
    last: lastOk ? last : null, mid, midType: def.midType,
    trend, stab, pts, max, parts,
    spark: series.map((r) => r[def.field]),
    years: series.map((r) => r.year),
  };
}

// 12 行标准定义（要求与图版一致）
const SMITH_DEFS = [
  { key: "roce", label: "ROCE", sub: "已用资本回报率", field: "roce", better: "high", req: 0.15, reqText: "大于15%", midType: "median" },
  { key: "rev", label: "销售额", sub: "营收增长", field: "rev", better: "high", req: 0.07, reqText: "年增长率超过7%", midType: "cagr", stabField: "yoy" },
  { key: "fcfps", label: "每股自由现金流", sub: "每股自由现金流增长", field: "fcfPs", better: "high", req: 0.10, reqText: "年增长率超过10%", midType: "cagr", stabField: "yoy" },
  { key: "gross", label: "毛利率", sub: "毛利率", field: "gross", better: "high", req: 0.40, reqText: "大于40%", midType: "median" },
  { key: "opmargin", label: "营业利润率", sub: "营业利润率", field: "opMargin", better: "high", req: 0.15, reqText: "大于15%", midType: "median" },
  { key: "cashconv", label: "现金转换", sub: "自由现金流 / 净利润", field: "cashConv", better: "high", req: 0.90, reqText: "超过90%", midType: "median" },
  { key: "fcfyield", label: "自由现金流收益率", sub: "自由现金流 / 市值", field: "fcfYield", better: "high", req: 0.043, reqText: "高于10年期债券收益率", midType: "median" },
  { key: "intcover", label: "利息保障倍数", sub: "营业利润 / 财务费用", field: "intCover", better: "high", req: 10, reqText: "超过 10 次", midType: "median" },
  { key: "netdebtfcf", label: "净债务/自由现金流", sub: "净债务 / 自由现金流", field: "netDebtFcf", better: "low", req: 3, reqText: "3年以下", midType: "median" },
  { key: "capexsales", label: "资本支出/销售额", sub: "购建长期资产 / 营收", field: "capexSales", better: "low", req: 0.10, reqText: "不到10%", midType: "median" },
  { key: "capexopcf", label: "资本支出/经营现金流", sub: "购建长期资产 / 经营现金流", field: "capexOpCf", better: "low", req: 0.20, reqText: "不到20%", midType: "median" },
  { key: "dilution", label: "稀释", sub: "股权激励 / 自由现金流", field: null, better: "low", req: 0.10, reqText: "不到10%", midType: "median", naReason: "股权激励费用（SBC）未从公开 F10 接口获得，无法计算" },
];

// 单家分析主函数：data=fetchStockAll 返回，m=calcMetrics 返回
function calcSmithFull(data, m, horizon) {
  horizon = horizon || 10;
  const series = smithBuildAnnual(data, m, horizon);
  const rows = [];
  for (const def of SMITH_DEFS) {
    if (!def.field) {
      rows.push({ key: def.key, label: def.label, sub: def.sub, reqText: def.reqText, na: true, naReason: def.naReason, pts: 0, max: 0, spark: [], years: [] });
      continue;
    }
    const r = smithScoreRow(def, series, horizon);
    // 利息保障：财务费用<=0（净利息收入）时去年记为通过（无利息负担）
    if (def.key === "intcover") {
      const lastRow = series[series.length - 1];
      if (lastRow && lastRow.fin != null && lastRow.fin <= 0 && r.parts.last === 0) {
        r.pts += 1; r.parts.last = 1; r.intCoverNote = "净利息收入，无利息负担";
      }
    }
    rows.push(r);
  }
  // ROCE vs WACC：无 WACC 来源，整行 N/A（图版计分规则：N/A 不计入分母）
  rows.push({ key: "wacc", label: "ROCE WACC", sub: "ROCE 与资本成本比较", reqText: "ROCE 高于 WACC", na: true, naReason: "WACC（加权平均资本成本）无免费公开来源，无法计算", pts: 0, max: 0, spark: [], years: [] });
  const judged = rows.filter((r) => !r.na);
  const points = rows.reduce((a, r) => a + r.pts, 0);
  const maxPoints = rows.reduce((a, r) => a + r.max, 0);
  const score10 = maxPoints ? points / maxPoints * 10 : null;
  const stars = score10 != null ? Math.round(score10 / 2 * 2) / 2 : null;
  const grade = score10 == null ? "数据不足" : score10 >= 8 ? "质量优秀" : score10 >= 6.5 ? "质量好" : score10 >= 5 ? "可以接受" : "待改善";
  return { series, rows, judged: judged.length, points, maxPoints, score10, stars, grade, horizon };
}

// ---------- 排名页：四项分量 ----------
// bandUp：越大越好（bad 以下 0 分，good 以上 100 分，之间线性）；bandDown：越小越好
function smithBandUp(v, bad, good) {
  if (v == null || !isFinite(v)) return null;
  if (v >= good) return 100; if (v <= bad) return 0;
  return (v - bad) / (good - bad) * 100;
}
function smithBandDown(v, good, bad) {
  if (v == null || !isFinite(v)) return null;
  if (v <= good) return 100; if (v >= bad) return 0;
  return (bad - v) / (bad - good) * 100;
}
function smithAvgParts(parts) {
  const v = parts.filter((x) => x != null && isFinite(x));
  if (!v.length) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

// reports：fetchReports(code) 的返回（90 天内研报）
function smithRankComponents(data, m, reports, horizon) {
  horizon = horizon || 10;
  const full = calcSmithFull(data, m, horizon);
  const series = full.series;
  const quality = full.score10 != null ? full.score10 / 10 * 100 : null;
  const revCagr = smithCAGR(series, "rev", horizon);
  const epsSeries = series.map((r) => ({ year: r.year, eps: r.eps }));
  const epsCagr = smithCAGR(epsSeries, "eps", horizon);
  const fcfPsCagr = smithCAGR(series, "fcfPs", horizon);
  const growth = smithAvgParts([
    smithBandUp(revCagr, 0, 0.15),
    smithBandUp(epsCagr, 0, 0.15),
    smithBandUp(fcfPsCagr, 0, 0.15),
  ]);
  // 估值：PE-TTM（绝对档位）+ 自由现金流收益率；EV/EBITDA 因无折旧摊销算不出，已排除（页上注明）
  const fcfYieldNow = series.length ? series[series.length - 1].fcfYield : null;
  const valuation = smithAvgParts([
    smithBandDown(m.peTtm, 15, 40),
    smithBandUp(fcfYieldNow, 0.02, 0.08),
  ]);
  // 预期：分析师 EPS 预测增速 + 目标价上行空间（90 天内研报；无研报则 N/A）
  let expected = null, expectedNote = "";
  const reps = (reports || []).filter((r) => r.epsThisYear != null || r.epsNextYear != null || r.aimPriceT != null);
  if (reps.length) {
    const r0 = reps[0];
    const parts = [];
    if (r0.epsThisYear != null && r0.epsNextYear != null && r0.epsThisYear > 0) {
      parts.push(smithBandUp(r0.epsNextYear / r0.epsThisYear - 1, 0, 0.2));
    }
    if (r0.aimPriceT != null && m.price != null && m.price > 0) {
      parts.push(smithBandUp(r0.aimPriceT / m.price - 1, 0, 0.3));
    }
    expected = smithAvgParts(parts);
    expectedNote = reps.length + " 篇研报（" + (r0.org || "") + " 等，近 90 天）";
    if (expected == null) expectedNote = "有研报但无可用 EPS 预测/目标价";
  } else {
    expectedNote = "近 90 天无分析师研报";
  }
  return { quality, growth, valuation, expected, expectedNote, full };
}
function smithRankTotal(comp, method) {
  const w = method === "quality" ? { q: 1, g: 0, v: 0, e: 0 } : { q: 0.4, g: 0.2, v: 0.2, e: 0.2 };
  const parts = [[comp.quality, w.q], [comp.growth, w.g], [comp.valuation, w.v], [comp.expected, w.e]];
  let s = 0, tw = 0;
  for (const [v, wt] of parts) { if (v != null && wt > 0) { s += v * wt; tw += wt; } }
  return tw ? s / tw : null;
}

// 排名页单只取数（只拉史密斯需要的接口，不拉 K 线/日历/分红）
async function smithFetchMinimal(code) {
  const out = { code, errors: {} };
  const jobs = [
    ["quote", fetchEmQuote(code)],
    ["income", fetchIncome(code)],
    ["incomeFull", fetchIncomeFull(code)],
    ["balance", fetchBalance(code)],
    ["cashflow", fetchCashflow(code)],
    ["reports", fetchReports(code, 90, 3)],
  ];
  const results = await Promise.allSettled(jobs.map((j) => j[1]));
  jobs.forEach((j, i) => {
    if (results[i].status === "fulfilled") out[j[0]] = results[i].value;
    else { out[j[0]] = null; out.errors[j[0]] = String(results[i].reason && results[i].reason.message || results[i].reason); }
  });
  return out;
}

// 迷你走势 SVG（十年演变列用）：values 升序，null 断点跳过
function smithSparkSVG(values, w, h) {
  w = w || 90; h = h || 26;
  const v = (values || []).filter((x) => x != null && isFinite(x));
  if (v.length < 2) return "<span class=\"muted\">—</span>";
  const mn = Math.min(...v), mx = Math.max(...v);
  const span = mx - mn || 1;
  const pts = v.map((x, i) => ((i / (v.length - 1)) * (w - 4) + 2).toFixed(1) + "," + (h - 3 - ((x - mn) / span) * (h - 6)).toFixed(1)).join(" ");
  const last = v[v.length - 1];
  const color = last >= v[0] ? "#1a9e54" : "#e5484d";
  return "<svg width=\"" + w + "\" height=\"" + h + "\" viewBox=\"0 0 " + w + " " + h + "\"><polyline points=\"" + pts + "\" fill=\"none\" stroke=\"" + color + "\" stroke-width=\"1.6\"/></svg>";
}

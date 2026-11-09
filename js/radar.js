// ============================================================
// 低估雷达 v10 — 按 AleInversor 图版重做（评估差距 + 股息雷达）
// 评估差距：EPS 不断增长接近历史高位、股价平稳或下跌、市盈率低于历史
//   中位数 → 盈利增加但市场未反映在股价中（"价差"/GAP）。
// 股息雷达：杰拉尔丁·韦斯方法，股息收益率处历史区间高端（相对平均水平
//   价格较低）= 被低估，仅适用于股息稳定的公司。
// 数据口径（A 股免费接口，页上写明，不假装是 AleInversor 数据）：
//   成分股 = 东财 RPT_INDEX_CONSTITUENT；行情 = 东财 push2 + 腾讯 qt 批量；
//   EPS/净利润/营收 = 东财 LICO 利润表季度累计行；营业利润/所得税 = DMSK
//   利润表；资产负债率 = DMSK 资产负债表；自由现金流 = DMSK 现金流量表
//   （经营现金流 − 购建长期资产）；分红 = RPT_SHAREBONUS_DET。
// 明确算不出的项（页上标暂不可用，不编数）：
//   债务/EBITDA（免费三表无折旧摊销）；逐只分析师预期修正（无免费源）。
// 底层仍保留 v2 筛选（PE 静态 3–15、PB 0.5–2.5、市值>50 亿、剔退/ST）
//   作初筛；若某指数筛出不足 8 只，分档放宽并在页上写明放宽档位。
// ============================================================

// ---------- 纯函数（可单测） ----------
// 季度累计行 → TTM 序列。rows: [{date:"2026-09-30", v}]（年内累计值）。
// TTM(当季) = 当季累计 + 上年全年 − 上年同期累计。
function radarNormRows(rows, dateField, valueField) {
  const out = [];
  for (const r of rows || []) {
    const d = String(r[dateField] || "").slice(0, 10);
    const v = parseFloat(r[valueField]);
    if (!d || !isFinite(v)) continue;
    out.push({ date: d, v });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const ded = [];
  for (const p of out) {
    if (ded.length && ded[ded.length - 1].date === p.date) ded[ded.length - 1] = p;
    else ded.push(p);
  }
  return ded;
}
function radarTtmSeries(normRows) {
  const byKey = {};
  for (const p of normRows) {
    const y = +p.date.slice(0, 4), q = Math.floor((+p.date.slice(5, 7) - 1) / 3) + 1;
    byKey[y + "Q" + q] = p;
  }
  const out = [];
  for (const p of normRows) {
    const y = +p.date.slice(0, 4), q = Math.floor((+p.date.slice(5, 7) - 1) / 3) + 1;
    const prevSame = byKey[(y - 1) + "Q" + q], prevQ4 = byKey[(y - 1) + "Q4"];
    if (!prevSame || !prevQ4) continue;
    out.push({ date: p.date, ttm: p.v + prevQ4.v - prevSame.v });
  }
  return out;
}
// TTM 序列最新值 vs 一年前同期：{last, prev, growth}，不足 5 个季度返回 null。
function radarYoY(ttmSeries) {
  if (!ttmSeries || ttmSeries.length < 5) return null;
  const last = ttmSeries[ttmSeries.length - 1];
  const y = +last.date.slice(0, 4), m = last.date.slice(5, 7);
  const prev = ttmSeries.find((p) => p.date.slice(0, 4) === String(y - 1) && p.date.slice(5, 7) === m);
  if (!prev || !prev.ttm) return null;
  return { last: last.ttm, prev: prev.ttm, growth: last.ttm / prev.ttm - 1 };
}
function radarClamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function radarGrowthScore(g) { return (g == null || !isFinite(g)) ? 0 : radarClamp(g * 2 * 100, 0, 100); }

// 月 K 线（[{date, close}] 升序）→ 季度末收盘价 { "2026Q3": {date, close} }。
function radarQuarterCloses(klineM) {
  const map = {};
  for (const r of klineM || []) {
    const d = String(r.date || "").slice(0, 10);
    const c = parseFloat(r.close);
    if (!d || !isFinite(c)) continue;
    const y = +d.slice(0, 4), m = +d.slice(5, 7);
    if (m % 3 !== 0) continue;
    map[y + "Q" + (m / 3)] = { date: d, close: c };
  }
  return map;
}

// 单只股票的 GAP 全套信号。o: {code,name,price,peStatic,pb,roe,totalMcap,
//   lico[], full[], bal[], cf[], klineM[], windowYears, txPeTtm}
// lico/full/bal/cf 为东财原始行数组；klineM 为月 K 线 [{date,close}] 升序。
function radarCalcGapStock(o) {
  const epsT = radarTtmSeries(radarNormRows(o.lico, "REPORTDATE", "BASIC_EPS"));
  const revT = radarTtmSeries(radarNormRows(o.lico, "REPORTDATE", "TOTAL_OPERATE_INCOME"));
  const netT = radarTtmSeries(radarNormRows(o.lico, "REPORTDATE", "PARENT_NETPROFIT"));
  const opT = radarTtmSeries(radarNormRows(o.full, "REPORT_DATE", "OPERATE_PROFIT"));
  const taxT = radarTtmSeries(radarNormRows(o.full, "REPORT_DATE", "INCOME_TAX"));
  const profT = radarTtmSeries(radarNormRows(o.full, "REPORT_DATE", "TOTAL_PROFIT"));
  const ocfT = radarTtmSeries(radarNormRows(o.cf, "REPORT_DATE", "NETCASH_OPERATE"));
  const capT = radarTtmSeries(radarNormRows(o.cf, "REPORT_DATE", "CONSTRUCT_LONG_ASSET"));
  const balRows = (o.bal || []).map((r) => ({
    date: String(r.REPORT_DATE || "").slice(0, 10),
    debtRatio: parseFloat(r.DEBT_ASSET_RATIO),
    tl: parseFloat(r.TOTAL_LIABILITIES), te: parseFloat(r.TOTAL_EQUITY),
  })).filter((r) => r.date && isFinite(r.debtRatio)).sort((a, b) => (a.date < b.date ? -1 : 1));

  const epsY = radarYoY(epsT), revY = radarYoY(revT), netY = radarYoY(netT);
  const ocfY = radarYoY(ocfT);
  // FCF TTM = 经营现金流 TTM − 购建长期资产 TTM（按季度对齐相减）
  const capByDate = {};
  for (const p of capT) capByDate[p.date] = p.ttm;
  const fcfT = ocfT.filter((p) => capByDate[p.date] != null).map((p) => ({ date: p.date, ttm: p.ttm - capByDate[p.date] }));
  const fcfY = radarYoY(fcfT);

  const epsGrowth = epsY ? epsY.growth : null;
  const revGrowth = revY ? revY.growth : null;
  const netGrowth = netY ? netY.growth : null;
  const fcfGrowth = fcfY ? fcfY.growth : null;
  const epsTtm = epsT.length ? epsT[epsT.length - 1].ttm : null;
  const fcfTtm = fcfT.length ? fcfT[fcfT.length - 1].ttm : null;
  const buybackPp = (epsGrowth != null && netGrowth != null) ? (epsGrowth - netGrowth) * 100 : null;
  const cashConv = (ocfT.length && netT.length && netT[netT.length - 1].ttm) ? ocfT[ocfT.length - 1].ttm / netT[netT.length - 1].ttm : null;

  // ROIC = NOPAT / (净资产+总负债)，NOPAT = 营业利润 TTM × (1 − 所得税率)。
  let roic = null, roicPrev = null, roicFromRoe = false;
  const opLast = opT.length ? opT[opT.length - 1] : null;
  const balLast = balRows.length ? balRows[balRows.length - 1] : null;
  if (opLast && balLast && isFinite(balLast.tl) && isFinite(balLast.te) && (balLast.tl + balLast.te) > 0) {
    const taxLast = taxT.length ? taxT[taxT.length - 1].ttm : null;
    const profLast = profT.length ? profT[profT.length - 1].ttm : null;
    let rate = (taxLast != null && profLast) ? taxLast / profLast : 0.25;
    rate = radarClamp(rate, 0, 0.5);
    roic = opLast.ttm * (1 - rate) / (balLast.tl + balLast.te);
    const opPrev = radarYoY(opT), taxPrev = radarYoY(taxT), profPrev = radarYoY(profT);
    const balPrev = balRows.length > 4 ? balRows[balRows.length - 5] : null;
    if (opPrev && taxPrev && profPrev && balPrev && isFinite(balPrev.tl) && isFinite(balPrev.te) && (balPrev.tl + balPrev.te) > 0) {
      let ratePrev = profPrev.prev ? taxPrev.prev / profPrev.prev : 0.25;
      ratePrev = radarClamp(ratePrev, 0, 0.5);
      roicPrev = opPrev.prev * (1 - ratePrev) / (balPrev.tl + balPrev.te);
    }
  }
  if (roic == null) {
    //  fallback：LICO 加权 ROE（页上标 "e"）
    const roeRows = radarNormRows(o.lico, "REPORTDATE", "WEIGHTAVG_ROE");
    if (roeRows.length && isFinite(roeRows[roeRows.length - 1].v)) {
      roic = roeRows[roeRows.length - 1].v / 100;
      roicFromRoe = true;
    }
  }

  // 负债：最新资产负债率及一年变化（取约 4 个季度前的行）。
  let debtRatio = null, debtChgPp = null;
  if (balRows.length) {
    debtRatio = balRows[balRows.length - 1].debtRatio;
    const prevBal = balRows.length > 4 ? balRows[balRows.length - 5] : null;
    if (prevBal) debtChgPp = debtRatio - prevBal.debtRatio;
  }

  // 窗口内季度 PE 序列 → PER %il（当前 PE 低于历史的比例；100% = 历史最低）。
  const qCloses = radarQuarterCloses(o.klineM);
  const winQ = [];
  const epsByQ = {};
  for (const p of epsT) {
    const y = +p.date.slice(0, 4), q = Math.floor((+p.date.slice(5, 7) - 1) / 3) + 1;
    epsByQ[y + "Q" + q] = p.ttm;
  }
  const qKeys = Object.keys(qCloses).sort().slice(-(o.windowYears * 4));
  for (const k of qKeys) {
    const e = epsByQ[k];
    if (e != null && e > 0 && qCloses[k].close > 0) winQ.push({ q: k, close: qCloses[k].close, eps: e, pe: qCloses[k].close / e });
  }
  let perPct = null, currentPe = null;
  if (epsTtm != null && epsTtm > 0 && o.price > 0) {
    currentPe = o.price / epsTtm;
    if (winQ.length >= 4) perPct = winQ.filter((x) => x.pe > currentPe).length / winQ.length * 100;
  } else if (o.txPeTtm > 0 && o.price > 0) {
    currentPe = o.txPeTtm;
  }
  // 窗口内股价涨跌（窗口起点月收盘 → 最新收盘）。
  let priceChg = null;
  const km = (o.klineM || []).filter((r) => isFinite(parseFloat(r.close)));
  if (km.length >= 2) {
    const first = parseFloat(km[0].close), last = parseFloat(km[km.length - 1].close);
    if (first > 0) priceChg = last / first - 1;
  }
  if (priceChg == null && o.chg60d != null) priceChg = o.chg60d / 100;

  const epsUp = epsGrowth != null && epsGrowth > 0;
  const fcfUp = fcfY != null && ((fcfY.prev <= 0 && fcfY.last > 0) || fcfY.growth > 0);
  const priceDown = priceChg != null && priceChg <= 0;
  const gapPass = epsUp && priceDown && perPct != null && perPct >= 50;

  const warnings = [];
  if (epsGrowth != null && epsGrowth < 0) warnings.push({ key: "epsDown", text: "EPS 下降（EPS TTM 同比 " + (epsGrowth * 100).toFixed(1) + "%）" });
  if (revGrowth != null && revGrowth < 0) warnings.push({ key: "revDown", text: "营收下滑（营收 TTM 同比 " + (revGrowth * 100).toFixed(1) + "%）" });
  if (debtRatio != null && debtRatio > 70) warnings.push({ key: "highDebt", text: "负债过高（资产负债率 " + debtRatio.toFixed(1) + "%）" });
  if (debtChgPp != null && debtChgPp > 5) warnings.push({ key: "debtUp", text: "负债快速上升（资产负债率一年 +" + debtChgPp.toFixed(1) + "pp）" });
  if (fcfTtm != null && fcfTtm < 0) warnings.push({ key: "cashBurn", text: "现金消耗（自由现金流 TTM 为负）" });
  if (cashConv != null && cashConv < 0.6) warnings.push({ key: "paperProfit", text: "账面利润（经营现金流÷净利润 " + (cashConv * 100).toFixed(0) + "%＜60%）" });
  if (roic != null && roic < 0.05 && roicPrev != null && roic < roicPrev) warnings.push({ key: "roicWeak", text: "ROIC 低且持续下跌（" + (roic * 100).toFixed(1) + "%）" });

  const perScore = perPct != null ? perPct : 50;
  const epsScore = radarGrowthScore(epsGrowth);
  const fcfScore = fcfUp ? radarClamp((fcfGrowth != null ? fcfGrowth : 0.2) * 100, 0, 100) : 0;
  const score = Math.round(perScore * 0.4 + epsScore * 0.3 + fcfScore * 0.3);
  const signal = epsUp && fcfUp ? "双倍" : epsUp ? "EPS" : fcfUp ? "FCF" : "—";
  const cleanGap = gapPass && warnings.length === 0;

  // 迷你图序列（窗口内季度点）：价格 / EPS TTM / FCF TTM。
  const spark = winQ.map((q) => {
    const f = fcfT.find((p) => p.date.slice(0, 4) === q.q.slice(0, 4) && Math.floor((+p.date.slice(5, 7) - 1) / 3) + 1 === +q.q.slice(5));
    return { q: q.q, price: q.close, eps: q.eps, fcf: f ? f.ttm : null };
  });

  return {
    code: o.code, name: o.name, price: o.price, peStatic: o.peStatic, pb: o.pb, roe: o.roe,
    totalMcap: o.totalMcap, changePct: o.changePct,
    epsGrowth, revGrowth, netGrowth, fcfGrowth, epsTtm, fcfTtm, buybackPp, cashConv,
    roic, roicPrev, roicFromRoe, debtRatio, debtChgPp, perPct, currentPe, priceChg,
    epsUp, fcfUp, priceDown, gapPass, cleanGap, warnings, score, signal, spark,
    quarters: winQ.length,
  };
}

// 迷你图 SVG：价格（蓝）— EPS TTM（深绿）— FCF TTM（灰虚线），各自窗口内标准化。
function radarSparkSvg(spark, w, h) {
  w = w || 120; h = h || 36;
  if (!spark || spark.length < 2) return `<span class="muted">—</span>`;
  function norm(key) {
    const vals = spark.map((p) => p[key]).filter((v) => v != null && isFinite(v));
    if (vals.length < 2) return null;
    const mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    const span = mx - mn || 1;
    return spark.map((p, i) => {
      if (p[key] == null || !isFinite(p[key])) return null;
      const x = spark.length === 1 ? w / 2 : (i / (spark.length - 1)) * (w - 4) + 2;
      const y = h - 3 - ((p[key] - mn) / span) * (h - 6);
      return x.toFixed(1) + "," + y.toFixed(1);
    });
  }
  const series = [
    { key: "price", color: "#2563eb", dash: "" },
    { key: "eps", color: "#15803d", dash: "" },
    { key: "fcf", color: "#6b7280", dash: " stroke-dasharray=\"3,2\"" },
  ];
  let lines = "";
  for (const s of series) {
    const pts = norm(s.key);
    if (!pts) continue;
    const joined = pts.filter(Boolean).join(" ");
    if (joined.split(" ").length < 2) continue;
    lines += `<polyline points="${joined}" fill="none" stroke="${s.color}" stroke-width="1.5"${s.dash}/>`;
  }
  if (!lines) return `<span class="muted">—</span>`;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block">${lines}</svg>`;
}

// ---------- 股息雷达（纯函数） ----------
// divRows: RPT_SHAREBONUS_DET 原始行。返回 {yieldPct, ttmDiv, yearsPaid, byYear}。
function radarYieldTtm(divRows, price) {
  const now = Date.now();
  const oneYear = 365 * 24 * 3600 * 1000;
  let ttm = 0;
  const byYear = {};
  for (const r of divRows || []) {
    const per = parseFloat(r.PRETAX_BONUS_RMB);
    if (!isFinite(per) || per <= 0) continue;
    const d = new Date(String(r.EX_DIVIDEND_DATE || "").slice(0, 10));
    if (isNaN(d.getTime())) continue;
    const y = d.getFullYear();
    byYear[y] = (byYear[y] || 0) + per / 10;
    if (now - d.getTime() <= oneYear) ttm += per / 10;
  }
  return {
    yieldPct: (price > 0 && ttm > 0) ? ttm / price * 100 : null,
    ttmDiv: ttm,
    yearsPaid: Object.keys(byYear).length,
    byYear,
  };
}
// 买入区间：floorPrice = 最新年化每股股息 ÷ 历史最高股息率；
// buyZone = 现价高于下限 ≤ margin%（低于下限也算，即更便宜）。
function radarDividendBuyZone(o) {
  // o: {divRows, klineM 月K [{date,close}] 升序, price, years, marginPct}
  const y = radarYieldTtm(o.divRows, o.price);
  const yearEndClose = {};
  for (const r of o.klineM || []) {
    const d = String(r.date || "").slice(0, 10);
    const c = parseFloat(r.close);
    if (!d || !isFinite(c) || +d.slice(5, 7) !== 12) continue;
    yearEndClose[+d.slice(0, 4)] = c;
  }
  const years = Object.keys(y.byYear).map(Number).sort().slice(-o.years);
  let maxYield = null, floorPrice = null, histLo = null, histHi = null;
  const hist = [];
  for (const yr of years) {
    const close = yearEndClose[yr];
    if (!close || !y.byYear[yr]) continue;
    const hy = y.byYear[yr] / close * 100;
    hist.push({ year: yr, div: y.byYear[yr], close, yieldPct: hy });
    if (maxYield == null || hy > maxYield) maxYield = hy;
    histLo = histLo == null ? hy : Math.min(histLo, hy);
    histHi = histHi == null ? hy : Math.max(histHi, hy);
  }
  if (maxYield != null && maxYield > 0 && y.ttmDiv > 0) floorPrice = y.ttmDiv / (maxYield / 100);
  let distAboveFloor = null, buyZone = false;
  if (floorPrice != null && floorPrice > 0 && o.price > 0) {
    distAboveFloor = (o.price - floorPrice) / floorPrice * 100;
    buyZone = distAboveFloor <= o.marginPct;
  }
  const stable = y.yearsPaid >= Math.max(1, o.years - 2);
  return {
    yieldPct: y.yieldPct, ttmDiv: y.ttmDiv, yearsPaid: y.yearsPaid, stable,
    hist, histLo, histHi, maxYield, floorPrice, distAboveFloor, buyZone,
    score: (buyZone ? 60 : 0) + (y.yieldPct != null ? Math.min(25, y.yieldPct * 2.5) : 0) + (stable ? 15 : 0),
  };
}

// ---------- 常量 ----------
const RADAR_INDEXES = {
  hs300: { code: "000300", name: "沪深300", desc: "300 只大中盘" },
  kc50: { code: "000688", name: "科创50", desc: "50 只科创板龙头" },
  zz100: { code: "000903", name: "中证100", desc: "100 只大盘蓝筹" },
  watch: { code: null, name: "我的自选股", desc: "本站 12 只关注股" },
};
const RADAR_GAP_STAGES = [
  { peMax: 15, pbMax: 2.5, label: "PE（静态）3–15、PB 0.5–2.5" },
  { peMax: 25, pbMax: 4, label: "PE（静态）3–25、PB 0.5–4（首档筛出不足 8 只，已放宽）" },
  { peMax: 40, pbMax: 6, label: "PE（静态）3–40、PB 0.5–6（二档仍不足 8 只，已放宽）" },
];
const RADAR_GAP_METHOD = "通过查看每股收益（EPS）与股价图表中的模式，一次性分析整个指数：寻找那些每股收益（EPS）不断增长并接近历史高位，而股价却保持平稳或下跌，且市盈率低于历史中位数的公司。换句话说，这些公司盈利增加，但市场尚未将其反映在股价中。选择一个指数，然后点击“分析”。";
const RADAR_DIV_METHOD = "根据杰拉尔丁·韦斯的建议，寻找处于买入区间的派息股票：这些公司的股息收益率处于历史区间的高端（相对于其平均水平而言价格较低），这通常表明它们被低估了。这仅适用于股息稳定的公司。选择一个指数，然后点击“分析”。";

// ---------- 状态 ----------
let radarTab = "gap";
let radarIndex = "hs300";
let radarWindow = 3;
let radarDivParams = { minY: 2, maxY: 10, margin: 8, years: 10 };
let radarCache = {};   // key -> {rows, note, stage, total, scannedAt}
let radarRunning = false;
let radarSigFilter = "all";   // all | eps | fcf | both
let radarViewFilter = "all";  // all | clean | trap
let radarAllCols = false;

// ---------- 批量拉取工具 ----------
// datacenter IN-list 批量拉表，按代码分组返回 {code: rows}（分页拉满，最多 4 页）。
async function radarBulkTable(table, columns, codes, sortColumns) {
  const inList = codes.map((c) => '"' + c + '"').join(",");
  const byCode = {};
  for (let page = 1; page <= 4; page++) {
    const rows = await emDatacenter(table, columns,
      "(SECURITY_CODE in (" + inList + "))",
      { pageNumber: page, pageSize: 1000, sortColumns, sortTypes: "-1" });
    if (!rows || !rows.length) break;
    for (const r of rows) {
      const c = r.SECURITY_CODE;
      if (!c) continue;
      (byCode[c] = byCode[c] || []).push(r);
    }
    if (rows.length < 1000) break;
  }
  return byCode;
}
// 并发池：fn(item, i)，失败记 __error 不中断；onProgress(done, total)。
async function radarMapPool(items, fn, concurrency, onProgress) {
  const out = new Array(items.length);
  let done = 0, idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      try { out[i] = await fn(items[i], i); }
      catch (e) { out[i] = { __error: String((e && e.message) || e) }; }
      done++;
      if (onProgress) { try { onProgress(done, items.length); } catch (e) {} }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, worker));
  return out;
}
function radarMoney(v) {
  if (v == null || !isFinite(v)) return "—";
  if (v >= 1e12) return (v / 1e12).toFixed(2) + "万亿";
  if (v >= 1e8) return (v / 1e8).toFixed(1) + "亿";
  if (v >= 1e4) return (v / 1e4).toFixed(1) + "万";
  return String(Math.round(v));
}
function radarNum(v, d) { return (v == null || !isFinite(v)) ? "—" : v.toFixed(d == null ? 2 : d); }
function radarPct(v) { return (v == null || !isFinite(v)) ? "—" : (v * 100).toFixed(1) + "%"; }
function radarSignedPct(v) { return (v == null || !isFinite(v)) ? "—" : (v > 0 ? "+" : "") + (v * 100).toFixed(1) + "%"; }
function radarSetProgress(pct, text) {
  const bar = document.getElementById("radarProgFill");
  const tx = document.getElementById("radarProgText");
  if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + "%";
  if (tx) tx.textContent = text || "";
}

// ---------- UI 外壳 ----------
async function renderRadar() {
  const el = document.getElementById("radarBody");
  if (!el) return;
  el.innerHTML = `
    <p class="muted" style="margin-bottom:10px">寻找 EPS 在涨、股价没涨、市盈率低于历史中位数的公司（评估差距），或股息率处历史高位、价格偏低的派息股（股息雷达）。数据来自东财 / 腾讯免费接口，全部实测计算，不编数。</p>
    <div class="radar-tabs" role="tablist">
      <button class="radar-tab${radarTab === "gap" ? " active" : ""}" data-radar-tab="gap">📊 评估差距</button>
      <button class="radar-tab${radarTab === "div" ? " active" : ""}" data-radar-tab="div">🟢 股息雷达 — 杰拉尔丁·韦斯</button>
    </div>
    <div id="radarTabBody"></div>`;
  el.querySelectorAll("[data-radar-tab]").forEach((b) => b.addEventListener("click", () => {
    if (radarTab === b.dataset.radarTab) return;
    radarTab = b.dataset.radarTab;
    renderRadar();
  }));
  radarRenderTabBody();
}

function radarIndexCards() {
  return Object.keys(RADAR_INDEXES).map((k) => {
    const ix = RADAR_INDEXES[k];
    const n = k === "watch" ? (typeof watchlist !== "undefined" ? watchlist.length : 12) : ix.desc;
    return `<button class="radar-card${radarIndex === k ? " sel" : ""}" data-radar-index="${k}">
      <span class="radar-card-name">${esc(ix.name)}</span>
      <span class="radar-card-desc">${esc(n)}</span>
    </button>`;
  }).join("");
}

function radarRenderTabBody() {
  const body = document.getElementById("radarTabBody");
  if (!body) return;
  const isGap = radarTab === "gap";
  const method = isGap ? RADAR_GAP_METHOD : RADAR_DIV_METHOD;
  const paramsHtml = isGap
    ? `<div class="radar-param"><label>窗口期（年）</label><input type="number" id="radarWindow" value="${radarWindow}" min="1" max="10" step="1"></div>`
    : `<div class="radar-param"><label>最低当前收益率（%）</label><input type="number" id="radarDivMinY" value="${radarDivParams.minY}" min="0" step="0.5"></div>
       <div class="radar-param"><label>最大当前收益率（%）</label><input type="number" id="radarDivMaxY" value="${radarDivParams.maxY}" min="0" step="0.5"></div>
       <div class="radar-param"><label>购买区域利润率（%）</label><input type="number" id="radarDivMargin" value="${radarDivParams.margin}" min="0" step="1"></div>
       <div class="radar-param"><label>用于计算的年份（最多 10 年）</label><input type="number" id="radarDivYears" value="${radarDivParams.years}" min="3" max="10" step="1"></div>`;
  const cacheKey = radarCacheKey();
  const cached = radarCache[cacheKey];
  body.innerHTML = `
    <p style="margin:12px 0">${esc(method)}</p>
    <div class="radar-analyze-card">
      <div class="radar-step">1. 选择要分析的指数</div>
      <div class="radar-cards">${radarIndexCards()}</div>
      <div class="radar-params">${paramsHtml}
        <button class="radar-analyze" id="radarRunBtn" ${radarRunning ? "disabled" : ""}>分析</button>
      </div>
      <div class="radar-links">
        <a href="#" id="radarWatchLink">▸ 或者分析您自己的股票代码列表</a>
        <span class="radar-watch-hint">想分析您自己的公司吗？加载您的投资组合和自选列表</span>
      </div>
      <div class="note-box">信号阈值：数据来自东财 / 腾讯免费接口，由本站实时拉取计算。分析整个指数需要批量下载大量数据，沪深300（300 只）最慢、科创50（50 只）最快，您可以在进度条上查看进度。反陷阱过滤（负债、现金流、收益质量）会剔除“假价差”，因此表中只留下值得关注的案例。</div>
      <div id="radarProgWrap" style="display:none;margin-top:10px">
        <div class="radar-progress"><div class="radar-progress-fill" id="radarProgFill" style="width:0%"></div></div>
        <p class="muted" id="radarProgText" style="margin-top:6px"></p>
      </div>
    </div>
    <div id="radarResults">${cached ? "" : `<p class="muted" style="text-align:center;padding:28px 0">选择上面的指数，然后单击“分析”。</p>`}</div>
    ${radarExplainerHtml()}
    <p class="muted" style="margin-top:12px">本工具为教育与量化分析用途，并非投资建议，请务必进行自己的分析。评分是筛选排序分，不是买入建议；低 PE/PB 可能是价值陷阱，请结合财报与分红页交叉验证。</p>`;
  body.querySelectorAll("[data-radar-index]").forEach((b) => b.addEventListener("click", () => {
    radarIndex = b.dataset.radarIndex;
    radarRenderTabBody();
  }));
  document.getElementById("radarWatchLink").addEventListener("click", (ev) => {
    ev.preventDefault();
    radarIndex = "watch";
    radarRenderTabBody();
  });
  document.getElementById("radarRunBtn").addEventListener("click", () => {
    if (isGap) {
      const w = parseInt((document.getElementById("radarWindow") || {}).value, 10);
      if (isFinite(w) && w >= 1 && w <= 10) radarWindow = w;
      radarRunGap();
    } else {
      const g = (id) => parseFloat((document.getElementById(id) || {}).value);
      const minY = g("radarDivMinY"), maxY = g("radarDivMaxY"), mg = g("radarDivMargin"), ys = g("radarDivYears");
      if (isFinite(minY) && minY >= 0) radarDivParams.minY = minY;
      if (isFinite(maxY) && maxY >= 0) radarDivParams.maxY = maxY;
      if (isFinite(mg) && mg >= 0) radarDivParams.margin = mg;
      if (isFinite(ys) && ys >= 3 && ys <= 10) radarDivParams.years = Math.round(ys);
      radarRunDiv();
    }
  });
  if (cached) radarRenderResults(cached);
}

function radarCacheKey() {
  return radarTab === "gap"
    ? "gap|" + radarIndex + "|" + radarWindow
    : "div|" + radarIndex + "|" + radarDivParams.minY + "|" + radarDivParams.maxY + "|" + radarDivParams.margin + "|" + radarDivParams.years;
}

// ---------- 评估差距：分析引擎 ----------
async function radarRunGap() {
  if (radarRunning) return;
  radarRunning = true;
  const wrap = document.getElementById("radarProgWrap");
  if (wrap) wrap.style.display = "block";
  const resEl = document.getElementById("radarResults");
  try {
    const ix = RADAR_INDEXES[radarIndex];
    radarSetProgress(4, "正在拉取" + ix.name + "成分股…");
    let cons;
    if (radarIndex === "watch") {
      cons = (typeof watchlist !== "undefined" ? watchlist : []).map((s) => ({ code: s.code, name: s.name }));
    } else {
      cons = await fetchIndexConstituents(ix.code);
    }
    if (!cons.length) throw new Error(ix.name + "成分股拉取为空");
    const codes = cons.map((c) => c.code);
    radarSetProgress(10, "正在批量拉取行情（" + codes.length + " 只）…");
    const [tx, em] = await Promise.all([fetchTxQuotesChunked(codes), fetchEmQuotesChunked(codes)]);
    const merged = codes.map((code) => {
      const t = tx[code] || {}, e = em[code] || {};
      const name = (cons.find((c) => c.code === code) || {}).name || e.name || t.name || "";
      return {
        code, name,
        price: (e.price != null ? e.price : (t.price || null)),
        peStatic: (t.peStatic > 0 ? t.peStatic : null),
        peTtm: (t.peTtm > 0 ? t.peTtm : null),
        pb: (t.pb > 0 ? t.pb : null), roe: (t.roe != null ? t.roe : null),
        totalMcap: (e.totalMcap || (t.totalMcapYi ? t.totalMcapYi * 1e8 : null)),
        chg60d: (e.chg60d != null ? e.chg60d : null),
        chgYtd: (e.chgYtd != null ? e.chgYtd : null),
        changePct: (e.changePct != null ? e.changePct : (t.changePct != null ? t.changePct : null)),
      };
    });
    // v2 底层筛选，分档放宽（页上写明档位）。
    let stage = 0, cands = [];
    for (stage = 0; stage < RADAR_GAP_STAGES.length; stage++) {
      const st = RADAR_GAP_STAGES[stage];
      cands = merged.filter((s) =>
        s.peStatic != null && s.peStatic >= 3 && s.peStatic <= st.peMax &&
        s.pb != null && s.pb >= 0.5 && s.pb <= st.pbMax &&
        s.totalMcap != null && s.totalMcap >= 5e9 &&
        s.name && !/退|ST|PT/.test(s.name));
      if (cands.length >= 8 || stage === RADAR_GAP_STAGES.length - 1) break;
    }
    if (!cands.length) throw new Error("按规则筛出 0 只（PE 静态 3–40、PB 0.5–6、市值>50 亿、剔退/ST）");
    cands.sort((a, b) => (a.peStatic - b.peStatic) || ((a.chg60d == null ? 0 : a.chg60d) - (b.chg60d == null ? 0 : b.chg60d)));
    const short = cands.slice(0, 30);
    const shortCodes = short.map((s) => s.code);
    radarSetProgress(25, "初筛 " + cands.length + " 只，取前 30 只做财报深挖…");
    const [lico, full, bal, cf] = await Promise.all([
      radarBulkTable("RPT_LICO_FN_CPD", "SECURITY_CODE,REPORTDATE,TOTAL_OPERATE_INCOME,PARENT_NETPROFIT,BASIC_EPS,DEDUCT_BASIC_EPS,WEIGHTAVG_ROE", shortCodes, "REPORTDATE"),
      radarBulkTable("RPT_DMSK_FN_INCOME", "SECURITY_CODE,REPORT_DATE,TOTAL_OPERATE_INCOME,OPERATE_PROFIT,TOTAL_PROFIT,PARENT_NETPROFIT,INCOME_TAX", shortCodes, "REPORT_DATE"),
      radarBulkTable("RPT_DMSK_FN_BALANCE", "SECURITY_CODE,REPORT_DATE,TOTAL_ASSETS,TOTAL_LIABILITIES,TOTAL_EQUITY,DEBT_ASSET_RATIO", shortCodes, "REPORT_DATE"),
      radarBulkTable("RPT_DMSK_FN_CASHFLOW", "SECURITY_CODE,REPORT_DATE,NETCASH_OPERATE,CONSTRUCT_LONG_ASSET", shortCodes, "REPORT_DATE"),
    ]);
    radarSetProgress(45, "财报已取，正在拉取 " + shortCodes.length + " 只月 K 线…");
    const klines = await radarMapPool(shortCodes,
      (c) => fetchKline(c, 103, radarWindow * 12 + 8),
      6, (d, t) => radarSetProgress(45 + Math.round(40 * d / t), "月 K 线 " + d + "/" + t + "…"));
    radarSetProgress(88, "正在计算 GAP 信号…");
    const rows = short.map((s, i) => {
      const kl = klines[i];
      const klineM = (kl && !kl.__error) ? kl.map((r) => ({ date: r.date, close: r.close })) : [];
      return radarCalcGapStock({
        code: s.code, name: s.name, price: s.price, peStatic: s.peStatic, pb: s.pb, roe: s.roe,
        totalMcap: s.totalMcap, chg60d: s.chg60d, txPeTtm: s.peTtm,
        lico: lico[s.code] || [], full: full[s.code] || [], bal: bal[s.code] || [], cf: cf[s.code] || [],
        klineM, windowYears: radarWindow,
      });
    }).sort((a, b) => b.score - a.score);
    const key = radarCacheKey();
    radarCache[key] = {
      kind: "gap", rows, stage: RADAR_GAP_STAGES[stage].label, stageIdx: stage,
      total: cons.length, screened: cands.length, windowYears: radarWindow, indexName: ix.name,
      scannedAt: new Date(),
    };
    radarSetProgress(100, "完成：分析 " + cons.length + " 只，初筛 " + cands.length + " 只，深挖 " + rows.length + " 只。");
    radarRenderResults(radarCache[key]);
  } catch (e) {
    if (resEl) resEl.innerHTML = `<p class="muted">低估雷达暂不可用（${esc(e.message || e)}）。<a href="#" id="radarRetry">重试</a></p>`;
    const rt = document.getElementById("radarRetry");
    if (rt) rt.addEventListener("click", (ev) => { ev.preventDefault(); radarRunGap(); });
  } finally {
    radarRunning = false;
    const btn = document.getElementById("radarRunBtn");
    if (btn) btn.disabled = false;
  }
}

// ---------- 股息雷达：分析引擎 ----------
async function radarRunDiv() {
  if (radarRunning) return;
  radarRunning = true;
  const wrap = document.getElementById("radarProgWrap");
  if (wrap) wrap.style.display = "block";
  const resEl = document.getElementById("radarResults");
  try {
    const ix = RADAR_INDEXES[radarIndex];
    const p = radarDivParams;
    radarSetProgress(4, "正在拉取" + ix.name + "成分股…");
    let cons;
    if (radarIndex === "watch") {
      cons = (typeof watchlist !== "undefined" ? watchlist : []).map((s) => ({ code: s.code, name: s.name }));
    } else {
      cons = await fetchIndexConstituents(ix.code);
    }
    if (!cons.length) throw new Error(ix.name + "成分股拉取为空");
    const codes = cons.map((c) => c.code);
    radarSetProgress(10, "正在批量拉取行情与分红（" + codes.length + " 只）…");
    const [em, divByCode] = await Promise.all([
      fetchEmQuotesChunked(codes),
      radarBulkTable("RPT_SHAREBONUS_DET", "SECURITY_CODE,EX_DIVIDEND_DATE,PRETAX_BONUS_RMB,IMPL_PLAN_PROFILE", codes, "EX_DIVIDEND_DATE"),
    ]);
    const base = codes.map((code) => {
      const e = em[code] || {};
      const name = (cons.find((c) => c.code === code) || {}).name || e.name || "";
      const y = radarYieldTtm(divByCode[code] || [], e.price);
      return { code, name, price: e.price != null ? e.price : null, totalMcap: e.totalMcap || null, divRows: divByCode[code] || [], yieldPct: y.yieldPct, ttmDiv: y.ttmDiv, yearsPaid: y.yearsPaid };
    });
    const inRange = base.filter((s) => {
      if (s.yieldPct == null) return false;
      if (p.minY > 0 && s.yieldPct < p.minY) return false;
      if (p.maxY > 0 && s.yieldPct > p.maxY) return false;
      return s.name && !/退|ST|PT/.test(s.name);
    }).sort((a, b) => b.yieldPct - a.yieldPct);
    if (!inRange.length) throw new Error("按收益率范围筛出 0 只（当前收益率 " + p.minY + "%–" + p.maxY + "%）；请放宽上下限或换指数");
    const short = inRange.slice(0, 30);
    radarSetProgress(55, "收益率范围内 " + inRange.length + " 只，取前 30 只算买入区间（月 K 线）…");
    const klines = await radarMapPool(short.map((s) => s.code),
      (c) => fetchKline(c, 103, p.years * 12 + 8),
      6, (d, t) => radarSetProgress(55 + Math.round(35 * d / t), "月 K 线 " + d + "/" + t + "…"));
    const rows = short.map((s, i) => {
      const kl = klines[i];
      const klineM = (kl && !kl.__error) ? kl.map((r) => ({ date: r.date, close: r.close })) : [];
      const z = radarDividendBuyZone({ divRows: s.divRows, klineM, price: s.price, years: p.years, marginPct: p.margin });
      return { ...s, ...z };
    }).sort((a, b) => (b.buyZone - a.buyZone) || (b.score - a.score));
    const key = radarCacheKey();
    radarCache[key] = {
      kind: "div", rows, total: cons.length, screened: inRange.length,
      params: { ...p }, indexName: ix.name, scannedAt: new Date(),
    };
    radarSetProgress(100, "完成：分析 " + cons.length + " 只，收益率范围内 " + inRange.length + " 只，深挖 " + rows.length + " 只。");
    radarRenderResults(radarCache[key]);
  } catch (e) {
    if (resEl) resEl.innerHTML = `<p class="muted">股息雷达暂不可用（${esc(e.message || e)}）。<a href="#" id="radarRetry">重试</a></p>`;
    const rt = document.getElementById("radarRetry");
    if (rt) rt.addEventListener("click", (ev) => { ev.preventDefault(); radarRunDiv(); });
  } finally {
    radarRunning = false;
    const btn = document.getElementById("radarRunBtn");
    if (btn) btn.disabled = false;
  }
}

// ---------- 结果渲染 ----------
function radarRenderResults(cache) {
  const el = document.getElementById("radarResults");
  if (!el) return;
  if (cache.kind === "gap") radarRenderGapResults(el, cache);
  else radarRenderDivResults(el, cache);
}

function radarGapFilteredRows(cache) {
  let rows = cache.rows;
  if (radarSigFilter === "eps") rows = rows.filter((r) => r.signal === "EPS" || r.signal === "双倍");
  if (radarSigFilter === "fcf") rows = rows.filter((r) => r.signal === "FCF" || r.signal === "双倍");
  if (radarSigFilter === "both") rows = rows.filter((r) => r.signal === "双倍");
  if (radarViewFilter === "clean") rows = rows.filter((r) => r.cleanGap);
  if (radarViewFilter === "trap") rows = rows.filter((r) => r.warnings.length > 0);
  return rows;
}

function radarRenderGapResults(el, cache) {
  const rows = radarGapFilteredRows(cache);
  const cleanN = cache.rows.filter((r) => r.cleanGap).length;
  const trapN = cache.rows.filter((r) => r.warnings.length > 0).length;
  const when = cache.scannedAt ? cache.scannedAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "";
  let html = `<p class="muted" style="margin:12px 0 8px">${esc(cache.indexName)}成分 ${cache.total} 只 · 初筛 ${cache.screened} 只（${esc(cache.stage)} · 总市值&gt;50 亿 · 剔退/ST）· 深挖前 30 只 · 窗口 ${cache.windowYears} 年 · 清洁 GAP ${cleanN} 只 · 有质量警告 ${trapN} 只 · 扫描时间 ${esc(when)}</p>`;
  html += `<div class="radar-filterbar">
    <span class="radar-legend"><i class="lg-dot" style="background:#111827"></i>分析</span>
    <span class="radar-legend"><i class="lg-dot" style="background:#15803d"></i>清洁 GAP</span>
    <span class="radar-legend"><i class="lg-dot" style="background:#ea580c"></i>陷阱警告</span>
    <span style="flex:1"></span>
    <label>信号 <select id="radarSigSel">
      <option value="all"${radarSigFilter === "all" ? " selected" : ""}>全部</option>
      <option value="eps"${radarSigFilter === "eps" ? " selected" : ""}>仅 EPS</option>
      <option value="fcf"${radarSigFilter === "fcf" ? " selected" : ""}>仅 FCF</option>
      <option value="both"${radarSigFilter === "both" ? " selected" : ""}>双倍（EPS+FCF）</option>
    </select></label>
    <label>看 <select id="radarViewSel">
      <option value="all"${radarViewFilter === "all" ? " selected" : ""}>全部</option>
      <option value="clean"${radarViewFilter === "clean" ? " selected" : ""}>仅限清洁 GAP</option>
      <option value="trap"${radarViewFilter === "trap" ? " selected" : ""}>仅陷阱警告</option>
    </select></label>
    <label><input type="checkbox" id="radarAllCols"${radarAllCols ? " checked" : ""}> 所有列</label>
  </div>`;
  html += `<p class="muted" style="margin:4px 0 8px">迷你图：<span style="color:#2563eb">— 价格</span> <span style="color:#15803d">— BPA TTM</span> <span style="color:#6b7280">- - FCF/TTM 操作（虚线）</span>，已在窗口中标准化。当深色（或绿色）线上升而蓝色线下降时，即为缺口所在。</p>`;
  if (!rows.length) {
    html += `<p class="muted" style="text-align:center;padding:20px 0">当前筛选下无结果，换个筛选条件试试。</p>`;
  } else {
    const detail = radarAllCols;
    html += `<div class="tbl-wrap"><table class="tbl radar-tbl"><tr>
      <th>#</th><th>代码</th><th>名称</th><th>现价</th><th>涨跌</th><th>迷你图</th><th>信号</th><th>PER %il</th><th>EPS TTM增速</th>
      ${detail ? "<th>FCF TTM增速</th><th>Δ营收</th><th>回购贡献</th><th>经营现金流÷净利润</th><th>ROIC</th><th>资产负债率</th><th>窗口涨跌</th>" : ""}
      <th>GAP评分</th><th>状态</th></tr>`;
    rows.forEach((r, i) => {
      const status = r.cleanGap
        ? `<span class="badge done">清洁 GAP</span>`
        : r.gapPass
          ? `<span class="badge soon">⚠ 陷阱？</span>`
          : (r.epsUp || r.fcfUp) ? `<span class="badge">接近 GAP</span>` : `<span class="muted">—</span>`;
      const warns = r.warnings.length
        ? `<div class="muted" style="font-size:11px;line-height:1.5">${esc(r.warnings.map((w) => w.text).join("；"))}</div>` : "";
      const roicTxt = r.roic == null ? "—" : (r.roic * 100).toFixed(1) + "%" + (r.roicFromRoe ? " (e)" : "") + (r.roicPrev != null ? (r.roic >= r.roicPrev ? " ↑" : " ↓") : "");
      html += `<tr><td>${i + 1}</td>
        <td><a href="#" data-radar-code="${esc(r.code)}">${esc(r.code)}</a></td>
        <td style="text-align:left">${esc(r.name)}</td>
        <td class="num">${radarNum(r.price)}</td>
        <td class="num ${chgClass(r.changePct)}">${chgText(r.changePct)}</td>
        <td>${radarSparkSvg(r.spark)}</td>
        <td>${r.signal === "双倍" ? `<span class="badge done">✓ 双倍</span>` : r.signal === "—" ? "—" : esc(r.signal)}</td>
        <td class="num">${r.perPct == null ? "—" : r.perPct.toFixed(0) + "%"}</td>
        <td class="num ${chgClass(r.epsGrowth != null ? r.epsGrowth * 100 : null)}">${radarSignedPct(r.epsGrowth)}</td>
        ${detail ? `<td class="num ${chgClass(r.fcfGrowth != null ? r.fcfGrowth * 100 : null)}">${radarSignedPct(r.fcfGrowth)}</td>
        <td class="num ${chgClass(r.revGrowth != null ? r.revGrowth * 100 : null)}">${radarSignedPct(r.revGrowth)}</td>
        <td class="num">${r.buybackPp == null ? "—" : (r.buybackPp > 0 ? "+" : "") + r.buybackPp.toFixed(1) + "pp"}</td>
        <td class="num">${radarPct(r.cashConv)}</td>
        <td class="num">${roicTxt}</td>
        <td class="num">${r.debtRatio == null ? "—" : r.debtRatio.toFixed(1) + "%" + (r.debtChgPp == null ? "" : (r.debtChgPp < -1 ? " ↓" : r.debtChgPp > 1 ? " ↑" : " →"))}</td>
        <td class="num ${chgClass(r.priceChg != null ? r.priceChg * 100 : null)}">${radarSignedPct(r.priceChg)}</td>` : ""}
        <td class="num"><b>${r.score}</b></td>
        <td style="text-align:left">${status}${warns}</td></tr>`;
    });
    html += `</table></div>`;
  }
  html += `<p class="muted" style="margin-top:8px">评分 = PER %il（40%）+ EPS 增速分（30%）+ FCF 增速分（30%），按评分降序，最佳候选在前。点击代码可直接分析该股。</p>`;
  el.innerHTML = html;
  el.querySelectorAll("[data-radar-code]").forEach((a) => a.addEventListener("click", (ev) => {
    ev.preventDefault();
    switchToStock(a.dataset.radarCode);
  }));
  const sig = document.getElementById("radarSigSel");
  if (sig) sig.addEventListener("change", () => { radarSigFilter = sig.value; radarRenderResults(cache); });
  const vw = document.getElementById("radarViewSel");
  if (vw) vw.addEventListener("change", () => { radarViewFilter = vw.value; radarRenderResults(cache); });
  const ac = document.getElementById("radarAllCols");
  if (ac) ac.addEventListener("change", () => { radarAllCols = ac.checked; radarRenderResults(cache); });
}

function radarRenderDivResults(el, cache) {
  const rows = cache.rows;
  const buyN = rows.filter((r) => r.buyZone).length;
  const when = cache.scannedAt ? cache.scannedAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "";
  const p = cache.params;
  let html = `<p class="muted" style="margin:12px 0 8px">${esc(cache.indexName)}成分 ${cache.total} 只 · 收益率 ${p.minY}%–${p.maxY}% 范围内 ${cache.screened} 只 · 深挖前 30 只 · 买入区间 ${buyN} 只 · 参数：最低 ${p.minY}% / 最高 ${p.maxY}% / 购买区域利润率 ${p.margin}% / 计算年份 ${p.years} 年 · 扫描时间 ${esc(when)}</p>`;
  if (!rows.length) {
    html += `<p class="muted" style="text-align:center;padding:20px 0">当前参数下无结果，放宽收益率范围或换指数试试。</p>`;
  } else {
    const detail = radarAllCols;
    html += `<div class="tbl-wrap"><table class="tbl radar-tbl"><tr>
      <th>#</th><th>代码</th><th>名称</th><th>现价</th><th>当前股息率</th><th>历史股息率区间</th><th>连续派息年数</th><th>估值下限价</th><th>高于下限</th>
      ${detail ? "<th>历史最高股息率</th><th>TTM 每股股息</th>" : ""}
      <th>买入区间</th><th>状态</th></tr>`;
    rows.forEach((r, i) => {
      const status = !r.stable
        ? `<span class="badge soon">⚠ 股息不稳定</span>`
        : r.buyZone ? `<span class="badge done">买入区间</span>` : `<span class="badge">观察</span>`;
      html += `<tr><td>${i + 1}</td>
        <td><a href="#" data-radar-code="${esc(r.code)}">${esc(r.code)}</a></td>
        <td style="text-align:left">${esc(r.name)}</td>
        <td class="num">${radarNum(r.price)}</td>
        <td class="num">${r.yieldPct == null ? "—" : r.yieldPct.toFixed(2) + "%"}</td>
        <td class="num">${(r.histLo == null || r.histHi == null) ? "—" : r.histLo.toFixed(2) + "% – " + r.histHi.toFixed(2) + "%"}</td>
        <td class="num">${r.yearsPaid} / ${p.years} 年</td>
        <td class="num">${radarNum(r.floorPrice)}</td>
        <td class="num ${chgClass(r.distAboveFloor != null ? -r.distAboveFloor : null)}">${r.distAboveFloor == null ? "—" : (r.distAboveFloor > 0 ? "+" : "") + r.distAboveFloor.toFixed(1) + "%"}</td>
        ${detail ? `<td class="num">${r.maxYield == null ? "—" : r.maxYield.toFixed(2) + "%"}</td><td class="num">${radarNum(r.ttmDiv, 2)}</td>` : ""}
        <td>${r.buyZone ? `<b style="color:var(--down)">✓ 买入区间</b>` : "—"}</td>
        <td style="text-align:left">${status}</td></tr>`;
    });
    html += `</table></div>`;
  }
  html += `<p class="muted" style="margin-top:8px"><label><input type="checkbox" id="radarAllCols"${radarAllCols ? " checked" : ""}> 所有列</label>　买入区间规则：现价高于历史估值下限 ≤ ${p.margin}%（低于下限也算，即更便宜）。估值下限价 = 最新年化每股股息 ÷ 历史最高股息率。点击代码可直接分析该股。</p>`;
  el.innerHTML = html;
  el.querySelectorAll("[data-radar-code]").forEach((a) => a.addEventListener("click", (ev) => {
    ev.preventDefault();
    switchToStock(a.dataset.radarCode);
  }));
  const ac = document.getElementById("radarAllCols");
  if (ac) ac.addEventListener("change", () => { radarAllCols = ac.checked; radarRenderResults(cache); });
}

// ---------- 信号指标详解 ----------
function radarExplainerHtml() {
  if (radarTab === "div") {
    return `<div class="radar-expl">
      <h4>信号指标详解（股息雷达）</h4>
      <p><b>当前股息率：</b>近 12 个月每股现金分红 ÷ 现价。排除低于最低值或高于最高值的股票（两者为 0 表示不进行筛选）。</p>
      <p><b>买入区间：</b>如果现价高于历史估值下限 ≤ 购买区域利润率（默认 8%），则视为“处于买入区间”。估值下限价 = 最新年化每股股息 ÷ 历史最高股息率（即该股历史上最便宜时的股息率）。</p>
      <p><b>股息稳定：</b>仅适用于股息稳定的公司。连续派息年数按近 N 年有分红的年份计；近 N 年缺席 3 年及以上标“股息不稳定”。</p>
      <p><b>暂不可用：</b>未分红、或分红历史不足 3 年的股票，历史股息率区间与买入区间算不出，标“—”并排除在买入区间之外，不编数。分红数据来自东财 RPT_SHAREBONUS_DET（每 10 股派息，税前）。</p>
    </div>`;
  }
  return `<div class="radar-expl">
    <h4>信号指标详解（评估差距）</h4>
    <p><b>信号指标：</b>选择以每股收益（EPS）、每股自由现金流（FCF，受会计准则影响较小的每股自由现金流）或两者兼而有之来衡量该模式。EPS·FCF 列显示每家公司符合哪些信号指标。<span class="badge done">✓ 双倍</span>每股收益（EPS）和每股自由现金流（FCF/share）均上升，而股价持平或下跌。市盈率（P/FCF）相当于带有方框的市盈率（P/E ratio）。</p>
    <p><b>PER %il：</b>指当前市盈率低于其历史水平的比例（100% 表示当前市盈率低于历史最低水平，即实际市盈率已大幅下降）。本站用季度末收盘价 ÷ EPS TTM 逐季算出，窗口内至少 4 个季度才出数。</p>
    <p><b>Δ 营收：</b>证实每股收益（EPS）的上升背后是营收增长，而不仅仅是由于裁员/回购。</p>
    <p><b>债务/EBITDA：</b><span class="badge">暂不可用</span> 东财免费三表无折旧摊销数据，算不出 EBITDA。本站改看资产负债率及一年变化：↓去杠杆化（负债率较约一年前下降）、↑杠杆化、→稳定。“要求控制或减少债务”这一表述掩盖了债务已超过上限且并未减少的情况。</p>
    <p><b>FCF TTM：</b>过去 12 个月的自由现金流（经营现金流 − 购建长期资产），↑/↓表示与大约一年前相比是改善还是恶化。✓表示产生现金 / ✗表示消耗现金。</p>
    <p><b>净利润变化量：</b>利润增长（“业务”）。如果每股收益变化量远大于净利润变化量，则每股收益的增长来自股票回购，而不是来自盈利增加；回购贡献列标出两者增速差（百分点）。</p>
    <p><b>经营现金流÷净利润：</b>经营活动现金流÷净利润（过去 12 个月）。高于约 80% 的利润有现金支撑；低于 60% 的利润为“账面利润”（应计项目高），通常会发生逆转。</p>
    <p><b>ROIC：</b>投资资本回报率（NOPAT ÷（净资产+总负债），NOPAT = 营业利润 ×（1 − 所得税率））。若 ROIC 缺失，则以 ROE 表示，并标记为“e”；向上/向下表示与约一年前相比的数值。高且稳定为优质股；低且持续下跌几乎总是价值陷阱。</p>
    <p><b>查看 →</b> 仅显示符合 GAP 标准且无任何质量警告的测试结果。</p>
    <p>⚠ <b>这是个陷阱吗？</b>它通过了 GAP 测试，但未能通过质量筛选（每股收益下降、负债过高、营收下滑或现金消耗过快）。没有直接否定它，而是说：“仔细看看。”将鼠标悬停在状态上，查看究竟出了什么问题。<span class="muted">（预期下调一项：本站无逐只分析师预期修正免费源，未覆盖。）</span></p>
  </div>`;
}

// ---------- 测试钩子（E2E 用，不影响页面） ----------
if (typeof globalThis !== "undefined") {
  globalThis.__radarTest = {
    radarTtmSeries, radarNormRows, radarYoY, radarCalcGapStock, radarSparkSvg,
    radarYieldTtm, radarDividendBuyZone, radarQuarterCloses,
    RADAR_INDEXES, RADAR_GAP_STAGES,
  };
}

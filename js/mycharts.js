// ============================================================
// 我的图形 · 新图表构建器（v12）
// AleInversor「我的图片」页同款：头卡 + 六维 chips + 已保存图表列表
// + 新图表表单（名称 / 周期 / 季刊-TTM-年度 / 参考线 / 指标搜索 /
// 单位筛选 / 最多 6 项指标 / 双轴），图表画在 charts.js 画布上。
// 数据全部来自本站已有东财 F10 三表 + 行情，不新接数据源。
// 存储键仍是 af_mycharts，v2 的 K 线快照旧数据照常读出。
// A 股红涨绿跌。双轴最多混合两种单位类型（金额 / 百分比 / 倍数）。
// ============================================================
const LS_CHARTS = "af_mycharts";
function loadMyCharts() {
  try {
    const raw = localStorage.getItem(LS_CHARTS);
    if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr; }
  } catch (e) { /* 忽略 */ }
  return [];
}
function saveMyCharts(list) { localStorage.setItem(LS_CHARTS, JSON.stringify(list)); }
function kltLabel(klt) { return klt === 102 ? "周K" : klt === 103 ? "月K" : "日K"; }
function saveCurrentChart() {
  if (!currentData || !currentCode) return;
  const btn = document.getElementById("saveChartBtn");
  const name = (currentData.quote && currentData.quote.name) || (currentData.tx && currentData.tx.name) || currentCode;
  const today = new Date().toLocaleDateString("zh-CN");
  let label = "";
  try { label = window.prompt("给这个图形起个名字：", name + " " + currentCode + " " + kltLabel(currentKlt) + " " + today) || ""; } catch (e) { label = ""; }
  if (!label) return;
  const list = loadMyCharts();
  list.unshift({
    id: "c" + Date.now(),
    name: label, code: currentCode, klt: currentKlt,
    date: today,
    price: currentMetrics && currentMetrics.price != null ? currentMetrics.price : null,
    changePct: currentMetrics ? currentMetrics.changePct : null,
  });
  saveMyCharts(list);
  if (btn) { const old = btn.textContent; btn.textContent = "✓ 已保存"; setTimeout(() => { btn.textContent = old; }, 1500); }
  if (toolLoaded.mycharts) renderMycharts();
}

// ---------- 指标序列引擎 ----------
// 口径：
//  年度：年报行（12-31），值为当年全年数；价格取当年 12 月月末收盘。
//  季刊：每季度一行，单季值 = 本季累计 − 上季累计（Q1 即当季值）；价格取季末月收盘。
//  TTM：每季度末滚动近 4 个单季之和；价格取季末月收盘。
// 价格优先用月 K（120 根≈10 年），月 K 缺失时退回日 K；超过价格历史的期数该指标记空。
const MC_COLORS = ["#2563eb", "#e5484d", "#1a9e54", "#d97706", "#7c3aed", "#0891b2"];
const MC_METRICS = [
  { id: "pe", label: "PE-TTM", unit: "倍", group: "ratio", desc: "收盘价 ÷ EPS(TTM)" },
  { id: "pb", label: "PB", unit: "倍", group: "ratio", desc: "收盘价 ÷ 每股净资产" },
  { id: "divy", label: "股息率", unit: "%", group: "pct", desc: "近12月每股派息 ÷ 收盘价" },
  { id: "roe", label: "ROE", unit: "%", group: "pct", desc: "归母利润(TTM) ÷ 净资产" },
  { id: "roic", label: "ROIC", unit: "%", group: "pct", desc: "NOPAT(TTM) ÷ 总资产" },
  { id: "roce", label: "ROCE", unit: "%", group: "pct", desc: "EBIT(TTM) ÷ 总资产" },
  { id: "revg", label: "营收增速", unit: "%", group: "pct", desc: "营收同比" },
  { id: "profg", label: "净利润增速", unit: "%", group: "pct", desc: "归母利润同比" },
  { id: "gm", label: "毛利率", unit: "%", group: "pct", desc: "（营收−成本）÷ 营收" },
  { id: "nm", label: "净利率", unit: "%", group: "pct", desc: "归母利润 ÷ 营收" },
  { id: "debt", label: "资产负债率", unit: "%", group: "pct", desc: "总负债 ÷ 总资产" },
  { id: "ocf", label: "经营现金流", unit: "亿元", group: "money", desc: "经营现金流净额" },
];
const MC_GROUP_LABEL = { money: "金额", pct: "百分比", ratio: "倍数" };
function mcSortAsc(rows) {
  return (rows || []).slice().sort((a, b) => String(dateField(a)).localeCompare(String(dateField(b))));
}
function mcQKey(dateStr) {
  const y = reportYear(dateStr), m = reportMonth(dateStr);
  return y + "Q" + Math.ceil(m / 3);
}
// 单季值：本季累计 − 上季累计；上季行不连续（缺季）时该季记空，Q1 本身即单季值。
function mcSingleQ(rowsAsc, field) {
  const out = [];
  for (let i = 0; i < rowsAsc.length; i++) {
    const r = rowsAsc[i], d = dateField(r);
    const y = reportYear(d), m = reportMonth(d);
    if (i === 0) { out.push({ date: d, label: mcQKey(d), value: m === 3 ? num(r[field]) : null }); continue; }
    const p = rowsAsc[i - 1], pd = dateField(p);
    const py = reportYear(pd), pm = reportMonth(pd);
    const cont = (y === py && m - pm === 3) || (y === py + 1 && m === 3 && pm === 12);
    if (m === 3) out.push({ date: d, label: mcQKey(d), value: num(r[field]) });
    else if (cont) out.push({ date: d, label: mcQKey(d), value: num(r[field]) - num(p[field]) });
    else out.push({ date: d, label: mcQKey(d), value: null });
  }
  return out;
}
function mcTTMAt(sq, i) {
  if (i < 3) return null;
  let s = 0;
  for (let k = i - 3; k <= i; k++) { if (sq[k].value == null) return null; s += sq[k].value; }
  return s;
}
function mcPriceAt(kM, kD, dateStr) {
  const pick = (rows) => {
    if (!rows || !rows.length) return null;
    let best = null;
    for (const r of rows) {
      const d = String(r.date).slice(0, 10);
      if (d <= dateStr) best = r; else break;
    }
    return best && isFinite(best.close) && best.close > 0 ? best.close : null;
  };
  const c = pick(kM);
  return c != null ? c : pick(kD);
}
function mcDpsTtmAt(divs, endDateStr) {
  const end = parseDate(endDateStr);
  if (!end) return null;
  const start = new Date(end); start.setFullYear(start.getFullYear() - 1);
  let s = 0, n = 0;
  for (const d of (divs || [])) {
    const dt = parseDate(d.EX_DIVIDEND_DATE);
    if (dt && dt > start && dt <= end) { s += num(d.PRETAX_BONUS_RMB) / 10; n++; }
  }
  return n ? s : null;
}
function mcRowAt(rowsAsc, dateStr) {
  // 精确日期优先，否则取不晚于该日的最近一行
  let best = null;
  for (const r of rowsAsc) {
    const d = String(dateField(r)).slice(0, 10);
    if (d === dateStr) return r;
    if (d < dateStr) best = r; else break;
  }
  return best;
}
// 把三大表整理成统一的期数表：每期一行，含单季/TTM/年报三种口径的派生量。
function mcPrepPeriods(data) {
  const inc = mcSortAsc(mergeIncome(data.income || [], data.incomeFull || []));
  const bal = mcSortAsc(data.balance || []);
  const cf = mcSortAsc(data.cashflow || []);
  const kM = mcSortAsc(data.klineM || []);
  const kD = mcSortAsc(data.klineD || []);
  const divs = data.dividends || [];
  const sq = (f) => mcSingleQ(inc, f);
  const sqCf = (f) => mcSingleQ(cf, f);
  const sqRev = sq("TOTAL_OPERATE_INCOME"), sqProfit = sq("PARENT_NETPROFIT"), sqCost = sq("OPERATE_COST");
  const sqOp = sq("OPERATE_PROFIT"), sqFin = sq("FINANCE_EXPENSE"), sqTax = sq("INCOME_TAX"), sqTp = sq("TOTAL_PROFIT");
  const sqEps = sq("BASIC_EPS"), sqOcf = sqCf("NETCASH_OPERATE");
  const periods = [];
  for (let i = 0; i < inc.length; i++) {
    const r = inc[i], d = String(dateField(r)).slice(0, 10);
    const y = reportYear(d), m = reportMonth(d);
    const b = mcRowAt(bal, d) || {};
    const c = mcRowAt(cf, d) || {};
    const close = mcPriceAt(kM, kD, d);
    const epsTtm = mcTTMAt(sqEps, i);
    const revTtm = mcTTMAt(sqRev, i), profitTtm = mcTTMAt(sqProfit, i);
    const costTtm = mcTTMAt(sqCost, i), opTtm = mcTTMAt(sqOp, i);
    const finTtm = mcTTMAt(sqFin, i), taxTtm = mcTTMAt(sqTax, i), tpTtm = mcTTMAt(sqTp, i);
    const ocfTtm = mcTTMAt(sqOcf, i);
    periods.push({
      date: d, label: mcQKey(d), year: y, month: m,
      close, eps: num(r.BASIC_EPS), epsTtm, bps: num(r.BPS) || null,
      equity: num(b.TOTAL_EQUITY) || null, assets: num(b.TOTAL_ASSETS) || null, liab: num(b.TOTAL_LIABILITIES) || null,
      rev: num(r.TOTAL_OPERATE_INCOME), revSq: sqRev[i].value, revTtm,
      profit: num(r.PARENT_NETPROFIT), profitSq: sqProfit[i].value, profitTtm,
      costSq: sqCost[i].value, costTtm,
      opTtm, finTtm, taxTtm, tpTtm,
      ocf: num(c.NETCASH_OPERATE), ocfSq: sqOcf[i].value, ocfTtm,
      dpsTtm: mcDpsTtmAt(divs, d),
    });
  }
  return periods;
}
function mcYoYMap(periods, getVal, keyFn) {
  const byKey = {};
  periods.forEach((p) => { byKey[keyFn(p)] = p; });
  return (p) => {
    const prevKey = keyFn(p).replace(/(\d{4})/, (yy) => String(parseInt(yy, 10) - 1));
    const prev = byKey[prevKey];
    if (!prev) return null;
    const cur = getVal(p), old = getVal(prev);
    if (cur == null || old == null || !old) return null;
    return (cur - old) / Math.abs(old);
  };
}
// 构建单指标序列：gran ∈ q（单季）/ ttm / y（年报）。
// 返回 { points: [{x, d, y}], na }；na 为暂不可用原因（null 表示可用）。
function mcBuildSeries(data, metricId, gran) {
  const def = MC_METRICS.find((x) => x.id === metricId);
  if (!def) return { points: [], na: "未知指标" };
  const periods = mcPrepPeriods(data);
  if (!periods.length) return { points: [], na: "该标的无财报数据（ETF/指数类不披露三大表）" };
  const annual = gran === "y";
  const rows = annual ? periods.filter((p) => p.month === 12) : periods;
  if (!rows.length) return { points: [], na: "该口径下无报告期数据" };
  const yoyQ = mcYoYMap(periods, (p) => p.revSq, (p) => p.label);
  const yoyQProfit = mcYoYMap(periods, (p) => p.profitSq, (p) => p.label);
  const yoyTtmRev = mcYoYMap(periods, (p) => p.revTtm, (p) => p.label);
  const yoyTtmProfit = mcYoYMap(periods, (p) => p.profitTtm, (p) => p.label);
  const yoyYRev = mcYoYMap(periods.filter((p) => p.month === 12), (p) => p.rev, (p) => String(p.year));
  const yoyYProfit = mcYoYMap(periods.filter((p) => p.month === 12), (p) => p.profit, (p) => String(p.year));
  const val = (p) => {
    switch (metricId) {
      case "pe": {
        const eps = annual ? p.eps : p.epsTtm;
        return (p.close != null && eps != null && eps > 0) ? p.close / eps : null;
      }
      case "pb": return (p.close != null && p.bps != null && p.bps > 0) ? p.close / p.bps : null;
      case "divy": return (p.close != null && p.dpsTtm != null && p.dpsTtm > 0) ? p.dpsTtm / p.close * 100 : null;
      case "roe": {
        const profit = annual ? p.profit : p.profitTtm;
        return (profit != null && p.equity) ? profit / p.equity * 100 : null;
      }
      case "roic": {
        // 年报点 TTM 即全年值，故三种口径统一用 TTM 量
        const taxRate = (p.tpTtm != null && p.tpTtm) ? p.taxTtm / p.tpTtm : null;
        const nopat = (p.opTtm != null && taxRate != null) ? p.opTtm * (1 - taxRate) : null;
        return (nopat != null && p.assets) ? nopat / p.assets * 100 : null;
      }
      case "roce": {
        const ebit = (p.opTtm != null && p.finTtm != null) ? p.opTtm + p.finTtm : null;
        return (ebit != null && p.assets) ? ebit / p.assets * 100 : null;
      }
      case "revg": return annual ? (yoyYRev(p) != null ? yoyYRev(p) * 100 : null) : (gran === "ttm" ? (yoyTtmRev(p) != null ? yoyTtmRev(p) * 100 : null) : (yoyQ(p) != null ? yoyQ(p) * 100 : null));
      case "profg": return annual ? (yoyYProfit(p) != null ? yoyYProfit(p) * 100 : null) : (gran === "ttm" ? (yoyTtmProfit(p) != null ? yoyTtmProfit(p) * 100 : null) : (yoyQProfit(p) != null ? yoyQProfit(p) * 100 : null));
      case "gm": {
        const rev = annual ? p.revTtm : (gran === "ttm" ? p.revTtm : p.revSq);
        const cost = annual ? p.costTtm : (gran === "ttm" ? p.costTtm : p.costSq);
        return (rev != null && rev && cost != null) ? (rev - cost) / rev * 100 : null;
      }
      case "nm": {
        const rev = annual ? p.revTtm : (gran === "ttm" ? p.revTtm : p.revSq);
        const profit = annual ? p.profitTtm : (gran === "ttm" ? p.profitTtm : p.profitSq);
        return (rev != null && rev && profit != null) ? profit / rev * 100 : null;
      }
      case "debt": return (p.liab != null && p.assets) ? p.liab / p.assets * 100 : null;
      case "ocf": {
        const v = annual ? p.ocf : (gran === "ttm" ? p.ocfTtm : p.ocfSq);
        return v != null ? v / 1e8 : null;
      }
      default: return null;
    }
  };
  const points = rows.map((p) => ({ x: annual ? String(p.year) : p.label, d: p.date, y: val(p) }));
  const valid = points.filter((pt) => pt.y != null && isFinite(pt.y));
  if (valid.length < 2) {
    const reason = !data.income || !data.income.length
      ? "该标的无财报数据（ETF/指数类不披露三大表）"
      : (metricId === "pe" || metricId === "pb" || metricId === "divy")
        ? "该指标历史不足 2 期（价格历史受月 K 上限约 10 年限制，或 EPS/净资产/分红数据缺失）"
        : "该指标在所选口径下历史不足 2 期";
    return { points, na: reason };
  }
  return { points, na: null };
}
// 口径内可用性：当前股票 + 当前口径下各指标是否 ≥2 个有效点
function mcAvailability(data, gran) {
  const out = {};
  for (const m of MC_METRICS) out[m.id] = mcBuildSeries(data, m.id, gran);
  return out;
}
// 按周期窗口过滤点：5y/10y/15y/all（按最新点日期往前推）
function mcWindowFilter(points, period) {
  if (period === "all" || !points.length) return points;
  const years = period === "5y" ? 5 : period === "10y" ? 10 : 15;
  const latest = new Date(points[points.length - 1].d + "T00:00:00");
  const cut = new Date(latest); cut.setFullYear(cut.getFullYear() - years);
  return points.filter((p) => new Date(p.d + "T00:00:00") >= cut);
}
function mcMean(vals) {
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
// 双轴分组：按单位类型分组；>2 组时新指标不可加。返回 {groups:[{key,label,metrics}], blocked}
function mcAxisGroups(metricIds) {
  const groups = [];
  for (const id of metricIds) {
    const def = MC_METRICS.find((x) => x.id === id);
    if (!def) continue;
    let g = groups.find((x) => x.key === def.group);
    if (!g) { g = { key: def.group, label: MC_GROUP_LABEL[def.group], metrics: [] }; groups.push(g); }
    g.metrics.push(def);
  }
  return { groups, blocked: groups.length > 2 };
}
function mcCanAdd(metricIds, id) {
  if (metricIds.includes(id)) return { ok: false, reason: "已选" };
  if (metricIds.length >= 6) return { ok: false, reason: "最多选择 6 项指标" };
  const next = metricIds.concat(id);
  if (mcAxisGroups(next).blocked) return { ok: false, reason: "双轴最多混合两种单位类型（金额 / 百分比 / 倍数）" };
  return { ok: true };
}
function mcFmt(v, unit) {
  if (v == null || !isFinite(v)) return "—";
  if (unit === "%") return v.toFixed(1) + "%";
  if (unit === "亿元") return v >= 1000 ? (v / 10000).toFixed(1) + "万亿" : v.toFixed(0) + "亿";
  return v.toFixed(1);
}

// ---------- 多指标折线图（双轴 + 参考线），复用 charts.js 画布 ----------
function drawMcLines(canvas, series, opts) {
  const sc = setupCanvas(canvas);
  if (!sc) return;
  const { ctx, w: W, h: H } = sc;
  const refline = opts.refline || "none";
  const dual = opts.dual !== false;
  const padL = 58, padR = dual && series.some((s) => s.axis === 1) ? 58 : 16, padT = 30, padB = 26;
  const labels = [];
  series.forEach((s) => s.points.forEach((p) => { if (!labels.includes(p.x)) labels.push(p.x); }));
  const labelIdx = {}; labels.forEach((x, i) => { labelIdx[x] = i; });
  const xAt = (i) => padL + (labels.length > 1 ? i / (labels.length - 1) * (W - padL - padR) : (W - padL - padR) / 2);
  const axisOf = (s) => (dual && s.axis === 1 ? 1 : 0);
  const scale = (axis) => {
    let lo = Infinity, hi = -Infinity;
    series.forEach((s) => {
      if (axisOf(s) !== axis) return;
      s.points.forEach((p) => { if (p.y != null && isFinite(p.y)) { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); } });
    });
    if (!isFinite(lo)) return null;
    if (hi === lo) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * 0.08;
    return { lo: lo - pad, hi: hi + pad };
  };
  const sc0 = scale(0), sc1 = dual ? scale(1) : null;
  if (!sc0 && !sc1) {
    ctx.fillStyle = "#888"; ctx.font = "13px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("暂无可绘制的数据", W / 2, H / 2);
    return;
  }
  const yAt = (v, axis) => {
    const sc = axis === 1 ? sc1 : sc0;
    return padT + (1 - (v - sc.lo) / (sc.hi - sc.lo)) * (H - padT - padB);
  };
  const grid = C_GRID;
  ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.fillStyle = "#888"; ctx.font = "11px sans-serif";
  for (let t = 0; t <= 4; t++) {
    const v = sc0.lo + (sc0.hi - sc0.lo) * t / 4;
    const y = yAt(v, 0);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.textAlign = "right"; ctx.fillText(mcFmt(v, series.find((s) => axisOf(s) === 0).unit), padL - 6, y + 4);
    if (sc1) {
      const v1 = sc1.lo + (sc1.hi - sc1.lo) * t / 4;
      ctx.textAlign = "left"; ctx.fillText(mcFmt(v1, series.find((s) => axisOf(s) === 1).unit), W - padR + 6, yAt(v1, 1) + 4);
    }
  }
  // 参考线：每条指标在当前窗口内的中位数 / 平均值（虚线 + 右端数值）
  series.forEach((s) => {
    const vals = s.points.filter((p) => p.y != null && isFinite(p.y)).map((p) => p.y);
    if (!vals.length || refline === "none") return;
    const drawRef = (v, tag) => {
      if (v == null) return;
      const y = yAt(v, axisOf(s));
      ctx.save();
      ctx.setLineDash([5, 4]); ctx.strokeStyle = s.color; ctx.globalAlpha = 0.55; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = s.color; ctx.textAlign = "left"; ctx.font = "10px sans-serif";
      ctx.fillText(tag + " " + mcFmt(v, s.unit), W - padR + 2, y - 3);
      ctx.font = "11px sans-serif";
    };
    if (refline === "median" || refline === "both") drawRef(median(vals), "中位");
    if (refline === "mean" || refline === "both") drawRef(mcMean(vals), "平均");
  });
  // 折线（空点断开）
  series.forEach((s) => {
    const axis = axisOf(s);
    ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.beginPath();
    let pen = false;
    s.points.forEach((p) => {
      if (p.y == null || !isFinite(p.y)) { pen = false; return; }
      const x = xAt(labelIdx[p.x]), y = yAt(p.y, axis);
      if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
    });
    ctx.stroke();
    const last = [...s.points].reverse().find((p) => p.y != null && isFinite(p.y));
    if (last) {
      ctx.fillStyle = s.color; ctx.textAlign = "left"; ctx.font = "bold 11px sans-serif";
      ctx.fillText(mcFmt(last.y, s.unit), Math.min(xAt(labelIdx[last.x]) + 4, W - padR - 34), yAt(last.y, axis) - 4);
      ctx.font = "11px sans-serif";
    }
  });
  // X 轴（首/中/末）
  ctx.fillStyle = "#888"; ctx.font = "11px sans-serif";
  const showX = [0, Math.floor((labels.length - 1) / 2), labels.length - 1].filter((v, i, a) => a.indexOf(v) === i);
  showX.forEach((i) => {
    ctx.textAlign = i === 0 ? "left" : i === labels.length - 1 ? "right" : "center";
    ctx.fillText(labels[i], xAt(i), H - 8);
  });
  // 图例
  ctx.textAlign = "left";
  let lx = padL;
  series.forEach((s) => {
    ctx.fillStyle = s.color; ctx.fillRect(lx, 10, 10, 10);
    ctx.fillStyle = "#333"; ctx.fillText(s.label, lx + 14, 19);
    lx += 14 + ctx.measureText(s.label).width + 18;
  });
}

// ---------- 构建器状态与渲染 ----------
let mcState = { name: "", period: "10y", gran: "q", refline: "none", metrics: [], dualAxis: true, unitFilter: "any", search: "" };
let mcPendingConfig = null;
let mcAvail = {};
const MC_GRAN_LABEL = { q: "季刊", ttm: "TTM", y: "年度" };
const MC_PERIOD_LABEL = { "5y": "5年", "10y": "10年", "15y": "15年", "all": "全部" };
function mcApplyConfig(cfg) {
  mcState = {
    name: cfg.name || "", period: cfg.period || "10y", gran: cfg.gran || "q",
    refline: cfg.refline || "none", metrics: Array.isArray(cfg.metrics) ? cfg.metrics.slice(0, 6) : [],
    dualAxis: cfg.dualAxis !== false, unitFilter: "any", search: "",
  };
}
function mcSeriesForPreview() {
  if (!currentData) return [];
  const { groups } = mcAxisGroups(mcState.metrics);
  const out = [];
  mcState.metrics.forEach((id, i) => {
    const def = MC_METRICS.find((x) => x.id === id);
    const built = mcBuildSeries(currentData, id, mcState.gran);
    const pts = mcWindowFilter(built.points, mcState.period);
    const axis = groups.findIndex((g) => g.key === def.group);
    out.push({ id, label: def.label, unit: def.unit, group: def.group, axis, color: MC_COLORS[i % MC_COLORS.length], points: pts, na: built.na });
  });
  return out;
}
function mcDrawPreview() {
  const canvas = document.getElementById("mcChart");
  if (!canvas || !currentData) return;
  const series = mcSeriesForPreview().filter((s) => !s.na);
  const note = document.getElementById("mcChartNote");
  if (!series.length) {
    const c = setupCanvas(canvas);
    if (c && c.ctx) { c.ctx.fillStyle = "#888"; c.ctx.font = "13px sans-serif"; c.ctx.textAlign = "center"; c.ctx.fillText("请选择至少 1 项可用指标", c.w / 2, c.h / 2); }
    if (note) note.textContent = "请选择至少 1 项可用指标。";
    return;
  }
  drawMcLines(canvas, series, { refline: mcState.refline, dual: mcState.dualAxis });
  const naList = mcSeriesForPreview().filter((s) => s.na).map((s) => s.label + "（" + s.na + "）");
  if (note) {
    const granNote = "口径：" + MC_GRAN_LABEL[mcState.gran] + " · 窗口：" + MC_PERIOD_LABEL[mcState.period];
    const refNote = mcState.refline === "none" ? "无参考线" : mcState.refline === "median" ? "参考线：中位数" : mcState.refline === "mean" ? "参考线：平均值" : "参考线：中位数 + 平均值";
    const axisNote = mcState.dualAxis && mcAxisGroups(mcState.metrics).groups.length > 1 ? " · 双轴" : "";
    note.textContent = granNote + " · " + refNote + axisNote + (naList.length ? " · 暂不可用：" + naList.join("、") : "");
  }
}
function mcRenderMetricPanel() {
  const panel = document.getElementById("mcMetricPanel");
  if (!panel || !currentData) return;
  const q = (mcState.search || "").trim();
  const rows = MC_METRICS.filter((m) => {
    if (q && !m.label.toLowerCase().includes(q.toLowerCase()) && !m.desc.includes(q)) return false;
    if (mcState.unitFilter !== "any" && m.group !== mcState.unitFilter) return false;
    return true;
  });
  const html = rows.map((m) => {
    const checked = mcState.metrics.includes(m.id);
    const av = mcAvail[m.id];
    const na = av ? av.na : null;
    const can = na ? { ok: false, reason: na } : mcCanAdd(mcState.metrics, m.id);
    const disabled = !checked && (!can.ok || !!na);
    return `<label class="mc-metric-row${disabled ? " disabled" : ""}">
      <input type="checkbox" data-mc-metric="${m.id}"${checked ? " checked" : ""}${disabled ? " disabled" : ""}>
      <span class="mc-metric-label">${esc(m.label)}</span>
      <span class="badge">${esc(MC_GROUP_LABEL[m.group])}</span>
      <span class="mc-metric-desc">${esc(m.desc)}</span>
      ${na ? `<span class="mc-metric-na">暂不可用：${esc(na)}</span>` : ""}
    </label>`;
  }).join("") || `<p class="muted">没有匹配的指标。</p>`;
  panel.innerHTML = html;
  panel.querySelectorAll("[data-mc-metric]").forEach((cb) => cb.addEventListener("change", () => {
    const id = cb.dataset.mcMetric;
    if (cb.checked) {
      const can = mcCanAdd(mcState.metrics, id);
      if (!can.ok) { cb.checked = false; mcNote(can.reason); return; }
      mcState.metrics.push(id);
    } else {
      mcState.metrics = mcState.metrics.filter((x) => x !== id);
    }
    mcSyncForm();
    mcDrawPreview();
  }));
  const cnt = document.getElementById("mcMetricCount");
  if (cnt) cnt.textContent = mcState.metrics.length + " / 6 项指标";
  const sel = document.getElementById("mcSelectedChips");
  if (sel) {
    sel.innerHTML = mcState.metrics.map((id, i) => {
      const def = MC_METRICS.find((x) => x.id === id);
      return `<span class="mc-chip" style="border-color:${MC_COLORS[i % MC_COLORS.length]}"><i style="background:${MC_COLORS[i % MC_COLORS.length]}"></i>${esc(def.label)}<a href="#" data-mc-remove="${id}">×</a></span>`;
    }).join("");
    sel.querySelectorAll("[data-mc-remove]").forEach((a) => a.addEventListener("click", (ev) => {
      ev.preventDefault();
      mcState.metrics = mcState.metrics.filter((x) => x !== a.dataset.mcRemove);
      mcSyncForm();
      mcDrawPreview();
    }));
  }
}
function mcNote(msg) {
  const el = document.getElementById("mcFormNote");
  if (el) el.textContent = msg;
}
function mcSyncForm() {
  const setSeg = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.val === val));
  };
  setSeg("mcPeriodSeg", mcState.period);
  setSeg("mcGranSeg", mcState.gran);
  setSeg("mcRefSeg", mcState.refline);
  const dual = document.getElementById("mcDualAxis");
  if (dual) dual.checked = !!mcState.dualAxis;
  const nm = document.getElementById("mcName");
  if (nm && nm.value !== mcState.name) nm.value = mcState.name;
  mcRenderMetricPanel();
}
function renderMycharts() {
  const el = document.getElementById("mychartsBody");
  if (!el || !currentData) return;
  if (mcPendingConfig && mcPendingConfig.code === currentCode) {
    mcApplyConfig(mcPendingConfig);
    mcPendingConfig = null;
  }
  mcAvail = mcAvailability(currentData, mcState.gran);
  const m = currentMetrics || {};
  const q = currentData.quote || {};
  const name = q.name || (currentData.tx && currentData.tx.name) || currentCode;
  const r52 = (typeof range52 === "function") ? range52(currentData) : null;
  const chips = (typeof buildChipsHtml === "function") ? buildChipsHtml(currentData, m) : "";
  const saved = loadMyCharts();
  const savedHtml = saved.length ? saved.map((c) => {
    const isBuilder = c.kind === "builder";
    const meta = isBuilder
      ? `${(c.metrics || []).length} 项指标 · ${MC_PERIOD_LABEL[c.period] || c.period} · ${MC_GRAN_LABEL[c.gran] || c.gran}`
      : `${kltLabel(c.klt || 101)} · ${c.date || ""}`;
    return `<div class="mc-saved-row">
      <div class="mc-saved-info"><a href="#" data-open-chart="${c.id}" class="mc-saved-name">${esc(c.name)}</a>
      <div class="muted small">${esc(c.code)} · ${esc(meta)}${c.price != null ? " · " + c.price + (c.changePct != null ? " (" + (c.changePct > 0 ? "+" : "") + c.changePct.toFixed(2) + "%)" : "") : ""}</div></div>
      <a href="#" data-del-chart="${c.id}" class="mc-del">删除</a>
    </div>`;
  }).join("") : `<div class="mc-empty">还没有保存的图片<br><span class="muted small">在下方新建图表并保存后会出现在这里。</span></div>`;
  el.innerHTML = `
  <div class="card ov-head-card"><div class="stock-head">
    <div class="sh-logo">${esc(name.slice(0, 1))}</div>
    <div class="sh-left"><div class="sh-name">${esc(name)} <span class="muted">(${esc(currentCode)})</span></div>
    <div class="sh-code">${esc(q.market || "")} · ${esc(q.industry || "")}</div>
    <div class="sh-meta small muted">${esc(q.listDate ? "上市 " + q.listDate : "")}</div></div>
    <div class="sh-right"><div class="sh-price-col"><div class="sh-price"><span class="p">${m.price != null ? m.price : "—"}</span> <span class="c ${chgClass(m.changePct)}">${chgText(m.changePct)}</span></div>
    <div class="small muted">${r52 ? "52周 " + r52.low + "–" + r52.high : ""}</div></div></div>
  </div></div>
  <div class="ov-chips">${chips}</div>
  <h3>🎨 我的图片</h3>
  <p class="muted">把想长期跟踪的指标画成图、存下来随时回看。图表只在你自己的浏览器里保存，不上传。数据来自本站已有的东财 F10 三表与行情，红涨绿跌。</p>
  <h3>💾 我保存的图片 (${saved.length})</h3>
  ${savedHtml}
  <div class="card mc-form">
    <h3>✏️ 新图表</h3>
    <label class="mc-field">图表名称 <input id="mcName" type="text" placeholder="例如：茅台 PE 与 ROE 走势" value="${esc(mcState.name)}"></label>
    <div class="mc-row"><span class="mc-label">周期</span>
      <div class="seg" id="mcPeriodSeg">${["5y", "10y", "15y", "all"].map((p) => `<button data-val="${p}" class="${mcState.period === p ? "active" : ""}">${MC_PERIOD_LABEL[p]}</button>`).join("")}</div>
    </div>
    <div class="mc-row"><span class="mc-label">数据口径</span>
      <div class="seg" id="mcGranSeg">${["q", "ttm", "y"].map((g) => `<button data-val="${g}" class="${mcState.gran === g ? "active" : ""}">${MC_GRAN_LABEL[g]}</button>`).join("")}</div>
      <span class="muted small">季刊=单季值 · TTM=滚动近4季 · 年度=年报全年值</span>
    </div>
    <div class="mc-row"><span class="mc-label">参考线</span>
      <div class="seg" id="mcRefSeg">${[["none", "没有任何"], ["median", "中位数"], ["mean", "平均的"], ["both", "两个都"]].map(([v, l]) => `<button data-val="${v}" class="${mcState.refline === v ? "active" : ""}">${l}</button>`).join("")}</div>
      <span class="muted small">按当前窗口内数据计算</span>
    </div>
    <div class="mc-row"><span class="mc-label">指标</span>
      <input id="mcSearch" type="text" placeholder="搜索指标…" value="${esc(mcState.search)}">
      <select id="mcUnitFilter"><option value="any">任何一个</option><option value="money">金额</option><option value="pct">百分比</option><option value="ratio">倍数</option></select>
      <button class="btn" id="mcToggleList">查看指标列表</button>
      <span class="muted small" id="mcMetricCount">0 / 6 项指标</span>
    </div>
    <div id="mcMetricPanel" class="mc-metric-panel"></div>
    <div id="mcSelectedChips" class="mc-selected"></div>
    <div class="mc-row"><label class="mc-check"><input type="checkbox" id="mcDualAxis"${mcState.dualAxis ? " checked" : ""}> 双轴（两种单位类型分左右轴显示）</label>
      <button class="btn primary" id="mcSaveBtn">💾 保存图表</button>
      <span class="muted small" id="mcFormNote"></span>
    </div>
    <div class="chart-box tall"><canvas id="mcChart"></canvas></div>
    <p class="muted small" id="mcChartNote"></p>
  </div>
  <p class="muted small">口径说明：季刊为单季值（本季累计减上季累计），TTM 为滚动近 4 个单季之和，年度为年报全年值；价格取季末/年末月收盘（月 K 上限约 10 年，超限期数记空）。ROE/ROIC/ROCE 分母取期末净资产/总资产。分红按除权日滚动 12 个月。指标全部来自本站已有东财 F10 数据与行情，不构成投资建议。</p>`;
  // 绑定
  const bindSeg = (id, key, after) => {
    const seg = document.getElementById(id);
    if (!seg) return;
    seg.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      mcState[key] = b.dataset.val;
      seg.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
      if (after) after();
    }));
  };
  bindSeg("mcPeriodSeg", "period", () => mcDrawPreview());
  bindSeg("mcGranSeg", "gran", () => { mcAvail = mcAvailability(currentData, mcState.gran); mcRenderMetricPanel(); mcDrawPreview(); });
  bindSeg("mcRefSeg", "refline", () => mcDrawPreview());
  document.getElementById("mcName").addEventListener("input", (e) => { mcState.name = e.target.value; });
  document.getElementById("mcSearch").addEventListener("input", (e) => { mcState.search = e.target.value; mcRenderMetricPanel(); });
  document.getElementById("mcUnitFilter").addEventListener("change", (e) => { mcState.unitFilter = e.target.value; mcRenderMetricPanel(); });
  document.getElementById("mcToggleList").addEventListener("click", () => {
    const p = document.getElementById("mcMetricPanel");
    p.style.display = p.style.display === "none" ? "" : "none";
  });
  document.getElementById("mcDualAxis").addEventListener("change", (e) => { mcState.dualAxis = e.target.checked; mcDrawPreview(); });
  document.getElementById("mcSaveBtn").addEventListener("click", () => {
    if (!mcState.metrics.length) { mcNote("请先选至少 1 项可用指标。"); return; }
    const name = (mcState.name || "").trim() || (name + " " + currentCode + " " + new Date().toLocaleDateString("zh-CN"));
    const list = loadMyCharts();
    list.unshift({
      id: "c" + Date.now(), kind: "builder", name, code: currentCode,
      date: new Date().toLocaleDateString("zh-CN"),
      period: mcState.period, gran: mcState.gran, refline: mcState.refline,
      metrics: mcState.metrics.slice(), dualAxis: mcState.dualAxis,
      price: m.price != null ? m.price : null, changePct: m.changePct != null ? m.changePct : null,
    });
    saveMyCharts(list);
    mcNote("✓ 已保存到「我保存的图片」。");
    renderMycharts();
  });
  el.querySelectorAll("[data-open-chart]").forEach((a) => a.addEventListener("click", (ev) => {
    ev.preventDefault();
    const c = loadMyCharts().find((x) => x.id === a.dataset.openChart);
    if (!c) return;
    if (c.kind === "builder") {
      if (c.code === currentCode) { mcApplyConfig(c); mcSyncForm(); mcDrawPreview(); document.getElementById("mcName").focus(); }
      else {
        mcPendingConfig = c;
        loadStock(c.code).then(() => {
          const b = document.querySelector('#toolTabs button[data-tool="mycharts"]');
          if (b) b.click();
          renderMycharts();
        });
      }
      return;
    }
    currentKlt = c.klt || 101;
    document.querySelectorAll("#klineSeg button").forEach((b) => b.classList.toggle("active", parseInt(b.dataset.klt, 10) === currentKlt));
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === "tech"));
    document.querySelectorAll(".tab-pane").forEach((p) => p.classList.toggle("active", p.id === "pane-tech"));
    document.getElementById("toolArea").style.display = "none";
    document.getElementById("detailArea").style.display = "block";
    document.querySelectorAll("#toolTabs button").forEach((b) => b.classList.remove("active"));
    loadStock(c.code);
  }));
  el.querySelectorAll("[data-del-chart]").forEach((a) => a.addEventListener("click", (ev) => {
    ev.preventDefault();
    saveMyCharts(loadMyCharts().filter((x) => x.id !== a.dataset.delChart));
    renderMycharts();
  }));
  mcSyncForm();
  mcDrawPreview();
}
// E2E 桩点
window.__mcTest = { MC_METRICS, mcBuildSeries, mcSingleQ, mcTTMAt, mcPriceAt, mcDpsTtmAt, mcWindowFilter, mcMean, mcAxisGroups, mcCanAdd, mcAvailability, mcPrepPeriods, drawMcLines, loadMyCharts, saveMyCharts, kltLabel };


// ============================================================
// A股基本面分析 — Canvas 图表
// 2026-11-09 补全：此前文件缺失基础绘图层（setupCanvas / drawKline /
// drawBars / drawDrawdown / maSeries 与配色常量），导致技术、历史演变、
// 价格与回撤、分红、盈利各图的绘制函数在运行时报 ReferenceError。
// 本段按 app.js / drawKlineOverlay 的调用约定重建；布局参数与
// drawKlineOverlay 保持一致（pad l:8 r:56 t:10 b:22，量区占 22%），
// 否则布林带/MA50/200 叠加线会对不齐。
// A 股红涨绿跌：涨 #e5484d，跌 #1a9e54。
// ============================================================
const C_TEXT = "#1f2937";
const C_GRID = "#e5e7eb";
const C_UP = "#e5484d";
const C_DOWN = "#1a9e54";
const C_BLUE = "#2563eb";
const C_AMBER = "#f59e0b";

// ---------- 画布初始化 ----------
// 按 CSS 尺寸 × devicePixelRatio 设 canvas 像素尺寸并缩放 ctx。
// 画布所在标签页未显示时 clientWidth 为 0，返回 null，调用方直接跳过。
function setupCanvas(canvas) {
  if (!canvas) return null;
  const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return null;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

// ---------- 简单移动平均序列（与 finance.js 的 smaSeries 同口径）----------
function maSeries(values, period) {
  const out = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let s = 0, ok = true;
    for (let j = i - period + 1; j <= i; j++) {
      if (values[j] == null) { ok = false; break; }
      s += values[j];
    }
    if (ok) out[i] = s / period;
  }
  return out;
}

// ---------- K 线图（蜡烛 + 成交量）----------
// 布局与 drawKlineOverlay 严格一致：pad {l:8, r:56, t:10, b:22}，
// 量区高 = (h-pad.t-pad.b) × 22%，价区高 = 剩余 − 6。
function drawKline(canvas, klines, opts = {}) {
  const s = setupCanvas(canvas);
  if (!s || !klines || !klines.length) return;
  const { ctx, w, h } = s;
  ctx.clearRect(0, 0, w, h);
  const limit = opts.limit || 180;
  const data = klines.slice(-Math.min(limit, klines.length));
  const n = data.length;
  const pad = { l: 8, r: 56, t: 10, b: 22 };
  const volH = Math.round((h - pad.t - pad.b) * 0.22);
  const priceH = h - pad.t - pad.b - volH - 6;
  let lo = Infinity, hi = -Infinity, maxVol = 0;
  for (const k of data) {
    lo = Math.min(lo, k.low); hi = Math.max(hi, k.high);
    maxVol = Math.max(maxVol, k.volume || 0);
  }
  if (!isFinite(lo) || !isFinite(hi) || hi <= lo) return;
  const padY = (hi - lo) * 0.06 || 1; lo -= padY; hi += padY;
  const yP = (v) => pad.t + (hi - v) / (hi - lo) * priceH;
  const yV = (v) => pad.t + priceH + 6 + (1 - (maxVol ? v / maxVol : 0)) * volH;
  const step = (w - pad.l - pad.r) / n;
  const xOf = (i) => pad.l + i * step + step / 2;
  // 横向网格 + 右侧价格刻度
  ctx.strokeStyle = C_GRID; ctx.lineWidth = 1;
  ctx.fillStyle = C_TEXT; ctx.font = "11px sans-serif"; ctx.textAlign = "left";
  const levels = 4;
  for (let g = 0; g <= levels; g++) {
    const v = lo + (hi - lo) * g / levels;
    const y = yP(v);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.fillText(v.toFixed(2), w - pad.r + 5, y + 4);
  }
  // 蜡烛 + 量柱
  const bodyW = Math.max(1, step * 0.7);
  for (let i = 0; i < n; i++) {
    const k = data[i];
    const up = k.close >= k.open;
    const col = up ? C_UP : C_DOWN;
    const x = xOf(i);
    ctx.strokeStyle = col; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, yP(k.high)); ctx.lineTo(x, yP(k.low)); ctx.stroke();
    ctx.fillStyle = col;
    const yO = yP(k.open), yC = yP(k.close);
    ctx.fillRect(x - bodyW / 2, Math.min(yO, yC), bodyW, Math.max(1, Math.abs(yC - yO)));
    if (k.volume != null) {
      ctx.fillStyle = up ? "rgba(229,72,77,.55)" : "rgba(26,158,84,.55)";
      ctx.fillRect(x - bodyW / 2, yV(k.volume), bodyW, Math.max(1, pad.t + priceH + 6 + volH - yV(k.volume)));
    }
  }
  // 底部日期（取 4 个）
  ctx.fillStyle = C_TEXT; ctx.font = "11px sans-serif"; ctx.textAlign = "center";
  for (let g = 0; g < 4; g++) {
    const i = Math.floor(g * (n - 1) / 3);
    ctx.fillText(String(data[i].date).slice(0, 10), xOf(i), h - 6);
  }
  // 最新价
  const last = data[n - 1];
  ctx.textAlign = "left";
  ctx.fillStyle = last.close >= last.open ? C_UP : C_DOWN;
  ctx.fillText("最新 " + last.close.toFixed(2), pad.l + 4, pad.t + 12);
}

// ---------- 分组柱状图 ----------
// data: [{label, v1, v2?}]；opts: {label1, label2?}。v1 蓝色，v2 琥珀色。
function drawBars(canvas, data, opts = {}) {
  const s = setupCanvas(canvas);
  if (!s || !data || !data.length) return;
  const { ctx, w, h } = s;
  ctx.clearRect(0, 0, w, h);
  const pad = { l: 8, r: 56, t: 26, b: 22 };
  let lo = 0, hi = 0;
  for (const d of data) {
    for (const v of [d.v1, d.v2]) {
      if (v == null) continue;
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
  }
  if (hi <= lo) hi = lo + 1;
  const padY = (hi - lo) * 0.08 || 1; lo -= padY; hi += padY;
  const yOf = (v) => pad.t + (hi - v) / (hi - lo) * (h - pad.t - pad.b);
  const n = data.length;
  const groupW = (w - pad.l - pad.r) / n;
  const barW = Math.min(28, groupW / 2.6);
  // 零线 + 网格
  ctx.strokeStyle = C_GRID; ctx.lineWidth = 1;
  const y0 = yOf(0);
  ctx.beginPath(); ctx.moveTo(pad.l, y0); ctx.lineTo(w - pad.r, y0); ctx.stroke();
  ctx.fillStyle = C_TEXT; ctx.font = "11px sans-serif"; ctx.textAlign = "left";
  for (let g = 1; g <= 3; g++) {
    const v = lo + (hi - lo) * g / 4;
    const y = yOf(v);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.fillText(v.toFixed(0), w - pad.r + 5, y + 4);
  }
  // 图例
  ctx.font = "12px sans-serif";
  ctx.fillStyle = C_BLUE; ctx.fillText(opts.label1 || "系列1", pad.l + 4, pad.t - 8);
  if (opts.label2) {
    ctx.fillStyle = C_AMBER;
    ctx.fillText(opts.label2, pad.l + 4 + ctx.measureText(opts.label1 || "").width + 18, pad.t - 8);
  }
  // 柱子
  for (let i = 0; i < n; i++) {
    const d = data[i];
    const cx = pad.l + i * groupW + groupW / 2;
    if (d.v1 != null) {
      ctx.fillStyle = C_BLUE;
      ctx.fillRect(cx - barW - 1, Math.min(y0, yOf(d.v1)), barW, Math.abs(yOf(d.v1) - y0));
    }
    if (d.v2 != null) {
      ctx.fillStyle = C_AMBER;
      ctx.fillRect(cx + 1, Math.min(y0, yOf(d.v2)), barW, Math.abs(yOf(d.v2) - y0));
    }
    ctx.fillStyle = C_TEXT; ctx.font = "11px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(String(d.label), cx, h - 6);
  }
}

// ---------- 回撤图（回撤 % 面积图，0 在顶部，向下为负）----------
function drawDrawdown(canvas, klines) {
  const s = setupCanvas(canvas);
  if (!s || !klines || klines.length < 2) return;
  const { ctx, w, h } = s;
  ctx.clearRect(0, 0, w, h);
  const closes = klines.map((k) => k.close);
  let peak = -Infinity;
  const dd = closes.map((c) => {
    if (c > peak) peak = c;
    return c / peak - 1;
  });
  const minDd = Math.min(...dd);
  const pad = { l: 8, r: 56, t: 26, b: 22 };
  const lo = Math.min(minDd * 1.1, -0.01), hi = 0;
  const yOf = (v) => pad.t + (hi - v) / (hi - lo) * (h - pad.t - pad.b);
  const step = (w - pad.l - pad.r) / dd.length;
  const xOf = (i) => pad.l + i * step + step / 2;
  // 网格 + 刻度
  ctx.strokeStyle = C_GRID; ctx.lineWidth = 1;
  ctx.fillStyle = C_TEXT; ctx.font = "11px sans-serif"; ctx.textAlign = "left";
  for (let g = 0; g <= 4; g++) {
    const v = lo + (hi - lo) * g / 4;
    const y = yOf(v);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.fillText((v * 100).toFixed(0) + "%", w - pad.r + 5, y + 4);
  }
  // 回撤面积
  ctx.beginPath();
  dd.forEach((v, i) => {
    const x = xOf(i), y = yOf(v);
    if (i === 0) ctx.moveTo(x, yOf(0));
    ctx.lineTo(x, y);
  });
  ctx.lineTo(xOf(dd.length - 1), yOf(0));
  ctx.closePath();
  ctx.fillStyle = "rgba(229,72,77,.18)";
  ctx.fill();
  ctx.beginPath();
  dd.forEach((v, i) => {
    const x = xOf(i), y = yOf(v);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = C_UP; ctx.lineWidth = 1.4; ctx.stroke();
  ctx.fillStyle = C_TEXT; ctx.font = "12px sans-serif"; ctx.textAlign = "left";
  ctx.fillText("最大回撤 " + (minDd * 100).toFixed(1) + "% · 当前回撤 " + (dd[dd.length - 1] * 100).toFixed(1) + "%", pad.l + 4, pad.t - 8);
  ctx.textAlign = "center";
  ctx.fillText(String(klines[0].date).slice(0, 10), xOf(0), h - 6);
  ctx.fillText(String(klines[klines.length - 1].date).slice(0, 10), xOf(dd.length - 1), h - 6);
}

// ---------- 振荡指标图（RSI / 随机指标 / Williams %R，带超买超卖带）----------
// series: 数值数组（可含 null）；bands: {over: 上阈, under: 下阈}
function drawOscillator(canvas, series, opts = {}) {
  const s = setupCanvas(canvas);
  if (!s) return;
  const { ctx, w, h } = s;
  ctx.clearRect(0, 0, w, h);
  const vals = series.filter((v) => v != null);
  if (!vals.length) { ctx.fillStyle = C_TEXT; ctx.font = "13px sans-serif"; ctx.fillText("暂无数据", 12, 24); return; }
  const pad = { l: 8, r: 44, t: 10, b: 20 };
  const lo = opts.min != null ? opts.min : Math.min(...vals, 0);
  const hi = opts.max != null ? opts.max : Math.max(...vals, 100);
  const yOf = (v) => pad.t + (hi - v) / (hi - lo) * (h - pad.t - pad.b);
  // 超买/超卖带
  if (opts.over != null) {
    ctx.fillStyle = "rgba(229,72,77,.07)";
    ctx.fillRect(pad.l, pad.t, w - pad.l - pad.r, yOf(opts.over) - pad.t);
  }
  if (opts.under != null) {
    ctx.fillStyle = "rgba(26,158,84,.07)";
    ctx.fillRect(pad.l, yOf(opts.under), w - pad.l - pad.r, pad.t + (h - pad.t - pad.b) - yOf(opts.under));
  }
  ctx.strokeStyle = C_GRID; ctx.lineWidth = 1;
  [0, 25, 50, 75, 100].forEach((v) => {
    if (v < lo || v > hi) return;
    const y = yOf(v);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.fillStyle = C_TEXT; ctx.font = "11px sans-serif"; ctx.textAlign = "left";
    ctx.fillText(String(v), w - pad.r + 5, y + 4);
  });
  // 阈值线
  ctx.setLineDash([4, 4]);
  if (opts.over != null) { ctx.strokeStyle = C_UP; ctx.beginPath(); ctx.moveTo(pad.l, yOf(opts.over)); ctx.lineTo(w - pad.r, yOf(opts.over)); ctx.stroke(); }
  if (opts.under != null) { ctx.strokeStyle = C_DOWN; ctx.beginPath(); ctx.moveTo(pad.l, yOf(opts.under)); ctx.lineTo(w - pad.r, yOf(opts.under)); ctx.stroke(); }
  ctx.setLineDash([]);
  // 曲线
  const step = (w - pad.l - pad.r) / series.length;
  ctx.strokeStyle = opts.color || "#8b5cf6"; ctx.lineWidth = 1.5; ctx.beginPath();
  let started = false;
  series.forEach((v, i) => {
    if (v == null) return;
    const x = pad.l + i * step + step / 2;
    if (!started) { ctx.moveTo(x, yOf(v)); started = true; }
    else ctx.lineTo(x, yOf(v));
  });
  ctx.stroke();
  if (opts.extra) {
    ctx.strokeStyle = opts.extraColor || "#f59e0b"; ctx.lineWidth = 1.2; ctx.beginPath();
    let st2 = false;
    opts.extra.forEach((v, i) => {
      if (v == null) return;
      const x = pad.l + i * step + step / 2;
      if (!st2) { ctx.moveTo(x, yOf(v)); st2 = true; }
      else ctx.lineTo(x, yOf(v));
    });
    ctx.stroke();
  }
  const last = vals[vals.length - 1];
  ctx.fillStyle = C_TEXT; ctx.font = "12px sans-serif"; ctx.textAlign = "left";
  ctx.fillText((opts.label || "") + " 最新 " + last.toFixed(1), pad.l + 4, pad.t + 12);
  ctx.textAlign = "center";
  ctx.fillText(series.length ? "" : "", pad.l, h - 6);
}

// ---------- MACD 图（DIF/DEA + 柱状图）----------
function drawMACD(canvas, dif, dea) {
  const s = setupCanvas(canvas);
  if (!s) return;
  const { ctx, w, h } = s;
  ctx.clearRect(0, 0, w, h);
  const n = dif.length;
  const vals = [];
  for (let i = 0; i < n; i++) {
    if (dif[i] != null) vals.push(dif[i]);
    if (dea[i] != null) vals.push(dea[i]);
    if (dif[i] != null && dea[i] != null) vals.push((dif[i] - dea[i]) * 2);
  }
  if (!vals.length) { ctx.fillStyle = C_TEXT; ctx.font = "13px sans-serif"; ctx.fillText("暂无数据", 12, 24); return; }
  const pad = { l: 8, r: 44, t: 10, b: 20 };
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const padY = (hi - lo) * 0.1 || 1; lo -= padY; hi += padY;
  const yOf = (v) => pad.t + (hi - v) / (hi - lo) * (h - pad.t - pad.b);
  const step = (w - pad.l - pad.r) / n;
  // 零线
  ctx.strokeStyle = C_GRID; ctx.beginPath();
  ctx.moveTo(pad.l, yOf(0)); ctx.lineTo(w - pad.r, yOf(0)); ctx.stroke();
  // 柱状图
  for (let i = 0; i < n; i++) {
    if (dif[i] == null || dea[i] == null) continue;
    const hv = (dif[i] - dea[i]) * 2;
    const x = pad.l + i * step + step / 2;
    ctx.fillStyle = hv >= 0 ? "rgba(229,72,77,.6)" : "rgba(26,158,84,.6)";
    const y0 = yOf(0), y1 = yOf(hv);
    ctx.fillRect(x - Math.max(1, step * 0.35), Math.min(y0, y1), Math.max(1, step * 0.7), Math.max(1, Math.abs(y1 - y0)));
  }
  const line = (arr, col) => {
    ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.beginPath();
    let st = false;
    arr.forEach((v, i) => {
      if (v == null) return;
      const x = pad.l + i * step + step / 2;
      if (!st) { ctx.moveTo(x, yOf(v)); st = true; }
      else ctx.lineTo(x, yOf(v));
    });
    ctx.stroke();
  };
  line(dif, "#2b6cb0");
  line(dea, "#f59e0b");
  ctx.fillStyle = C_TEXT; ctx.font = "11px sans-serif"; ctx.textAlign = "left";
  ctx.fillStyle = "#2b6cb0"; ctx.fillText("DIF", pad.l + 4, pad.t + 12);
  ctx.fillStyle = "#f59e0b"; ctx.fillText("DEA", pad.l + 44, pad.t + 12);
  const ld = dif[dif.length - 1], ls = dea[dea.length - 1];
  ctx.fillStyle = C_TEXT;
  ctx.fillText("最新 DIF " + (ld != null ? ld.toFixed(2) : "—") + " · DEA " + (ls != null ? ls.toFixed(2) : "—"), pad.l + 90, pad.t + 12);
}

// ---------- K 线叠加布林带与 MA50/200 ----------
// 注意：不能在 drawKline 之后再调 setupCanvas（重设 canvas.width 会清空画布）。
// 这里直接读 clientWidth/Height，不重置尺寸。
function drawKlineOverlay(canvas, klines, tech) {
  drawKline(canvas, klines, { limit: 180 });
  if (!tech || !tech.bollSeries) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const data = klines.slice(-Math.min(180, klines.length));
  const pad = { l: 8, r: 56, t: 10, b: 22 };
  const volH = Math.round((h - pad.t - pad.b) * 0.22);
  const priceH = h - pad.t - pad.b - volH - 6;
  let lo = Infinity, hi = -Infinity;
  for (const k of data) { lo = Math.min(lo, k.low); hi = Math.max(hi, k.high); }
  const padY = (hi - lo) * 0.06 || 1; lo -= padY; hi += padY;
  const yP = (v) => pad.t + (hi - v) / (hi - lo) * priceH;
  const n = data.length;
  const step = (w - pad.l - pad.r) / n;
  const closes = data.map((k) => k.close);
  const ma50 = maSeries(closes, 50), ma200 = maSeries(closes, 200);
  const drawSeries = (arr, col, width) => {
    ctx.strokeStyle = col; ctx.lineWidth = width || 1.2; ctx.beginPath();
    let st = false;
    arr.forEach((v, i) => {
      if (v == null) return;
      const x = pad.l + i * step + step / 2;
      if (!st) { ctx.moveTo(x, yP(v)); st = true; }
      else ctx.lineTo(x, yP(v));
    });
    ctx.stroke();
  };
  const off = klines.length - n;
  const bollUp = tech.bollSeries.up.slice(off), bollMid = tech.bollSeries.mid.slice(off), bollLow = tech.bollSeries.low.slice(off);
  drawSeries(bollUp, "rgba(139,92,246,.7)", 1);
  drawSeries(bollMid, "rgba(139,92,246,.4)", 1);
  drawSeries(bollLow, "rgba(139,92,246,.7)", 1);
  drawSeries(ma50, "#f59e0b", 1.4);
  drawSeries(ma200, "#ff8c42", 1.4);
}

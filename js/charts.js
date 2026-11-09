
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

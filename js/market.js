// ============================================================
// 市场看板（v13）— TSP 风格的当日市场全景
// 数据来源（全部东财 / 腾讯免费公开接口，浏览器直调，无 Key）：
//   指数：push2 ulist.np/get（上证 000001 / 深证 399001 / 创业板 399006 / 科创综指 000680，
//        2026-11-09 实测：科创综指 000680 收 1502.98 +0.44%，与图版一致；000688 是科创50，勿混用）。
//   全市场：push2 clist 分页（单页上限 100 行，约 5563 只，共 56 页，并发 6，
//        单页失败重试 1 次；涨/平/跌、涨跌分布、涨停/跌停、炸板、成交额、换手/量比、
//        高换手、放量占比、平均/中位涨跌均由此算）。
//   板块：clist m:90+t:2（行业 496 个）/ m:90+t:3（概念 531 个），涨跌幅降序/升序各取 1 页
//        得领涨/领跌前 5；领涨股与板块详情用 fs=b:BKxxxx 取该板块成分股。
//   榜单：clist fid 排序（涨幅 f3 降序 / 跌幅 f3 升序 / 成交额 f6 降序 / 换手 f8 降序）。
//   自选股：腾讯 qt 批量行情 + 各股 70 日 K 线算 MA5/20/60 与 60 日新高/新低。
//   连板梯队：涨停池接口 push2ex getTopicZTPool 在本机出口持续 rc=102，且字段映射
//        未经核实，故改用“clist 判定当日涨停 + 逐只日 K 数连续涨停天数”，不依赖该接口。
// 口径说明（页上注明）：
//   趋势强度与 60 日新高/新低为自选股口径（12 只）——全市场 5000+ 只逐只拉 K 线
//   在浏览器内不可行；其余统计均为全市场口径。情绪雷达六维公式见 renderMarketEmotion。
// 涨停判定：涨停价 = 昨收 × 涨停倍率（主板 1.10 / 创业板·科创板 1.20 / 北交所 1.30 /
//   ST 1.05），四舍五入到分；现价 ≥ 涨停价 − 0.005 即封板，最高价触及但收盘未封即炸板。
// ============================================================

const MK_INDEXES = [
  { code: "000001", name: "上证指数" },
  { code: "399001", name: "深证成指" },
  { code: "399006", name: "创业板指" },
  { code: "000680", name: "科创综指" },
];
const MK_SCAN_FIELDS = "f12,f13,f14,f2,f3,f4,f5,f6,f7,f8,f9,f10,f15,f16,f17,f18,f20,f21,f23";
const MK_SCAN_FS = "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23";
const MK_UT = "&ut=bd1d9ddb04089700cf9c27f6f742628";
let mkCache = null;       // {data, fetchedAt}
let mkLadder = null;      // {status: "loading"|"done"|"unavailable", tiers, maxStreak, note}

// ---------- 小工具 ----------
function mkCls(v) { return v > 0 ? "up" : v < 0 ? "down" : "flat"; }
function mkPct(v, digits) {
  if (v == null || !isFinite(v)) return "—";
  return (v > 0 ? "+" : "") + v.toFixed(digits == null ? 2 : digits) + "%";
}
function mkNum(v, digits) {
  if (v == null || !isFinite(v)) return "—";
  return Number(v).toLocaleString("zh-CN", { maximumFractionDigits: digits == null ? 0 : digits });
}
function mkYi(v) { // 元 → 亿元
  if (v == null || !isFinite(v)) return "—";
  return (v / 1e8).toLocaleString("zh-CN", { maximumFractionDigits: 2 }) + "亿";
}
function mkWanYi(v) { // 元 → 万亿元
  if (v == null || !isFinite(v)) return "—";
  return (v / 1e12).toLocaleString("zh-CN", { maximumFractionDigits: 2 }) + "万亿";
}
function mkPool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); }
      catch (e) { out[idx] = { __err: e }; }
    }
  }
  const workers = [];
  for (let k = 0; k < Math.min(n, items.length); k++) workers.push(worker());
  return Promise.all(workers).then(() => out);
}
function mkMean(arr) {
  const a = arr.filter((v) => v != null && isFinite(v));
  if (!a.length) return null;
  return a.reduce((s, v) => s + v, 0) / a.length;
}
function mkMedian(arr) {
  const a = arr.filter((v) => v != null && isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function mkMa(closes, n) {
  if (!closes || closes.length < n) return null;
  let s = 0;
  for (let i = closes.length - n; i < closes.length; i++) s += closes[i];
  return s / n;
}
function mkLimitFactor(code, name) {
  if (/^(43|83|87|92)/.test(code) || /^8/.test(code)) return 1.30; // 北交所
  if (/^(30|68)/.test(code)) return 1.20;                        // 创业板 / 科创板
  if (/ST/.test(name || "")) return 1.05;                        // ST
  return 1.10;                                                    // 主板
}
function mkLimitPrice(prev, factor) { return Math.round(prev * factor * 100) / 100; }
function mkIsLimitUp(r) {
  if (r.prevClose == null || r.price == null) return false;
  return r.price >= mkLimitPrice(r.prevClose, mkLimitFactor(r.code, r.name)) - 0.005 && r.changePct > 0;
}
function mkIsLimitDown(r) {
  if (r.prevClose == null || r.price == null) return false;
  const f = mkLimitFactor(r.code, r.name);
  return r.price <= mkLimitPrice(r.prevClose, 2 - f) + 0.005 && r.changePct < 0;
}
function mkIsOpenBoard(r) { // 炸板：最高价触及涨停价但收盘未封
  if (r.prevClose == null || r.high == null || r.price == null) return false;
  const lp = mkLimitPrice(r.prevClose, mkLimitFactor(r.code, r.name));
  return r.high >= lp - 0.005 && r.price < lp - 0.005;
}

// ---------- 数据拉取 ----------
async function mkFetchScanPage(pn) {
  const url = API.EM_CLIST + "?fid=f3&po=1&pz=100&pn=" + pn + "&np=1&fltt=2&invt=2"
    + "&fs=" + MK_SCAN_FS + "&fields=" + MK_SCAN_FIELDS + MK_UT;
  const j = await emFetch(url);
  return j.data || {};
}
function mkNum(v) { return typeof v === "number" && isFinite(v) ? v : null; } // 东财对停牌/退市股返回 "-" 字符串
function mkNormScanRow(it) {
  return {
    code: it.f12, name: it.f14, market: it.f13,
    price: mkNum(it.f2), changePct: mkNum(it.f3), changeAmt: mkNum(it.f4),
    volume: mkNum(it.f5), amount: mkNum(it.f6), amplitude: mkNum(it.f7), turnover: mkNum(it.f8),
    pe: mkNum(it.f9), volRatio: mkNum(it.f10), high: mkNum(it.f15), low: mkNum(it.f16), open: mkNum(it.f17),
    prevClose: mkNum(it.f18), totalMcap: mkNum(it.f20), floatMcap: mkNum(it.f21), pb: mkNum(it.f23),
  };
}
async function mkFetchScanPageRetry(pn, attempts) {
  let last = null;
  for (let a = 0; a < attempts; a++) {
    try { return await mkFetchScanPage(pn); }
    catch (e) { last = e; await new Promise((r) => setTimeout(r, 1200)); }
  }
  throw last;
}
async function mkFetchScanAll(onProgress) {
  // 出口代理偶发 502/超时（2026-11-10 实测：56 页中 4 页连试 3 次仍失败），
  // 故分 3 轮补拉：每轮只拉缺失页，轮间停 2s；仍缺页才判不完整。
  const first = await mkFetchScanPageRetry(1, 4);
  const total = first.total || 0;
  const rows = (first.diff || []).map(mkNormScanRow);
  const pages = Math.max(1, Math.ceil(total / 100));
  const byPage = { 1: first };
  let done = 1;
  if (onProgress) onProgress(done, pages);
  let pending = [];
  for (let p = 2; p <= pages; p++) pending.push(p);
  for (let pass = 0; pass < 3 && pending.length; pass++) {
    const results = await mkPool(pending, 6, async (pn) => {
      try { return { pn, d: await mkFetchScanPageRetry(pn, 2) }; }
      catch (e) { return { pn, d: null }; }
    });
    const next = [];
    for (const r of results) {
      if (r.d && r.d.diff) { byPage[r.pn] = r.d; done++; if (onProgress) onProgress(done, pages); }
      else next.push(r.pn);
    }
    pending = next;
    if (pending.length && pass < 2) await new Promise((r) => setTimeout(r, 2000));
  }
  for (let p = 2; p <= pages; p++) {
    if (byPage[p]) rows.push(...byPage[p].diff.map(mkNormScanRow));
  }
  return { rows, total, complete: pending.length === 0 && rows.length >= total };
}
async function mkFetchBoardsPage(kind, po) {
  const fs = kind === "concept" ? "m:90+t:3" : "m:90+t:2";
  const url = API.EM_CLIST + "?fid=f3&po=" + po + "&pz=100&pn=1&np=1&fltt=2&invt=2&fs=" + fs
    + "&fields=f12,f14,f2,f3,f8,f20" + MK_UT;
  const j = await emFetch(url);
  return ((j.data && j.data.diff) || []).map((it) => ({
    code: it.f12, name: it.f14, price: mkNum(it.f2), changePct: mkNum(it.f3), turnover: mkNum(it.f8), totalMcap: mkNum(it.f20),
  }));
}
async function mkFetchBoardMembers(bk, limit) {
  const url = API.EM_CLIST + "?fid=f3&po=1&pz=" + limit + "&pn=1&np=1&fltt=2&invt=2&fs=b:" + bk
    + "&fields=f12,f14,f2,f3,f8,f20" + MK_UT;
  const j = await emFetch(url);
  return {
    total: (j.data && j.data.total) || 0,
    rows: ((j.data && j.data.diff) || []).map((it) => ({
      code: it.f12, name: it.f14, price: mkNum(it.f2), changePct: mkNum(it.f3), turnover: mkNum(it.f8), totalMcap: mkNum(it.f20),
    })),
  };
}
async function mkFetchRank(fid, po, limit) {
  const url = API.EM_CLIST + "?fid=" + fid + "&po=" + po + "&pz=" + limit + "&pn=1&np=1&fltt=2&invt=2"
    + "&fs=" + MK_SCAN_FS + "&fields=f12,f14,f2,f3,f5,f6,f8,f20" + MK_UT;
  const j = await emFetch(url);
  const key = { f3: "changePct", f6: "amount", f8: "turnover" }[fid] || "changePct";
  return ((j.data && j.data.diff) || []).map((it) => ({
    code: it.f12, name: it.f14, price: mkNum(it.f2), changePct: mkNum(it.f3),
    volume: mkNum(it.f5), amount: mkNum(it.f6), turnover: mkNum(it.f8), totalMcap: mkNum(it.f20),
  })).filter((r) => r[key] != null); // 停牌股排序字段为 "-"，不进榜单
}
async function mkFetchWatch() {
  const wl = (typeof watchlist !== "undefined" && watchlist && watchlist.length)
    ? watchlist : (typeof DEFAULT_WATCHLIST !== "undefined" ? DEFAULT_WATCHLIST : []);
  let quotes = {};
  try { quotes = await fetchTxQuotes(wl.map((s) => s.code)); } catch (e) { quotes = {}; }
  const kls = await mkPool(wl, 6, async (s) => {
    try { return await fetchKline(s.code, 101, 70); } catch (e) { return null; }
  });
  return wl.map((s, i) => {
    const q = quotes[s.code] || {};
    const kl = kls[i];
    const closes = kl ? kl.map((r) => r.close).filter((v) => v != null && isFinite(v)) : [];
    const price = q.price || (closes.length ? closes[closes.length - 1] : null);
    const ma5 = mkMa(closes, 5), ma20 = mkMa(closes, 20), ma60 = mkMa(closes, 60);
    let sig = "—";
    if (price != null && ma5 != null && ma20 != null && ma60 != null) {
      if (price > ma5 && price > ma20 && price > ma60) sig = "均线多头";
      else if (price < ma5 && price < ma20 && price < ma60) sig = "均线空头";
      else if (price > ma60) sig = "站上MA60";
      else if (price > ma20) sig = "站上MA20";
      else if (price > ma5) sig = "站上MA5";
      else sig = "跌破MA5";
    }
    const last60 = closes.slice(-60);
    const hi60 = last60.length ? Math.max.apply(null, last60) : null;
    const lo60 = last60.length ? Math.min.apply(null, last60) : null;
    return {
      code: s.code, name: s.name, price, changePct: q.changePct,
      turnover: q.turnover, volRatio: q.volRatio,
      ma5, ma20, ma60, sig,
      isHi60: hi60 != null && price != null && price >= hi60 - 1e-9,
      isLo60: lo60 != null && price != null && price <= lo60 + 1e-9,
      hasK: !!kl,
    };
  });
}
// 连板：对当日涨停股逐只拉 12 日 K 线，数连续涨停天数
function mkWithTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error("超时 " + ms + "ms")), ms))]);
}
async function mkFetchLadder(limitUpRows) {
  // 逐只拉日 K 数连续涨停天数。单只超时 45 秒、整体限时 60 秒：超时未取到的计入 unknown，
  // 返回部分结果而非无限等待（真实浏览器走东财直连通常 10–20 秒内算完；弱网/代理抖动时降级为部分梯队）。
  const deadline = Date.now() + 60000;
  const out = new Array(limitUpRows.length).fill(null);
  let next = 0, cutShort = false;
  async function worker() {
    while (next < limitUpRows.length) {
      if (Date.now() > deadline) { cutShort = true; return; }
      const idx = next++;
      const r = limitUpRows[idx];
      const f = mkLimitFactor(r.code, r.name);
      const thr = (f - 1) * 100 - 0.15;
      try {
        const kl = await mkWithTimeout(fetchKline(r.code, 101, 12), 45000);
        let n = 0;
        for (let i = kl.length - 1; i >= 0; i--) {
          const c = kl[i].changePct;
          if (c != null && c >= thr) n++;
          else break;
        }
        out[idx] = { code: r.code, name: r.name, changePct: r.changePct, price: r.price, amount: r.amount, streak: n > 0 ? n : null };
      } catch (e) {
        out[idx] = { code: r.code, name: r.name, changePct: r.changePct, price: r.price, amount: r.amount, streak: null };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, limitUpRows.length) }, worker));
  const tiers = {};
  let maxStreak = 0, unknown = 0, resolved = 0;
  for (const it of out) {
    if (!it) { unknown++; continue; } // 限时到仍未开始计入 unknown
    if (it.streak == null) { unknown++; continue; }
    resolved++;
    tiers[it.streak] = tiers[it.streak] || [];
    tiers[it.streak].push(it);
    if (it.streak > maxStreak) maxStreak = it.streak;
  }
  return { status: "done", tiers, maxStreak, unknown, total: limitUpRows.length, resolved, partial: cutShort };
}

// ---------- 统计 ----------
function mkCalcStats(scan, indices, watch) {
  const rows = scan.rows;
  const ups = rows.filter((r) => r.changePct > 0);
  // 停牌/退市股 changePct 为 null：当日无交易、价格未动，计入"平"，并单独记数
  const suspended = rows.filter((r) => r.changePct == null);
  const flats = rows.filter((r) => r.changePct === 0 || r.changePct == null);
  const downs = rows.filter((r) => r.changePct < 0);
  const strong = rows.filter((r) => r.changePct > 3).length;
  const weak = rows.filter((r) => r.changePct < -3).length;
  const limitUp = rows.filter(mkIsLimitUp);
  const limitDown = rows.filter(mkIsLimitDown);
  const openBoard = rows.filter(mkIsOpenBoard);
  const sealRate = limitUp.length + openBoard.length > 0
    ? limitUp.length / (limitUp.length + openBoard.length) * 100 : null;
  const amount = rows.reduce((s, r) => s + (r.amount || 0), 0);
  const turnMean = mkMean(rows.map((r) => r.turnover));
  const vrMean = mkMean(rows.map((r) => r.volRatio));
  const hiTurn = rows.filter((r) => r.turnover != null && r.turnover > 5).length;
  const volUp = rows.filter((r) => r.volRatio != null && r.volRatio > 1.5).length;
  const buckets = [
    { label: "<-5%", test: (v) => v < -5 },
    { label: "-5~-3%", test: (v) => v >= -5 && v < -3 },
    { label: "-3~-1%", test: (v) => v >= -3 && v < -1 },
    { label: "-1~0%", test: (v) => v >= -1 && v < 0 },
    { label: "0~1%", test: (v) => v >= 0 && v < 1 },
    { label: "1~3%", test: (v) => v >= 1 && v < 3 },
    { label: "3~5%", test: (v) => v >= 3 && v < 5 },
    { label: ">5%", test: (v) => v >= 5 },
  ].map((b) => ({ label: b.label, count: rows.filter((r) => b.test(r.changePct == null ? 0 : r.changePct)).length })); // 停牌股按 0% 计入分布
  const chgs = rows.map((r) => r.changePct);
  const withK = watch.filter((w) => w.hasK);
  const ma5n = withK.filter((w) => w.price != null && w.ma5 != null && w.price > w.ma5).length;
  const ma20n = withK.filter((w) => w.price != null && w.ma20 != null && w.price > w.ma20).length;
  const ma60n = withK.filter((w) => w.price != null && w.ma60 != null && w.price > w.ma60).length;
  const hi60n = withK.filter((w) => w.isHi60).length;
  const lo60n = withK.filter((w) => w.isLo60).length;
  return {
    total: rows.length, up: ups.length, flat: flats.length, down: downs.length, suspended: suspended.length,
    upRate: rows.length ? ups.length / rows.length * 100 : null,
    strong, weak, limitUp, limitDown, openBoard, sealRate,
    amount, amountMean: rows.length ? amount / rows.length : null,
    turnMean, vrMean, hiTurn, volUp, volUpRate: rows.length ? volUp / rows.length * 100 : null,
    buckets, meanChg: mkMean(chgs), medianChg: mkMedian(chgs),
    ma5Pct: withK.length ? ma5n / withK.length * 100 : null,
    ma20Pct: withK.length ? ma20n / withK.length * 100 : null,
    ma60Pct: withK.length ? ma60n / withK.length * 100 : null,
    hi60n, lo60n, hiLoRate: (hi60n + lo60n) > 0 ? hi60n / (hi60n + lo60n) * 100 : null,
    watchN: withK.length,
    indexAvgChg: mkMean(indices.map((x) => x.changePct)),
  };
}
function mkEmotion(stats, topConceptChg) {
  // 六维 0–100，公式全公开：
  // 指数 = (4 指数平均涨跌幅 +3)/6；赚钱 = 上涨家数占比；主线 = 领涨概念涨幅/5；
  // 热钱 = 全市场平均换手率/5；投机 = 涨停数/80；抗跌 = 跌幅<1% 的个股占比。
  const clamp01 = (v) => Math.max(0, Math.min(100, v));
  const dims = [
    { key: "指数", val: stats.indexAvgChg == null ? null : clamp01((stats.indexAvgChg + 3) / 6 * 100) },
    { key: "赚钱", val: stats.upRate },
    { key: "主线", val: topConceptChg == null ? null : clamp01(topConceptChg / 5 * 100) },
    { key: "热钱", val: stats.turnMean == null ? null : clamp01(stats.turnMean / 5 * 100) },
    { key: "投机", val: clamp01(stats.limitUp.length / 80 * 100) },
    { key: "抗跌", val: stats.total ? 100 - stats.buckets.slice(0, 3).reduce((s, b) => s + b.count, 0) / stats.total * 100 : null },
  ];
  const vals = dims.filter((d) => d.val != null).map((d) => d.val);
  const score = vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
  return { dims, score };
}
function mkEmotionSvg(em) {
  const cx = 110, cy = 105, R = 72;
  const labels = ["指数", "赚钱", "主线", "热钱", "投机", "抗跌"];
  const pts = em.dims.map((d, i) => {
    const ang = -Math.PI / 2 + i * Math.PI / 3;
    const r = R * ((d.val == null ? 0 : d.val) / 100);
    return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  });
  const ring = (f) => em.dims.map((_, i) => {
    const ang = -Math.PI / 2 + i * Math.PI / 3;
    const r = R * f;
    return (cx + r * Math.cos(ang)).toFixed(1) + "," + (cy + r * Math.sin(ang)).toFixed(1);
  }).join(" ");
  const axes = em.dims.map((_, i) => {
    const ang = -Math.PI / 2 + i * Math.PI / 3;
    return `<line x1="${cx}" y1="${cy}" x2="${(cx + R * Math.cos(ang)).toFixed(1)}" y2="${(cy + R * Math.sin(ang)).toFixed(1)}" stroke="var(--border,#e2e8f0)" stroke-width="1"/>`;
  }).join("");
  const labs = em.dims.map((d, i) => {
    const ang = -Math.PI / 2 + i * Math.PI / 3;
    const x = cx + (R + 16) * Math.cos(ang), y = cy + (R + 16) * Math.sin(ang);
    const anchor = Math.abs(Math.cos(ang)) < 0.3 ? "middle" : (Math.cos(ang) > 0 ? "start" : "end");
    return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="${anchor}" font-size="11" fill="var(--muted,#64748b)">${labels[i]} ${d.val == null ? "—" : Math.round(d.val)}</text>`;
  }).join("");
  const poly = pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  return `<svg viewBox="0 0 220 210" width="220" height="210" style="display:block;margin:0 auto">
    <polygon points="${ring(1)}" fill="none" stroke="var(--border,#e2e8f0)"/>
    <polygon points="${ring(0.66)}" fill="none" stroke="var(--border,#e2e8f0)"/>
    <polygon points="${ring(0.33)}" fill="none" stroke="var(--border,#e2e8f0)"/>
    ${axes}
    <polygon points="${poly}" fill="rgba(229,72,77,0.22)" stroke="#e5484d" stroke-width="2"/>
    ${labs}
    <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="22" font-weight="700" fill="var(--text,#0f172a)">${em.score == null ? "—" : em.score}</text>
    <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="10" fill="var(--muted,#64748b)">情绪评分</text>
  </svg>`;
}

// ---------- 板块详情 ----------
async function mkOpenSector(kind, board, el) {
  const box = document.getElementById("mkSectorDetail");
  if (!box) return;
  box.style.display = "block";
  box.innerHTML = `<div class="card mk-sector-card"><p class="muted">正在加载 ${esc(board.name)} 成分股…</p></div>`;
  if (box.scrollIntoView) box.scrollIntoView({ behavior: "smooth", block: "start" });
  let mem = { total: 0, rows: [] };
  try { mem = await mkFetchBoardMembers(board.code, 30); }
  catch (e) { mem = { total: 0, rows: [], err: e }; }
  const rows = mem.rows || [];
  const bks = [
    { label: "<-3%", test: (v) => v < -3 }, { label: "-3~0%", test: (v) => v >= -3 && v < 0 },
    { label: "0~3%", test: (v) => v >= 0 && v < 3 }, { label: ">3%", test: (v) => v >= 3 },
  ].map((b) => ({ label: b.label, count: rows.filter((r) => b.test(r.changePct == null ? 0 : r.changePct)).length })); // 停牌股按 0% 计
  const maxB = Math.max.apply(null, bks.map((b) => b.count).concat([1]));
  box.innerHTML = `<div class="card mk-sector-card">
    <div class="mk-sector-head">
      <div><h2 style="margin:0">${esc(kind === "concept" ? "概念" : "行业")} · ${esc(board.name)}</h2>
      <p class="muted" style="margin:4px 0 0">板块代码 ${esc(board.code)} · 成分股 ${mem.total || rows.length} 只（展示涨幅前 30）· 数据：东财板块行情</p></div>
      <button class="ghost-btn mk-back" data-mk-back>← 返回看板</button>
    </div>
    <div class="mk-sector-stats">
      <div><span class="muted">板块涨跌幅</span><b class="${mkCls(board.changePct)}">${mkPct(board.changePct)}</b></div>
      <div><span class="muted">换手率</span><b>${board.turnover == null ? "—" : board.turnover.toFixed(2) + "%"}</b></div>
      <div><span class="muted">总市值</span><b>${mkYi(board.totalMcap)}</b></div>
      <div><span class="muted">上涨 / 下跌</span><b>${rows.filter((r) => r.changePct > 0).length} / ${rows.filter((r) => r.changePct < 0).length}</b></div>
    </div>
    <div class="mk-mini-bars">${bks.map((b) => `<div class="mk-mini-bar"><div class="mk-mini-fill ${b.label.indexOf("-") === 0 ? "down" : "up"}" style="height:${Math.max(4, b.count / maxB * 56)}px"></div><span>${b.label}</span><b>${b.count}</b></div>`).join("")}</div>
    ${mem.err ? `<p class="muted">成分股暂不可用（${esc(mem.err.message || mem.err)}）</p>` : ""}
    <table class="tbl mk-tbl"><tr><th>#</th><th>股票</th><th>代码</th><th>现价</th><th>涨跌幅</th><th>换手率</th></tr>
    ${rows.map((r, i) => `<tr><td>${i + 1}</td><td><a href="javascript:void(0)" data-mk-stock="${esc(r.code)}">${esc(r.name)}</a></td><td>${esc(r.code)}</td><td>${r.price == null ? "—" : r.price.toFixed(2)}</td><td class="${mkCls(r.changePct)}">${mkPct(r.changePct)}</td><td>${r.turnover == null ? "—" : r.turnover.toFixed(2) + "%"}</td></tr>`).join("")}
    </table>
    <p class="muted">点股票进仪表盘分析；点返回回到市场看板。</p>
  </div>`;
  mkBindStocks(box);
  const back = box.querySelector("[data-mk-back]");
  if (back) back.addEventListener("click", () => { box.style.display = "none"; box.innerHTML = ""; });
}
function mkBindStocks(root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll("[data-mk-stock]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      if (typeof switchToStock === "function") switchToStock(a.dataset.mkStock);
    });
  });
  root.querySelectorAll("[data-mk-sector]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      const d = JSON.parse(a.dataset.mkSector);
      mkOpenSector(d.kind, d.board, root);
    });
  });
}

// ---------- 主渲染 ----------
async function renderMarket(force) {
  const el = document.getElementById("marketBody");
  if (!el) return;
  if (mkCache && !force) { el.innerHTML = mkCache.html; mkBindStocks(el); mkBindLadder(); return; }
  mkCache = null; mkLadder = null;
  el.innerHTML = `<p class="muted" id="mkProgress">正在加载市场数据…（全市场行情分 56 页拉取，约需 10–20 秒）</p>`;
  const setProgress = (txt) => {
    const p = document.getElementById("mkProgress");
    if (p) p.textContent = txt;
  };
  let indices = [], scan = null, scanErr = null;
  let conceptUp = [], conceptDown = [], indUp = [], indDown = [];
  let ranks = { up: [], down: [], amount: [], turn: [] };
  let watch = [];
  try {
    const [idxMap, scanRes, cUp, cDown, iUp, iDown, rUp, rDown, rAmt, rTurn, wch] = await Promise.all([
      fetchEmQuotesBatch(MK_INDEXES.map((x) => (x.code === "000001" || x.code === "000680" ? "1." : "0.") + x.code))
        .catch((e) => ({ __err: e })),
      mkFetchScanAll((done, total) => setProgress("正在加载市场数据…全市场行情 " + done + "/" + total + " 页")).catch((e) => { scanErr = e; return null; }),
      mkFetchBoardsPage("concept", 1).catch(() => []),
      mkFetchBoardsPage("concept", 0).catch(() => []),
      mkFetchBoardsPage("industry", 1).catch(() => []),
      mkFetchBoardsPage("industry", 0).catch(() => []),
      mkFetchRank("f3", 1, 8).catch(() => []),
      mkFetchRank("f3", 0, 8).catch(() => []),
      mkFetchRank("f6", 1, 8).catch(() => []),
      mkFetchRank("f8", 1, 8).catch(() => []),
      mkFetchWatch().catch(() => []),
    ]);
    indices = MK_INDEXES.map((x) => {
      const q = (idxMap && idxMap[x.code]) || {};
      return { code: x.code, name: x.name, price: q.price, changePct: q.changePct, updatedAt: q.updatedAt };
    });
    scan = scanRes;
    conceptUp = cUp.slice(0, 5); conceptDown = cDown.slice(0, 5);
    indUp = iUp.slice(0, 5); indDown = iDown.slice(0, 5);
    ranks = { up: rUp, down: rDown, amount: rAmt, turn: rTurn };
    watch = wch;
  } catch (e) {
    el.innerHTML = `<p class="muted">市场看板暂不可用（${esc(e.message || e)}）</p>`;
    return;
  }
  // 板块领涨股（10 个板块并行，各取涨幅前 1）
  const boardLeaders = {};
  const allBoards = [
    ...conceptUp.map((b) => ({ kind: "concept", board: b })),
    ...conceptDown.map((b) => ({ kind: "concept", board: b })),
    ...indUp.map((b) => ({ kind: "industry", board: b })),
    ...indDown.map((b) => ({ kind: "industry", board: b })),
  ];
  await mkPool(allBoards, 6, async (it) => {
    try {
      const m = await mkFetchBoardMembers(it.board.code, 1);
      if (m.rows && m.rows[0]) boardLeaders[it.board.code] = m.rows[0];
    } catch (e) { /* 无领涨股不阻塞 */ }
  });
  const stats = scan && scan.complete ? mkCalcStats(scan, indices, watch) : null;
  const topConceptChg = conceptUp.length ? conceptUp[0].changePct : null;
  const emotion = stats ? mkEmotion(stats, topConceptChg) : null;
  const dataTs = indices.reduce((m, x) => Math.max(m, x.updatedAt || 0), 0);
  const dataTime = dataTs ? new Date(dataTs * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  const now = new Date();
  const shNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
  const mins = shNow.getHours() * 60 + shNow.getMinutes();
  const wd = shNow.getDay();
  const inTrade = wd >= 1 && wd <= 5 && ((mins >= 570 && mins <= 690) || (mins >= 780 && mins <= 900));
  const maxBucket = stats ? Math.max.apply(null, stats.buckets.map((b) => b.count).concat([1])) : 1;

  const idxCards = indices.map((x) => `<div class="card mk-idx-card">
    <div class="mk-idx-name">${esc(x.name)}</div>
    <div class="mk-idx-code">${esc(x.code)}${x.code === "000001" || x.code === "000680" ? ".SH" : ".SZ"}</div>
    <div class="mk-idx-price ${mkCls(x.changePct)}">${x.price == null ? "—" : x.price.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} <span class="mk-idx-chg">${mkPct(x.changePct)}</span></div>
  </div>`).join("");

  const statCards = stats ? `
    <div class="card mk-stat"><div class="mk-stat-label">个股涨 / 平 / 跌</div><div class="mk-stat-v"><span class="up">${stats.up}</span>/<span class="flat">${stats.flat}</span>/<span class="down">${stats.down}</span></div><div class="muted">上涨率 ${stats.upRate == null ? "—" : stats.upRate.toFixed(1) + "%"}${stats.suspended ? " · 含停牌 " + stats.suspended + " 只" : ""}</div></div>
    <div class="card mk-stat"><div class="mk-stat-label">强势 / 弱势</div><div class="mk-stat-v"><span class="up">${stats.strong}</span>/<span class="down">${stats.weak}</span></div><div class="muted">涨幅 &gt;3% / 跌幅 &gt;3%</div></div>
    <div class="card mk-stat"><div class="mk-stat-label">涨停 / 跌停 <span class="muted">· 封板率</span></div><div class="mk-stat-v"><span class="up">${stats.limitUp.length}</span>/<span class="down">${stats.limitDown.length}</span></div><div class="muted">封板率 ${stats.sealRate == null ? "—" : stats.sealRate.toFixed(0) + "%"}（炸板 ${stats.openBoard.length} 只）</div></div>
    <div class="card mk-stat"><div class="mk-stat-label">最长连板</div><div class="mk-stat-v" id="mkMaxStreak">计算中…</div><div class="muted">当日涨停股逐只数连续天数</div></div>
    <div class="card mk-stat"><div class="mk-stat-label">成交额</div><div class="mk-stat-v">${mkWanYi(stats.amount)}</div><div class="muted">均额 ${mkYi(stats.amountMean)}</div></div>
    <div class="card mk-stat"><div class="mk-stat-label">换手 / 量比</div><div class="mk-stat-v">${stats.turnMean == null ? "—" : stats.turnMean.toFixed(1) + "%"} / ${stats.vrMean == null ? "—" : stats.vrMean.toFixed(2)}</div><div class="muted">高换手 ${stats.hiTurn} 只 · 放量占比 ${stats.volUpRate == null ? "—" : stats.volUpRate.toFixed(1) + "%"}</div></div>`
    : `<div class="card mk-stat"><p class="muted">全市场统计暂不可用（${esc(scanErr ? (scanErr.message || scanErr) : "行情拉取不完整，未编数")}）</p></div>`;

  const distHtml = stats ? `
    <div class="mk-dist-bars">${stats.buckets.map((b) => `<div class="mk-dist-bar"><div class="mk-dist-fill ${b.label.indexOf("-") === 0 ? "down" : "up"}" style="height:${Math.max(3, b.count / maxBucket * 90)}px"></div><span>${b.count}</span><i>${b.label}</i></div>`).join("")}</div>
    <div class="mk-dist-stack"><div class="mk-dist-seg down" style="width:${(stats.down / stats.total * 100).toFixed(1)}%"></div><div class="mk-dist-seg flat" style="width:${(stats.flat / stats.total * 100).toFixed(1)}%"></div><div class="mk-dist-seg up" style="width:${(stats.up / stats.total * 100).toFixed(1)}%"></div></div>
    <div class="mk-dist-legend"><span class="down">跌 ${stats.down}</span><span class="flat">平 ${stats.flat}</span><span class="up">涨 ${stats.up}</span></div>
    <div class="mk-dist-avg"><div><span class="muted">平均涨跌</span><b class="${mkCls(stats.meanChg)}">${mkPct(stats.meanChg)}</b></div><div><span class="muted">中位涨跌</span><b class="${mkCls(stats.medianChg)}">${mkPct(stats.medianChg)}</b></div></div>`
    : `<p class="muted">涨跌分布暂不可用（全市场行情未拉全）</p>`;

  const trendHtml = stats ? `
    <div class="mk-trend-grid">
      <div><span class="muted">站上MA5</span><b class="up">${stats.ma5Pct == null ? "—" : stats.ma5Pct.toFixed(0) + "%"}</b></div>
      <div><span class="muted">站上MA20</span><b class="up">${stats.ma20Pct == null ? "—" : stats.ma20Pct.toFixed(0) + "%"}</b></div>
      <div><span class="muted">站上MA60</span><b class="up">${stats.ma60Pct == null ? "—" : stats.ma60Pct.toFixed(0) + "%"}</b></div>
      <div><span class="muted">60日新高</span><b class="up">${stats.hi60n}</b></div>
      <div><span class="muted">60日新低</span><b class="down">${stats.lo60n}</b></div>
      <div><span class="muted">高低比</span><b>${stats.hiLoRate == null ? "—" : stats.hiLoRate.toFixed(0) + "%"}</b></div>
    </div>
    <p class="muted" style="margin:8px 0 0">自选股口径（${stats.watchN} 只）：全市场 5000+ 只逐只拉 K 线在浏览器内不可行，故用自选股算。</p>
    <h3 style="margin:14px 0 6px">🎯 实用盘控 <span class="muted" style="font-weight:400">全市场口径</span></h3>
    <div class="mk-trend-grid">
      <div><span class="muted">炸板</span><b>${stats.openBoard.length}</b></div>
      <div><span class="muted">跌停</span><b class="down">${stats.limitDown.length}</b></div>
      <div><span class="muted">新高/新低</span><b>${stats.hi60n}/${stats.lo60n}</b></div>
      <div><span class="muted">高换手数</span><b>${stats.hiTurn}</b></div>
      <div><span class="muted">放量占比</span><b>${stats.volUpRate == null ? "—" : stats.volUpRate.toFixed(1) + "%"}</b></div>
    </div>
    <p class="muted" style="margin:8px 0 0">新高/新低为自选股口径；炸板 = 最高价触及涨停价但收盘未封；高换手 = 换手率 &gt;5%；放量 = 量比 &gt;1.5。</p>`
    : `<p class="muted">趋势强度暂不可用（全市场行情未拉全）</p>`;

  const boardList = (list, kind) => list.length ? list.map((b, i) => {
    const leader = boardLeaders[b.code];
    const sec = JSON.stringify({ kind, board: b }).replace(/"/g, "&quot;");
    return `<div class="mk-board-row">
      <span class="mk-rank">${i + 1}</span>
      <a href="javascript:void(0)" class="mk-board-name" data-mk-sector="${sec}">${esc(b.name)}</a>
      <span class="muted">${leader ? "领涨 " + esc(leader.name) + " " + mkPct(leader.changePct) : ""}</span>
      <b class="${mkCls(b.changePct)}">${mkPct(b.changePct)}</b>
    </div>`;
  }).join("") : `<p class="muted">暂不可用（板块行情未拉到）</p>`;
  const heatHtml = (title, up, down, kind) => `
    <div class="mk-heat-col"><h3>${title} · 领涨</h3>${boardList(up, kind)}</div>
    <div class="mk-heat-col"><h3>${title} · 领跌</h3>${boardList(down, kind)}</div>`;

  const watchHtml = watch.length ? watch.map((w) => `
    <div class="mk-watch-row" data-mk-stock="${esc(w.code)}">
      <span class="mk-watch-code">${esc(w.code)} ${esc(w.name)}</span>
      <span class="mk-watch-sig">${esc(w.sig)}</span>
      <span class="mk-watch-price">${w.price == null ? "—" : w.price.toFixed(2)} <b class="${mkCls(w.changePct)}">${mkPct(w.changePct)}</b></span>
    </div>`).join("") : `<p class="muted">监控信号暂不可用（自选股行情未拉到）</p>`;

  const rankCol = (title, list, valFn) => `<div class="card mk-rank-card"><h3>${title} <span class="muted" style="font-weight:400">TOP 8</span></h3>
    ${list.length ? list.map((r, i) => `<div class="mk-rank-row">
      <span class="mk-rank">${i + 1}</span>
      <a href="javascript:void(0)" data-mk-stock="${esc(r.code)}">${esc(r.name)}</a>
      <span class="muted">${esc(r.code)}</span>
      <b class="${title.indexOf("跌幅") === 0 ? "down" : (title.indexOf("涨幅") === 0 ? "up" : "")}">${valFn(r)}</b>
    </div>`).join("") : `<p class="muted">暂不可用</p>`}</div>`;
  const ranksHtml = rankCol("涨幅榜", ranks.up, (r) => mkPct(r.changePct))
    + rankCol("跌幅榜", ranks.down, (r) => mkPct(r.changePct))
    + rankCol("成交额榜", ranks.amount, (r) => mkYi(r.amount))
    + rankCol("活跃换手", ranks.turn, (r) => r.turnover == null ? "—" : r.turnover.toFixed(1) + "%");

  el.innerHTML = `
  <div class="mk-topbar">
    <div class="mk-top-left"><h2 style="margin:0">📊 市场看板</h2>
      <span class="mk-emo-badge">${emotion && emotion.score != null ? "情绪 " + emotion.score : "情绪 —"}</span></div>
    <div class="mk-top-right">
      <span class="muted">数据时间 ${esc(dataTime)}</span>
      <span class="mk-live-badge">${inTrade ? "盘中" : "收盘数据"}</span>
      <button class="ghost-btn" id="mkReload">↻ 重载</button>
      <button class="ghost-btn" id="mkLayoutBtn">▦ 自定义布局</button>
      <span class="bell-pop" id="mkLayoutPop" style="display:none">自定义布局尚未接入本站</span>
    </div>
  </div>
  <div id="mkSectorDetail" style="display:none"></div>
  <div class="mk-idx-row">${idxCards}</div>
  <div class="mk-stat-row">${statCards}</div>
  <div class="mk-grid-4">
    <div class="card"><h3>📊 涨跌分布 / 广度 <span class="muted" style="font-weight:400">${stats ? stats.total + " 只" : ""}</span></h3>${distHtml}</div>
    <div class="card"><h3>🧭 情绪雷达</h3>${emotion ? mkEmotionSvg(emotion) : `<p class="muted">情绪雷达暂不可用（全市场行情未拉全）</p>`}
      <p class="muted" style="margin:6px 0 0">六维：指数（4 指数均涨幅）/ 赚钱（上涨占比）/ 主线（领涨概念涨幅）/ 热钱（平均换手）/ 投机（涨停数）/ 抗跌（跌幅&lt;1% 占比），各 0–100 取均值。</p></div>
    <div class="card"><h3>📈 趋势强度 <span class="muted" style="font-weight:400">自选股口径</span></h3>${trendHtml}</div>
    <div class="card"><h3>🔥 涨停梯队 <span class="muted" style="font-weight:400">${stats ? "涨停 " + stats.limitUp.length + " 只" : ""}</span></h3>
      <div id="mkLadder"><p class="muted">正在数连续涨停天数…（当日涨停股逐只拉日 K）</p></div></div>
  </div>
  <div class="mk-grid-3">
    <div class="card"><h3>💡 概念热度 <span class="muted" style="font-weight:400">点板块看成分股</span></h3><div class="mk-heat-cols">${heatHtml("概念", conceptUp, conceptDown, "concept")}</div></div>
    <div class="card"><h3>🏭 行业热度 <span class="muted" style="font-weight:400">点板块看成分股</span></h3><div class="mk-heat-cols">${heatHtml("行业", indUp, indDown, "industry")}</div></div>
    <div class="card"><h3>📡 监控中心 · 实时信号 <span class="muted" style="font-weight:400">自选股均线信号，点进分析</span></h3>${watchHtml}</div>
  </div>
  <div class="mk-rank-row4">${ranksHtml}</div>
  <p class="muted">数据：东财公开接口（指数 / 全市场行情 / 板块 / 榜单）与腾讯行情（自选股均线）；红涨绿跌。连板天数由当日涨停股的日 K 逐只计数（涨停池接口在本机出口持续限流，未采用）。趋势强度与 60 日新高/新低为自选股口径，其余为全市场口径。仅供学习参考，不构成投资建议。</p>`;

  mkCache = { html: el.innerHTML, fetchedAt: Date.now() };
  mkBindStocks(el);
  const reloadBtn = document.getElementById("mkReload");
  if (reloadBtn) reloadBtn.addEventListener("click", () => renderMarket(true));
  const layoutBtn = document.getElementById("mkLayoutBtn");
  const layoutPop = document.getElementById("mkLayoutPop");
  if (layoutBtn && layoutPop) layoutBtn.addEventListener("click", () => {
    layoutPop.style.display = layoutPop.style.display === "none" ? "block" : "none";
  });
  // 连板梯队异步填（不阻塞主渲染）
  mkBindLadder();
  if (stats && stats.limitUp.length) {
    mkLadder = { status: "loading" };
    mkFetchLadder(stats.limitUp).then((res) => {
      mkLadder = res;
      const box = document.getElementById("mkLadder");
      if (box) box.innerHTML = mkLadderHtml(res);
      mkBindStocks(box);
      const ms = document.getElementById("mkMaxStreak");
      if (ms) ms.textContent = res.maxStreak > 0 ? res.maxStreak + "板" : "—";
      if (mkCache) { mkCache.html = el.innerHTML; }
    }).catch(() => {
      mkLadder = { status: "unavailable" };
      const box = document.getElementById("mkLadder");
      if (box) box.innerHTML = `<p class="muted">涨停梯队暂不可用（涨停股日 K 拉取失败）</p>`;
    });
  } else {
    const box = document.getElementById("mkLadder");
    if (box) box.innerHTML = stats ? `<p class="muted">今日无涨停股</p>` : `<p class="muted">涨停梯队暂不可用（全市场行情未拉全）</p>`;
  }
}
function mkLadderHtml(res) {
  if (!res || res.status !== "done") return `<p class="muted">涨停梯队暂不可用</p>`;
  const keys = Object.keys(res.tiers).map(Number).sort((a, b) => b - a);
  if (!keys.length) return `<p class="muted">今日无可计连板（${res.unknown || 0} 只涨停股日 K 未取到）</p>`;
  const first = keys.filter((k) => k >= 2);
  const firstBoard = keys.includes(1) ? res.tiers[1].length : 0;
  let html = `<div class="mk-ladder-summary"><span class="muted">封板梯队</span> <b>${res.maxStreak > 0 ? res.maxStreak + "板" : "—"}</b>${res.unknown ? ` <span class="muted">（${res.unknown} 只未取到日 K${res.partial ? "，60 秒限时仅算完部分" : ""}）</span>` : (res.partial ? ` <span class="muted">（60 秒限时仅算完部分）</span>` : "")}</div>`;
  for (const k of first.slice(0, 5)) {
    const items = res.tiers[k];
    html += `<div class="mk-ladder-tier"><div class="mk-ladder-head"><b>${k}板</b><span class="muted">${items.length} 只</span><span class="mk-ladder-bar" style="width:${Math.min(100, items.length / Math.max(1, res.tiers[1] ? res.tiers[1].length : 1) * 100)}%"></span></div>
      <div class="mk-ladder-names">${items.slice(0, 8).map((it) => `<a href="javascript:void(0)" data-mk-stock="${esc(it.code)}">${esc(it.name)}</a>`).join(" · ")}${items.length > 8 ? " 等" : ""}</div></div>`;
  }
  if (firstBoard) html += `<div class="mk-ladder-tier"><div class="mk-ladder-head"><b>首板</b><span class="muted">${firstBoard} 只</span></div></div>`;
  return html;
}
function mkBindLadder() {
  if (mkLadder && mkLadder.status === "done") {
    const box = document.getElementById("mkLadder");
    if (box) { box.innerHTML = mkLadderHtml(mkLadder); mkBindStocks(box); }
    const ms = document.getElementById("mkMaxStreak");
    if (ms && mkLadder.maxStreak > 0) ms.textContent = mkLadder.maxStreak + "板";
  }
}

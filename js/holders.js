// ============================================================
// 机构和超级大户（v6，2026-11-09）
// 数据：同源季度快照 data/holders/<code>.json，由 tools/refresh_holders.py 生成，
// 源为东财 F10 股东研究 PageAjax（十大股东 sdgd / 十大流通股东 sdltgd /
// 股东户数 gdrs / 基金持仓 jjcg / 机构持股汇总 jgcc）。
// 为什么用快照：PageAjax 响应不带 Access-Control-Allow-Origin，浏览器 fetch
// 会被 CORS 拦截；东财数据中心 22 个候选股东表名换 columns/filter 重测均报
// 9501“报表配置不存在”；雪球 403、巨潮反爬。快照每季披露后刷新，按季度累积。
// PageAjax 的 dates=/date=/endDate= 参数均被忽略，永远只返回最新一季，
// 所以历史季度只能靠每次披露后及时跑脚本累积，无法事后补拉。
// 依赖的全局：esc / chgClass / currentCode / DEFAULT_WATCHLIST /
// fetchEmQuotesBatch / fetchKline / fetchHs300LongKline / switchToStock /
// drawBars / metricCard / naRow / fmtMoney / fmtPct。
// ============================================================

const HOLDERS_SNAP_DIR = "data/holders/";
const holdersCache = {};        // code -> snapshot JSON | null（无快照）
const holdersCrossCache = { loaded: false, investors: null, codes: [] };
let holdersDetail = null;       // {name, typeKey, typeLabel, quarter}
let holdersTypeFilter = "all";  // 当前股股东表类型过滤
let holdersCrossFilter = "all"; // 跨股汇总类型过滤
let holdersQuarter = null;      // 当前股所选季度（null = 最新）
let holdersRenderSeq = 0;       // 防旧的异步渲染覆盖新股
const holdersPerfCache = {};    // 表现计算缓存：positions key -> perf 结果

// ---------- 股东分类 ----------
// HOLDER_TYPE 是东财接口自带的分类字段（实测 12 只自选股 110 行分布：
// 其它 39、证券投资基金 19、个人 17、投资公司 10、QFII 6、保险产品 6、
// 全国社保基金 5、私募基金 4、证券公司 2、其他理财产品 1、基金资产管理计划 1）。
// 名称关键词只补 HOLDER_TYPE 覆盖不到的汇金/证金/养老金。
// jgcc ORG_TYPE 经实测验证的只有 00=机构合计、01=基金、03=社保基金
// （紫金 03 的 85,798,682 股与社保一零六组合持股数完全一致）、
// 05=保险（茅台 05 的 5,128,691 股与中国人寿持股数完全一致）；
// 02/04/06/07 未验证，本站不猜测，归入“其他机构类型”。
const HOLDER_TYPE_MAP = {
  "全国社保基金": ["shebao", "社保基金", true],
  "QFII": ["qfii", "QFII", true],
  "证券投资基金": ["fund", "公募基金", false],
  "保险产品": ["insurance", "保险", false],
  "证券公司": ["broker", "券商", false],
  "私募基金": ["private", "私募基金", false],
  "投资公司": ["company", "投资公司", false],
  "个人": ["person", "个人", true],
  "基金资产管理计划": ["fund", "基金资管", false],
  "其他理财产品": ["other", "其他", false],
  "其它": ["other", "其他", false],
};
const HOLDER_TYPE_LABEL = {
  shebao: "社保基金", qfii: "QFII", huijin: "汇金/证金", pension: "养老金",
  fund: "公募基金", insurance: "保险", broker: "券商", private: "私募基金",
  company: "投资公司", person: "个人", other: "其他",
};
function holdersClassify(name, holderType) {
  const n = String(name || "");
  if (/中央汇金|证券金融|证金/.test(n)) return { key: "huijin", label: "汇金/证金", super: true };
  if (/养老金|基本养老保险/.test(n)) return { key: "pension", label: "养老金", super: true };
  if (/社保基金/.test(n)) return { key: "shebao", label: "社保基金", super: true };
  const m = HOLDER_TYPE_MAP[holderType] || ["other", "其他", false];
  return { key: m[0], label: m[1], super: m[2] };
}

// ---------- 快照加载 ----------
async function holdersLoad(code) {
  if (code in holdersCache) return holdersCache[code];
  try {
    const r = await fetch(HOLDERS_SNAP_DIR + code + ".json");
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    holdersCache[code] = j;
    return j;
  } catch (e) {
    holdersCache[code] = null;
    return null;
  }
}

// ---------- 格式化 ----------
function holdersFmtShares(v) {
  if (v == null || !isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e8) return (v / 1e8).toFixed(2) + " 亿股";
  if (a >= 1e4) return (v / 1e4).toFixed(1) + " 万股";
  return String(Math.round(v)) + " 股";
}
function holdersQuarterLabel(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || "");
  if (!m) return dateStr || "—";
  const q = { "03": "一季报", "06": "半年报", "09": "三季报", "12": "年报" }[m[2]] || "";
  return m[1] + "年" + q + "（" + dateStr + "）";
}
function holdersQuarterShort(dateStr) {
  const m = /^(\d{2})(\d{2})-(\d{2})/.exec(dateStr || "");
  if (!m) return dateStr || "—";
  return m[2] + "Q" + ({ "03": 1, "06": 2, "09": 3, "12": 4 }[m[3]] || "?");
}
function holdersChangeText(row) {
  const c = row.HOLD_NUM_CHANGE, r = row.CHANGE_RATIO;
  if (c === "新进") return "新进";
  if (c === "不变" || c == null) return "不变";
  const sign = c > 0 ? "+" : "";
  const pct = (r != null && isFinite(r)) ? "（" + (r > 0 ? "+" : "") + r.toFixed(2) + "%）" : "";
  return sign + holdersFmtShares(c) + pct;
}
function holdersChangeClass(row) {
  const c = row.HOLD_NUM_CHANGE;
  if (typeof c === "number") return chgClass(c);
  return "flat";
}

// ---------- SVG 小图 ----------
const HOLDERS_PALETTE = ["#2563eb", "#e5484d", "#1a9e54", "#f59e0b", "#7c3aed", "#0ea5e9", "#db2777", "#65a30d", "#ea580c", "#475569", "#0891b2", "#be123c"];
function holdersDonut(segments, centerTop, centerBottom) {
  const total = segments.reduce((s, x) => s + (x.value || 0), 0);
  if (!total) return "<p class='muted'>暂无数据</p>";
  const R = 62, C = 2 * Math.PI * R;
  let offset = 0;
  const arcs = segments.map((s, i) => {
    const frac = (s.value || 0) / total;
    const len = Math.max(frac * C - 2, 0.5);
    const el = `<circle cx="90" cy="90" r="${R}" fill="none" stroke="${HOLDERS_PALETTE[i % HOLDERS_PALETTE.length]}" stroke-width="26" stroke-dasharray="${len.toFixed(1)} ${(C - len).toFixed(1)}" stroke-dashoffset="${(-offset).toFixed(1)}" transform="rotate(-90 90 90)" />`;
    offset += frac * C;
    return el;
  }).join("");
  const legend = segments.map((s, i) =>
    `<div class="donut-leg"><span class="donut-dot" style="background:${HOLDERS_PALETTE[i % HOLDERS_PALETTE.length]}"></span><span>${esc(s.label)}</span><b>${s.pct}</b></div>`).join("");
  return `<div class="donut-wrap"><svg width="180" height="180" viewBox="0 0 180 180">${arcs}<text x="90" y="86" text-anchor="middle" class="donut-c1">${esc(centerTop)}</text><text x="90" y="106" text-anchor="middle" class="donut-c2">${esc(centerBottom)}</text></svg><div class="donut-legend">${legend}</div></div>`;
}
function holdersSparkline(closes, w, h) {
  if (!closes || closes.length < 2) return "—";
  const lo = Math.min.apply(null, closes), hi = Math.max.apply(null, closes);
  const range = (hi - lo) || 1;
  const pts = closes.map((c, i) => {
    const x = (i / (closes.length - 1)) * (w - 4) + 2;
    const y = h - 4 - ((c - lo) / range) * (h - 8);
    return x.toFixed(1) + "," + y.toFixed(1);
  }).join(" ");
  const up = closes[closes.length - 1] >= closes[0];
  const color = up ? "#e5484d" : "#1a9e54";
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
}

// ---------- 表现计算：复制组合买入持有 vs 沪深300 ----------
// 方法：取该大户最新季末持仓（股票 + 股数）固定不变，按前复权日 K 线算
// 组合市值随时间变化，与沪深 300 同期归一化到 100 对比。
// 这是“按披露持仓复制”的模拟收益，不是大户的真实收益；十大流通股东只披露
// 前十名，持仓可能不完整；价格为前复权价（含分红再投口径）。
async function holdersPerfData(positions, quarterEnd) {
  const key = positions.map((p) => p.code + ":" + p.shares).join("|") + "@" + quarterEnd;
  if (holdersPerfCache[key]) return holdersPerfCache[key];
  const res = { ok: false, reason: "", points: [], windows: {} };
  try {
    const kls = await Promise.all(positions.map(async (p) => {
      const kl = await fetchKline(p.code, 101, 1300);
      const rows = kl.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
      return { code: p.code, shares: p.shares, rows };
    }));
    const hs = await fetchHs300LongKline();
    const hsRows = hs.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const hsClose = {};
    for (const r of hsRows) hsClose[r.date] = r.close;
    // 按沪深 300 交易日对齐：每只持仓股取当日或之前最近收盘价（前复权）。
    const closeAt = (rows, date) => {
      let lo = 0, hi = rows.length - 1, ans = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (String(rows[mid].date) <= date) { ans = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return ans >= 0 ? rows[ans].close : null;
    };
    const points = [];
    for (const r of hsRows) {
      let val = 0, missing = false;
      for (const k of kls) {
        const c = closeAt(k.rows, r.date);
        if (c == null || !isFinite(c)) { missing = true; break; }
        val += k.shares * c;
      }
      points.push({ date: r.date, p: missing ? null : val, b: r.close });
    }
    res.points = points;
    // 窗口：本季度（季末→最新）、1年/3年/5年（最新日往前推）。
    const lastDate = points.length ? points[points.length - 1].date : null;
    const subDays = (d, n) => {
      const dt = new Date(d + "T00:00:00");
      dt.setDate(dt.getDate() - n);
      return dt.toISOString().slice(0, 10);
    };
    const winDefs = [
      { key: "q", label: "本季度", start: quarterEnd },
      { key: "1y", label: "1年", start: lastDate ? subDays(lastDate, 365) : null },
      { key: "3y", label: "3年", start: lastDate ? subDays(lastDate, 3 * 365) : null },
      { key: "5y", label: "5年", start: lastDate ? subDays(lastDate, 5 * 365) : null },
    ];
    for (const w of winDefs) {
      if (!w.start || !lastDate) { res.windows[w.key] = { label: w.label, ok: false, reason: "无行情数据" }; continue; }
      let firstIdx = -1;
      for (let i = 0; i < points.length; i++) { if (points[i].date >= w.start) { firstIdx = i; break; } }
      if (firstIdx < 0) { res.windows[w.key] = { label: w.label, ok: false, reason: "窗口起点晚于最新行情" }; continue; }
      let startIdx = -1;
      for (let i = firstIdx; i < points.length; i++) { if (points[i].p != null && points[i].b != null) { startIdx = i; break; } }
      if (startIdx < 0) { res.windows[w.key] = { label: w.label, ok: false, reason: "窗口内持仓股无复权价" }; continue; }
      if (startIdx - firstIdx > 5) {
        res.windows[w.key] = { label: w.label, ok: false, reason: "持仓股在窗口起点无复权价（上市不足或停牌），无法对齐" };
        continue;
      }
      const endIdx = points.length - 1;
      const p0 = points[startIdx].p, p1 = points[endIdx].p;
      const b0 = points[startIdx].b, b1 = points[endIdx].b;
      if (!(p0 > 0) || !(p1 > 0) || !(b0 > 0) || !(b1 > 0)) {
        res.windows[w.key] = { label: w.label, ok: false, reason: "窗口端点价格异常" };
        continue;
      }
      res.windows[w.key] = {
        label: w.label, ok: true,
        startDate: points[startIdx].date, endDate: points[endIdx].date,
        retP: p1 / p0 - 1, retB: b1 / b0 - 1, startIdx, endIdx,
      };
    }
    res.ok = true;
  } catch (e) {
    res.reason = "K 线拉取失败：" + (e && e.message ? e.message : e);
  }
  holdersPerfCache[key] = res;
  return res;
}

// ---------- 总览 ----------
// 入口：app.js loadStock 调用 renderHolders(data)；切换股票时回到总览。
async function renderHolders(data) {
  const el = document.getElementById("holdersBody");
  holdersDetail = null;
  const code = currentCode;
  const token = ++holdersRenderSeq;
  el.innerHTML = `<div class="loading">正在加载股东快照…</div>`;
  const snap = await holdersLoad(code);
  if (token !== holdersRenderSeq) return; // 已切到别的股票
  if (!snap) {
    el.innerHTML =
      `<p>机构持仓与超级大户：<span class="badge">暂不可用</span></p>
       <p class="muted" style="margin-top:8px">本站股东快照目前只覆盖 12 只自选股与贵州茅台（${esc(code)} 不在其中）。快照由 tools/refresh_holders.py 从东财 F10 股东研究接口拉取，每季披露后刷新；新股可跑该脚本补拉后随站部署。</p>
       <p style="margin-top:10px">手动查看：<a href="https://quote.eastmoney.com/${esc(txMarket(code))}${esc(code)}.html" target="_blank" rel="noopener">东财个股页（F10 → 股东研究）</a> · <a href="https://www.cninfo.com.cn/new/index" target="_blank" rel="noopener">巨潮资讯</a></p>`;
    return;
  }
  if (snap.empty) {
    el.innerHTML =
      `<p>机构持仓与超级大户：<span class="badge">暂不可用</span></p>
       <p class="muted" style="margin-top:8px">${esc(snap.name || code)}（${esc(code)}）是 ETF，无股东结构：${esc(snap.empty_reason || "无十大股东/基金持仓披露")}。ETF 的持仓明细见基金公司定期报告。</p>
       <p style="margin-top:10px">手动查看：<a href="https://quote.eastmoney.com/${esc(txMarket(code))}${esc(code)}.html" target="_blank" rel="noopener">东财 ETF 页</a></p>`;
    return;
  }
  holdersRenderOverview(snap);
  if (document.querySelector("#pane-holders.active")) holdersEnsureCross();
}

function holdersRenderOverview(snap) {
  const el = document.getElementById("holdersBody");
  const quarters = Object.keys(snap.quarters || {}).sort().reverse();
  if (!quarters.length) {
    el.innerHTML = `<p class="muted">该股快照中暂无季度数据。</p>`;
    return;
  }
  if (!holdersQuarter || quarters.indexOf(holdersQuarter) < 0) holdersQuarter = quarters[0];
  const q = snap.quarters[holdersQuarter];
  const qLabel = holdersQuarterLabel(holdersQuarter);
  const sdgdDate = (q.sdgd && q.sdgd.length && q.sdgd[0].END_DATE) ? q.sdgd[0].END_DATE.slice(0, 10) : null;
  const sdltgdDate = (q.sdltgd && q.sdltgd.length && q.sdltgd[0].END_DATE) ? q.sdltgd[0].END_DATE.slice(0, 10) : null;
  const jgcc = {};
  for (const r of q.jgcc || []) jgcc[r.ORG_TYPE] = r;
  const gdrsLatest = (q.gdrs && q.gdrs.length) ? q.gdrs[0] : null;
  const otherJgcc = (q.jgcc || []).filter((r) => ["02", "04", "06", "07"].indexOf(r.ORG_TYPE) >= 0);
  const otherOrgs = otherJgcc.reduce((s, r) => s + (r.TOTAL_ORG_NUM || 0), 0);
  const otherRatio = otherJgcc.reduce((s, r) => s + (r.TOTAL_SHARES_RATIO || 0), 0);

  // 类型过滤器（按本季两张股东表实际出现的分类）
  const presentKeys = {};
  for (const row of (q.sdgd || []).concat(q.sdltgd || [])) {
    presentKeys[holdersClassify(row.HOLDER_NAME, row.HOLDER_TYPE).key] = true;
  }
  const filterKeys = ["all"].concat(Object.keys(presentKeys).sort());
  const filterChips = filterKeys.map((k) => {
    const label = k === "all" ? "全部" : (HOLDER_TYPE_LABEL[k] || k);
    return `<button data-hfilter="${k}" class="${holdersTypeFilter === k ? "active" : ""}">${esc(label)}</button>`;
  }).join("");

  let html = "";
  html += `<p class="muted" style="margin-bottom:10px">数据：东财 F10 股东研究（十大股东/十大流通股东/股东户数/基金持仓/机构持股汇总），同源季度快照，快照更新于 ${esc((snap.fetched_at || "").slice(0, 10))}。`
    + ` 季度：<select id="holdersQuarterSel" style="font-size:13px;padding:2px 6px">${quarters.map((d) => `<option value="${d}" ${d === holdersQuarter ? "selected" : ""}>${esc(holdersQuarterLabel(d))}</option>`).join("")}</select>`
    + ` <span class="muted">仅一期快照时季度选择器只有一项；每季披露后跑 tools/refresh_holders.py 累积。</span></p>`;

  // 摘要
  html += `<div class="metrics">`;
  if (jgcc["00"]) html += metricCard("机构持股合计", fmtPct(jgcc["00"].TOTAL_SHARES_RATIO / 100), jgcc["00"].TOTAL_ORG_NUM + " 家机构 · 占流通股（较上季变动：仅一期快照，暂不可算）");
  if (jgcc["01"]) html += metricCard("基金持股", fmtPct(jgcc["01"].TOTAL_SHARES_RATIO / 100), jgcc["01"].TOTAL_ORG_NUM + " 只基金");
  if (jgcc["03"]) html += metricCard("社保基金持股", fmtPct(jgcc["03"].TOTAL_SHARES_RATIO / 100), jgcc["03"].TOTAL_ORG_NUM + " 个社保组合");
  if (jgcc["05"]) html += metricCard("保险持股", fmtPct(jgcc["05"].TOTAL_SHARES_RATIO / 100), jgcc["05"].TOTAL_ORG_NUM + " 家保险机构");
  if (gdrsLatest) html += metricCard("股东户数", gdrsLatest.HOLDER_TOTAL_NUM.toLocaleString("en-US") + " 户", "较上季 " + (gdrsLatest.TOTAL_NUM_RATIO > 0 ? "+" : "") + gdrsLatest.TOTAL_NUM_RATIO.toFixed(2) + "% · " + esc(gdrsLatest.HOLD_FOCUS || "") + " · 户均流通股 " + holdersFmtShares(gdrsLatest.AVG_FREE_SHARES));
  html += `</div>`;

  // 股东表过滤器
  html += `<div class="seg" id="holdersTypeFilter" style="margin-top:14px">${filterChips}</div>`;

  html += holdersHolderTable("十大股东", q.sdgd || [], holdersTypeFilter, sdgdDate !== holdersQuarter ? "截至 " + sdgdDate + "（股权变动披露，非季报日）" : "截至 " + (sdgdDate || holdersQuarter));
  html += holdersHolderTable("十大流通股东", q.sdltgd || [], holdersTypeFilter, "截至 " + (sdltgdDate || holdersQuarter));

  // 基金持仓（前 10 / 共 50）
  const jj = (q.jjcg || []).slice(0, 10);
  html += `<h3>基金持仓 · 前 10 <span class="muted" style="font-weight:400">（东财基金持仓前 50，只列前 10；均为公募/资管产品）</span></h3>`;
  if (!jj.length) html += `<p class="muted">暂无基金持仓披露。</p>`;
  else {
    html += `<table class="tbl"><tr><th>基金</th><th>持股数</th><th>持仓市值</th><th>占流通股</th></tr>`;
    html += jj.map((r) => `<tr><td style="text-align:left">${esc(r.HOLDER_NAME)}</td><td class="num">${holdersFmtShares(r.TOTAL_SHARES)}</td><td class="num">${fmtMoney(r.HOLD_VALUE)}</td><td class="num">${r.FREESHARES_RATIO != null ? (r.FREESHARES_RATIO * 100).toFixed(2) + "%" : "—"}</td></tr>`).join("");
    html += `</table><p class="muted" style="margin-top:6px">共 ${(q.jjcg || []).length} 只基金披露持仓；持仓市值按披露日股价算（jjcg HOLD_VALUE 字段）。</p>`;
  }

  // 机构持股汇总
  html += `<h3>机构持股汇总 <span class="muted" style="font-weight:400">（东财 jgcc，按机构类型汇总）</span></h3>`;
  html += `<table class="tbl"><tr><th>机构类型</th><th>机构数</th><th>持股数</th><th>占流通股</th><th>占总股本</th></tr>`;
  const jgccRow = (label, r) => r ? `<tr><td style="text-align:left">${esc(label)}</td><td class="num">${r.TOTAL_ORG_NUM}</td><td class="num">${holdersFmtShares(r.TOTAL_FREE_SHARES)}</td><td class="num">${r.TOTAL_SHARES_RATIO != null ? r.TOTAL_SHARES_RATIO.toFixed(2) + "%" : "—"}</td><td class="num">${r.ALL_SHARES_RATIO != null ? r.ALL_SHARES_RATIO.toFixed(2) + "%" : "—"}</td></tr>` : "";
  html += jgccRow("机构合计", jgcc["00"]);
  html += jgccRow("基金", jgcc["01"]);
  html += jgccRow("社保基金", jgcc["03"]);
  html += jgccRow("保险", jgcc["05"]);
  if (otherJgcc.length) html += `<tr><td style="text-align:left">其他机构类型（02/04/06/07）</td><td class="num">${otherOrgs}</td><td class="num">${holdersFmtShares(otherJgcc.reduce((s, r) => s + (r.TOTAL_FREE_SHARES || 0), 0))}</td><td class="num">${otherRatio.toFixed(2)}%</td><td class="num">—</td></tr>`;
  html += `</table><p class="muted" style="margin-top:6px">02/04/06/07 四类东财未公开中文释义，本站不猜测其类别，只汇总家数与占比；已验证：03=社保基金（持股数与十大流通股东中的社保组合完全一致）、05=保险（与中国人寿持股数完全一致）。机构持股合计的较上季变动：仅一期快照，暂不可算。</p>`;

  // 股东户数趋势（gdrs 最近 10 期）
  const gdrs = (q.gdrs || []).slice().sort((a, b) => String(a.END_DATE).localeCompare(String(b.END_DATE)));
  if (gdrs.length >= 2) {
    html += `<h3>股东户数趋势 <span class="muted" style="font-weight:400">（近 ${gdrs.length} 期，户数减少通常意味着筹码集中）</span></h3>`;
    html += `<div class="chart-box short"><canvas class="chart" id="holdersGdrsChart"></canvas></div>`;
    html += `<p class="muted">最新 ${esc(holdersQuarterShort(gdrs[gdrs.length - 1].END_DATE))}：${gdrs[gdrs.length - 1].HOLDER_TOTAL_NUM.toLocaleString("en-US")} 户，环比 ${gdrs[gdrs.length - 1].TOTAL_NUM_RATIO > 0 ? "+" : ""}${gdrs[gdrs.length - 1].TOTAL_NUM_RATIO.toFixed(2)}%，集中度 ${esc(gdrs[gdrs.length - 1].HOLD_FOCUS || "—")}，户均市值 ${fmtMoney(gdrs[gdrs.length - 1].AVG_HOLD_AMT)}。</p>`;
  }

  // 超级大户（本股）
  html += holdersSuperSection(snap, q);

  // 跨自选股汇总（懒加载）
  html += `<h3>超级大户在自选股中的持仓 <span class="muted" style="font-weight:400">（跨股汇总）</span></h3><div id="holdersCrossBody"><p class="muted">正在加载 12 只自选股快照…</p></div>`;

  el.innerHTML = html;

  // 绑定：季度选择、类型过滤
  const sel = document.getElementById("holdersQuarterSel");
  if (sel) sel.addEventListener("change", () => { holdersQuarter = sel.value; holdersRenderOverview(snap); });
  const ft = document.getElementById("holdersTypeFilter");
  if (ft) ft.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-hfilter]");
    if (!b) return;
    holdersTypeFilter = b.dataset.hfilter;
    holdersRenderOverview(snap);
  });
  // 股东户数图
  const cv = document.getElementById("holdersGdrsChart");
  if (cv && gdrs.length >= 2) {
    drawBars(cv, gdrs.map((r) => ({ label: holdersQuarterShort(r.END_DATE), v1: r.HOLDER_TOTAL_NUM, v2: null })), { label1: "股东户数" });
  }
  // 超级大户卡片点击 → 详情页
  el.querySelectorAll("[data-super-name]").forEach((b) => b.addEventListener("click", () => holdersOpenDetail(b.dataset.superName)));
}

function holdersHolderTable(title, rows, typeFilter, dateNote) {
  const filtered = rows.filter((r) => {
    if (typeFilter === "all") return true;
    return holdersClassify(r.HOLDER_NAME, r.HOLDER_TYPE).key === typeFilter;
  });
  let html = `<h3>${esc(title)} <span class="muted" style="font-weight:400">${esc(dateNote)}</span></h3>`;
  if (!rows.length) return html + `<p class="muted">暂无披露。</p>`;
  if (!filtered.length) return html + `<p class="muted">该类型下无股东（切换“全部”查看完整名单）。</p>`;
  html += `<table class="tbl"><tr><th>#</th><th>股东</th><th>类型</th><th>持股数</th><th>占比</th><th>较上期变动</th></tr>`;
  html += filtered.map((r) => {
    const cls = holdersClassify(r.HOLDER_NAME, r.HOLDER_TYPE);
    return `<tr><td class="num">${r.HOLDER_RANK}</td><td style="text-align:left">${esc(r.HOLDER_NAME)}</td><td><span class="badge htype-${cls.key}">${esc(cls.label)}</span></td><td class="num">${holdersFmtShares(r.HOLD_NUM)}</td><td class="num">${r.FREE_HOLDNUM_RATIO != null ? r.FREE_HOLDNUM_RATIO.toFixed(2) + "%" : "—"}</td><td class="num ${holdersChangeClass(r)}">${esc(holdersChangeText(r))}</td></tr>`;
  }).join("");
  html += `</table>`;
  if (title === "十大流通股东") html += `<p class="muted" style="margin-top:6px">占比 = 占流通股比例；较上期变动为东财原字段（HOLD_NUM_CHANGE / CHANGE_RATIO），“不变”即持股数与上期相同，“新进”即上期不在前十。</p>`;
  return html;
}

// 超级大户：本股十大流通股东里的社保/QFII/汇金·证金/养老金/个人
function holdersSuperSection(snap, q) {
  const supers = [];
  for (const row of q.sdltgd || []) {
    const cls = holdersClassify(row.HOLDER_NAME, row.HOLDER_TYPE);
    if (cls.super) supers.push({ row, cls });
  }
  let html = `<h3>超级大户 <span class="muted" style="font-weight:400">（本股十大流通股东中的社保/QFII/汇金·证金/养老金/个人大户，点击卡片看详情）</span></h3>`;
  if (!supers.length) {
    html += `<p class="muted">该股十大流通股东中无社保基金、QFII、汇金/证金、养老金或个人大户（前十均为一般法人、公募基金等机构）。</p>`;
    return html;
  }
  html += `<div class="super-grid">`;
  for (const s of supers) {
    html += `<button class="super-card" data-super-name="${esc(s.row.HOLDER_NAME)}"><span class="super-name">${esc(s.row.HOLDER_NAME)}</span><span class="badge htype-${s.cls.key}">${esc(s.cls.label)}</span><span class="super-num">持股 ${holdersFmtShares(s.row.HOLD_NUM)} · 占流通 ${s.row.FREE_HOLDNUM_RATIO != null ? s.row.FREE_HOLDNUM_RATIO.toFixed(2) + "%" : "—"}</span><span class="super-chg ${holdersChangeClass(s.row)}">较上期：${esc(holdersChangeText(s.row))}</span><span class="super-go">查看详情 →</span></button>`;
  }
  html += `</div><p class="muted" style="margin-top:6px">个人大户 = 十大流通股东中实际出现的个人股东；是否“知名牛散”本站不做主观认定，只列持股事实。葛卫东等名字若未出现在该股前十，本站不会凭印象编造其持仓。</p>`;
  return html;
}

// ---------- 跨自选股汇总 ----------
async function holdersBuildCross() {
  if (holdersCrossCache.loaded) return holdersCrossCache.investors;
  const codes = DEFAULT_WATCHLIST.map((s) => s.code).filter((c) => c !== "515220");
  const snaps = await Promise.all(codes.map((c) => holdersLoad(c)));
  const map = {};
  for (const snap of snaps) {
    if (!snap || snap.empty) continue;
    const qs = Object.keys(snap.quarters || {}).sort().reverse();
    if (!qs.length) continue;
    const q = snap.quarters[qs[0]];
    for (const row of q.sdltgd || []) {
      const cls = holdersClassify(row.HOLDER_NAME, row.HOLDER_TYPE);
      if (!cls.super) continue;
      const inv = map[row.HOLDER_NAME] || (map[row.HOLDER_NAME] = { name: row.HOLDER_NAME, typeKey: cls.key, typeLabel: cls.label, positions: [] });
      inv.positions.push({
        code: snap.code, name: snap.name, shares: row.HOLD_NUM,
        ratio: row.FREE_HOLDNUM_RATIO, change: holdersChangeText(row),
        changeRatio: row.CHANGE_RATIO, rank: row.HOLDER_RANK,
      });
    }
  }
  const list = Object.values(map);
  // 合计市值：批量拉现价（东财 ulist，浏览器可直接调）
  try {
    const allCodes = [];
    for (const inv of list) for (const p of inv.positions) if (allCodes.indexOf(p.code) < 0) allCodes.push(p.code);
    const quotes = await fetchEmQuotesBatch(allCodes.map((c) => secid(c)));
    for (const inv of list) {
      let total = 0;
      for (const p of inv.positions) {
        const q = quotes[p.code];
        p.price = q ? q.price : null;
        p.value = (q && q.price) ? p.shares * q.price : null;
        if (p.value) total += p.value;
      }
      inv.totalValue = total;
    }
  } catch (e) {
    for (const inv of list) inv.totalValue = null;
  }
  list.sort((a, b) => (b.positions.length - a.positions.length) || ((b.totalValue || 0) - (a.totalValue || 0)));
  holdersCrossCache.investors = list;
  holdersCrossCache.loaded = true;
  holdersCrossCache.codes = codes;
  return list;
}

async function holdersEnsureCross() {
  const body = document.getElementById("holdersCrossBody");
  if (!body) return;
  if (holdersCrossCache.loaded) { holdersRenderCross(); return; }
  try {
    await holdersBuildCross();
    holdersRenderCross();
  } catch (e) {
    body.innerHTML = `<p class="muted">跨股汇总加载失败（${esc(e.message || e)}），可刷新页面重试。</p>`;
  }
}

function holdersRenderCross() {
  const body = document.getElementById("holdersCrossBody");
  if (!body) return;
  const list = holdersCrossCache.investors || [];
  const types = ["all", "shebao", "qfii", "huijin", "pension", "person"].filter((k) => k === "all" || list.some((x) => x.typeKey === k));
  let html = `<div class="seg" id="holdersCrossFilter">${types.map((k) => `<button data-hcfilter="${k}" class="${holdersCrossFilter === k ? "active" : ""}">${k === "all" ? "全部" : esc(HOLDER_TYPE_LABEL[k])}</button>`).join("")}</div>`;
  const filtered = list.filter((x) => holdersCrossFilter === "all" || x.typeKey === holdersCrossFilter);
  if (!filtered.length) {
    html += `<p class="muted">该类型下无超级大户。</p>`;
  } else {
    html += `<table class="tbl"><tr><th>超级大户</th><th>类型</th><th>持仓只数</th><th>持仓股票（占该股流通股）</th><th>合计市值</th></tr>`;
    html += filtered.map((inv) => {
      const stocks = inv.positions.map((p) => `<a href="#" data-cross-stock="${p.code}">${esc(p.name)} ${p.ratio != null ? p.ratio.toFixed(2) + "%" : "—"}</a>`).join(" · ");
      return `<tr><td style="text-align:left"><a href="#" data-super-name="${esc(inv.name)}">${esc(inv.name)}</a></td><td><span class="badge htype-${inv.typeKey}">${esc(inv.typeLabel)}</span></td><td class="num">${inv.positions.length} 只</td><td style="text-align:left">${stocks}</td><td class="num">${inv.totalValue ? fmtMoney(inv.totalValue) : "—"}</td></tr>`;
    }).join("");
    html += `</table><p class="muted" style="margin-top:6px">范围：12 只自选股（煤炭 ETF 无股东结构除外）2026 年三季报十大流通股东；合计市值 = 各股持股数 × 现价（东财实时行情），仅统计出现在前十的持仓，不是大户的全部持仓。</p>`;
  }
  body.innerHTML = html;
  const ft = document.getElementById("holdersCrossFilter");
  if (ft) ft.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-hcfilter]");
    if (!b) return;
    holdersCrossFilter = b.dataset.hcfilter;
    holdersRenderCross();
  });
  body.querySelectorAll("[data-super-name]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); holdersOpenDetail(a.dataset.superName); }));
  body.querySelectorAll("[data-cross-stock]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); switchToStock(a.dataset.crossStock); }));
}

// ---------- 超级大户详情页 ----------
// 照 AleInversor“超级投资者投资组合”页三 tab 做 A 股版：
// 职位（持仓表）/ 表现（复制组合 vs 沪深300）/ 投资组合结构（环形图 + 行业权重 + 季度堆叠）。
// 段永平只是图版例子；A 股大户只列十大流通股东里实际出现的名字。
async function holdersOpenDetail(name) {
  const el = document.getElementById("holdersBody");
  el.innerHTML = `<div class="loading">正在加载 ${esc(name)} 的持仓…</div>`;
  await holdersBuildCross();
  const inv = (holdersCrossCache.investors || []).find((x) => x.name === name);
  if (!inv || !inv.positions.length) {
    el.innerHTML = `<p><button class="link-btn" id="holdersBackBtn">← 返回机构和超级大户</button></p><p class="muted" style="margin-top:10px">${esc(name)} 在 12 只自选股的十大流通股东中未出现（可能只在自选股之外的股票前十，或本期已退出前十）。本站只列持股事实，不补编。</p>`;
    document.getElementById("holdersBackBtn").addEventListener("click", holdersBackToOverview);
    return;
  }
  const quarters = holdersInvestorQuarters(name);
  holdersDetail = {
    name: inv.name, typeKey: inv.typeKey, typeLabel: inv.typeLabel,
    quarter: quarters[quarters.length - 1], quarters, tab: "positions", window: "1y",
    data: null,
  };
  await holdersRenderDetail();
}

function holdersBackToOverview() {
  holdersDetail = null;
  const snap = holdersCache[currentCode];
  if (snap && !snap.empty) holdersRenderOverview(snap);
  else renderHolders();
}

// 该大户在各股快照里出现过的季度（并集，倒序取最新为默认）
function holdersInvestorQuarters(name) {
  const set = {};
  const codes = DEFAULT_WATCHLIST.map((s) => s.code).filter((c) => c !== "515220");
  for (const code of codes) {
    const snap = holdersCache[code];
    if (!snap || snap.empty) continue;
    for (const qk of Object.keys(snap.quarters || {})) {
      const q = snap.quarters[qk];
      if ((q.sdltgd || []).some((r) => r.HOLDER_NAME === name)) set[qk] = true;
    }
  }
  const list = Object.keys(set).sort();
  return list.length ? list : ["2026-09-30"];
}

// 该大户在指定季度的持仓（跨 12 只自选股的十大流通股东）
function holdersInvestorPositions(name, quarter) {
  const positions = [];
  const codes = DEFAULT_WATCHLIST.map((s) => s.code).filter((c) => c !== "515220");
  for (const code of codes) {
    const snap = holdersCache[code];
    if (!snap || snap.empty) continue;
    const q = snap.quarters[quarter];
    if (!q) continue;
    for (const row of q.sdltgd || []) {
      if (row.HOLDER_NAME === name) {
        positions.push({
          code: snap.code, name: snap.name, shares: row.HOLD_NUM,
          ratio: row.FREE_HOLDNUM_RATIO, change: holdersChangeText(row),
          changeRatio: row.CHANGE_RATIO, rank: row.HOLDER_RANK,
        });
      }
    }
  }
  return positions;
}

async function holdersRenderDetail() {
  const d = holdersDetail;
  if (!d) return;
  const el = document.getElementById("holdersBody");
  const positions = holdersInvestorPositions(d.name, d.quarter);
  el.innerHTML = `<div class="loading">正在加载 ${esc(d.name)}（${esc(holdersQuarterLabel(d.quarter))}）的持仓与行情…</div>`;
  // 现价 + 行业（东财 ulist）与 5 年 K 线（表现复制用）并行拉取
  let quotes = {};
  try { quotes = await fetchEmQuotesBatch(positions.map((p) => secid(p.code))); } catch (e) { quotes = {}; }
  let perf = { ok: false, reason: "K 线未加载", points: [], windows: {} };
  try { perf = await holdersPerfData(positions, d.quarter); } catch (e) { perf = { ok: false, reason: "K 线拉取失败：" + (e.message || e), points: [], windows: {} }; }
  // 1 年走势小图用 5 年 K 线的最后 250 个收盘价
  const klinesByCode = {};
  try {
    await Promise.all(positions.map(async (p) => {
      try {
        const kl = await fetchKline(p.code, 101, 300);
        klinesByCode[p.code] = kl.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
      } catch (e) { klinesByCode[p.code] = null; }
    }));
  } catch (e) { /* 单只失败不影响整体 */ }
  for (const p of positions) {
    const q = quotes[p.code] || {};
    p.price = q.price != null ? q.price : null;
    p.industry = q.industry || "未分类";
    p.value = p.price != null ? p.shares * p.price : null;
    const kl = klinesByCode[p.code];
    p.spark = kl ? kl.slice(-250).map((r) => r.close) : null;
  }
  const totalValue = positions.reduce((s, p) => s + (p.value || 0), 0);
  for (const p of positions) p.weight = totalValue > 0 && p.value != null ? p.value / totalValue : null;
  positions.sort((a, b) => (b.value || 0) - (a.value || 0));
  const top10Value = positions.slice(0, 10).reduce((s, p) => s + (p.value || 0), 0);
  const focus = totalValue > 0 ? top10Value / totalValue : null;
  d.data = { positions, quotes, perf, totalValue, focus };
  holdersRenderDetailView();
}

function holdersRenderDetailView() {
  const d = holdersDetail;
  if (!d || !d.data) return;
  const el = document.getElementById("holdersBody");
  const { positions, totalValue, focus, perf } = d.data;
  const unchanged = positions.filter((p) => p.change === "不变").length;
  let html = "";
  html += `<p><button class="link-btn" id="holdersBackBtn">← 返回机构和超级大户</button></p>`;
  html += `<h2 style="margin-top:6px">${esc(d.name)} <span class="badge htype-${d.typeKey}">${esc(d.typeLabel)}</span></h2>`;
  html += `<p class="muted">季度：<select id="holdersDetailQuarter" style="font-size:13px;padding:2px 6px">${d.quarters.map((qk) => `<option value="${qk}" ${qk === d.quarter ? "selected" : ""}>${esc(holdersQuarterLabel(qk))}</option>`).join("")}</select> <span class="muted">持仓为十大流通股东披露的季末时点数；季度选择器按股东数据实际披露的季度来，目前只有一期快照。</span></p>`;
  html += `<div class="metrics">`;
  html += metricCard("职位", positions.length + " 只", "在 12 只自选股十大流通股东中的持仓数");
  html += metricCard("钱包尺寸", totalValue ? fmtMoney(totalValue) : "—", "持仓总市值（持股数 × 现价）");
  html += metricCard("专注", focus != null ? (focus * 100).toFixed(2) + "%" : "—", "前十仓位占组合比（≤10 只持仓时为 100%）");
  html += metricCard("新企业", "暂不可用", "仅一期快照，需两期以上才可算本季新进");
  html += metricCard("出售的公司", "暂不可用", "仅一期快照，需两期以上才可算本季退出");
  html += `</div>`;
  html += `<div class="seg" id="holdersDetailTabs" style="margin-top:14px">`;
  html += `<button data-dtab="positions" class="${d.tab === "positions" ? "active" : ""}">职位</button>`;
  html += `<button data-dtab="perf" class="${d.tab === "perf" ? "active" : ""}">表现</button>`;
  html += `<button data-dtab="structure" class="${d.tab === "structure" ? "active" : ""}">投资组合结构</button>`;
  html += `</div><div id="holdersDetailBody"></div>`;
  html += `<p class="muted" style="margin-top:10px">口径：以下持仓仅为该大户在本站 12 只自选股中出现在十大流通股东的股票；其在自选股之外的持仓本站无数据。持仓数、占比、变动均来自东财 F10 股东研究快照（${esc(holdersQuarterLabel(d.quarter))}），现价为东财实时行情。</p>`;
  el.innerHTML = html;
  document.getElementById("holdersBackBtn").addEventListener("click", holdersBackToOverview);
  const qsel = document.getElementById("holdersDetailQuarter");
  if (qsel) qsel.addEventListener("change", () => { d.quarter = qsel.value; d.data = null; holdersRenderDetail(); });
  document.getElementById("holdersDetailTabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-dtab]");
    if (!b) return;
    d.tab = b.dataset.dtab;
    holdersRenderDetailView();
  });
  holdersRenderDetailTab();
}

function holdersRenderDetailTab() {
  const d = holdersDetail;
  if (!d || !d.data) return;
  const body = document.getElementById("holdersDetailBody");
  if (!body) return;
  if (d.tab === "positions") holdersRenderDetailPositions(body);
  else if (d.tab === "perf") holdersRenderDetailPerf(body);
  else holdersRenderDetailStructure(body);
}

function holdersRenderDetailPositions(body) {
  const d = holdersDetail;
  const { positions, totalValue } = d.data;
  let html = `<p><button class="link-btn" id="holdersCsvBtn">下载 CSV 文件</button> <span class="muted">持仓表（${esc(holdersQuarterLabel(d.quarter))}十大流通股东）</span></p>`;
  html += `<table class="tbl"><tr><th>股票</th><th>公司</th><th>占组合</th><th>较上季增减</th><th>持股数</th><th>现价</th><th>1年走势</th><th>持仓市值</th></tr>`;
  html += positions.map((p) => {
    const chgCls = typeof p.changeRatio === "number" ? chgClass(p.changeRatio) : "flat";
    return `<tr><td class="num"><a href="#" data-dstock="${p.code}">${p.code}</a></td><td style="text-align:left">${esc(p.name)}</td><td class="num">${p.weight != null ? (p.weight * 100).toFixed(2) + "%" : "—"}</td><td class="num ${chgCls}">${esc(p.change)}</td><td class="num">${holdersFmtShares(p.shares)}</td><td class="num">${p.price != null ? p.price.toFixed(2) + " 元" : "—"}</td><td>${holdersSparkline(p.spark, 90, 28)}</td><td class="num">${p.value != null ? fmtMoney(p.value) : "—"}</td></tr>`;
  }).join("");
  html += `</table>`;
  html += `<p class="muted" style="margin-top:6px">合计市值 ${totalValue ? fmtMoney(totalValue) : "—"}；占组合 = 该股市值 / 组合总市值；1 年走势为该股近 1 年前复权收盘价小图（红涨绿跌）；较上季增减为东财原字段。</p>`;
  body.innerHTML = html;
  document.getElementById("holdersCsvBtn").addEventListener("click", () => holdersDownloadCSV(d));
  body.querySelectorAll("[data-dstock]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); switchToStock(a.dataset.dstock); }));
}

function holdersDownloadCSV(d) {
  const { positions } = d.data;
  const head = ["股票代码", "股票名称", "行业", "持股数（股）", "占组合%", "较上季变动", "现价（元）", "持仓市值（元）", "占该股流通股%"];
  const q = (v) => "\"" + String(v == null ? "" : v).replace(/"/g, "\"\"") + "\"";
  const lines = [head.map(q).join(",")];
  for (const p of positions) {
    lines.push([p.code, p.name, p.industry, p.shares, p.weight != null ? (p.weight * 100).toFixed(2) : "", p.change, p.price != null ? p.price.toFixed(2) : "", p.value != null ? Math.round(p.value) : "", p.ratio != null ? p.ratio.toFixed(2) : ""].map(q).join(","));
  }
  const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = d.name + "_持仓_" + d.quarter + ".csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function holdersRenderDetailPerf(body) {
  const d = holdersDetail;
  const { positions, perf } = d.data;
  const unchanged = positions.filter((p) => p.change === "不变").length;
  const top10 = positions.slice(0, 10).reduce((s, p) => s + (p.value || 0), 0);
  const total = positions.reduce((s, p) => s + (p.value || 0), 0);
  const focusPct = total > 0 ? (top10 / total * 100).toFixed(2) + "%" : "—";
  let html = "";
  // 窗口切换
  const winKeys = ["1y", "3y", "5y"];
  html += `<div class="seg" id="holdersPerfWin">${winKeys.map((k) => {
    const w = perf.windows[k];
    const dis = w && w.ok ? "" : " disabled";
    return `<button data-pwin="${k}" class="${d.window === k ? "active" : ""}"${dis}>${w ? w.label : k}</button>`;
  }).join("")}</div>`;
  html += `<div class="chart-box"><canvas class="chart" id="holdersPerfChart"></canvas></div>`;
  html += `<p class="muted" id="holdersPerfNote"></p>`;
  // 分段对比条
  html += `<h3>它能跑赢沪深300指数吗？ <span class="muted" style="font-weight:400">（复制组合 vs 沪深300，百分点差）</span></h3><div id="holdersCmpBars"></div>`;
  // 如何管理
  html += `<h3>如何管理</h3><div class="metrics">`;
  html += metricCard("他的十大赌注", focusPct, "前十仓位占组合比");
  html += metricCard("本季未动仓位", unchanged + " / " + positions.length + " 只", "较上季持股数“不变”的仓位（东财原字段）");
  html += metricCard("一个想法能持续多久", "暂不可用", "仅一期快照，需多期持仓才可算平均持有时长");
  html += metricCard("新的赌注", "暂不可用", "仅一期快照，需两期以上才可算本季新进");
  html += metricCard("出港", "暂不可用", "仅一期快照，需两期以上才可算本季退出");
  html += metricCard("钱包尺寸变化", "暂不可用", "仅一期快照，需两期以上才可算组合市值环比");
  html += `</div>`;
  html += `<p class="muted" style="margin-top:10px">方法：取该大户 ${esc(holdersQuarterLabel(d.quarter))}季末持仓（股票 + 股数）固定不变，按前复权日 K 线算组合市值随时间变化，与沪深 300 同期归一化到 100 对比。这是“按披露持仓复制”的模拟收益，不是大户的真实收益：未计大户季内买卖，未计其前十之外的持仓；沪深 300 为价格指数（不含分红），对比口径不完全一致。算不出的窗口标暂不可用，不编数。</p>`;
  body.innerHTML = html;
  // 对比条
  const cmp = document.getElementById("holdersCmpBars");
  const order = ["q", "1y", "3y", "5y"];
  const vals = [];
  for (const k of order) {
    const w = perf.windows[k];
    if (w && w.ok) { vals.push(Math.abs(w.retP), Math.abs(w.retB)); }
  }
  const maxAbs = Math.max.apply(null, vals.concat([0.01]));
  let cmpHtml = "";
  for (const k of order) {
    const w = perf.windows[k];
    if (!w) continue;
    if (!w.ok) {
      cmpHtml += `<div class="cmp-row"><span class="cmp-label">${esc(w.label)}</span><span class="muted">暂不可用：${esc(w.reason)}</span></div>`;
      continue;
    }
    const diff = (w.retP - w.retB) * 100;
    const bar = (v, color) => `<span class="cmp-bar" style="width:${Math.max(Math.abs(v) / maxAbs * 100, 1.5).toFixed(1)}%;background:${color}"></span>`;
    cmpHtml += `<div class="cmp-row"><span class="cmp-label">${esc(w.label)}</span><span class="cmp-vals"><span class="cmp-line"><i>组合</i>${bar(w.retP, "#e5484d")}<b class="${chgClass(w.retP * 100)}">${(w.retP * 100).toFixed(1)}%</b></span><span class="cmp-line"><i>沪深300</i>${bar(w.retB, "#94a3b8")}<b class="${chgClass(w.retB * 100)}">${(w.retB * 100).toFixed(1)}%</b></span></span><span class="cmp-diff ${chgClass(diff)}">${diff >= 0 ? "+" : ""}${diff.toFixed(1)} 分</span></div>`;
  }
  cmp.innerHTML = cmpHtml || `<p class="muted">表现数据不可用：${esc(perf.reason || "未知原因")}。</p>`;
  // 窗口切换
  document.getElementById("holdersPerfWin").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-pwin]");
    if (!b || b.disabled) return;
    d.window = b.dataset.pwin;
    holdersRenderDetailPerf(body);
  });
  // 画曲线
  const w = perf.windows[d.window];
  const note = document.getElementById("holdersPerfNote");
  const cv = document.getElementById("holdersPerfChart");
  if (!w || !w.ok) {
    if (note) note.textContent = "曲线暂不可用：" + (w ? w.reason : "无该窗口数据") + "。";
  } else {
    const pts = perf.points.slice(w.startIdx, w.endIdx + 1);
    const p0 = pts[0].p, b0 = pts[0].b;
    const step = Math.max(1, Math.floor(pts.length / 80));
    const sampled = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
    if (note) note.textContent = "窗口：" + w.startDate + " → " + w.endDate + "，组合 " + (w.retP * 100).toFixed(1) + "%，沪深300 " + (w.retB * 100).toFixed(1) + "%，相差 " + ((w.retP - w.retB) * 100).toFixed(1) + " 个百分点。";
    if (cv) drawPerfLines(cv, [
      { label: "复制组合", color: "#e5484d", points: sampled.map((r) => ({ x: r.date, y: r.p / p0 * 100 })) },
      { label: "沪深300", color: "#94a3b8", points: sampled.map((r) => ({ x: r.date, y: r.b / b0 * 100 })) },
    ]);
  }
}

function holdersRenderDetailStructure(body) {
  const d = holdersDetail;
  const { positions, totalValue } = d.data;
  let html = "";
  // 前十仓位环形图
  const top = positions.slice(0, 10);
  const topValue = top.reduce((s, p) => s + (p.value || 0), 0);
  const topPct = totalValue > 0 ? (topValue / totalValue * 100).toFixed(2) + "%" : "—";
  const othersValue = totalValue - topValue;
  const donutSegs = top.map((p) => ({ label: p.name + "（" + p.code + "）", value: p.value || 0, pct: p.weight != null ? (p.weight * 100).toFixed(1) + "%" : "—" }));
  if (othersValue > 0) donutSegs.push({ label: "其他持仓", value: othersValue, pct: (othersValue / totalValue * 100).toFixed(1) + "%" });
  html += `<h3>前十仓位</h3>${holdersDonut(donutSegs, topPct, "前十占比")}`;
  // 行业环形图（申万二级，f100）
  const byInd = {};
  for (const p of positions) {
    const ind = p.industry || "未分类";
    byInd[ind] = (byInd[ind] || 0) + (p.value || 0);
  }
  const indSegs = Object.entries(byInd).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v, pct: totalValue > 0 ? (v / totalValue * 100).toFixed(1) + "%" : "—" }));
  html += `<h3>行业分布 <span class="muted" style="font-weight:400">（申万二级行业，按持仓市值）</span></h3>${holdersDonut(indSegs, indSegs.length + " 个行业", "按市值")}`;
  // 行业权重现在 vs 前
  html += `<h3>按行业划分的权重 <span class="muted" style="font-weight:400">（现在 vs 上期）</span></h3>`;
  html += `<table class="tbl"><tr><th>行业</th><th>现在权重</th><th>上期权重</th><th>变化</th></tr>`;
  html += indSegs.map((s) => `<tr><td style="text-align:left">${esc(s.label)}</td><td class="num">${s.pct}</td><td class="num">—</td><td class="num">—</td></tr>`).join("");
  html += `</table><p class="muted" style="margin-top:6px">上期权重暂不可用：仅一期快照，需下次披露后跑快照脚本累积两期才可算行业权重变化。</p>`;
  // 季度堆叠条形图
  html += `<h3>各行业权重季度变化</h3><p><span class="badge">暂不可用</span> <span class="muted">季度堆叠条形图需多期快照（图版为 23Q3–26Q2 共 8 个季度）；本站目前只有 ${esc(holdersQuarterLabel(d.quarter))}一期，待每季跑快照脚本累积后出现。</span></p>`;
  // 如何解读
  html += `<h3>如何解读这些数据</h3><ul class="muted" style="font-size:13px;line-height:1.8;padding-left:18px">
    <li>持仓只统计该大户在本站 12 只自选股中出现在十大流通股东的股票；其余持仓本站无数据，环形图的分母是“本站可见持仓市值”，不是大户的全部资产。</li>
    <li>前十仓位占比高（如只有 1–2 只持仓时为 100%）说明在本站可见范围内集中，不代表大户整体集中。</li>
    <li>行业分布按申万二级行业（东财 f100 字段）归类；同一大户在不同股票的行业可能重叠，属正常现象。</li>
    <li>表现页的复制组合收益是模拟值：按季末持股数固定持有算出，未计季内买卖与前十之外的持仓，不能当作大户的真实收益率。</li>
    <li>十大流通股东是季末时点快照，季内增减不可见；季度选择器随快照累积而增长，届时可看多期变化。</li>
  </ul>`;
  body.innerHTML = html;
}

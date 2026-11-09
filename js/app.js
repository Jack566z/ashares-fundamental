// ============================================================
// A股基本面分析 — 界面逻辑（AleInversor v4.39 子模块全量对照）
// 无数据的子项在页面明确标“暂不可用”，不跳过、不造数。
// ============================================================
"use strict";

// ---------- 密码门 ----------
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function isAuthed() {
  return sessionStorage.getItem("af_auth") === "1" || localStorage.getItem("af_auth_remember") === "1";
}
function showApp() {
  document.getElementById("gate").style.display = "none";
  document.getElementById("app").style.display = "block";
}
async function tryLogin() {
  const pw = document.getElementById("gatePw").value;
  const err = document.getElementById("gateErr");
  if (!pw) { err.textContent = "请输入密码"; return; }
  let hash = "";
  try { hash = await sha256Hex(pw); } catch (e) { err.textContent = "浏览器不支持 crypto.subtle（请用 https 或 localhost 打开）"; return; }
  if (hash === PASSWORD_SHA256) {
    sessionStorage.setItem("af_auth", "1");
    if (document.getElementById("gateRemember").checked) localStorage.setItem("af_auth_remember", "1");
    showApp();
    initApp();
  } else {
    err.textContent = "密码错误，请重试";
    const card = document.getElementById("gateCard");
    card.classList.remove("shake"); void card.offsetWidth; card.classList.add("shake");
    document.getElementById("gatePw").select();
  }
}
document.getElementById("gateBtn").addEventListener("click", tryLogin);
document.getElementById("gatePw").addEventListener("keydown", (e) => { if (e.key === "Enter") tryLogin(); });
document.getElementById("lockBtn").addEventListener("click", () => {
  sessionStorage.removeItem("af_auth");
  localStorage.removeItem("af_auth_remember");
  location.reload();
});

// ---------- 工具 ----------
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function chgClass(v) { return v > 0 ? "up" : v < 0 ? "down" : "flat"; }
function chgText(v) { return v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(2) + "%"; }
function pct1(v) { return v == null || !isFinite(v) ? "—" : (v * 100).toFixed(1) + "%"; }
function num2(v) { return v == null || !isFinite(v) ? "—" : v.toFixed(2); }
// 暂不可用行（AleInversor 有、A 股公开接口无的子项）
function naRow(label, reason) {
  return `<tr><td>${esc(label)}</td><td class="num" colspan="2"><span class="badge">暂不可用</span> <span class="muted">${esc(reason)}</span></td></tr>`;
}
function metricCard(k, v, s) {
  return `<div class="metric"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="s">${esc(s || "")}</div></div>`;
}

// ---------- 自选股 ----------
const LS_WATCH = "af_watchlist";
function loadWatchlist() {
  try {
    const raw = localStorage.getItem(LS_WATCH);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return arr;
    }
  } catch (e) { /* 忽略 */ }
  return DEFAULT_WATCHLIST.map((s) => ({ ...s }));
}
function saveWatchlist(list) { localStorage.setItem(LS_WATCH, JSON.stringify(list)); }
let watchlist = loadWatchlist();
let currentCode = null;
let currentData = null;
let currentMetrics = null;
let currentExt = null;
let currentKlt = 101;

async function renderWatchlist() {
  const ul = document.getElementById("watchList");
  ul.innerHTML = watchlist.map((s) =>
    `<li data-code="${esc(s.code)}" class="${s.code === currentCode ? "active" : ""}">
      <span class="wl-name">${esc(s.name)}</span>
      <span class="wl-code">${esc(s.code)}</span>
      <span class="wl-price" data-q="${esc(s.code)}">—</span>
      <span class="wl-chg" data-qc="${esc(s.code)}">—</span>
      <button class="wl-x" data-del="${esc(s.code)}" title="移除">×</button>
    </li>`).join("");
  ul.querySelectorAll("li").forEach((li) => {
    li.addEventListener("click", (e) => {
      if (e.target.dataset.del) return;
      loadStock(li.dataset.code);
    });
  });
  ul.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      watchlist = watchlist.filter((s) => s.code !== btn.dataset.del);
      saveWatchlist(watchlist);
      renderWatchlist();
    });
  });
  try {
    const quotes = await fetchTxQuotes(watchlist.map((s) => s.code));
    for (const s of watchlist) {
      const q = quotes[s.code];
      const pEl = ul.querySelector(`[data-q="${s.code}"]`);
      const cEl = ul.querySelector(`[data-qc="${s.code}"]`);
      if (!pEl || !cEl) continue;
      if (q && q.price) {
        pEl.textContent = q.price.toFixed(2);
        pEl.className = "wl-price " + chgClass(q.changePct);
        cEl.textContent = chgText(q.changePct);
        cEl.className = "wl-chg " + chgClass(q.changePct);
      }
    }
  } catch (e) { /* 行情失败时留空，不阻塞 */ }
}

document.getElementById("watchAddBtn").addEventListener("click", addWatch);
document.getElementById("watchAddInput").addEventListener("keydown", (e) => { if (e.key === "Enter") addWatch(); });
async function addWatch() {
  const input = document.getElementById("watchAddInput");
  const code = (input.value || "").trim();
  if (!/^\d{6}$/.test(code)) { input.placeholder = "请输入 6 位代码"; input.value = ""; return; }
  if (watchlist.some((s) => s.code === code)) { input.value = ""; loadStock(code); return; }
  input.value = "";
  let name = code;
  try {
    const q = await fetchTxQuotes([code]);
    if (q[code] && q[code].name) name = q[code].name;
  } catch (e) { /* 忽略 */ }
  watchlist.unshift({ code, name });
  saveWatchlist(watchlist);
  renderWatchlist();
  loadStock(code);
}

// ---------- 搜索 ----------
let searchTimer = null;
const searchInput = document.getElementById("searchInput");
const searchResults = document.getElementById("searchResults");
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const kw = searchInput.value.trim();
  if (!kw) { searchResults.classList.remove("open"); searchResults.innerHTML = ""; return; }
  searchTimer = setTimeout(async () => {
    const list = await searchStocks(kw);
    if (!list.length) {
      searchResults.innerHTML = `<div class="sr-empty">未找到相关 A 股（试试代码或名称）</div>`;
    } else {
      searchResults.innerHTML = list.map((s) =>
        `<div class="sr-item" data-code="${esc(s.code)}" data-name="${esc(s.name)}">
          <span>${esc(s.name)}</span><span class="code">${esc(s.code)} · ${s.market === "sh" ? "上交所" : s.market === "sz" ? "深交所" : "北交所"}</span>
        </div>`).join("");
      searchResults.querySelectorAll(".sr-item").forEach((el) => {
        el.addEventListener("click", () => {
          searchResults.classList.remove("open");
          searchInput.value = "";
          loadStock(el.dataset.code);
        });
      });
    }
    searchResults.classList.add("open");
  }, 300);
});
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const kw = searchInput.value.trim();
    if (/^\d{6}$/.test(kw)) { searchResults.classList.remove("open"); searchInput.value = ""; loadStock(kw); }
  }
  if (e.key === "Escape") searchResults.classList.remove("open");
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrap")) searchResults.classList.remove("open");
});

// ---------- 市场异动 ----------
async function renderMovers() {
  const ul = document.getElementById("moversList");
  try {
    // 东财 clist 偶发 502（2026-11-09 14:07 验证时拉取失败，14:12 同接口实测已通）：
    // 最多试 3 次，每次间隔 800ms，仍失败才显示暂不可用。
    let movers = [];
    for (let attempt = 0; attempt < 3 && !movers.length; attempt++) {
      try { movers = await fetchMovers(12); } catch (e) { movers = []; }
      if (!movers.length && attempt < 2) await new Promise((r) => setTimeout(r, 800));
    }
    if (!movers.length) throw new Error("东财涨幅榜连续 3 次无数据");
    ul.innerHTML = movers.map((s) =>
      `<li data-code="${esc(s.code)}">
        <span class="wl-name">${esc(s.name)}</span>
        <span class="wl-code">${esc(s.code)}</span>
        <span class="wl-price">${s.price != null ? s.price.toFixed(2) : "—"}</span>
        <span class="wl-chg up">${s.changePct != null ? "+" + s.changePct.toFixed(2) + "%" : "—"}</span>
      </li>`).join("");
    ul.querySelectorAll("li").forEach((li) => li.addEventListener("click", () => loadStock(li.dataset.code)));
  } catch (e) {
    ul.innerHTML = `<li class="muted" style="cursor:default">涨幅榜暂不可用（${esc(e.message || e)}）</li>`;
  }
}

// ---------- 标签页 ----------
const CHART_TABS = { tech: drawTech, history: drawHistoryExt, drawdown: drawDrawdownPane, dividend: drawDividend, profitability: drawProfitability };
// 懒加载标签（首次打开时才拉数据）：分析师研报、行业历史
let analystLoadedFor = null;
let sectorHistLoadedFor = null;
let winrateLoaded = false;
let profitLoaded = false;
document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-tab]");
  if (!btn) return;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b === btn));
  document.querySelectorAll(".tab-pane").forEach((p) => p.classList.toggle("active", p.id === "pane-" + btn.dataset.tab));
  // 回到个股标签时隐藏工具包区
  document.getElementById("toolArea").style.display = "none";
  document.getElementById("detailArea").style.display = "block";
  document.querySelectorAll("#toolTabs button").forEach((b) => b.classList.remove("active"));
  const fn = CHART_TABS[btn.dataset.tab];
  if (fn && currentData) fn();
  if (btn.dataset.tab === "analyst" && currentCode && analystLoadedFor !== currentCode) renderAnalyst(currentCode);
  if (btn.dataset.tab === "sector" && currentCode && sectorHistLoadedFor !== currentCode) renderSectorHist(currentCode);
  if (btn.dataset.tab === "winrate" && !winrateLoaded) { winrateLoaded = true; renderWinrate(); }
  if (btn.dataset.tab === "profitfactor" && !profitLoaded) { profitLoaded = true; renderProfitFactor(); }
});
// 工具包标签（市场级）：隐藏个股详情区，显示工具区，首次打开懒加载
const TOOL_LOADERS = { heatmap: () => renderHeatmap("industry"), radar: renderRadar, compare: renderCompare, hs300: renderHs300, mycharts: renderMycharts };
const toolLoaded = {};
document.getElementById("toolTabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-tool]");
  if (!btn) return;
  document.querySelectorAll("#toolTabs button").forEach((b) => b.classList.toggle("active", b === btn));
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".tab-pane").forEach((p) => p.classList.remove("active"));
  document.getElementById("detailArea").style.display = "none";
  document.getElementById("toolArea").style.display = "block";
  document.querySelectorAll(".tool-pane").forEach((p) => { p.style.display = p.id === "tool-" + btn.dataset.tool ? "block" : "none"; });
  if (!toolLoaded[btn.dataset.tool]) { toolLoaded[btn.dataset.tool] = true; TOOL_LOADERS[btn.dataset.tool](); }
});
document.getElementById("heatmapSeg").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-hm]");
  if (!btn) return;
  document.querySelectorAll("#heatmapSeg button").forEach((b) => b.classList.toggle("active", b === btn));
  renderHeatmap(btn.dataset.hm);
});
document.getElementById("saveChartBtn").addEventListener("click", saveCurrentChart);
document.getElementById("klineSeg").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-klt]");
  if (!btn) return;
  document.querySelectorAll("#klineSeg button").forEach((b) => b.classList.toggle("active", b === btn));
  currentKlt = parseInt(btn.dataset.klt, 10);
  drawTech();
});
document.getElementById("dcfBtn").addEventListener("click", () => renderDCF());
document.getElementById("projBtn").addEventListener("click", () => renderEPSProjection());

// ---------- 主加载 ----------
async function loadStock(code) {
  currentCode = code;
  document.getElementById("stockArea").innerHTML = `<div class="loading">正在加载 ${esc(code)} 的行情与财报…</div>`;
  document.getElementById("detailArea").style.display = "none";
  renderWatchlist();
  let data;
  try {
    data = await fetchStockAll(code);
  } catch (e) {
    document.getElementById("stockArea").innerHTML = `<div class="err-box">加载失败：${esc(e.message || e)}。请检查网络后重试。</div>`;
    return;
  }
  currentData = data;
  const m = calcMetrics(data);
  currentMetrics = m;
  const ext = calcExtended(data, m);
  currentExt = ext;
  document.getElementById("stockArea").innerHTML = "";
  document.getElementById("detailArea").style.display = "block";
  renderHead(data, m);
  renderScore(data, m);
  renderMetrics(m);
  renderOverview(data, m, ext);
  renderValuation(data, m, ext);
  renderDCF();
  renderEPSProjection();
  renderProfitability(data, m, ext);
  renderDebt(data, m, ext);
  renderGrowth(data, m, ext);
  renderDividend(data, m, ext);
  renderEarnings(data);
  renderForecast(data, m, ext);
  renderSector(data, m, ext);
  renderCyclicality(data, m, ext);
  renderCalendar(data);
  renderKpi(data, m, ext);
  renderSegments(data);
  renderSeasonality(data);
  renderHolders(data);
  renderTarget(data, m, ext);
  renderInvestor(data, m, ext);
  renderSmith(data, m, ext);
  renderCompany(data, m);
  analystLoadedFor = null;
  sectorHistLoadedFor = null;
  if (document.querySelector("#pane-analyst.active")) renderAnalyst(code);
  if (document.querySelector("#pane-sector.active")) renderSectorHist(code);
  drawTech();
  drawHistoryExt();
  drawDrawdownPane();
  drawDividend();
  drawProfitability();
  if (!watchlist.some((s) => s.code === code)) {
    const name = (data.quote && data.quote.name) || (data.tx && data.tx.name) || code;
    document.getElementById("shCode").innerHTML = esc(code) + ` · <a href="#" id="addCurrentLink">+ 加入自选</a>`;
    document.getElementById("addCurrentLink").addEventListener("click", (e) => {
      e.preventDefault();
      watchlist.unshift({ code, name });
      saveWatchlist(watchlist);
      renderWatchlist();
      renderHead(data, m);
    });
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------- 渲染：头部 ----------
function renderHead(data, m) {
  const q = data.quote || {};
  const name = q.name || (data.tx && data.tx.name) || currentCode;
  document.getElementById("shName").textContent = name;
  document.getElementById("shCode").textContent = currentCode + (watchlist.some((s) => s.code === currentCode) ? " · 已在自选" : "");
  const price = m.price;
  const priceEl = document.getElementById("shPrice");
  priceEl.textContent = price != null ? price.toFixed(2) : "—";
  priceEl.className = "p " + chgClass(m.changePct);
  const chgEl = document.getElementById("shChange");
  const chgAmt = price != null && m.prevClose != null ? price - m.prevClose : null;
  chgEl.textContent = (chgAmt != null ? (chgAmt > 0 ? "+" : "") + chgAmt.toFixed(2) + "  " : "") + chgText(m.changePct);
  chgEl.className = "c " + chgClass(m.changePct);
  document.getElementById("shSub").textContent =
    "昨收 " + (m.prevClose != null ? m.prevClose.toFixed(2) : "—")
    + " · 今开 " + (q.open != null ? q.open.toFixed(2) : "—")
    + " · 最高 " + (q.high != null ? q.high.toFixed(2) : "—")
    + " · 最低 " + (q.low != null ? q.low.toFixed(2) : "—");
  document.getElementById("shMeta").textContent =
    (m.industry ? "行业：" + m.industry + "  " : "")
    + "总市值 " + fmtMoney(m.totalMcap) + "  流通市值 " + fmtMoney(m.floatMcap)
    + "  总股本 " + (m.totalShares ? fmtMoney(m.totalShares) + " 股" : "—");
  const tags = [];
  if (m.concepts) tags.push(...String(m.concepts).split(";").filter(Boolean).slice(0, 8));
  document.getElementById("shTags").innerHTML = tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("");
}

// ---------- 渲染：评分 ----------
function renderScore(data, m) {
  const res = scoreStock(m, data.klineD);
  const ring = document.getElementById("scoreRing");
  const pct = res.totalMax ? res.total / res.totalMax : 0;
  const col = pct >= 0.8 ? "#1a9e54" : pct >= 0.65 ? "#2b6cb0" : pct >= 0.5 ? "#b45309" : "#e5484d";
  ring.style.borderColor = col;
  ring.style.color = col;
  document.getElementById("scoreNum").textContent = res.total;
  document.getElementById("scoreDen").textContent = "/ " + res.totalMax + (res.partial ? "（部分）" : "");
  document.getElementById("scoreGrade").textContent = "评级：" + res.grade;
  document.getElementById("scoreNote").textContent = res.partial ? "该标的无财报数据，只计估值 + 技术" : "";
  const labels = { valuation: "估值", profitability: "盈利", debt: "负债", growth: "成长", dividend: "分红", technical: "技术" };
  document.getElementById("scoreDims").innerHTML = Object.keys(labels).map((k) => {
    const d = res.dims[k];
    const w = d.max ? Math.round(d.score / d.max * 100) : 0;
    return `<div class="dim-row">
      <div class="dim-top"><b>${labels[k]}</b><span>${d.na ? "不适用" : d.score + " / " + d.max}</span></div>
      <div class="dim-bar"><i style="width:${d.na ? 0 : w}%;background:${d.na ? "#e5e7eb" : col}"></i></div>
      <div class="dim-detail">${esc(d.detail)}</div>
    </div>`;
  }).join("");
  const warn = document.getElementById("scoreWarn");
  const missing = Object.entries(data.errors || {}).filter(([k]) => ["income", "balance", "cashflow"].includes(k));
  if (missing.length && m.hasFinancials) {
    warn.style.display = "block";
    warn.textContent = "注意：部分财报接口本次未返回数据（" + missing.map(([k]) => k).join("、") + "），对应维度可能偏低；刷新页面可重试。";
  } else warn.style.display = "none";
}

// ---------- 渲染：关键指标 ----------
function renderMetrics(m) {
  document.getElementById("metricsBasis").textContent = m.ttmBasis ? "TTM 口径：" + m.ttmBasis : "";
  const items = [
    ["PE-TTM", m.peTtm != null ? m.peTtm.toFixed(2) : "—", "腾讯行情"],
    ["PE（静态）", m.peStatic != null ? m.peStatic.toFixed(2) : "—", "腾讯行情"],
    ["PB", m.pb != null ? m.pb.toFixed(2) : "—", "腾讯行情"],
    ["股息率", m.divYield != null ? m.divYield.toFixed(2) + "%" : "—", m.divYieldEm != null ? "东财" : "近12月派息/现价"],
    ["ROE（TTM）", m.roe != null ? fmtPct(m.roe, 1) : "—", "归母利润TTM/净资产"],
    ["净利率（TTM）", m.netMargin != null ? fmtPct(m.netMargin, 1) : "—", "归母利润TTM/营收TTM"],
    ["营收（TTM）", fmtMoney(m.ttmRevenue), ""],
    ["归母利润（TTM）", fmtMoney(m.ttmProfit), ""],
    ["营收同比（TTM）", m.revGrowth != null ? fmtPct(m.revGrowth, 1) : "—", ""],
    ["利润同比（TTM）", m.profitGrowth != null ? fmtPct(m.profitGrowth, 1) : "—", ""],
    ["资产负债率", m.debtRatio != null ? fmtPct(m.debtRatio, 1) : "—", "最新一期"],
    ["经营现金流（TTM）", fmtMoney(m.ttmOpCf), ""],
    ["自由现金流（TTM）", fmtMoney(m.ttmFcf), "经营+投资"],
    ["近12月每股派息", m.dps12m != null ? m.dps12m.toFixed(2) + " 元" : "—", "税前"],
    ["派息率", m.payout != null ? fmtPct(m.payout, 0) : "—", "派息/EPS(TTM)"],
    ["换手率", m.turnover != null ? m.turnover.toFixed(2) + "%" : "—", "当日"],
  ];
  document.getElementById("metricsGrid").innerHTML = items.map(([k, v, s]) => metricCard(k, v, s)).join("");
}

// ---------- 概况 ----------
function renderOverview(data, m, ext) {
  const q = data.quote || {};
  const na = ext.na || {};
  // 公司简介：东财 F10 ORG_PROFILE（fetchCompanyProfile，2026-11-09 实测紫金有 1739 字）；
  // ETF 无此表记录时 data.profile 为 null，仍显示暂不可用，不拖垮整页。
  const _prof = (data.profile && data.profile.ORG_PROFILE || "").replace(/\s+/g, " ").trim();
  const profileText = _prof ? (_prof.length > 240 ? _prof.slice(0, 240) + "……" : _prof) : "暂不可用 — 该标的无公司简介数据（ETF 等无 F10 记录）";
  const pf = data.profile || {};
  const rows = [
    ["公司名称", q.name || (data.tx && data.tx.name) || "—"],
    ["代码", currentCode + " · " + (txMarket(currentCode) === "sh" ? "上交所" : txMarket(currentCode) === "sz" ? "深交所" : "北交所")],
    ["行业", m.industry || "—"],
    ["地域", q.region || "—"],
    ["概念/题材", m.concepts || "—"],
    ["上市日期", pf.LISTING_DATE ? String(pf.LISTING_DATE).slice(0, 10) : "—"],
    ["成立日期", pf.FOUND_DATE ? String(pf.FOUND_DATE).slice(0, 10) : "—"],
    ["主营业务", pf.MAIN_BUSINESS || "—"],
    ["员工数", pf.EMP_NUM != null ? Number(pf.EMP_NUM).toLocaleString("zh-CN") + " 人" : "—"],
    ["实际控制人", pf.ACTUAL_HOLDER || "—"],
    ["总市值", fmtMoney(m.totalMcap)],
    ["流通市值", fmtMoney(m.floatMcap)],
    ["总股本", m.totalShares ? fmtMoney(m.totalShares) + " 股" : "—"],
    ["每股净资产 BPS", data.income && data.income[0] ? num2(num(data.income[0].BPS)) + " 元" : "—"],
    ["加权 ROE（最新年报）", data.income && data.income[0] ? pct1(num(data.income[0].WEIGHTAVG_ROE) / 100) : "—"],
    ["公司描述", profileText],
    ["Beta vs 沪深300", ext.cyclicality.beta != null ? ext.cyclicality.beta.toFixed(2) : "暂不可用 — " + (na.beta || "数据不足")],
  ];
  document.getElementById("ovProfile").innerHTML =
    `<table class="tbl">` + rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td style="text-align:left">${esc(v)}</td></tr>`).join("") + `</table>`;
  const res = scoreStock(m, data.klineD);
  const labels = { valuation: "⚖️ 估值", profitability: "💰 盈利", debt: "🏦 负债", growth: "🚀 成长", dividend: "💎 分红", technical: "📉 技术" };
  document.getElementById("ovSummary").innerHTML = Object.keys(labels).map((k) => {
    const d = res.dims[k];
    return metricCard(labels[k], d.na ? "不适用" : d.score + " / " + d.max, d.detail.split("；")[0]);
  }).join("");
}

// ---------- 估值 ----------
function renderValuation(data, m, ext) {
  const v = ext.valuation || {};
  const na = ext.na || {};
  const row = (label, value, note) => `<tr><td>${esc(label)}</td><td class="num">${esc(value)}</td><td style="text-align:left" class="muted">${esc(note || "")}</td></tr>`;
  let html = `<table class="tbl"><tr><th>倍数</th><th>数值</th><th>说明</th></tr>`;
  html += row("PER TTM", num2(m.peTtm), "市盈率（TTM）");
  html += naRow("PER NTM（forward）", na.perNtm || "无数据");
  if (v.peg != null) html += row("PEG", num2(v.peg), "PE-TTM / 利润 TTM 同比增速（%）");
  else html += naRow("PEG", na.peg || "无利润增速数据");
  html += row("P/S（市销率）", num2(v.ps), "总市值 / 营收 TTM");
  html += row("P/B（市净率）", num2(m.pb), "股价 / 每股净资产");
  html += row("P/FCF", num2(v.pFcf), "总市值 / 自由现金流 TTM");
  html += row("EV（企业价值）", fmtMoney(v.ev), "总市值 + 总负债 − 货币资金");
  html += row("EV/EBIT", num2(v.evEbit), "EV / EBIT（TTM，EBIT≈营业利润+财务费用）");
  html += naRow("EV/EBITDA", na.evEbitda || "无数据");
  html += row("EV/FCF", num2(v.evFcf), "EV / 自由现金流 TTM");
  html += row("EV/ ventas（EV/营收）", num2(v.evSales), "EV / 营收 TTM");
  html += row("Earnings Yield（盈利率）", v.earnYield != null ? v.earnYield.toFixed(2) + "%" : "—", "EPS(TTM)/股价 = 1/PE");
  html += row("FCF Yield（自由现金流收益率）", v.fcfYield != null ? v.fcfYield.toFixed(2) + "%" : "—", "FCF(TTM)/总市值");
  html += `</table>`;
  document.getElementById("valTable").innerHTML = html;
}

// ---------- DCF ----------
function renderDCF() {
  const el = document.getElementById("dcfBody");
  const m = currentMetrics;
  if (!m) return;
  const wacc = (parseFloat(document.getElementById("dcfWacc").value) || 8) / 100;
  const gInput = document.getElementById("dcfGrowth").value.trim();
  const growth = gInput === "" ? null : parseFloat(gInput) / 100;
  const terminal = (parseFloat(document.getElementById("dcfTerminal").value) || 2) / 100;
  const years = parseInt(document.getElementById("dcfYears").value, 10) || 5;
  const res = calcDCF(m, { wacc, growth, terminalGrowth: terminal, growthYears: years });
  if (!res.usable) {
    el.innerHTML = `<div class="err-box" style="margin-top:12px">DCF 暂不可用：${esc(res.reason)}。</div>`;
    return;
  }
  const price = m.price;
  const vs = res.upside != null ? (res.upside >= 0 ? "高于现价 " + res.upside.toFixed(1) + "%" : "低于现价 " + Math.abs(res.upside).toFixed(1) + "%") : "";
  el.innerHTML = `
    <div class="dcf-result">
      <div class="small">内在价值 / 股（DCF）</div>
      <div class="big ${res.perShare >= (price || 0) ? "up" : "down"}">${res.perShare.toFixed(2)} 元</div>
      <div class="vs">现价 ${price != null ? price.toFixed(2) + " 元" : "—"} · 内在价值${vs}</div>
      <div class="small" style="margin-top:6px">增长率来源：${esc(res.growthSource)}（g = ${(res.growth * 100).toFixed(1)}%）；WACC ${(res.wacc * 100).toFixed(1)}%；永续增长率 ${(res.terminalGrowth * 100).toFixed(1)}%；预测 ${res.years} 年</div>
    </div>
    <table class="tbl" style="margin-top:12px">
      <tr><th>项目</th><th>金额</th></tr>
      <tr><td>TTM 自由现金流（FCF₀）</td><td class="num">${fmtMoney(res.fcf0)}</td></tr>
      <tr><td>未来 ${res.years} 年 FCF 现值合计</td><td class="num">${fmtMoney(res.pvSum)}</td></tr>
      <tr><td>终值 TV（第 ${res.years} 年末）</td><td class="num">${fmtMoney(res.tv)}</td></tr>
      <tr><td>终值现值</td><td class="num">${fmtMoney(res.pvTv)}</td></tr>
      <tr><td>企业价值 EV</td><td class="num">${fmtMoney(res.ev)}</td></tr>
      <tr><td>减：净负债（总负债 − 货币资金）</td><td class="num">${fmtMoney(res.netDebt)}</td></tr>
      <tr><td><b>股权价值</b></td><td class="num"><b>${fmtMoney(res.equityValue)}</b></td></tr>
      <tr><td>总股本</td><td class="num">${fmtMoney(m.totalShares)} 股</td></tr>
    </table>
    <table class="tbl" style="margin-top:12px">
      <tr><th>预测年</th><th>自由现金流</th><th>折现值</th></tr>
      ${res.rows.map((r) => `<tr><td>第 ${r.year} 年</td><td class="num">${fmtMoney(r.fcf)}</td><td class="num">${fmtMoney(r.pv)}</td></tr>`).join("")}
    </table>
    <p class="muted" style="margin-top:10px">DCF 对增长率与 WACC 极度敏感：WACC 上调 1 个百分点或增长率下调 1 个百分点，内在价值会明显变化。请结合评分与财报交叉验证，不要只看单一数字。</p>`;
}

// ---------- EPS 预测 ----------
function renderEPSProjection() {
  const el = document.getElementById("projBody");
  const m = currentMetrics, ext = currentExt;
  if (!m || !ext) return;
  const g = parseFloat(document.getElementById("projGrowth").value);
  const years = parseInt(document.getElementById("projYears").value, 10) || 3;
  const exitPe = parseFloat(document.getElementById("projExitPe").value);
  const res = ext.epsProjection(isFinite(g) ? g : 10, years, isFinite(exitPe) ? exitPe : 22);
  if (!res.usable) {
    el.innerHTML = `<div class="err-box" style="margin-top:12px">EPS 预测暂不可用：${esc(res.reason)}。</div>`;
    return;
  }
  el.innerHTML = `
    <div class="dcf-result">
      <div class="small">${res.years} 年后预测价（EPS × 退出 PE）</div>
      <div class="big ${res.priceN >= (m.price || 0) ? "up" : "down"}">${res.priceN.toFixed(2)} 元</div>
      <div class="vs">现价 ${m.price != null ? m.price.toFixed(2) + " 元" : "—"} · ${res.upside != null ? (res.upside >= 0 ? "高于现价 " + res.upside.toFixed(1) + "%" : "低于现价 " + Math.abs(res.upside).toFixed(1) + "%") : ""} · ${esc(res.verdict)}</div>
      <div class="small" style="margin-top:6px">TTM EPS ${res.eps0.toFixed(2)} 元 × (1+${(res.growth * 100).toFixed(1)}%)^${res.years} = ${res.epsN.toFixed(2)} 元；× 退出 PE ${res.exitPe} 倍。${esc(res.note)}</div>
    </div>`;
}

// ---------- 盈利 ----------
function renderProfitability(data, m, ext) {
  const p = ext.profitability || {};
  const na = ext.na || {};
  const row = (label, value, note) => `<tr><td>${esc(label)}</td><td class="num">${esc(value)}</td><td style="text-align:left" class="muted">${esc(note || "")}</td></tr>`;
  let html = `<h3>利润率（TTM）</h3><table class="tbl"><tr><th>指标</th><th>数值</th><th>说明</th></tr>`;
  html += row("毛利率", pct1(p.grossMargin), "（营收−营业成本）/营收");
  html += naRow("毛利率 EBITDA（Margen EBITDA）", na.ebitdaMargin || "无数据");
  html += row("EBIT 利润率", pct1(p.ebitMargin), "EBIT/营收，EBIT≈营业利润+财务费用");
  html += row("营业利润率", pct1(p.opMargin), "营业利润/营收");
  html += row("净利率", pct1(p.netMargin), "归母利润/营收");
  html += row("FCF 利润率", pct1(p.fcfMargin), "自由现金流/营收");
  html += `</table><h3>资本回报（TTM）</h3><table class="tbl"><tr><th>指标</th><th>数值</th><th>说明</th></tr>`;
  html += row("ROE", pct1(m.roe), "归母利润TTM/净资产");
  html += row("ROA", pct1(p.roa), "归母利润TTM/总资产");
  html += row("ROIC", pct1(p.roic), "NOPAT/投入资本（净资产+总负债，代理口径）");
  html += row("ROCE", pct1(p.roce), "EBIT/投入资本（净资产+总负债，代理口径）");
  html += row("所得税率", pct1(p.taxRate), "所得税/利润总额（TTM）");
  html += `</table>`;
  document.getElementById("profTable").innerHTML = html;
  const med = [];
  if (p.roeMedian5 != null) med.push(metricCard("ROE 五年中位数", pct1(p.roeMedian5), "年报加权 ROE"));
  if (p.roicMedian5 != null) med.push(metricCard("ROIC 五年中位数", pct1(p.roicMedian5), "年报口径"));
  if (p.roceMedian5 != null) med.push(metricCard("ROCE 五年中位数", pct1(p.roceMedian5), "年报口径"));
  document.getElementById("profMedians").innerHTML =
    (med.length ? `<div class="metrics" style="margin-top:10px">` + med.join("") + `</div>` : `<p class="muted">五年中位数暂无数据。</p>`);
}
function drawProfitability() {
  const canvas = document.getElementById("profChart");
  const ext = currentExt;
  if (!ext || !ext.profitability || !ext.profitability.marginHist || !ext.profitability.marginHist.length) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const hist = ext.profitability.marginHist.slice(-10);
  drawBars(canvas, hist.map((h) => ({
    label: String(h.year),
    v1: h.gross != null ? h.gross * 100 : null,
    v2: h.net != null ? h.net * 100 : null,
  })), { label1: "毛利率（%）", label2: "净利率（%）" });
}

// ---------- 负债 ----------
function renderDebt(data, m, ext) {
  const d = ext.debt || {};
  const na = ext.na || {};
  const row = (label, value, note) => `<tr><td>${esc(label)}</td><td class="num">${esc(value)}</td><td style="text-align:left" class="muted">${esc(note || "")}</td></tr>`;
  let html = `<h3>杠杆</h3><table class="tbl"><tr><th>指标</th><th>数值</th><th>说明</th></tr>`;
  html += row("Deuda/Equity（资产负债率的另一种表达）", num2(d.deRatio), "总负债/净资产");
  html += row("Deuda/Activos（资产负债率）", pct1(d.debtAssets), "总负债/总资产");
  html += row("净负债", fmtMoney(d.netDebt), "总负债 − 货币资金（负值=净现金）");
  html += row("净负债 / FCF", num2(d.netDebtFcf), "净负债/自由现金流TTM（负值=净现金）");
  html += naRow("Deuda Neta/EBITDA", na.netDebtEbitda || "无数据");
  html += row("FCF / 总负债", num2(d.fcfToDebt), "自由现金流TTM/总负债，越大偿债能力越强");
  html += row("净负债 / 总资产", pct1(d.netDebtPctAssets), "");
  html += `</table><h3>流动性</h3><table class="tbl"><tr><th>指标</th><th>数值</th><th>说明</th></tr>`;
  html += row("流动比率 Current Ratio", num2(d.currentRatio), "东财直接值（接口返回百分比，已 ÷100）");
  html += naRow("速动比率 Acid Ratio (Quick)", na.quickRatio || "无数据");
  html += naRow("现金比率 Cash Ratio", na.cashRatio || "无数据");
  html += `</table><h3>利息保障</h3><table class="tbl"><tr><th>指标</th><th>数值</th><th>说明</th></tr>`;
  html += row("利息保障倍数", num2(d.interestCoverage), "EBIT/财务费用（仅当财务费用>0）");
  if (d.interestCoverage == null && na.interestCoverage) html += `<tr><td colspan="3" class="muted">${esc(na.interestCoverage)}</td></tr>`;
  html += row("财务费用（TTM）", fmtMoney(d.financeExpenseTtm), "负值=净利息收入");
  html += `</table><h3>债务结构</h3><table class="tbl"><tr><th>指标</th><th>数值</th><th>说明</th></tr>`;
  html += naRow("长期负债 / 净资产", na.longDebtToEquity || "无数据");
  html += `</table>`;
  document.getElementById("debtTable").innerHTML = html;
  // 债务结构
  const liab = m.totalLiab;
  let struct = "";
  if (liab != null) {
    struct = `<table class="tbl"><tr><th>构成</th><th>金额</th><th>占比</th></tr>
      <tr><td>短期借款</td><td class="num">${fmtMoney(d.shortLoan)}</td><td class="num">${liab ? (d.shortLoan / liab * 100).toFixed(1) + "%" : "—"}</td></tr>
      <tr><td>应付账款</td><td class="num">${fmtMoney(d.accPayable)}</td><td class="num">${liab ? (d.accPayable / liab * 100).toFixed(1) + "%" : "—"}</td></tr>
      <tr><td>其他负债（含长期借款等）</td><td class="num">${fmtMoney(d.otherLiab)}</td><td class="num">${liab && d.otherLiab != null ? (d.otherLiab / liab * 100).toFixed(1) + "%" : "—"}</td></tr>
      <tr><td><b>总负债</b></td><td class="num"><b>${fmtMoney(liab)}</b></td><td class="num">100%</td></tr></table>
      <p class="muted" style="margin-top:6px">长期借款未单独披露，归入“其他负债”。</p>`;
  } else struct = `<p class="muted">暂无负债数据。</p>`;
  document.getElementById("debtStruct").innerHTML = struct;
  const hist = d.hist || [];
  document.getElementById("debtHist").innerHTML = hist.length
    ? `<table class="tbl"><tr><th>年份</th><th>总负债（亿）</th><th>净负债（亿）</th><th>货币资金（亿）</th></tr>` +
      [...hist].reverse().slice(0, 10).map((h) =>
        `<tr><td>${h.year}</td><td class="num">${(h.total / 1e8).toFixed(2)}</td><td class="num">${(h.net / 1e8).toFixed(2)}</td><td class="num">${(h.cash / 1e8).toFixed(2)}</td></tr>`).join("") + `</table>`
    : `<p class="muted">暂无债务历史数据。</p>`;
}

// ---------- 成长 ----------
function renderGrowth(data, m, ext) {
  const g = ext.growth || {};
  const na = ext.na || {};
  const fmtCagr = (c) => (c && c.value != null ? (c.value * 100).toFixed(1) + "%" : "—");
  let html = `<table class="tbl"><tr><th>项目</th><th>CAGR 3年</th><th>CAGR 5年</th><th>CAGR 10年</th></tr>`;
  for (const r of (g.rows || [])) {
    html += `<tr><td>${esc(r.label)}</td><td class="num">${fmtCagr(r.cagr3)}</td><td class="num">${fmtCagr(r.cagr5)}</td><td class="num">${fmtCagr(r.cagr10)}</td></tr>`;
  }
  html += naRow("EBITDA", na.growthEbitda || "无数据");
  html += naRow("总股本（Acciones en circulación）", na.growthShares || "无数据");
  html += naRow("未分配利润（Beneficios Retenidos）", na.growthRetained || "无数据");
  html += `</table><p class="muted" style="margin-top:8px">CAGR 按年报口径计算（年末值）；CAPEX 取“购建长期资产支付的现金”年报值。样本不足 3 年时对应格为空。</p>`;
  document.getElementById("growthTable").innerHTML = html;
  const q = g.quarterly || [];
  document.getElementById("growthQuarterly").innerHTML = q.length
    ? `<table class="tbl"><tr><th>报告期</th><th>营收同比</th><th>归母利润同比</th></tr>` +
      q.map((x) => `<tr><td>${esc(x.date)}</td><td class="num ${chgClass(x.revGrowth != null ? x.revGrowth * 100 : 0)}">${x.revGrowth != null ? (x.revGrowth > 0 ? "+" : "") + (x.revGrowth * 100).toFixed(1) + "%" : "—"}</td><td class="num ${chgClass(x.profitGrowth != null ? x.profitGrowth * 100 : 0)}">${x.profitGrowth != null ? (x.profitGrowth > 0 ? "+" : "") + (x.profitGrowth * 100).toFixed(1) + "%" : "—"}</td></tr>`).join("") + `</table>`
    : `<p class="muted">暂无季度增速数据。</p>`;
}

// ---------- 分红 ----------
function renderDividend(data, m, ext) {
  const dv = ext.dividend || {};
  const na = ext.na || {};
  const fmtC = (c) => (c && c.value != null ? (c.value * 100).toFixed(1) + "%（" + c.from + "→" + c.to + "）" : "—");
  const items = [
    ["股息率", m.divYield != null ? m.divYield.toFixed(2) + "%" : "—", m.divYieldEm != null ? "东财" : "近12月派息/现价"],
    ["Payout / EPS", m.payout != null ? fmtPct(m.payout, 0) : "—", "近12月派息/EPS(TTM)"],
    ["Payout / FCF", dv.payoutFcf != null ? fmtPct(dv.payoutFcf, 0) : "—", "近12月派息总额/自由现金流TTM"],
    ["连续分红年数", dv.yearsPaying != null ? dv.yearsPaying + " 年" : "—", "有派息记录的年份数"],
    ["连续增长年数", dv.consecGrowthYears != null ? dv.consecGrowthYears + " 年" : "—", "年末派息连续递增的年数"],
    ["DPS CAGR 3年", fmtC(dv.cagr3), "每股派息复合增速"],
    ["DPS CAGR 5年", fmtC(dv.cagr5), ""],
    ["DPS CAGR 10年", fmtC(dv.cagr10), ""],
    ["派息频率", dv.frequency || "—", "按除息日间隔估算"],
    ["最近除息日", dv.lastExDate || "—", dv.lastPlan || ""],
  ];
  document.getElementById("divMetrics").innerHTML =
    `<div class="metrics">` + items.map(([k, v, s]) => metricCard(k, v, s)).join("") + `</div>
     <p class="muted" style="margin-top:8px">Weiss 公允价值区间：<span class="badge">暂不可用</span> ${esc(na.weiss || "")}</p>`;
}
function drawDividend() {
  const data = currentData;
  const rows = (data && data.dividends) || [];
  const canvas = document.getElementById("divChart");
  const tbl = document.getElementById("divTable");
  if (!rows.length) {
    tbl.innerHTML = `<p class="muted">暂无分红记录（该标的未分红，或接口本次未返回${data && data.errors && data.errors.dividends ? "：" + esc(data.errors.dividends) : ""}）。</p>`;
    const ctx = canvas.getContext("2d"); ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const byYear = {};
  for (const r of rows) {
    const y = String(r.EX_DIVIDEND_DATE || "").slice(0, 4);
    if (!y) continue;
    byYear[y] = (byYear[y] || 0) + num(r.PRETAX_BONUS_RMB);
  }
  const years = Object.keys(byYear).sort().slice(-10);
  drawBars(canvas, years.map((y) => ({ label: y, v1: byYear[y] })), { label1: "每 10 股派息（元，税前）" });
  tbl.innerHTML = `<table class="tbl"><tr><th>除权除息日</th><th>方案</th><th>每 10 股派息（元）</th><th>每 10 股送股</th><th>每 10 股转增</th><th>进度</th></tr>` +
    rows.slice(0, 15).map((r) =>
      `<tr><td>${esc((r.EX_DIVIDEND_DATE || "").slice(0, 10))}</td><td>${esc(r.IMPL_PLAN_PROFILE || "—")}</td><td class="num">${r.PRETAX_BONUS_RMB != null ? Number(r.PRETAX_BONUS_RMB).toFixed(2) : "—"}</td><td class="num">${r.BONUS_RATIO != null ? r.BONUS_RATIO : "—"}</td><td class="num">${r.IT_RATIO != null ? r.IT_RATIO : "—"}</td><td>${esc(r.ASSIGN_PROGRESS || "—")}</td></tr>`).join("") + `</table>`;
}

// ---------- 技术 ----------
function drawTech() {
  const canvas = document.getElementById("klineChart");
  if (!currentData) return;
  const kl = currentKlt === 101 ? currentData.klineD : currentKlt === 102 ? currentData.klineW : currentData.klineM;
  const ext = currentExt;
  if (!kl) {
    document.getElementById("klineNote").textContent = "K 线暂不可用（" + esc((currentData.errors || {}).klineD || "接口未返回") + "）";
    return;
  }
  document.getElementById("klineNote").textContent =
    "共 " + kl.length + " 根 · 区间 " + kl[0].date + " 至 " + kl[kl.length - 1].date
    + " · 前复权 · 来源：" + (kl.source === "tencent" ? "腾讯 fqkline（等差前复权口径，近 2 年窗口失真很小）" : "东财 push2his（等比前复权）");
  if (currentKlt === 101 && ext && ext.technical && ext.technical.bollSeries) {
    drawKlineOverlay(canvas, kl, ext.technical);
  } else {
    drawKline(canvas, kl, { limit: currentKlt === 101 ? 180 : 200 });
  }
  // 振荡指标
  const t = ext && ext.technical;
  if (t) {
    const klD = currentData.klineD || [];
    const n = klD.length;
    const slice = (arr) => (arr ? arr.slice(-Math.min(180, arr.length)) : []);
    drawOscillator(document.getElementById("rsiChart"), slice(t.rsiSeries), { label: "RSI(14)", over: 70, under: 30, min: 0, max: 100, color: "#8b5cf6" });
    drawMACD(document.getElementById("macdChart"), slice(t.macd.difSeries), slice(t.macd.deaSeries));
    drawOscillator(document.getElementById("stochChart"), slice(t.stochKSeries), { label: "KD %K", over: 80, under: 20, min: 0, max: 100, color: "#2b6cb0", extra: slice(t.stochDSeries), extraColor: "#f59e0b" });
    // 技术指标表
    const row = (label, value, note) => `<tr><td>${esc(label)}</td><td class="num">${esc(value)}</td><td style="text-align:left" class="muted">${esc(note || "")}</td></tr>`;
    let html = `<table class="tbl"><tr><th>指标</th><th>数值</th><th>说明</th></tr>`;
    html += row("RSI(14)", t.rsi != null ? t.rsi.toFixed(1) : "—", t.rsi != null ? (t.rsi >= 70 ? "超买" : t.rsi <= 30 ? "超卖" : "中性") : "");
    html += row("MACD DIF / DEA / 柱", (t.macd.dif != null ? t.macd.dif.toFixed(2) : "—") + " / " + (t.macd.dea != null ? t.macd.dea.toFixed(2) : "—") + " / " + (t.macd.hist != null ? t.macd.hist.toFixed(2) : "—"), "DIF>DEA 为多头");
    html += row("ADX(14)", t.adx ? t.adx.adx.toFixed(1) : "—", t.adx ? "+DI " + t.adx.plusDI.toFixed(1) + " / −DI " + t.adx.minusDI.toFixed(1) + "；ADX>25 趋势强" : "");
    html += row("随机指标 %K / %D", (t.stoch.k != null ? t.stoch.k.toFixed(1) : "—") + " / " + (t.stoch.d != null ? t.stoch.d.toFixed(1) : "—"), "80 以上超买，20 以下超卖");
    html += row("Williams %R(14)", t.williams != null ? t.williams.toFixed(1) : "—", "−20 以上超买，−80 以下超卖");
    html += row("MA5 / MA10 / MA20", num2(t.ma5) + " / " + num2(t.ma10) + " / " + num2(t.ma20), "");
    html += row("MA50 / MA60 / MA120", num2(t.ma50) + " / " + num2(t.ma60) + " / " + num2(t.ma120), "");
    html += row("MA200 / MA250", num2(t.ma200) + " / " + num2(t.ma250), "");
    html += row("MA1000", num2(t.ma1000), t.ma1000 == null ? (ext.na.ma1000 || "") : "");
    html += row("布林带 上/中/下", num2(t.bollUp) + " / " + num2(t.bollMid) + " / " + num2(t.bollLow), "Bollinger(20,2)");
    html += `</table>`;
    document.getElementById("techTable").innerHTML = html;
    document.getElementById("techSignals").innerHTML =
      `<p><b>综合倾向：${esc(t.trend || "—")}</b></p>` +
      `<p>${(t.signals || []).map((s) => `<span class="tag">${esc(s)}</span>`).join(" ")}</p>` +
      `<table class="tbl" style="margin-top:10px"><tr><th>关键价位</th><th>数值</th></tr>
      <tr><td>近 60 日阻力（最高）</td><td class="num">${num2(t.resist60)}</td></tr>
      <tr><td>近 60 日支撑（最低）</td><td class="num">${num2(t.support60)}</td></tr>
      <tr><td>52 周最高 / 最低</td><td class="num">${num2(t.high52)} / ${num2(t.low52)}</td></tr></table>` +
      `<p class="muted" style="margin-top:10px">胜率证据：RSI(14)&lt;30 是胜率方法库第 1 名（Piotroski F≥7 + RSI&lt;30，A股季度胜率 53.4%）的入场条件之一，单用超卖抄底无胜率证据；RSI(2)&lt;10 短期超卖交易胜率 71.4%，但近期复现未通过门槛，置信度已下调。技术信号本身不附胜率——图型信号的实测胜率（阳包阴 36.3%、单针探底 47.1% 等，附盈利因子与期望）见「胜率方法库 · 本站实测」。</p>`;
  }
}

// ---------- 历史演变 ----------
function drawHistoryExt() {
  drawHistory();
  const ext = currentExt, data = currentData;
  if (!ext || !data) return;
  const m = currentMetrics;
  // 资产负债结构
  const bal = data.balance || [];
  const balAnn = annualRows(bal).slice(-10);
  document.getElementById("histBalance").innerHTML = balAnn.length
    ? `<table class="tbl"><tr><th>年份</th><th>总资产（亿）</th><th>总负债（亿）</th><th>净资产（亿）</th><th>货币资金（亿）</th><th>存货（亿）</th><th>应收账款（亿）</th><th>固定资产（亿）</th></tr>` +
      [...balAnn].reverse().map((r) =>
        `<tr><td>${reportYear(dateField(r))}</td><td class="num">${(num(r.TOTAL_ASSETS) / 1e8).toFixed(2)}</td><td class="num">${(num(r.TOTAL_LIABILITIES) / 1e8).toFixed(2)}</td><td class="num">${(num(r.TOTAL_EQUITY) / 1e8).toFixed(2)}</td><td class="num">${(num(r.MONETARYFUNDS) / 1e8).toFixed(2)}</td><td class="num">${(num(r.INVENTORY) / 1e8).toFixed(2)}</td><td class="num">${(num(r.ACCOUNTS_RECE) / 1e8).toFixed(2)}</td><td class="num">${(num(r.FIXED_ASSET) / 1e8).toFixed(2)}</td></tr>`).join("") + `</table>`
    : `<p class="muted">暂无资产负债历史数据。</p>`;
  // 现金流结构
  const cf = data.cashflow || [];
  const cfAnn = annualRows(cf).slice(-10);
  document.getElementById("histCashflow").innerHTML = cfAnn.length
    ? `<table class="tbl"><tr><th>年份</th><th>经营（亿）</th><th>投资（亿）</th><th>筹资（亿）</th><th>自由现金流（亿）</th><th>CAPEX（亿）</th></tr>` +
      [...cfAnn].reverse().map((r) => {
        const fcf = num(r.NETCASH_OPERATE) + num(r.NETCASH_INVEST);
        return `<tr><td>${reportYear(dateField(r))}</td><td class="num">${(num(r.NETCASH_OPERATE) / 1e8).toFixed(2)}</td><td class="num">${(num(r.NETCASH_INVEST) / 1e8).toFixed(2)}</td><td class="num">${(num(r.NETCASH_FINANCE) / 1e8).toFixed(2)}</td><td class="num">${(fcf / 1e8).toFixed(2)}</td><td class="num">${(num(r.CONSTRUCT_LONG_ASSET) / 1e8).toFixed(2)}</td></tr>`;
      }).join("") + `</table>`
    : `<p class="muted">暂无现金流历史数据。</p>`;
  // 每股指标
  const inc = data.income || [];
  const incAnn = annualRows(inc).slice(-10);
  const divByYear = {};
  (data.dividends || []).forEach((r) => {
    const y = String(r.EX_DIVIDEND_DATE || "").slice(0, 4);
    if (y) divByYear[y] = (divByYear[y] || 0) + num(r.PRETAX_BONUS_RMB) / 10;
  });
  document.getElementById("histPerShare").innerHTML = incAnn.length
    ? `<table class="tbl"><tr><th>年份</th><th>EPS（元）</th><th>扣非 EPS（元）</th><th>每股净资产（元）</th><th>每股经营现金流（元）</th><th>每股派息（元）</th></tr>` +
      [...incAnn].reverse().map((r) => {
        const y = reportYear(dateField(r));
        return `<tr><td>${y}</td><td class="num">${num2(num(r.BASIC_EPS))}</td><td class="num">${num2(num(r.DEDUCT_BASIC_EPS))}</td><td class="num">${num2(num(r.BPS))}</td><td class="num">${num2(num(r.MGJYXJJE))}</td><td class="num">${divByYear[y] != null ? divByYear[y].toFixed(2) : "—"}</td></tr>`;
      }).join("") + `</table>
      <p class="muted" style="margin-top:8px">回购（Recompras）：<span class="badge">暂不可用</span> 回购数据未从公开接口获得。营运资本（WC）：<span class="badge">暂不可用</span> 流动资产/流动负债未单独披露。</p>`
    : `<p class="muted">暂无每股指标历史数据。</p>`;
}
function drawHistory() {
  const canvas = document.getElementById("histChart");
  const m = currentMetrics;
  if (!m || !m.annual || !m.annual.length) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    document.getElementById("histTable").innerHTML = `<p class="muted">暂无年报历史数据。</p>`;
    return;
  }
  drawBars(canvas, m.annual.map((a) => ({ label: String(a.year), v1: a.revenue / 1e8, v2: a.profit / 1e8 })), { label1: "营收（亿）", label2: "归母利润（亿）" });
  document.getElementById("histTable").innerHTML =
    `<table class="tbl"><tr><th>年份</th><th>营收（亿）</th><th>归母利润（亿）</th><th>EPS（元）</th><th>营收同比</th><th>利润同比</th></tr>` +
    [...m.annual].reverse().map((a, i, arr) => {
      const prev = arr[i + 1];
      const rg = prev && prev.revenue ? (a.revenue - prev.revenue) / Math.abs(prev.revenue) * 100 : null;
      const pg = prev && prev.profit ? (a.profit - prev.profit) / Math.abs(prev.profit) * 100 : null;
      return `<tr><td>${a.year}</td><td class="num">${(a.revenue / 1e8).toFixed(2)}</td><td class="num">${(a.profit / 1e8).toFixed(2)}</td><td class="num">${a.eps.toFixed(2)}</td><td class="num ${chgClass(rg)}">${rg != null ? (rg > 0 ? "+" : "") + rg.toFixed(1) + "%" : "—"}</td><td class="num ${chgClass(pg)}">${pg != null ? (pg > 0 ? "+" : "") + pg.toFixed(1) + "%" : "—"}</td></tr>`;
    }).join("") + `</table>`;
}

// ---------- 价格与回撤 ----------
function drawDrawdownPane() {
  const kl = currentData && currentData.klineD;
  const canvas = document.getElementById("ddChart");
  const ext = currentExt;
  if (!kl || !kl.length) {
    document.getElementById("ddStats").innerHTML = `<p class="muted">暂无 K 线数据。</p>`;
    document.getElementById("ddDetail").innerHTML = "";
    return;
  }
  drawDrawdown(canvas, kl);
  const d = ext && ext.drawdown;
  if (!d || d.maxDrawdown == null) {
    document.getElementById("ddStats").innerHTML = `<p class="muted">回撤统计暂不可用。</p>`;
    return;
  }
  const stats = [
    ["区间最大回撤", (d.maxDrawdown * 100).toFixed(1) + "%", "近 " + d.days + " 个交易日"],
    ["当前回撤", (d.currentDrawdown * 100).toFixed(1) + "%", "自区间高点"],
    ["平均回撤", (d.avgDrawdown * 100).toFixed(1) + "%", "全部交易日均值"],
    ["水下时间占比", (d.timeUnderwater * 100).toFixed(0) + "%", "低于历史高点的天数占比"],
    ["年化波动率", (d.annualVol * 100).toFixed(1) + "%", "日收益标准差×√250"],
    ["Calmar 比率", d.calmar != null ? d.calmar.toFixed(2) : "—", "年化收益/最大回撤"],
    ["Sharpe（简化，rf=0）", d.sharpe != null ? d.sharpe.toFixed(2) : "—", "年化收益/年化波动"],
    ["区间总回报", (d.periodReturn * 100).toFixed(1) + "%", ""],
    ["年化回报", (d.annualReturn * 100).toFixed(1) + "%", ""],
    ["最长连续下跌", d.maxDownDays + " 天", ""],
  ];
  document.getElementById("ddStats").innerHTML = stats.map(([k, v, s]) => metricCard(k, v, s)).join("");
  document.getElementById("ddDetail").innerHTML =
    `<table class="tbl"><tr><th>项目</th><th>数值</th></tr>
    <tr><td>最大回撤峰值日</td><td>${esc(d.peakDate || "—")}</td></tr>
    <tr><td>最大回撤谷底日</td><td>${esc(d.troughDate || "—")}</td></tr>
    <tr><td>恢复天数（谷底到收复峰值）</td><td>${d.recoveryDays != null ? d.recoveryDays + " 天" : "未收复"}</td></tr></table>`;
}

// ---------- 财报 ----------
function finTable(title, rows, cols, dateKey) {
  if (!rows || !rows.length) return `<h3>${title}</h3><p class="muted">暂无数据（该标的可能不披露此表，或接口本次未返回）。</p>`;
  const head = `<tr><th>报告期</th>` + cols.map((c) => `<th>${c.label}</th>`).join("") + `</tr>`;
  const body = rows.slice(0, 12).map((r) => {
    const d = (r[dateKey] || "").slice(0, 10);
    return `<tr><td>${esc(d)}</td>` + cols.map((c) => `<td class="num">${fmtMoney(num(r[c.field]))}</td>`).join("") + `</tr>`;
  }).join("");
  return `<h3>${title}</h3><table class="tbl">${head}${body}</table>`;
}
function renderEarnings(data) {
  const el = document.getElementById("earningsBody");
  let html = "";
  html += finTable("利润表（元）", data.income, [
    { label: "营业总收入", field: "TOTAL_OPERATE_INCOME" },
    { label: "归母净利润", field: "PARENT_NETPROFIT" },
    { label: "基本 EPS（元）", field: "BASIC_EPS" },
  ], "REPORTDATE");
  html += finTable("利润表补充（元，DMSK 全口径）", data.incomeFull, [
    { label: "营业成本", field: "OPERATE_COST" },
    { label: "营业利润", field: "OPERATE_PROFIT" },
    { label: "利润总额", field: "TOTAL_PROFIT" },
    { label: "扣非归母净利润", field: "DEDUCT_PARENT_NETPROFIT" },
    { label: "财务费用", field: "FINANCE_EXPENSE" },
  ], "REPORT_DATE");
  html += finTable("资产负债表（元）", data.balance, [
    { label: "总资产", field: "TOTAL_ASSETS" },
    { label: "总负债", field: "TOTAL_LIABILITIES" },
    { label: "净资产", field: "TOTAL_EQUITY" },
    { label: "货币资金", field: "MONETARYFUNDS" },
    { label: "存货", field: "INVENTORY" },
  ], "REPORT_DATE");
  html += finTable("现金流量表（元）", data.cashflow, [
    { label: "经营现金流净额", field: "NETCASH_OPERATE" },
    { label: "投资现金流净额", field: "NETCASH_INVEST" },
    { label: "筹资现金流净额", field: "NETCASH_FINANCE" },
    { label: "CAPEX（购建长期资产）", field: "CONSTRUCT_LONG_ASSET" },
  ], "REPORT_DATE");
  if (data.errors && (data.errors.income || data.errors.balance || data.errors.cashflow)) {
    html = `<div class="err-box">部分财报表接口本次未返回：${esc(Object.entries(data.errors).filter(([k]) => ["income", "balance", "cashflow"].includes(k)).map(([, v]) => v).join("；"))}</div>` + html;
  }
  el.innerHTML = html;
}

// ---------- 预期 ----------
function renderForecast(data, m, ext) {
  const el = document.getElementById("forecastBody");
  const rows = data.forecast || [];
  if (!rows.length) {
    el.innerHTML = `<p class="muted">暂无业绩预告（该公司近期未发布预告，或接口本次未返回${data.errors && data.errors.forecast ? "：" + esc(data.errors.forecast) : ""}）。</p>`;
  } else {
    el.innerHTML = rows.map((r) => {
      const amp = (r.ADD_AMP_LOWER != null || r.ADD_AMP_UPPER != null)
        ? "预计增长 " + (r.ADD_AMP_LOWER != null ? Number(r.ADD_AMP_LOWER).toFixed(1) + "%" : "—") + " ~ " + (r.ADD_AMP_UPPER != null ? Number(r.ADD_AMP_UPPER).toFixed(1) + "%" : "—")
        : (r.PREDICT_AMT_LOWER != null || r.PREDICT_AMT_UPPER != null)
          ? "预计金额 " + fmtMoney(num(r.PREDICT_AMT_LOWER)) + " ~ " + fmtMoney(num(r.PREDICT_AMT_UPPER))
          : "";
      return `<div class="fc-item">
        <div><b>${esc((r.NOTICE_DATE || "").slice(0, 10))}</b> · 报告期 ${(r.REPORT_DATE || "").slice(0, 10)}
        <span class="badge">${esc(r.PREDICT_TYPE || "预告")}</span></div>
        <div class="muted">${esc(r.PREDICT_FINANCE || "")} ${esc(amp)}</div>
        <div style="margin-top:4px">${esc((r.PREDICT_CONTENT || "").slice(0, 300))}</div>
      </div>`;
    }).join("");
  }
  // 历史 PE
  const pe = ext.peHistory || {};
  document.getElementById("peHistTable").innerHTML = (pe.rows && pe.rows.length)
    ? `<table class="tbl"><tr><th>年份</th><th>年末收盘（前复权）</th><th>当年 EPS（元）</th><th>PE</th></tr>` +
      [...pe.rows].reverse().map((r) => `<tr><td>${r.year}</td><td class="num">${r.close.toFixed(2)}</td><td class="num">${r.eps.toFixed(2)}</td><td class="num">${r.pe.toFixed(1)}</td></tr>`).join("") + `</table>
      <p class="muted" style="margin-top:8px">PE 中位数：近 5 年 ${pe.median5 != null ? pe.median5.toFixed(1) : "—"} · 近 10 年 ${pe.median10 != null ? pe.median10.toFixed(1) : "—"} · 当前 PE-TTM ${m.peTtm != null ? m.peTtm.toFixed(1) : "—"}</p>`
    : `<p class="muted">历史 PE 暂不可用（${esc(ext.na.peHist || "无年报 EPS 或年末收盘价")}）。</p>`;
  document.getElementById("consensusNote").innerHTML =
    `<p class="muted">分析师一致预期（目标价、EPS/营收/EBITDA 预期、预期明细、实际 vs 预期）：<span class="badge">暂不可用</span> A 股无公开一致预期数据源（东财/腾讯免费接口不提供分析师一致预期）；上方的业绩预告是 A 股对应的官方预期披露。</p>`;
}

// ---------- 行业 ----------
function renderSector(data, m, ext) {
  const q = data.quote || {};
  const cyc = ext.cyclicality || {};
  document.getElementById("sectorBody").innerHTML =
    `<table class="tbl"><tr><th>项目</th><th>内容</th></tr>
    <tr><td>所属行业</td><td style="text-align:left">${esc(m.industry || "—")}</td></tr>
    <tr><td>地域板块</td><td style="text-align:left">${esc(q.region || "—")}</td></tr>
    <tr><td>概念/题材</td><td style="text-align:left">${esc(m.concepts || "—")}</td></tr>
    <tr><td>总市值</td><td class="num">${fmtMoney(m.totalMcap)}</td></tr>
    <tr><td>PE-TTM / PB</td><td class="num">${num2(m.peTtm)} / ${num2(m.pb)}</td></tr>
    <tr><td>ROE（TTM）</td><td class="num">${pct1(m.roe)}</td></tr>
    <tr><td>股息率</td><td class="num">${m.divYield != null ? m.divYield.toFixed(2) + "%" : "—"}</td></tr></table>
    <p class="muted" style="margin-top:10px">行业内同行对比（公司 vs 行业中位数、行业 PER vs 历史中位数）：<span class="badge">暂不可用</span> 行业成分股名单与行业汇总数据未从东财/腾讯免费接口获得。作为替代，下方“行业及其历史”给出行业指数走势与年度回报；“周期性”给出 vs 沪深300 的 Beta 与相对表现。</p>`;
}

// ---------- 周期性 ----------
function renderCyclicality(data, m, ext) {
  const c = ext.cyclicality || {};
  const na = ext.na || {};
  if (c.beta == null) {
    document.getElementById("cycBody").innerHTML = `<p class="muted">周期性暂不可用：${esc(na.beta || "数据不足")}。</p>`;
    return;
  }
  document.getElementById("cycBody").innerHTML =
    `<div class="metrics">` +
    metricCard("Beta vs 沪深300", c.beta.toFixed(2), "近 " + c.days + " 个交易日") +
    metricCard("相关系数", c.corr != null ? c.corr.toFixed(2) : "—", "与沪深300日收益") +
    metricCard("个股同期回报", pct1(c.stockReturn), "与 Beta 同窗口") +
    metricCard("沪深300同期回报", pct1(c.indexReturn), "") +
    metricCard("相对表现", (c.relativeReturn != null ? (c.relativeReturn >= 0 ? "+" : "") + (c.relativeReturn * 100).toFixed(1) + "%" : "—"), "个股 − 沪深300") +
    `</div><p style="margin-top:10px"><b>${esc(c.verdict || "")}</b></p>
    <p class="muted">Beta>1 表示比大盘波动大（进攻/周期性强），Beta<1 表示比大盘波动小（偏防御）。按日收益回归计算，窗口为最近约 1 年可对齐的交易日。</p>`;
}

// ---------- 日历 ----------
async function renderCalendar(data) {
  const el = document.getElementById("calBody");
  const mine = (data.calendar || []).slice().sort((a, b) => String(a.FIRST_APPOINT_DATE || "").localeCompare(String(b.FIRST_APPOINT_DATE || "")));
  let html = "";
  if (mine.length) {
    html += `<h3>该公司 · 预约与发布</h3>` + mine.map((r) => {
      const done = r.IS_PUBLISH === "1" || r.IS_PUBLISH === 1;
      return `<div class="cal-item"><span class="d">${esc((r.FIRST_APPOINT_DATE || "").slice(0, 10))}</span> ${esc(r.REPORT_TYPE_NAME || "")}
        <span class="badge ${done ? "done" : "soon"}">${done ? "已发布" + (r.ACTUAL_PUBLISH_DATE ? "（" + String(r.ACTUAL_PUBLISH_DATE).slice(0, 10) + "）" : "") : "待披露" + (r.RESIDUAL_DAYS != null ? " · 还剩 " + r.RESIDUAL_DAYS + " 天" : "")}</span></div>`;
    }).join("");
  } else {
    html += `<p class="muted">该公司预约披露数据暂不可用${data.errors && data.errors.calendar ? "：" + esc(data.errors.calendar) : ""}。</p>`;
  }
  try {
    const upcoming = await fetchUpcomingCalendar(40);
    const mineCodes = new Set(watchlist.map((s) => s.code));
    const filtered = upcoming.filter((r) => mineCodes.has(r.SECURITY_CODE));
    html += `<h3>自选股 · 近期待披露</h3>`;
    if (filtered.length) {
      html += filtered.slice(0, 15).map((r) =>
        `<div class="cal-item"><span class="d">${esc((r.FIRST_APPOINT_DATE || "").slice(0, 10))}</span> <a href="#" data-cal-code="${esc(r.SECURITY_CODE)}">${esc(r.SECURITY_NAME_ABBR || r.SECURITY_CODE)}</a> ${esc(r.REPORT_TYPE_NAME || "")}
        <span class="badge soon">还剩 ${r.RESIDUAL_DAYS != null ? r.RESIDUAL_DAYS + " 天" : "—"}</span></div>`).join("");
      el.innerHTML = html;
      el.querySelectorAll("[data-cal-code]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); loadStock(a.dataset.calCode); }));
    } else {
      html += `<p class="muted">自选股近期无待披露财报。</p>`;
      el.innerHTML = html;
    }
  } catch (e) {
    html += `<p class="muted">自选股待披露日历暂不可用（${esc(e.message || e)}）。</p>`;
    el.innerHTML = html;
  }
}

// ============================================================
// 新增模块渲染（2026-11-09，AleInversor 缺失模块补齐）
// ============================================================
function shareBar(pct) {
  const w = Math.max(0, Math.min(100, (pct || 0) * 100));
  return `<div class="dim-bar"><i style="width:${w.toFixed(1)}%"></i></div>`;
}

// ---------- 关键绩效指标 ----------
function renderKpi(data, m, ext) {
  const el = document.getElementById("kpiBody");
  const v = ext.valuation || {}, p = ext.profitability || {}, d = ext.debt || {};
  const row = (label, value, note) => `<tr><td>${esc(label)}</td><td class="num">${esc(value)}</td><td style="text-align:left" class="muted">${esc(note || "")}</td></tr>`;
  let html = "";
  html += `<h3>估值</h3><table class="tbl"><tr><th>指标</th><th>数值</th><th>说明</th></tr>`;
  html += row("PS（市销率）", num2(v.ps), "总市值 / 营收 TTM");
  html += row("P/FCF", num2(v.pFcf), "总市值 / 自由现金流 TTM");
  html += row("EV/EBIT", num2(v.evEbit), "EV / EBIT（TTM）");
  html += row("EV/FCF", num2(v.evFcf), "EV / 自由现金流 TTM");
  html += row("EV/营收", num2(v.evSales), "EV / 营收 TTM");
  html += row("盈利率 Earnings Yield", v.earnYield != null ? v.earnYield.toFixed(2) + "%" : "—", "1 / PE-TTM");
  html += row("FCF 收益率", v.fcfYield != null ? v.fcfYield.toFixed(2) + "%" : "—", "FCF(TTM) / 总市值");
  html += row("PEG", num2(v.peg), "PE-TTM / 利润 TTM 同比增速（%）");
  html += `</table><h3>盈利与回报</h3><table class="tbl"><tr><th>指标</th><th>数值</th><th>说明</th></tr>`;
  html += row("毛利率（TTM）", pct1(p.grossMargin), "");
  html += row("EBIT 利润率（TTM）", pct1(p.ebitMargin), "");
  html += row("净利率（TTM）", pct1(p.netMargin), "");
  html += row("FCF 利润率（TTM）", pct1(p.fcfMargin), "");
  html += row("ROE（TTM）", pct1(m.roe), "");
  html += row("ROA（TTM）", pct1(p.roa), "");
  html += row("ROIC（TTM）", pct1(p.roic), "NOPAT / 投入资本（代理口径）");
  html += row("ROCE（TTM）", pct1(p.roce), "EBIT / 投入资本（代理口径）");
  html += row("ROE 五年中位数", pct1(p.roeMedian5), "年报加权 ROE");
  html += row("ROIC 五年中位数", pct1(p.roicMedian5), "年报口径");
  html += row("ROCE 五年中位数", pct1(p.roceMedian5), "年报口径");
  html += `</table><h3>负债与偿债</h3><table class="tbl"><tr><th>指标</th><th>数值</th><th>说明</th></tr>`;
  html += row("资产负债率", pct1(m.debtRatio), "最新一期");
  html += row("总负债 / 净资产", num2(d.deRatio), "");
  html += row("净负债", fmtMoney(d.netDebt), "总负债 − 货币资金（负值=净现金）");
  html += row("净负债 / FCF", num2(d.netDebtFcf), "");
  html += row("FCF / 总负债", num2(d.fcfToDebt), "");
  html += row("流动比率", num2(d.currentRatio), "");
  html += row("利息保障倍数", num2(d.interestCoverage), "EBIT / 财务费用（仅当财务费用>0）");
  html += `</table><p class="muted" style="margin-top:8px">EV/EBITDA、速动比率、现金比率暂不可用（折旧摊销与流动资产/负债未单独披露），原因见估值/负债页。全部指标口径见“打分指南”。</p>`;
  el.innerHTML = html;
}

// ---------- 业务分部 ----------
function renderSegments(data) {
  const el = document.getElementById("segmentsBody");
  const rows = data.mainop || [];
  if (data.errors && data.errors.mainop) {
    el.innerHTML = `<p class="muted">主营构成暂不可用（${esc(data.errors.mainop)}）。</p>`;
    return;
  }
  if (!rows.length) {
    el.innerHTML = `<p class="muted">暂无主营构成数据（该标的无 F10 主营构成记录，如 ETF；或接口本次未返回）。</p>`;
    return;
  }
  const latestDate = rows.map((r) => String(r.REPORT_DATE || "").slice(0, 10)).sort().reverse()[0];
  const latest = rows.filter((r) => String(r.REPORT_DATE || "").slice(0, 10) === latestDate);
  const typeName = { 1: "按行业", 2: "按产品", 3: "按地区" };
  let html = `<p class="muted" style="margin-bottom:10px">报告期：${esc(latestDate)} · 数据：东财 F10 主营构成（RPT_F10_FN_MAINOP）</p>`;
  const groups = {};
  for (const r of latest) {
    const t = Number(r.MAINOP_TYPE);
    if (!groups[t]) groups[t] = [];
    groups[t].push(r);
  }
  for (const t of Object.keys(groups).map(Number).sort()) {
    const items = groups[t].slice().sort((a, b) => num(b.MAIN_BUSINESS_INCOME) - num(a.MAIN_BUSINESS_INCOME));
    html += `<h3>${esc(typeName[t] || "其他")}</h3><table class="tbl"><tr><th>构成</th><th>营业收入</th><th>收入占比</th><th>营业利润</th><th>利润占比</th><th>毛利率</th></tr>`;
    for (const r of items) {
      const revShare = r.MBI_RATIO != null ? num(r.MBI_RATIO) : null;
      const profShare = r.MBR_RATIO != null ? num(r.MBR_RATIO) : null;
      const dash = "—";
      html += `<tr><td>${esc(r.ITEM_NAME || "—")}</td><td class="num">${r.MAIN_BUSINESS_INCOME != null ? fmtMoney(num(r.MAIN_BUSINESS_INCOME)) : dash}</td><td class="num">${revShare != null ? (revShare * 100).toFixed(1) + "%" : dash}</td><td class="num">${r.MAIN_BUSINESS_RPOFIT != null ? fmtMoney(num(r.MAIN_BUSINESS_RPOFIT)) : dash}</td><td class="num">${profShare != null ? (profShare * 100).toFixed(1) + "%" : dash}</td><td class="num">${r.GROSS_RPOFIT_RATIO != null ? (num(r.GROSS_RPOFIT_RATIO) * 100).toFixed(1) + "%" : dash}</td></tr>`;
      if (revShare != null) html += `<tr><td colspan="6" style="padding-top:0;border-bottom:1px solid var(--line)">${shareBar(revShare)}</td></tr>`;
    }
    html += `</table>`;
  }
  el.innerHTML = html;
}

// ---------- 季节性 ----------
function renderSeasonality(data) {
  const el = document.getElementById("seasonalityBody");
  const s = calcSeasonality(data);
  if (!s.usable) {
    el.innerHTML = `<p class="muted">季节性暂不可用：${esc(s.reason)}。</p>`;
    return;
  }
  const pct = (v) => (v == null ? "—" : (v * 100).toFixed(1) + "%");
  let html = `<p style="margin-bottom:10px"><b>${esc(s.verdict)}</b></p>`;
  html += `<table class="tbl"><tr><th>年份</th><th>Q1 营收占比</th><th>Q2 营收占比</th><th>Q3 营收占比</th><th>Q4 营收占比</th><th>Q1 利润占比</th><th>Q2 利润占比</th><th>Q3 利润占比</th><th>Q4 利润占比</th></tr>`;
  for (const y of [...s.years].reverse()) {
    html += `<tr><td>${y.year}</td>` +
      y.revShares.map((v) => `<td class="num">${pct(v)}</td>`).join("") +
      y.profShares.map((v) => `<td class="num">${pct(v)}</td>`).join("") + `</tr>`;
  }
  if (s.avgRev) {
    html += `<tr><td><b>近 5 年平均</b></td>` +
      s.avgRev.map((v) => `<td class="num"><b>${pct(v)}</b></td>`).join("") +
      (s.avgProf || [null, null, null, null]).map((v) => `<td class="num"><b>${pct(v)}</b></td>`).join("") + `</tr>`;
  }
  html += `</table><p class="muted" style="margin-top:8px">算法：季报行是年内累计值，单季度 = 本期累计 − 上期累计（Q1 即一季度累计）。利润占比可能为负或超过 100%（个别季度亏损或费用集中确认），属正常现象。样本：${s.years.length} 个完整年份。</p>`;
  el.innerHTML = html;
}

// ---------- 机构持仓 ----------
function renderHolders(data) {
  const el = document.getElementById("holdersBody");
  const mkt = txMarket(currentCode);
  const emUrl = "https://quote.eastmoney.com/" + mkt + currentCode + ".html";
  el.innerHTML =
    `<p>十大股东、十大流通股东、基金持仓与机构持股比例：<span class="badge">暂不可用</span></p>
     <p class="muted" style="margin-top:8px">原因（2026-11-09 实测）：东财 F10 十大股东接口（emweb.securities.eastmoney.com/PC_HSF10/ShareholderResearch/PageAjax，内含十大股东 sdgd、十大流通股东 sdltgd、股东户数 gdrs、基金持仓 jjcg、机构持股汇总 jgcc）curl 能返回数据，但响应不带 Access-Control-Allow-Origin，浏览器 fetch 会被 CORS 拦截，纯静态站无法直接调用；东财数据中心没有十大股东/基金持仓表（RPT_F10_MAIN_HOLDER、RPT_FUND_HOLD_STOCK、RPT_MUTUAL_HOLD_STOCK 均报“报表配置不存在”）；雪球持仓接口对本机出口 IP 返回 403 且需登录态。本站不造数据、不放过时快照。</p>
     <p style="margin-top:10px">手动查看：<a href="${emUrl}" target="_blank" rel="noopener">东财个股页（F10 → 股东研究）</a> · <a href="https://www.cninfo.com.cn/new/index" target="_blank" rel="noopener">巨潮资讯</a></p>
     <p class="muted" style="margin-top:8px">若日后东财放开该接口 CORS 或找到新的免费浏览器源，本页会直接接回十大股东表（含社保/QFII/知名公募私募/牛散标注）。</p>`;
}

// ---------- 分析师 ----------
function renderBriefing() {
  document.getElementById("briefingBody").innerHTML =
    `<p>业绩说明会 / 投资者关系活动记录：<span class="badge">暂不可用</span></p>
     <p class="muted" style="margin-top:8px">原因：上证 e 互动、深交所互动易、巨潮资讯均无公开免费的 JSON 接口（需登录或页面抓取，静态站无法直接调用）；东财/腾讯免费接口不提供业绩说明会日程。本站不编造会议记录。</p>
     <p style="margin-top:10px">手动查看：<a href="https://sns.sseinfo.com/" target="_blank" rel="noopener">上证 e 互动</a> · <a href="https://irm.cninfo.com.cn/" target="_blank" rel="noopener">深交所互动易</a> · <a href="https://www.cninfo.com.cn/new/index" target="_blank" rel="noopener">巨潮资讯</a></p>
     <p class="muted" style="margin-top:8px">上方“预期”页的业绩预告是 A 股对应的官方预期披露，可作为替代参考。</p>`;
}
async function renderAnalyst(code) {
  renderBriefing();
  const el = document.getElementById("analystBody");
  el.innerHTML = `<div class="loading">正在拉取全市场最新研报…</div>`;
  try {
    const reports = await fetchReports(code, 90, 3);
    analystLoadedFor = code;
    if (!reports.length) {
      el.innerHTML = `<p class="muted">全市场最新 300 篇研报中未找到该股（约最近 3 天窗口）。不代表该股没有研报——冷门股研报密度低，或最新研报不在最近 3 天内。可去东财研报中心手动检索。</p>`;
      return;
    }
    const latest = reports[0];
    const ratings = {};
    for (const r of reports) { if (r.rating) ratings[r.rating] = (ratings[r.rating] || 0) + 1; }
    const ratingLine = Object.entries(ratings).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + " " + v + " 篇").join(" · ") || "无评级信息";
    const epsRow = (label, eps, pe) => `<tr><td>${label}</td><td class="num">${eps != null ? eps.toFixed(2) + " 元" : "—"}</td><td class="num">${pe != null ? pe.toFixed(1) + " 倍" : "—"}</td></tr>`;
    let html = `<p style="margin-bottom:10px"><b>最新研报评级：${esc(latest.rating || "—")}</b>（${esc(latest.org || "")}，${esc(latest.publishDate)}）· 全市场最新 300 篇中该股共 ${reports.length} 篇研报：${esc(ratingLine)}</p>`;
    html += `<h3>分析师 EPS 预测（最新研报）</h3><table class="tbl"><tr><th>预测期</th><th>EPS</th><th>对应 PE</th></tr>`;
    html += epsRow("当年", latest.epsThisYear, latest.peThisYear);
    html += epsRow("明年", latest.epsNextYear, latest.peNextYear);
    html += epsRow("后年", latest.epsNext2Year, latest.peNext2Year);
    html += `</table><p class="muted" style="margin-top:6px">EPS/PE 预测来自研报原文（东财研报库 predict* 字段），非本站推算；同一家机构不同时间预测会变，以最新一篇为准。分析师目标价：${latest.aimPriceT != null ? "最新研报给出 " + latest.aimPriceT + " 元" : "最新研报未给出目标价（indvAimPrice 为空）"}。</p>`;
    html += `<h3>研报列表（全市场最新 300 篇中该股）</h3><table class="tbl"><tr><th>发布日</th><th>机构</th><th>标题</th><th>评级</th></tr>`;
    html += reports.slice(0, 20).map((r) =>
      `<tr><td>${esc(r.publishDate)}</td><td>${esc(r.org || "—")}</td><td style="text-align:left">${esc(r.title || "—")}</td><td>${esc(r.rating || "—")}</td></tr>`).join("");
    html += `</table><p class="muted" style="margin-top:8px">数据：东财研报列表（reportapi），按 stockCode 客户端筛选；覆盖说明见接口注释。分析师情绪 = 研报评级分布（买入/增持/中性/减持篇数），不是本站打分。</p>`;
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = `<p class="muted">研报暂不可用（${esc(e.message || e)}）。<a href="#" id="analystRetry">重试</a></p>`;
    document.getElementById("analystRetry").addEventListener("click", (ev) => { ev.preventDefault(); analystLoadedFor = null; renderAnalyst(code); });
  }
}

// ---------- 目标价格 ----------
function renderTarget(data, m, ext) {
  const el = document.getElementById("targetBody");
  const price = m.price;
  const dcfInput = {
    wacc: (parseFloat(document.getElementById("dcfWacc").value) || 8) / 100,
    growth: document.getElementById("dcfGrowth").value.trim() === "" ? null : parseFloat(document.getElementById("dcfGrowth").value) / 100,
    terminalGrowth: (parseFloat(document.getElementById("dcfTerminal").value) || 2) / 100,
    growthYears: parseInt(document.getElementById("dcfYears").value, 10) || 5,
  };
  const dcf = calcDCF(m, dcfInput);
  const proj = ext.epsProjection(
    parseFloat(document.getElementById("projGrowth").value) || 10,
    parseInt(document.getElementById("projYears").value, 10) || 3,
    parseFloat(document.getElementById("projExitPe").value) || 22
  );
  const peMed = ext.peHistory && ext.peHistory.median5;
  const peTarget = (m.ttmEps != null && m.ttmEps > 0 && peMed != null) ? m.ttmEps * peMed : null;
  const row = (method, target, upside, note) =>
    `<tr><td>${esc(method)}</td><td class="num">${target != null ? target.toFixed(2) + " 元" : "—"}</td><td class="num ${chgClass(upside != null ? upside * 100 : 0)}">${upside != null ? (upside >= 0 ? "+" : "") + (upside * 100).toFixed(1) + "%" : "—"}</td><td style="text-align:left" class="muted">${esc(note)}</td></tr>`;
  let html = `<table class="tbl"><tr><th>方法</th><th>目标价</th><th>较现价</th><th>说明</th></tr>`;
  html += row("DCF 内在价值", dcf.usable ? dcf.perShare : null, dcf.usable ? dcf.upside : null,
    dcf.usable ? "自由现金流折现，WACC " + (dcf.wacc * 100).toFixed(1) + "%，g " + (dcf.growth * 100).toFixed(1) + "%（参数与估值页 DCF 计算器同步）" : "暂不可用：" + dcf.reason);
  html += row("EPS 预测价", proj.usable ? proj.priceN : null, proj.usable ? proj.upside : null,
    proj.usable ? "EPS(TTM) " + proj.eps0.toFixed(2) + " 元，年增速 " + (proj.growth * 100).toFixed(1) + "%，" + proj.years + " 年后 × 退出 PE " + proj.exitPe + " 倍（参数与估值页 EPS 预测同步）" : "暂不可用：" + proj.reason);
  html += row("历史 PE 中位数法", peTarget, peTarget != null && price ? peTarget / price - 1 : null,
    peMed != null ? "EPS(TTM) " + (m.ttmEps != null ? m.ttmEps.toFixed(2) : "—") + " 元 × 近 5 年 PE 中位数 " + peMed.toFixed(1) + " 倍" : "暂不可用：无近 5 年 PE 中位数或 TTM EPS");
  html += row("分析师目标价", null, null, "见“分析师”页：最新研报的 indvAimPrice 字段，多数研报不给目标价；无免费一致预期目标价数据源");
  html += `</table><p class="muted" style="margin-top:8px">现价 ${price != null ? price.toFixed(2) + " 元" : "—"}。三种方法口径不同：DCF 看现金流、EPS 预测价看盈利增速、PE 中位数法看估值回归；不要只取最高值当目标价。</p>`;
  el.innerHTML = html;
}

// ---------- 谁会投资 ----------
function renderInvestor(data, m, ext) {
  const el = document.getElementById("investorBody");
  const fit = calcInvestorFit(m, ext);
  let html = `<p style="margin-bottom:10px"><b>${esc(fit.verdict)}</b></p><div class="score-dims">`;
  for (const p of fit.profiles) {
    const w = p.s != null ? p.s : 0;
    html += `<div class="dim-row">
      <div class="dim-top"><b>${esc(p.name)} · ${esc(p.desc)}</b><span>${p.s != null ? p.s + " / 100" : "数据不足"}</span></div>
      <div class="dim-bar"><i style="width:${w}%;background:${p.s != null && p.s >= 70 ? "#1a9e54" : p.s != null && p.s >= 40 ? "#2b6cb0" : "#e5484d"}"></i></div>
      <div class="dim-detail">${esc(p.rules)}</div>
    </div>`;
  }
  html += `</div><p class="muted" style="margin-top:8px">算法：每类由 2–5 个可算指标加权，缺失指标不计分（分母缩小）；分数是画像匹配度，不是推荐度。高分只说明该类投资者更可能关注这只票，不代表应该买入。</p>`;
  el.innerHTML = html;
}

// ---------- 特里·史密斯 ----------
function renderSmith(data, m, ext) {
  const el = document.getElementById("smithBody");
  const s = calcSmith(m, ext);
  const badge = (st) => st === "pass" ? `<span class="badge done">通过</span>` : st === "fail" ? `<span class="badge" style="background:var(--red-soft);color:#991b1b">未通过</span>` : `<span class="badge">无数据</span>`;
  let html = `<p style="margin-bottom:10px"><b>${esc(s.verdict)}</b></p>
    <p class="muted" style="margin-bottom:10px">方法来源：Fundsmith 特里·史密斯的质量选股法——只买高资本回报、持续增长、现金流真实、低杠杆、估值合理的公司，并长期持有。以下 9 项全部用本股数据逐项算出，阈值公开：</p>
    <table class="tbl"><tr><th>检查项</th><th>结论</th><th>依据</th></tr>`;
  for (const it of s.items) {
    html += `<tr><td>${esc(it.label)}</td><td>${badge(it.status)}</td><td style="text-align:left" class="muted">${esc(it.note)}</td></tr>`;
  }
  html += `</table><p class="muted" style="margin-top:8px">通过 ${s.passed} / ${s.judged} 项（可判项）。ROIC/ROCE 的投入资本用“净资产 + 总负债”代理（见打分指南）；分红年数按有派息记录的年份数计。</p>`;
  el.innerHTML = html;
}

// ---------- 公司 ----------
function renderCompany(data, m) {
  const el = document.getElementById("companyBody");
  const pf = data.profile || null;
  if (!pf) {
    el.innerHTML = `<p class="muted">公司信息暂不可用（该标的无 F10 公司基本信息记录，如 ETF；或接口本次未返回${data.errors && data.errors.profile ? "：" + esc(data.errors.profile) : ""}）。</p>`;
    return;
  }
  const rows = [
    ["公司全称", pf.ORG_NAME],
    ["英文名称", pf.ORG_NAME_EN],
    ["曾用名", pf.FORMERNAME],
    ["证券类型", pf.SECURITY_TYPE],
    ["上市交易所", pf.TRADE_MARKET],
    ["上市日期", pf.LISTING_DATE ? String(pf.LISTING_DATE).slice(0, 10) : null],
    ["成立日期", pf.FOUND_DATE ? String(pf.FOUND_DATE).slice(0, 10) : null],
    ["主营业务", pf.MAIN_BUSINESS],
    ["经营范围", pf.BUSINESS_SCOPE],
    ["证监会行业", pf.INDUSTRYCSRC1],
    ["东财三级行业", pf.BOARD_NAME_LEVEL],
    ["实际控制人", pf.ACTUAL_HOLDER],
    ["董事长", pf.CHAIRMAN],
    ["总经理", pf.PRESIDENT],
    ["法人代表", pf.LEGAL_PERSON],
    ["董事会秘书", pf.SECRETARY],
    ["证券事务代表", pf.SECPRESENT],
    ["独立董事", pf.INDEDIRECTORS],
    ["注册资本", pf.REG_CAPITAL != null ? Number(pf.REG_CAPITAL).toLocaleString("zh-CN") + " 万元" : null],
    ["员工数", pf.EMP_NUM != null ? Number(pf.EMP_NUM).toLocaleString("zh-CN") + " 人" : null],
    ["注册地址", pf.REG_ADDRESS],
    ["办公地址", pf.ADDRESS],
    ["联系电话", pf.ORG_TEL],
    ["邮箱", pf.ORG_EMAIL],
    ["网址", pf.ORG_WEB],
    ["审计机构", pf.ACCOUNTFIRM_NAME],
    ["律师事务所", pf.LAW_FIRM],
  ];
  el.innerHTML = `<table class="tbl">` + rows.map(([k, v]) =>
    `<tr><td>${esc(k)}</td><td style="text-align:left">${esc(v != null && v !== "" ? v : "—")}</td></tr>`).join("") + `</table>` +
    (pf.ORG_PROFILE ? `<h3>公司简介（全文）</h3><p style="font-size:14px;line-height:1.8">${esc(String(pf.ORG_PROFILE).replace(/\s+/g, " ").trim())}</p>` : "");
}

// ---------- 行业历史（行业页懒加载）----------
async function renderSectorHist(code) {
  const el = document.getElementById("sectorHistBody");
  el.innerHTML = `<div class="loading">正在加载行业指数…</div>`;
  try {
    const boards = await fetchBoards("industry", 500);
    if (!boards.length) throw new Error("行业板块列表无数据");
    const pf = currentData && currentData.profile;
    const level = pf && pf.BOARD_NAME_LEVEL ? String(pf.BOARD_NAME_LEVEL) : "";
    const levelParts = level.split("-").filter(Boolean);
    const m = currentMetrics || {};
    // 优先匹配东财三级行业中间段（如“白酒Ⅱ”），其次匹配行情行业名
    let def = boards.find((b) => levelParts.some((p) => p && b.name === p))
      || boards.find((b) => m.industry && b.name.includes(m.industry))
      || boards.find((b) => m.industry && m.industry.includes(b.name))
      || boards[0];
    const opts = [...boards].sort((a, b) => (b.changePct || 0) - (a.changePct || 0));
    el.innerHTML = `<div class="dcf-grid" style="grid-template-columns:1fr auto">
        <div class="dcf-field"><label>选择行业指数（按今日涨跌幅排序）</label>
        <select id="sectorBoardSel" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:6px;font-size:14px">
        ${opts.map((b) => `<option value="${esc(b.code)}" ${b.code === def.code ? "selected" : ""}>${esc(b.name)}（${b.changePct != null ? (b.changePct > 0 ? "+" : "") + b.changePct.toFixed(2) + "%" : "—"}）</option>`).join("")}
        </select></div>
        <div class="dcf-field"><label>&nbsp;</label><button class="primary" id="sectorHistBtn" style="padding:8px 16px;border:none;border-radius:8px;background:var(--blue);color:#fff;font-size:13px">加载走势</button></div>
      </div>
      <div id="sectorHistDetail"></div>`;
    const loadBoard = async (boardCode) => {
      const det = document.getElementById("sectorHistDetail");
      const board = boards.find((b) => b.code === boardCode) || def;
      det.innerHTML = `<div class="loading">正在加载 ${esc(board.name)} 走势…</div>`;
      try {
        const kl = await fetchBoardKline(boardCode, 101, 250);
        const ann = calcHs300Annual(kl);
        det.innerHTML = `<div class="metrics" style="margin-bottom:10px">
          ${metricCard("行业指数", board.name, board.code)}
          ${metricCard("最新点位", board.price != null ? board.price.toFixed(2) : "—", "")}
          ${metricCard("今日涨跌", chgText(board.changePct), "")}
          ${metricCard("总市值", fmtMoney(board.totalMcap), "")}
          ${ann.usable ? metricCard("近 " + ann.rows.length + " 年年化", (ann.cagr * 100).toFixed(1) + "%", ann.fromYear + "–" + ann.toYear) : ""}
        </div>
        <div class="chart-box short"><canvas class="chart" id="sectorHistChart"></canvas></div>
        ${ann.usable ? `<table class="tbl" style="margin-top:10px"><tr><th>年份</th><th>年末点位</th><th>年度回报</th></tr>` +
          ann.rows.map((r) => `<tr><td>${r.year}</td><td class="num">${r.close.toFixed(2)}</td><td class="num ${chgClass(r.ret * 100)}">${(r.ret >= 0 ? "+" : "") + (r.ret * 100).toFixed(1)}%</td></tr>`).join("") + `</table>
          <p class="muted" style="margin-top:8px">上涨 ${ann.upYears} 年 / 下跌 ${ann.downYears} 年 · 平均年度回报 ${(ann.avgRet * 100).toFixed(1)}% · ${esc(ann.note)}</p>` : `<p class="muted">年度回报暂不可用：${esc(ann.reason)}</p>`}`;
        drawKline(document.getElementById("sectorHistChart"), kl, { limit: 250 });
      } catch (e2) {
        det.innerHTML = `<p class="muted">行业指数走势暂不可用（${esc(e2.message || e2)}）。东财板块 K 线偶发 rc=102 限流，点“加载走势”重试。</p>`;
      }
    };
    document.getElementById("sectorHistBtn").addEventListener("click", () => loadBoard(document.getElementById("sectorBoardSel").value));
    document.getElementById("sectorBoardSel").addEventListener("change", (e) => loadBoard(e.target.value));
    sectorHistLoadedFor = code;
    await loadBoard(def.code);
  } catch (e) {
    el.innerHTML = `<p class="muted">行业历史暂不可用（${esc(e.message || e)}）。<a href="#" id="sectorHistRetry">重试</a></p>`;
    document.getElementById("sectorHistRetry").addEventListener("click", (ev) => { ev.preventDefault(); sectorHistLoadedFor = null; renderSectorHist(code); });
  }
}

// ---------- 热力图 ----------
function heatColor(pct) {
  if (pct == null || !isFinite(pct)) return { bg: "#f1f5f9", fg: "#64748b" };
  const a = Math.min(0.85, 0.18 + Math.abs(pct) / 12);
  if (pct > 0) return { bg: "rgba(229,72,77," + a.toFixed(2) + ")", fg: a > 0.55 ? "#fff" : "#991b1b" };
  if (pct < 0) return { bg: "rgba(26,158,84," + a.toFixed(2) + ")", fg: a > 0.55 ? "#fff" : "#14532d" };
  return { bg: "#f1f5f9", fg: "#64748b" };
}
async function renderHeatmap(kind) {
  const el = document.getElementById("heatmapBody");
  el.innerHTML = `<div class="loading">正在加载${kind === "concept" ? "概念" : "行业"}板块…</div>`;
  try {
    const boards = await fetchBoards(kind, 600);
    if (!boards.length) throw new Error("板块列表无数据");
    const sorted = [...boards].sort((a, b) => (b.changePct || 0) - (a.changePct || 0));
    const top = sorted.slice(0, 10), bottom = sorted.slice(-10).reverse();
    let html = `<p class="muted" style="margin-bottom:8px">共 ${boards.length} 个${kind === "concept" ? "概念" : "行业"}板块 · 点击色块查看该板块 1 年走势与年度回报 · 颜色越深涨跌幅越大。行业板块含申万二/三级子行业（如焦炭Ⅱ/焦炭Ⅲ），同价并列属正常。</p>`;
    html += `<p style="margin-bottom:10px">领涨：${top.map((b) => esc(b.name) + " +" + (b.changePct || 0).toFixed(2) + "%").join(" · ")}<br>领跌：${bottom.map((b) => esc(b.name) + " " + (b.changePct || 0).toFixed(2) + "%").join(" · ")}</p>`;
    html += `<div class="heatmap">` + sorted.map((b) => {
      const c = heatColor(b.changePct);
      return `<div class="hm-cell" data-board="${esc(b.code)}" data-name="${esc(b.name)}" style="background:${c.bg};color:${c.fg}" title="${esc(b.name)} ${b.changePct != null ? (b.changePct > 0 ? "+" : "") + b.changePct.toFixed(2) + "%" : ""}"><span class="hm-name">${esc(b.name)}</span><span class="hm-pct">${b.changePct != null ? (b.changePct > 0 ? "+" : "") + b.changePct.toFixed(2) + "%" : "—"}</span></div>`;
    }).join("") + `</div><div id="heatmapDetail" style="margin-top:14px"></div>`;
    el.innerHTML = html;
    el.querySelectorAll(".hm-cell").forEach((cell) => {
      cell.addEventListener("click", () => loadBoardDetail(cell.dataset.board, cell.dataset.name, kind));
    });
  } catch (e) {
    el.innerHTML = `<p class="muted">热力图暂不可用（${esc(e.message || e)}）。<a href="#" id="heatmapRetry">重试</a></p>`;
    document.getElementById("heatmapRetry").addEventListener("click", (ev) => { ev.preventDefault(); renderHeatmap(kind); });
  }
}
async function loadBoardDetail(boardCode, boardName, kind) {
  const det = document.getElementById("heatmapDetail");
  if (!det) return;
  det.innerHTML = `<div class="loading">正在加载 ${esc(boardName)} 走势…</div>`;
  try {
    const kl = await fetchBoardKline(boardCode, 101, 250);
    const ann = calcHs300Annual(kl);
    det.innerHTML = `<h3>${esc(boardName)} · 近 1 年走势</h3>
      <div class="chart-box short"><canvas class="chart" id="heatmapChart"></canvas></div>
      ${ann.usable ? `<p class="muted" style="margin-top:8px">近 ${ann.rows.length} 年：上涨 ${ann.upYears} 年 / 下跌 ${ann.downYears} 年 · 平均年度回报 ${(ann.avgRet * 100).toFixed(1)}% · 年化 ${(ann.cagr * 100).toFixed(1)}%</p>` : ""}`;
    drawKline(document.getElementById("heatmapChart"), kl, { limit: 250 });
    document.getElementById("heatmapChart").scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (e) {
    det.innerHTML = `<p class="muted">${esc(boardName)} 走势暂不可用（${esc(e.message || e)}）。东财板块 K 线偶发 rc=102 限流，稍后重试。</p>`;
  }
}

// ---------- 低估雷达 ----------
async function renderRadar() {
  const el = document.getElementById("radarBody");
  el.innerHTML = `<div class="loading">正在全市场扫描低估股…</div>`;
  try {
    const all = await fetchMarketScan(500);
    const cands = all.filter((s) =>
      s.pe != null && s.pe >= 3 && s.pe <= 15 &&
      s.pb != null && s.pb >= 0.5 && s.pb <= 2.5 &&
      s.totalMcap != null && s.totalMcap >= 5e9 &&
      s.name && !/退|ST|PT/.test(s.name)
    ).slice(0, 30);
    if (!cands.length) throw new Error("按规则筛出 0 只（PE（静态）3–15、PB 0.5–2.5、市值>50 亿）");
    const quotes = await fetchTxQuotes(cands.map((s) => s.code));
    const scored = cands.map((s) => {
      const q = quotes[s.code] || {};
      const roe = q.roe != null ? q.roe : null; // 腾讯 qt 字段 65 = ROE（%）
      const peS = Math.max(0, Math.min(100, (15 - s.pe) / 12 * 100));
      const pbS = Math.max(0, Math.min(100, (2.5 - s.pb) / 2 * 100));
      const roeS = roe != null ? Math.max(0, Math.min(100, roe / 20 * 100)) : 50;
      const score = Math.round(peS * 0.4 + pbS * 0.3 + roeS * 0.3);
      return { ...s, roe, score };
    }).sort((a, b) => b.score - a.score);
    let html = `<p class="muted" style="margin-bottom:10px">规则：PE（静态，东财 clist f9 口径）3–15 倍 · PB 0.5–2.5 倍 · 总市值 &gt; 50 亿 · 剔除退市/ST 股 · 评分 = PE 越低越好（40%）+ PB 越低越好（30%）+ ROE 越高越好（30%，腾讯行情 ROE）。扫描范围：东财全市场按 PE 升序取前 500 只（全市场共 5563 只，PE 排序靠后的不在本次扫描内）。</p>`;
    html += `<table class="tbl"><tr><th>#</th><th>代码</th><th>名称</th><th>现价</th><th>涨跌</th><th>PE（静态）</th><th>PB</th><th>总市值</th><th>ROE</th><th>雷达评分</th></tr>`;
    scored.forEach((s, i) => {
      html += `<tr><td>${i + 1}</td><td><a href="#" data-radar-code="${esc(s.code)}">${esc(s.code)}</a></td><td style="text-align:left">${esc(s.name)}</td><td class="num">${s.price != null ? s.price.toFixed(2) : "—"}</td><td class="num ${chgClass(s.changePct)}">${chgText(s.changePct)}</td><td class="num">${s.pe.toFixed(2)}</td><td class="num">${s.pb.toFixed(2)}</td><td class="num">${fmtMoney(s.totalMcap)}</td><td class="num">${s.roe != null ? s.roe.toFixed(1) + "%" : "—"}</td><td class="num"><b>${s.score}</b></td></tr>`;
    });
    html += `</table><p class="muted" style="margin-top:8px">点击代码可直接分析该股。雷达评分是筛选排序分，不是买入建议；低 PE/PB 可能是价值陷阱，请结合财报与分红页交叉验证。</p>`;
    el.innerHTML = html;
    el.querySelectorAll("[data-radar-code]").forEach((a) => a.addEventListener("click", (ev) => {
      ev.preventDefault();
      document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === "overview"));
      document.querySelectorAll(".tab-pane").forEach((p) => p.classList.toggle("active", p.id === "pane-overview"));
      document.getElementById("toolArea").style.display = "none";
      document.getElementById("detailArea").style.display = "block";
      document.querySelectorAll("#toolTabs button").forEach((b) => b.classList.remove("active"));
      loadStock(a.dataset.radarCode);
    }));
  } catch (e) {
    el.innerHTML = `<p class="muted">低估雷达暂不可用（${esc(e.message || e)}）。<a href="#" id="radarRetry">重试</a></p>`;
    document.getElementById("radarRetry").addEventListener("click", (ev) => { ev.preventDefault(); renderRadar(); });
  }
}

// ---------- 比较器 ----------
const compareCache = {};
async function renderCompare() {
  const el = document.getElementById("compareBody");
  const picked = watchlist.slice(0, 2).map((s) => s.code);
  el.innerHTML = `<p class="muted" style="margin-bottom:10px">勾选 2–4 只自选股对比（默认前 2 只）。指标全部实时拉取。</p>
    <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:12px">${watchlist.map((s) =>
      `<label style="font-size:14px"><input type="checkbox" class="cmp-check" value="${esc(s.code)}" ${picked.includes(s.code) ? "checked" : ""}> ${esc(s.name)} ${esc(s.code)}</label>`).join("")}</div>
    <button class="primary" id="compareBtn" style="padding:9px 18px;border:none;border-radius:8px;background:var(--blue);color:#fff;font-size:14px">开始对比</button>
    <div id="compareResult" style="margin-top:12px"></div>`;
  document.getElementById("compareBtn").addEventListener("click", async () => {
    const codes = [...el.querySelectorAll(".cmp-check:checked")].map((c) => c.value);
    const res = document.getElementById("compareResult");
    if (codes.length < 2 || codes.length > 4) { res.innerHTML = `<p class="muted">请勾选 2–4 只股票。</p>`; return; }
    res.innerHTML = `<div class="loading">正在拉取 ${codes.length} 只股票数据…</div>`;
    const items = [];
    for (const code of codes) {
      try {
        if (!compareCache[code]) {
          const data = await fetchStockAll(code);
          const m = calcMetrics(data);
          const sc = scoreStock(m, data.klineD);
          compareCache[code] = { data, m, sc };
        }
        items.push({ code, ...compareCache[code] });
      } catch (e) {
        items.push({ code, error: String(e.message || e) });
      }
    }
    const rows = [
      ["名称", (it) => (it.data && it.data.quote && it.data.quote.name) || (it.m && it.m.industry) || it.code],
      ["现价", (it) => it.m && it.m.price != null ? it.m.price.toFixed(2) : "—"],
      ["涨跌幅", (it) => it.m ? chgText(it.m.changePct) : "—"],
      ["PE-TTM", (it) => it.m && it.m.peTtm != null ? it.m.peTtm.toFixed(2) : "—"],
      ["PB", (it) => it.m && it.m.pb != null ? it.m.pb.toFixed(2) : "—"],
      ["股息率", (it) => it.m && it.m.divYield != null ? it.m.divYield.toFixed(2) + "%" : "—"],
      ["ROE（TTM）", (it) => it.m ? pct1(it.m.roe) : "—"],
      ["净利率（TTM）", (it) => it.m ? pct1(it.m.netMargin) : "—"],
      ["ROIC（TTM）", (it) => { const e2 = it.data ? calcExtended(it.data, it.m) : null; return e2 ? pct1(e2.profitability.roic) : "—"; }],
      ["ROCE（TTM）", (it) => { const e2 = it.data ? calcExtended(it.data, it.m) : null; return e2 ? pct1(e2.profitability.roce) : "—"; }],
      ["营收 TTM 同比", (it) => it.m ? pct1(it.m.revGrowth) : "—"],
      ["利润 TTM 同比", (it) => it.m ? pct1(it.m.profitGrowth) : "—"],
      ["资产负债率", (it) => it.m ? pct1(it.m.debtRatio) : "—"],
      ["自由现金流（TTM）", (it) => it.m ? fmtMoney(it.m.ttmFcf) : "—"],
      ["总市值", (it) => it.m ? fmtMoney(it.m.totalMcap) : "—"],
      ["综合评分", (it) => it.sc ? it.sc.total + " / " + it.sc.totalMax + "（" + it.sc.grade + "）" : "—"],
    ];
    let html = `<table class="tbl"><tr><th>指标</th>` + items.map((it) => `<th>${esc(it.code)}</th>`).join("") + `</tr>`;
    for (const [label, fn] of rows) {
      html += `<tr><td>${esc(label)}</td>` + items.map((it) => `<td class="num">${it.error ? "—" : esc(String(fn(it)))}</td>`).join("") + `</tr>`;
    }
    html += `</table><p class="muted" style="margin-top:8px">ETF/指数类无财报数据，盈利/负债类指标显示“—”。对比结果按本次拉取缓存，切换股票后重新拉取。</p>`;
    res.innerHTML = html;
  });
}

// ---------- 沪深300 ----------
async function renderHs300() {
  const retEl = document.getElementById("hs300RetBody");
  const tgtEl = document.getElementById("hs300TargetBody");
  retEl.innerHTML = `<div class="loading">正在加载沪深300 K 线…</div>`;
  tgtEl.innerHTML = `<div class="loading">正在加载沪深300成分股…</div>`;
  // 年度回报
  try {
    const kl = await fetchHs300LongKline();
    const ann = calcHs300Annual(kl);
    if (!ann.usable) throw new Error(ann.reason);
    retEl.innerHTML = `<div class="metrics" style="margin-bottom:10px">
        ${metricCard("覆盖年份", ann.fromYear + "–" + ann.toYear + "（" + ann.rows.length + " 年）", ann.note)}
        ${metricCard("平均年度回报", (ann.avgRet * 100).toFixed(1) + "%", "")}
        ${metricCard("年化回报（CAGR）", (ann.cagr * 100).toFixed(1) + "%", "首年末收盘 → 末年末收盘")}
        ${metricCard("上涨 / 下跌年数", ann.upYears + " / " + ann.downYears + " 年", "")}
      </div>
      <table class="tbl"><tr><th>年份</th><th>年末收盘</th><th>年度回报</th></tr>` +
      ann.rows.map((r) => `<tr><td>${r.year}</td><td class="num">${r.close.toFixed(2)}</td><td class="num ${chgClass(r.ret * 100)}">${(r.ret >= 0 ? "+" : "") + (r.ret * 100).toFixed(1)}%</td></tr>`).join("") +
      `</table><p class="muted" style="margin-top:8px">算法：每年最后一个交易日收盘价之比。仅计价格回报，不含分红（全收益回报会略高）。</p>`;
  } catch (e) {
    retEl.innerHTML = `<p class="muted">沪深300年度回报暂不可用（${esc(e.message || e)}）。<a href="#" id="hs300RetRetry">重试</a></p>`;
    document.getElementById("hs300RetRetry").addEventListener("click", (ev) => { ev.preventDefault(); renderHs300(); });
  }
  // 目标价格：成分股聚合（datacenter 成分表 + 腾讯 qt 分批补 PE/市值）
  // 注意：000300 不能走 fetchEmQuote——通用 secid 映射会把 000300 误判为深市（0.000300，rc=100）；
  // 指数行情直接用腾讯 q=sh000300（[3]=现价、[39]=指数 PE-TTM，2026-11-09 实测 13.55）。
  try {
    const iq = await fetchTxQuotes([API.HS300_CODE]);
    const idxQ = iq[API.HS300_CODE] || {};
    const price = idxQ.price || null;
    const indexPeTx = idxQ.peTtm || null;
    if (price == null) throw new Error("沪深300现价未取到（腾讯 qt 返回空）");
    const cons = await fetchHs300Constituents();
    if (!cons.length) throw new Error("成分股列表无数据（datacenter RPT_INDEX_CONSTITUENT 返回空）");
    const quotes = await fetchTxQuotesChunked(cons.map((c) => c.code));
    const withVal = cons.map((c) => {
      const q = quotes[c.code] || {};
      return { ...c, pe: q.peTtm, totalMcap: q.totalMcapYi != null ? q.totalMcapYi * 1e8 : null };
    }).filter((c) => c.pe != null && c.pe > 0 && c.totalMcap != null && c.totalMcap > 0);
    if (!withVal.length) throw new Error("成分股 PE/市值未取到（腾讯 qt 返回空）");
    const sumMcap = withVal.reduce((a, c) => a + c.totalMcap, 0);
    const sumEarn = withVal.reduce((a, c) => a + c.totalMcap / c.pe, 0);
    const peWeighted = sumEarn > 0 ? sumMcap / sumEarn : null;
    const top50 = [...withVal].sort((a, b) => b.totalMcap - a.totalMcap).slice(0, 50);
    // 前 50 大市值成分股归母利润同比聚合（最新报告期累计 vs 去年同期）
    let growth = null, growthNote = "";
    try {
      const codes = top50.map((c) => c.code);
      const inList = codes.map((c) => '"' + c + '"').join(",");
      const rows = await emDatacenter(
        "RPT_LICO_FN_CPD",
        "SECURITY_CODE,REPORTDATE,PARENT_NETPROFIT",
        "(SECURITY_CODE in (" + inList + "))",
        { pageSize: 200, sortColumns: "REPORTDATE", sortTypes: "-1" }
      );
      const byDate = {};
      for (const r of rows) {
        const d = String(r.REPORTDATE || "").slice(0, 10);
        if (!byDate[d]) byDate[d] = {};
        byDate[d][r.SECURITY_CODE] = num(r.PARENT_NETPROFIT);
      }
      const dates = Object.keys(byDate).sort().reverse();
      const d1 = dates[0];
      const d0 = dates.find((d) => d.slice(5) === (d1 || "").slice(5) && Number(d.slice(0, 4)) === Number((d1 || "").slice(0, 4)) - 1);
      if (d1 && d0) {
        const common = Object.keys(byDate[d1]).filter((c) => byDate[d0][c] != null && byDate[d1][c] != null);
        const s1 = common.reduce((a, c) => a + byDate[d1][c], 0);
        const s0 = common.reduce((a, c) => a + byDate[d0][c], 0);
        if (s0 && common.length) {
          growth = s1 / s0 - 1;
          growthNote = "前 50 大市值成分股中 " + common.length + " 只纳入（" + d1 + " 累计归母利润 vs " + d0 + " 同期）";
        }
      }
      if (growth == null) growthNote = "未取到可比的两期利润数据（datacenter 返回为空或报告期不匹配）";
    } catch (e2) {
      growthNote = "利润聚合失败：" + (e2.message || e2);
    }
    const renderTargetCalc = (targetPe) => {
      const res = calcHs300Target(price, peWeighted, growth, targetPe);
      if (!res.usable) return `<p class="muted">目标价算不出：${esc(res.reason)}。</p>`;
      return `<div class="dcf-result">
        <div class="small">沪深300 目标点位（盈利增长 × 估值调整）</div>
        <div class="big ${res.target >= price ? "up" : "down"}">${res.target.toFixed(2)} 点</div>
        <div class="vs">当前 ${price != null ? price.toFixed(2) + " 点" : "—"} · ${res.upside >= 0 ? "高于现价 " + (res.upside * 100).toFixed(1) + "%" : "低于现价 " + Math.abs(res.upside * 100).toFixed(1) + "%"}</div>
        <div class="small" style="margin-top:6px">${esc(res.formula)}</div>
      </div>`;
    };
    tgtEl.innerHTML = `<div class="metrics" style="margin-bottom:10px">
        ${metricCard("当前点位", price != null ? price.toFixed(2) : "—", "腾讯实时行情")}
        ${metricCard("成分股加权 PE", peWeighted != null ? peWeighted.toFixed(2) + " 倍" : "—", "市值加权调和口径，" + withVal.length + " 只纳入")}
        ${metricCard("腾讯指数 PE（核对）", indexPeTx != null ? indexPeTx.toFixed(2) + " 倍" : "—", "腾讯 q=sh000300 [39] PE-TTM")}
        ${metricCard("盈利增速 g", growth != null ? (growth >= 0 ? "+" : "") + (growth * 100).toFixed(1) + "%" : "—", growthNote)}
      </div>
      <div class="dcf-grid">
        <div class="dcf-field"><label>目标 PE（倍，默认=当前加权 PE）</label><input id="hs300TargetPe" type="number" step="0.5" min="1" max="60" value="${peWeighted != null ? peWeighted.toFixed(1) : ""}"></div>
      </div>
      <button class="primary" id="hs300CalcBtn" style="padding:9px 18px;border:none;border-radius:8px;background:var(--blue);color:#fff;font-size:14px">重新计算</button>
      <div id="hs300TargetResult" style="margin-top:12px">${renderTargetCalc(peWeighted)}</div>
      <p class="muted" style="margin-top:10px">公式：目标点位 = 当前点位 × (1 + g) × (目标 PE ÷ 当前加权 PE)。g 为前 50 大市值成分股归母净利润同比聚合（累计口径）；加权 PE 为成分股市值加权调和 PE-TTM（腾讯 qt，剔除 PE≤0）。成分股名单来自东财 datacenter RPT_INDEX_CONSTITUENT（300 只）。腾讯指数 PE 是另一口径的指数 PE，可作交叉核对，两者口径不同、数值会有差异；目标 PE 默认等于当前加权 PE，即“估值不变、只赚盈利增长的钱”情景，改目标 PE 可模拟估值修复/压缩。沪深300 PB 两个免费源都给不出，本页不列 PB。</p>`;
    document.getElementById("hs300CalcBtn").addEventListener("click", () => {
      const tp = parseFloat(document.getElementById("hs300TargetPe").value);
      document.getElementById("hs300TargetResult").innerHTML = renderTargetCalc(tp);
    });
  } catch (e) {
    tgtEl.innerHTML = `<p class="muted">沪深300目标价格暂不可用（${esc(e.message || e)}）。成分股/行情接口偶发限流，可点“重试”。目标点位公式：当前点位 × (1+g) × (目标 PE ÷ 当前加权 PE)。<a href="#" id="hs300TgtRetry">重试</a></p>`;
    document.getElementById("hs300TgtRetry").addEventListener("click", (ev) => { ev.preventDefault(); renderHs300(); });
  }
}

// ---------- 我的图形 ----------
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
function renderMycharts() {
  const el = document.getElementById("mychartsBody");
  const list = loadMyCharts();
  if (!list.length) {
    el.innerHTML = `<p class="muted">还没有保存的图形。在任意股票的“技术”页点“💾 保存当前图形到‘我的图形’”，可把当前 K 线视图（代码 + 日/周/月周期 + 保存时价格）存下来，之后一点即达。</p>`;
    return;
  }
  el.innerHTML = `<table class="tbl"><tr><th>名称</th><th>代码</th><th>周期</th><th>保存时价格</th><th>保存日期</th><th>操作</th></tr>` +
    list.map((c) => `<tr><td style="text-align:left">${esc(c.name)}</td><td>${esc(c.code)}</td><td>${esc(kltLabel(c.klt))}</td><td class="num">${c.price != null ? c.price.toFixed(2) : "—"}${c.changePct != null ? "（" + chgText(c.changePct) + "）" : ""}</td><td>${esc(c.date || "")}</td>
      <td><a href="#" data-open-chart="${esc(c.id)}">打开</a> · <a href="#" data-del-chart="${esc(c.id)}">删除</a></td></tr>`).join("") + `</table>`;
  el.querySelectorAll("[data-open-chart]").forEach((a) => a.addEventListener("click", (ev) => {
    ev.preventDefault();
    const c = loadMyCharts().find((x) => x.id === a.dataset.openChart);
    if (!c) return;
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
}

// ---------- 时钟 ----------
function tickClock() {
  const el = document.getElementById("marketClock");
  if (!el) return;
  const now = new Date();
  const wd = ["日", "一", "二", "三", "四", "五", "六"][now.getDay()];
  el.textContent = now.toLocaleDateString("zh-CN") + " 周" + wd + " " + now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}
setInterval(tickClock, 30000);

// ---------- 启动 ----------
let appStarted = false;
function initApp() {
  if (appStarted) return;
  appStarted = true;
  tickClock();
  renderWatchlist();
  renderMovers();
  loadStock(watchlist[0] ? watchlist[0].code : "601899");
}
if (isAuthed()) {
  showApp();
  initApp();
} else {
  document.getElementById("gatePw").focus();
}

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
document.getElementById("gateEye").addEventListener("click", () => {
  const pw = document.getElementById("gatePw");
  const show = pw.type === "password";
  pw.type = show ? "text" : "password";
  document.getElementById("gateEye").classList.toggle("on", show);
  document.getElementById("gateEye").setAttribute("aria-label", show ? "隐藏密码" : "显示密码");
  pw.focus();
});
document.getElementById("lockBtn").addEventListener("click", () => {
  sessionStorage.removeItem("af_auth");
  localStorage.removeItem("af_auth_remember");
  location.reload();
});

// ---------- 深浅色主题 ----------
// 默认浅色；月亮按钮切换，记 localStorage，下次打开恢复。只切换 CSS 变量，
// Canvas 绘制的 K 线/指标图颜色不变（已知缺口）。
const LS_THEME = "af_theme";
function applyTheme(theme) {
  const root = document.documentElement;
  if (root && root.dataset) root.dataset.theme = theme === "dark" ? "dark" : "light";
  try { localStorage.setItem(LS_THEME, theme === "dark" ? "dark" : "light"); } catch (e) { /* 忽略 */ }
}
(function initTheme() {
  let saved = "light";
  try { saved = localStorage.getItem(LS_THEME) || "light"; } catch (e) { /* 忽略 */ }
  const root = document.documentElement;
  if (root && root.dataset) root.dataset.theme = saved === "dark" ? "dark" : "light";
})();
document.getElementById("themeToggle").addEventListener("click", () => {
  const cur = (document.documentElement && document.documentElement.dataset.theme) || "light";
  applyTheme(cur === "dark" ? "light" : "dark");
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
  syncSidebarActive();
  window.scrollTo(0, 0); // 切标签回到顶部（史密斯入口曾出现"点完没反应"：新面板须落到视口顶部）
});
// 工具包标签（市场级）：隐藏个股详情区，显示工具区，首次打开懒加载
const TOOL_LOADERS = { heatmap: renderHeatmap, radar: renderRadar, compare: renderCompare, hs300target: renderHs300Target, hs300ret: renderHs300Ret, instholders: renderInstHolders, superholders: renderSuperHolders, mycharts: renderMycharts, market: renderMarket };
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
  syncSidebarActive();
});

// ---------- 左侧功能栏导航 ----------
// 侧栏项目只做导航：点 data-nav-tab 的走隐藏的 #tabs，点 data-nav-tool 的走隐藏的 #toolTabs，
// 复用现有切换逻辑（懒加载、画图、工具区显隐都不改）。原横向标签栏已隐藏但 DOM 保留。
function syncSidebarActive() {
  const activeTab = document.querySelector("#tabs button.active");
  const activeTool = document.querySelector("#toolTabs button.active");
  document.querySelectorAll("#navSidebar .nav-item").forEach((it) => {
    const tab = it.dataset ? it.dataset.navTab : null;
    const tool = it.dataset ? it.dataset.navTool : null;
    const on = (tab && activeTab && activeTab.dataset.tab === tab)
      || (tool && activeTool && activeTool.dataset.tool === tool);
    if (it.classList) it.classList.toggle("active", !!on);
  });
}
function closeSidebarMobile() { document.body.classList.remove("sidebar-open"); }
document.getElementById("navGroups").addEventListener("click", (e) => {
  const item = e.target.closest ? e.target.closest(".nav-item[data-nav-tab], .nav-item[data-nav-tool]") : null;
  if (item) {
    if (item.dataset.navTab) {
      const b = document.querySelector('#tabs button[data-tab="' + item.dataset.navTab + '"]');
      if (b) b.click();
      // 兜底：直接激活目标面板并回到顶部（史密斯入口曾出现点完无切换）
      document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("active", x.dataset.tab === item.dataset.navTab));
      document.querySelectorAll(".tab-pane").forEach((p) => p.classList.toggle("active", p.id === "pane-" + item.dataset.navTab));
      document.getElementById("toolArea").style.display = "none";
      document.getElementById("detailArea").style.display = "block";
      window.scrollTo(0, 0);
    } else {
      const b = document.querySelector('#toolTabs button[data-tool="' + item.dataset.navTool + '"]');
      if (b) b.click();
    }
    closeSidebarMobile();
    return;
  }
  const head = e.target.closest ? e.target.closest(".nav-group-head") : null;
  if (head && head.parentElement && head.parentElement.classList) {
    head.parentElement.classList.toggle("open");
    updateExpandAllLabel();
  }
});
function updateExpandAllLabel() {
  const groups = document.querySelectorAll("#navSidebar .nav-group");
  const anyClosed = Array.prototype.some.call(groups, (g) => !(g.classList && g.classList.contains("open")));
  const label = document.querySelector("#navExpandAll span");
  if (label) label.textContent = anyClosed ? "全部展开" : "全部收起";
}
document.getElementById("navExpandAll").addEventListener("click", () => {
  const groups = document.querySelectorAll("#navSidebar .nav-group");
  const anyClosed = Array.prototype.some.call(groups, (g) => !(g.classList && g.classList.contains("open")));
  groups.forEach((g) => { if (g.classList) g.classList.toggle("open", anyClosed); });
  updateExpandAllLabel();
});
document.getElementById("navSearch").addEventListener("input", (e) => {
  const kw = (e.target.value || "").trim();
  document.querySelectorAll("#navSidebar .nav-item").forEach((it) => {
    const hit = !kw || (it.textContent || "").includes(kw);
    it.style.display = hit ? "" : "none";
  });
  document.querySelectorAll("#navSidebar .nav-group").forEach((g) => {
    const items = g.querySelectorAll(".nav-item");
    const anyVisible = Array.prototype.some.call(items, (it) => it.style.display !== "none");
    g.style.display = (!kw || anyVisible) ? "" : "none";
    if (kw && anyVisible && g.classList) g.classList.add("open");
  });
});
document.getElementById("watchNavToggle").addEventListener("click", () => {
  document.getElementById("watchPanel").classList.toggle("open");
  document.getElementById("watchNavToggle").classList.toggle("open");
});
document.getElementById("moversNavToggle").addEventListener("click", () => {
  document.getElementById("moversPanel").classList.toggle("open");
  document.getElementById("moversNavToggle").classList.toggle("open");
});
document.getElementById("bellBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  const pop = document.getElementById("bellPop");
  pop.style.display = pop.style.display === "block" ? "none" : "block";
});
document.addEventListener("click", (e) => {
  if (!e.target.closest || (!e.target.closest("#bellBtn") && !e.target.closest("#bellPop"))) {
    const pop = document.getElementById("bellPop");
    if (pop) pop.style.display = "none";
  }
});
// 概况仪表盘：收藏心形（切换自选）、头卡铃铛、AI 说明、PDF 打印、走势图周期
document.getElementById("favBtn").addEventListener("click", () => {
  const code = currentCode;
  if (!code || !currentData) return;
  const name = (currentData.quote && currentData.quote.name) || (currentData.tx && currentData.tx.name) || code;
  if (watchlist.some((s) => s.code === code)) watchlist = watchlist.filter((s) => s.code !== code);
  else watchlist.unshift({ code, name });
  saveWatchlist(watchlist);
  renderWatchlist();
  renderHead(currentData, currentMetrics);
});
document.getElementById("headBellBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  const pop = document.getElementById("headBellPop");
  pop.style.display = pop.style.display === "block" ? "none" : "block";
});
document.addEventListener("click", (e) => {
  if (!e.target.closest || (!e.target.closest("#headBellBtn") && !e.target.closest("#headBellPop"))) {
    const pop = document.getElementById("headBellPop");
    if (pop) pop.style.display = "none";
  }
});
document.getElementById("aiBtn").addEventListener("click", () => {
  document.getElementById("aiNote").style.display = "block";
});
document.getElementById("pdfBtn").addEventListener("click", () => window.print());
document.getElementById("ovChartSeg").addEventListener("click", (e) => {
  const btn = e.target.closest ? e.target.closest("button") : null;
  if (!btn || !btn.dataset.ovp) return;
  ovChartPeriod = parseInt(btn.dataset.ovp, 10) || 250;
  document.querySelectorAll("#ovChartSeg button").forEach((b) => b.classList.toggle("active", b === btn));
  drawOverviewChart();
});
document.getElementById("hamburgerBtn").addEventListener("click", () => document.body.classList.toggle("sidebar-open"));
document.getElementById("sidebarBackdrop").addEventListener("click", closeSidebarMobile);
// 右侧顶栏“分析”按钮：6 位代码直达；否则取第一条联想结果，联想未出时现查
document.getElementById("analyzeBtn").addEventListener("click", async () => {
  const kw = searchInput.value.trim();
  if (!kw) return;
  if (/^\d{6}$/.test(kw)) { searchResults.classList.remove("open"); searchInput.value = ""; loadStock(kw); return; }
  const first = searchResults.querySelector(".sr-item");
  if (first) { searchResults.classList.remove("open"); searchInput.value = ""; loadStock(first.dataset.code); return; }
  try {
    const list = await searchStocks(kw);
    if (list.length) { searchInput.value = ""; loadStock(list[0].code); }
  } catch (err) { /* 搜不到时不动作 */ }
});
document.getElementById("hmIndexSeg").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-hm-idx]");
  if (!btn) return;
  document.querySelectorAll("#hmIndexSeg button").forEach((b) => b.classList.toggle("active", b === btn));
  hmIndex = btn.dataset.hmIdx;
  renderHeatmap();
});
document.getElementById("hmPeriodSeg").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-hm-per]");
  if (!btn) return;
  document.querySelectorAll("#hmPeriodSeg button").forEach((b) => b.classList.toggle("active", b === btn));
  hmPeriod = btn.dataset.hmPer;
  if (hmCache[hmIndex]) {
    const idx = HM_INDEXES.find((i) => i.code === hmIndex) || HM_INDEXES[0];
    const per = HM_PERIODS.find((p) => p.key === hmPeriod) || HM_PERIODS[0];
    drawHeatmapTreemap(hmCache[hmIndex], idx, per);
  } else renderHeatmap();
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
  renderChips(data, m);
  renderRange52(data, m);
  drawOverviewChart();
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

// ---------- 52 周区间：与技术维度同口径，取近 250 根日 K 的最高/最低（不足 250 根取全部；不足 60 根视为不可用） ----------
function range52(data) {
  const kl = data && data.klineD;
  if (!kl || kl.length < 60) return null;
  const w = kl.slice(-250);
  return { high: Math.max(...w.map((k) => k.high)), low: Math.min(...w.map((k) => k.low)), n: w.length };
}

// ---------- 渲染：头部 ----------
function renderHead(data, m) {
  const q = data.quote || {};
  const name = q.name || (data.tx && data.tx.name) || currentCode;
  document.getElementById("shLogo").textContent = String(name).replace(/^\s+/, "").slice(0, 1) || "—";
  const favBtn = document.getElementById("favBtn");
  if (favBtn) favBtn.classList.toggle("on", watchlist.some((s) => s.code === currentCode));
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
  const r52 = range52(data);
  document.getElementById("shMcap").textContent =
    "总市值 " + fmtMoney(m.totalMcap) + "  ·  52周区间 " + (r52 ? r52.low.toFixed(2) + " – " + r52.high.toFixed(2) : "暂不可用");
}

// ---------- 渲染：评分 ----------
function renderScore(data, m) {
  const res = scoreStock(m, data.klineD);
  const pct = res.totalMax ? res.total / res.totalMax : 0;
  const col = pct >= 0.8 ? "#1a9e54" : pct >= 0.65 ? "#2b6cb0" : pct >= 0.5 ? "#b45309" : "#e5484d";
  // 头卡 SVG 评分环：圆周 2π×52 ≈ 326.73，按占比显示弧长
  const arc = document.getElementById("scoreRingArc");
  if (arc) { arc.style.stroke = col; arc.style.strokeDashoffset = (326.73 * (1 - pct)).toFixed(1); }
  const numEl = document.getElementById("scoreNum");
  numEl.textContent = res.total;
  numEl.style.color = col;
  document.getElementById("scoreDen").textContent = "/ " + res.totalMax + (res.partial ? "（部分）" : "");
  document.getElementById("scoreGrade").textContent = "评级：" + res.grade;
  document.getElementById("scoreNote").textContent = res.partial ? "该标的无财报数据，只计估值 + 技术" : "";
  const bdSub = document.getElementById("ovBreakdownSub");
  if (bdSub) bdSub.textContent = res.total + " / " + res.totalMax + " · 评级：" + res.grade + " · 基于六大分析支柱";
  const labels = { valuation: "估值", profitability: "盈利", debt: "负债", growth: "成长", dividend: "分红", technical: "技术" };
  document.getElementById("scoreDims").innerHTML = Object.keys(labels).map((k) => {
    const d = res.dims[k];
    const w = d.max ? Math.round(d.score / d.max * 100) : 0;
    const dc = d.na ? "#e5e7eb" : (w >= 80 ? "#1a9e54" : w >= 65 ? "#2b6cb0" : w >= 50 ? "#b45309" : "#e5484d");
    return `<div class="dim-row">
      <div class="dim-top"><b>${labels[k]}</b><span style="color:${dc}">${d.na ? "不适用" : d.score + " / " + d.max}</span></div>
      <div class="dim-bar"><i style="width:${d.na ? 0 : w}%;background:${dc}"></i></div>
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

// ---------- 概况仪表盘：六维 chips ----------
// 文字评价口径：维度得分占比 ≥80% 出色地，≥50% 可以接受，否则待改善；与评分档位（优秀≥80、良好≥65、一般≥50）同向
function dimVerdict(pct) { return pct >= 0.8 ? "出色地" : pct >= 0.5 ? "可以接受" : "待改善"; }
function buildChipsHtml(data, m) {
  const res = scoreStock(m, data.klineD);
  const labels = { valuation: "估值", profitability: "盈利", debt: "负债", growth: "成长", dividend: "分红", technical: "技术" };
  const chip = (name, num, raw, pct, verdict, na) => {
    const cls = na ? "na" : (verdict === "出色地" ? "good" : verdict === "可以接受" ? "ok" : "weak");
    return `<div class="dim-chip ${cls}">
      <div class="dc-top"><span class="dc-dot"></span><span class="dc-name">${esc(name)}</span></div>
      <div class="dc-num">${na ? "—" : num}</div>
      <div class="dc-verdict">${na ? "不适用" : verdict}</div>
      <div class="dc-bar"><i style="width:${na ? 0 : Math.round(pct * 100)}%"></i></div>
      <div class="dc-raw">${esc(raw)}</div>
    </div>`;
  };
  const chips = Object.keys(labels).map((k) => {
    const d = res.dims[k];
    if (d.na) return chip(labels[k], null, "该标的无财报数据", 0, "", true);
    const pct = d.max ? d.score / d.max : 0;
    return chip(labels[k], Math.round(pct * 100), d.score + " / " + d.max, pct, dimVerdict(pct), false);
  }).join("");
  const totalPct = res.totalMax ? res.total / res.totalMax : 0;
  const total = chip("全部的", res.total, res.total + " / " + res.totalMax, totalPct, dimVerdict(totalPct), false);
  return chips + total;
}
// 概况与我的图形共用：v5 的六维 chips 只算一次 HTML，两处复用
function renderChips(data, m) {
  const el = document.getElementById("ovChips");
  if (el) el.innerHTML = buildChipsHtml(data, m);
}

// ---------- 概况仪表盘：52 周区间条 ----------
function renderRange52(data, m) {
  const el = document.getElementById("ovRange52");
  const r52 = range52(data);
  const price = m.price;
  if (!r52 || price == null || !(r52.high > r52.low)) {
    el.innerHTML = `<p class="muted">52周区间暂不可用 — K 线不足 60 根，或当日无收盘价。</p>`;
    return;
  }
  const pos = Math.max(0, Math.min(1, (price - r52.low) / (r52.high - r52.low)));
  const posPct = Math.round(pos * 100);
  const near = pos <= 0.33 ? "接近低点" : pos >= 0.67 ? "接近高点" : "区间中部";
  const nearCls = pos <= 0.33 ? "low" : pos >= 0.67 ? "high" : "mid";
  el.innerHTML = `
    <div class="r52-top"><span>📍 范围 52 周</span><span class="r52-near ${nearCls}">${near} · ${posPct}%</span></div>
    <div class="r52-track"><b style="width:${(pos * 100).toFixed(1)}%"></b><i style="left:${(pos * 100).toFixed(1)}%"></i></div>
    <div class="r52-labels"><span>最低：${r52.low.toFixed(2)} 元</span><span>当前价格：<b class="${chgClass(m.changePct)}">${price.toFixed(2)} 元</b></span><span>最高：${r52.high.toFixed(2)} 元</span></div>
    <p class="muted" style="margin-top:6px">基于近 ${r52.n} 个交易日 K 线最高/最低（与技术维度的 52 周高低同口径）。</p>`;
}

// ---------- 概况仪表盘：价格走势图 ----------
let ovChartPeriod = 250;
function drawOverviewChart() {
  const canvas = document.getElementById("ovChart");
  const kl = currentData && currentData.klineD;
  if (!canvas || !kl || !kl.length) return;
  drawKline(canvas, kl, { limit: ovChartPeriod });
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

// ---------- 财报日历 · 月历 ----------
// 月历网格：自选股预约（每股最近 CAL_PER_STOCK 条）+ 全市场待披露（fetchUpcomingCalendar）。
// 格子日期：已发布取 ACTUAL_PUBLISH_DATE，未发布取 FIRST_APPOINT_DATE。
// 覆盖范围：以本次加载到的最早 / 最晚预约月份为准，超出范围的月份标暂不可用并写原因，不编数。
const CAL_PER_STOCK = 20;
const CAL_WEEKDAYS = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];
let calGrid = null;          // { sig, watch: [], market: [], error }
let calGridPromise = null;
let calView = null;          // { y, m, watchOnly, wallet, selDay }
let calShellBuilt = false;

function calTodayStr() {
  const n = new Date();
  return n.getFullYear() + "-" + String(n.getMonth() + 1).padStart(2, "0") + "-" + String(n.getDate()).padStart(2, "0");
}
function calMonthKey(y, m) { return y + "-" + String(m + 1).padStart(2, "0"); }
function calIsDone(r) { return r.IS_PUBLISH === "1" || r.IS_PUBLISH === 1; }
// 格子日期：已发布用实际发布日，未发布用首次预约日
function calGridDate(r) {
  const s = (calIsDone(r) && r.ACTUAL_PUBLISH_DATE) ? r.ACTUAL_PUBLISH_DATE : r.FIRST_APPOINT_DATE;
  return String(s || "").slice(0, 10);
}
function calShortType(name) {
  const m = String(name || "").match(/(年报|半年报|一季报|三季报)$/);
  return m ? m[1] : String(name || "").replace(/^\d+年\s*/, "");
}
function calLoadGrid() {
  const sig = watchlist.map((s) => s.code).join(",");
  if (calGrid && calGrid.sig === sig) return Promise.resolve(calGrid);
  if (calGridPromise) return calGridPromise;
  calGridPromise = (async () => {
    const settled = await Promise.allSettled(watchlist.map((s) => fetchCalendar(s.code, CAL_PER_STOCK)));
    const watch = [];
    settled.forEach((r, i) => {
      if (r.status === "fulfilled" && Array.isArray(r.value)) {
        r.value.forEach((row) => watch.push(Object.assign({ __code: watchlist[i].code }, row)));
      }
    });
    let market = [];
    try { market = await fetchUpcomingCalendar(200); } catch (e) { market = []; }
    calGrid = { sig, watch, market, error: (watch.length === 0 && market.length === 0) ? "预约数据暂不可用" : null };
    calGridPromise = null;
    return calGrid;
  })();
  return calGridPromise;
}
function calShellHtml() {
  return `
  <div class="cal-nav">
    <button class="cal-navbtn" data-cal-nav="-1" title="上月">‹</button>
    <span class="cal-title" id="calTitle"></span>
    <button class="cal-navbtn" data-cal-nav="1" title="下月">›</button>
    <button class="cal-navbtn" data-cal-nav="0">今天</button>
    <span class="cal-toggles">
      <label class="cal-toggle"><input type="checkbox" id="calWatchToggle" checked> ★ 关注列表</label>
      <label class="cal-toggle"><input type="checkbox" id="calWalletToggle"> 💼 钱包</label>
    </span>
  </div>
  <div id="calWalletNote" style="display:none" class="note-box">暂不可用：本站无持仓钱包功能，钱包内公司无法展示；请用关注列表查看自选股披露。</div>
  <div id="calBanner"></div>
  <div class="cal-week">${CAL_WEEKDAYS.map((d) => `<div>${d}</div>`).join("")}</div>
  <div class="cal-grid" id="calGrid"></div>
  <div id="calDay"></div>
  <div class="cal-legend">★ 已添加到您的关注列表 &nbsp; 💼 放在你的钱包里 &nbsp; 点击股票代码 → 分析、点击日期 → 查看详情</div>
  <p class="cal-note">披露日为业绩披露预约日，预约日可能变更，以交易所公告为准。预约数据仅覆盖近期月份：每只自选股加载最近 ${CAL_PER_STOCK} 条预约记录，全市场仅显示待披露预约；超出覆盖范围的月份标暂不可用。</p>
  <div class="note-box">⚠ 本信息仅供参考和教育用途，不构成投资建议。评分和模型均基于一般参数计算，并不保证未来收益。请务必咨询合格的财务顾问。</div>
  <div id="calMine"></div>`;
}
function calRenderDay() {
  const el = document.getElementById("calDay");
  if (!el || !calView || !calView.selDay) { if (el) el.innerHTML = ""; return; }
  const rows = (calView.watchOnly ? (calGrid ? calGrid.watch : []) : (calGrid ? calGrid.market : []))
    .filter((r) => calGridDate(r) === calView.selDay);
  if (!rows.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<h3 style="margin-top:14px">${esc(calView.selDay)} · 当天披露（${rows.length} 家）</h3>` + rows.map((r) => {
    const done = calIsDone(r);
    const code = r.SECURITY_CODE || r.__code || "";
    return `<div class="cal-item"><span class="d">${esc(calGridDate(r))}</span> <a href="#" data-cal-code="${esc(code)}">${esc(code)} ${esc(r.SECURITY_NAME_ABBR || "")}</a> ${esc(r.REPORT_TYPE_NAME || "")}
      <span class="badge ${done ? "done" : "soon"}">${done ? "已发布" + (r.ACTUAL_PUBLISH_DATE ? "（" + String(r.ACTUAL_PUBLISH_DATE).slice(0, 10) + "）" : "") : "待披露" + (r.RESIDUAL_DAYS != null ? " · 还剩 " + r.RESIDUAL_DAYS + " 天" : "")}</span>${calView.watchOnly ? " ★" : ""}</div>`;
  }).join("");
}
function calRender() {
  const titleEl = document.getElementById("calTitle");
  const gridEl = document.getElementById("calGrid");
  const bannerEl = document.getElementById("calBanner");
  if (!titleEl || !gridEl || !calView) return;
  titleEl.textContent = calView.y + "年" + (calView.m + 1) + "月";
  const rows = calView.watchOnly ? (calGrid ? calGrid.watch : []) : (calGrid ? calGrid.market : []);
  const key = calMonthKey(calView.y, calView.m);
  const today = calTodayStr();
  const dates = rows.map(calGridDate).filter(Boolean).sort();
  const covMin = dates.length ? dates[0].slice(0, 7) : null;
  const covMax = dates.length ? dates[dates.length - 1].slice(0, 7) : null;
  let banner = "";
  let outOfRange = false;
  if (!calGrid) {
    banner = `<div class="cal-empty">正在加载预约数据…</div>`;
  } else if (calGrid.error) {
    banner = `<div class="cal-empty">预约数据暂不可用（${esc(calGrid.error)}），请稍后重试。</div>`;
  } else if (calView.watchOnly && watchlist.length === 0) {
    banner = `<div class="cal-empty">您的关注列表中没有任何公司。添加后，您就能在这里看到它们的财报信息。</div>`;
  } else if (covMax && key > covMax) {
    outOfRange = true;
    banner = `<div class="cal-empty">该月暂不可用：预约尚未公布（本次加载的预约数据截至 ${covMax}）。2026 年报预约通常自 12 月起陆续公布，具体以交易所公告为准。</div>`;
  } else if (covMin && key < covMin) {
    outOfRange = true;
    banner = `<div class="cal-empty">该月暂不可用：超出本次加载的预约记录范围（最早至 ${covMin}，每只自选股仅加载最近 ${CAL_PER_STOCK} 条）。</div>`;
  }
  if (bannerEl) bannerEl.innerHTML = banner;
  const byDay = {};
  rows.forEach((r) => {
    const d = calGridDate(r);
    if (d && d.slice(0, 7) === key) (byDay[d] = byDay[d] || []).push(r);
  });
  const firstDow = (new Date(calView.y, calView.m, 1).getDay() + 6) % 7; // 星期一为每周首日
  const daysInMonth = new Date(calView.y, calView.m + 1, 0).getDate();
  let cells = "";
  for (let i = 0; i < 42; i++) {
    const day = i - firstDow + 1;
    if (day < 1 || day > daysInMonth) { cells += `<div class="cal-cell blank"></div>`; continue; }
    const ds = key + "-" + String(day).padStart(2, "0");
    const list = byDay[ds] || [];
    const isToday = ds === today;
    const sel = calView.selDay === ds ? " sel" : "";
    const hasEvt = list.length ? " has-evt" : "";
    let evts = list.slice(0, 3).map((r) => {
      const code = r.SECURITY_CODE || r.__code || "";
      const nm = r.SECURITY_NAME_ABBR || "";
      return `<div class="cal-evt${calIsDone(r) ? "" : " upcoming"}" title="${esc(nm + " " + (r.REPORT_TYPE_NAME || ""))}"><a href="#" data-cal-code="${esc(code)}">${esc(code)}</a> ${esc(nm)} <i>${esc(calShortType(r.REPORT_TYPE_NAME))}</i></div>`;
    }).join("");
    if (list.length > 3) evts += `<div class="cal-more" data-cal-day="${ds}">还有 ${list.length - 3} 家 ›</div>`;
    cells += `<div class="cal-cell${isToday ? " today" : ""}${sel}${hasEvt}" data-cal-day="${ds}"><span class="d">${day}</span>${isToday ? `<span class="today-badge">今天</span>` : ""}${evts}</div>`;
  }
  gridEl.innerHTML = cells;
  if (calGrid && !calGrid.error && !outOfRange && Object.keys(byDay).length === 0) {
    if (bannerEl) bannerEl.innerHTML = `<div class="cal-empty">${calView.watchOnly ? "该月暂无自选股披露预约。A 股定期报告集中在 3–4 月（年报 / 一季报）、8 月（半年报）和 10 月（三季报）披露，其他月份通常无预约；未来预约公布后会自动出现。" : "该月暂无待披露预约（全市场待披露数据来自东财预约接口）。"}</div>`;
  }
  calRenderDay();
}
function calRenderMine(data) {
  const el = document.getElementById("calMine");
  if (!el) return;
  const mine = (data.calendar || []).slice().sort((a, b) => String(a.FIRST_APPOINT_DATE || "").localeCompare(String(b.FIRST_APPOINT_DATE || "")));
  if (!mine.length) {
    el.innerHTML = `<h3 style="margin-top:16px">当前股票 · 预约与发布</h3><p class="muted">该公司预约披露数据暂不可用${data.errors && data.errors.calendar ? "：" + esc(data.errors.calendar) : ""}。</p>`;
    return;
  }
  el.innerHTML = `<h3 style="margin-top:16px">当前股票 · 预约与发布</h3>` + mine.map((r) => {
    const done = calIsDone(r);
    return `<div class="cal-item"><span class="d">${esc((r.FIRST_APPOINT_DATE || "").slice(0, 10))}</span> ${esc(r.REPORT_TYPE_NAME || "")}
      <span class="badge ${done ? "done" : "soon"}">${done ? "已发布" + (r.ACTUAL_PUBLISH_DATE ? "（" + String(r.ACTUAL_PUBLISH_DATE).slice(0, 10) + "）" : "") : "待披露" + (r.RESIDUAL_DAYS != null ? " · 还剩 " + r.RESIDUAL_DAYS + " 天" : "")}</span></div>`;
  }).join("");
}
async function renderCalendar(data) {
  const el = document.getElementById("calBody");
  if (!calShellBuilt) {
    el.innerHTML = calShellHtml();
    calShellBuilt = true;
    const now = new Date();
    calView = { y: now.getFullYear(), m: now.getMonth(), watchOnly: true, wallet: false, selDay: calTodayStr() };
    el.addEventListener("click", (e) => {
      const nav = e.target.closest ? e.target.closest("[data-cal-nav]") : null;
      if (nav) {
        const d = parseInt(nav.dataset.calNav, 10);
        if (d === 0) { const n = new Date(); calView.y = n.getFullYear(); calView.m = n.getMonth(); calView.selDay = calTodayStr(); }
        else {
          let y = calView.y, m = calView.m + d;
          if (m < 0) { m = 11; y -= 1; }
          if (m > 11) { m = 0; y += 1; }
          calView.y = y; calView.m = m; calView.selDay = null;
        }
        calRender();
        return;
      }
      const codeEl = e.target.closest ? e.target.closest("[data-cal-code]") : null;
      if (codeEl) { e.preventDefault(); switchToStock(codeEl.dataset.calCode); return; }
      const dayEl = e.target.closest ? e.target.closest("[data-cal-day]") : null;
      if (dayEl) { calView.selDay = dayEl.dataset.calDay; calRender(); return; }
    });
    el.addEventListener("change", (e) => {
      if (e.target && e.target.id === "calWatchToggle") { calView.watchOnly = !!e.target.checked; calView.selDay = null; calRender(); }
      if (e.target && e.target.id === "calWalletToggle") {
        calView.wallet = !!e.target.checked;
        const n = document.getElementById("calWalletNote");
        if (n) n.style.display = calView.wallet ? "block" : "none";
      }
    });
  }
  calRenderMine(data);
  if (!calGrid) {
    const g = document.getElementById("calGrid");
    if (g) g.innerHTML = `<div class="cal-empty" style="grid-column:1/-1">正在加载预约数据…</div>`;
  }
  try { await calLoadGrid(); } catch (e) { /* 出错时保留旧网格，横条提示见 calRender */ }
  calRender();
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

// ---------- 机构持仓 / 超级大户持仓 ----------
// 实现在 js/holders.js（renderInstHolders / renderSuperHolders，工具级入口，
// 经 TOOL_LOADERS 懒加载），数据为同源季度快照
// data/holders/<code>.json（tools/refresh_holders.py 生成，源为东财 F10 PageAjax）。
// v6 的个股标签已拆分：机构持仓 = 13F 式跨股表 + 个股详情；
// 超级大户持仓 = 跨股大户汇总 + 大户详情三页（职位/表现/结构）。
// 旧的“暂不可用”占位已删除：2026-11-09 实测 PageAjax curl 通但无 CORS，
// 数据中心无股东表，快照是唯一能用的免费路径；快照缺失的股票仍在 holders.js 里诚实标注。

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

// ---------- 特里·史密斯 v7（按 AleInversor 图版重做）----------
// 三个子页：分析一家公司（评分环+标准表）/ 多家公司的排名（40/20/20/20）/ 特里·史密斯的标准
let smithHorizon = 10;
let smithRankBusy = false;

function smithStarsHTML(stars) {
  if (stars == null) return "<span class=\"muted\">—</span>";
  let h = "";
  for (let i = 1; i <= 5; i++) {
    if (stars >= i) h += "<span style=\"color:#f59e0b\">★</span>";
    else if (stars >= i - 0.5) h += "<span style=\"position:relative;display:inline-block;color:#cbd5e1\">★<span style=\"position:absolute;left:0;top:0;width:50%;overflow:hidden;color:#f59e0b\">★</span></span>";
    else h += "<span style=\"color:#cbd5e1\">★</span>";
  }
  return h;
}
function smithRingHTML(score10) {
  const C = 326.73;
  const pct = score10 != null ? Math.max(0, Math.min(1, score10 / 10)) : 0;
  const color = score10 == null ? "#94a3b8" : score10 >= 8 ? "#1a9e54" : score10 >= 6.5 ? "#2b6cb0" : score10 >= 5 ? "#d97706" : "#e5484d";
  return `<div class="score-ring-svg"><svg width="120" height="120" viewBox="0 0 120 120">
    <circle cx="60" cy="60" r="52" fill="none" stroke="#e2e8f0" stroke-width="9"/>
    <circle cx="60" cy="60" r="52" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round" transform="rotate(-90 60 60)" stroke-dasharray="${C}" stroke-dashoffset="${(C * (1 - pct)).toFixed(1)}"/>
    <text x="60" y="58" text-anchor="middle" font-size="26" font-weight="700" fill="var(--ink)">${score10 != null ? score10.toFixed(1) : "—"}</text>
    <text x="60" y="78" text-anchor="middle" font-size="12" fill="var(--muted)">/ 10</text>
  </svg></div>`;
}
function smithFmtVal(key, v) {
  if (v == null || !isFinite(v)) return "—";
  if (key === "intcover") return v === Infinity ? "∞" : v.toFixed(1) + " 次";
  if (key === "netdebtfcf") return v.toFixed(1) + " 年";
  return (v * 100).toFixed(1) + "%";
}
function smithRowStars(pts, max) {
  if (!max) return "<span class=\"muted\">—</span>";
  let h = "";
  for (let i = 1; i <= 4; i++) h += i <= pts ? "★" : "☆";
  return `<span style="color:#f59e0b">${h}</span> <span class="muted">${pts}/${max}</span>`;
}

function renderSmith(data, m, ext) {
  const el = document.getElementById("smithBody");
  const code = (data && data.code) || (currentData && currentData.code) || "";
  el.innerHTML = `
  <div class="card smith-head">
    <div class="smith-avatar">TS</div>
    <div>
      <div class="smith-motto">买入优质公司。<span style="color:var(--blue)">不要出价过高。</span>什么都不用做。</div>
      <div class="muted" style="margin-top:4px">Fundsmith 的创始人 Terry Smith</div>
      <div class="muted" style="margin-top:4px">它根据盈利能力、增长、利润率、现金流和债务等标准，对企业的质量进行评级，评分依据是过去 10 年的财务数据。评分范围为 0 到 10 分。</div>
    </div>
  </div>
  <div class="smith-subtabs">
    <button class="smith-subtab active" data-smith-sub="single">分析一家公司</button>
    <button class="smith-subtab" data-smith-sub="rank">多家公司的排名</button>
    <button class="smith-subtab" data-smith-sub="standards">特里·史密斯的标准</button>
  </div>
  <div id="smithPanelSingle"></div>
  <div id="smithPanelRank" style="display:none"></div>
  <div id="smithPanelStandards" style="display:none"></div>`;
  el.querySelectorAll(".smith-subtab").forEach((b) => {
    b.addEventListener("click", () => {
      el.querySelectorAll(".smith-subtab").forEach((x) => x.classList.toggle("active", x === b));
      document.getElementById("smithPanelSingle").style.display = b.dataset.smithSub === "single" ? "" : "none";
      document.getElementById("smithPanelRank").style.display = b.dataset.smithSub === "rank" ? "" : "none";
      document.getElementById("smithPanelStandards").style.display = b.dataset.smithSub === "standards" ? "" : "none";
      if (b.dataset.smithSub === "rank") renderSmithRankPanel();
      if (b.dataset.smithSub === "standards") renderSmithStandardsPanel();
    });
  });
  renderSmithSinglePanel(data, m, code);
  renderSmithStandardsPanel();
}

function smithCompanyCard(data, m) {
  const pf = data.profile || null;
  const name = (pf && pf.ORG_NAME) || m.name || data.code;
  const market = (pf && pf.TRADE_MARKET) || (String(data.code).startsWith("6") || String(data.code).startsWith("9") ? "上海证券交易所" : String(data.code).startsWith("5") ? "上海证券交易所" : "深圳证券交易所");
  const industry = (pf && pf.BOARD_NAME_LEVEL) || m.industry || "—";
  return `<div class="smith-company">
    <div class="smith-logo">${esc(String(name).slice(0, 1))}</div>
    <div style="flex:1">
      <div style="font-size:18px;font-weight:700">${esc(name)}</div>
      <div class="muted">${esc(data.code)} · ${esc(String(industry).split("-").pop() || industry)}</div>
      <div class="smith-kv">
        <div><div class="muted">价格</div><b>${m.price != null ? m.price.toFixed(2) + " 元" : "—"}</b></div>
        <div><div class="muted">资本化</div><b>${m.totalMcap != null ? fmtMoney(m.totalMcap) : "—"}</b></div>
        <div><div class="muted">国家</div><b>中国</b></div>
        <div><div class="muted">交易所</div><b>${esc(market)}</b></div>
        <div><div class="muted">行业</div><b>${esc(m.industry || "—")}</b></div>
        <div><div class="muted">股息收益率</div><b>${m.divYield != null ? m.divYield.toFixed(2) + "%" : "—"}</b></div>
      </div>
    </div>
  </div>`;
}

function renderSmithSinglePanel(data, m, code) {
  const panel = document.getElementById("smithPanelSingle");
  if (!panel) return;
  const full = calcSmithFull(data, m, smithHorizon);
  const years = full.series.length ? full.series[0].year + "–" + full.series[full.series.length - 1].year : "—";
  let rowsHtml = "";
  for (const r of full.rows) {
    if (r.na) {
      rowsHtml += `<tr><td style="text-align:left"><b>${esc(r.label)}</b><br><span class="muted">${esc(r.sub)}</span></td>
        <td class="num muted">N/A</td><td class="num muted">N/A</td><td class="muted">—</td>
        <td class="muted">—</td><td class="muted">—</td><td>${esc(r.reqText)}</td><td class="muted">不计分</td></tr>`;
      continue;
    }
    const midLabel = r.midType === "cagr"
      ? (r.mid != null ? (r.mid * 100).toFixed(1) + "%年复合增长率" : "—")
      : (r.mid != null ? smithFmtVal(r.key, r.mid) + "中度" : "—");
    rowsHtml += `<tr><td style="text-align:left"><b>${esc(r.label)}</b><br><span class="muted">${esc(r.sub)}</span></td>
      <td class="num ${r.parts.last === 1 ? "up" : r.parts.last === 0 ? "down" : ""}">${r.last != null ? smithFmtVal(r.key, r.last) : "—"}</td>
      <td class="num">${midLabel}</td>
      <td>${smithSparkSVG(r.spark)}</td>
      <td class="${r.trend.na ? "muted" : r.trend.improved ? "up" : "down"}">${r.trend.na ? "—" : (r.trend.improved ? "▲ 增加" : "▼ 下降")}</td>
      <td>${r.stab.na ? "<span class=\"muted\">—</span>" : `<span class="badge ${r.stab.pts >= 1 ? "done" : ""}">${esc(r.stab.label)}</span>`}</td>
      <td>${esc(r.reqText)}</td>
      <td>${smithRowStars(r.pts, r.max)}</td></tr>`;
  }
  panel.innerHTML = `
  <div class="card" style="margin-bottom:12px">
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end">
      <div class="dcf-field" style="flex:2;min-width:180px"><label>股票代码或公司名称</label>
        <input id="smithCodeInput" value="${esc(code)}" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:6px;font-size:14px"></div>
      <div class="dcf-field"><label>地平线</label>
        <select id="smithHorizonSel" style="padding:8px 10px;border:1px solid var(--line);border-radius:6px;font-size:14px">
          <option value="10" ${smithHorizon === 10 ? "selected" : ""}>10年（建议）</option>
          <option value="5" ${smithHorizon === 5 ? "selected" : ""}>5年</option>
        </select></div>
      <button class="primary" id="smithAnalyzeBtn" style="padding:8px 18px;border:none;border-radius:8px;background:var(--orange,#e8912d);color:#fff;font-size:14px">分析</button>
      <button class="primary" id="smithExampleBtn" style="padding:8px 18px;border:none;border-radius:8px;background:var(--blue);color:#fff;font-size:14px">参见示例</button>
      <span id="smithAnalyzeNote" class="muted" style="font-size:13px"></span>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 280px;gap:12px;margin-bottom:12px" class="smith-top">
    <div class="card">${smithCompanyCard(data, m)}</div>
    <div class="card" style="text-align:center">
      ${smithRingHTML(full.score10)}
      <div style="font-size:17px;font-weight:700;margin-top:6px">${esc(full.grade)}</div>
      <div style="font-size:18px;margin-top:4px">${smithStarsHTML(full.stars)} <span class="muted">${full.stars != null ? full.stars.toFixed(1) : "—"}</span></div>
      <div class="muted" style="margin-top:4px">${full.points} 分（满分 ${full.maxPoints} 分）</div>
    </div>
  </div>
  <div class="card">
    <h3 style="margin:0 0 8px">标准 <span class="muted" style="font-weight:400">年报序列 ${esc(years)} · 共 ${full.series.length} 个年报</span></h3>
    <table class="tbl"><tr><th style="text-align:left">标准</th><th>去年</th><th>中位/复合年增长率${smithHorizon}年</th><th>十年演变</th><th>趋势</th><th>稳定</th><th>要求</th><th>积分</th></tr>
    ${rowsHtml}</table>
    <p class="muted" style="margin-top:8px">计分规则：去年超要求 1 分；中位（增长项为 ${smithHorizon} 年复合增长率）超要求 1 分；趋势（近 3 年均值优于前 3 年，负债/资本支出类以下降为改善）1 分；稳定性非常稳定 1 / 稳定 0.5 / 一般 0.25 / 不稳定 0 分；ROCE&gt;WACC 另加 1 分。N/A 项不计入总分（按可测量项计分）。
    口径：ROCE=息税前利润/总资产（投入资本用总资产代理，与本站盈利页一致）；自由现金流=经营现金流−购建长期资产（未扣股权激励，无 SBC 字段）；每股自由现金流以当前总股本折算；自由现金流收益率以当前市值折算（无 10 年期债券收益率免费源时要求按 4.3% 计）；净债务=总负债−货币资金。稀释与 ROCE vs WACC 因无公开数据来源暂不可用。</p>
  </div>`;
  document.getElementById("smithHorizonSel").addEventListener("change", (e) => {
    smithHorizon = parseInt(e.target.value, 10) || 10;
    renderSmithSinglePanel(currentData, currentMetrics, currentData.code);
  });
  document.getElementById("smithExampleBtn").addEventListener("click", () => {
    document.getElementById("smithCodeInput").value = "600519";
    if (currentData && currentData.code === "600519") renderSmithSinglePanel(currentData, currentMetrics, "600519");
    else loadStock("600519");
  });
  document.getElementById("smithAnalyzeBtn").addEventListener("click", () => {
    const c = (document.getElementById("smithCodeInput").value || "").trim();
    const m2 = c.match(/(\d{6})/);
    const target = m2 ? m2[1] : c;
    if (!target) return;
    if (currentData && currentData.code === target) {
      renderSmithSinglePanel(currentData, currentMetrics, target);
      const note = document.getElementById("smithAnalyzeNote");
      if (note) note.textContent = "已重新计算 " + new Date().toLocaleTimeString("zh-CN", { hour12: false });
    } else loadStock(target);
  });
}

function renderSmithStandardsPanel() {
  const panel = document.getElementById("smithPanelStandards");
  if (!panel) return;
  panel.innerHTML = `
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:12px" class="smith-principles">
    <div class="card"><h3 style="margin:0 0 6px">1. 收购优秀公司</h3><p class="muted" style="margin:0">资本回报率（ROCE）高且持续高、利润率高、能将利润转化为现金、负债少、并且能够以同样的速度进行再投资以实现增长的企业。</p></div>
    <div class="card"><h3 style="margin:0 0 6px">2. 不要支付过高的价格</h3><p class="muted" style="margin:0">特里·史密斯评估公司价值时，依据的是自由现金流（FCF）市值，而不是市盈率。一家优秀的公司如果买入价格过高，可能会在未来几年内成为糟糕的投资。</p></div>
    <div class="card"><h3 style="margin:0 0 6px">3. 什么都不做</h3><p class="muted" style="margin:0">长期持有，让复利发挥作用，尽量减少投资组合的换手率：频繁买卖的成本和失误会侵蚀收益。</p></div>
  </div>
  <div class="card" style="margin-bottom:12px">
    <h3 style="margin:0 0 4px">逐行列出标准</h3>
    <p class="muted" style="margin:0 0 8px">每一行的要求与您原始电子表格的要求相同。最后一列显示的是 Fundsmith 截至 2026 年 6 月 30 日的投资组合加权平均值，该数据来自其半年报，作为 Terry Smith 眼中优质公司的基准。<b>Fundsmith 列是基金公开数据，不是本站算的。</b></p>
    <table class="tbl"><tr><th style="text-align:left">标准</th><th>要求</th><th style="text-align:left">它测量的是什么？</th><th style="text-align:left">特里·史密斯为何在意</th><th>Fundsmith</th></tr>
    ${[
      ["触碰", "大于15%", "企业每投入一欧元资本所产生的营业利润。", "这是特里·史密斯最看重的指标。高且持续的资本回报率（ROCE）体现了竞争优势：企业只需少量资本就能赚取丰厚利润，而且如果企业持续增长，每一欧元的再投资都能获得同样的收益率。其稳定性以相对值来衡量。", "31%"],
      ["销售量", "年增长率超过7%", "营收增长。去年同期：同比变化。平均值：复合年增长率（CAGR）。", "如果企业无法以同样的速度增长和再投资，那么高盈利能力就毫无意义。史密斯追求的是内生增长，而不是通过收购实现的增长。", "—"],
      ["每股自由现金流", "年增长率超过10%", "每股自由现金流增长（不包括股票期权激励）。", "它取代了每股收益（EPS）。史密斯不信任每股收益，因为它会被股票回购、债务或会计调整所虚高。每股现金才是股东真正应得的。", "—"],
      ["毛利率", "大于40%", "扣除产品直接成本后，每笔销售剩余的金额。", "高毛利率表明企业拥有定价权（品牌、专利、网络效应）。它还能抵御通货膨胀：即使成本上涨，对利润的影响也小得多。", "62%"],
      ["营业利润率", "大于15%", "扣除所有运营费用后的利润率（销售息税前利润）。", "它显示了在支付了整个结构的管理费用后，有多少定价权最终转化为利润。", "29%"],
      ["现金转换", "超过90%", "自由现金流（不包括股票激励）除以净利润。", "这是 Fundsmith 在每封信中都会公布的“现金转换率”。史密斯只信任现金：会计利润如果不能转化为现金，那就是危险信号。", "92%"],
      ["自由现金流收益率", "高于10年期债券收益率。", "自由现金流除以市值。要求是当前的无风险利率（如果没有数据，则为 4.3%）。", "这是第二个支柱，“不要支付过高的价格”。史密斯将自由现金流回报率与债券收益率进行比较：如果一家公司的收益率低于无风险债券，就应该要求该公司实现显著增长。", "4.3%"],
      ["利息保障倍数", "超过 10 次", "营业利润覆盖财务费用的倍数。", "史密斯会避开高杠杆公司：一家优秀的公司不需要负债就能获得良好的回报，而债务只会让糟糕的一年变成严重的问题。", "43倍"],
      ["净债务/自由现金流", "3岁以下", "需要数年的自由现金流才能偿还所有净债务。负债表净现金。", "它以实际现金流来衡量财务风险。史密斯在债务方面非常保守，因此债务期限要求不到 3 年。", "—"],
      ["资本支出/销售额", "不到10%", "固定资产投资占销售额的百分比。", "史密斯更喜欢资本轻型企业，这类企业无需在工厂和机器上投入大量资金即可发展壮大。", "—"],
      ["资本支出/经营现金流", "不到20%", "用于投资的部分经营现金流。", "资本支出越少，剩下的现金就越多，可用于分红、股票回购或业务增长的资金就越多。", "—"],
      ["稀释", "不到10%", "股票期权激励（SBC）除以自由现金流。中位数提示信息还显示了股票数量的增长情况。", "史密斯严厉批评以股票形式支付给高管的报酬：这是一种真实的成本，即使不经过现金，也会稀释股东。", "—"],
      ["ROCE WACC", "ROCE 高于 WACC", "将盈利能力中位数与资本成本进行比较。", "一家企业只有在其盈利能力超过让其投资者满意的水平时才会创造价值。", "—"],
    ].map((r) => `<tr><td style="text-align:left"><b>${esc(r[0])}</b></td><td><span class="badge" style="white-space:nowrap">${esc(r[1])}</span></td><td style="text-align:left" class="muted">${esc(r[2])}</td><td style="text-align:left" class="muted">${esc(r[3])}</td><td class="num"><b>${esc(r[4])}</b></td></tr>`).join("")}
    </table>
    <p class="muted" style="margin-top:8px">与您原电子表格相比的变化：FCF/EBITDA 现为现金转换率（由 Fundsmith 衡量），EPS 现为每股 FCF，总 FCF 增长率已替换为稀释率，净债务/FCF 比率已从 5 年缩短至 3 年，FCF 收益率已与 10 年期债券收益率进行比较。参考资料来源：Fundsmith Equity Fund 2026 年 7 月半年报。</p>
  </div>
  <div class="card">
    <h3 style="margin:0 0 8px">▼ 每行的得分方式</h3>
    <ul style="margin:0;padding-left:20px;line-height:1.9">
      <li><b>去年：</b>最新数据超过了要求。1 分。</li>
      <li><b>期间平均值：</b>中位数（或销售额和每股自由现金流的复合年增长率）超过要求。加 1 分。</li>
      <li><b>趋势：</b>过去三年的平均水平优于前三年。就债务、资本支出和股权稀释而言，改善意味着下降。1 分。</li>
      <li><b>稳定性：</b>非常稳定 1 分，稳定 0.5 分，一般 0.25 分，不稳定 0 分。</li>
      <li><b>ROCE 大于 WACC：</b>加 1 分。</li>
      <li>如果某个点由于缺乏数据而显示为 N/A，则不予考虑：成绩是根据可以测量的点来计算的。</li>
    </ul>
  </div>`;
}

function renderSmithRankPanel() {
  const panel = document.getElementById("smithPanelRank");
  if (!panel) return;
  if (panel.dataset.built) return;
  panel.dataset.built = "1";
  const codes = DEFAULT_WATCHLIST.map((w) => w.code).join(", ");
  panel.innerHTML = `
  <div class="card" style="margin-bottom:12px">
    <h3 style="margin:0 0 4px">🏆 公司排名：质量、增长、价格和预期</h3>
    <p class="muted" style="margin:0 0 10px">每家公司都会获得 0 到 10 分的四个分数。通过这种方法，您可以决定每个分数的权重：只看质量（纯粹的 Terry Smith 方法：它是一家好公司吗？），或者将其与其他因素结合起来，看看哪家公司在今天的价格下看起来是不错的投资。</p>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px" class="smith-chips">
      <div class="dim-chip"><b>🏅 质量评分40%</b><br><span class="muted">Terry Smith 的评分</span></div>
      <div class="dim-chip"><b>📈 增长20%</b><br><span class="muted">历史销售额、每股收益和每股自由现金流</span></div>
      <div class="dim-chip"><b>💰 估值20%</b><br><span class="muted">市盈率、自由现金流盈利能力（相对其历史水平暂不可用，见下）</span></div>
      <div class="dim-chip"><b>✨ 预期增长20%</b><br><span class="muted">分析师预计增长潜力可达目标价</span></div>
    </div>
  </div>
  <div class="card">
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
      <label class="muted">从…加载</label>
      <select id="smithRankSource" style="padding:8px 10px;border:1px solid var(--line);border-radius:6px;font-size:14px">
        <option value="watchlist">自选列表（12 只）</option>
      </select>
      <button class="primary" id="smithRankLoadBtn" style="padding:8px 16px;border:none;border-radius:8px;background:var(--blue);color:#fff;font-size:13px">▶ 分析</button>
    </div>
    <div class="muted" style="margin-bottom:4px">股票代码之间用逗号、空格或换行分隔（最多 100 个）</div>
    <textarea id="smithRankCodes" rows="3" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:6px;font-size:14px">${esc(codes)}</textarea>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-top:10px">
      <button class="primary" id="smithRankPresetBtn" style="padding:8px 16px;border:none;border-radius:8px;background:var(--blue);color:#fff;font-size:13px">📋 上传100家优质公司</button>
      <div class="dcf-field"><label>地平线</label>
        <select id="smithRankHorizon" style="padding:8px 10px;border:1px solid var(--line);border-radius:6px;font-size:14px">
          <option value="10">10年</option><option value="5">5年</option>
        </select></div>
      <div class="dcf-field"><label>方法</label>
        <select id="smithRankMethod" style="padding:8px 10px;border:1px solid var(--line);border-radius:6px;font-size:14px">
          <option value="balanced">⚖️ 均衡（40/20/20/20）</option>
          <option value="quality">只看质量（100/0/0/0）</option>
        </select></div>
      <button class="primary" id="smithRankRunBtn" style="padding:8px 18px;border:none;border-radius:8px;background:var(--orange,#e8912d);color:#fff;font-size:14px">计算排名</button>
    </div>
    <div id="smithRankStatus" class="muted" style="margin-top:10px"></div>
    <div id="smithRankResult" style="margin-top:10px"></div>
    <p class="muted" style="margin-top:8px">口径：估值分量暂不含 EV/EBITDA（折旧摊销未从公开接口获得）与相对历史水平（无免费长周期 PE 历史源），只用 PE-TTM 绝对档位与自由现金流收益率；预期分量只用近 90 天内有研报的股票，无研报的票该项 N/A、按其余三项加权计分。排名逐只顺序拉取，失败的票单独标原因、不拖垮整表。</p>
  </div>`;
  document.getElementById("smithRankLoadBtn").addEventListener("click", () => {
    document.getElementById("smithRankCodes").value = DEFAULT_WATCHLIST.map((w) => w.code).join(", ");
  });
  document.getElementById("smithRankPresetBtn").addEventListener("click", () => {
    document.getElementById("smithRankCodes").value = DEFAULT_WATCHLIST.map((w) => w.code).join(", ");
    document.getElementById("smithRankStatus").textContent = "本站优质公司名单即 12 只自选股（暂无 100 家名单），已填入文本框，可自行增删代码后计算排名。";
  });
  document.getElementById("smithRankRunBtn").addEventListener("click", runSmithRank);
}

async function runSmithRank() {
  if (smithRankBusy) return;
  const statusEl = document.getElementById("smithRankStatus");
  const resultEl = document.getElementById("smithRankResult");
  const raw = (document.getElementById("smithRankCodes").value || "");
  const codes = [...new Set(raw.split(/[\s,;，、]+/).map((s) => (s.match(/(\d{6})/) || [null, s.trim()])[1]).filter(Boolean))].slice(0, 100);
  if (!codes.length) { statusEl.textContent = "请先输入股票代码。"; return; }
  const horizon = parseInt((document.getElementById("smithRankHorizon") || {}).value || "10", 10) || 10;
  const method = (document.getElementById("smithRankMethod") || {}).value || "balanced";
  smithRankBusy = true;
  const rows = [];
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    statusEl.textContent = "正在计算第 " + (i + 1) + " / " + codes.length + " 只：" + code + " …";
    try {
      let d, m, reps;
      if (currentData && currentData.code === code && currentMetrics) {
        d = currentData; m = currentMetrics;
        reps = await fetchReports(code, 90, 3).catch(() => []);
      } else {
        const mini = await smithFetchMinimal(code);
        const q = mini.quote || {};
        d = { code, quote: mini.quote, income: mini.income, incomeFull: mini.incomeFull, balance: mini.balance, cashflow: mini.cashflow, profile: null };
        m = calcMetrics(d);
        reps = mini.reports || [];
        if (!mini.income || !mini.income.length) throw new Error("无财报数据（ETF/指数类或接口未返回）");
      }
      const name = (d.profile && d.profile.ORG_NAME) || (DEFAULT_WATCHLIST.find((w) => w.code === code) || {}).name || (d.quote && d.quote.name) || code;
      const comp = smithRankComponents(d, m, reps, horizon);
      const total = smithRankTotal(comp, method);
      rows.push({ code, name, comp, total, ok: true });
    } catch (e) {
      rows.push({ code, name: (DEFAULT_WATCHLIST.find((w) => w.code === code) || {}).name || code, comp: null, total: null, ok: false, reason: String(e && e.message || e) });
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  smithRankBusy = false;
  rows.sort((a, b) => (b.total == null ? -1 : a.total == null ? 1 : b.total - a.total));
  const fmt1 = (v) => v == null ? "—" : v.toFixed(1);
  statusEl.textContent = "已完成 " + rows.length + " 只（" + rows.filter((r) => r.ok).length + " 只算通，" + rows.filter((r) => !r.ok).length + " 只暂不可用）。";
  resultEl.innerHTML = `<table class="tbl"><tr><th>排名</th><th>代码</th><th style="text-align:left">名称</th><th>质量40%</th><th>增长20%</th><th>估值20%</th><th>预期20%</th><th>综合</th><th style="text-align:left">备注</th></tr>` +
    rows.map((r, i) => r.ok
      ? `<tr><td>${r.total == null ? "—" : i + 1}</td><td>${esc(r.code)}</td><td style="text-align:left"><a href="#" data-smith-jump="${esc(r.code)}">${esc(r.name)}</a></td>
        <td class="num">${fmt1(r.comp.quality)}</td><td class="num">${fmt1(r.comp.growth)}</td><td class="num">${fmt1(r.comp.valuation)}</td><td class="num">${fmt1(r.comp.expected)}</td>
        <td class="num"><b>${r.total == null ? "—" : r.total.toFixed(1)}</b></td>
        <td style="text-align:left" class="muted">${esc(r.comp.expectedNote || "")}</td></tr>`
      : `<tr><td>—</td><td>${esc(r.code)}</td><td style="text-align:left">${esc(r.name)}</td><td class="num muted" colspan="5">暂不可用</td><td style="text-align:left" class="muted">${esc(r.reason || "")}</td></tr>`).join("") + `</table>`;
  resultEl.querySelectorAll("[data-smith-jump]").forEach((a) => {
    a.addEventListener("click", (ev) => { ev.preventDefault(); loadStock(a.dataset.smithJump); });
  });
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
          ${ann.usable ? metricCard("近 " + ann.completeYears + " 个完整年份年化", (ann.cagr * 100).toFixed(1) + "%", ann.completeFromYear + "–" + ann.value10000ToYear) : ""}
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
// ---------- 切到个股仪表盘（唯一入口，复用 loadStock）----------
// 热力图方框、低估雷达代码链接都走这里：切到概况标签页并加载该股。
function switchToStock(code) {
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === "overview"));
  document.querySelectorAll(".tab-pane").forEach((p) => p.classList.toggle("active", p.id === "pane-overview"));
  document.getElementById("toolArea").style.display = "none";
  document.getElementById("detailArea").style.display = "block";
  document.querySelectorAll("#toolTabs button").forEach((b) => b.classList.remove("active"));
  syncSidebarActive();
  window.scrollTo(0, 0);
  loadStock(code);
}

// ---------- 热力图（指数成分股树图）----------
// 颜色：红色上涨 / 绿色下跌（与本站一致，复用 heatColor；不是截图的绿涨红跌）。
// 方框面积 = 总市值（f20）；分组 = 申万二级行业（f100）；点击方框进该股仪表盘。
const HM_INDEXES = [
  { code: "000300", name: "沪深300" },
  { code: "000001", name: "上证指数" },
  { code: "399001", name: "深证成指" },
  { code: "399006", name: "创业板指" },
  { code: "000688", name: "科创50" },
  { code: "000905", name: "中证500" },
];
// 周期字段均经 2026-11-09 茅台实测（见 api.js fetchEmQuotesBatch 注释）：
// 天=f3 当日、周=f109 5日、月=f110 20日、年=f160 年初至今。
const HM_PERIODS = [
  { key: "day", name: "天", field: "changePct", note: "当日涨跌幅" },
  { key: "week", name: "周", field: "chg5d", note: "近 5 日涨跌幅" },
  { key: "month", name: "月", field: "chg20d", note: "近 20 日涨跌幅" },
  { key: "year", name: "年", field: "chgYtd", note: "年初至今涨跌幅" },
];
const HM_DISPLAY_CAP = 400; // 单个指数最多显示只数（上证指数成分 2255 只，只取总市值前 400）
let hmIndex = "000300";
let hmPeriod = "day";
const hmCache = {}; // indexCode -> { stocks, total, capped, fetchedAt, maxUpdatedAt }
let hmResizeTimer = null;
let hmResizeBound = false;
function bindHmResizeOnce() {
  if (hmResizeBound || typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  hmResizeBound = true;
  window.addEventListener("resize", () => {
    clearTimeout(hmResizeTimer);
    hmResizeTimer = setTimeout(() => {
      if (hmCache[hmIndex] && document.getElementById("toolArea").style.display === "block") {
        const idx = HM_INDEXES.find((i) => i.code === hmIndex) || HM_INDEXES[0];
        const per = HM_PERIODS.find((p) => p.key === hmPeriod) || HM_PERIODS[0];
        drawHeatmapTreemap(hmCache[hmIndex], idx, per);
      }
    }, 300);
  });
}
// Squarified 树图布局（纯 JS，不引库）：输入按 value 降序，输出每项 {item, x, y, w, h}。
// 先把 value 归一化到容器面积，再按经典 squarify 算法沿较长边逐行排布。
function squarifyLayout(items, x, y, w, h) {
  const rects = [];
  const total = items.reduce((s, it) => s + (it.value > 0 ? it.value : 0), 0);
  if (!items.length || total <= 0 || w <= 0 || h <= 0) return rects;
  const k = (w * h) / total;
  const nodes = items.filter((it) => it.value > 0).map((it) => ({ item: it, v: it.value * k }));
  let cx = x, cy = y, cw = w, ch = h, row = [], rowSum = 0;
  const worst = (r, sum, side) => {
    let mx = -Infinity, mn = Infinity;
    for (const n of r) { if (n.v > mx) mx = n.v; if (n.v < mn) mn = n.v; }
    return Math.max((side * side * mx) / (sum * sum), (sum * sum) / (side * side * mn));
  };
  const flushRow = () => {
    if (!row.length) return;
    if (cw >= ch) {
      const rh = rowSum / cw;
      let rx = cx;
      for (const n of row) {
        const rw = n.v / rh;
        rects.push({ item: n.item, x: rx, y: cy, w: rw, h: rh });
        rx += rw;
      }
      cy += rh; ch -= rh;
    } else {
      const rw = rowSum / ch;
      let ry = cy;
      for (const n of row) {
        const rh2 = n.v / rw;
        rects.push({ item: n.item, x: cx, y: ry, w: rw, h: rh2 });
        ry += rh2;
      }
      cx += rw; cw -= rw;
    }
    row = []; rowSum = 0;
  };
  for (const n of nodes) {
    const side = Math.max(cw, ch);
    if (!row.length) { row = [n]; rowSum = n.v; continue; }
    const cur = worst(row, rowSum, side);
    const nxt = worst([...row, n], rowSum + n.v, side);
    if (nxt <= cur) { row.push(n); rowSum += n.v; }
    else { flushRow(); row = [n]; rowSum = n.v; }
  }
  flushRow();
  return rects;
}
async function renderHeatmap() {
  bindHmResizeOnce();
  const el = document.getElementById("heatmapBody");
  const idx = HM_INDEXES.find((i) => i.code === hmIndex) || HM_INDEXES[0];
  const per = HM_PERIODS.find((p) => p.key === hmPeriod) || HM_PERIODS[0];
  el.innerHTML = `<div class="loading">正在加载${esc(idx.name)}成分股行情…</div>`;
  try {
    let data = hmCache[hmIndex];
    if (!data) {
      const cons = await fetchIndexConstituents(hmIndex);
      if (!cons.length) throw new Error(idx.name + "成分拉取为空");
      const quotes = await fetchEmQuotesChunked(cons.map((c) => c.code));
      let stocks = cons.map((c) => {
        const q = quotes[c.code] || {};
        return { code: c.code, name: q.name || c.name, price: q.price, changePct: q.changePct, chg5d: q.chg5d, chg20d: q.chg20d, chg60d: q.chg60d, chgYtd: q.chgYtd, totalMcap: q.totalMcap || 0, industry: q.industry || "未分类", updatedAt: q.updatedAt };
      }).filter((s) => s.totalMcap > 0);
      stocks.sort((a, b) => b.totalMcap - a.totalMcap);
      const capped = stocks.length > HM_DISPLAY_CAP;
      if (capped) stocks = stocks.slice(0, HM_DISPLAY_CAP);
      data = { stocks, total: cons.length, capped, fetchedAt: new Date(), maxUpdatedAt: Math.max(0, ...stocks.map((s) => s.updatedAt || 0)) };
      hmCache[hmIndex] = data;
    }
    drawHeatmapTreemap(data, idx, per);
  } catch (e) {
    el.innerHTML = `<p class="muted">热力图暂不可用（${esc(e.message || e)}）。<a href="#" id="heatmapRetry">重试</a></p>`;
    document.getElementById("heatmapRetry").addEventListener("click", (ev) => { ev.preventDefault(); delete hmCache[hmIndex]; renderHeatmap(); });
  }
}
function drawHeatmapTreemap(data, idx, per) {
  const el = document.getElementById("heatmapBody");
  const meta = document.getElementById("heatmapMeta");
  const wrapW = el.clientWidth || 1000;
  const wrapH = Math.round(Math.max(420, Math.min(620, wrapW * 0.62)));
  const groups = {};
  for (const s of data.stocks) {
    const g = s.industry || "未分类";
    (groups[g] = groups[g] || { name: g, value: 0, stocks: [] });
    groups[g].value += s.totalMcap;
    groups[g].stocks.push(s);
  }
  const groupList = Object.values(groups).sort((a, b) => b.value - a.value);
  for (const g of groupList) {
    g.stocks.sort((a, b) => b.totalMcap - a.totalMcap);
    let wsum = 0, vsum = 0;
    for (const s of g.stocks) {
      const v = s[per.field];
      if (v != null && isFinite(v)) { wsum += v * s.totalMcap; vsum += s.totalMcap; }
    }
    g.chg = vsum ? wsum / vsum : null;
  }
  const groupRects = squarifyLayout(groupList, 0, 0, wrapW, wrapH);
  let tiles = "";
  let labels = "";
  for (const gr of groupRects) {
    const g = gr.item;
    const stockRects = squarifyLayout(g.stocks.map((s) => ({ ...s, value: s.totalMcap })), gr.x, gr.y, gr.w, gr.h);
    for (const sr of stockRects) {
      const s = sr.item;
      const pct = s[per.field];
      const c = heatColor(pct);
      const showName = sr.w >= 52 && sr.h >= 34;
      const showPct = sr.w >= 30 && sr.h >= 18;
      tiles += `<div class="hm-tile" data-code="${esc(s.code)}" style="left:${sr.x.toFixed(1)}px;top:${sr.y.toFixed(1)}px;width:${sr.w.toFixed(1)}px;height:${sr.h.toFixed(1)}px;background:${c.bg};color:${c.fg}" title="${esc(s.name)} ${esc(s.code)} ${pct != null ? (pct > 0 ? "+" : "") + pct.toFixed(2) + "%" : ""} · 总市值 ${fmtMoney(s.totalMcap)}">${showName ? `<span class="hm-name">${esc(s.name)}</span>` : ""}${showPct ? `<span class="hm-pct">${pct != null ? (pct > 0 ? "+" : "") + pct.toFixed(1) + "%" : "—"}</span>` : ""}</div>`;
    }
    if (gr.w >= 110 && gr.h >= 34) {
      labels += `<div class="hm-group-label" style="left:${(gr.x + 4).toFixed(1)}px;top:${(gr.y + 3).toFixed(1)}px">${esc(g.name)}${g.chg != null ? " " + (g.chg > 0 ? "+" : "") + g.chg.toFixed(2) + "%" : ""}</div>`;
    }
  }
  const upd = data.maxUpdatedAt ? new Date(data.maxUpdatedAt * 1000) : data.fetchedAt;
  const updStr = upd.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  meta.innerHTML = `数据时间 ${esc(updStr)} · ${esc(idx.name)}成分 ${data.total} 只${data.capped ? "，本图仅显示总市值前 " + HM_DISPLAY_CAP + " 只" : "，共 " + data.stocks.length + " 只"} · ${esc(per.note)} · <b>红色上涨 / 绿色下跌</b> · 方框面积 = 总市值 · 点击方框查看该股分析`;
  el.innerHTML = `<div class="hm-treemap" style="height:${wrapH}px">${tiles}${labels}</div>`;
  el.querySelectorAll(".hm-tile").forEach((t) => t.addEventListener("click", () => switchToStock(t.dataset.code)));
}

// ---------- 低估雷达 v10 ----------
// 实现已移至 js/radar.js（评估差距 + 股息雷达）；TOOL_LOADERS 仍引用全局 renderRadar。

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

// ---------- 我的图形 ----------
// v12：实现已移到 js/mycharts.js（构建器 + 指标序列 + 双轴画图），
// 存储键仍是 af_mycharts，v2 的 K 线快照旧数据照常读出。
// renderMycharts / loadMyCharts / saveMyCharts / saveCurrentChart 均在该文件定义。
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

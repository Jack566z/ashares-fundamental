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
    let movers = await fetchMovers(12);
    if (!movers.length) movers = await fetchMovers(12);
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
document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-tab]");
  if (!btn) return;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b === btn));
  document.querySelectorAll(".tab-pane").forEach((p) => p.classList.toggle("active", p.id === "pane-" + btn.dataset.tab));
  const fn = CHART_TABS[btn.dataset.tab];
  if (fn && currentData) fn();
});
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
  const rows = [
    ["公司名称", q.name || (data.tx && data.tx.name) || "—"],
    ["代码", currentCode + " · " + (txMarket(currentCode) === "sh" ? "上交所" : txMarket(currentCode) === "sz" ? "深交所" : "北交所")],
    ["行业", m.industry || "—"],
    ["地域", q.region || "—"],
    ["概念/题材", m.concepts || "—"],
    ["总市值", fmtMoney(m.totalMcap)],
    ["流通市值", fmtMoney(m.floatMcap)],
    ["总股本", m.totalShares ? fmtMoney(m.totalShares) + " 股" : "—"],
    ["每股净资产 BPS", data.income && data.income[0] ? num2(num(data.income[0].BPS)) + " 元" : "—"],
    ["加权 ROE（最新年报）", data.income && data.income[0] ? pct1(num(data.income[0].WEIGHTAVG_ROE) / 100) : "—"],
    ["公司描述", "暂不可用 — 公司简介、CEO、员工数、官网未从东财/腾讯公开接口获得"],
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
      <tr><td>52 周最高 / 最低</td><td class="num">${num2(t.high52)} / ${num2(t.low52)}</td></tr></table>`;
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
    <p class="muted" style="margin-top:10px">行业内同行对比（公司 vs 行业中位数、行业 PER vs 历史中位数）：<span class="badge">暂不可用</span> 行业成分股名单与行业汇总数据未从东财/腾讯免费接口获得。作为替代，下方“周期性”给出 vs 沪深300 的 Beta 与相对表现。</p>`;
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

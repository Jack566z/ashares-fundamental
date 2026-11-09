// ============================================================
// 沪深300指数目标价格 + 沪深300年度回报（v8，按 AleInversor 图版重做）
// 目标价：成分股模型目标价（估值回归 + EPS预测取中值），非分析师一致目标价；
//   A 股没有免费的一致目标价源，口径在页上写明，不假装是分析师目标价。
// 年度回报：价格档用沪深300价格 K 线（2005 年起，基日 2004-12-31 基点 1000）；
//   含股息档用沪深300全收益指数 H00948，拉不到时标暂不可用，不编数。
// ============================================================

// ---------- 成分股模型目标价（纯函数，可单测） ----------
// rows: [{code, name, industry, price, peTtm}]（price/PE-TTM 来自腾讯 qt）
// peWeighted: 成分股市值加权 PE；growth: 盈利增速 g（可为 null，此时目标价不含盈利增长）
// reportMap: fetchReportsBulk 的 map，{code: {count, epsNext}}
// 方法：① 估值回归法 = TTM EPS × (1+g) × 指数加权 PE；② EPS 预测法 = 分析师预测明年 EPS × 指数加权 PE。
//   目标价取可用方法的中值（1 个取本身，2 个取均值）；DCF 需逐只自由现金流，批量算不出，未纳入。
function calcHs300ConstituentTargets(rows, peWeighted, growth, reportMap) {
  const g = growth != null && isFinite(growth) ? growth : 0;
  return rows.map((r) => {
    const rep = reportMap ? reportMap[r.code] : null;
    const epsTtm = (r.peTtm > 0 && r.price > 0) ? r.price / r.peTtm : null;
    let targetA = null, targetB = null;
    if (epsTtm != null && peWeighted > 0) targetA = epsTtm * peWeighted * (1 + g);
    if (rep && rep.epsNext != null && peWeighted > 0) targetB = rep.epsNext * peWeighted;
    const vals = [targetA, targetB].filter((v) => v != null && v > 0 && isFinite(v));
    const target = vals.length === 1 ? vals[0] : vals.length === 2 ? (vals[0] + vals[1]) / 2 : null;
    return {
      ...r, epsTtm, targetA, targetB, target,
      upside: target != null && r.price > 0 ? target / r.price - 1 : null,
      methods: (targetA != null ? "估值回归" : "") + (targetB != null ? (targetA != null ? "+EPS预测" : "EPS预测") : ""),
      comments: rep ? rep.count : 0,
    };
  });
}

// ---------- 盈利增速 g：前 50 大市值成分股归母利润同比聚合（沿用 v2 口径） ----------
async function fetchHs300Growth(top50) {
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
      byDate[d][r.SECURITY_CODE] = parseFloat(r.PARENT_NETPROFIT);
    }
    const dates = Object.keys(byDate).sort().reverse();
    const d1 = dates[0];
    const d0 = dates.find((d) => d.slice(5) === (d1 || "").slice(5) && Number(d.slice(0, 4)) === Number((d1 || "").slice(0, 4)) - 1);
    if (d1 && d0) {
      const common = Object.keys(byDate[d1]).filter((c) => byDate[d0][c] != null && byDate[d1][c] != null && isFinite(byDate[d0][c]) && isFinite(byDate[d1][c]));
      const s1 = common.reduce((a, c) => a + byDate[d1][c], 0);
      const s0 = common.reduce((a, c) => a + byDate[d0][c], 0);
      if (s0 && common.length) {
        growth = s1 / s0 - 1;
        growthNote = "前 50 大市值成分股中 " + common.length + " 只纳入（" + d1 + " 累计归母利润 vs " + d0 + " 同期）";
      }
    }
    if (growth == null) growthNote = "未取到可比的两期利润数据（datacenter 返回为空或报告期不匹配）；成分股目标价暂按 g=0 计算";
  } catch (e2) {
    growthNote = "利润聚合失败：" + (e2.message || e2) + "；成分股目标价暂按 g=0 计算";
  }
  return { growth, growthNote };
}

// ---------- 沪深300指数目标价格 ----------
let hs300TargetState = null;
const HS300_REPORT_PERIODS = { 30: "上个月", 90: "上个季度", 365: "去年" };

async function renderHs300Target() {
  const el = document.getElementById("hs300TargetBody");
  if (hs300TargetState && hs300TargetState.done) { renderHs300TargetView(); return; }
  el.innerHTML = `<div class="loading">正在加载沪深300成分股与行情…</div>`;
  try {
    const iq = await fetchTxQuotes([API.HS300_CODE]);
    const idxQ = iq[API.HS300_CODE] || {};
    const price = idxQ.price || null;
    const indexPeTx = idxQ.peTtm || null;
    if (price == null) throw new Error("沪深300现价未取到（腾讯 qt 返回空）");
    const cons = await fetchHs300Constituents();
    if (!cons.length) throw new Error("成分股列表无数据（datacenter RPT_INDEX_CONSTITUENT 返回空）");
    const [txQ, emQ] = await Promise.all([
      fetchTxQuotesChunked(cons.map((c) => c.code)),
      fetchEmQuotesChunked(cons.map((c) => c.code)).catch(() => ({})),
    ]);
    const rows = cons.map((c) => {
      const q = txQ[c.code] || {};
      const eq = emQ[c.code] || {};
      return {
        code: c.code, name: c.name,
        industry: eq.industry || "未分类",
        price: q.price != null ? q.price : null,
        peTtm: q.peTtm > 0 ? q.peTtm : null,
        totalMcap: q.totalMcapYi != null ? q.totalMcapYi * 1e8 : null,
      };
    });
    const withVal = rows.filter((r) => r.peTtm != null && r.totalMcap != null && r.totalMcap > 0);
    if (!withVal.length) throw new Error("成分股 PE/市值未取到（腾讯 qt 返回空）");
    const sumMcap = withVal.reduce((a, c) => a + c.totalMcap, 0);
    const sumEarn = withVal.reduce((a, c) => a + c.totalMcap / c.peTtm, 0);
    const peWeighted = sumEarn > 0 ? sumMcap / sumEarn : null;
    const top50 = [...withVal].sort((a, b) => b.totalMcap - a.totalMcap).slice(0, 50);
    const { growth, growthNote } = await fetchHs300Growth(top50);
    // 数据日期：东财批量行情最新更新时间戳，取不到则用今天
    let dataDate = new Date();
    const tsList = Object.values(emQ).map((q) => q.updatedAt).filter((t) => t > 0);
    if (tsList.length) dataDate = new Date(Math.max(...tsList) * 1000);
    const fmtDate = dataDate.getFullYear() + "年" + (dataDate.getMonth() + 1) + "月" + dataDate.getDate() + "日";
    // 研报（默认 90 天窗口）
    let reportMap = {}, reportNote = "";
    try {
      const rb = await fetchReportsBulk(90, 5);
      reportMap = rb.map;
      reportNote = "近 90 天最新 " + rb.total + " 篇研报已覆盖 " + Object.keys(rb.map).length + " 只成分股";
    } catch (e) {
      reportNote = "研报未取到（" + (e.message || e) + "），评论数与 EPS 预测法暂不可用";
    }
    hs300TargetState = {
      done: true, price, indexPeTx, cons, rows, withVal, peWeighted, growth, growthNote,
      reportMaps: { 90: reportMap }, reportNote, period: 90, dataDate: fmtDate,
      filters: { q: "", industry: "全部", minComments: 0, dir: "all" }, page: 1, pageSize: 50,
    };
    renderHs300TargetView();
  } catch (e) {
    el.innerHTML = `<p class="muted">沪深300指数目标价格暂不可用（${esc(e.message || e)}）。成分股/行情接口偶发限流，可点“重试”。目标点位公式：当前点位 × (1+g) × (目标 PE ÷ 当前加权 PE)。<a href="#" id="hs300TgtRetry">重试</a></p>`;
    document.getElementById("hs300TgtRetry").addEventListener("click", (ev) => { ev.preventDefault(); hs300TargetState = null; renderHs300Target(); });
  }
}

function hs300TargetComputed() {
  const st = hs300TargetState;
  const targets = calcHs300ConstituentTargets(st.rows, st.peWeighted, st.growth, st.reportMaps[st.period] || {});
  const valid = targets.filter((t) => t.upside != null);
  const ups = valid.map((t) => t.upside).sort((a, b) => a - b);
  const median = ups.length % 2 ? ups[(ups.length - 1) / 2] : (ups[ups.length / 2 - 1] + ups[ups.length / 2]) / 2;
  const upN = valid.filter((t) => t.upside > 0).length;
  const maxRow = valid.length ? valid.reduce((a, b) => (b.upside > a.upside ? b : a)) : null;
  const minRow = valid.length ? valid.reduce((a, b) => (b.upside < a.upside ? b : a)) : null;
  const idxRes = calcHs300Target(st.price, st.peWeighted, st.growth, st.peWeighted);
  return { targets, valid, median, upN, maxRow, minRow, idxRes };
}

function hs300TargetFiltered() {
  const st = hs300TargetState;
  const { targets } = hs300TargetComputed();
  const q = st.filters.q.trim();
  let list = targets.filter((t) => {
    if (q && !(t.code.includes(q) || (t.name || "").includes(q))) return false;
    if (st.filters.industry !== "全部" && t.industry !== st.filters.industry) return false;
    if (st.filters.minComments === 1 && !(t.comments >= 1)) return false;
    if (st.filters.dir === "up" && !(t.upside != null && t.upside > 0)) return false;
    if (st.filters.dir === "down" && !(t.upside != null && t.upside < 0)) return false;
    return true;
  });
  list.sort((a, b) => {
    if (a.upside == null && b.upside == null) return 0;
    if (a.upside == null) return 1;
    if (b.upside == null) return -1;
    return b.upside - a.upside;
  });
  return list;
}

function renderHs300TargetView() {
  const st = hs300TargetState;
  const el = document.getElementById("hs300TargetBody");
  const { valid, median, upN, maxRow, minRow, idxRes } = hs300TargetComputed();
  const pctUp = valid.length ? (upN / valid.length * 100) : null;
  const statCard = (label, value, sub, cls) => `<div class="hs300-stat"><div class="hs300-stat-k">${esc(label)}</div><div class="hs300-stat-v ${cls || ""}">${value}</div><div class="hs300-stat-s">${esc(sub || "")}</div></div>`;
  const industries = ["全部", ...new Set(st.rows.map((r) => r.industry))].sort((a, b) => (a === "全部" ? -1 : b === "全部" ? 1 : String(a).localeCompare(String(b), "zh")));
  const list = hs300TargetFiltered();
  const pages = Math.max(1, Math.ceil(list.length / st.pageSize));
  if (st.page > pages) st.page = pages;
  const pageRows = list.slice((st.page - 1) * st.pageSize, st.page * st.pageSize);
  const pctFmt = (v) => v == null ? "—" : (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%";
  const priceBar = (t) => {
    if (t.target == null || !t.price) return `<span class="muted">—</span>`;
    const ratio = t.price / t.target;
    const pos = Math.max(2, Math.min(100, ratio / 1.3 * 100));
    const cls = t.upside > 0 ? "up" : "down";
    return `<div class="price-bar"><i class="price-bar-fill ${cls}" style="width:${pos}%"></i><i class="price-bar-dot" style="left:${pos}%"></i><i class="price-bar-tick" style="left:76.9%"></i></div>`;
  };
  el.innerHTML = `
  <p class="muted" style="margin-bottom:10px">模型目标价与当前价的比较，点击代码可查看公司详情。目标价是本站模型价，不是分析师一致目标价（A 股没有免费的一致目标价数据源）。</p>
  <div class="hs300-datebar">📅 此列表日期为<strong>${esc(st.dataDate)}</strong>。目标价格与研报均为当日数据。</div>
  <div class="hs300-cards">
    ${statCard("目标点位", idxRes.usable ? idxRes.target.toFixed(2) + " 点" : "—", idxRes.usable ? "当前 " + st.price.toFixed(2) + " 点 · " + st.withVal.length + " 只成分股纳入（共 300 只）" : "算不出：" + idxRes.reason, idxRes.usable && idxRes.target >= st.price ? "up" : "down")}
    ${statCard("中等潜力", pctFmt(median), "成分股目标价较现价的中位数", median != null && median >= 0 ? "up" : "down")}
    ${statCard("具有上涨潜力", pctUp != null ? pctUp.toFixed(0) + "%" : "—", upN + " 只成分股的目标价高于现价", "up")}
    ${statCard("更大潜力", maxRow ? pctFmt(maxRow.upside) : "—", maxRow ? maxRow.code + " · " + maxRow.name : "", "up")}
    ${statCard("更大下行潜力", minRow ? pctFmt(minRow.upside) : "—", minRow ? minRow.code + " · " + minRow.name : "", "down")}
  </div>
  <div class="hs300-filterbar">
    <div class="hs300-seg" id="hs300PeriodSeg">${Object.entries(HS300_REPORT_PERIODS).map(([d, label]) => `<button data-period="${d}" class="${String(st.period) === d ? "active" : ""}">${label}</button>`).join("")}</div>
    <input id="hs300Search" type="text" placeholder="搜索股票或公司…" value="${esc(st.filters.q)}">
    <select id="hs300Industry">${industries.map((i) => `<option ${st.filters.industry === i ? "selected" : ""}>${esc(i)}</option>`).join("")}</select>
    <select id="hs300MinComments"><option value="0" ${st.filters.minComments === 0 ? "selected" : ""}>任意评论数</option><option value="1" ${st.filters.minComments === 1 ? "selected" : ""}>≥ 1 条评论</option></select>
    <div class="hs300-seg" id="hs300DirSeg">
      <button data-dir="all" class="${st.filters.dir === "all" ? "active" : ""}">全部</button>
      <button data-dir="up" class="${st.filters.dir === "up" ? "active" : ""}">具有潜力</button>
      <button data-dir="down" class="${st.filters.dir === "down" ? "active" : ""}">向下</button>
    </div>
    <span class="muted" style="margin-left:auto">${list.length} 只成分股</span>
  </div>
  <div style="overflow-x:auto">
  <table class="tbl"><tr><th>股票</th><th>公司</th><th>部门</th><th>价格</th><th>目标价（模型中值）</th><th>区别 ▼</th><th>价格对比</th><th>评论</th></tr>
  ${pageRows.map((t) => `<tr>
    <td><a href="#" data-hs300-code="${esc(t.code)}">${esc(t.code)}</a></td>
    <td style="text-align:left">${esc(t.name)}</td>
    <td style="text-align:left">${esc(t.industry)}</td>
    <td class="num">${t.price != null ? t.price.toFixed(2) + " 元" : "—"}</td>
    <td class="num">${t.target != null ? t.target.toFixed(2) + " 元" : "—"}</td>
    <td class="num">${t.upside != null ? `<span class="updown-chip ${t.upside >= 0 ? "up" : "down"}">${pctFmt(t.upside)}</span>` : "—"}</td>
    <td>${priceBar(t)}</td>
    <td class="num">${t.comments}</td>
  </tr>`).join("")}
  </table></div>
  <div class="hs300-pager">
    <button id="hs300Prev" ${st.page <= 1 ? "disabled" : ""}>上一页</button>
    <span class="muted">第 ${st.page} / ${pages} 页 · 共 ${list.length} 只（${st.withVal.length} 只算出目标价）</span>
    <button id="hs300Next" ${st.page >= pages ? "disabled" : ""}>下一页</button>
  </div>
  <div class="card" style="margin-top:14px">
    <h3 style="margin-bottom:8px">指数目标点位试算 <span class="muted" style="font-weight:400">改目标 PE 看估值修复/压缩情景</span></h3>
    <div class="metrics" style="margin-bottom:10px">
      ${metricCard("当前点位", st.price != null ? st.price.toFixed(2) : "—", "腾讯实时行情")}
      ${metricCard("成分股加权 PE", st.peWeighted != null ? st.peWeighted.toFixed(2) + " 倍" : "—", "市值加权调和口径，" + st.withVal.length + " 只纳入")}
      ${metricCard("腾讯指数 PE（核对）", st.indexPeTx != null ? st.indexPeTx.toFixed(2) + " 倍" : "—", "腾讯 q=sh000300 [39] PE-TTM")}
      ${metricCard("盈利增速 g", st.growth != null ? (st.growth >= 0 ? "+" : "") + (st.growth * 100).toFixed(1) + "%" : "—", st.growthNote)}
    </div>
    <div class="dcf-grid">
      <div class="dcf-field"><label>目标 PE（倍，默认=当前加权 PE）</label><input id="hs300TargetPe" type="number" step="0.5" min="1" max="60" value="${st.peWeighted != null ? st.peWeighted.toFixed(1) : ""}"></div>
    </div>
    <button class="primary" id="hs300CalcBtn" style="padding:9px 18px;border:none;border-radius:8px;background:var(--blue);color:#fff;font-size:14px">重新计算</button>
    <div id="hs300TargetResult" style="margin-top:12px">${hs300TargetCalcHTML(st.peWeighted)}</div>
  </div>
  <p class="muted" style="margin-top:10px"><b>解读方法：</b>目标价是本站模型价（非分析师一致目标价）：每只成分股取以下可用方法的中间值——① 估值回归法：TTM EPS（现价 ÷ PE-TTM）× (1+g) × 指数加权 PE；② EPS 预测法：分析师预测明年 EPS × 指数加权 PE（仅窗口内有研报覆盖的股票可用）。DCF 法需逐只自由现金流，批量算不出，未纳入。区别 = 目标价相对现价的涨跌幅；趋势列已去掉：无免费历史目标价数据源，分析师上调/下调目标价算不出。</p>
  <p class="muted">评论数 = 东财研报库最新 500 篇研报中该股的篇数（窗口内全市场研报远超 500 篇，计数为下限，仅供参考）；${esc(st.reportNote)}。成分股名单来自东财 datacenter RPT_INDEX_CONSTITUENT（300 只）；价格与 PE-TTM 来自腾讯 qt；行业为申万二级（东财批量行情 f100，取不到时显示“未分类”）。指数目标点位公式：当前点位 × (1+g) × (目标 PE ÷ 当前加权 PE)，g 为前 50 大市值成分股归母净利润同比聚合；目标 PE 默认等于当前加权 PE，即“估值不变、只赚盈利增长的钱”情景。</p>
  <p class="muted">⚠️ 本信息仅供参考和教育用途，不构成投资建议。评分和模型均基于一般参数估算，并不保证未来收益。请务必咨询合格的财务顾问。</p>`;
  // 事件绑定
  el.querySelectorAll("[data-hs300-code]").forEach((a) => a.addEventListener("click", (ev) => { ev.preventDefault(); switchToStock(a.dataset.hs300Code); }));
  document.getElementById("hs300Search").addEventListener("input", (ev) => { st.filters.q = ev.target.value; st.page = 1; renderHs300TargetView(); });
  document.getElementById("hs300Industry").addEventListener("change", (ev) => { st.filters.industry = ev.target.value; st.page = 1; renderHs300TargetView(); });
  document.getElementById("hs300MinComments").addEventListener("change", (ev) => { st.filters.minComments = parseInt(ev.target.value, 10); st.page = 1; renderHs300TargetView(); });
  document.getElementById("hs300DirSeg").addEventListener("click", (ev) => {
    const b = ev.target.closest ? ev.target.closest("button[data-dir]") : null;
    if (!b) return;
    st.filters.dir = b.dataset.dir; st.page = 1; renderHs300TargetView();
  });
  document.getElementById("hs300PeriodSeg").addEventListener("click", async (ev) => {
    const b = ev.target.closest ? ev.target.closest("button[data-period]") : null;
    if (!b || String(st.period) === b.dataset.period) return;
    const days = parseInt(b.dataset.period, 10);
    st.period = days;
    if (!st.reportMaps[days]) {
      try {
        const rb = await fetchReportsBulk(days, 5);
        st.reportMaps[days] = rb.map;
        st.reportNote = "近 " + HS300_REPORT_PERIODS[days] + "最新 " + rb.total + " 篇研报已覆盖 " + Object.keys(rb.map).length + " 只成分股";
      } catch (e) {
        st.reportMaps[days] = {};
        st.reportNote = "研报未取到（" + (e.message || e) + "），评论数与 EPS 预测法暂不可用";
      }
    }
    renderHs300TargetView();
  });
  document.getElementById("hs300Prev").addEventListener("click", () => { if (st.page > 1) { st.page--; renderHs300TargetView(); } });
  document.getElementById("hs300Next").addEventListener("click", () => { st.page++; renderHs300TargetView(); });
  document.getElementById("hs300CalcBtn").addEventListener("click", () => {
    const tp = parseFloat(document.getElementById("hs300TargetPe").value);
    document.getElementById("hs300TargetResult").innerHTML = hs300TargetCalcHTML(tp);
  });
}

function hs300TargetCalcHTML(targetPe) {
  const st = hs300TargetState;
  const res = calcHs300Target(st.price, st.peWeighted, st.growth, targetPe);
  if (!res.usable) return `<p class="muted">目标价算不出：${esc(res.reason)}。</p>`;
  return `<div class="dcf-result">
    <div class="small">沪深300 目标点位（盈利增长 × 估值调整）</div>
    <div class="big ${res.target >= st.price ? "up" : "down"}">${res.target.toFixed(2)} 点</div>
    <div class="vs">当前 ${st.price != null ? st.price.toFixed(2) + " 点" : "—"} · ${res.upside >= 0 ? "高于现价 " + (res.upside * 100).toFixed(1) + "%" : "低于现价 " + Math.abs(res.upside * 100).toFixed(1) + "%"}</div>
    <div class="small" style="margin-top:6px">${esc(res.formula)}</div>
  </div>`;
}

// ---------- 沪深300年度回报 ----------
let hs300RetState = null;

async function renderHs300Ret() {
  const el = document.getElementById("hs300RetBody");
  if (hs300RetState && hs300RetState.done) { renderHs300RetView(); return; }
  el.innerHTML = `<div class="loading">正在加载沪深300 K 线…</div>`;
  try {
    const kl = await fetchHs300FullKline();
    const ann = calcHs300Annual(kl, { seedBase: 1000 });
    if (!ann.usable) throw new Error(ann.reason);
    hs300RetState = { done: true, kl, ann, mode: "price", trKl: null, trAnn: null, trError: null, trTried: false };
    renderHs300RetView();
  } catch (e) {
    el.innerHTML = `<p class="muted">沪深300年度回报暂不可用（${esc(e.message || e)}）。<a href="#" id="hs300RetRetry">重试</a></p>`;
    document.getElementById("hs300RetRetry").addEventListener("click", (ev) => { ev.preventDefault(); hs300RetState = null; renderHs300Ret(); });
  }
}

// 切换 仅限价格 / 含股息。含股息档拉不到时返回 false，页面保留价格档并显示原因。
async function hs300SetRetMode(mode) {
  const st = hs300RetState;
  if (!st || !st.done) return false;
  if (mode === "tr" && !st.trTried) {
    st.trTried = true;
    try {
      const trKl = await fetchHs300TotalReturnKline();
      const trAnn = calcHs300Annual(trKl, { seedBase: 1000 });
      if (!trAnn.usable) throw new Error(trAnn.reason);
      st.trKl = trKl; st.trAnn = trAnn;
    } catch (e) {
      st.trError = e.message || String(e);
    }
  }
  if (mode === "tr" && st.trAnn) { st.mode = "tr"; renderHs300RetView(); return true; }
  st.mode = "price";
  renderHs300RetView();
  return mode === "price";
}

function hs300RetCellStyle(ret, maxAbs) {
  const a = 0.06 + 0.38 * Math.min(1, Math.abs(ret) / (maxAbs || 0.3));
  const c = ret >= 0 ? "229,72,77" : "26,158,84"; // 红涨绿跌：上涨红、下跌绿，颜色越深涨跌幅越大
  return `background:rgba(${c},${a.toFixed(2)})`;
}

function renderHs300RetView() {
  const st = hs300RetState;
  const el = document.getElementById("hs300RetBody");
  const ann = st.mode === "tr" && st.trAnn ? st.trAnn : st.ann;
  const isTR = st.mode === "tr" && !!st.trAnn;
  const rowsAsc = [...ann.rows].sort((a, b) => String(a.year).localeCompare(String(b.year)));
  const maxAbs = Math.max(...rowsAsc.map((r) => Math.abs(r.ret)), 0.1);
  const pct = (v) => v == null ? "—" : (v >= 0 ? "+" : "") + (v * 100).toFixed(2) + "%";
  const pct1d = (v) => v == null ? "—" : (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%";
  const fmtMoney0 = (v) => v == null ? "—" : Math.round(v).toLocaleString("zh-CN") + " 元";
  // 年份四列表
  const cols = [[], [], [], []];
  rowsAsc.forEach((r, i) => cols[Math.min(3, Math.floor(i / Math.ceil(rowsAsc.length / 4)))].push(r));
  const colHTML = cols.map((col) => `<table class="tbl ret-year-tbl"><tr><th>年</th><th>回报</th></tr>` +
    col.map((r) => {
      const isCur = ann.currentYear && r.year === ann.currentYear.year;
      return `<tr><td>${r.year}${isCur ? "*" : ""}</td><td class="num" style="${hs300RetCellStyle(r.ret, maxAbs)}${isCur ? ";outline:2px solid var(--blue);outline-offset:-2px" : ""}">${pct(r.ret)}</td></tr>`;
    }).join("") + `</table>`).join("");
  const statCard = (label, value, sub, cls) => `<div class="hs300-stat"><div class="hs300-stat-k">${esc(label)}</div><div class="hs300-stat-v ${cls || ""}">${value}</div><div class="hs300-stat-s">${esc(sub || "")}</div></div>`;
  const cur = ann.currentYear;
  el.innerHTML = `
  <p class="muted" style="margin-bottom:10px">从 2005 年至今逐年显示。红色代表上涨年份，绿色代表下跌年份（颜色越深，涨跌幅越大）。</p>
  <div class="hs300-ret-toggle">
    <button data-ret-mode="price" class="${st.mode === "price" ? "active" : ""}">仅限价格（自 2005 年起）</button>
    <button data-ret-mode="tr" class="${st.mode === "tr" ? "active" : ""}">含股息（自 2005 年起）</button>
  </div>
  ${st.trError && st.mode !== "tr" ? `<p class="muted" style="margin:8px 0">含股息档暂不可用：全收益指数 K 线（东财 1.H00948）未取到（${esc(st.trError)}）。仅价格档可用。</p>` : ""}
  <div class="ret-grid">${colHTML}</div>
  ${cur ? `<p class="muted" style="margin-top:6px">* ${cur.year}年进行中：从 ${Number(cur.year) - 1} 年底到 ${esc(cur.asOf || "")} 的涨幅。</p>` : ""}
  <div class="hs300-cards" style="margin-top:14px">
    ${statCard("年均", pct1d(ann.avgRet), "中位数 " + pct1d(ann.medianRet) + " · " + ann.completeYears + " 个完整年份", ann.avgRet >= 0 ? "up" : "down")}
    ${statCard("复合增长", pct1d(ann.cagr), ann.completeFromYear + "–" + ann.value10000ToYear + " 完整年份年均复合增长率（CAGR）", ann.cagr >= 0 ? "up" : "down")}
    ${statCard(ann.completeFromYear + " 年的 10,000 元", fmtMoney0(ann.value10000), "截至" + ann.value10000ToYear + "年底（" + (isTR ? "含股息" : "不含股息") + "）", "")}
    ${statCard("积极的年份", ann.upYears + " / " + (ann.upYears + ann.downYears) + " 年", Math.round(ann.upYears / (ann.upYears + ann.downYears) * 100) + "% 的年份", "up")}
    ${statCard("最好的一年", pct1d(ann.best.ret), ann.best.year + " 年", "up")}
    ${statCard("最糟糕的一年", pct1d(ann.worst.ret), ann.worst.year + " 年", "down")}
    ${statCard("最长连胜纪录", ann.streak.len + " 年", ann.streak.len ? "随后呈阳性（" + ann.streak.from + "–" + ann.streak.to + " 年）" : "无连续上涨年份", "")}
    ${cur ? statCard(cur.year + "年进行中", pct1d(cur.ret), "截至" + cur.asOf, cur.ret >= 0 ? "up" : "down") : ""}
  </div>
  <div class="card" style="margin-top:14px">
    <h3 style="margin-bottom:8px">每年柱状图 <span class="muted" style="font-weight:400">红涨绿跌</span></h3>
    <div class="chart-box"><canvas class="chart" id="hs300RetChart"></canvas></div>
  </div>
  <p class="muted" style="margin-top:10px">ℹ️ 价格变动：沪深300指数（000300）在每年最后一个交易日的变动。含股息：沪深300全收益指数（H00948）的收益，已包含股息再投资。平均增长率和复合增长率仅使用完整年度的数据计算。过往业绩并不代表未来表现。${esc(ann.note)}</p>
  <p class="muted">⚠️ 本信息仅供参考和教育用途，不构成投资建议。评分和模型均基于一般参数估算，并不保证未来收益。请务必咨询合格的财务顾问。</p>`;
  el.querySelectorAll("[data-ret-mode]").forEach((b) => b.addEventListener("click", async () => {
    const m = b.dataset.retMode;
    if (m === st.mode) return;
    b.textContent = "加载中…";
    await hs300SetRetMode(m);
  }));
  drawAnnualBars(document.getElementById("hs300RetChart"), rowsAsc);
}

function drawAnnualBars(cv, rowsAsc) {
  if (!cv || !cv.getContext) return;
  const ctx = cv.getContext("2d");
  const W = cv.clientWidth || 900, H = 280;
  cv.width = W; cv.height = H;
  const padL = 44, padR = 10, padT = 14, padB = 24;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxAbs = Math.max(...rowsAsc.map((r) => Math.abs(r.ret)), 0.1);
  const yFor = (v) => padT + (maxAbs - v) / (2 * maxAbs) * plotH;
  const curYear = String(new Date().getFullYear());
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#94a3b8"; ctx.font = "10px sans-serif"; ctx.textAlign = "right";
  for (const t of [-maxAbs, -maxAbs / 2, 0, maxAbs / 2, maxAbs]) {
    const y = yFor(t);
    ctx.fillText((t * 100).toFixed(0) + "%", padL - 6, y + 3);
    ctx.strokeStyle = t === 0 ? "#cbd5e1" : "#e5e7eb";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
  }
  const n = rowsAsc.length, bw = plotW / n;
  ctx.textAlign = "center";
  rowsAsc.forEach((r, i) => {
    const x = padL + i * bw + bw / 2;
    const y = yFor(r.ret);
    ctx.fillStyle = r.ret >= 0 ? "#e5484d" : "#1a9e54";
    const bh = Math.max(2, Math.abs(yFor(0) - y));
    ctx.fillRect(x - Math.max(2, bw * 0.32), Math.min(y, yFor(0)), Math.max(4, bw * 0.64), bh);
    ctx.fillStyle = "#64748b"; ctx.font = "10px sans-serif";
    if (i % 2 === 0 || n <= 12) ctx.fillText(String(r.year).slice(2) + (r.year === curYear ? "*" : ""), x, H - 8);
  });
}

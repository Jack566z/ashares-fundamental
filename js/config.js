// ============================================================
// A股基本面分析 — 站点配置
// 纯静态站，无后端，无需任何 Key。数据全部来自公开接口。
// ============================================================

// ---- 密码门（SHA-256 校验）----
// PASSWORD_SHA256 是站长密码的 SHA-256 哈希（小写十六进制，64 位）。
// 校验用浏览器自带的 crypto.subtle 做 SHA-256，不引入外部库。
// 重要说明：静态站的密码门只是挡住闲人——
//   哈希值就写在这个文件里，懂行的人看源码能拿到哈希、离线暴力破解弱密码。
//   它不算真正的安全措施。站里没有任何账号、密码与私人数据，请勿把敏感信息放上来。
// 换密码的方法：echo -n "新密码" | shasum -a 256，
//   把输出的 64 位哈希填到下面，重新部署即可。
const PASSWORD_SHA256 = "07090e14e7927e8dbdc6cb674978a89da48a9ffe7db8a289a69c0124ada91b24";

// ---- 数据接口（全部公开、免费、无 Key）----
const API = {
  // 东财实时行情（会 302 跳到 push2delay，浏览器 fetch 自动跟随）
  EM_QUOTE: "https://push2.eastmoney.com/api/qt/stock/get",
  // 东财 K 线（push2his）
  EM_KLINE: "https://push2his.eastmoney.com/api/qt/stock/kline/get",
  // 东财涨幅榜（市场异动）
  EM_CLIST: "https://push2.eastmoney.com/api/qt/clist/get",
  // 东财数据中心（财报三大表 / 分红 / 预约披露 / 业绩预告）
  EM_DATACENTER: "https://datacenter-web.eastmoney.com/api/data/v1/get",
  // 腾讯行情（PE-TTM / PB / 换手 / 振幅 / 涨跌停，GBK 编码，CORS *）
  TX_QUOTE: "https://qt.gtimg.cn/q=",
  // 腾讯 K 线（前复权，等差口径）：东财 K 线不可用时的备用源
  // web.ifzq.gtimg.cn 会被 WAF 拦截，优先用 proxy 与 ifzq 两个入口（均回 CORS *）
  TX_KLINE_HOSTS: [
    "https://proxy.finance.qq.com/ifzqgtimg/appstock/app/fqkline/get",
    "https://ifzq.gtimg.cn/appstock/app/fqkline/get",
  ],
  // 腾讯搜索联想（无 CORS，用 <script> JSONP 方式加载，返回 v_hint）
  TX_SUGGEST: "https://smartbox.gtimg.cn/s3/?v=2&t=all&q=",
  // 东财研报列表（分析师预测/情绪；2026-11-09 实测：code 参数不生效，
  // 需拉全市场最新研报再按 stockCode 客户端筛选；返回 CORS 头，浏览器可直调）
  EM_REPORT_LIST: "https://reportapi.eastmoney.com/report/list",
  // 沪深300（目标价 / 年度回报用）
  HS300_CODE: "000300",
};

// ---- 自选股（首次打开时预装，可增删，存在 localStorage）----
const DEFAULT_WATCHLIST = [
  { code: "601899", name: "紫金矿业" },
  { code: "603259", name: "药明康德" },
  { code: "000408", name: "藏格矿业" },
  { code: "600276", name: "恒瑞医药" },
  { code: "300014", name: "亿纬锂能" },
  { code: "600989", name: "宝丰能源" },
  { code: "300124", name: "汇川技术" },
  { code: "002371", name: "北方华创" },
  { code: "600188", name: "兖矿能源" },
  { code: "515220", name: "煤炭ETF国泰" },
  { code: "002163", name: "海南发展" },
  { code: "002969", name: "嘉美包装" },
];

// ---- 评分规则（满分 100，六个维度；规则在页面“打分指南”里全文展示）----
// 估值 20 / 盈利 25 / 负债 15 / 成长 20 / 分红 10 / 技术 10
const SCORING = {
  valuation: { weight: 20, label: "估值" },
  profitability: { weight: 25, label: "盈利" },
  debt: { weight: 15, label: "负债" },
  growth: { weight: 20, label: "成长" },
  dividend: { weight: 10, label: "分红" },
  technical: { weight: 10, label: "技术" },
};

// ---- DCF 默认参数（可在页面上调）----
const DCF_DEFAULTS = {
  wacc: 0.08,          // 折现率 WACC，默认 8%
  growthYears: 5,      // 预测年数
  growth: null,        // 预测期增长率，null = 自动取近 3 年归母净利润复合增速（限 0~15%）
  terminalGrowth: 0.02 // 永续增长率，默认 2%
};

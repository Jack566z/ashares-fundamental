# A股基本面分析（AleInversor A股版）

独立静态网站：把西班牙语基本面分析站 AleInversor（https://aleinversor.netlify.app/，v4.39）
的功能原样搬到 A 股，界面简体中文，A 股红涨绿跌。纯静态，无构建步骤，无后端，
无需任何 Key，数据全部由浏览器直接调用东财/腾讯公开接口。

## 部署

任选一种静态托管：

- **GitHub Pages**：把本目录推到仓库，Settings → Pages → Source 选 main 分支根目录。
- **Netlify**：把本目录拖进 Netlify Drop，或 `netlify deploy --prod --dir=.`。
- 本地预览：`python3 -m http.server 8123`，打开 http://localhost:8123/

## 文件清单

```
index.html          入口（15 个标签页 + 密码门 + 自选栏 + 市场异动 + 财报日历）
css/style.css       样式（A股红涨绿跌、深色变量预留）
js/config.js        配置：密码 SHA-256 哈希、12 只预装自选、API 地址、评分阈值
js/api.js           数据层：东财/腾讯接口封装（搜索、行情、K线、财报、分红、日历、异动）
js/finance.js       计算层：TTM、核心指标、六维评分、DCF、扩展指标（见下）
js/charts.js        图表：Canvas 折线/柱状/组合图（无外部库）
js/holders.js       机构和超级大户模块（v6）：股东分类、快照加载、超级大户详情页三 tab
js/app.js           界面层：15 个标签页渲染、自选管理、密码门、DCF 交互
data/holders/       股东数据季度快照（同源 JSON，见下）
tools/refresh_holders.py  快照生成器：curl 拉东财 F10 PageAjax，写 data/holders/<code>.json
```

## 密码门

- 打开站先显示密码页，输对才进主界面。
- 校验：浏览器自带 `crypto.subtle` 做 SHA-256，不引入外部库。
- 哈希放在 `js/config.js` 的 `PASSWORD_SHA256` 常量里（已填入用户给定的哈希，
  明文密码不写进任何文件）。
- 输对后 `sessionStorage` 记一个标记（关闭标签页后失效）；勾选“记住我”
  则同时写 `localStorage` 长期记住。
- 注意（config.js 注释里也写明）：静态站密码只是挡闲人，懂行的人看源码能
  找到哈希，不算真正的安全措施；站里没有任何账号密码与私人数据。

## 功能（15 个标签页）

| 标签 | 内容 |
|---|---|
| 概况 | 代码/名称/行业/概念、现价/涨跌/市值、PE/PB/股息率 |
| 估值 | PE-TTM、PE 静态、PB、P/S、P/FCF、EV/EBIT、EV/FCF、EV/销售额、PEG、Earnings Yield、FCF Yield、DCF 估值计算器（WACC、增长率、永续增长率可调） |
| 盈利 | 毛利率、EBIT 利润率、营业利润率、净利率、FCF 利润率、ROA、ROIC、ROCE、ROE（TTM）、五年中位数（ROE/ROIC/ROCE）、利润率历史图 |
| 负债 | 资产负债率、D/E、净负债/FCF、FCF/总负债、流动比率、净负债%资产、利息保障倍数、负债结构、负债历史 |
| 成长 | CAGR 3/5/10 年：营收、营业利润、归母利润、EPS、CFO、FCF、CAPEX、货币资金；季度同比增速 |
| 分红 | 股息率、派息率（EPS/FCF 口径）、连续分红年数、连续增长年数、DPS CAGR 3/5/10 年、分红历史、派息频率、最近除权日 |
| 技术 | K 线（布林带 + MA5/10/20/50/60/120/200/250）、RSI(14)、MACD(12,26,9)、ADX(14)、随机指标(14,3,3)、Williams %R(14)、支撑/阻力、信号（金叉/死叉、超买/超卖、趋势） |
| 历史演变 | 年报营收/利润/EPS 表与图、资产/权益/负债/现金结构、自由现金流/经营现金流/CAPEX |
| 价格与回撤 | 最大回撤、峰→谷日期、恢复天数、当前回撤、平均回撤、水下时间、年化波动、Calmar、Sharpe（rf=0）、最长连跌天数、区间收益 |
| 财报 | 利润表/资产负债表/现金流量表（年报+季报+TTM） |
| 预期 | 目标价（自设增速 + 退出 PE 推算）、EPS 预测、历史 PE（年末收盘价/当年 EPS，中位数 5/10 年） |
| 行业 | 公司 vs 行业（暂不可用：无行业成分/聚合数据） |
| 周期性 | Beta vs 沪深300、相关系数、相对收益、周期性判断 |
| 财报日历 | 预约披露日、已披露、剩余天数，可按自选过滤 |
| 打分指南 | 本站六维评分规则（透明）+ AleInversor 参考分档表 |

另有：自选股栏（预装 12 只，localStorage 可增删）、市场异动（东财涨幅榜，
点击任意股票直接分析）、搜索框（腾讯 smartbox JSONP，支持代码与名称）。

## AleInversor 子模块对照清单

以下按 AleInversor 各模块逐项对照。已实现 = 有真实数据支撑；暂不可用 = 页面明确
标注原因，不造数。

### 概况 Perfil
- 名称/代码/交易所、行业、概念、市值、现价：已实现。
- 公司描述、CEO、员工数、官网：暂不可用（东财/腾讯公开接口不提供）。

### 摘要 Resumen
- 综合评分 /100 + 六维卡片：已实现（估值 20 + 盈利 25 + 负债 15 + 成长 20 + 分红 10 + 技术 10）。

### 估值 Valoración
- PE-TTM、PE 静态、PB、P/S、P/FCF、EV/EBIT、EV/FCF、EV/销售额、PEG、
  Earnings Yield、FCF Yield：已实现。
- EV/EBITDA：暂不可用（折旧摊销未从公开接口获得）。
- PER NTM（forward PE）：暂不可用（A 股无公开一致预期 EPS）。
- DCF 计算器（真实 WACC、可调参数、棉花糖测试式合理性提示）：已实现。

### 盈利 Rentabilidad
- 毛利率、EBIT 利润率、营业利润率、净利率、FCF 利润率：已实现。
- Margen EBITDA：暂不可用（无折旧摊销）。
- ROIC、ROCE、ROE（TTM）、ROA：已实现。
- 五年中位数（ROE/ROIC/ROCE）：已实现。
- 利润率历史趋势：已实现。

### 负债 Deuda
- 资产负债率、D/E、净负债/FCF、FCF/总负债、流动比率、净负债%资产、
  利息保障倍数（财务费用>0 时）、负债结构、负债历史：已实现。
- Deuda Neta/EBITDA：暂不可用（无 EBITDA）。
- 速动比率、现金比率、营运资本：暂不可用（流动资产/流动负债未单独披露）。
- 长期负债/净资产：暂不可用（长期借款未单独披露）。

### 成长 Crecimiento
- CAGR 3/5/10 年：营收、营业利润、归母利润、EPS、CFO、FCF、CAPEX、
  货币资金：已实现。
- EBITDA CAGR、总股本 CAGR、未分配利润 CAGR：暂不可用（见上）。
- 季度同比增速：已实现。

### 分红 Dividendo
- 股息率、派息率（EPS 口径与 FCF 口径）、连续分红年数、连续增长年数、
  DPS CAGR 3/5/10 年、分红历史、派息频率、最近除权日：已实现。
- Weiss 公允价值区间：暂不可用（AleInversor 专有指标，无公开算法）。

### 技术 Técnico
- 布林带（上/中/下）、MA5/10/20/50/60/120/200/250、MA1000（需 1000 根日线）、
  支撑/阻力（60 日与 52 周）、RSI(14)、MACD、ADX(14)、随机指标、
  Williams %R、信号（金叉/死叉、MACD 交叉、超买/超卖、趋势偏多/偏空/中性）：
  已实现。
- MA1000：有条件实现（K 线不足 1000 根时标暂不可用并说明原因）。

### 历史演变 Evolución Histórica
- 年报营收/利润/EPS 表与图、资产/权益/负债/现金结构、FCF/OCF/CAPEX：
  已实现。
- 回购（买回）：暂不可用（无回购数据）。

### 价格与回撤 Precio & Drawdown
- 最大回撤、峰→谷日期、恢复天数、当前回撤、平均回撤、水下时间、
  年化波动、Calmar、Sharpe（rf=0）、最长连跌天数、区间收益：已实现。

### 财报 Earnings
- 季度营收/EPS、三大表（年报+季报+TTM）：已实现。
- EPS 实际 vs 预期、营收实际 vs 预期：暂不可用（无一致预期数据）。

### 预期 Estimaciones
- 目标价（自设增速 + 退出 PE 推算，明确标注“非分析师一致预期”）、
  EPS 预测、历史 PE（年末收盘价/当年 EPS，中位数 5/10 年）：已实现。
- 分析师人数、EPS/营收/EBITDA/净利润一致预期、一致预期明细：
  暂不可用（A 股无公开一致预期数据）。

### 行业 Sector
- 公司 vs 行业关键指标、行业 PE vs 历史中位数：暂不可用
  （无行业成分股清单与行业聚合数据）。

### 周期性 Ciclicidad
- Beta vs 沪深300、相关系数、相对收益、周期性判断：已实现
  （AleInversor 原版 vs 标普500，A 股版改为 vs 沪深300）。

## 数据接口实测结果（2026-11-09，VM 上 curl 带 Origin 头验证）

| 接口 | 状态 | 说明 |
|---|---|---|
| 东财搜索 search-api-web.eastmoney.com | 不通 | 返回 404（含公开 token 也一样）；改用腾讯 smartbox JSONP |
| 腾讯 smartbox（搜索） | 通 | `smartbox.gtimg.cn/s3/?v=2&t=all&q=关键词`，`^` 分隔，过滤 sh/sz/bj；无 CORS 头，走 `<script>` JSONP |
| 东财 push2 实时行情 | 通 | `push2.eastmoney.com/api/qt/stock/get`，302 跳到 push2delay，CORS 回显 Origin；价格单位是元（非 ×100）；含股息率 f126、行业 f127、概念 f129 |
| 东财 push2his 日K | 不稳定 | 同日早些时候通（447 根），后持续 rc=102（疑似出口 IP 限流）；代码先走东财，失败自动降级腾讯 |
| 腾讯 fqkline 日/周/月K | 通 | `proxy.finance.qq.com/ifzqgtimg/appstock/app/fqkline/get` 与 `ifzq.gtimg.cn/...`，CORS `*`；指数用 `day` 键（无 qfq 键）；单次最多 640 根；qfq 为等差口径，页面注明来源 |
| 腾讯 qt.gtimg.cn 行情 | 通 | CORS `*`，GBK 编码；PE-TTM [39]、PB [46]、总市值 [44]/[45]、ROE [65] |
| 东财 datacenter 利润表 LICO | 通 | `RPT_LICO_FN_CPD`：REPORTDATE（无下划线）、TOTAL_OPERATE_INCOME、PARENT_NETPROFIT、BASIC_EPS、DEDUCT_BASIC_EPS、BPS、WEIGHTAVG_ROE、MGJYXJJE |
| 东财 datacenter 利润表 DMSK | 通 | `RPT_DMSK_FN_INCOME`：REPORT_DATE（有下划线）、OPERATE_COST、OPERATE_PROFIT、TOTAL_PROFIT、FINANCE_EXPENSE、SALE_EXPENSE、MANAGE_EXPENSE、INVEST_INCOME、INCOME_TAX、DEDUCT_PARENT_NETPROFIT |
| 东财 datacenter 资产负债表 | 通 | `RPT_DMSK_FN_BALANCE`：TOTAL_ASSETS、TOTAL_LIABILITIES、TOTAL_EQUITY、MONETARYFUNDS、INVENTORY、ACCOUNTS_RECE、ACCOUNTS_PAYABLE、FIXED_ASSET、SHORT_LOAN；CURRENT_RATIO 与 DEBT_ASSET_RATIO 返回的是百分比（÷100） |
| 东财 datacenter 现金流量表 | 通 | `RPT_DMSK_FN_CASHFLOW`：NETCASH_OPERATE、NETCASH_INVEST、NETCASH_FINANCE、CONSTRUCT_LONG_ASSET（= CAPEX） |
| 东财分红 | 通 | `RPT_SHAREBONUS_DET`：EX_DIVIDEND_DATE、PRETAX_BONUS_RMB（每 10 股派息）、BONUS_RATIO、IT_RATIO、IMPL_PLAN_PROFILE |
| 东财财报预约披露 | 通 | `RPT_PUBLIC_BS_APPOIN`：FIRST_APPOINT_DATE、ACTUAL_PUBLISH_DATE、RESIDUAL_DAYS、REPORT_TYPE_NAME、IS_PUBLISH |
| 东财业绩预告 | 通 | `RPT_PUBLIC_OP_NEWPREDICT`：PREDICT_FINANCE、PREDICT_AMT_LOWER/UPPER、ADD_AMP_LOWER/UPPER、PREDICT_TYPE |
| 东财 clist 涨幅榜（市场异动） | 通 | `push2.eastmoney.com/api/qt/clist/get`，fid=f3 按涨跌幅降序；首次 502 为偶发，重试即通 |
| 东财 F10 股东研究 PageAjax | curl 通、浏览器不通 | `emweb.securities.eastmoney.com/PC_HSF10/ShareholderResearch/PageAjax?code=SH600519`：十大股东 sdgd、十大流通股东 sdltgd、股东户数 gdrs、基金持仓 jjcg、机构持股汇总 jgcc 全有；但响应无 `Access-Control-Allow-Origin`，浏览器 fetch 被 CORS 拦截；`dates=`/`date=`/`endDate=` 参数均被忽略，永远只返回最新一季；ETF 代码返回 `{"status":-1,"message":"股票代码不合法"}` |
| 东财 datacenter 股东类表 | 不通 | 22 个候选表名（RPT_F10_MAIN_HOLDER、RPT_F10_MAIN_HOLDER2、RPT_F10_HOLDER_TOTAL、RPT_F10_SDGD、RPT_F10_SDLTGD、RPT_F10_JJCG、RPT_F10_JGCC、RPT_FUND_HOLD_STOCK、RPT_MUTUAL_HOLD_STOCK 等）换 columns/filter 组合重测均报 9501“报表配置不存在” |
| 雪球持仓接口 | 不通 | 对本机出口 IP 返回 403 且需登录态，已排除 |
| 腾讯 ff_ 财务接口 | 不通 | `qt.gtimg.cn/q=ff_sh600519` 返回 `v_pv_none_match="1"`，未使用 |
| 沪深300 K 线 | 通 | 指数必须显式走沪市前缀（secid 1.000300 / sh000300），通用代码映射会误判为深市；已在代码里写死 |

注：东财 datacenter 的 `columns=ALL` 可用；写错列名报 9501。LICO 与 DMSK
的日期字段名不同（REPORTDATE vs REPORT_DATE），代码里已分别处理。
季度行是年内累计值，TTM 用“本期累计 + 上年全年 − 上年同期累计”拼。

## 机构和超级大户（v6，2026-11-09）

标签页“机构和超级大户”对标 AleInversor 的机构筛查员 13F + 超级投资者两页，全部换成 A 股数据。

**数据源与刷新管线（关键）：** 浏览器端没有可直接调用的免费股东接口（见上表），本站采用“同源季度快照”：

- 生成器 `tools/refresh_holders.py` 用 curl 拉东财 F10 PageAjax，写成 `data/holders/<code>.json`（每股一个文件，按季度累积，含十大股东/十大流通股东/股东户数 10 期/基金持仓前 50/机构持股汇总），随站一起部署；浏览器只读同源 JSON，无 CORS 问题。
- 每季财报披露后跑一次：`python3 tools/refresh_holders.py`（全部 12 只自选股），或带代码只拉单只；跑完核对输出摘要再 git push。PageAjax 永远只返回最新一季，历史季度只能靠每次披露后及时跑脚本累积，无法事后补拉。
- 快照目前覆盖 12 只自选股 + 贵州茅台 600519（E2E 与常用股）；煤炭 ETF 515220 无股东结构，快照为空文件，页上标暂不可用并说明原因。

**模块内容：** 机构部分——季度选择器、机构持股合计/基金/社保/保险/股东户数摘要、十大股东与十大流通股东表（股东名、持股数、占比、较上期变动，按名称规则 + 接口 HOLDER_TYPE 字段分类标注：社保基金/QFII/汇金·证金/养老金/公募基金/保险/券商/私募/投资公司/个人/其他）、基金持仓前 10、机构持股汇总（jgcc ORG_TYPE 只标注实测验证过的 00=机构合计、01=基金、03=社保基金、05=保险，其余 02/04/06/07 汇总为“其他机构类型”不猜测）、股东户数 10 期趋势图。超级大户部分——本股十大流通股东中的社保/QFII/汇金·证金/养老金/个人大户卡片；跨自选股汇总（12 只自选股里哪些有社保/QFII/牛散持仓，可按类型过滤、按持仓只数排序）；点击大户进详情页，三 tab 照 AleInversor 超级投资者页做：职位（持仓表 + 1 年走势小图 + 下载 CSV）、表现（复制其季末持仓买入持有的累计收益 vs 沪深300，1年/3年/5年切换 + 分段对比条 + 管理风格统计）、投资组合结构（前十仓位环形图、申万二级行业环形图、行业权重现在 vs 前、季度堆叠条形图）。

**诚实标注：** 仅一期快照时，机构持股合计的较上季变动、新企业/出售的公司、平均持有时长、行业权重上期、季度堆叠条形图均标暂不可用并说明原因（需两期以上快照）；表现数据是“按披露持仓复制”的模拟收益，不是大户真实收益，页上有方法说明；个人大户只列十大流通股东里实际出现的名字，不凭印象编造“某大户持有某股”（如葛卫东未出现在 12 只自选股任一前十，本站不列他）；兖矿十大股东仅 2 行、披露日为 2026-10-28 股权变动事件日（非季报日），页上如实标注。

## 本地验证（2026-11-09）

- 全部 5 个 JS 文件 `node --check` 通过。
- `python3 -m http.server 8123`：首页与全部 css/js 返回 HTTP 200。
- 贵州茅台 600519 全链路 E2E（Node vm 加载真实 js 文件，调真实接口）：
  11 个数据源全部成功（errors: {}），K 线 641 根（腾讯源），最新 2026-11-09。
  评分 68/100（良好），DCF 内在价值 2013.73 元（现价 1444.5，上浮 39.4%）。
  扩展指标全部算出：PS 10.30、P/FCF 16.80、EV/EBIT 15.69、毛利率 90.1%、
  ROIC 26.7%、ROCE 35.7%、D/E 0.14、流动比率 7.19、营收 CAGR 10 年 17.8%、
  分红 25 年、RSI 66.2、MACD 43.59/33.97、ADX 39.1、最大回撤 -29.2%、
  Beta vs 沪深300 -0.01、历史 PE 中位数 20.8、EPS 预测价 1924.54 元。
  14 项暂不可用均有明确原因（见 calcExtended 的 na 清单）。

## 关键口径

- 价格：腾讯 qt 为准（单位明确是元）；东财提供腾讯没有的股息率、行业、概念。
- K 线：东财优先（等比前复权），失败自动降级腾讯 qfq（等差口径，页面注明来源）。
- TTM：季度行是年内累计值，用“本期累计 + 上年全年 − 上年同期累计”拼。
- EBIT ≈ 营业利润 + 财务费用（财务费用为负时为净利息收入）。
- EV = 总市值 + 总负债 − 货币资金（总负债作有息负债的代理，偏保守）。
- ROIC ≈ NOPAT / (净资产+总负债)，NOPAT = 营业利润 × (1 − 所得税率)。
- 评分：估值 20 + 盈利 25 + 负债 15 + 成长 20 + 分红 10 + 技术 10 = 100；
  ETF/指数类无财报时只算估值 + 技术（满分 30）。
- 历史 PE：年末收盘价 / 当年 EPS（前复权口径，近似值）；K 线最多 640 根，
  历史 PE 仅覆盖最近约 2~3 年，中位数按实际行数算。

## 免责

仅供学习参考，不构成投资建议；数据来自东财公开接口。

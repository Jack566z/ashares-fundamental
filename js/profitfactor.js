// ---------- 盈利因子前五 ----------
// 数据来源：~/workspace/research_notes/profitability-factor-top5-20261109-0703/report.md（2026-11-09）
// 阅读提示（报告原文）：所有“年化超额”除非注明为论文原文给出的年化数，一律为“月均×12的简单年化”，不等于复利年化；
// 所有收益均为毛收益（未扣交易成本、未扣融券成本）；做空端在中国A股个人投资者层面基本不可直接复制，落地以“多头超配/剔除弱盈利”为主。
// 铁律：查不到可信数据的数字一律写“无可信数据”，不编造、不外推。
const PROFIT_FACTORS = [
  {
    rank: 1, name: "q因子ROE（Hou-Xue-Zhang，月度季度ROE）", stars: "★★★★★", fit: "最高，A股适配最高",
    tagline: "月均 0.58%、t=4.81，唯一在 spanning 检验中系统性压倒 FF 五因子的盈利因子；A股 2007 年后 q 因子表现最好。",
    logic: "投资 CAPM（q 理论）：给定投资，高预期盈利（高 ROE）必须对应高折现率（高预期收益），否则企业会扩大投资直至净现值归零。ROE 预测收益，是因为它预测未来 ROE。作者强调月度更新的优势：“最新公布的季度盈利包含关于未来 ROE 的最新信息，用最新盈利数据做月度排序最有效；而年度 RMW 只用上年财年数据，效率较低。”",
    recipe: {
      definition: "ROE = 季度非常项目前收益（Compustat 季度项 IBQ）/ 上一季度末账面权益。排除金融股与负账面权益公司。",
      ashare: "分子用单季度归母净利润（优先）或单季度扣非归母净利润（二者均需在看板上并列）；分母用上一季度末归母净资产。注意：美股 IBQ 是“非常项目前收益”，A股无完全对应项，扣非净利润是最接近的口径，但扣非口径本身由交易所定义、与 IBQ 不完全等同——必须在页面脚注写明这一口径差异。",
      sorting: "ROE（月度更新）。",
      grouping: "与规模、投资三变量联合 2×3×3 排序：规模按 NYSE 中位数分大小；投资/资产（I/A = 总资产年变化 / 滞后总资产）与 ROE 各按 NYSE 30%/70% 分三组；共 18 个组合，市值加权。",
      longShort: "ROE 因子 = 6 个高 ROE 组合平均收益 − 6 个低 ROE 组合平均收益（高减低）。完整 q 因子模型另含市场、规模（小减大）、投资（低减高）三因子。",
      rebalance: "月度（ROE 腿月度；投资腿年度）。这是它与 RMW 最关键的区别。",
      fields: "季度净利润/扣非净利润、季度末归母净资产、总资产（算 I/A 用）、流通市值/总市值（规模分组）、月度收益率（复权）、财报公布日（防前视偏差）。",
    },
    backtest: [
      { caliber: "原文 1972–2012", value: "0.58%/月（简单年化约 6.96%）", t: "4.81", sample: "1972-01–2012-12，美股 CRSP+Compustat，三重 2×3×3 排序", source: { label: "Hou et al. 2015 原文 PDF", url: "https://sr.magellan.software/docs/HouXueandZhang4factormodel.pdf" } },
      { caliber: "扩展 1967–2013", value: "0.57%/月", t: "5.21", sample: "1967-01–2013-12", source: { label: "ETF 转述", url: "https://www.etf.com/sections/index-investor-corner/swedroe-battle-new-factor-models" } },
      { caliber: "扩展 1967–2016", value: "0.55%/月", t: "5.25", sample: "1967–2016", source: { label: "Hou et al. 2018 “Which Factors?” NBER WP 20682", url: "https://live-nber.pantheonsite.io/system/files/working_papers/w20682/w20682.pdf" } },
      { caliber: "Spanning 检验", value: "FF 五因子无法解释 ROE 因子，alpha 0.45%/月（t=5.44）；反之 q 因子解释 HML/RMW/CMA，alpha 均<0.05%/月、t<0.5", t: "5.44", sample: "1967–2013", source: { label: "ETF 转述", url: "https://www.etf.com/sections/index-investor-corner/swedroe-battle-new-factor-models" } },
      { caliber: "因子间相关", value: "ROE 因子与动量因子（UMD）相关系数 0.50；与投资因子几乎不相关", t: "—", sample: "1972–2012", source: { label: "Hou et al. 2015 原文", url: "https://sr.magellan.software/docs/HouXueandZhang4factormodel.pdf" } },
    ],
    maxDD: null, maxDDNote: "本次检索未找到同行评议论文或 global-q 官方发布的 q-ROE 因子最大回撤；不编造。",
    oos: "国际/A股方面，Li et al.（2024）A股复制中 q 因子为 2007 年后最佳模型；美股发表后（2015 年后）分段月均收益无可信数据（global-q.org 2026-07 更新只公布了显著异象个数，未公布 ROE 因子分段收益，本报告不推算）。",
    conditions: "适用于能取得及时季度财报的市场；要求财报公布日准确、剔除 ST/退市整理期与上市不足一年的次新股（A股建议）、剔除金融股与负净资产公司；对小市值股更敏感（Hou et al. 发现 q 模型在小盘股中优于 FF 五因子更明显）。",
    fitText: "能直接用，调整最小：A股季报强制披露，季度 ROE 可算；CSMAR/Wind 均有单季度净利润与归母净资产字段。必须做的调整：① 用财报实际公布日+1 交易日生效，禁止用季末日（A股季报可晚至次月末，年报可晚至 4 月底，前视偏差比美股更大）；② 分组断点改用主板（沪深主板）断点或全市场市值中位数，不要用全市场（含创业板/科创板/北交所）等权断点——Li et al.（2024）证明全市场断点+等权会过度加权微盘股、投资容量极低；③ 规模分组建议用流通市值而非总市值（A股限售股历史问题）；④ ROE 分子并列“归母净利润口径”与“扣非口径”两个版本，让用户看到口径敏感性。",
    pitfalls: [
      "ROE≠盈利质量：高杠杆可虚增 ROE（净资产分母小），须与低杠杆联动展示，单独用 ROE 选股会选出一批高杠杆公司。",
      "与动量/PEAD 纠缠：ROE 因子与动量相关 0.50，有批评认为其收益部分来自盈余公告后漂移（PEAD）而非 q 理论本身（Novy-Marx 2015 年批评）。本站标注“ROE 因子含有基本面动量成分”。",
      "季度 ROE 波动大：单季度净利润受季节性与非经常性损益影响大，建议看板同时展示 TTM ROE 与单季度 ROE，并做 1%/99% 缩尾（winsorize，美股论文做法）。",
      "A股“持续高 ROE”不等于“当期高 ROE”：若用“持续高 ROIC/ROE”条件，需另设“过去 3 年 ROE 均值>阈值且每年为正”的持续性条件，不可与本策略的当期 ROE 混用。",
    ],
  },
  {
    rank: 2, name: "现金经营盈利 CbOP（Ball-Gerakos-Linnainmaa-Nikolaev 2016）", stars: "★★★★☆（全球）/ ★★★☆☆（A股单独用）", fit: "A股不要单独作主因子，须与 OP 并列",
    tagline: "美股年化 4.8%、t=6.3，压倒 OP/GP/净利润并吞没应计异象；但在中国方向反转，须降级为辅助验证因子。",
    logic: "盈利包含应计项目（权责发生制下对经营现金流的调整）。应计项目持续性低于现金流（Sloan 1996），且高应计公司未来收益低（应计异象）。把应计从经营盈利中剔除，得到现金口径盈利，才是更干净的经济盈利度量。论文结论：“高应计公司未来收益低，是因为它们现金口径盈利低。”",
    recipe: {
      definition: "第一步：经营盈利 OP（Ball et al. 2015 定义）=（营业收入 − 营业成本 − 报告销售管理费用）/ 滞后总资产，其中“报告销售管理费用 = Compustat XSGA − 研发费用 XRD”（即把 Compustat 把研发计入 SG&A 的做法还原）。第二步：CbOP = OP − 应计项目；应计项目（资产负债表法）= Δ应收账款 + Δ存货 + Δ预付费用 − Δ应付账款 − Δ递延收入 − Δ预提费用；另有现金流量表法版本（1988 年后稳健性检验）。",
      ashare: "A股资产负债表有应收账款、存货、预付账款、应付账款、合同负债（2018 年后取代预收账款）、其他应付款；预提费用无独立科目（A股无“accrued expenses”标准行项目，需用“其他应付款+应付职工薪酬+应交税费”近似，或改用现金流量表法），这是 A股实现 CbOP 时最大的口径缺口，必须在页面注明近似方法。",
      sorting: "CbOP（年度数据，6 个月会计滞后）。",
      grouping: "论文主检验为 Fama-MacBeth 回归与十分位排序；因子化时按 FF 2×3 方法：规模×CbOP（30%/70% 断点），稳健减弱（robust-minus-weak）。",
      longShort: "做多高 CbOP、做空低 CbOP；论文证明只加 CbOP 因子比同时加应计因子+OP 因子更能提高夏普比率。",
      rebalance: "年度（每年 6 月底，按上年财年数据）。",
      fields: "营业收入、营业成本、销售费用、管理费用、研发费用、应收账款、存货、预付账款、应付账款、合同负债/预收账款、预提费用/其他应付款、总资产、经营活动现金流量净额（校验用）。",
    },
    backtest: [
      { caliber: "CbOP 多空组合", value: "年化 4.8%（论文原文年化数）", t: "6.3", sample: "1963-07–2013-12，美股", source: { label: "Swedroe 对工作论文的总结", url: "https://www.etf.com/sections/index-investor-corner/swedroe-exploring-profitability-factor" } },
      { caliber: "OP（对照组）", value: "年化 3.5%", t: "4.0", sample: "同上", source: { label: "同上", url: "https://www.etf.com/sections/index-investor-corner/swedroe-exploring-profitability-factor" } },
      { caliber: "论文摘要定性结论", value: "CbOP 优于 GP、OP、净利润；吞没应计异象；预测收益长达 10 年", t: "—", sample: "同上", source: { label: "Ball et al. 2016 原文摘要", url: "https://www.anderson.ucla.edu/documents/sites/about/clubs/asam/6-Accruals-cash-flows-and-operating-profitability.pdf" } },
      { caliber: "Fama-MacBeth 斜率（演示文稿转述）", value: "OP 的 t 值从约 6.00 升至 8.92（还原研发处理后）；GP 约 5.46–6.57", t: "8.92", sample: "1963–2013，剔微盘股", source: { label: "Ball 演示文稿（非论文正文，引用时注明）", url: "https://www.chicagobooth.edu/faculty/directory/b/-/media/e55c53d8b5624b2d825047a84fe2b90b.ashx" } },
    ],
    maxDD: null, maxDDNote: "无可信数据。",
    oos: "美股发表后分段无可信数据；中国样本有反向证据（见 A股适配）：Du, Wang & Wei（2020）中国 1999-07–2018-12 样本中 OP 反过来吞没 CbOP。",
    conditions: "适用于会计信息质量较高、应计操纵动机强的市场；要求资产负债表项目连续两年可得（算变化量）、剔除金融股；对商誉减值、资产重组频繁的公司需谨慎（应计变化可能反映一次性重组而非经营现金质量）。",
    fitText: "关键反转证据：Du, Wang & Wei（2020, Pacific-Basin Finance Journal 61, 101336）复制 Ball et al.（2016）并扩展到中国：美国市场 CbOP 吞没 OP 与应计的预测力；中国市场相反——OP 吞没 CbOP；中美两市 OP 与 CbOP 均能预测收益，但应计在 Fama-MacBeth 回归中无预测力。样本：中国 1999-07–2018-12，CSMAR 数据库，仅 A股。含义：在 A股，CbOP 不能作为 OP 的替代品上线；本站应把 OP 与 CbOP 做成同一看板内的两个并列因子，并用 2015 年后 A股自测标注哪一个在当前样本中更有效，而不是照搬美股结论。",
    pitfalls: [
      "中国反转（上段）——最大的坑。",
      "CbOP≠经营现金流：CbOP 不是 GAAP 经营现金流（后者扣利息与税），也不是自由现金流；不要把“经营活动现金流量净额/总资产”直接当 CbOP 用。",
      "应计定义敏感：资产负债表法与现金流量表法结果可能不同；并购、资产剥离会扭曲 Δ存货/Δ应收，需剔除发生重大并购的样本年。",
      "A股 2018 年科目变更：预收账款→合同负债、研发费用单列，跨期可比需做科目映射（见字段总表）。",
    ],
  },
  {
    rank: 3, name: "FF RMW 经营盈利 OP/净资产（Fama-French 2015）", stars: "★★★★☆", fit: "A股证据混杂，只在 Size-OP 组合中稳健",
    tagline: "学术基准因子，月均 0.25%、t=2.92，国际（北美/欧洲/亚太）成立、日本弱；A股证据混杂。",
    logic: "股利贴现模型：给定价格与投资，高预期盈利意味着高预期收益。RMW 是 FF 五因子模型的标准盈利腿，也是学术界默认的“盈利因子”基准——任何新盈利定义都要先过 RMW 这一关（spanning 检验）。",
    recipe: {
      definition: "OP =（营业收入 − 营业成本 − 销售管理费用 − 利息费用）/ 账面权益，其中账面权益为上一财年年末值。",
      ashare: "利息费用口径：A股利润表无独立“利息费用”行（在财务费用附注中），FF 定义中的利息费用在 A股需从财务费用附注拆分，或改用“营业利润+财务费用”近似——必须注明近似。另建议 OP 的两个分母版本并列（OP/BE 与 OP/AT），见“分母之争”。",
      sorting: "OP。",
      grouping: "每年 6 月底独立排序：规模按 NYSE 中位数分大小；OP 按 NYSE 30%/70% 分弱（W）/中（N）/强（R）三组；2×3 共 6 个组合，市值加权。",
      longShort: "RMW = 1/2（小强 + 大强）− 1/2（小弱 + 大弱）。",
      rebalance: "年度（每年 6 月底）。",
      fields: "营业收入、营业成本、销售费用、管理费用、利息费用（或财务费用拆分）、账面权益（净资产）、市值。",
    },
    backtest: [
      { caliber: "原文样本", value: "0.25%/月（简单年化约 3.0%）", t: "2.92", sample: "1963-07–2013-12，606 个月，美股", source: { label: "Summitward 转述（0.25%/月，t=2.92）", url: "https://summitward.com/learn/roic-return-on-invested-capital" } },
      { caliber: "扩展 1967–2013", value: "0.27%/月", t: "2.58", sample: "1967–2013", source: { label: "ETF 转述", url: "https://www.etf.com/sections/index-investor-corner/swedroe-battle-new-factor-models" } },
      { caliber: "扩展 1967–2016", value: "0.26%/月", t: "2.50", sample: "1967–2016", source: { label: "Hou et al. 2018 转述", url: "https://live-nber.pantheonsite.io/system/files/working_papers/w20682/w20682.pdf" } },
      { caliber: "长样本 1963–2026-08（数据库重算，非论文）", value: "年化约 3.0%，年化夏普约 0.38", t: "—", sample: "1963-07–2026-08，Kenneth French 数据库", source: { label: "PapersWithBacktest（二次计算，引用时注明非论文原文）", url: "https://paperswithbacktest.com/course/factor-investing" } },
      { caliber: "国际 1990–2015", value: "北美/欧洲/亚太 RMW 重要；日本无可靠盈利与投资溢价", t: "—", sample: "1990-07–2015，23 个发达市场", source: { label: "Fama & French 2017 转述", url: "https://www.etf.com/sections/index-investor-corner/swedroe-5-factor-evaluation?nopaging=1&utm_source=Daily+AR&utm_campaign=61edb43b1a-RSS_EMAIL_CAMPAIGN&utm_medium=email&utm_term=0_c08a59015d-61edb43b1a-144086133" } },
      { caliber: "国际 1987–2019（Cakici-Zaremba）", value: "全球/北美/欧洲/亚太 RMW 月均 0.24%–0.31%；日本为零", t: "—", sample: "1987–2019，65,000 只股票，23 国", source: { label: "Alpha Architect 转述", url: "https://alphaarchitect.com/size-value-profitability-and-investment-factors-in-international-stocks/" } },
    ],
    maxDD: "−41.79%（仅仪表盘衍生值，见备注）", maxDDNote: "仅有一个非同行评议的数据库衍生仪表盘数据：年化 2.68%、波动 7.93%、夏普 0.34、最差单月 −18.93%、正收益月占比 56.1%、759 个月，截至 2026-09-30，Kenneth French 数据库。本报告引用该数时必须标注“仪表盘衍生、非论文原文”，且不把 −41.79% 当作论文验证过的回撤。",
    oos: "RMW 是 2007 年后唯一夏普比率保持住的 FF 长空因子（价值同期转负），该结论来自对 French 数据库的重算（二次来源）；论文层面的发表后（2015 年后）分段收益无可信数据。",
    conditions: "适用于任何有年度财报与市值数据的市场；是做因子归因、计算组合 RMW 暴露的默认基准；小盘股中“低盈利+高投资”组合是 FF 五因子模型解释最差的角落（论文原话），选股时应避开该组合而非单纯做多高 OP。",
    fitText: "支持的证据：2009-05–2019-04 研究发现 A股存在盈利效应，收益率随盈利能力增强而升高，在规模越大组越明显，RMW 定价能力较强；华泰证券 2017 年五因子 A股实证发现盈利因子回归系数随 ROE 由低到高单调递增、小规模组更显著（券商研报，非同行评议）。不支持/弱证据：2010-07–2015-05（59 个月）Springer 同行评议研究：RMW 与 CMA 除 Size-OP 组合外未给 FF 三因子带来更多解释力，FF 五因子在中国未显著优于三因子，与美股不一致；1997–2015 年 A股研究：不存在显著投资效应与盈利效应（但五因子对按盈利/投资分组的组合解释力仍提升）。结论：A股 RMW 不是全市场稳健的独立溢价，其显著性依赖样本期（股改前后）、分组方式与规模组。网站落地时必须做分样本展示（2007 年前/后、主板/创业板、大/小盘），并标注“2010–2015 年短样本不支持”的反例。",
    pitfalls: [
      "分母之争（OP/净资产 vs OP/总资产）：FF 用净资产做分母；Ball et al.（2015）用总资产做分母，认为总资产分母更干净，且 OP/总资产的 Fama-MacBeth t 值（约 8.92，演示文稿）高于 GP。A股含义：净资产分母会被高杠杆放大（ROE 式扭曲），总资产分母更稳健。建议网站两个分母版本并列（OP/BE 与 OP/AT），让用户自己比较；不要只上 FF 版本就声称“这就是经营盈利”。",
      "t 值短板：原文 t=2.92，略低于 Harvey-Liu-Zhu 多重检验建议的 3.0 门槛；其保留理由是国际样本外与长样本支持，正文中明示此短板。",
      "利息费用口径（见 A股转译）：需附注拆分或近似，必须注明。",
    ],
  },
  {
    rank: 4, name: "毛利润率 GP/总资产（Novy-Marx 2013）", stars: "★★★★☆", fit: "能直接用，须做行业内比较",
    tagline: "最干净的盈利定义，最高-最低五分位月均 0.31%、t=2.49，FF3 alpha 0.52%/月；与价值因子互补、对冲价值。",
    logic: "越往利润表下方走，盈利度量被研发、广告、人力资本等“费用化投资”污染越严重；毛利润（收入−营业成本）是最干净的真实经济盈利代理。毛利润率与账面市值比预测截面收益的能力大致相当，且二者互补：控制毛利润率能大幅提升价值策略表现（尤其在大盘流动性好的股票中），控制价值能提升盈利策略表现。",
    recipe: {
      definition: "GP =（营业收入 − 营业成本）/ 总资产（总资产为当期期末值；论文亦用滞后总资产做稳健性检验，结果敏感——见坑）。",
      ashare: "A股“营业成本”含主营业务成本+其他业务成本，与美股 COGS 口径基本一致，但其他业务成本占比高的公司（如多元化集团）GP 会被扭曲，建议并列“主营业务毛利率”版本。",
      sorting: "GP。",
      grouping: "论文主检验为 NYSE 断点五分位排序、市值加权；亦做行业调整（FF 49 行业去均值）与双排序（GP×B/M、GP×规模）。",
      longShort: "做多最高 GP 五分位、做空最低 GP 五分位（多空利差）；或与价值组合成“盈利×价值”双策略。",
      rebalance: "年度（每年 6 月底，按上年财年数据；论文会计滞后为财年结束后 6 个月）。",
      fields: "营业收入、营业成本、总资产、市值、账面权益（算 B/M 联动用）。",
    },
    backtest: [
      { caliber: "最高−最低五分位（市值加权）", value: "0.31%/月（简单年化约 3.72%）", t: "2.49", sample: "1963-07–2010-12，美股 NYSE，剔金融股", source: { label: "Novy-Marx 2013 原文", url: "https://oldschoolvalue-files.s3.amazonaws.com/pdf/Novy-Marx_Gross-Profitability-Anomaly_JFE_2013.pdf" } },
      { caliber: "FF 三因子 alpha（同上利差）", value: "0.52%/月", t: "4.49", sample: "同上", source: { label: "ETF 转述", url: "https://www.etf.com/sections/index-investor-corner/swedroe-exploring-profitability-factor" } },
      { caliber: "Fama-MacBeth 回归斜率", value: "GP 斜率 t 值约 4.59（多规格中最高一组为 5.49，不同控制变量下在 4.59–5.49 之间）", t: "4.59", sample: "同上", source: { label: "Novy-Marx 2013 原文表 1（注意：回归斜率 t 值≠多空组合 t 值，不可混用）", url: "https://oldschoolvalue-files.s3.amazonaws.com/pdf/Novy-Marx_Gross-Profitability-Anomaly_JFE_2013.pdf" } },
      { caliber: "与价值联用", value: "GP+价值双策略月均 0.71%，波动不高于单策略", t: "—", sample: "同上", source: { label: "CFA Magazine 转述", url: "https://rpc.cfainstitute.org/research/cfa-magazine/2014/quality-control" } },
    ],
    maxDD: null, maxDDNote: "无可信数据。",
    oos: "国际样本中 GP 稳健（论文称在国际市场亦成立，但本报告未找到可引用的分国家 t 值，故不列数字）；发表后分段无可信数据。",
    conditions: "适用于所有有营业成本单列的市场；最适合与价值因子联用（GP 是成长策略，却对冲价值策略的波动）；对营业成本占比极低的行业（如软件、平台）需行业内比较，不可全市场直接排序。",
    fitText: "能直接用：营业收入、营业成本、总资产均为 A股财报标准行项目，无口径缺口。必须做的调整：① A股“营业成本”含主营业务成本+其他业务成本，与美股 COGS 口径基本一致，但其他业务成本占比高的公司 GP 会被扭曲，建议并列“主营业务毛利率”版本；② 行业调整必须做：A股行业间毛利率差异极大（白酒>60%、银行/券商不适用），全市场排序无意义，应默认行业内百分位展示；③ 剔除金融股（银行、保险、券商无营业成本概念）。",
    pitfalls: [
      "分母时点敏感：复制研究显示 GP/当期总资产月均 0.38%（t=2.62），GP/滞后一年总资产仅 0.16%（t=1.04）——分母用当期还是滞后一年，结果从显著变不显著。网站必须固定一种分母（建议当期总资产，与原文主检验一致）并在脚注披露敏感性。",
      "t 值本身不算高：多空利差 t=2.49，未过 Harvey-Liu-Zhu 的 3.0 门槛；其统计强度主要来自 FF3 alpha（t=4.49）与 Fama-MacBeth 回归，而非原始利差。不要只贴 2.49 就声称“强证据”，也不要只贴 4.49 就掩盖利差 t 值的短板。",
      "成长属性：高 GP 公司估值更高、规模更大，单看 GP 会选出高估值成长股，必须与估值（B/M 或 PE）联动，否则在价值回归期回撤大。",
    ],
  },
  {
    rank: 5, name: "QMJ盈利分量（Asness-Frazzini-Pedersen 2019，只取盈利子组合，不取完整QMJ）", stars: "★★★☆☆", fit: "只上盈利分量，不上完整 QMJ",
    tagline: "盈利子组合超额 0.29%/月、t=3.92，七因子 alpha 0.30%/月；但完整 QMJ 2017 年后美国基本走平，复合因子不可只看样本内。",
    logic: "质量（quality）= 投资者愿意付更高价的特征：盈利、增长、安全。盈利分量是其中证据最扎实的部分——Novy-Marx（2025）NBER 回顾论文的结论是“盈利吞没了整个质量空间”（profitability subsumes all of quality）。",
    recipe: {
      definition: "盈利分量：对每只股票取以下 6 个指标的平均排名：毛利润/总资产、ROE、ROA、现金流/总资产、毛利率、低应计（应计越低排名越高）。完整 QMJ 定义（仅作对照，不建议网站照搬）：质量分 = 盈利、增长（过去 5 年盈利增速）、安全（低 beta、低杠杆、低破产风险、低 ROE 波动）三个子分的平均；另有早期版本含派息分量。",
      ashare: "6 个指标在 A股均可算（ROA=净利润/总资产、现金流/总资产=经营现金流净额/总资产、毛利率、应计=折旧−营运资本变化），但低应计指标在 A股的定义需调整（见第 2 名预提费用缺口），且破产风险（Ohlson O-score/Altman Z-score）为安全分量用，本策略不需。",
      sorting: "盈利分量（6 指标平均排名）。",
      grouping: "与完整 QMJ 相同，但排序变量只用盈利分量：规模（NYSE 中位数分大小）×盈利分量（30%/70%），2×3 共 6 组，市值加权；做多高盈利分量、做空低盈利分量。",
      longShort: "做多高盈利分量、做空低盈利分量。",
      rebalance: "月度（AQR 数据为月度更新；论文样本为月度再平衡）。",
      fields: "营业收入、营业成本、总资产、净利润、归母净资产、经营活动现金流量净额、毛利率、应计项目（折旧−营运资本变化）、市值、beta（安全分量用，本策略可不做）。",
    },
    backtest: [
      { caliber: "盈利分量超额收益（美国）", value: "0.29%/月", t: "3.92", sample: "1963-07–2016-12", source: { label: "Asness et al. 2019 表 18 转述", url: "https://www.researchgate.net/publication/328746688_Quality_minus_junk" } },
      { caliber: "盈利分量七因子 alpha（美国）", value: "0.30%/月", t: "6.87", sample: "同上，七因子=FF 五因子+动量+BAB", source: { label: "同上（“7-factor alpha 0.30 (6.87)”）", url: "https://www.researchgate.net/publication/328746688_Quality_minus_junk" } },
      { caliber: "完整 QMJ 四因子 alpha（美国，对照）", value: "0.60%/月", t: "9.95", sample: "1957-06–2016-12", source: { label: "Summitward 转述", url: "https://summitward.com/learn/quality-minus-junk" } },
      { caliber: "完整 QMJ 四因子 alpha（全球，对照）", value: "0.61%/月", t: "8.07", sample: "1989–2016，24 国", source: { label: "同上", url: "https://summitward.com/learn/quality-minus-junk" } },
      { caliber: "完整 QMJ 六因子 alpha（加 RMW+CMA，美国）", value: "0.33%/月", t: "6.81", sample: "1963–2016", source: { label: "同上（说明 QMJ 一半以上可被 RMW 解释，RMW 载荷 0.55）", url: "https://summitward.com/learn/quality-minus-junk" } },
      { caliber: "完整 QMJ 2017 年后（美国，样本外）", value: "0.14%/月；剔 2026-07 单月（+14.3%，69 年最大单月）后仅 0.02%/月", t: "0.45", sample: "2017-01–2026-07，AQR 官方 QMJ 文件", source: { label: "Summitward 基于 AQR 数据的重算（二次计算，引用时注明）", url: "https://summitward.com/learn/quality-minus-junk" } },
      { caliber: "完整 QMJ 2017 年后（全球，样本外）", value: "0.23%/月，夏普 0.33", t: "—", sample: "2017-01–2026-07", source: { label: "同上", url: "https://summitward.com/learn/quality-minus-junk" } },
    ],
    maxDD: null, maxDDNote: "无可信数据（盈利分量与完整 QMJ 均无论文公布的最大回撤）。",
    oos: "这是 5 个策略中样本外衰减最明确的一个——美国 QMJ 2017 年后基本走平（t=0.45），全球相对好一些（0.23%/月）。网站必须在 QMJ 页面置顶标注这一事实，不可只展示 1957–2016 年样本内 alpha。另：盈利分量 2017 年后分段收益无可信数据，网站不可声称“盈利分量 2017 年后仍有效”。",
    conditions: "适用于需要“多指标平均排名”来降噪的场景；单一盈利指标噪音大时，6 指标平均排名更稳健；适合作为组合的质量过滤器，而非单一选股因子。",
    fitText: "能算，但需拆分：6 个指标在 A股均可算，但低应计指标在 A股的定义需调整（见第 2 名预提费用缺口），且破产风险为安全分量用，本策略不需。A股复制证据：Feng et al.（2020）双重选择 LASSO 在 A股发现 QMJ 强显著，但该文为工作论文/学位论文转述，且其表中 QMJ 盈利分量的系数符号在不同模型中不一致（+8/+50/+5），不可作为 A股 QMJ 盈利分量的定量证据引用，仅作“有研究关注”的定性提示。建议：网站先上盈利分量的 6 指标平均排名看板，不上增长分量（需 5 年盈利增速，A股历史短、ST 多）与安全分量（需 beta 与破产模型，另行验证）。",
    pitfalls: [
      "复合因子≠盈利因子：完整 QMJ 含增长与安全，2017 年后走平不能直接归因于盈利分量，但也不能假设盈利分量独善其身——盈利分量 2017 年后分段收益无可信数据，网站不可声称“盈利分量 2017 年后仍有效”。",
      "与 RMW 高度重叠：加 RMW 与 CMA 后 QMJ alpha 从 0.60% 腰斩至 0.33%，RMW 载荷 0.55——说明完整 QMJ 一半是 RMW 的重复。网站若已有 RMW 看板，再上完整 QMJ 属于重复建设；只上盈利分量仍有重叠（GP/ROE/ROA 均在第 1、3、4 名中出现），应标注“与第 1、3、4 名共享成分”。",
      "排名平均法的权重任意：6 指标等权平均无理论依据，任一指标定义改变都会改变排名；建议网站公开 6 指标各自的单指标排序，让用户看到是哪个指标在驱动结果。",
    ],
  },
];

// 第 8 节字段总表：字段 / 第1名 / 第2名 / 第3名 / 第4名 / 第5名 / A股可得性
const PROFIT_FIELDS = [
  { f: "营业收入", u: ["—", "✓", "✓", "✓", "✓"], avail: "✓ 标准行项目" },
  { f: "营业成本", u: ["—", "✓", "✓", "✓", "✓"], avail: "✓ 标准行项目（=主营+其他业务成本）" },
  { f: "销售费用", u: ["—", "✓", "✓", "—", "—"], avail: "✓ 标准行项目" },
  { f: "管理费用", u: ["—", "✓", "✓", "—", "—"], avail: "✓ 标准行项目（2018 年后不含研发）" },
  { f: "研发费用", u: ["—", "✓（还原 SG&A 用）", "—", "—", "—"], avail: "✓ 2018 年后单列；2018 年前在管理费用附注中，需拆分" },
  { f: "财务费用 / 利息费用", u: ["—", "—", "✓（利息费用）", "—", "—"], avail: "△ 财务费用是净额行项目；利息费用需附注拆分，无干净单行" },
  { f: "归母净利润 / 净利润", u: ["✓（分子）", "—", "—", "—", "✓"], avail: "✓ 标准行项目" },
  { f: "扣非归母净利润", u: ["✓（并列口径）", "—", "—", "—", "—"], avail: "✓ 标准行项目" },
  { f: "归母净资产 / 净资产", u: ["✓（分母）", "—", "✓（分母）", "—", "✓（ROE/ROA 分母）"], avail: "✓ 标准行项目" },
  { f: "总资产", u: ["✓（I/A 用）", "✓（分母）", "—", "✓（分母）", "✓"], avail: "✓ 标准行项目" },
  { f: "应收账款", u: ["—", "✓", "—", "—", "✓（应计用）"], avail: "✓ 标准行项目（含应收票据需合并口径说明）" },
  { f: "存货", u: ["—", "✓", "—", "—", "✓"], avail: "✓ 标准行项目" },
  { f: "预付账款", u: ["—", "✓", "—", "—", "✓"], avail: "✓ 标准行项目" },
  { f: "应付账款", u: ["—", "✓", "—", "—", "✓"], avail: "✓ 标准行项目" },
  { f: "合同负债（原预收账款）", u: ["—", "✓", "—", "—", "✓"], avail: "✓ 2018 年后为合同负债，之前为预收账款，需科目映射" },
  { f: "预提费用", u: ["—", "✓", "—", "—", "—"], avail: "✗ 无独立科目，需用其他应付款+应付职工薪酬+应交税费近似，或改现金流量表法" },
  { f: "经营活动现金流量净额", u: ["—", "✓（校验）", "—", "—", "✓（现金流/总资产）"], avail: "✓ 标准行项目" },
  { f: "折旧与摊销", u: ["—", "—", "—", "—", "✓（应计=折旧−Δ营运资本）"], avail: "△ 现金流量表附注中有，利润表无直接行" },
  { f: "流通市值 / 总市值", u: ["✓", "—", "✓", "✓", "✓"], avail: "✓ 行情数据" },
  { f: "财报公布日", u: ["✓", "✓", "✓", "✓", "✓"], avail: "✓ 巨潮/交易所公告日（防前视偏差必需）" },
];

// 第 8 节 A股落地的通用规则（5 条）
const PROFIT_RULES = [
  { n: 1, t: "剔除", d: "金融股（银行/保险/券商）、ST/*ST、上市不足 1 年、负净资产（ROE/RMW 用）、财报未按时披露。" },
  { n: 2, t: "断点", d: "用主板断点或全市场市值中位数，不用全市场等权断点；分组默认 30%/70%（与原论文一致），另提供五分位视图。" },
  { n: 3, t: "加权", d: "默认市值加权（流通市值），同时提供等权视图并标注“等权结果含微盘股偏误”。" },
  { n: 4, t: "滞后", d: "年报用公布日+1 交易日生效（最晚 4 月底），季报同理；禁止用报告期期末日。" },
  { n: 5, t: "缩尾", d: "所有盈利比率做 1%/99% 缩尾，并在页面注明。" },
];

// 第 9 节排除清单
const PROFIT_EXCLUSIONS = [
  { name: "ROIC 单因子（投入资本回报率多空）", reason: "无可信数据：未找到同行评议论文证明存在独立的 ROIC 溢价（月均收益+t 值）；现有讨论均把 ROIC 当作品质/估值概念，而非可复制的因子。Summitward 原文：“A separate ROIC premium has not been established”；且以 ROIC 为核心的 MOAT ETF 在 14 年回归中 RMW 载荷为 −0.02（t=−0.3），无盈利因子暴露。", source: { label: "Summitward — ROIC", url: "https://summitward.com/learn/roic-return-on-invested-capital" } },
  { name: "Barillas-Shanken 六因子（作为独立盈利策略）", reason: "不是新盈利定义：其盈利腿就是 q 因子 ROE（月度更新）；其贡献是模型比较方法（贝叶斯模型选择），证明“月度更新的价值+盈利+动量六因子”优于 FF 五因子（1972–2013 美股）。网站应吸收其结论（月度更新优于年度更新），但不必单列为第 6 个盈利策略。", source: null },
  { name: "经营盈利 OP/总资产（Ball et al. 2015）单列", reason: "与第 2、3 名同一分子、仅分母不同，无独立多空收益可引用（论文主检验为 Fama-MacBeth 斜率 t 值，非多空组合收益）；已并入第 3 名“分母之争”与第 2 名 OP 步骤，不单独占一个名额。", source: null },
  { name: "单变量 ROE/ROA（不经联合排序）", reason: "已被第 1 名以更严谨的三重排序覆盖；单变量版本在 Fama-MacBeth 与多空检验中均弱于联合排序版，且易受杠杆与规模混杂，无增量证据。", source: null },
  { name: "净利润/净资产、自由现金流/净资产", reason: "论文对照组明确显示弱于 GP/OP/CbOP（Novy-Marx：GP 远强于净利润；Ball：CbOP 优于净利润）。不列为前 5。", source: null },
  { name: "完整 QMJ 复合因子（盈利+增长+安全+派息）", reason: "未排除其历史证据，但未入选前 5：① 它不是纯盈利策略，增长/安全分量在 A股需另行验证；② 2017 年后美国走平（0.14%/月，t=0.45）削弱其“证据最强”地位；③ 与 RMW 重叠一半以上。本报告只取其盈利分量入选第 5 名。", source: null },
  { name: "各策略最大回撤（除 RMW 仪表盘值外）", reason: "无可信数据：q-ROE、CbOP、GP、QMJ 盈利分量的最大回撤均未在论文或官方数据图书馆中找到可引用数字；RMW 的 −41.79% 仅为数据库衍生仪表盘值（非论文），已在第 3 名卡片中标注来源与局限。其余不编造。", source: null },
  { name: "各策略 2015/2017 年后分段月均收益（除 QMJ 外）", reason: "无可信数据：除 QMJ 有 AQR 文件重算的 2017 年后分段外，q-ROE、CbOP、RMW、GP 的发表后分段月均收益未在论文或 global-q 2026-07 更新中找到可引用数字（该更新只公布显著异象个数）。本报告不推算、不外推。", source: { label: "global-q 2026-07 更新", url: "http://global-q.org/uploads/1/2/2/6/122679606/release_notes_for_july_2026_factors_and_portfolios_update.pdf" } },
];

// ---------- 盈利因子选股器（每个策略独立算因子、独立排名、独立出结果） ----------
// 数据来源：本站已有的东财接口（fetchStockAll 拉取的 incomeFull / balance / cashflow）。
// 口径说明（写在页面上，不藏在代码里）：
// - 12 只自选内排序：论文原版用全市场 2×3×3 联合排序或五分位分组；本站仅 12 只自选，
//   改为 12 只内降序、前 4 名（前 1/3）为通过，仅作演示口径，不代表全市场分组结论。
// - qROE 分母：上季末总净资产（含少数股东权益），与论文归母净资产口径略有差异；
//   分子优先用单季度归母净利润，扣非口径并列见第 1 名卡片。
// - RMW 的利息费用：用财务费用（FINANCE_EXPENSE，净额、含汇兑损益，负值=净利息收入）近似。
// - CbOP 应计：Δ应收+Δ存货−Δ应付−Δ预收款（合同负债用预收款项 ADVANCE_RECEIVABLES 近似）；
//   Δ预付账款、Δ预提费用东财 DMSK 表无字段（报告建议的近似口径“其他应付款+应付职工薪酬+
//   应交税费”在 DMSK 表中同样无字段），两项暂按 0 处理，CbOP 值存在小幅偏差，仅作排序参考。
// - QMJ 低应计：论文口径为折旧−Δ营运资本；本站现金流量表无折旧字段，改用等价的现金流量
//   口径应计（净利润−经营现金流），低应计 = −应计/总资产。
// - ETF/指数类无财报数据，全部因子值标“暂不可用”，不参与排名。
function pfSingleQ(rows, field) {
  // 单季度值：最新累计 − 同年上一季度累计；Q1 直接取累计值
  if (!rows || !rows.length) return null;
  const latest = rows[0];
  const y = reportYear(dateField(latest)), m = reportMonth(dateField(latest));
  const cur = num(latest[field]);
  if (m === 3) return cur;
  const prev = rows.find((r) => reportYear(dateField(r)) === y && reportMonth(dateField(r)) === m - 3);
  if (!prev) return null;
  return cur - num(prev[field]);
}
function pfRowAt(rows, y, m) {
  return (rows || []).find((r) => reportYear(dateField(r)) === y && reportMonth(dateField(r)) === m) || null;
}
// 对一只股票算出 5 个策略各自的因子值（互不干扰）；算不出的字段为 null，不编数
function calcFactorValues(data) {
  const out = { code: data.code, name: (data.quote && data.quote.name) || data.code, missing: [] };
  const inc = data.incomeFull || [];
  const bal = data.balance || [];
  const cf = data.cashflow || [];
  if (!inc.length) out.missing.push("利润表无数据");
  if (!bal.length) out.missing.push("资产负债表无数据");
  if (!cf.length) out.missing.push("现金流量表无数据");
  const latestBal = bal[0] || null;
  const ly = latestBal ? reportYear(dateField(latestBal)) : 0;
  const lm = latestBal ? reportMonth(dateField(latestBal)) : 0;
  const prevYearEndBal = ly ? pfRowAt(bal, ly - 1, 12) : null;
  const sameQLastYearBal = ly ? pfRowAt(bal, ly - 1, lm) : null;
  const prevQBal = ly ? (lm === 3 ? pfRowAt(bal, ly - 1, 12) : pfRowAt(bal, ly, lm - 3)) : null;
  const totalAssets = latestBal ? num(latestBal.TOTAL_ASSETS) : 0;
  const totalEquity = latestBal ? num(latestBal.TOTAL_EQUITY) : 0;
  const ttm = (rows, f) => { const r = calcTTM(rows, f); return r ? r.value : null; };
  const ttmRev = ttm(inc, "TOTAL_OPERATE_INCOME");
  const ttmCost = ttm(inc, "OPERATE_COST");
  const ttmSale = ttm(inc, "SALE_EXPENSE");
  const ttmManage = ttm(inc, "MANAGE_EXPENSE");
  const ttmFin = ttm(inc, "FINANCE_EXPENSE");
  const ttmNP = ttm(inc, "PARENT_NETPROFIT");
  const ttmCFO = ttm(cf, "NETCASH_OPERATE");
  // 第 1 名 q因子ROE：单季度归母净利润 / 上季末净资产；辅助：TTM ROE、I/A
  const sqNP = pfSingleQ(inc, "PARENT_NETPROFIT");
  const prevQEquity = prevQBal ? num(prevQBal.TOTAL_EQUITY) : 0;
  out.qroe = (sqNP != null && prevQEquity) ? sqNP / prevQEquity : null;
  out.qroeTtm = (ttmNP != null && totalEquity) ? ttmNP / totalEquity : null;
  const prevYearEndTA = prevYearEndBal ? num(prevYearEndBal.TOTAL_ASSETS) : 0;
  out.invAsset = (totalAssets && prevYearEndTA) ? (totalAssets - prevYearEndTA) / prevYearEndTA : null;
  // 第 3 名 RMW：OP = 营收−成本−销售−管理−财务费用（利息费用≈财务费用）；分母净资产/总资产双版本
  const opNum = (ttmRev != null && ttmCost != null && ttmSale != null && ttmManage != null && ttmFin != null)
    ? ttmRev - ttmCost - ttmSale - ttmManage - ttmFin : null;
  out.opNum = opNum;
  out.opBE = (opNum != null && totalEquity) ? opNum / totalEquity : null;
  out.opAT = (opNum != null && totalAssets) ? opNum / totalAssets : null;
  // 第 4 名 GP：毛利/总资产 + 毛利率
  out.gp = (ttmRev != null && ttmCost != null && totalAssets) ? (ttmRev - ttmCost) / totalAssets : null;
  out.grossMargin = (ttmRev && ttmRev !== 0 && ttmCost != null) ? (ttmRev - ttmCost) / ttmRev : null;
  // 第 2 名 CbOP：CbOP = (OP − 应计) / 滞后总资产（上年末）；应计为 TTM 口径的资产负债表变化量
  let accrual = null, parts = null;
  if (latestBal && sameQLastYearBal) {
    const dRece = num(latestBal.ACCOUNTS_RECE) - num(sameQLastYearBal.ACCOUNTS_RECE);
    const dInv = num(latestBal.INVENTORY) - num(sameQLastYearBal.INVENTORY);
    const dPay = num(latestBal.ACCOUNTS_PAYABLE) - num(sameQLastYearBal.ACCOUNTS_PAYABLE);
    const dAdvRecv = num(latestBal.ADVANCE_RECEIVABLES) - num(sameQLastYearBal.ADVANCE_RECEIVABLES);
    accrual = dRece + dInv - dPay - dAdvRecv; // Δ预付、Δ预提费用无字段，暂按 0（见文件头口径说明）
    parts = { dRece, dInv, dPay, dAdvRecv };
  }
  out.cbopParts = parts;
  out.cbop = (opNum != null && accrual != null && prevYearEndTA) ? (opNum - accrual) / prevYearEndTA : null;
  out.cbopOp = (opNum != null && prevYearEndTA) ? opNum / prevYearEndTA : null;
  out.cbopAccrual = (accrual != null && prevYearEndTA) ? accrual / prevYearEndTA : null;
  // 第 5 名 QMJ 盈利分量：6 指标（TTM 口径），低应计用现金流量口径近似
  const roa = (ttmNP != null && totalAssets) ? ttmNP / totalAssets : null;
  const cfoTA = (ttmCFO != null && totalAssets) ? ttmCFO / totalAssets : null;
  const lowAccrual = (ttmNP != null && ttmCFO != null && totalAssets) ? -((ttmNP - ttmCFO) / totalAssets) : null;
  out.qmj = { gp: out.gp, roe: out.qroeTtm, roa, cfoTA, grossMargin: out.grossMargin, lowAccrual };
  return out;
}
const PF_QMJ_LABELS = [
  ["gp", "GP/总资产"], ["roe", "ROE"], ["roa", "ROA"],
  ["cfoTA", "现金流/总资产"], ["grossMargin", "毛利率"], ["lowAccrual", "低应计"],
];
const PF_SCREENERS = [
  { rank: 1, title: "q因子ROE 选股器",
    rule: "12 只自选内按单季度 ROE 降序，前 4 名为通过。论文原版用全市场 2×3×3 联合排序（规模×投资×ROE），本站 12 只样本仅作演示口径。",
    note: "分母为上季末总净资产（含少数股东权益），与论文归母净资产口径略有差异；I/A = 总资产年变化 / 上年末总资产。",
    valueOf: (fv) => fv.qroe,
    cols: [["单季度ROE", (fv) => fv.qroe], ["TTM ROE", (fv) => fv.qroeTtm], ["I/A（投资/资产）", (fv) => fv.invAsset]] },
  { rank: 2, title: "现金经营盈利 CbOP 选股器",
    rule: "12 只自选内按 CbOP 降序，前 4 名为通过。注意中国样本反转：OP 反过来吞没 CbOP，A股不要单独用 CbOP 作主因子，须与 OP（第 3 名）并列看。",
    note: "应计 = Δ应收+Δ存货−Δ应付−Δ预收款（合同负债用预收款项近似）；Δ预付账款、Δ预提费用东财 DMSK 表无字段，暂按 0 处理，CbOP 值存在小幅偏差，仅作排序参考。",
    valueOf: (fv) => fv.cbop,
    cols: [["CbOP", (fv) => fv.cbop], ["OP/滞后总资产", (fv) => fv.cbopOp], ["应计/滞后总资产", (fv) => fv.cbopAccrual]] },
  { rank: 3, title: "FF RMW（OP/净资产）选股器",
    rule: "12 只自选内按 OP/净资产降序，前 4 名为通过。论文原版 2×3 分组、年度调仓；本站 12 只样本仅作演示口径。",
    note: "利息费用≈财务费用（净额，含汇兑损益，负值=净利息收入）；OP/总资产为分母之争的并列版本。",
    valueOf: (fv) => fv.opBE,
    cols: [["OP/净资产", (fv) => fv.opBE], ["OP/总资产", (fv) => fv.opAT]] },
  { rank: 4, title: "毛利润率 GP/总资产 选股器",
    rule: "12 只自选内按 GP/总资产降序，前 4 名为通过。论文原版五分位、年度调仓；本站 12 只样本仅作演示口径。须行业内比较（白酒毛利率>60%，与制造业不可直接比）。",
    note: "分母为最新总资产（当期口径）；论文也检验过滞后一年总资产版本（0.16%/月，t=1.04，显著性弱很多）。",
    valueOf: (fv) => fv.gp,
    cols: [["GP/总资产", (fv) => fv.gp], ["毛利率", (fv) => fv.grossMargin]] },
  { rank: 5, title: "QMJ 盈利分量 选股器",
    rule: "6 个盈利指标各自在 12 只内排名，取平均排名百分位为盈利分量得分，降序前 4 名为通过。论文原版 2×3 分组、月度调仓；本站 12 只样本仅作演示口径。",
    note: "低应计用现金流量口径近似（−(净利润−经营现金流)/总资产），论文原口径为折旧−Δ营运资本；得分按可用指标平均，缺指标的股票在排名格里标“—”。",
    valueOf: null, // QMJ 用复合得分，见 pfScreenTable 特殊处理
    cols: [["盈利分量得分", (fv) => fv.qmjScore]] },
];
const pfPct = (v) => (v == null || !isFinite(v) ? "—" : (v * 100).toFixed(2) + "%");
const pfEsc = (s) => String(s == null ? "" : s); // 模块级转义（renderProfitFactor 内的 esc2 是函数级，选股器函数用不到）
function pfScreenTable(rank, items) {
  const cfg = PF_SCREENERS.find((s) => s.rank === rank);
  if (!cfg) return "";
  // QMJ：先算 6 个指标各自的 12 只内排名，再算平均排名百分位
  if (rank === 5) {
    for (const [key] of PF_QMJ_LABELS) {
      const vals = items.filter((it) => !it.error && it.qmj && it.qmj[key] != null)
        .map((it) => ({ code: it.code, v: it.qmj[key] })).sort((a, b) => b.v - a.v);
      vals.forEach((x, i) => {
        const it = items.find((y) => y.code === x.code);
        it.qmjRanks = it.qmjRanks || {};
        it.qmjRanks[key] = (i + 1) + "/" + vals.length;
      });
    }
    for (const it of items) {
      if (it.error || !it.qmj) { it.qmjScore = null; continue; }
      const rs = PF_QMJ_LABELS.map(([key]) => it.qmj[key]).filter((v) => v != null);
      if (!rs.length) { it.qmjScore = null; continue; }
      // 平均排名百分位：每指标排名转百分位后平均（12 只内）
      const pcts = PF_QMJ_LABELS.map(([key]) => {
        if (it.qmj[key] == null) return null;
        const peers = items.filter((y) => !y.error && y.qmj && y.qmj[key] != null).map((y) => y.qmj[key]).sort((a, b) => a - b);
        const le = peers.filter((v) => v <= it.qmj[key]).length;
        return le / peers.length * 100;
      }).filter((v) => v != null);
      it.qmjScore = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;
    }
  }
  const rows = items.map((it) => ({ it, v: cfg.valueOf ? cfg.valueOf(it) : it.qmjScore }));
  const ranked = rows.filter((r) => !r.it.error && r.v != null).sort((a, b) => b.v - a.v);
  ranked.forEach((r, i) => { r.rankNo = i + 1; r.pass = i < 4; });
  rows.sort((a, b) => (a.rankNo || 999) - (b.rankNo || 999));
  let html = `<h4>${cfg.title}</h4><p class="muted">${cfg.rule}</p><p class="muted">${cfg.note}</p>
  <table class="tbl"><tr><th>排名</th><th>股票</th>${cfg.cols.map((c) => `<th>${c[0]}</th>`).join("")}${rank === 5 ? "<th>6 指标各自排名</th>" : ""}<th>结论</th></tr>`;
  for (const r of rows) {
    const it = r.it;
    if (it.error) {
      html += `<tr><td>—</td><td style="text-align:left">${pfEsc(it.name || it.code)}</td>${cfg.cols.map(() => "<td>—</td>").join("")}${rank === 5 ? "<td>—</td>" : ""}<td>暂不可用（拉取失败）</td></tr>`;
      continue;
    }
    if (r.v == null) {
      const reason = (it.missing && it.missing.length) ? it.missing.join("；") : "财报数据缺失";
      html += `<tr><td>—</td><td style="text-align:left">${pfEsc(it.name || it.code)}</td>${cfg.cols.map(() => "<td>—</td>").join("")}${rank === 5 ? "<td>—</td>" : ""}<td>暂不可用（${pfEsc(reason)}）</td></tr>`;
      continue;
    }
    const cols = cfg.cols.map((c) => `<td class="num">${rank === 5 ? (c[1](it) == null ? "—" : c[1](it).toFixed(1)) : pfPct(c[1](it))}</td>`).join("");
    const qmjRanks = rank === 5 ? `<td style="text-align:left">${PF_QMJ_LABELS.map(([key, label]) => label + " " + ((it.qmjRanks && it.qmjRanks[key]) || "—")).join(" · ")}</td>` : "";
    html += `<tr><td class="num">${r.rankNo}</td><td style="text-align:left">${pfEsc(it.name || it.code)}</td>${cols}${qmjRanks}<td><b>${r.pass ? "通过" : "不通过"}</b></td></tr>`;
  }
  html += `</table><p class="muted">通过 = 12 只自选内前 4 名（前 1/3）。选股器结果只对这 12 只自选负责，不代表全市场分组结论；财报为最新已披露季报口径（TTM 按累计值换算）。仅供学习参考，不构成投资建议。</p>`;
  return html;
}
const pfScreenCache = {};
async function runProfitScreener(rank) {
  const resEl = document.getElementById("pfScreenResult");
  if (!resEl) return;
  const wl = (typeof watchlist !== "undefined" && watchlist && watchlist.length)
    ? watchlist : ((typeof DEFAULT_WATCHLIST !== "undefined") ? DEFAULT_WATCHLIST : []);
  if (!wl.length) { resEl.innerHTML = "<p class=\"muted\">自选为空。</p>"; return; }
  const cfg = PF_SCREENERS.find((s) => s.rank === rank);
  resEl.innerHTML = `<div class="loading">正在拉取 ${wl.length} 只股票财报数据（${cfg ? cfg.title : ""}）…</div>`;
  const items = [];
  for (const s of wl) {
    try {
      let entry = null;
      if (typeof compareCache !== "undefined" && compareCache[s.code] && compareCache[s.code].data) entry = compareCache[s.code];
      else if (pfScreenCache[s.code]) entry = pfScreenCache[s.code];
      if (!entry) {
        const data = await fetchStockAll(s.code);
        entry = { data };
        pfScreenCache[s.code] = entry;
      }
      const fv = calcFactorValues(entry.data);
      fv.name = s.name || fv.name;
      items.push(fv);
    } catch (e) { items.push({ code: s.code, name: s.name, error: String((e && e.message) || e) }); }
  }
  resEl.innerHTML = pfScreenTable(rank, items);
}

function renderProfitFactor() {
  const el = document.getElementById("profitFactorBody");
  if (!el) return;
  const esc2 = (s) => String(s == null ? "" : s);
  let html = "";
  html += `<p><b>一句话结论：盈利因子整体是因子动物园中复制率相对较高的家族——Hou et al.（2020）452 个异象中盈利类 79 个，2026-07 global-q 更新显示 1967–2025 年显著数从 35 升至 44（价值类 29→9、投资类 28→22）。但这不等于每个盈利定义都成立：定义细节决定成败（分母用总资产还是净资产、是否扣研发、是否剔应计、月度还是年度更新），且 A股复制研究（Li et al. 2024）显示用主板断点+市值加权后 469 个异象中 83.37% 无显著多空利差——A股照搬美股等权/全市场断点的做法会严重高估胜率。</b></p>`;
  html += `<p class="muted">排序依据：证据强度（t 值、多重检验与复制稳健性、样本外表现）× A股可复制性。阅读提示：所有“年化超额”除非注明为论文原文给出的年化数，一律为“月均×12 的简单年化”，不等于复利年化；所有收益均为毛收益（未扣交易成本、未扣融券成本）；做空端在中国 A股个人投资者层面基本不可直接复制，落地以“多头超配/剔除弱盈利”为主。</p>`;
  html += `<h3>给网站的最重要三条建议</h3><ul>
    <li>先上第 1 名（季度 ROE，月度调仓）和第 3 名（年度 RMW，年度调仓）做双轨看板，二者定义不同、信息互补。</li>
    <li>第 2 名 CbOP 在 A股不要单独作为主因子，必须与 OP 并列展示并标注“中国样本中 OP 反过来吞没 CbOP”（Du et al. 2020）。</li>
    <li>第 5 名只上“盈利分量”，不上完整 QMJ 复合分（增长/安全/派息在 A股字段与定义上均需另行验证），且必须在页面上标注 2017 年后美国 QMJ 走平的样本外事实。</li>
  </ul>`;

  for (const m of PROFIT_FACTORS) {
    html += `<div class="card" style="margin-bottom:12px">
      <h3>#${m.rank} ${esc2(m.name)} <span class="tag">${esc2(m.stars)}</span> <span class="tag">A股适配：${esc2(m.fit)}</span></h3>
      <p><b>一句话：</b>${esc2(m.tagline)}</p>
      <p><b>核心逻辑：</b>${esc2(m.logic)}</p>
      <h4>因子方案（精确到可落地）</h4>
      <table class="tbl"><tr><th style="width:110px">项目</th><th>内容</th></tr>
      <tr><td>因子定义</td><td style="text-align:left">${esc2(m.recipe.definition)}</td></tr>
      <tr><td>A股转译/口径</td><td style="text-align:left">${esc2(m.recipe.ashare)}</td></tr>
      <tr><td>排序变量</td><td style="text-align:left">${esc2(m.recipe.sorting)}</td></tr>
      <tr><td>分组方法</td><td style="text-align:left">${esc2(m.recipe.grouping)}</td></tr>
      <tr><td>做多/做空构造</td><td style="text-align:left">${esc2(m.recipe.longShort)}</td></tr>
      <tr><td>调仓频率</td><td style="text-align:left">${esc2(m.recipe.rebalance)}</td></tr>
      <tr><td>所需数据字段</td><td style="text-align:left">${esc2(m.recipe.fields)}</td></tr>
      </table>
      <h4>回测数据</h4>
      <table class="tbl"><tr><th>口径</th><th>收益</th><th>t 值</th><th>样本</th><th>来源</th></tr>
      ${m.backtest.map((b) => `<tr><td>${esc2(b.caliber)}</td><td class="num">${esc2(b.value)}</td><td class="num">${esc2(b.t)}</td><td style="text-align:left">${esc2(b.sample)}</td><td><a href="${b.source.url}" target="_blank" rel="noopener">${esc2(b.source.label)}</a></td></tr>`).join("")}
      </table>
      <p style="margin-top:8px"><b>最大回撤：</b>${m.maxDD == null ? `<span class="tag" style="background:#fef3c7;color:#92400e">⚠️ 无可信数据</span> ${esc2(m.maxDDNote)}` : esc2(m.maxDD) + "——" + esc2(m.maxDDNote)}</p>
      <p><b>样本外表现：</b>${esc2(m.oos)}</p>
      <p><b>适用条件：</b>${esc2(m.conditions)}</p>
      <p><b>A股适配：</b>${esc2(m.fitText)}</p>
      <p><b>已知的坑：</b></p><ul>${m.pitfalls.map((p) => `<li>${esc2(p)}</li>`).join("")}</ul>
    </div>`;
  }

  html += `<h3>对照表</h3>
  <p class="muted">年化超额不可直接比较——CbOP 的 4.8% 是论文原文年化数，其余为月均×12 简单年化；t 值不可直接比较——回归斜率 t、alpha t 与多空利差 t 是三种不同统计量，表中已按“利差/alpha”分开标注；最大回撤除 RMW 仪表盘衍生值（−41.79%）外，其余 4 个策略均为无可信数据，故未列入对照表。</p>
  <table class="tbl"><tr><th>排名</th><th>策略名</th><th>因子定义（分子/分母）</th><th>年化超额（毛收益）</th><th>t 值</th><th>样本</th><th>市场</th><th>A股适配度</th></tr>
  <tr><td>1</td><td>q因子ROE（HXZ）</td><td style="text-align:left">季度非常项目前收益 / 上季末账面权益；2×3×3 联合排序，月度调仓</td><td class="num">6.96%（0.58%/月）</td><td class="num">4.81</td><td>1972–2012（扩展至 1967–2016：0.55%/月，t=5.25）</td><td>美股；A股 2007 年后 q 模型最佳</td><td>★★★★★</td></tr>
  <tr><td>2</td><td>现金经营盈利 CbOP（Ball et al.）</td><td style="text-align:left">（收入−成本−SG&A）−应计 / 滞后总资产；年度调仓</td><td class="num">4.8%（论文原文年化数）</td><td class="num">6.3</td><td>1963–2013</td><td>美股；中国反转：OP 吞没 CbOP</td><td>★★★☆☆（单独）</td></tr>
  <tr><td>3</td><td>FF RMW（OP/净资产）</td><td style="text-align:left">（收入−成本−SG&A−利息）/ 账面权益；2×3，年度调仓</td><td class="num">3.0%（0.25%/月）</td><td class="num">2.92</td><td>1963–2013（606 个月）</td><td>美股+23 国（日本弱）</td><td>★★★☆☆（证据混杂）</td></tr>
  <tr><td>4</td><td>毛利润率 GP/总资产（Novy-Marx）</td><td style="text-align:left">（收入−营业成本）/ 总资产；五分位，年度调仓</td><td class="num">3.72%（0.31%/月）；FF3 alpha 6.24%（0.52%/月）</td><td class="num">2.49（利差）；4.49（alpha）</td><td>1963–2010</td><td>美股 NYSE</td><td>★★★★☆</td></tr>
  <tr><td>5</td><td>QMJ 盈利分量（Asness et al.）</td><td style="text-align:left">GP/总资产、ROE、ROA、现金流/总资产、毛利率、低应计的平均排名；2×3，月度调仓</td><td class="num">3.48%（0.29%/月）；七因子 alpha 3.6%（0.30%/月）</td><td class="num">3.92（超额）；6.87（alpha）</td><td>1963–2016（美国）</td><td>美股+24 国；美国完整 QMJ 2017 年后走平</td><td>★★★☆☆</td></tr>
  </table>`;

  html += `<h3>字段总表（按策略）与 A股财报可得性</h3>
  <p class="muted">可得性依据：证监会投资者教育栏目列示利润表按功能分类为营业成本、销售费用、管理费用、研发费用、财务费用，现金流量表分经营/投资/筹资三部分，经营活动现金流量净额为标准披露项。</p>
  <table class="tbl"><tr><th>数据字段（A股名称）</th><th>第 1 名 ROE</th><th>第 2 名 CbOP</th><th>第 3 名 RMW</th><th>第 4 名 GP</th><th>第 5 名 QMJ 盈利</th><th>A股财报可得性</th></tr>
  ${PROFIT_FIELDS.map((r) => `<tr><td style="text-align:left"><b>${esc2(r.f)}</b></td>${r.u.map((x) => `<td>${esc2(x)}</td>`).join("")}<td style="text-align:left">${esc2(r.avail)}</td></tr>`).join("")}
  </table>
  <p class="muted">复用 vs 新增（相对站内已有 64 个因子看板）：可复用（大概率已有）——ROE、ROA、毛利率、净利润、净资产、总资产、市值，第 1、4、5 名的大部分字段应已存在，只需新增“季度 ROE（单季度口径）”与“TTM ROE”两个时间口径。需新增——① CbOP 及其 6 个应计子项的变化量（Δ应收、Δ存货、Δ预付、Δ应付、Δ合同负债、Δ其他应付款），这是第 2 名落地的核心工作量；② OP 的两个分母版本（OP/BE、OP/AT）与 GP 的两种分母（当期总资产/滞后总资产）；③ 财报公布日字段（若现有看板用季末日，必须改）；④ 主板断点（用于分组断点计算，需单独存断点表）。建议看板顺序：先上 ROE（第 1 名）→ RMW-OP 双分母（第 3 名）→ GP（第 4 名）→ CbOP 与 OP 并列（第 2 名）→ QMJ 盈利分量 6 指标排名（第 5 名）。每新增一个看板，先用 2007 年后 A股样本做主板断点+市值加权自测并公布 IC/多空利差，再上线。</p>`;

  html += `<h3>A股落地的通用规则（5 条，写进网站方法论）</h3>
  <table class="tbl"><tr><th>#</th><th>规则</th><th>内容</th></tr>
  ${PROFIT_RULES.map((r) => `<tr><td class="num">${r.n}</td><td><b>${esc2(r.t)}</b></td><td style="text-align:left">${esc2(r.d)}</td></tr>`).join("")}
  </table>`;

  html += `<h3>排除清单（查过但无可信数据或数据不支持）</h3>
  <table class="tbl"><tr><th>候选</th><th>排除原因</th><th>来源</th></tr>
  ${PROFIT_EXCLUSIONS.map((x) => `<tr><td><b>${esc2(x.name)}</b></td><td style="text-align:left">${esc2(x.reason)}</td><td>${x.source ? `<a href="${x.source.url}" target="_blank" rel="noopener">${esc2(x.source.label)}</a>` : "—"}</td></tr>`).join("")}
  </table>`;
  html += `<h3>选股器：每个策略独立选股（12 只自选）</h3>
  <p class="muted">点一个策略，就用该策略自己的因子方案（公式、阈值、分组规则）对自选里的 12 只监控股逐只算因子值、给通过/不通过和排名；五个策略互不干扰、各出各的选股结果。数据用站里已有的东财财报接口实时算。口径：12 只内降序、前 4 名（前 1/3）为通过——论文原版用全市场分组，本站 12 只样本仅作演示口径，不代表全市场分组结论。算不出的字段（如 CbOP 的预提费用）处理方式见各选股器下方的注明，实在算不出的股票标“暂不可用”，不编数。</p>
  <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">
    ${PF_SCREENERS.map((s) => `<button class="primary" id="pfScreenBtn${s.rank}" style="padding:9px 14px;border:none;border-radius:8px;background:var(--blue);color:#fff;font-size:14px">第 ${s.rank} 名：${esc2(s.title.replace(" 选股器", ""))}</button>`).join("")}
  </div>
  <div id="pfScreenResult"><p class="muted">点上方任一策略开始选股（首次需拉取 12 只股票的财报数据，约半分钟；已拉取过的股票会用缓存）。</p></div>`;

  html += `<p class="muted">来源：研究报告 ~/workspace/research_notes/profitability-factor-top5-20261109-0703/report.md（2026-11-09）。仅供学习参考，不构成投资建议；回测是历史数据的统计，不是未来收益的保证。</p>`;
  el.innerHTML = html;
  [1, 2, 3, 4, 5].forEach((r) => {
    const b = document.getElementById("pfScreenBtn" + r);
    if (b && b.addEventListener) b.addEventListener("click", () => runProfitScreener(r));
  });
}

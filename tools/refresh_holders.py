#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
refresh_holders.py -- 机构和超级大户模块的股东数据快照生成器。

背景（2026-11-09 实测结论）：
- 东财 F10 股东研究接口 PageAjax（emweb.securities.eastmoney.com/PC_HSF10/
  ShareholderResearch/PageAjax）curl 能返回完整数据：十大股东 sdgd、十大流通
  股东 sdltgd、股东户数 gdrs、基金持仓 jjcg、机构持股汇总 jgcc、披露日期表；
  但响应不带 Access-Control-Allow-Origin，浏览器 fetch 会被 CORS 拦截，
  纯静态站无法直接调用。
- 东财数据中心 datacenter-web 没有十大股东/基金持仓表：22 个候选表名
  （RPT_F10_MAIN_HOLDER、RPT_F10_MAIN_HOLDER2、RPT_F10_HOLDER_TOTAL、
  RPT_F10_SDGD、RPT_F10_SDLTGD、RPT_F10_HOLDER、RPT_F10_GDHS、RPT_F10_JJCG、
  RPT_F10_JGCC、RPT_F10_HOLDER_NUM、RPT_F10_TOP_HOLDER、RPT_F10_SHAREHOLDER、
  RPT_F10_SDGDH、RPT_F10_FUND_HOLD、RPT_FUND_HOLD、RPT_F10_SDLTGD2、
  RPT_DMSK_HOLDER、RPT_FUND_HOLD_STOCK、RPT_MUTUAL_HOLD_STOCK 等）
  换 columns/filter 组合重测均报 success:false, code:9501“报表配置不存在”。
- 雪球 403、巨潮反爬、fuyao 密钥在用户 Mac 的 TSP 里网站不能用——均已排除。
- 因此本站采用“同源季度快照”：本脚本定期（每季财报披露后）用 curl 拉取
  PageAjax，写成 data/holders/<code>.json 随站一起部署；浏览器只读同源
  JSON，不存在 CORS 问题。快照按季度累积，季度选择器随快照增长。

用法：
  python3 tools/refresh_holders.py            # 拉取全部 12 只自选股
  python3 tools/refresh_holders.py 600519 601899   # 只拉指定代码
  python3 tools/refresh_holders.py --from-dir /tmp/holders_snap  # 用本地已拉的原始 JSON 建快照（离线）

注意：
- PageAjax 的 dates=/date=/endDate= 参数均被忽略，接口永远只返回最新一季
  （2026-11-09 实测：dates=2026-06-30 仍返回 2026-09-30），所以历史季度
  只能靠每次披露后及时跑本脚本累积，无法事后补拉。
- 本脚本只写 data/holders/，不推仓库；跑完后由人工核对输出摘要再 git push。
"""
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone, timedelta

SITE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(SITE_DIR, "data", "holders")
CONFIG_JS = os.path.join(SITE_DIR, "js", "config.js")

PAGEAJAX = ("https://emweb.securities.eastmoney.com/PC_HSF10/"
            "ShareholderResearch/PageAjax?code={mkt}{code}")
REFERER = "https://quote.eastmoney.com/"

# 每张表只保留页面真正用到的字段，控制快照体积。
KEEP = {
    "sdgd": ["HOLDER_RANK", "HOLDER_NAME", "HOLDER_TYPE", "SHARES_TYPE",
             "HOLD_NUM", "FREE_HOLDNUM_RATIO", "HOLD_NUM_CHANGE",
             "CHANGE_RATIO", "END_DATE"],
    "sdltgd": ["HOLDER_RANK", "HOLDER_NAME", "HOLDER_TYPE", "SHARES_TYPE",
               "HOLD_NUM", "FREE_HOLDNUM_RATIO", "HOLD_NUM_CHANGE",
               "CHANGE_RATIO", "END_DATE"],
    "gdrs": ["END_DATE", "HOLDER_TOTAL_NUM", "TOTAL_NUM_RATIO",
             "AVG_FREE_SHARES", "AVG_FREESHARES_RATIO", "HOLD_FOCUS",
             "PRICE", "AVG_HOLD_AMT", "HOLD_RATIO_TOTAL",
             "FREEHOLD_RATIO_TOTAL"],
    "jjcg": ["HOLDER_CODE", "HOLDER_NAME", "ORG_TYPE", "TOTAL_SHARES",
             "HOLD_VALUE", "TOTALSHARES_RATIO", "FREESHARES_RATIO",
             "FREE_MARKET_CAP", "FREE_SHARES"],
    "jgcc": ["ORG_TYPE", "TOTAL_ORG_NUM", "TOTAL_FREE_SHARES",
             "TOTAL_SHARES_RATIO", "ALL_SHARES_RATIO"],
}


def em_market(code):
    # 与 js/api.js 的 emMarket 保持一致：5/6/9 开头为沪市，否则深市。
    return "SH" if re.match(r"^[569]", code) else "SZ"


def watchlist():
    with open(CONFIG_JS, encoding="utf-8") as f:
        text = f.read()
    pairs = re.findall(r'\{\s*code:\s*"(\d{6})",\s*name:\s*"([^"]+)"\s*\}', text)
    return pairs


def resolve_name(code):
    # 非自选股（如 E2E 用的茅台 600519）从腾讯行情接口取股票名（GBK 编码）。
    mkt = "sh" if em_market(code) == "SH" else "sz"
    url = "https://qt.gtimg.cn/q=s_%s%s" % (mkt, code)
    for _ in range(3):
        try:
            r = subprocess.run(["curl", "-sS", "-m", "15", url],
                               capture_output=True, timeout=20)
            text = r.stdout.decode("gbk", errors="ignore")
            m = re.search(r'"[^~]*~([^~]+)~', text)
            if m:
                return m.group(1)
        except Exception:
            pass
    return code


def fetch_pageajax(code):
    mkt = em_market(code)
    url = PAGEAJAX.format(mkt=mkt, code=code)
    last_err = None
    for attempt in range(3):
        try:
            r = subprocess.run(
                ["curl", "-sS", "-m", "30", url, "-H", "Referer: " + REFERER],
                capture_output=True, text=True, timeout=40)
            if r.returncode != 0:
                raise RuntimeError("curl exit %d: %s" % (r.returncode, r.stderr.strip()[:200]))
            d = json.loads(r.stdout)
            if isinstance(d, dict) and d.get("status") == -1:
                return {"_no_holder_data": True}
            if not isinstance(d, dict) or "sdgd" not in d:
                raise RuntimeError("响应不是 PageAjax 结构")
            return d
        except Exception as e:
            last_err = e
    raise last_err


def load_raw_from_dir(path, code):
    cands = [os.path.join(path, code + ".json")]
    if code == "600519":
        cands.append(os.path.join(path, "paj.json"))
    if code == "601899":
        cands.append(os.path.join(path, "paj_zj.json"))
    for cand in cands:
        if os.path.exists(cand):
            with open(cand, encoding="utf-8") as f:
                return json.load(f)
    return None


def slim(rows, keys):
    out = []
    for r in rows or []:
        out.append({k: r.get(k) for k in keys})
    return out


def quarter_key(raw):
    for table in ("sdltgd", "sdgd"):
        rows = raw.get(table) or []
        if rows and rows[0].get("END_DATE"):
            return rows[0]["END_DATE"][:10]
    return None


def build_snapshot(code, name, raw, now_str):
    path = os.path.join(OUT_DIR, code + ".json")
    snap = {"code": code, "name": name, "market": em_market(code),
            "source": "东财 F10 股东研究 PageAjax（curl 快照，浏览器端同源读取）",
            "fetched_at": now_str, "quarters": {}}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            old = json.load(f)
        snap["quarters"] = old.get("quarters", {}) or {}
        snap["empty"] = old.get("empty")
        snap["empty_reason"] = old.get("empty_reason")
    if raw.get("_no_holder_data"):
        snap["empty"] = True
        snap["empty_reason"] = "ETF 无股东结构（东财股东研究接口不接受 ETF 代码）"
        snap["quarters"] = {}
        return snap, None
    tables = {t: raw.get(t) for t in ("sdgd", "sdltgd", "gdrs", "jjcg", "jgcc")}
    all_empty = all(not (v or []) for v in tables.values())
    if all_empty:
        snap["empty"] = True
        snap["empty_reason"] = "ETF 无股东结构（无十大股东/基金持仓披露）"
        snap["quarters"] = {}
        return snap, None
    snap["empty"] = False
    snap.pop("empty_reason", None)
    qk = quarter_key(raw)
    if not qk:
        return snap, None
    snap["quarters"][qk] = {t: slim(v, KEEP[t]) for t, v in tables.items()}
    snap["quarters"][qk]["report_dates"] = {
        "sdgd": [x.get("END_DATE", "")[:10] for x in (raw.get("sdgd_date") or [])],
        "sdltgd": [x.get("END_DATE", "")[:10] for x in (raw.get("sdltgd_date") or [])],
    }
    return snap, qk


def main(argv):
    from_dir = None
    codes = []
    i = 0
    while i < len(argv):
        if argv[i] == "--from-dir" and i + 1 < len(argv):
            from_dir = argv[i + 1]
            i += 2
        else:
            codes.append(argv[i])
            i += 1
    wl = dict(watchlist())
    targets = codes if codes else list(wl.keys())
    os.makedirs(OUT_DIR, exist_ok=True)
    now_str = (datetime.now(timezone.utc) + timedelta(hours=8)).strftime("%Y-%m-%dT%H:%M:%S+08:00")
    ok, fail = [], []
    for code in targets:
        name = wl.get(code) or resolve_name(code)
        try:
            raw = load_raw_from_dir(from_dir, code) if from_dir else None
            if raw is None:
                raw = fetch_pageajax(code)
            snap, qk = build_snapshot(code, name, raw, now_str)
            with open(os.path.join(OUT_DIR, code + ".json"), "w", encoding="utf-8") as f:
                json.dump(snap, f, ensure_ascii=False, separators=(",", ":"))
            q = snap["quarters"].get(qk or "", {}) if qk else {}
            print("OK  %s %s 季度=%s 十大股东=%d 十大流通=%d 户数=%d期 基金=%d 机构汇总=%d %s"
                  % (code, name, qk or "—", len(q.get("sdgd", [])),
                     len(q.get("sdltgd", [])), len(q.get("gdrs", [])),
                     len(q.get("jjcg", [])), len(q.get("jgcc", [])),
                     "【ETF 空快照】" if snap.get("empty") else ""))
            ok.append(code)
        except Exception as e:
            fail.append((code, str(e)))
            print("FAIL %s %s: %s" % (code, name, e))
    print("\n成功 %d / 失败 %d，输出目录 %s" % (len(ok), len(fail), OUT_DIR))
    if fail:
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1:])

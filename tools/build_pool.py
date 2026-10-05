#!/usr/bin/env python3
"""把上游《高性价比人生指南》解析成选题池 content/pool.json。

上游：https://github.com/eternity4719/HowToLiveBetter
内容许可 CC BY 4.0（必须署名），代码 MIT。解析口径沿用上游 build.py 里的
COST_W / ratio_of，保证「性价比」档和上游检索页一致。

用法：
    python tools/build_pool.py                 # 自动 clone 到 .cache/source 再解析
    python tools/build_pool.py --src /path/to/HowToLiveBetter
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UPSTREAM = "https://github.com/eternity4719/HowToLiveBetter"
DEFAULT_SRC = ROOT / ".cache" / "source"
OUT = ROOT / "content" / "pool.json"

COST_W = {
    "钱": {"0": 0, "少": 1, "多": 2},
    "时间": {"少": 0, "中": 1, "多": 2},
    "毅力": {"否": 0, "些": 1, "是": 2},
}
RATIO_RANK = {"极高": 0, "高": 1, "一般": 2}

# 小红书对医疗健康、法律、金融类建议审核更严，也更容易被读成诊疗/法律意见。
# 这是我的判断，不是平台公布的名单；首批发布先从 low 里选。
SECTION_RISK = {
    **{n: "low" for n in (3, 4, 5, 6, 7, 11, 14, 21, 22, 23, 26, 31, 32)},
    **{n: "medium" for n in (8, 9, 10, 12, 15, 17, 18, 19, 25, 30)},
    **{n: "high" for n in (1, 2, 13, 16, 20, 24, 27, 28, 29, 33, 34)},
}


def ensure_source(src: Path) -> None:
    if (src / "book").is_dir():
        return
    src.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "clone", "--depth", "1", UPSTREAM, str(src)], check=True)


def ratio_of(tags: dict):
    try:
        cs = sum(COST_W[k][tags[k]] for k in ("钱", "时间", "毅力"))
    except KeyError:
        return None
    lv = tags.get("收益")
    if lv == "大":
        return "极高" if cs == 0 else ("高" if cs <= 2 else "一般")
    if lv == "中" and cs == 0:
        return "高"
    return "一般"


def parse_section(path: Path):
    n = int(path.name[:2])
    title, entries, cur = "", [], None
    for ln in path.read_text(encoding="utf-8").split("\n"):
        m = re.match(r"^#\s+(?:\d+\.\s*)?(.*)$", ln)
        if m and not title:
            title = m.group(1).strip()
            continue
        m = re.match(r"^###\s+(\d+)\.\s*(.*)$", ln)
        if m:
            cur = {"section": n, "section_title": "", "no": int(m.group(1)),
                   "title": m.group(2).strip(), "tags": {}, "last": None}
            entries.append(cur)
            continue
        if cur is None:
            continue
        mt = re.match(r"^<!--\s*成本标签:\s*(.*?)\s*-->", ln)
        if mt:
            cur["tags"] = dict(re.findall(r"(钱|时间|毅力|收益|口径)=(\S+)", mt.group(1)))
            continue
        mf = re.match(r"^-\s*(成本|说人话|收益|证据等级|来源|备注)：(.*)$", ln)
        if mf:
            cur["last"] = mf.group(1)
            cur[mf.group(1)] = mf.group(2).strip()
            continue
        if not ln.strip():
            cur["last"] = None
        elif cur["last"]:
            cur[cur["last"]] += ln.strip()
    for e in entries:
        e["section_title"] = title
        e.pop("last", None)
    return entries


def finalize(e: dict) -> dict:
    grade = (e.get("证据等级") or "").strip()[:1]
    ratio = ratio_of(e["tags"])
    sources = re.findall(r"https?://[^\s;<>)]+", e.get("来源", ""))
    risk = SECTION_RISK.get(e["section"], "medium")
    # 备注以「争议」开头 = 上游标注的争议条目，不适合做成斩钉截铁的卡片
    disputed = (e.get("备注") or "").startswith("争议")
    score = (3 - RATIO_RANK.get(ratio, 2)) * 10 + {"A": 6, "B": 3}.get(grade, 0)
    score -= {"low": 0, "medium": 4, "high": 12}[risk] + (8 if disputed else 0)
    return {
        "id": f"{e['section']:02d}-{e['no']:02d}",
        "section": e["section"],
        "section_title": e["section_title"],
        "no": e["no"],
        "title": e["title"],
        "plain": e.get("说人话", ""),
        "cost": e.get("成本", ""),
        "benefit": e.get("收益", ""),
        "grade": grade,
        "ratio": ratio,
        "tags": e["tags"],
        "risk": risk,
        "disputed": disputed,
        "note": e.get("备注", ""),
        "sources": sources,
        "score": score,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, default=DEFAULT_SRC)
    args = ap.parse_args()
    ensure_source(args.src)

    pool = []
    for p in sorted(args.src.glob("book/[0-9][0-9]-*.md")):
        pool += [finalize(e) for e in parse_section(p)]
    if not pool:
        print("没有解析到任何条目", file=sys.stderr)
        return 1
    pool.sort(key=lambda x: (-x["score"], x["id"]))

    rev = subprocess.run(["git", "-C", str(args.src), "log", "-1", "--format=%h %cd", "--date=short"],
                         capture_output=True, text=True).stdout.strip()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"upstream": UPSTREAM, "upstream_rev": rev, "license": "CC BY 4.0",
                               "count": len(pool), "entries": pool}, ensure_ascii=False, indent=1),
                   encoding="utf-8")
    low = [x for x in pool if x["risk"] == "low"]
    print(f"解析 {len(pool)} 条 → {OUT.relative_to(ROOT)}（上游 {rev}）")
    print(f"低风险章节 {len(low)} 条；其中性价比「极高」{sum(x['ratio']=='极高' for x in low)} 条，有「说人话」{sum(bool(x['plain']) for x in low)} 条")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""从选题池挑条目，生成一篇笔记的草稿：content/posts/<slug>.json + <slug>.caption.md。

用法：
    python tools/make_post.py --slug save-money-01 --title "这5种钱别花" 05-06 05-45 05-44
    python tools/make_post.py --list --risk low --ratio 极高      # 看候选

规则：
- 卡片正文只用上游「说人话」原句，不改写、不加数字（上游对这一栏有硬规定）。
- 「成本」行由上游的成本标签机械翻译，不自己编。
- title 必须你给：小红书标题上限 20 字，长标题自动截断会改意思，所以这里只校验、不替你缩写。
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from render_cards import COST_TEXT  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
POOL = ROOT / "content" / "pool.json"
TITLE_MAX = 20
MOOD_BY_TONE = {"r": "worry", "y": "think", "g": "happy", "b": "idea"}


def load_pool():
    if not POOL.exists():
        sys.exit("先跑 python tools/build_pool.py")
    return json.loads(POOL.read_text(encoding="utf-8"))["entries"]


SHORT = {"钱": {"0": "不花钱", "少": "几十到几百元", "多": "上千元"},
         "时间": {"少": "几分钟", "中": "数小时", "多": "天天占时间"},
         "毅力": {"否": "做一次就完", "些": "改一个习惯", "是": "长期坚持"}}


def cost_props(e: dict):
    t = e["tags"]
    pills = [f"{k}·{SHORT[k][t[k]]}" for k in ("钱", "时间", "毅力") if t.get(k) in SHORT[k]]
    grade = {"A": "A 级：大样本研究或官方数据", "B": "B 级：有研究，但难量化",
             "C": "C 级：经验或共识"}.get(e["grade"], e["grade"] or "待核实")
    return ([["成本", pills]] if pills else []) + [["证据", grade]]


def card_from(e: dict) -> dict:
    negative = any(w in e["title"] for w in ("不要", "不写", "不买", "不吃", "不碰", "别", "拒绝", "走开", "不跟"))
    tone = "r" if negative else "g"
    return {
        "kicker": f"第{e['section']}节 · {e['section_title']}",
        "heading": e["title"],
        "body": e["plain"],
        "props": cost_props(e),
        "tone": tone,
        "icon": "⚠️" if tone == "r" else "✅",
        "mood": MOOD_BY_TONE[tone],
        "source_id": e["id"],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="*")
    ap.add_argument("--slug")
    ap.add_argument("--title", help=f"笔记标题，≤{TITLE_MAX} 字")
    ap.add_argument("--cover", help="封面大标题，默认同 --title")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--risk", default="low", choices=["low", "medium", "high", "any"])
    ap.add_argument("--ratio", default=None)
    ap.add_argument("--limit", type=int, default=25)
    args = ap.parse_args()
    pool = load_pool()

    if args.list:
        rows = [e for e in pool if (args.risk == "any" or e["risk"] == args.risk)
                and (not args.ratio or e["ratio"] == args.ratio) and e["plain"]]
        for e in rows[: args.limit]:
            print(f"{e['id']}  {e['ratio']}/{e['grade']}  {e['title'][:44]}")
        print(f"— 共 {len(rows)} 条")
        return 0

    if not (args.ids and args.slug and args.title):
        ap.error("需要 --slug、--title 和至少一个条目 id（或用 --list）")
    if len(args.title) > TITLE_MAX:
        sys.exit(f"标题 {len(args.title)} 字，超过 {TITLE_MAX} 字上限，请自己缩")
    by_id = {e["id"]: e for e in pool}
    missing = [i for i in args.ids if i not in by_id]
    if missing:
        sys.exit(f"找不到条目：{missing}")
    es = [by_id[i] for i in args.ids]
    risky = [e["id"] for e in es if e["risk"] != "low" or e["disputed"]]

    post = {
        "slug": args.slug,
        "title": args.title,
        "cover": {
            "heading": args.cover or args.title,
            "sub": f"{len(es)} 条，按性价比挑的，每条都有出处",
            "chips": [f"性价比{es[0]['ratio']}" if es[0]["ratio"] else "高性价比", "有证据分级"],
            "mood": "happy",
            "crumb": es[0]["section_title"],
            "props": [["来源", "《高性价比人生指南》"], ["条数", str(len(es))]],
        },
        "cards": [card_from(e) for e in es],
    }
    out = ROOT / "content" / "posts"
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{args.slug}.json").write_text(json.dumps(post, ensure_ascii=False, indent=1), encoding="utf-8")

    srcs = "\n".join(f"- {e['id']}：{u}" for e in es for u in e["sources"][:2])
    cap = f"""# {args.title}

> 草稿。发布前逐项过 docs/03-content-system.md 的「发布前检查」。

## 正文（≤1000 字，目前只有骨架，请用自己的话写开头和结尾）

（开头：1~2 句讲这件事为什么值得停下来看。要有你自己的判断或经历，别只复述书。）

{chr(10).join(f"{i}. {e['title']}" for i, e in enumerate(es, 1))}

（结尾：一个具体问题引导评论，例如「你中过哪一条？」）

内容改编自《高性价比人生指南》（eternity4719/HowToLiveBetter，CC BY 4.0）。仅供参考，不构成医疗、法律或投资建议。

## 话题
#避坑 #人生指南 #性价比 #简笔画 #notion风

## 原始出处（核对用，不一定都放正文）
{srcs}

## 提示
- 涉及中国大陆法规/政策的条目，我无法替你确认当前仍然有效，发布前去原文核一遍。
{('- ⚠️ 含中/高风险章节或「争议」条目：' + ', '.join(risky) + '。医疗、法律类说法容易被判成建议，先自己读原条目的备注。') if risky else ''}
"""
    (out / f"{args.slug}.caption.md").write_text(cap, encoding="utf-8")
    print(f"草稿 → content/posts/{args.slug}.json / .caption.md")
    print(f"渲染：python tools/render_cards.py content/posts/{args.slug}.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

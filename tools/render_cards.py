#!/usr/bin/env python3
"""把 content/posts/<slug>.json 渲染成 3:4 的 Notion 风猫咪卡片（1080x1440 PNG）。

用法：
    python tools/render_cards.py content/posts/demo.json
    python tools/render_cards.py content/posts/demo.json --html-only   # 只出 HTML，调样式用

输出：output/<slug>/01-cover.png, 02-….png, … ；顺序即发布顺序。
需要：pip install playwright（浏览器用本机已有的 Chromium/Chrome，见 docs/05-setup.md）。
"""
import argparse
import base64
import html
import json
import os
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cat import cat_svg  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
W, H = 1080, 1440

# 上游 CLAUDE.md 对成本标签的定义，原样翻成读者看得懂的话
COST_TEXT = {
    "钱": {"0": "不花钱，或者还能省钱", "少": "几十到几百元", "多": "上千元或长期花钱"},
    "时间": {"少": "几分钟，顺手就做", "中": "一次几小时，或每周小时级", "多": "每天都要占时间"},
    "毅力": {"否": "做一次就完", "些": "要改一个习惯", "是": "要长期对抗惯性"},
}

CSS = """
*{box-sizing:border-box;margin:0}
body{width:%dpx;height:%dpx;background:#fff;color:#37352f;overflow:hidden;
 font-family:"PingFang SC","Noto Sans CJK SC","Microsoft YaHei","WenQuanYi Zen Hei",sans-serif}
.page{position:relative;width:100%%;height:100%%;padding:88px 92px 0}
.crumb{font-size:30px;color:#9b9a97;display:flex;gap:14px;align-items:center}
.crumb b{font-weight:500;color:#787774}
h1{font-weight:800;line-height:1.18;letter-spacing:-1px;margin-top:34px}
h2{font-weight:800;line-height:1.25;margin-top:30px}
.sub{font-size:40px;color:#787774;margin-top:28px;line-height:1.5}
.props{margin-top:44px;border-top:2px solid #ebeae8}
.prop{display:flex;gap:28px;padding:20px 0;border-bottom:2px solid #ebeae8;font-size:36px;line-height:1.4}
.prop .k{width:150px;color:#9b9a97;flex:none}
.pill{display:inline-block;padding:2px 16px;border-radius:10px;font-size:30px;margin:0 10px 8px 0;font-weight:600}
.y{background:#fbf3db;color:#7a5a12}.r{background:#fdebec;color:#9d2f2f}
.b{background:#e7f3f8;color:#1f5f80}.g{background:#edf3ec;color:#2b6b49}.gr{background:#f1f1ef;color:#5a5855}
.callout{margin-top:36px;padding:38px 44px;border-radius:20px;display:flex;gap:30px;
 font-size:46px;line-height:1.6;font-weight:500}
.callout.y{background:#fbf3db;color:#37352f}.callout.r{background:#fdebec;color:#37352f}
.callout.b{background:#e7f3f8;color:#37352f}.callout.g{background:#edf3ec;color:#37352f}
.callout .ico{font-size:50px;flex:none;line-height:1.4}
.cat{position:absolute;right:46px}
.cover .cat{bottom:-6px;right:34px}
.card .cat{bottom:-4px}
.foot{position:absolute;left:92px;right:92px;bottom:40px;font-size:25px;color:#a3a29e;line-height:1.5}
.foot{right:420px}
.card .props{width:600px;margin-top:36px}
.card .prop{padding:13px 0;font-size:31px}
.card .prop .k{width:100px}
.tags{margin-top:34px;display:flex;flex-wrap:wrap;gap:12px}
.hr{height:2px;background:#ebeae8;margin-top:36px}
"""

ROUGH = """<svg width="0" height="0" style="position:absolute"><filter id="rough">
<feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7" result="n"/>
<feDisplacementMap in="SourceGraphic" in2="n" scale="5"/></filter></svg>"""


def art(spec: dict, size: int, default_mood: str) -> str:
    """主角图。spec["image"] 指向外部生成的图片（相对仓库根目录），没有就用代码绘制的猫。

    图片用 data URI 内嵌，这样 HTML 挪到别处也能渲染。
    """
    img = spec.get("image")
    if img:
        f = (ROOT / img)
        if not f.exists():
            raise SystemExit(f"找不到图片 {img}（来自 {spec.get('heading', 'cover')}）")
        mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp"}[
            f.suffix.lstrip(".").lower()]
        b64 = base64.b64encode(f.read_bytes()).decode()
        return (f'<img class="cat" src="data:{mime};base64,{b64}" '
                f'style="width:{size}px;height:{size}px;object-fit:contain">')
    return cat_svg(spec.get("mood", default_mood), spec.get("accent", "yellow"), size)


def esc(s) -> str:
    return html.escape(str(s), quote=False)


def fit(text: str, big: int, small: int, short_len: int, long_len: int) -> int:
    n = len(text)
    if n <= short_len:
        return big
    if n >= long_len:
        return small
    return round(big - (big - small) * (n - short_len) / (long_len - short_len))


def pills(items, color="gr"):
    return "".join(f'<span class="pill {color}">{esc(i)}</span>' for i in items)


def page(body: str, cls: str) -> str:
    return (f'<!doctype html><html><head><meta charset="utf-8"><style>{CSS % (W, H)}</style></head>'
            f'<body>{ROUGH}<div class="page {cls}">{body}</div></body></html>')


def cover(post: dict, attribution: str) -> str:
    c = post["cover"]
    h = c["heading"]
    props = "".join(f'<div class="prop"><span class="k">{esc(k)}</span><span>{esc(v)}</span></div>'
                    for k, v in c.get("props", []))
    return page(f"""
<div class="crumb"><b>猫猫人生指南</b> / {esc(c.get('crumb', '高性价比'))}</div>
<h1 style="font-size:{fit(h, 118, 84, 10, 22)}px;max-width:900px">{esc(h)}</h1>
<div class="sub">{esc(c.get('sub', ''))}</div>
<div class="tags">{pills(c.get('chips', []), 'y')}</div>
<div class="props">{props}</div>
{art(c, 470, 'happy')}
<div class="foot">{esc(attribution)}</div>""", "cover")


def card(post: dict, cd: dict, idx: int, total: int, attribution: str) -> str:
    h = cd["heading"]
    tone = cd.get("tone", "y")
    props = "".join(
        f'<div class="prop"><span class="k">{esc(k)}</span><span>'
        + (pills(v, "gr") if isinstance(v, list) else esc(v)) + '</span></div>'
        for k, v in cd.get("props", []))
    body = cd.get("body", "")
    return page(f"""
<div class="crumb"><b>{esc(cd.get('kicker', ''))}</b> <span>{idx}/{total}</span></div>
<h2 style="font-size:{fit(h, 66, 48, 16, 44)}px">{esc(h)}</h2>
<div class="callout {tone}"><span class="ico">{esc(cd.get('icon', '💡'))}</span>
<span style="font-size:{fit(body, 46, 38, 60, 130)}px">{esc(body)}</span></div>
<div class="props">{props}</div>
{art(cd, 360, 'think')}
<div class="foot">{esc(attribution)}</div>""", "card")


def build(post: dict):
    attribution = post.get(
        "attribution",
        "内容改编自《高性价比人生指南》（eternity4719/HowToLiveBetter，CC BY 4.0）。仅供参考，不构成医疗、法律或投资建议。")
    pages = [("cover", cover(post, attribution))]
    cards = post.get("cards", [])
    for i, cd in enumerate(cards, 1):
        pages.append((f"c{i:02d}", card(post, cd, i, len(cards), attribution)))
    return pages


def find_browser():
    for p in (os.environ.get("CHROME"), "/opt/pw-browsers/chromium",
              shutil.which("chromium"), shutil.which("google-chrome"),
              "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"):
        if p and Path(p).exists():
            return p
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("post", type=Path)
    ap.add_argument("--html-only", action="store_true")
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()

    post = json.loads(args.post.read_text(encoding="utf-8"))
    slug = post.get("slug") or args.post.stem
    out = args.out or ROOT / "output" / slug
    out.mkdir(parents=True, exist_ok=True)
    pages = build(post)

    for n, (name, doc) in enumerate(pages, 1):
        (out / f"{n:02d}-{name}.html").write_text(doc, encoding="utf-8")
    if args.html_only:
        print(f"HTML → {out}")
        return 0

    from playwright.sync_api import sync_playwright
    exe = find_browser()
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=exe) if exe else pw.chromium.launch()
        pg = browser.new_page(viewport={"width": W, "height": H})
        for n, (name, _) in enumerate(pages, 1):
            pg.goto((out / f"{n:02d}-{name}.html").resolve().as_uri())
            pg.screenshot(path=str(out / f"{n:02d}-{name}.png"))
        browser.close()
    for f in out.glob("*.html"):
        f.unlink()
    print(f"{len(pages)} 张 → {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

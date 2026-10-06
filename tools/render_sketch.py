#!/usr/bin/env python3
"""把 content/posts/<slug>.json（sketch 格式）渲染成 1080x1440 的铅笔简笔画图文卡片。

    python tools/render_sketch.py content/posts/archive/cat-slow-blink.json

输出 output/<slug>/NN.png。页面类型：cover / 研究 / 我说 / 给你 / sources。
三层标签（研究 / 我说 / 给你）直接露给读者，让读者知道哪句是事实、哪句是叙述、哪句是邀请。
"""
import argparse
import html
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from render_cards import find_browser  # noqa: E402
from sketch import art  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
W, H = 1080, 1440
PAPER = "#f4f0e6"
INK = "#3b3a36"

CSS = f"""
*{{box-sizing:border-box;margin:0}}
body{{width:{W}px;height:{H}px;background:{PAPER};color:{INK};overflow:hidden;position:relative;
 font-family:"Kaiti SC","STKaiti","KaiTi","PingFang SC","Noto Sans CJK SC","WenQuanYi Zen Hei",sans-serif}}
.grain{{position:absolute;inset:0;opacity:.5;mix-blend-mode:multiply}}
.page{{position:absolute;inset:0;padding:110px 100px 0}}
.tag{{display:inline-block;font-size:30px;padding:4px 22px;border:2.5px solid {INK};border-radius:999px;
 opacity:.78;letter-spacing:2px}}
.big{{font-size:100px;line-height:1.22;font-weight:700;margin-top:60px;letter-spacing:-1px}}
.sub{{font-size:44px;line-height:1.6;margin-top:46px;opacity:.78}}
.txt{{font-size:58px;line-height:1.72;margin-top:70px}}
.txt p+p{{margin-top:34px}}
.dense .txt{{font-size:50px;line-height:1.66;margin-top:56px}}
.dense .txt p+p{{margin-top:22px}}
.small{{font-size:34px;opacity:.7;line-height:1.7;margin-top:34px}}
.src{{font-size:36px;line-height:1.75;margin-top:56px}}
.art{{position:absolute;left:0;right:0;bottom:30px;height:{{ARTH}}px}}
.foot{{position:absolute;left:100px;bottom:46px;font-size:26px;opacity:.5}}
"""

DEFS = """<svg width="0" height="0" style="position:absolute"><defs>
<filter id="pencil" x="-5%" y="-5%" width="110%" height="110%">
 <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="3" result="warp"/>
 <feDisplacementMap in="SourceGraphic" in2="warp" scale="7" result="d"/>
 <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="1" seed="9" result="grain"/>
 <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.7 1.55" result="gm"/>
 <feComposite in="d" in2="gm" operator="in"/>
</filter></defs></svg>"""

PAPER_GRAIN = """<svg class="grain" width="1080" height="1440"><filter id="pg">
<feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="4"/>
<feColorMatrix type="matrix" values="0 0 0 0 .35  0 0 0 0 .32  0 0 0 0 .25  0 0 0 .12 0"/></filter>
<rect width="100%" height="100%" filter="url(#pg)"/></svg>"""


def esc(s):
    return html.escape(s, quote=False)


def paras(lines):
    return "".join(f"<p>{esc(x)}</p>" for x in lines)


def page_html(p: dict, idx: int, total: int, attribution: str) -> str:
    kind = p["layer"]
    art_svg = f'<svg class="art" viewBox="0 0 800 700" preserveAspectRatio="xMidYMax meet" ' \
              f'xmlns="http://www.w3.org/2000/svg"><g filter="url(#pencil)">{art(p["art"])}</g></svg>'
    if kind == "cover":
        body = (f'<span class="tag">猫的口吻</span><div class="big">{"<br>".join(esc(x) for x in p["title"])}</div>'
                f'<div class="sub">{esc(p["sub"])}</div>')
        arth = 640
    elif kind == "sources":
        body = (f'<span class="tag">资料来源</span><div class="src">{paras(p["text"])}</div>'
                f'<div class="small">{esc(attribution)}</div>')
        arth = 300
    else:
        dense = bool(p.get("dense"))
        body = (f'<div class="{"dense" if dense else ""}"><span class="tag">{esc(kind)}</span>'
                f'<div class="txt">{paras(p["text"])}</div></div>')
        if p.get("small"):
            body += f'<div class="small">{esc(p["small"])}</div>'
        arth = 440 if dense else 560
    css = CSS.replace("{ARTH}", str(arth))
    foot = "" if kind in ("cover", "sources") else f'<div class="foot">{idx}/{total}</div>'
    return (f'<!doctype html><html><head><meta charset="utf-8"><style>{css}</style></head><body>'
            f'{DEFS}{PAPER_GRAIN}<div class="page">{body}</div>{art_svg}{foot}</body></html>')


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("post", type=Path)
    ap.add_argument("--html-only", action="store_true")
    a = ap.parse_args()
    post = json.loads(a.post.read_text(encoding="utf-8"))
    slug = post["slug"]
    out = ROOT / "output" / slug
    out.mkdir(parents=True, exist_ok=True)
    pages = post["pages"]
    files = []
    for i, p in enumerate(pages, 1):
        f = out / f"{i:02d}.html"
        f.write_text(page_html(p, i, len(pages), post["attribution"]), encoding="utf-8")
        files.append(f)
    if a.html_only:
        print(out)
        return 0
    from playwright.sync_api import sync_playwright
    exe = find_browser()
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=exe) if exe else pw.chromium.launch()
        pg = b.new_page(viewport={"width": W, "height": H})
        for f in files:
            pg.goto(f.resolve().as_uri())
            pg.screenshot(path=str(f.with_suffix(".png")))
        b.close()
    for f in files:
        f.unlink()
    print(f"{len(files)} 张 → {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""把"猫+纸"底图加白色外边，叠上卡片文字，输出 1080x1440。

用法：
  python3 tools/make_card.py <底图.png> <卡片文字.json> <输出.png> [--font 字体路径]

底图由 AI 出一次（猫+空白纸），文字由本脚本排版，所以不会有错字，改文案不用重出图。
卡片文字 json：{"title": "《页标题》", "lines": ["...", ...], "key": "可截图的一句"}
依赖：pillow。字体默认用系统里的文泉驿正黑（草稿用），正式出图请换成手写感字体。
"""
import argparse
import json

from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1440
MARGIN = 0.05          # 白色外边，占图宽
INK = (34, 34, 34)
RED = (214, 69, 69)    # 与红围巾同一专色
DEFAULT_FONT = "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"


def add_white_margin(im):
    w, h = im.size
    m = int(w * MARGIN)
    nw = w + 2 * m
    nh = round(nw * H / W)
    canvas = Image.new("RGB", (nw, nh), (255, 255, 255))
    canvas.paste(im, (m, (nh - h) // 2))
    return canvas.resize((W, H), Image.LANCZOS)


def draw_text(img, spec, font_path, text_top):
    d = ImageDraw.Draw(img)
    f_title = ImageFont.truetype(font_path, 40)
    f_line = ImageFont.truetype(font_path, 62)
    f_key = ImageFont.truetype(font_path, 74)
    x = 145
    y = text_top
    d.text((x, y), spec["title"], font=f_title, fill=(120, 120, 120))
    y += 100
    for line in spec["lines"]:
        d.text((x, y), line, font=f_line, fill=INK)
        y += 104
    y += 36
    # 可截图的关键句：加粗（描边模拟）+ 红色下划线
    d.text((x, y), spec["key"], font=f_key, fill=INK, stroke_width=2, stroke_fill=INK)
    bbox = d.textbbox((x, y), spec["key"], font=f_key)
    d.rectangle([x, bbox[3] + 14, bbox[2], bbox[3] + 22], fill=RED)
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base")
    ap.add_argument("spec")
    ap.add_argument("out")
    ap.add_argument("--font", default=DEFAULT_FONT)
    ap.add_argument("--text-top", type=int, default=560, help="文字区起点（像素，1440 高画布）")
    a = ap.parse_args()
    img = add_white_margin(Image.open(a.base).convert("RGB"))
    spec = json.load(open(a.spec, encoding="utf-8"))
    draw_text(img, spec, a.font, a.text_top)
    img.save(a.out)
    print("saved", a.out, img.size)


if __name__ == "__main__":
    main()

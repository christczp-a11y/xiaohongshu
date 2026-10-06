"""按风格指导 v3 排一张卡：纯奶白底、大标题、少量英文副标、左对齐正文、下半页放一个姿势。

用法：
  python3 tools/compose_card.py <卡片.json> <输出.png> [--poses-dir 姿势目录]

卡片 json 例：
{"title": "今日打烊", "en": "Closed Today",
 "lines": ["有人伸手，想摸我。", "", "今天的我，已经打烊了。"],
 "pose": "pose-04.png", "anchor": "br", "pose_h": 0.32, "ground": true}
- lines 里的空串 = 空一行；pose 省略则只排文字；anchor 取 br / bl / bc
- cover: true 时是封面版式（标题居中放大，姿势居中偏下）
依赖：pillow。字体默认放在 /mnt/project-files/cat-card/fonts/ （不入仓库，OFL 许可，商用前核对各自 OFL.txt）。
排版数值来自对参考笔记的实测（research/ref-note-cat-zen-2026-10-06.md）：左边距约 15%，
标题约为正文 2.2–2.4 倍，行距约 1.45 倍字号。
"""
import argparse
import json
import os
import random

from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1440
PAPER = (253, 251, 239)   # #FDFBEF
INK = (26, 15, 13)        # #1A0F0D
FONTS = os.environ.get("CARD_FONTS", "/mnt/project-files/cat-card/fonts/")
TITLE_FONT = "MaShanZheng-Regular.ttf"
BODY_FONT = "LongCang-Regular.ttf"
LATIN_FONT = "CaveatBrush-Regular.ttf"

LEFT = int(W * 0.15)
BODY_SIZE = 56
BODY_PITCH = 82
TITLE_SIZE = 124


def ground_line(d, x0, x1, y, seed=7):
    """手抖一点的地面线：折线 + 轻微起伏，线宽 5px，和猫的墨线同色。"""
    rnd = random.Random(seed)
    pts = []
    x = x0
    while x < x1:
        pts.append((x, y + rnd.uniform(-2.2, 2.2)))
        x += rnd.randint(18, 34)
    pts.append((x1, y + rnd.uniform(-2.2, 2.2)))
    d.line(pts, fill=INK, width=5, joint="curve")


def compose(spec, out, poses_dir=""):
    im = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(im)
    cover = spec.get("cover", False)
    tf = ImageFont.truetype(FONTS + TITLE_FONT, 200 if cover else TITLE_SIZE)
    lf = ImageFont.truetype(FONTS + LATIN_FONT, 52 if cover else 46)
    bf = ImageFont.truetype(FONTS + BODY_FONT, BODY_SIZE)

    if cover:
        tw = d.textlength(spec["title"], font=tf)
        d.text(((W - tw) / 2, 200), spec["title"], font=tf, fill=INK)
        if spec.get("en"):
            ew = d.textlength(spec["en"], font=lf)
            d.text(((W - ew) / 2, 450), spec["en"], font=lf, fill=INK)
        y = 600
        for l in spec.get("lines", []):
            if l:
                lw = d.textlength(l, font=bf)
                d.text(((W - lw) / 2, y), l, font=bf, fill=INK)
            y += BODY_PITCH if l else 40
    else:
        d.text((LEFT, 118), spec["title"], font=tf, fill=INK)
        ty = 118 + TITLE_SIZE + 6
        if spec.get("en"):
            d.text((LEFT + 6, ty + 4), spec["en"], font=lf, fill=INK)
            ty += 70
        y = ty + 56
        for l in spec.get("lines", []):
            if l:
                d.text((LEFT, y), l, font=bf, fill=INK)
                y += BODY_PITCH
            else:
                y += 44

    if spec.get("pose"):
        p = spec["pose"]
        pose = Image.open(p if os.path.isabs(p) else os.path.join(poses_dir, p)).convert("RGBA")
        ph = int(H * spec.get("pose_h", 0.32))
        pw = int(pose.width * ph / pose.height)
        pose = pose.resize((pw, ph), Image.LANCZOS)
        bottom = int(H * 0.88)
        anchor = spec.get("anchor", "br")
        x = {"br": W - int(W * 0.10) - pw, "bl": LEFT - 10, "bc": (W - pw) // 2}[anchor]
        y = bottom - ph
        if spec.get("ground"):
            gy = bottom - int(ph * spec.get("ground_at", 0.04))
            ground_line(d, int(W * 0.10), W - int(W * 0.10), gy)
        im = im.convert("RGBA")
        im.alpha_composite(pose, (x, y))
        im = im.convert("RGB")
    im.save(out)
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("spec")
    ap.add_argument("out")
    ap.add_argument("--poses-dir", default="")
    a = ap.parse_args()
    compose(json.load(open(a.spec)), a.out, a.poses_dir)
    print("wrote", a.out)

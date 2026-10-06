"""按风格指导 v3 排一张卡：纯奶白底、大标题、少量英文、左对齐正文、下半页放姿势。

用法：
  python3 tools/compose_card.py <卡片.json> <输出.png> [--poses-dir 姿势目录]

卡片 json 例：
{"title": "今日打烊", "en": "Closed Today", "en_pos": "after",
 "lines": ["有人伸手，想摸我。", "", "今天的我，已经打烊了。"],
 "poses": [{"file":"pose-07.png","x":0.5,"w":0.38,"bottom":0.86}]}
- lines 里的空串 = 空半行；poses 省略则只排文字；也可用旧写法 pose + anchor（br / bl / bc）
- poses: x 为左缘占页宽（null 居中），w 为宽占页宽，bottom 为底缘占页高
- en_pos: after（正文后空一行，默认）/ under（标题下方右错）/ inline（标题同行右侧）
- ground: {"y":0.86,"x0":0.1,"x1":0.9} 画一条手抖地面线；footer: 页底小字
- cover: true 时是封面版式（标题居中放大，lines 为副题，sub 为更小的一行）
依赖：pillow。字体默认放在 /mnt/project-files/cat-card/fonts/ （不入仓库，OFL 许可，商用前核对各自 OFL.txt）。

排版数值来自对参考笔记的实测（research/ref-note-cat-zen-2026-10-06.md）：左边距约 15%，
标题墨高约 8% 页宽、正文约 4%，行距约 7.5% 页宽，字距宽。
手写感：每个字单独画，带轻微的旋转、上下错位和大小差；全角标点只占半格，避免"字，　字"的空洞。
"""
import argparse
import json
import os
import random

from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1440
PAPER = (253, 251, 239)   # #FDFBEF
INK = (26, 15, 13)        # #1A0F0D
GREY = (120, 108, 100)
FONTS = os.environ.get("CARD_FONTS", "/mnt/project-files/cat-card/fonts/")
CJK_FONT = "LXGWMarkerGothic-Regular.ttf"
LATIN_FONT = "PatrickHand-Regular.ttf"

LEFT = int(W * 0.15)
TITLE_SIZE = 104
TITLE_TRACK = 0.18
BODY_SIZE = 48
BODY_TRACK = 0.16
BODY_PITCH = 84
EN_SIZE = 50

HALF = set("，。、：；！？")
_fonts = {}


def font(name, size):
    key = (name, size)
    if key not in _fonts:
        _fonts[key] = ImageFont.truetype(FONTS + name, size)
    return _fonts[key]


def layout(text, size, track, rnd, wobble):
    """逐字算出 (字, 字号, x 偏移, y 偏移, 旋转角)，返回字列表和总宽。"""
    out, x = [], 0.0
    for ch in text:
        s = int(round(size * (1 + rnd.uniform(-0.035, 0.035) * wobble)))
        f = font(CJK_FONT, s)
        adv = size * 0.62 if ch in HALF else size if ch == "—" else f.getlength(ch)
        out.append((ch, s, x, rnd.uniform(-2.2, 2.2) * wobble * size / 48, rnd.uniform(-2.6, 2.6) * wobble))
        x += adv + (0 if ch in HALF else size * track)
    return out, x - size * track


def hand(im, x, y, text, size, track, rnd, fill=INK, wobble=1.0, center=False, bold=0):
    """在 im 上从 (x, 基线 y) 写一行手写感的中文；center=True 时 x 为中心；bold 为加粗像素。返回行宽。"""
    chars, width = layout(text, size, track, rnd, wobble)
    if center:
        x -= width / 2
    for ch, s, dx, dy, rot in chars:
        tile = Image.new("L", (s * 2, s * 2), 0)
        td = ImageDraw.Draw(tile)
        if ch == "—":  # 字体里的破折号太短，画成一笔连着的横线
            my = int(s * 1.4 - s * 0.36)
            td.line([(s // 2, my), (s // 2 + s + int(size * track), my + rnd.uniform(-1, 1))], fill=255, width=max(3, s // 13))
        else:
            td.text((s // 2, int(s * 1.4)), ch, font=font(CJK_FONT, s), fill=255, anchor="ls",
                    stroke_width=bold, stroke_fill=255)
        tile = tile.rotate(rot, resample=Image.BICUBIC, center=(s, s))
        im.paste(Image.new("RGB", tile.size, fill), (int(x + dx - s // 2), int(y + dy - s * 1.4)), tile)
    return width


def latin(d, x, y, text, size, fill=INK, center=False):
    f = font(LATIN_FONT, size)
    if center:
        x -= d.textlength(text, font=f) / 2
    d.text((x, y), text, font=f, fill=fill, anchor="ls")


def ground_line(d, x0, x1, y, seed=7):
    """手抖一点的地面线：折线 + 轻微起伏，线宽 4px，和猫的墨线同色。"""
    rnd = random.Random(seed)
    pts = []
    x = x0
    while x < x1:
        pts.append((x, y + rnd.uniform(-2.0, 2.0)))
        x += rnd.randint(18, 34)
    pts.append((x1, y + rnd.uniform(-2.0, 2.0)))
    d.line(pts, fill=INK, width=4, joint="curve")


def compose(spec, out, poses_dir=""):
    im = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(im)
    rnd = random.Random(spec.get("seed", spec["title"]))

    if spec.get("cover"):
        y = int(H * 0.25)
        hand(im, W / 2, y, spec["title"], 168, 0.30, rnd, center=True)
        y += 150
        for l in spec.get("lines", []):
            if l:
                hand(im, W / 2, y, l, 64, 0.20, rnd, center=True)
            y += 100 if l else 40
        if spec.get("en"):
            latin(d, W / 2, y + 10, spec["en"], EN_SIZE, center=True)
            y += 90
        if spec.get("sub"):
            hand(im, W / 2, y + 20, spec["sub"], 36, 0.22, rnd, fill=GREY, wobble=0.6, center=True)
    else:
        en, pos = spec.get("en"), spec.get("en_pos", "after")
        tb = int(H * 0.155)                       # 标题基线
        tw = hand(im, LEFT, tb, spec["title"], TITLE_SIZE, TITLE_TRACK, rnd, bold=1)
        if en and pos == "inline":
            latin(d, LEFT + tw + 40, tb, en, EN_SIZE)
        y = tb + 140
        if en and pos == "under":
            latin(d, LEFT + int(W * 0.22), tb + 82, en, EN_SIZE)
            y += 50
        for l in spec.get("lines", []):
            if l:
                hand(im, LEFT, y, l, BODY_SIZE, BODY_TRACK, rnd)
                y += BODY_PITCH
            else:
                y += BODY_PITCH // 2
        if en and pos == "after":
            latin(d, LEFT, y + 40, en, EN_SIZE)

    # 姿势/道具：可放多个。{"file","x"(左缘占页宽),"w"(宽占页宽),"bottom"(底缘占页高)}
    items = list(spec.get("poses", []))
    if spec.get("pose"):  # 旧写法：单个姿势 + anchor
        items.append({"file": spec["pose"], "w": spec.get("pose_w", 0.3), "bottom": 0.88,
                      "x": {"br": 0.60, "bl": 0.10, "bc": 0.35}[spec.get("anchor", "br")]})
    if spec.get("ground"):
        g = spec["ground"]
        ground_line(d, int(W * g.get("x0", 0.10)), int(W * g.get("x1", 0.90)), int(H * g["y"]), seed=g.get("seed", 7))
    if items:
        im = im.convert("RGBA")
        for it in items:
            f = it["file"]
            pose = Image.open(f if os.path.isabs(f) else os.path.join(poses_dir, f)).convert("RGBA")
            pw = int(W * it["w"])
            ph = int(pose.height * pw / pose.width)
            pose = pose.resize((pw, ph), Image.LANCZOS)
            x = int(W * it["x"]) if it.get("x") is not None else (W - pw) // 2
            im.alpha_composite(pose, (x, int(H * it["bottom"]) - ph))
        im = im.convert("RGB")
    if spec.get("footer"):
        hand(im, W / 2, int(H * 0.955), spec["footer"], 26, 0.10, rnd, fill=GREY, wobble=0.3, center=True)
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

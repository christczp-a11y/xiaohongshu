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
import re

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

W, H = 1080, 1440
PAPER = (253, 251, 239)   # #FDFBEF
INK = (26, 15, 13)        # #1A0F0D
GREY = (120, 108, 100)
FONTS = os.environ.get("CARD_FONTS", "/mnt/project-files/cat-card/fonts/")
CJK_FONT = os.environ.get("CARD_CJK", "pfmmd")  # 平方萌萌哒；目录 = 按 result.css 分片的 woff2（来自 npm @chinese-fonts/pfmmd）
LATIN_FONT = "PatrickHand-Regular.ttf"

LEFT = int(W * 0.15)
TITLE_SIZE = 128
TITLE_TRACK = 0.20
BODY_SIZE = 62
BODY_TRACK = 0.26
BODY_PITCH = 86
EN_SIZE = 46

HALF = set("，。、：；！？")
_fonts = {}


def font(name, size, ch=None):
    """name 是字体文件，或是一个分片字体目录（result.css + 多个 woff2，按 unicode-range 取 ch 所在的分片）。"""
    path = FONTS + name
    if os.path.isdir(path):
        if name not in _fonts:
            css = open(os.path.join(path, "result.css"), encoding="utf8").read()
            faces = []
            for blk in re.findall(r"@font-face\s*{(.*?)}", css, re.S):
                u = re.search(r'url\("?\.?/?([^")]+\.woff2)', blk)
                r = re.search(r"unicode-range:\s*([^;]+);", blk)
                if not (u and r):
                    continue
                rs = []
                for part in r.group(1).replace("U+", "").split(","):
                    a, _, b = part.strip().partition("-")
                    rs.append((int(a, 16), int(b or a, 16)))
                faces.append((os.path.join(path, u.group(1)), rs))
            _fonts[name] = faces
        cp = ord(ch or "一")
        path = next((f for f, rs in _fonts[name] if any(a <= cp <= b for a, b in rs)), None)
        if path is None:
            raise KeyError(f"{name} 缺字：{ch}")
    key = (path, size)
    if key not in _fonts:
        _fonts[key] = ImageFont.truetype(path, size)
    return _fonts[key]


def glyph(ch, s, rot, bold, rnd, track_px):
    """把一个字画成灰度小图（已旋转、已去掉字体里的游离墨点），返回 (小图, 墨迹左缘, 墨迹宽)。"""
    tile = Image.new("L", (s * 2, s * 2), 0)
    td = ImageDraw.Draw(tile)
    if ch == "—":  # 字体里的破折号太短，画成一笔连着的横线
        my = int(s * 1.4 - s * 0.36)
        td.line([(s // 2, my), (s // 2 + s + track_px, my + rnd.uniform(-1, 1))], fill=255, width=max(3, s // 13))
    elif ch != " ":
        td.text((s // 2, int(s * 1.4)), ch, font=font(CJK_FONT, s, ch), fill=255, anchor="ls",
                stroke_width=bold, stroke_fill=255)
        tile = tile.rotate(rot, resample=Image.BICUBIC, center=(s, s))
        if ch not in HALF:
            # 平方萌萌哒个别字形带一个离主体很远的小墨点（如"想"），按连通块面积去掉
            m = np.asarray(tile) > 60
            lab, n = ndi.label(ndi.binary_dilation(m, iterations=max(2, s // 14)))
            if n > 1:
                areas = ndi.sum(m, lab, range(1, n + 1))
                keep = np.isin(lab, [i + 1 for i, a in enumerate(areas) if a >= 0.02 * areas.sum()])
                tile = Image.fromarray((np.asarray(tile) * keep).astype("uint8"))
    box = tile.getbbox()
    if not box or ch in HALF:
        return tile, s // 2, (box[2] - s // 2) if box else int(s * 0.35)
    return tile, box[0], box[2] - box[0]


def hand(im, x, y, text, size, track, rnd, fill=INK, wobble=1.0, center=False, bold=0):
    """在 im 上从 (x, 基线 y) 写一行手写感的中文；center=True 时 x 为中心；bold 为加粗像素。
    字距按墨迹宽度算（字体自带的字宽不均），track 是字与字之间的空隙占字号的比例。返回行宽。"""
    gap = size * track
    items, cx = [], 0.0
    for i, ch in enumerate(text):
        if ch in HALF and items:  # 标点紧贴前一个字
            cx -= gap * 0.45
        s = int(round(size * (1 + rnd.uniform(-0.035, 0.035) * wobble)))
        tile, left, w = glyph(ch, s, rnd.uniform(-2.6, 2.6) * wobble, bold, rnd, int(gap))
        dy = rnd.uniform(-2.2, 2.2) * wobble * size / 48
        items.append((tile, cx - left, dy, s))
        cx += w + (gap * 0.4 if ch in HALF else gap)
    width = cx - gap
    if center:
        x -= width / 2
    for tile, dx, dy, s in items:
        im.paste(Image.new("RGB", tile.size, fill), (int(x + dx), int(y + dy - s * 1.4)), tile)
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
        hand(im, W / 2, y, spec["title"], 190, 0.30, rnd, wobble=0.6, center=True, bold=1)
        y += 150
        for l in spec.get("lines", []):
            if l:
                hand(im, W / 2, y, l, 76, 0.24, rnd, wobble=0.6, center=True)
            y += 100 if l else 40
        if spec.get("en"):
            latin(d, W / 2, y + 10, spec["en"], EN_SIZE, center=True)
            y += 90
        if spec.get("sub"):
            hand(im, W / 2, y + 20, spec["sub"], 36, 0.22, rnd, fill=GREY, wobble=0.6, center=True)
    else:
        en, pos = spec.get("en"), spec.get("en_pos", "after")
        tb = int(H * 0.155)                       # 标题基线
        tw = hand(im, LEFT, tb, spec["title"], TITLE_SIZE, TITLE_TRACK, rnd, wobble=0.6, bold=1)
        if en and pos == "inline":
            latin(d, LEFT + tw + 40, tb, en, EN_SIZE)
        y = tb + 140
        if en and pos == "under":
            latin(d, LEFT + int(W * 0.22), tb + 82, en, EN_SIZE)
            y += 50
        for l in spec.get("lines", []):
            if l:
                hand(im, LEFT, y, l, BODY_SIZE, BODY_TRACK, rnd, wobble=0.6)
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

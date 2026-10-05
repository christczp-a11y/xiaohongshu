"""铅笔简笔画（SVG），用于样稿。

原则（取自对 Sara Hagale 式简笔画的观察，不复制其作品）：铅笔灰线、米白纸、寥寥几笔、
保留浅色重影、靠眼睛和嘴传情、大量留白。
这是代码绘制的**占位稿**：形状固定、不会换脸，但笔触不如真手绘。
"""

INK = "#3b3a36"


def pencil(d: str, w: float = 5.0, fill: str = "none") -> str:
    """一条主线 + 一条错位的淡重影，模拟铅笔反复描过的痕迹。"""
    return (
        f'<path d="{d}" fill="{fill}" stroke="{INK}" stroke-width="{w}" stroke-linecap="round" '
        f'stroke-linejoin="round" opacity=".88"/>'
        f'<path d="{d}" fill="none" stroke="{INK}" stroke-width="{w * 0.55}" stroke-linecap="round" '
        f'stroke-linejoin="round" opacity=".26" transform="translate(3,-2.5)"/>'
    )


def dot(x, y, r=7):
    return f'<circle cx="{x}" cy="{y}" r="{r}" fill="{INK}" opacity=".9"/>'


def _eyes(kind: str, cx: float, cy: float) -> str:
    out = ""
    for sx in (-1, 1):
        x, y = cx + sx * 56, cy + 6
        if kind == "dots":
            out += dot(x, y)
        elif kind == "wide":  # 被盯着：睁大 + 小瞳孔
            out += pencil(f"M{x-17} {y} a17 17 0 1 0 34 0 a17 17 0 1 0 -34 0", 4) + dot(x, y, 5)
        elif kind == "side":  # 看向一边
            out += pencil(f"M{x-17} {y} a17 17 0 1 0 34 0 a17 17 0 1 0 -34 0", 4) + dot(x + 9, y, 6)
        elif kind == "half":  # 半眨眼：上眼睑压下来
            out += pencil(f"M{x-22} {y-7} L{x+22} {y-7}", 4.5) + dot(x, y + 3, 5)
        elif kind == "slow":  # 慢眨眼：弯弯闭上
            out += pencil(f"M{x-22} {y-4} q22 18 44 0", 4.5)
        elif kind == "worry":
            out += dot(x, y) + pencil(f"M{x-22} {y-26} l{44*-sx*-1} {-9*sx}" if False else f"M{x-22} {y-24} l44 {-10*sx}", 3.5)
    return out


def cat(cx=400, cy=250, eyes="dots", mouth="w", scale=1.0, body=True, tail=True) -> str:
    """猫：头在 (cx,cy)，身体向下。scale 以头中心为原点缩放。"""
    g = f'<g transform="translate({cx} {cy}) scale({scale}) translate({-cx} {-cy})">'
    if body:
        g += pencil(f"M{cx-70} {cy+118} C{cx-98} {cy+230} {cx-92} {cy+300} {cx-52} {cy+332} "
                    f"L{cx+52} {cy+332} C{cx+92} {cy+300} {cx+98} {cy+230} {cx+70} {cy+118}", 5)
        g += pencil(f"M{cx-24} {cy+332} v14 M{cx+24} {cy+332} v14", 5)
    if tail:
        g += pencil(f"M{cx+84} {cy+300} C{cx+196} {cy+312} {cx+222} {cy+208} {cx+176} {cy+166}", 5)
    g += pencil(
        f"M{cx-140} {cy+10} C{cx-152} {cy-60} {cx-142} {cy-112} {cx-122} {cy-152} "
        f"L{cx-56} {cy-106} C{cx-20} {cy-122} {cx+20} {cy-122} {cx+56} {cy-106} "
        f"L{cx+122} {cy-152} C{cx+142} {cy-112} {cx+152} {cy-60} {cx+140} {cy+10} "
        f"C{cx+152} {cy+88} {cx+86} {cy+132} {cx} {cy+132} C{cx-86} {cy+132} {cx-152} {cy+88} {cx-140} {cy+10} Z",
        5.5, fill="#f7f4ec")
    g += _eyes(eyes, cx, cy)
    g += pencil(f"M{cx-9} {cy+44} h18 l-9 10 z", 3.5, fill=INK)
    if mouth == "w":
        g += pencil(f"M{cx} {cy+56} q-10 14 -22 4 M{cx} {cy+56} q10 14 22 4", 3.5)
    elif mouth == "flat":
        g += pencil(f"M{cx-18} {cy+66} h36", 3.5)
    elif mouth == "small":
        g += pencil(f"M{cx-12} {cy+64} q12 8 24 0", 3.5)
    for sy, dy in ((1, 0), (1, 16)):
        pass
    g += pencil(f"M{cx-96} {cy+46} l-96 -14 M{cx-96} {cy+62} l-92 20 "
                f"M{cx+96} {cy+46} l96 -14 M{cx+96} {cy+62} l92 20", 3)
    return g + "</g>"


def human(x=200, y=130, eyes="dots", arm=None, scale=1.0) -> str:
    """火柴人：头中心 (x,y)。arm='hand' 时右臂向前伸出一只平摊的手。"""
    g = f'<g transform="translate({x} {y}) scale({scale}) translate({-x} {-y})">'
    g += pencil(f"M{x-46} {y} a46 46 0 1 0 92 0 a46 46 0 1 0 -92 0", 5, fill="#f7f4ec")
    for sx in (-1, 1):
        ex, ey = x + sx * 17, y - 2
        if eyes == "half":
            g += pencil(f"M{ex-9} {ey-3} h18", 3.5) + dot(ex, ey + 3, 3.5)
        elif eyes == "slow":
            g += pencil(f"M{ex-10} {ey-1} q10 9 20 0", 3.5)
        elif eyes == "away":
            g += dot(ex - 8, ey, 4)
        else:
            g += dot(ex, ey, 4.5)
    g += pencil(f"M{x-10} {y+22} q10 7 20 0", 3)
    g += pencil(f"M{x} {y+46} v150", 5)  # 身体
    g += pencil(f"M{x} {y+196} l-48 118 M{x} {y+196} l48 118", 5)  # 腿
    g += pencil(f"M{x} {y+84} l-62 56", 5)  # 左臂
    if arm == "hand":
        g += pencil(f"M{x} {y+84} L{x+170} {y+112}", 5)
        hx, hy = x + 170, y + 112
        g += pencil(f"M{hx} {hy} l26 -12 M{hx} {hy} l30 0 M{hx} {hy} l26 12 M{hx} {hy} l18 22", 4)
    else:
        g += pencil(f"M{x} {y+84} l62 56", 5)
    return g + "</g>"


def paws(x, y, n=3, dx=46, dy=-10) -> str:
    out = ""
    for i in range(n):
        px, py = x + i * dx, y + i * dy
        out += pencil(f"M{px} {py} a9 7 0 1 0 18 0 a9 7 0 1 0 -18 0", 3)
        for k in (-10, 0, 10):
            out += dot(px + 9 + k, py - 14, 3)
    return out


def eye_icon(x, y, w=70) -> str:
    return (pencil(f"M{x} {y} q{w/2} {-w*0.55} {w} 0 q{-w/2} {w*0.55} {-w} 0", 4)
            + dot(x + w / 2, y, 8))


def question(x, y, size=90) -> str:
    return (f'<text x="{x}" y="{y}" font-size="{size}" font-family="serif" fill="{INK}" opacity=".85" '
            f'filter="url(#pencil)">?</text>')


# ---- 每页的插图 -------------------------------------------------------------
def art(name: str) -> str:
    if name == "cover":  # 慢眨眼的猫
        return cat(400, 230, eyes="slow", mouth="small")
    if name == "stared":  # 被盯着：睁大眼 + 视线
        gaze = eye_icon(40, 70, 90) + eye_icon(160, 70, 90)
        lines = pencil("M90 110 L300 210", 2.5) + pencil("M200 110 L320 220", 2.5)
        return gaze + lines + cat(470, 290, eyes="side", mouth="flat", scale=0.92)
    if name == "awaypilot":  # 预实验：不直视
        return (cat(300, 270, eyes="side", mouth="small", scale=0.9)
                + eye_icon(560, 150, 100)
                + pencil("M545 95 L675 215", 6))
    if name == "pair":  # 主人和猫都在慢眨眼
        return human(190, 170, eyes="half") + cat(580, 330, eyes="half", mouth="small", scale=0.62)
    if name == "hand":  # 研究员伸手，猫从右下方走近
        return (human(150, 160, eyes="slow", arm="hand")
                + cat(470, 330, eyes="slow", mouth="small", scale=0.55)
                + paws(700, 620, 3, -62, -16))
    if name == "shrug":  # 不敢打包票
        return cat(400, 270, eyes="dots", mouth="flat") + question(530, 130, 120)
    if name == "invite":  # 看向别处也可以
        return cat(400, 250, eyes="slow", mouth="small") + pencil("M70 600 q330 -60 660 0", 3)
    if name == "sources":
        return cat(560, 300, eyes="half", mouth="small", scale=0.85)
    raise ValueError(name)

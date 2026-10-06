"""把 AI 出的"姿势图集"裁成一个个带透明底的单图。

用法：
  python3 tools/cut_sheet.py <图集.png> <输出目录> [--min-area 0.002] [--gap 14]

图集要求：纯平底色，每个姿势之间有空白，互相不相连。脚本按"和底色不同的像素"找连通块，
按从上到下、从左到右的顺序编号 pose-01.png、pose-02.png……，并输出 contact.png（带编号的总览），
先看总览再用，认错编号是最常见的错。
依赖：pillow、numpy、scipy。
"""
import argparse
import os

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi


def cut(path, out_dir, min_area=0.002, gap=14):
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(float)
    h, w = a.shape[:2]
    bg = np.median(np.concatenate([a[:10].reshape(-1, 3), a[-10:].reshape(-1, 3),
                                   a[:, :10].reshape(-1, 3), a[:, -10:].reshape(-1, 3)]), axis=0)
    # 笔墨线比底色暗得多；猫身白色填充与底色只差几个灰阶，所以先用墨线找轮廓，再填洞
    ink = (a @ [.299, .587, .114]) < (bg @ [.299, .587, .114]) - 45
    # 彩色（眼、围巾、道具色块）也算前景
    color = (a.max(2) - a.min(2)) > 40
    fg = ink | color
    merged = ndi.binary_closing(fg, structure=np.ones((3, 3)), iterations=gap)
    lab, n = ndi.label(merged)
    boxes = []
    for i, sl in enumerate(ndi.find_objects(lab), 1):
        area = (lab[sl] == i).sum()
        if area < min_area * h * w:
            continue
        boxes.append((i, sl))
    # 阅读顺序：先按行聚类（以块中心 y 排序，相差 < 平均高度的一半算同一行）
    cy = [(s[0].start + s[0].stop) / 2 for _, s in boxes]
    order = sorted(range(len(boxes)), key=lambda k: cy[k])
    rows, cur = [], [order[0]] if order else []
    for k in order[1:]:
        if abs(cy[k] - np.mean([cy[j] for j in cur])) < 0.5 * np.mean([boxes[j][1][0].stop - boxes[j][1][0].start for j in cur]):
            cur.append(k)
        else:
            rows.append(cur)
            cur = [k]
    if cur:
        rows.append(cur)
    seq = [k for r in rows for k in sorted(r, key=lambda k: boxes[k][1][1].start)]

    os.makedirs(out_dir, exist_ok=True)
    pad = 6
    contact = im.copy()
    cd = ImageDraw.Draw(contact)
    saved = []
    for num, k in enumerate(seq, 1):
        i, sl = boxes[k]
        y0, y1 = max(0, sl[0].start - pad), min(h, sl[0].stop + pad)
        x0, x1 = max(0, sl[1].start - pad), min(w, sl[1].stop + pad)
        comp = ndi.binary_fill_holes(ndi.binary_closing(fg & (lab == i), structure=np.ones((3, 3)), iterations=3))
        alpha = ndi.gaussian_filter(comp.astype(float), 0.8)[y0:y1, x0:x1]
        rgba = np.dstack([a[y0:y1, x0:x1], alpha * 255]).astype(np.uint8)
        name = os.path.join(out_dir, f"pose-{num:02d}.png")
        Image.fromarray(rgba, "RGBA").save(name)
        saved.append((name, x1 - x0, y1 - y0))
        cd.rectangle([x0, y0, x1, y1], outline=(220, 40, 40), width=3)
        cd.text((x0 + 6, y0 + 6), str(num), fill=(220, 40, 40))
    contact.save(os.path.join(out_dir, "contact.png"))
    return saved


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("out_dir")
    ap.add_argument("--min-area", type=float, default=0.002)
    ap.add_argument("--gap", type=int, default=14)
    args = ap.parse_args()
    for name, w, h in cut(args.sheet, args.out_dir, args.min_area, args.gap):
        print(name, w, "x", h)

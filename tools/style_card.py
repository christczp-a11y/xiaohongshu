"""量化一张卡片图的风格参数，并按风格参数卡验收后续出图。

用法：
  python3 tools/style_card.py analyze <图片> [--json 输出.json]
  python3 tools/style_card.py check <风格参数卡.json> <图片>...

依赖：pillow、numpy、scipy。所有尺寸以纸宽（边框内宽度）的百分比表示，
这样截图缩放不影响数值。猫的位置假定在纸的左上部分（当前定稿图如此）。
"""
import argparse
import json
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi


def load_gray_rgb(path):
    im = Image.open(path).convert("RGB")
    rgb = np.asarray(im).astype(float)
    gray = rgb @ np.array([0.299, 0.587, 0.114])
    return rgb, gray


def ink_mask(gray):
    # 自适应阈值：比纸色暗得多的像素算墨线
    paper = np.median(gray)
    return gray < paper * 0.55


def locate_frame(ink):
    """用行/列墨量峰值定位手绘边框的四条边（返回像素位置）。"""
    h, w = ink.shape
    rows, cols = ink.sum(axis=1), ink.sum(axis=0)
    t = int(np.argmax(rows[: int(h * 0.15)]))
    b = int(h - int(h * 0.15) + np.argmax(rows[int(h * 0.85):]))
    l = int(np.argmax(cols[: int(w * 0.15)]))
    r = int(w - int(w * 0.15) + np.argmax(cols[int(w * 0.85):]))
    return t, b, l, r


def stroke_widths(ink):
    """用距离变换的脊线估计线宽（像素）。"""
    dt = ndi.distance_transform_edt(ink)
    ridge = (dt == ndi.maximum_filter(dt, size=3)) & (dt > 0.5)
    return dt[ridge] * 2


def analyze(path):
    rgb, gray = load_gray_rgb(path)
    h, w = gray.shape
    ink = ink_mask(gray)
    t, b, l, r = locate_frame(ink)
    pw, ph = r - l, b - t  # 纸（边框内）宽高
    out = {"image_px": [w, h], "frame_px": {"top": t, "bottom": b, "left": l, "right": r}}
    pad = max(6, int(pw * 0.02))

    # 纸色与纸纹：取边框内、离框与猫都远的中间区域
    cy0, cy1 = t + int(ph * 0.45), b - int(ph * 0.08)
    cx0, cx1 = l + int(pw * 0.1), r - int(pw * 0.1)
    patch = rgb[cy0:cy1, cx0:cx1]
    out["paper_rgb_median"] = [int(v) for v in np.median(patch.reshape(-1, 3), axis=0)]
    g = gray[cy0:cy1, cx0:cx1]
    hp = g - ndi.uniform_filter(g, 9)
    out["paper_texture_noise_std"] = round(float(hp.std()), 2)

    # 外留边颜色：图的四角边缘
    # 避开最外 6 像素（截图可能带窗口边线），取边框外的留边带
    m = 6
    margin = np.concatenate([
        rgb[m: max(m + 1, t - m), l:r].reshape(-1, 3),
        rgb[min(h - m - 1, b + m): h - m, l:r].reshape(-1, 3),
    ])
    out["outer_margin_rgb_median"] = [int(v) for v in np.median(margin, axis=0)]
    out["outer_margin_px"] = {"top": t, "bottom": h - b, "left": l, "right": w - r}

    # 线色：最暗 1% 像素均值
    dark = np.sort(rgb.reshape(-1, 3).mean(axis=1))[: max(1, h * w // 100)]
    out["ink_darkest_1pct_gray"] = int(dark.mean())

    # 边框：与直线位置的偏离（抖动）和线宽
    band = ink[max(0, t - pad): t + pad, l + pad: r - pad]
    ys = [np.where(band[:, x])[0] for x in range(band.shape[1])]
    centers = np.array([y.mean() for y in ys if len(y)])
    thick = np.array([len(y) for y in ys if len(y)])
    out["frame_top_jitter_pct_of_paper_w"] = round(float(centers.std() / pw * 100), 3)
    out["frame_line_width_pct_of_paper_w"] = round(float(np.median(thick) / pw * 100), 3)

    # 猫：去掉边框带后，左上区域剩余墨线的外接框
    clean = ink.copy()
    hw = int(np.ceil(np.median(thick))) + 2  # 只擦边框线本身，别擦到贴边的猫尾巴
    for sl in (
        (slice(max(0, t - hw), t + hw), slice(None)),
        (slice(max(0, b - hw), b + hw), slice(None)),
        (slice(None), slice(max(0, l - hw), l + hw)),
        (slice(None), slice(max(0, r - hw), r + hw)),
    ):
        clean[sl] = False
    region = np.zeros_like(clean)
    region[: t + int(ph * 0.4), : l + int(pw * 0.5)] = True
    cat = clean & region
    cat = ndi.binary_dilation(cat, iterations=3)
    lab, n = ndi.label(cat)
    if n:
        sizes = ndi.sum(cat, lab, range(1, n + 1))
        cat = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s > sizes.max() * 0.05])
        ys_, xs_ = np.where(cat & ink)
        y0, y1, x0, x1 = ys_.min(), ys_.max(), xs_.min(), xs_.max()
        out["cat_bbox_pct_of_paper"] = {
            "width": round((x1 - x0) / pw * 100, 1),
            "height": round((y1 - y0) / ph * 100, 1),
            "left_from_paper_left": round((x0 - l) / pw * 100, 1),
            "top_from_paper_top": round((y0 - t) / ph * 100, 1),
        }
        out["cat_bbox_aspect_h_over_w"] = round((y1 - y0) / max(1, (x1 - x0)), 2)
        cw = stroke_widths(ink & cat)
        out["cat_line_width_pct_of_paper_w"] = {
            "mean": round(float(cw.mean() / pw * 100), 3),
            "std": round(float(cw.std() / pw * 100), 3),
            "p10": round(float(np.percentile(cw, 10) / pw * 100), 3),
            "p90": round(float(np.percentile(cw, 90) / pw * 100), 3),
        }
    # 留白：纸内 16x16 块里完全没有墨线的比例
    inner = ink[t + pad: b - pad, l + pad: r - pad]
    bs = max(8, pw // 30)
    hh, ww = inner.shape[0] // bs, inner.shape[1] // bs
    blocks = inner[: hh * bs, : ww * bs].reshape(hh, bs, ww, bs).any(axis=(1, 3))
    out["whitespace_block_ratio"] = round(float(1 - blocks.mean()), 3)
    out["ink_pixel_ratio_in_paper"] = round(float(inner.mean()), 4)
    return out


# 验收容差：这是我给的初始建议值，没有数据验证，用几批图后应按实际调整
TOL = {
    "paper_rgb_median": 8,
    "paper_texture_noise_std": 0.6,
    "ink_darkest_1pct_gray": 25,
    "whitespace_block_ratio": 0.05,
    "frame_top_jitter_pct_of_paper_w": 0.25,
    "frame_line_width_pct_of_paper_w": 0.25,
}


def check(card, path):
    cur = analyze(path)
    fails = []
    for k, tol in TOL.items():
        a, b = card[k], cur[k]
        if isinstance(a, list):
            if max(abs(x - y) for x, y in zip(a, b)) > tol:
                fails.append((k, a, b))
        elif abs(a - b) > tol:
            fails.append((k, a, b))
    return cur, fails


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("analyze")
    a.add_argument("image")
    a.add_argument("--json")
    c = sub.add_parser("check")
    c.add_argument("card")
    c.add_argument("images", nargs="+")
    args = ap.parse_args()
    if args.cmd == "analyze":
        res = analyze(args.image)
        txt = json.dumps(res, ensure_ascii=False, indent=2)
        print(txt)
        if args.json:
            open(args.json, "w").write(txt + "\n")
    else:
        card = json.load(open(args.card))
        ok = 0
        for p in args.images:
            _, fails = check(card, p)
            ok += not fails
            print(("OK  " if not fails else "FAIL"), p, fails or "")
        print(f"{ok}/{len(args.images)} 在容差内")
        sys.exit(0 if ok == len(args.images) else 1)


if __name__ == "__main__":
    main()

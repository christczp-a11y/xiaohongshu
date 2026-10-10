"""Subset the heavy sans to the characters this app uses.

Source: Noto Sans SC (Source Han Sans by Adobe and Google), SIL OFL 1.1, the
"chinese-simplified" slices from @fontsource/noto-sans-sc@5.1.1, kept in
minigame/fonts/. The OFL reserves the name "Source", so the subsets are renamed.

usage: python3 scripts/subset-font.py
"""
import pathlib
import string

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONTS = ROOT.parents[2] / 'fonts'
FAMILY = 'LabSans'
WEIGHTS = {900: 'Heavy', 700: 'Bold'}


def used_chars() -> str:
    text = (ROOT / 'index.html').read_text(encoding='utf-8')
    for p in sorted((ROOT / 'src').glob('*.ts')):
        text += p.read_text(encoding='utf-8')
    chars = {c for c in text if ord(c) > 0x7F}
    chars |= set(string.printable.strip()) | {' '}
    return ''.join(sorted(chars))


def build(weight: int, style: str) -> None:
    out = ROOT / 'src' / 'fonts' / f'lab-sans-{weight}.woff2'
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['*']
    opts.name_IDs = ['*']
    font = TTFont(FONTS / f'noto-sans-sc-{weight}.woff2')
    sub = subset.Subsetter(opts)
    sub.populate(text=used_chars())
    sub.subset(font)
    for rec in font['name'].names:
        if rec.nameID in (1, 16):
            rec.string = FAMILY
        elif rec.nameID in (2, 17):
            rec.string = style
        elif rec.nameID == 4:
            rec.string = f'{FAMILY} {style}'
        elif rec.nameID == 6:
            rec.string = f'{FAMILY}-{style}'
        elif rec.nameID == 3:
            rec.string = f'{FAMILY}-{style};subset'
    font.flavor = 'woff2'
    font.save(out)
    print(f'{out.relative_to(ROOT)}: {out.stat().st_size} bytes')


if __name__ == '__main__':
    for w, s in WEIGHTS.items():
        build(w, s)

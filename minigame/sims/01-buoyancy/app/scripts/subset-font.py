"""Subset the title font to the characters this app uses.

The title face is Smiley Sans (得意黑) by atelierAnchor, SIL OFL 1.1, from
https://github.com/atelier-anchor/smiley-sans/releases. The OFL reserves the
names "Smiley" and "得意黑" for the original, so the subset is renamed.

usage: python3 scripts/subset-font.py path/to/SmileySans-Oblique.ttf
"""
import pathlib
import string
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'src' / 'fonts' / 'lab-title.woff2'
FAMILY = 'LabTitle'


def used_chars() -> str:
    text = (ROOT / 'index.html').read_text(encoding='utf-8')
    for p in sorted((ROOT / 'src').glob('*.ts')):
        text += p.read_text(encoding='utf-8')
    chars = {c for c in text if ord(c) > 0x7F}
    chars |= set(string.printable.strip()) | {' '}
    return ''.join(sorted(chars))


def main(src: str) -> None:
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['*']
    opts.name_IDs = ['*']
    font = TTFont(src)
    sub = subset.Subsetter(opts)
    sub.populate(text=used_chars())
    sub.subset(font)
    for rec in font['name'].names:
        if rec.nameID in (1, 4, 16):
            rec.string = FAMILY
        elif rec.nameID == 6:
            rec.string = FAMILY + '-Regular'
        elif rec.nameID == 3:
            rec.string = FAMILY + ';subset'
    font.flavor = 'woff2'
    font.save(OUT)
    print(f'{OUT.relative_to(ROOT)}: {OUT.stat().st_size} bytes')


if __name__ == '__main__':
    main(sys.argv[1])

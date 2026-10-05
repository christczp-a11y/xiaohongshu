"""猫咪简笔画主角（SVG，线稿 + 白底，Notion 插画风）。

纯代码绘制，不依赖任何图像生成服务：同一份输入永远出同一张图，
改表情只改一个参数。手绘抖动靠 render_cards 里的 #rough 滤镜统一加。
"""

STROKE = "#37352f"  # Notion 正文黑
ACCENT = {"yellow": "#f2c14e", "red": "#e8695f", "blue": "#5aa0d6", "green": "#5fb38a"}

MOODS = ("happy", "worry", "think", "idea", "sleepy")


def _eyes(mood: str) -> str:
    if mood == "happy":  # ^ ^
        return ('<path d="M146 172 q16 -20 32 0"/><path d="M222 172 q16 -20 32 0"/>')
    if mood == "sleepy":  # - -
        return '<path d="M146 174 h32"/><path d="M222 174 h32"/>'
    if mood == "worry":  # 点眼 + 八字眉
        return ('<circle cx="162" cy="176" r="7" fill="%s"/><circle cx="238" cy="176" r="7" fill="%s"/>'
                '<path d="M146 152 l30 -10"/><path d="M254 152 l-30 -10"/>' % (STROKE, STROKE))
    if mood == "think":  # 眼睛看向右上
        return ('<circle cx="168" cy="170" r="7" fill="%s"/><circle cx="244" cy="170" r="7" fill="%s"/>'
                '<path d="M146 150 h30"/>' % (STROKE, STROKE))
    return ('<circle cx="162" cy="172" r="7" fill="%s"/><circle cx="238" cy="172" r="7" fill="%s"/>'
            % (STROKE, STROKE))


def _mouth(mood: str) -> str:
    if mood == "worry":
        return '<path d="M186 214 q14 -12 28 0"/>'
    if mood == "happy":
        return '<path d="M200 196 q-12 20 -26 4"/><path d="M200 196 q12 20 26 4"/>'
    return '<path d="M200 196 q-10 12 -20 4"/><path d="M200 196 q10 12 20 4"/>'


def _prop(mood: str, color: str) -> str:
    c = ACCENT.get(color, ACCENT["yellow"])
    if mood == "worry":  # 感叹号
        return ('<path d="M330 70 v44" stroke="%s" stroke-width="10"/>'
                '<circle cx="330" cy="136" r="6" fill="%s" stroke="none"/>' % (c, c))
    if mood == "idea":  # 灯泡
        return ('<g stroke="%s"><circle cx="322" cy="92" r="22" fill="#fff8dc"/>'
                '<path d="M312 118 h20 M315 126 h14"/></g>'
                '<path d="M322 50 v-12 M352 62 l10 -8 M292 62 l-10 -8" stroke="%s"/>' % (STROKE, c))
    if mood == "think":  # 思考气泡
        return ('<circle cx="296" cy="112" r="5"/><circle cx="318" cy="90" r="9"/>'
                '<path d="M330 54 q20 -16 46 -2 q22 14 0 34 q-24 12 -46 -4 q-12 -12 0 -28z" fill="#fff"/>')
    if mood == "sleepy":  # Zzz
        return ('<text x="304" y="96" font-size="34" font-weight="700" fill="%s" stroke="none">Z</text>'
                '<text x="334" y="68" font-size="26" font-weight="700" fill="%s" stroke="none">z</text>' % (c, c))
    return ('<path d="M318 96 c-14 -16 -34 4 -18 18 l18 16 l18 -16 c16 -14 -4 -34 -18 -18z" '
            'fill="%s" stroke="%s"/>' % ("#ffd9d6", STROKE))  # 爱心


def cat_svg(mood: str = "happy", accent: str = "yellow", size: int = 360) -> str:
    """返回内联 <svg>。size 为像素边长（viewBox 400x400）。"""
    if mood not in MOODS:
        raise ValueError(f"mood 必须是 {MOODS} 之一，收到 {mood!r}")
    return f"""<svg class="cat" width="{size}" height="{size}" viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
<g filter="url(#rough)" fill="#fff" stroke="{STROKE}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
  <path d="M290 330 C350 335 372 270 336 244" fill="none"/>
  <path d="M152 244 C142 296 140 336 166 360 L234 360 C260 336 258 296 248 244 Z"/>
  <path d="M158 284 q-34 6 -42 34" fill="none"/><path d="M242 284 q34 6 42 34" fill="none"/>
  <path d="M170 360 v12 M230 360 v12" fill="none"/>
  <path d="M108 168 C104 130 108 100 112 78 L160 108 C185 100 215 100 240 108 L288 78 C292 100 296 130 292 168 C296 215 250 246 200 246 C150 246 104 215 108 168 Z"/>
  <path d="M122 100 l22 14 M278 100 l-22 14" fill="none" stroke-width="4"/>
  <g fill="none">{_eyes(mood)}</g>
  <path d="M192 186 h16 l-8 9 z" fill="{STROKE}" stroke-width="3"/>
  <g fill="none">{_mouth(mood)}</g>
  <g fill="none" stroke-width="4"><path d="M130 192 l-54 -10 M130 204 l-52 12 M270 192 l54 -10 M270 204 l52 12"/></g>
  {_prop(mood, accent)}
</g>
</svg>"""

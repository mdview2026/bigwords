# 处理 tmp/iphone12.png：裁剪 -> 逆时针转90°(刘海朝左) -> 缩放 -> 存 public/img/
# 同时量出屏幕透明洞在最终图里的位置(%内缩)和圆角半径，供落地页 CSS 用
import sys
from PIL import Image

SRC, DST, TARGET_W = sys.argv[1], sys.argv[2], int(sys.argv[3])

img = Image.open(SRC).convert('RGBA')
img = img.crop(img.getbbox())          # 贴边裁掉透明外边
img = img.transpose(Image.Transpose.ROTATE_90)  # 逆时针：顶部(刘海) -> 左侧
w0, h0 = img.size
scale = TARGET_W / w0
img = img.resize((TARGET_W, round(h0 * scale)), Image.LANCZOS)
img.save(DST, optimize=True)

W, H = img.size
a = img.getchannel('A').load()
OPAQUE = 128

def span_holes(row):
    """一行里的透明洞区间（跳过左右外侧背景：只取被不透明夹住的中间段）"""
    runs, inside, start = [], False, 0
    for x in range(W):
        t = a[x, row] < OPAQUE
        if t and not inside:
            start, inside = x, True
        elif not t and inside:
            runs.append((start, x)); inside = False
    if inside:
        runs.append((start, W))
    # 取最长且不在图像边缘的区间 = 屏幕洞
    inner = [r for r in runs if r[0] > 2 and r[1] < W - 2]
    return max(inner, key=lambda r: r[1] - r[0]) if inner else None

def span_holes_col(col):
    runs, inside, start = [], False, 0
    for y in range(H):
        t = a[col, y] < OPAQUE
        if t and not inside:
            start, inside = y, True
        elif not t and inside:
            runs.append((start, y)); inside = False
    if inside:
        runs.append((start, H))
    inner = [r for r in runs if r[0] > 2 and r[1] < H - 2]
    return max(inner, key=lambda r: r[1] - r[0]) if inner else None

# 横向扫 30% 高度的行（避开左侧中央的刘海），纵向扫 50% 宽度的列
hx = span_holes(round(H * 0.30))
vy = span_holes_col(round(W * 0.50))
x0, x1 = hx
y0, y1 = vy
print(f'final image: {W}x{H}  ratio {W/H:.4f}')
print(f'screen hole px: x {x0}..{x1}  y {y0}..{y1}  ({x1-x0}x{y1-y0})')
print(f'screen inset %: top {y0/H*100:.2f}  bottom {(H-y1)/H*100:.2f}  left {x0/W*100:.2f}  right {(W-x1)/W*100:.2f}')

# 圆角：洞最顶行的水平内缩 ~ 半径
top_span = span_holes(y0 + 1)
r = (top_span[0] - x0) if top_span else 0
print(f'corner radius ~{r}px = {r/(x1-x0)*100:.1f}% of hole width')

import os
print('file size:', os.path.getsize(DST) // 1024, 'KB')

#!/usr/bin/env python3
"""生成「考研阅读助手」印章风格应用图标（纯 PIL，无第三方依赖）。

设计：朱砂红 #c0392b 圆角方形底 + 内圈细白边框（仿印石边栏）
      + 中央白色楷体大字「阅」，辅以极淡的印泥颗粒纹理，古朴醒目。

产物：
  build/icon.png                  512x512 全尺寸
  build/icon.ico                  多尺寸 ICO（16/24/32/48/64/128/256）
  build/android/mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher.png
                                  48/72/96/144/192
  build/android/adaptive_foreground.png   432x432（图案居中央 66% 安全区）
  build/android/adaptive_background.png   432x432 纯色 #c0392b
"""
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFont

SEAL_RED = (192, 57, 43, 255)      # #c0392b
SEAL_RED_DARK = (146, 36, 26, 255)  # 外沿压深，增强印面层次
WHITE = (255, 255, 255, 255)

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\simkai.ttf",   # 楷体
    r"C:\Windows\Fonts\msyhbd.ttc",   # 微软雅黑粗体（备选）
]

# 画布参数（按比例）
MARGIN_R = 0.055      # 外底边距
RADIUS_R = 0.172      # 圆角半径
INNER_R = 0.105       # 内圈细边框边距
BORDER_W_R = 0.012    # 内圈细边框线宽
FONT_R = 0.60         # 「阅」字号占画布比例

# adaptive 前景：图案画布内实际印章边长（432 * 0.66 ≈ 285，取 284 保证在安全区内）
ADAPTIVE_FOREGROUND = 432
ADAPTIVE_SEAL = 284


def load_font(size):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    raise RuntimeError("未找到可用中文字体: " + ", ".join(FONT_CANDIDATES))


def draw_seal(size):
    """绘制 512 尺寸模板的印章，返回 RGBA 图像。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    m = int(size * MARGIN_R)
    r = int(size * RADIUS_R)
    box = [m, m, size - m, size - m]

    # 外底（朱砂红圆角方形）
    d.rounded_rectangle(box, radius=r, fill=SEAL_RED)
    # 外沿压深一圈，仿印面边缘
    bw = max(2, int(size * 0.006))
    d.rounded_rectangle(box, radius=r, outline=SEAL_RED_DARK, width=bw)

    # 印泥颗粒纹理（极淡，避免影响可读性）
    rnd = random.Random(20260808)
    n_dots = max(800, size * size // 90)
    x0, y0, x1, y1 = m, m, size - m, size - m
    for _ in range(n_dots):
        x = rnd.randint(x0 + 2, x1 - 2)
        y = rnd.randint(y0 + 2, y1 - 2)
        if not _inside_rounded(x, y, x0, y0, x1, y1, r):
            continue
        shade = rnd.choice([(255, 255, 255), (160, 40, 30)])
        d.point((x, y), fill=shade + (rnd.randint(6, 14),))

    # 内圈细白边框（仿印石边栏）
    im = int(size * INNER_R)
    ir = max(6, r - (im - m))
    iw = max(2, int(size * BORDER_W_R))
    d.rounded_rectangle([im, im, size - im, size - im], radius=ir,
                        outline=WHITE, width=iw)

    # 中央白色楷体大字「阅」（按字形 ink bbox 居中，避免偏斜）
    font = load_font(int(size * FONT_R))
    bbox = d.textbbox((0, 0), "阅", font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = (size - tw) / 2 - bbox[0]
    ty = (size - th) / 2 - bbox[1]
    d.text((tx, ty), "阅", font=font, fill=WHITE)

    return img


def _inside_rounded(x, y, x0, y0, x1, y1, radius):
    """判断点是否落在圆角矩形内部（四角按圆弧判定）。"""
    if x0 + radius <= x <= x1 - radius or y0 + radius <= y <= y1 - radius:
        return True
    # 落在某圆角区域内时，取最近的角心做距离判断
    cx = x0 + radius if x < x0 + radius else x1 - radius
    cy = y0 + radius if y < y0 + radius else y1 - radius
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2


def paste_centered(canvas_size, seal_size):
    """在透明画布中央放置缩小后的印章（用于 adaptive foreground）。"""
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    seal = draw_seal(seal_size)
    ox = (canvas_size - seal_size) // 2
    oy = (canvas_size - seal_size) // 2
    canvas.paste(seal, (ox, oy), seal)
    return canvas


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    build = os.path.join(root, "build")
    android = os.path.join(build, "android")
    os.makedirs(build, exist_ok=True)
    os.makedirs(android, exist_ok=True)

    # 1) icon.png 512
    icon512 = draw_seal(512)
    png_path = os.path.join(build, "icon.png")
    icon512.save(png_path)
    print("OK", png_path, icon512.size)

    # 2) icon.ico 多尺寸（PNG 压缩条目，Windows 现代资源标准）
    ico_path = os.path.join(build, "icon.ico")
    icon256 = draw_seal(256)
    icon256.save(ico_path, format="ICO",
                 sizes=[(16, 16), (24, 24), (32, 32), (48, 48),
                        (64, 64), (128, 128), (256, 256)])
    print("OK", ico_path)

    # 3) Android mipmap
    mipmaps = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }
    for folder, px in mipmaps.items():
        d = os.path.join(android, folder)
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, "ic_launcher.png")
        draw_seal(px).save(p)
        print("OK", p, px)

    # 4) adaptive foreground / background
    fg_path = os.path.join(android, "adaptive_foreground.png")
    paste_centered(ADAPTIVE_FOREGROUND, ADAPTIVE_SEAL).save(fg_path)
    print("OK", fg_path, ADAPTIVE_FOREGROUND)

    bg = Image.new("RGBA", (ADAPTIVE_FOREGROUND, ADAPTIVE_FOREGROUND),
                   SEAL_RED)
    bg_path = os.path.join(android, "adaptive_background.png")
    bg.save(bg_path)
    print("OK", bg_path, ADAPTIVE_FOREGROUND)

    print("DONE")


if __name__ == "__main__":
    sys.exit(main())

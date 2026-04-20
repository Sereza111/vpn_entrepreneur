"""One-off: white paper -> alpha, black ink -> white strokes (RGBA)."""
from __future__ import annotations

from pathlib import Path

from PIL import Image


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    path = root / "public" / "branding" / "vl-mark.png"
    im = Image.open(path).convert("RGBA")
    px = im.load()
    w, h = im.size
    # Чуть ниже 255 — съедаем JPEG-шум и антиалиас у белого поля
    hi = 236
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            if r >= hi and g >= hi and b >= hi:
                px[x, y] = (255, 255, 255, 0)
                continue
            # Линии и серый антиалиас → белый с альфой
            lum = (r + g + b) / 3.0
            alpha = int(min(255, max(24, 255 - lum * 1.15)))
            px[x, y] = (255, 255, 255, alpha)
    im.save(path, optimize=True)


if __name__ == "__main__":
    main()

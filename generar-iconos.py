#!/usr/bin/env python3
"""
generar-iconos.py — Genera los íconos PNG de las dos apps instalables.

  Bitácora de Viaje  -> amber + libro abierto
  Panel de Viaje     -> slate + valija

Salida (en icons/):
  bitacora-192.png, bitacora-512.png, bitacora-maskable-512.png, bitacora-apple-180.png
  panel-192.png,    panel-512.png,    panel-maskable-512.png,    panel-apple-180.png

Por qué PNG y no SVG data-URI: Chrome/Android exige íconos reales de 192 y 512 px
para ofrecer "Instalar app". Los data-URI del manifest viejo no alcanzan.
Los "maskable" van a sangre (el sistema recorta la forma) con el símbolo dentro
de la zona segura del 80%.
"""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons")
os.makedirs(OUT, exist_ok=True)

AMBER_TOP, AMBER_BOT = (180, 83, 9), (245, 158, 11)      # amber-700 -> amber-500
SLATE_TOP, SLATE_BOT = (15, 23, 42), (51, 65, 85)        # slate-900 -> slate-700
ICE = (255, 255, 255)
EMERALD = (16, 185, 129)


def fondo(size, top, bot):
    """Degradado vertical."""
    img = Image.new("RGB", (1, size))
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / max(1, size - 1)
        d.point((0, y), fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
    return img.resize((size, size), Image.NEAREST)


def radio(size, pct):
    return int(size * pct)


def esquinas_redondeadas(img, radius):
    """Aplica máscara de esquinas redondeadas (fondo transparente fuera)."""
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.size[0] - 1, img.size[1] - 1],
                                           radius=radius, fill=255)
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.paste(img.convert("RGBA"), (0, 0), mask)
    return out


def libro(d, s, cx, cy, w, color=ICE, renglon=(146, 64, 14, 170)):
    """Libro abierto de frente: dos páginas simétricas + lomo + renglones."""
    mitad = w / 2
    alto = w * 0.66
    lomo = w * 0.05
    top = cy - alto * 0.46
    bot = cy + alto * 0.5

    # páginas: borde inferior recto, borde superior inclinado hacia el lomo
    izq = [(cx - mitad, top + alto * 0.15), (cx - lomo, top), (cx - lomo, bot), (cx - mitad, bot)]
    der = [(cx + lomo, top), (cx + mitad, top + alto * 0.15), (cx + mitad, bot), (cx + lomo, bot)]
    d.polygon(izq, fill=color)
    d.polygon(der, fill=color)

    # lomo entre las dos páginas
    d.rectangle([cx - lomo, top, cx + lomo, bot], fill=color)

    # renglones de texto (color del fondo, semitransparente)
    grosor = max(2, int(w * 0.026))
    for i in range(3):
        y = top + alto * (0.40 + i * 0.19)
        ancho = (mitad - lomo) * (0.88 if i < 2 else 0.6)
        d.line([(cx - lomo - ancho * 0.92, y), (cx - lomo - ancho * 0.08, y)], fill=renglon, width=grosor)
        d.line([(cx + lomo + ancho * 0.08, y), (cx + lomo + ancho * 0.92, y)], fill=renglon, width=grosor)


def valija(d, s, cx, cy, w, color=ICE, detalle=EMERALD):
    """Valija: manija + cuerpo redondeado + franja + broche."""
    alto = w * 0.78
    top = cy - alto * 0.42
    bot = top + alto

    # manija
    mw = w * 0.34
    d.rounded_rectangle([cx - mw / 2, top - alto * 0.17, cx + mw / 2, top + alto * 0.06],
                        radius=w * 0.06, outline=color, width=max(3, int(w * 0.055)))

    # cuerpo
    d.rounded_rectangle([cx - w / 2, top, cx + w / 2, bot], radius=w * 0.13, fill=color)

    # franja horizontal
    d.rectangle([cx - w / 2, cy - alto * 0.05, cx + w / 2, cy + alto * 0.09], fill=detalle)

    # broche
    d.rounded_rectangle([cx - w * 0.09, cy - alto * 0.11, cx + w * 0.09, cy + alto * 0.15],
                        radius=w * 0.035, fill=detalle)


def build(nombre, size, top, bot, glyph, maskable=False, apple=False):
    img = fondo(size, top, bot).convert("RGBA")
    d = ImageDraw.Draw(img)
    # zona segura: maskable deja el símbolo más chico (recorte circular del sistema)
    escala = 0.50 if maskable else 0.60
    if apple:
        escala = 0.62
    w = size * escala
    cx = cy = size / 2
    if glyph == "libro":
        libro(d, size, cx, cy, w)
    else:
        valija(d, size, cx, cy, w)
    if not maskable:
        img = esquinas_redondeadas(img, radio(size, 0.18 if not apple else 0.0))
    destino = os.path.join(OUT, nombre)
    img.save(destino, "PNG", optimize=True)
    print(f"  {nombre:34s} {size}x{size}  {os.path.getsize(destino) // 1024} KB")


print("Bitácora de Viaje (amber + libro):")
build("bitacora-192.png", 192, AMBER_TOP, AMBER_BOT, "libro")
build("bitacora-512.png", 512, AMBER_TOP, AMBER_BOT, "libro")
build("bitacora-maskable-512.png", 512, AMBER_TOP, AMBER_BOT, "libro", maskable=True)
build("bitacora-apple-180.png", 180, AMBER_TOP, AMBER_BOT, "libro", apple=True)

print("Panel de Viaje (slate + valija):")
build("panel-192.png", 192, SLATE_TOP, SLATE_BOT, "valija")
build("panel-512.png", 512, SLATE_TOP, SLATE_BOT, "valija")
build("panel-maskable-512.png", 512, SLATE_TOP, SLATE_BOT, "valija", maskable=True)
build("panel-apple-180.png", 180, SLATE_TOP, SLATE_BOT, "valija", apple=True)
print("\nListo -> icons/")

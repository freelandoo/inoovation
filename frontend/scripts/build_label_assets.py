"""
Gera os derivados web do rótulo Innovation Week a partir do pacote de origem.

Origem (NÃO é modificada): ../rotulo/
  01.png         arte final colorida (RGB, já recortada na faca)
  02.png..07.png separações de acabamento (RGBA: pixel opaco = área com acabamento)
Saídas:
  public/innovation-week/label/base/   arte base (WebP 2048/1024 + AVIF/JPG para o fallback DOM)
  public/innovation-week/label/masks/  máscaras em escala de cinza (branco = efeito ativo)
  assets-src/innovation-week/label/    cópia dos PNGs usados + debug/registration.jpg (fora do Git)

Registro: todos os arquivos têm o mesmo tamanho (1920x714) e já vêm recortados na
faca, então UV 0..1 = faca de corte em todas as camadas sem recorte adicional.
Ajustes finos de alinhamento ficam em src/label/labelConfig.ts, não aqui.

Uso: python scripts/build_label_assets.py
"""
from pathlib import Path
import shutil
import subprocess
import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT.parent / "rotulo"  # pacote-fonte (fora do Git)
PUB = ROOT / "public" / "innovation-week" / "label"
KEEP = ROOT / "assets-src" / "innovation-week" / "label"

BASE = SRC / "01.png"
# arquivo de separação -> acabamento (identificado pela forma de cada camada)
MASKS = {
    "underprint": "02.png",  # calço branco: logos, textos, astronauta, QR
    "relief": "03.png",  # verniz relevo: molduras das janelas, console, placas da armadura
    "holographic": "04.png",  # casting holográfico: céu, planeta e solo da janela central
    "luminescent": "05.png",  # verniz luminescente: padrão INNOVATION WAY nas laterais
    "photoluminescent": "06.png",  # verniz fotoluminescente: logos, armadura, brilho do planeta
    "texture": "07.png",  # verniz textura: estrutura metálica da nave
}
MASK_W = 1024


def inpaint(img: np.ndarray, hole: np.ndarray, iters: int = 60) -> np.ndarray:
    """Preenche pixels marcados com a média dos vizinhos válidos (difusão simples)."""
    img = img.astype(np.float32).copy()
    known = ~hole
    img[hole] = 0
    for _ in range(iters):
        if known.all():
            break
        acc = np.zeros_like(img)
        cnt = np.zeros(hole.shape, np.float32)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, 1), (-1, 1), (1, -1)):
            k = np.roll(known, (dy, dx), (0, 1))
            v = np.roll(img, (dy, dx), (0, 1))
            acc += v * k[..., None]
            cnt += k
        fill = (~known) & (cnt > 0)
        img[fill] = acc[fill] / cnt[fill][:, None]
        known = known | fill
    return img


def corner_hole(rgb: np.ndarray, size: int = 48) -> np.ndarray:
    """Cantos arredondados brancos fora da faca (a geometria 3D já arredonda os cantos)."""
    h, w = rgb.shape[:2]
    white = rgb.min(-1) > 225
    hole = np.zeros((h, w), bool)
    for ys, xs in ((slice(0, size), slice(0, size)), (slice(0, size), slice(w - size, w)),
                   (slice(h - size, h), slice(0, size)), (slice(h - size, h), slice(w - size, w))):
        hole[ys, xs] = white[ys, xs]
    # borda de 1-2 px clara em volta do rótulo
    edge = np.zeros_like(hole)
    edge[:2], edge[-2:], edge[:, :2], edge[:, -2:] = True, True, True, True
    return hole | (edge & (rgb.min(-1) > 150))


def save_webp(im: Image.Image, path: Path, quality=90, lossless=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "WEBP", quality=quality, lossless=lossless, method=6)
    print(f"  {path.relative_to(ROOT)}  {im.size[0]}x{im.size[1]}  {path.stat().st_size // 1024} KB")


def main():
    assert SRC.exists(), f"pacote de origem não encontrado: {SRC}"
    for d in ("base", "masks"):
        (PUB / d).mkdir(parents=True, exist_ok=True)
    KEEP.mkdir(parents=True, exist_ok=True)

    # ---------- base ----------
    rgb = np.array(Image.open(BASE).convert("RGB"))
    H, W = rgb.shape[:2]
    print(f"base: {W}x{H} -> proporção {W / H:.3f}")
    clean = inpaint(rgb, corner_hole(rgb)).clip(0, 255).astype(np.uint8)
    crop = Image.fromarray(clean)

    base_sizes = {}
    for w in (2048, 1024):
        h = round(w * H / W)
        im = crop.resize((w, h), Image.LANCZOS)
        if w == 2048:
            im = im.filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2))
        save_webp(im, PUB / "base" / f"label-{w}.webp", quality=90)
        base_sizes[w] = im
    # AVIF + JPEG para o fallback HTML (sem WebGL)
    jpg = PUB / "base" / "label-2048.jpg"
    base_sizes[2048].save(jpg, "JPEG", quality=88, optimize=True, progressive=True)
    avif = PUB / "base" / "label-2048.avif"
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(jpg), "-c:v", "libaom-av1", "-still-picture", "1",
             "-crf", "28", "-pix_fmt", "yuv444p", str(avif)],
            check=True,
        )
        print(f"  {avif.relative_to(ROOT)}  {avif.stat().st_size // 1024} KB")
    except Exception as e:  # noqa: BLE001
        print("  AVIF não gerado:", e)
    shutil.copy2(BASE, KEEP / BASE.name)

    # ---------- máscaras ----------
    mask_h = round(MASK_W * H / W)
    overlay_rows = []
    for key, name in MASKS.items():
        src = SRC / name
        im = Image.open(src).convert("RGBA")
        assert im.size == (W, H), f"{name}: {im.size} difere da arte base {(W, H)}"
        alpha = np.array(im)[..., 3]
        m = Image.fromarray(alpha).resize((MASK_W, mask_h), Image.LANCZOS)
        save_webp(m.convert("RGB"), PUB / "masks" / f"{key}.webp", quality=92)
        if key == "relief":
            hgt = m.filter(ImageFilter.GaussianBlur(2.2))
            save_webp(hgt.convert("RGB"), PUB / "masks" / "relief-height.webp", quality=92)
        shutil.copy2(src, KEEP / name)
        a = np.array(m).astype(np.float32) / 255
        cols = a.mean(0)
        cum = np.cumsum(cols) / max(cols.sum(), 1e-6)
        print(f"{key} ({name}): cobertura {a.mean() * 100:.1f}%, "
              f"massa em x: 10% {np.searchsorted(cum, 0.1) / MASK_W:.2f} / 50% {np.searchsorted(cum, 0.5) / MASK_W:.2f}")

        # debug: arte base escurecida + máscara em vermelho
        b = np.array(base_sizes[1024].resize((MASK_W, mask_h))).astype(np.float32) * 0.45
        dbg = b * (1 - a[..., None]) + np.array([255, 30, 30]) * a[..., None]
        overlay_rows.append(dbg.clip(0, 255).astype(np.uint8))

    sheet = Image.fromarray(np.vstack(overlay_rows))
    dbg = KEEP / "debug" / "registration.jpg"
    dbg.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(dbg, quality=80)
    print("debug:", dbg.relative_to(ROOT))


if __name__ == "__main__":
    main()

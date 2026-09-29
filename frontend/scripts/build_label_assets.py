"""
Gera os derivados web do rótulo Innovation Week a partir do pacote de origem.

Origem (NÃO é modificada): ../innovation_week_rotulo_png/
Saídas:
  web/assets-src/innovation-week/label/   cópia dos PNGs usados (fonte, não publicada)
  web/public/innovation-week/label/base/  arte base (WebP 2048/1024 + AVIF para fallback DOM)
  web/public/innovation-week/label/masks/ máscaras em escala de cinza (branco = efeito ativo)
  web/assets-src/innovation-week/label/debug/ sobreposições para conferir o registro

Registro: cada arquivo tem as linhas-guia ciano de corte. Recortamos todos pela
linha de corte EXTERNA, então UV 0..1 = faca de corte em todas as camadas.
As linhas-guia são removidas (não são impressas).
Ajustes finos de alinhamento ficam em src/label/labelConfig.ts, não aqui.

Uso: python scripts/build_label_assets.py
"""
from pathlib import Path
import shutil
import subprocess
import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT.parent / "innovation_week_rotulo_png"  # pacote-fonte (fora do Git)
PUB = ROOT / "public" / "innovation-week" / "label"
KEEP = ROOT / "assets-src" / "innovation-week" / "label"

BASE = SRC / "03_mascaras_web" / "rotulo_principal_colorido__web.png"
# polaridade escolhida: dark_active (preto na separação = área com acabamento)
MASKS = {
    "luminescent": "verniz_luminescente",
    "photoluminescent": "verniz_fotoluminescente",
    "holographic": "casting_holografico_bolha",
    "relief": "verniz_relevo",
    "texture": "verniz_textura",
    "underprint": "calco_branco",
}
POLARITY = "dark_active"


def cyan_mask(rgb: np.ndarray) -> np.ndarray:
    r, g, b = (rgb[..., i].astype(int) for i in range(3))
    return (g > 110) & (b > 110) & (r < g - 35) & (r < b - 35)


def cut_box(cyan: np.ndarray):
    """Retângulo da linha de corte externa (linhas ciano quase contínuas)."""
    h, w = cyan.shape
    rows = [y for y in range(h) if cyan[y].sum() > w * 0.4]
    cols = [x for x in range(w) if cyan[:, x].sum() > h * 0.4]
    return cols[0], rows[0], cols[-1], rows[-1]


def dilate(m: np.ndarray, n: int = 1) -> np.ndarray:
    out = m.copy()
    for _ in range(n):
        p = np.pad(out, 1)
        out = p[1:-1, 1:-1] | p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:]
    return out


def inpaint(img: np.ndarray, hole: np.ndarray, iters: int = 40) -> np.ndarray:
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
            if img.ndim == 3:
                acc += v * k[..., None]
            else:
                acc += v * k
            cnt += k
        fill = (~known) & (cnt > 0)
        if img.ndim == 3:
            img[fill] = acc[fill] / cnt[fill][:, None]
        else:
            img[fill] = acc[fill] / cnt[fill]
        known = known | fill
    return img


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
    cy = cyan_mask(rgb)
    x0, y0, x1, y1 = cut_box(cy)
    print(f"base: corte em ({x0},{y0})-({x1},{y1}) -> proporção {(x1 - x0) / (y1 - y0):.3f}")
    clean = inpaint(rgb, dilate(cy, 2)).clip(0, 255).astype(np.uint8)
    crop = Image.fromarray(clean).crop((x0, y0, x1 + 1, y1 + 1))
    # cantos: a borda interna do corte ainda pode ter resíduo claro; escurece 3px da moldura
    arr = np.array(crop)
    arr[:3], arr[-3:], arr[:, :3], arr[:, -3:] = 18, 18, 18, 18
    crop = Image.fromarray(arr)

    base_sizes = {}
    for w in (2048, 1024):
        h = round(w * crop.size[1] / crop.size[0])
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
    overlay_rows = []
    for key, name in MASKS.items():
        sep_path = SRC / "02_separacoes_tecnicas" / f"{name}.png"
        mask_path = SRC / "03_mascaras_web" / f"{name}__{POLARITY}.png"
        sep = np.array(Image.open(sep_path).convert("RGB"))
        cy = cyan_mask(sep)
        x0, y0, x1, y1 = cut_box(cy)
        alpha = np.array(Image.open(mask_path))[..., 3].astype(np.float32)  # dark_active: alfa = 255 - luminância
        alpha[dilate(cy, 2)] = 0  # linhas-guia não são acabamento
        m = Image.fromarray(alpha.clip(0, 255).astype(np.uint8)).crop((x0, y0, x1 + 1, y1 + 1))
        # remove moldura externa ao corte
        a = np.array(m)
        a[:4], a[-4:], a[:, :4], a[:, -4:] = 0, 0, 0, 0
        m = Image.fromarray(a)
        m = m.resize((1024, round(1024 * m.size[1] / m.size[0])), Image.LANCZOS)
        m = m.resize((1024, 376), Image.LANCZOS)  # mesma grade para todas
        save_webp(m.convert("RGB"), PUB / "masks" / f"{key}.webp", quality=92)
        if key == "relief":
            h = m.filter(ImageFilter.GaussianBlur(2.2))
            save_webp(h.convert("RGB"), PUB / "masks" / "relief-height.webp", quality=92)
        shutil.copy2(mask_path, KEEP / mask_path.name)
        shutil.copy2(sep_path, KEEP / sep_path.name)
        print(f"{key}: corte ({x0},{y0})-({x1},{y1}) proporção {(x1 - x0) / (y1 - y0):.3f}, cobertura {np.array(m).mean() / 2.55:.1f}%")

        # debug: arte base escurecida + máscara em vermelho
        b = np.array(base_sizes[1024].resize((1024, 376))).astype(np.float32) * 0.45
        mm = np.array(m).astype(np.float32)[..., None] / 255
        dbg = b * (1 - mm) + np.array([255, 30, 30]) * mm
        overlay_rows.append(dbg.clip(0, 255).astype(np.uint8))

    sheet = Image.fromarray(np.vstack(overlay_rows))
    dbg = KEEP / "debug" / "registration.jpg"
    dbg.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(dbg, quality=80)
    print("debug:", dbg.relative_to(ROOT))


if __name__ == "__main__":
    main()

"""Extract ISJ Sibiu school catchments from scanned PDFs → public/data/school-catchments.csv.

PDFs are image-only tables. Uses RapidOCR (pip install rapidocr-onnxruntime pymupdf pillow opencv-python-headless).
"""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path

import pymupdf
from PIL import Image
from rapidocr_onnxruntime import RapidOCR

REPO = Path(__file__).resolve().parents[1]
PDF_DIR = Path(r"G:\WORK STUFF\URBAN BIKE\Circumscriptii Sibiu 2026-2027")
OUT_CSV = REPO / "public" / "data" / "school-catchments.csv"
OSM_PATH = REPO / "public" / "osm-streets.geojson"
SCHOOLS_PATH = REPO / "public" / "schools.geojson"

FILENAME_SLUG = {
    1: "scoala_1",
    2: "scoala_2",
    3: "scoala_4",
    4: "scoala_8",
    5: "liceu_carol_1",
    6: "scoala_13",
    7: "scoala_18",
    8: "scoala_ioan_slavici",
    9: "scoala_21",
    10: "scoala_23",
    11: "scoala_25",
    12: "scoala_caragiale",
    13: "scoala_nicolae_iorga",
    14: "scoala_regina_maria",
    15: "scoala_regele_ferdinand",
    16: "scoala_radu_selejan",
    17: "liceu_octavian_goga",
    18: "liceu_andrei_saguna",
    19: "liceu_constantin_noica",
}

TYPE_CANON = {
    "strada": "Strada",
    "soseaua": "Șoseaua",
    "șoseaua": "Șoseaua",
    "bulevardul": "Bulevardul",
    "piata": "Piața",
    "piața": "Piața",
    "intrarea": "Intrarea",
    "pasajul": "Pasajul",
    "fundatura": "Fundătura",
    "fundătura": "Fundătura",
    "calea": "Calea",
    "aleea": "Aleea",
    "alee": "Aleea",
    "drumul": "Drumul",
    "prelungirea": "Prelungirea",
}

SKIP_TEXT = re.compile(
    r"^(id|id_gis|gis|tip|tipartera|nume|numeartera|descriere|artera)$",
    re.I,
)
HEADER_LINE = re.compile(
    r"(ministerul|tabel cuprinz|circumscripti|consiliul|inspectorscolar|emilian|nr\.\s*1837)",
    re.I,
)


def slugify(text: str) -> str:
    n = str(text or "").strip().lower()
    for a, b in {"ă": "a", "â": "a", "î": "i", "ș": "s", "ş": "s", "ț": "t", "ţ": "t"}.items():
        n = n.replace(a, b)
    return re.sub(r"[^a-z0-9]+", "_", n).strip("_")


def compact(text: str) -> str:
    return slugify(text).replace("_", "")


def normalize_street_name(name: str) -> str:
    s = str(name or "").strip()
    s = re.sub(
        r"^(strada|stradă|str\.?|bulevardul|bd\.?|calea|aleea|piața|piata|șoseaua|soseaua|sos\.?)\s+",
        "",
        s,
        flags=re.I,
    )
    return slugify(s)


def expand_abbrev(name: str) -> str:
    s = re.sub(r"\bG[\s\.\-]*RAL\b", "GENERAL", name, flags=re.I)
    s = re.sub(r"\bPROF[\s\.]*\b", "PROFESOR ", s, flags=re.I)
    return re.sub(r"\s+", " ", s).strip()


def load_osm_index() -> tuple[dict[str, str], dict[str, str]]:
    data = json.loads(OSM_PATH.read_text(encoding="utf-8"))
    by_key: dict[str, str] = {}
    by_compact: dict[str, str] = {}
    for f in data.get("features") or []:
        n = str((f.get("properties") or {}).get("name") or "").strip()
        if not n:
            continue
        k = normalize_street_name(n)
        c = compact(k)
        if k and k not in by_key:
            by_key[k] = n
        if c and c not in by_compact:
            by_compact[c] = n
    return by_key, by_compact


def osm_bare(osm_name: str) -> str:
    return re.sub(
        r"^(strada|stradă|str\.?|bulevardul|bd\.?|calea|aleea|piața|piata|șoseaua|soseaua|intrarea|pasajul|fundătura|fundatura)\s+",
        "",
        osm_name,
        flags=re.I,
    )


def format_street(street_type: str, raw_name: str, by_key: dict[str, str], by_compact: dict[str, str]) -> str:
    name = expand_abbrev(re.sub(r"\s+", " ", raw_name).strip())
    name = re.sub(r"^[\|\[]+|[\]\|]+$", "", name).strip()
    if not name:
        return ""
    # Insert spaces using OSM when OCR glued words (AVRAMIANCU → Avram Iancu).
    k = normalize_street_name(f"{street_type} {name}")
    k_bare = normalize_street_name(name)
    osm_name = by_key.get(k) or by_key.get(k_bare) or by_compact.get(compact(k)) or by_compact.get(compact(k_bare))
    if osm_name:
        return f"{street_type} {osm_bare(osm_name)}".strip()
    # Title-case leftover ALLCAPS tokens
    pretty = " ".join(w.capitalize() if w.isupper() else w for w in name.split())
    return f"{street_type} {pretty}".strip()


def load_denumiri() -> dict[str, str]:
    data = json.loads(SCHOOLS_PATH.read_text(encoding="utf-8"))
    out: dict[str, str] = {}
    for f in data.get("features") or []:
        p = f.get("properties") or {}
        slug = str(p.get("slug") or "").strip()
        den = str(p.get("denumire") or "").strip()
        if slug:
            out[slug] = den
    return out


def school_from_filename(pdf: Path) -> tuple[int, str]:
    m = re.match(r"^(\d+)_", pdf.name)
    n = int(m.group(1)) if m else 0
    return n, FILENAME_SLUG.get(n, "")


def center(box) -> tuple[float, float]:
    xs = [p[0] for p in box]
    ys = [p[1] for p in box]
    return sum(xs) / 4, sum(ys) / 4


def cluster_rows(items: list[tuple[float, float, str]], y_tol: float) -> list[list[tuple[float, float, str]]]:
    items = sorted(items, key=lambda t: t[1])
    rows: list[list[tuple[float, float, str]]] = []
    for it in items:
        if rows and abs(it[1] - rows[-1][0][1]) <= y_tol:
            rows[-1].append(it)
        else:
            rows.append([it])
    return rows


def snap_type(text: str) -> str | None:
    t = slugify(text)
    t = t.replace("tipartera", "").replace("artera", "")
    if t in TYPE_CANON:
        return TYPE_CANON[t]
    # glued "GISTIPARTERA" already skipped; "soseaua" variants
    for k, v in TYPE_CANON.items():
        if t == k or t.endswith(k) and len(t) - len(k) <= 3:
            return v
    return None


def parse_ocr_rows(result) -> tuple[str, list[tuple[str, str, str]]]:
    if not result:
        return "", []
    items = []
    school_hint = ""
    for box, text, score in result:
        text = str(text or "").strip()
        if not text or score < 0.55:
            continue
        cx, cy = center(box)
        if re.search(r"(Scoala|Școala|Liceul|Colegiul|Gimnazial)", text, re.I):
            school_hint = re.sub(r"\s*[-–].*Circumscrip.*$", "", text, flags=re.I).strip()
        items.append((cx, cy, text))

    if not items:
        return school_hint, []

    ys = [cy for _, cy, _ in items]
    y_span = max(ys) - min(ys) or 1
    y_tol = max(18.0, y_span * 0.018)

    rows = cluster_rows(items, y_tol)
    parsed: list[tuple[str, str, str]] = []
    seen_table = False

    for row in rows:
        row = sorted(row, key=lambda t: t[0])
        texts = [t[2] for t in row]
        joined = " ".join(texts)
        if HEADER_LINE.search(joined) or SKIP_TEXT.match(slugify(joined)):
            if re.search(r"nume\s*artera|tip\s*artera", joined, re.I) or "NUMEARTERA" in joined.replace(" ", "").upper():
                seen_table = True
            continue

        # Find street type token
        type_i = None
        stype = None
        for i, (cx, cy, text) in enumerate(row):
            st = snap_type(text)
            if st:
                type_i = i
                stype = st
                break
        if stype is None:
            continue

        right = row[type_i + 1 :]
        if not right:
            continue
        # Name is the first token to the right of type; description is further right (larger x gap / longer text)
        name_tok = right[0][2]
        desc_parts = []
        name_x = right[0][0]
        for cx, cy, text in right[1:]:
            if cx - name_x > 280 or len(text) > 18:
                desc_parts.append(text)
            else:
                # continuation of name (split tokens)
                name_tok += " " + text
        name_tok = re.sub(r"(?<=[A-Z])(?=[A-Z][a-z])", " ", name_tok)
        name_tok = name_tok.replace("G-RAL", "GENERAL").replace("GRAL", "GENERAL")
        if SKIP_TEXT.match(slugify(name_tok)):
            continue
        letters = re.sub(r"[^A-Za-zĂÂÎȘȚăâîșț]", "", name_tok)
        if len(letters) < 4 and not re.search(r"\d", name_tok):
            continue
        parsed.append((stype, name_tok, " ".join(desc_parts)))
        seen_table = True

    return school_hint, parsed


def page_image(pdf: Path, page_i: int, dest: Path) -> None:
    doc = pymupdf.open(pdf)
    page = doc[page_i]
    imgs = page.get_images(full=True)
    if imgs:
        pix = pymupdf.Pixmap(doc, imgs[0][0])
        if pix.n > 4:
            pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
        pix.save(str(dest))
    else:
        page.get_pixmap(dpi=300).save(str(dest))
    doc.close()
    im = Image.open(dest)
    if im.size[1] > im.size[0] * 1.05:
        im.rotate(90, expand=True).save(dest)


def main() -> None:
    ocr = RapidOCR()
    by_key, by_compact = load_osm_index()
    denumiri = load_denumiri()
    pdfs = sorted(PDF_DIR.glob("*.pdf"), key=lambda p: school_from_filename(p)[0])
    print(f"PDFs: {len(pdfs)}  OSM names: {len(by_key)}")

    tmp = REPO / "_tmp_pdf_extract" / "rapid"
    tmp.mkdir(parents=True, exist_ok=True)
    rows_out: list[dict[str, str]] = []

    for pdf in pdfs:
        circ, slug = school_from_filename(pdf)
        official = denumiri.get(slug, "")
        print(f"\n=== {pdf.name} → {slug} ===")
        doc = pymupdf.open(pdf)
        n_pages = doc.page_count
        doc.close()
        for pi in range(n_pages):
            dest = tmp / f"{circ}_p{pi + 1}.png"
            page_image(pdf, pi, dest)
            result, _ = ocr(str(dest))
            hint, parsed = parse_ocr_rows(result)
            print(f"  page {pi + 1}: {len(parsed)} streets")
            school_name = official or hint or pdf.stem
            for stype, raw_name, desc in parsed:
                street = format_street(stype, raw_name, by_key, by_compact)
                if not street:
                    continue
                rows_out.append(
                    {
                        "school_slug": slug,
                        "school_name": school_name,
                        "street_name": street,
                        "description": desc,
                        "source_pdf": pdf.name,
                    }
                )

    # Drop exact duplicate rows (same school + street)
    uniq = []
    seen = set()
    for r in rows_out:
        k = (r["school_slug"], slugify(r["street_name"]))
        if k in seen:
            continue
        seen.add(k)
        uniq.append(r)

    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUT_CSV.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(
            f,
            fieldnames=["school_slug", "school_name", "street_name", "description", "source_pdf"],
        )
        w.writeheader()
        w.writerows(uniq)
    print(f"\nWrote {len(uniq)} unique rows ({len(rows_out)} raw) → {OUT_CSV}")


if __name__ == "__main__":
    main()

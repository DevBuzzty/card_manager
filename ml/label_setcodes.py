#!/usr/bin/env python
"""Label set_code and edition for every photo in the labelled eBay harvest corpus (Spec D2 Task 3).

This produces the ground-truth benchmark (`ml/ocr_bench/labels.csv`) that Task 6's OcrBench harness
will measure future OCR changes against -- so every label here has to be right, not just present.
The rule that carries the whole file (from the task-3 brief): a `set_code` label is written ONLY
on an exact match against one of the KNOWN printings of this exact passcode (rarity ignored -- see
`ml/data/catalog.v3.json.gz`'s `printings: [{"code", "rarity"}, ...]` per card, plus
`printings_verified` -- see `load_full_catalog()` for why both). We know the passcode, so we know
the candidate set; if OCR reads something that isn't one of this card's own printing codes, there
is no label. Fewer labels beat wrong ones -- a wrong label would silently corrupt every later
OCR-quality measurement built on this file.

We deliberately do NOT crop to the SET_CODE zone `ml/zones_measured.json` holds (that is Task 2's
output, and the very thing a later task benchmarks). Cropping to it here would make the ground
truth circular, and would silently drop photos where that zone is slightly off -- biasing the
benchmark toward cases that already work. Instead we OCR a generous band -- the bottom
`BOTTOM_FRAC` of the raw photo, no artwork detection involved at all -- and let the exact-match
rule above do the filtering. Broad read, strict match.

Reused from measure_zones.py (see its docstring for the corpus and the OCR-confusion background)
rather than duplicated: the lazily-initialised EasyOCR reader, `layout_for_type()` (so `layout`
here matches Task 2's own mapping), `SETCODE_RE`, and `find_passcode_span()` (used below to decide
"unlimited"). `load_catalog()` itself only returns `{id: type}`; this script also needs the
printings lists, so it reads the already-cached gzip directly -- same pattern
measure_zones_digital.py uses.

Edition marker lists are Spec D §7's, verbatim
(`docs/superpowers/specs/2026-09-05-spec-d-scan-flow-design.md`):
  first:   1st Edition, 1. Auflage, 1a Edicion, 1ere Edition, 1a Edizione, 1a Edicao
  limited: LIMITED EDITION, LIMITIERTE AUFLAGE, EDICION LIMITADA, EDITION LIMITEE
(accents stripped before matching, since OCR rarely gets them right). No marker, but the known
passcode was confidently read back on the photo -> "unlimited". Neither -> no label (empty cell).

Resumable: every row is appended to labels.csv and flushed immediately; a restart skips any `file`
already present in the CSV, so an interrupted multi-hour run picks back up instead of starting
over.

    python ml/label_setcodes.py --limit 20      # smoke test, 20 photos
    python ml/label_setcodes.py                 # full corpus (resumable)
"""
import argparse
import csv
import gzip
import json
import re
import time
import unicodedata
from pathlib import Path

import cv2

import measure_zones as MZ

ML_DIR = Path(__file__).resolve().parent
LABELED = ML_DIR / "data" / "harvest" / "labeled"
MANIFEST = LABELED / "labeled_manifest.json"
OUT_CSV = ML_DIR / "ocr_bench" / "labels.csv"

FIELDS = ["file", "passcode", "set_code", "edition", "layout", "source"]

BOTTOM_FRAC = 0.45   # keep this fraction of the photo's height, cut the rest off the top -- "a
                      # wide margin around the lower half of the card" per the task-3 brief,
                      # deliberately much bigger than the actual (Task 2) SET_CODE zone.

# Spec D §7 edition markers, normalised for matching (accents stripped, upper-cased, whitespace
# loosened for OCR noise) -- see this file's docstring for the source list. `_LEAD` tolerates the
# leading "1" getting OCR-garbled into a short digit/l/I run (observed on real photos: "1. Auflage"
# read back as "13 Auflage" -- the period misread as a second digit). Safe to loosen because the
# trailing word in each pattern (AUFLAGE, EDICION, ...) doesn't occur anywhere else on a card.
#
# AUFLAGE and EDITION get NO leading-"1st"/"1." requirement at all (unlike the Romance-language
# patterns below): on real photos that prefix is garbled unpredictably -- "13 Auflage", "K Auflage"
# (a PSA-slab photo), and "IS Edition" (the "1st" collapsed, T dropped entirely) were all observed,
# i.e. not just digit-confusion but characters vanishing or changing class outright. Both words are
# specific enough (only ever printed as "1. Auflage"/"Limitierte Auflage" or "1st Edition"/"Limited
# Edition") that matching them bare is still safe -- PROVIDED limited is checked first (see
# find_edition): otherwise a garbled "LIMITIERTE"/"LIMITED" would fall through and get mislabelled
# "first" instead of "limited" or no label.
#
# _AUFLAGE also tolerates the word ITSELF getting garbled, at exactly the two positions seen
# varying on real photos: the F ("AUflagE" read as "AUllagE", "AUtlagE" -- L and T both observed,
# apparently a font where F's crossbars blur into other tall letters) and the trailing E ("AUllagC").
# Wildcarded rather than an ever-growing enumerated class: those two positions are demonstrably
# unreliable, but "AU_LAG_" is still anchored by 5 literal letters -- as specific as the real word.
_LEAD = r"[\dIlL]{1,3}\.?\s*"
_AUFLAGE = r"AU.LAG."
FIRST_PATTERNS = [re.compile(p) for p in (
    r"EDITION",
    _AUFLAGE,
    _LEAD + r"A\s*EDICION",
    _LEAD + r"ERE\s*EDITION",
    _LEAD + r"A\s*EDIZIONE",
    _LEAD + r"A\s*EDICAO",
)]
LIMITED_PATTERNS = [re.compile(p) for p in (
    r"LIMITED\s*EDITION",
    r"LIMITIERTE\s*" + _AUFLAGE,
    r"EDICION\s*LIMITADA",
    r"EDITION\s*LIMITEE",
)]


def _strip_accents(text):
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))


def load_full_catalog():
    """id (int) -> {"type": str|None, "codes": {UPPERCASE printing code, ...}}. `layout_for_type()`
    only needs `type`; matching set_code needs the full printings list(s), which
    `MZ.load_catalog()` doesn't keep -- so read the (already-cached) gzip ourselves, same as
    measure_zones_digital.py does.

    Candidate codes are the UNION of `printings` and `printings_verified`, not `printings` alone.
    Measured on this corpus: `printings` is 100% EN-region codes (0 DE across the whole catalog),
    while the actual harvest is majority DE-language cards -- `harvest_ebay.py` defaults to
    `EBAY_MARKET=EBAY_DE` and half its queries are German ("... deutsch", "1. auflage ..."); a
    random 50-photo check found 34 with German card text against 7 with English. `printings_verified`
    is exactly the DE-verified-code list from Spec D1 (1,890/14,523 cards, matches
    memory/spec-d1-offline-catalog-status) -- without it, set_code yield on this corpus would be
    driven almost entirely by catalog-language gaps rather than OCR/photo quality, which is not
    the thing this benchmark is meant to measure. Still exact-match only, still rarity-ignored --
    this only widens which codes count as "known printings of this card", it does not loosen how
    a match is decided."""
    MZ.load_catalog()  # ensures MZ.CATALOG_CACHE exists on disk
    data = json.loads(gzip.decompress(MZ.CATALOG_CACHE.read_bytes()))
    out = {}
    for c in data["cards"]:
        codes = {p["code"].upper() for p in (c.get("printings") or []) if p.get("code")}
        codes |= {p["code"].upper() for p in (c.get("printings_verified") or []) if p.get("code")}
        out[int(c["id"])] = {"type": c.get("type"), "codes": codes}
    return out


def _code_match(window, candidate):
    """True if `window` (same length as `candidate`) equals it position-by-position, allowing
    `MZ.CONFUSE`'s OCR digit-confusion at any position ('O'/'0', 'I'/'1', 'S'/'5', 'B'/'8', ...).
    This is NOT the blanket confusion-correction find_set_code's docstring warns against: it never
    guesses a code out of thin air. It only checks whether a specific ALREADY-KNOWN candidate
    (one of this card's own printings) explains a garbled OCR read, so region letters ('DE', 'EN')
    can never be corrupted into a different candidate -- if a position doesn't match and isn't a
    known confusion of it, the whole candidate is rejected. Observed on real photos: "CT14-DE002"
    read back as "CT14-DEOO2" (both zeroes misread as the letter O)."""
    if len(window) != len(candidate):
        return False
    for a, b in zip(window, candidate):
        if a == b or MZ.CONFUSE.get(a) == b or MZ.CONFUSE.get(b) == a:
            continue
        return False
    return True


def find_set_code(ocr_results, candidates):
    """The rule that carries this whole file: an OCR-read span that equals -- exactly, modulo the
    digit-confusion tolerance in `_code_match()`, rarity ignored -- one of this card's own known
    printing codes. If nothing on the photo explains any candidate, there is no label: a near-miss
    against an unrelated string is never surfaced as a label, only a match against a code we
    already know this exact card can carry. Picks the highest-confidence match if several
    candidates match on the photo (rare)."""
    best_code, best_conf = None, -1.0
    for _box, text, conf in ocr_results:
        if conf <= best_conf:
            continue
        norm = re.sub(r"\s+", "", text.upper())
        for candidate in candidates:
            n = len(candidate)
            if any(_code_match(norm[i:i + n], candidate) for i in range(len(norm) - n + 1)):
                best_code, best_conf = candidate, conf
                break
    return best_code


def find_edition(ocr_results, passcode):
    """first / limited / unlimited / "" (no label) -- see this file's docstring for the rule.
    LIMITED is checked before FIRST: FIRST_PATTERNS' bare "AUFLAGE" would otherwise also fire on a
    "LIMITIERTE AUFLAGE" card (see FIRST_PATTERNS' comment)."""
    pooled = _strip_accents(" ".join(text for _box, text, _conf in ocr_results)).upper()
    if any(p.search(pooled) for p in LIMITED_PATTERNS):
        return "limited"
    if any(p.search(pooled) for p in FIRST_PATTERNS):
        return "first"
    if MZ.find_passcode_span(ocr_results, passcode):
        return "unlimited"
    return ""


def ocr_bottom_band(path):
    """Read text from the bottom BOTTOM_FRAC of the raw photo -- no artwork detection, no
    zones_measured.json involved. Returns EasyOCR's (box, text, conf) list, or None if the file
    won't load."""
    img = cv2.imread(str(path))
    if img is None:
        return None
    h, w = img.shape[:2]
    y0 = int((1 - BOTTOM_FRAC) * h)
    roi = img[y0:h, 0:w]
    if roi.size == 0:
        return None
    results = MZ.ocr_reader().readtext(roi)
    # shift ROI-local OCR boxes back into full-image coords (not strictly needed here since we
    # never draw evidence, but keeps this consistent with measure_zones.measure_one()).
    return [([[px, py + y0] for px, py in pts], text, conf) for pts, text, conf in results]


def already_done(csv_path):
    if not csv_path.exists():
        return set()
    with csv_path.open("r", encoding="utf-8", newline="") as f:
        return {row["file"] for row in csv.DictReader(f)}


def append_row(csv_path, row, write_header):
    with csv_path.open("a", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        if write_header:
            w.writeheader()
        w.writerow(row)
        f.flush()


def print_summary(csv_path):
    if not csv_path.exists():
        print("keine labels.csv vorhanden")
        return
    with csv_path.open("r", encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    by_layout = {}
    for r in rows:
        layout = r["layout"] or "(unbekannt)"
        d = by_layout.setdefault(layout, {"n": 0, "set_code": 0, "edition": 0})
        d["n"] += 1
        if r["set_code"]:
            d["set_code"] += 1
        if r["edition"]:
            d["edition"] += 1
    total_n = len(rows)
    total_sc = sum(1 for r in rows if r["set_code"])
    total_ed = sum(1 for r in rows if r["edition"])
    print(f"\n=== Ausbeute ueber {total_n} gelabelte Fotos (labels.csv gesamt) ===")
    print(f"set_code: {total_sc}/{total_n} ({100 * total_sc / max(total_n, 1):.1f}%)")
    print(f"edition:  {total_ed}/{total_n} ({100 * total_ed / max(total_n, 1):.1f}%)")
    print(f"{'layout':<12}{'n':>6}{'set_code':>12}{'edition':>12}")
    for layout, d in sorted(by_layout.items()):
        print(f"{layout:<12}{d['n']:>6}{d['set_code']:>12}{d['edition']:>12}")


def run(limit):
    catalog = load_full_catalog()
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    done = already_done(OUT_CSV)
    write_header = not OUT_CSV.exists() or OUT_CSV.stat().st_size == 0
    todo = [m for m in manifest if m["file"] not in done]
    if limit:
        todo = todo[:limit]
    print(f"Manifest: {len(manifest)} Fotos, {len(done)} bereits in labels.csv, "
          f"{len(todo)} zu tun{f' (--limit {limit})' if limit else ''}")

    t0 = time.time()
    for i, m in enumerate(todo, 1):
        rel, passcode = m["file"], m["passcode"]
        card = catalog.get(int(passcode))
        layout = MZ.layout_for_type(card["type"]) if card else None
        results = ocr_bottom_band(LABELED / rel)
        set_code, edition = "", ""
        if results is not None:
            if card and card["codes"]:
                set_code = find_set_code(results, card["codes"]) or ""
            edition = find_edition(results, passcode)
        row = {"file": rel, "passcode": passcode, "set_code": set_code, "edition": edition,
               "layout": layout or "", "source": "ebay"}
        append_row(OUT_CSV, row, write_header)
        write_header = False
        if i % 50 == 0 or i == len(todo):
            dt = time.time() - t0
            eta_min = (len(todo) - i) * dt / i / 60
            print(f"  {i}/{len(todo)}  ({dt / i:.2f}s/Foto, ETA {eta_min:.0f}min)")

    print_summary(OUT_CSV)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None, help="nur die ersten N (noch offenen) Fotos")
    args = ap.parse_args()
    run(args.limit)


if __name__ == "__main__":
    main()

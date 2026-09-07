#!/usr/bin/env python
"""Spec D2 Task 6 -- build, run and score the OCR-zone benchmark ("Messkorb").

This is the number Tasks 8 (per-zone preprocessing), 10 (multi-frame voting) and 11 (gate tuning)
measure themselves against. It deliberately does NOT export crops and push those -- it pushes whole
card IMAGES plus an explicit detector BOX per image, and lets the on-device instrumentation
(`OcrBench.kt`) run the REAL production crop (`CardZones.crop`, which runs `OcrPrep.enhance` --
exactly what Task 8 changes) and the real ML Kit recognizer. A benchmark fed Python-made crops would
be structurally blind to the thing it exists to measure. See `OcrBench.kt`'s docstring for the rest
of that reasoning.

Two corpora, scored separately (never merged -- eBay is straight/sharp/lit, the rig is
angled/small/glared, and a change that helps one and hurts the other is not an improvement):

  ebay  -- >=300 photos from the labelled harvest (`ml/ocr_bench/labels.csv`), stratified across
           layouts as evenly as the data allows. No box is known for these, so one is detected with
           `measure_zones.detect_box()` (reused, not reimplemented).
  rig   -- every photo in `ml/data/rig/raw/zonedump/` (the live analyzer's own frame dump, Task 1).
           The box is already in the filename; nothing to detect. `pcNONE` frames (embedder missed
           the card entirely -- foils, steep angles) carry no passcode ground truth and are excluded
           from the passcode hit-rate, but are counted and reported.

Stages (run in order, or individually while iterating):

    python ml/ocr_bench.py build   # sample + detect + stage manifest/images under ml/data/
    python ml/ocr_bench.py push    # adb push the staged corpus to the device
    python ml/ocr_bench.py run     # gradle connectedDebugAndroidTest, filtered to OcrBench
    python ml/ocr_bench.py pull    # adb pull results.json back
    python ml/ocr_bench.py score   # join results.json against ground truth, write the report
    python ml/ocr_bench.py all     # all five, in order (default)

`build` caches detection results (`ml/data/ocr_bench_work/detect_cache.json`) keyed by file path, so
a rerun (e.g. after tuning the sample size) does not re-run the ONNX detector on photos it already
tried. Ground truth stays local (`ml/data/ocr_bench_work/manifest_gt.json`) and is never pushed --
the device only gets what `OcrBench.kt` needs to produce a reading, not the answer key.
"""
import argparse
import csv
import gzip
import json
import random
import re
import shutil
import subprocess
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

ML_DIR = Path(__file__).resolve().parent
ANDROID_DIR = ML_DIR.parent / "android"
LABELS_CSV = ML_DIR / "ocr_bench" / "labels.csv"
HARVEST_LABELED = ML_DIR / "data" / "harvest" / "labeled"
RIG_DIR = ML_DIR / "data" / "rig" / "raw" / "zonedump"
CATALOG_CACHE = ML_DIR / "data" / "catalog.v3.json.gz"
BENCH_DIR = ML_DIR / "ocr_bench"
WORK_DIR = ML_DIR / "data" / "ocr_bench_work"          # staging, git-ignored (ml/data/ as a whole)
DETECT_CACHE_FILE = WORK_DIR / "detect_cache.json"

PACKAGE = "com.example.yugiohscanner"
DEVICE_BASE = f"/sdcard/Android/data/{PACKAGE}/files/ocr_bench"
TEST_CLASS = f"{PACKAGE}.ml.OcrBench"

LAYOUTS = ["STANDARD", "SPELL_TRAP", "LINK", "PENDULUM"]   # layouts CardLayout.kt actually measured
NON_FOIL_RARITIES = {"Common", "Rare", "Short Print"}       # best-effort foil/non-foil split, see load_rarity_index()

DEFAULT_TARGET = 320   # >= 300 required by the brief; a little headroom for detection failures


# ---------------------------------------------------------------------------------------------
# build: sample the eBay corpus, parse the rig corpus, detect boxes, stage manifest + images
# ---------------------------------------------------------------------------------------------

def load_rarity_index():
    """passcode(str) -> {SET_CODE(upper): rarity}, from the cached catalog -- used only to flag
    which sampled eBay rows are confirmed foils (best-effort: only possible where set_code is
    already labelled, ~1/4 of the corpus; the rest are neither confirmed foil nor confirmed not)."""
    if not CATALOG_CACHE.exists():
        print(f"WARNUNG: {CATALOG_CACHE} fehlt -- Foil-Markierung entfaellt (alles 'unknown').")
        return {}
    data = json.loads(gzip.decompress(CATALOG_CACHE.read_bytes()))
    idx = {}
    for c in data["cards"]:
        pc = str(int(c["id"]))
        m = idx.setdefault(pc, {})
        for p in (c.get("printings") or []) + (c.get("printings_verified") or []):
            code = p.get("code")
            if code:
                m[code.upper()] = p.get("rarity")
    return idx


def is_confirmed_foil(row, rarity_idx):
    sc = row["set_code"]
    if not sc:
        return None  # unknown, not "not a foil"
    rarity = rarity_idx.get(row["passcode"], {}).get(sc.upper())
    if rarity is None:
        return None
    return rarity not in NON_FOIL_RARITIES


def even_split_with_caps(target_total, avail):
    """Water-filling: split `target_total` as evenly as possible across `avail`'s keys, never
    exceeding a key's own availability. Used so eBay sampling is 'as even across layouts as the
    labels allow' rather than a flat n/4 that starves the big layouts and can't be met by the
    small ones (PENDULUM has a fraction of STANDARD's rows)."""
    quotas = {k: 0 for k in avail}
    remaining = target_total
    active = set(avail)
    while remaining > 0 and active:
        share = max(1, remaining // len(active))
        progressed = False
        for k in list(active):
            room = avail[k] - quotas[k]
            if room <= 0:
                active.discard(k)
                continue
            add = min(share, room, remaining)
            quotas[k] += add
            remaining -= add
            progressed = True
            if remaining <= 0:
                break
        if not progressed:
            break
    return quotas


def sample_ebay(rows, rarity_idx, target_total, seed):
    """Stratify across LAYOUTS as evenly as the data allows, prioritising rows with a labelled
    set_code within each layout (measured: ~90% of those happen to be confirmed foils -- see the
    report -- so this also satisfies 'include foils' without a separate foil-only pass). Detection
    is attempted in priority order per layout until that layout's quota is filled or its whole pool
    is exhausted; failures don't shrink other layouts' quotas.

    Returns (selected: list[(layout, row, box, score)], stats: dict, dropped_no_layout: int).
    """
    import cv2
    import measure_zones as MZ

    rng = random.Random(seed)
    by_layout = defaultdict(list)
    dropped_no_layout = 0
    for r in rows:
        if r["layout"] in LAYOUTS:
            by_layout[r["layout"]].append(r)
        else:
            dropped_no_layout += 1

    avail = {L: len(by_layout[L]) for L in LAYOUTS}
    quotas = even_split_with_caps(target_total, avail)

    cache = {}
    if DETECT_CACHE_FILE.exists():
        cache = json.loads(DETECT_CACHE_FILE.read_text())

    def detect(rel_path):
        if rel_path in cache:
            return cache[rel_path]
        img = cv2.imread(str(HARVEST_LABELED / rel_path))
        det = MZ.detect_box(img) if img is not None else None
        entry = None if det is None else [round(det[0]), round(det[1]), round(det[2]), round(det[3]), round(float(det[4]), 3)]
        cache[rel_path] = entry
        return entry

    selected = []
    stats = {}
    for L in LAYOUTS:
        pool = by_layout[L]
        with_code = [r for r in pool if r["set_code"]]
        without_code = [r for r in pool if not r["set_code"]]
        rng.shuffle(with_code)
        rng.shuffle(without_code)
        ordered = with_code + without_code   # set_code rows first -- also the foil-rich ones

        quota = quotas[L]
        taken, tried, failed = [], 0, 0
        for r in ordered:
            if len(taken) >= quota:
                break
            tried += 1
            det = detect(r["file"])
            if det is None:
                failed += 1
                continue
            taken.append((r, det[:4]))
        n_foil = sum(1 for r, _ in taken if is_confirmed_foil(r, rarity_idx))
        n_with_code = sum(1 for r, _ in taken if r["set_code"])
        stats[L] = {
            "available_in_labels": avail[L], "quota": quota, "tried": tried,
            "detect_failed": failed, "selected": len(taken),
            "with_set_code": n_with_code, "confirmed_foil": n_foil,
        }
        for r, box in taken:
            selected.append((L, r, box))

    DETECT_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    DETECT_CACHE_FILE.write_text(json.dumps(cache))
    return selected, stats, dropped_no_layout


RIG_RE = re.compile(r"^f(\d+)_pc(NONE|\d+)_([A-Z_]+)_box_(-?\d+)_(-?\d+)_(-?\d+)_(-?\d+)\.jpg$")


def parse_rig():
    """Every photo in ml/data/rig/raw/zonedump/, parsed straight from its filename (Task 1's
    live-analyzer frame dump -- see HybridPipeline.dumpFrame). Box and layout are already known, no
    detection needed. `pcNONE` (embedder missed -- foils, steep angles) carries no passcode ground
    truth; kept in the corpus (reported separately) rather than dropped, since the brief says to
    report how many there are, not to discard them."""
    items = []
    unparsed = 0
    for p in sorted(RIG_DIR.glob("*.jpg")):
        m = RIG_RE.match(p.name)
        if not m:
            unparsed += 1
            continue
        _frame, pc, layout, x1, y1, x2, y2 = m.groups()
        items.append({
            "path": p,
            "passcode": None if pc == "NONE" else pc,
            "layout": None if layout == "UNKNOWN" else layout,
            "layout_label": layout,   # keep UNKNOWN visible for reporting
            "box": [int(x1), int(y1), int(x2), int(y2)],
        })
    return items, unparsed


def build_manifest(target_total, seed):
    rows = list(csv.DictReader(LABELS_CSV.open("r", encoding="utf-8", newline="")))
    print(f"labels.csv: {len(rows)} Zeilen gelesen (Momentaufnahme -- ein Hintergrundjob haengt "
          f"weiterhin welche an).")

    rarity_idx = load_rarity_index()
    ebay_selected, ebay_stats, dropped_no_layout = sample_ebay(rows, rarity_idx, target_total, seed)
    rig_items, rig_unparsed = parse_rig()

    print("\n=== eBay-Stichprobe (geschichtet nach Layout) ===")
    total_selected = 0
    for L in LAYOUTS:
        s = ebay_stats[L]
        total_selected += s["selected"]
        shortfall = s["quota"] - s["selected"]
        note = f"  <- SHORTFALL {shortfall}" if shortfall > 0 else ""
        print(f"  {L:<12} quota={s['quota']:<4} selected={s['selected']:<4} "
              f"(available={s['available_in_labels']}, detect_failed={s['detect_failed']}, "
              f"with_set_code={s['with_set_code']}, confirmed_foil={s['confirmed_foil']}){note}")
    print(f"  TOTAL selected: {total_selected} (target {target_total})")
    if dropped_no_layout:
        print(f"  {dropped_no_layout} Zeilen ohne verwertbares layout uebersprungen")

    by_rig_layout = defaultdict(int)
    for it in rig_items:
        by_rig_layout[it["layout_label"]] += 1
    print(f"\n=== Rig-Korpus (alle Dateien, keine Stichprobe) ===")
    print(f"  {len(rig_items)} Dateien, {rig_unparsed} nicht parsebar")
    for layout_label, n in sorted(by_rig_layout.items()):
        print(f"  {layout_label:<12} n={n}")
    no_pc = sum(1 for it in rig_items if it["passcode"] is None)
    print(f"  ohne Passcode-Ground-Truth (Embedder verfehlt, pcNONE): {no_pc}/{len(rig_items)}")

    # Stage: manifest.json (pushed to device) + manifest_gt.json (kept local) + images/
    images_dir = WORK_DIR / "images"
    if images_dir.exists():
        shutil.rmtree(images_dir)
    images_dir.mkdir(parents=True)

    manifest_items = []
    gt = {}
    idx = 0
    for layout, row, box in ebay_selected:
        item_id = f"ebay_{idx:04d}"
        image_name = f"{item_id}.jpg"
        shutil.copy(HARVEST_LABELED / row["file"], images_dir / image_name)
        manifest_items.append({"id": item_id, "image": image_name, "box": box, "layout": layout})
        gt[item_id] = {
            "source": "ebay", "layout": layout,
            "gt_passcode": row["passcode"] or None,
            "gt_set_code": row["set_code"] or None,
            "gt_edition": row["edition"] or None,
            "confirmed_foil": is_confirmed_foil(row, rarity_idx),
            "file": row["file"],
        }
        idx += 1
    for it in rig_items:
        item_id = f"rig_{idx:04d}"
        image_name = f"{item_id}.jpg"
        shutil.copy(it["path"], images_dir / image_name)
        manifest_items.append({"id": item_id, "image": image_name, "box": it["box"], "layout": it["layout"]})
        gt[item_id] = {
            "source": "rig", "layout": it["layout_label"],
            "gt_passcode": it["passcode"], "gt_set_code": None, "gt_edition": None,
            "confirmed_foil": None, "file": it["path"].name,
        }
        idx += 1

    (WORK_DIR / "manifest.json").write_text(json.dumps({"items": manifest_items}, indent=2))
    (WORK_DIR / "manifest_gt.json").write_text(json.dumps({
        "built": date.today().isoformat(),
        "labels_csv_rows_used": len(rows),
        "target_total": target_total,
        "seed": seed,
        "ebay_stats": ebay_stats,
        "dropped_no_layout": dropped_no_layout,
        "rig_by_layout": dict(by_rig_layout),
        "rig_unparsed": rig_unparsed,
        "rig_no_passcode": no_pc,
        "gt": gt,
    }, indent=2))
    print(f"\nStaged {len(manifest_items)} images + manifest under {WORK_DIR}")


# ---------------------------------------------------------------------------------------------
# push / run / pull
# ---------------------------------------------------------------------------------------------

def adb(*args, check=True):
    proc = subprocess.run(["adb", *args], capture_output=True, text=True)
    if check and proc.returncode != 0:
        raise RuntimeError(f"adb {' '.join(args)} failed:\n{proc.stdout}\n{proc.stderr}")
    return proc


def push():
    manifest = WORK_DIR / "manifest.json"
    images_dir = WORK_DIR / "images"
    if not manifest.exists():
        sys.exit("kein manifest.json -- erst 'build' laufen lassen")
    n = len(list(images_dir.glob("*.jpg")))
    print(f"adb push: {n} Bilder + manifest.json -> {DEVICE_BASE}/in/")
    adb("shell", "rm", "-rf", f"{DEVICE_BASE}/in", f"{DEVICE_BASE}/out")
    adb("shell", "mkdir", "-p", f"{DEVICE_BASE}/in/images", f"{DEVICE_BASE}/out")
    adb("push", str(manifest), f"{DEVICE_BASE}/in/manifest.json")
    adb("push", str(images_dir) + "/.", f"{DEVICE_BASE}/in/images/")
    print("push done")


APP_ID = "com.example.yugiohscanner"
RUNNER = f"{APP_ID}.test/androidx.test.runner.AndroidJUnitRunner"


def run_instrumentation():
    """Drive the instrumentation with `am instrument` -- NOT with gradle connectedDebugAndroidTest.

    Gradle uninstalls both APKs around a connected test run, and Android deletes
    /sdcard/Android/data/<pkg>/ when a package is uninstalled. The staged corpus therefore cannot
    survive a gradle-driven run: measured here, the run ended with the app gone, the test APK gone
    and 0 of 445 images left on the device, and the test itself died on
    `FileNotFoundException ... /files/ocr_bench/in/manifest.json`. Pushing data into the app's own
    external directory and letting gradle manage the install are simply incompatible.

    So install both APKs once, push, and then instrument directly. Nothing uninstalls, the corpus
    stays put, and re-running costs one `am instrument` instead of a full gradle cycle.
    """
    apk = ANDROID_DIR / "app/build/outputs/apk/debug/app-debug.apk"
    test_apk = ANDROID_DIR / "app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
    for path in (apk, test_apk):
        if not path.exists():
            sys.exit(f"missing {path} -- build first:\n"
                     f"  cd android && ./gradlew assembleDebug assembleDebugAndroidTest")
    # -r keeps existing data; -t allows the test-only APK. A MIUI device refuses both with
    # INSTALL_FAILED_USER_RESTRICTED while the screen is locked -- unlock it and retry.
    for path in (apk, test_apk):
        proc = subprocess.run(["adb", "install", "-r", "-t", str(path)],
                              capture_output=True, text=True)
        if "Success" not in (proc.stdout or "") + (proc.stderr or ""):
            sys.exit(f"adb install failed for {path.name}:\n{proc.stdout}{proc.stderr}\n"
                     "If this is INSTALL_FAILED_USER_RESTRICTED: unlock the phone (and enable "
                     "Developer options -> Install via USB), then re-run.")
    print("both APKs installed")

    # Push AFTER installing, never before. Installing a package Android does not currently have
    # recreates /sdcard/Android/data/<pkg>/ from scratch, so a corpus pushed first is wiped by the
    # install -- measured: the push reported all 445 images landed, and the test still died on
    # `FileNotFoundException ... manifest.json`. Install, then push, then instrument.
    push()

    cmd = ["adb", "shell", "am", "instrument", "-w", "-e", "class", TEST_CLASS, RUNNER]
    print("running:", " ".join(cmd))
    proc = subprocess.run(cmd, capture_output=True, text=True)
    out = (proc.stdout or "") + (proc.stderr or "")
    print(out[-4000:])
    # `am instrument` exits 0 even when the test fails; the payload is in its own report.
    if "OK (" not in out or "FAILURES" in out or "Error" in out:
        sys.exit("instrumentation did not report OK -- see the output above.")


def pull():
    out_dir = BENCH_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = WORK_DIR / "results.json"
    adb("pull", f"{DEVICE_BASE}/out/results.json", str(dest))
    print(f"pulled -> {dest}")


# ---------------------------------------------------------------------------------------------
# score / report
# ---------------------------------------------------------------------------------------------

def _passcode_hit(result, gt_passcode):
    if gt_passcode is None:
        return None
    ep = result.get("extractedPasscode")
    if ep is None:
        return False
    try:
        return int(ep) == int(gt_passcode)
    except (TypeError, ValueError):
        return False


def _set_code_hit(result, gt_set_code):
    if not gt_set_code:
        return None
    codes = [c.upper() for c in (result.get("extractedSetCodes") or [])]
    return gt_set_code.upper() in codes


def score(gt_data, results):
    gt = gt_data["gt"]
    by_id = {r["id"]: r for r in results}

    # rows: (source, layout) -> {field -> [n, hits]}, plus skipped/error counters
    table = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    diag = defaultdict(lambda: {"n": 0, "skipped": 0, "error": 0})

    for item_id, g in gt.items():
        r = by_id.get(item_id)
        key = (g["source"], g["layout"] or "UNKNOWN")
        d = diag[key]
        d["n"] += 1
        if r is None:
            d["error"] += 1
            continue
        if r.get("error"):
            d["error"] += 1
        if r.get("skipped"):
            d["skipped"] += 1

        pc_hit = _passcode_hit(r, g["gt_passcode"])
        if pc_hit is not None:
            table[key]["passcode"][0] += 1
            table[key]["passcode"][1] += int(pc_hit)

        sc_hit = _set_code_hit(r, g["gt_set_code"])
        if sc_hit is not None:
            table[key]["set_code"][0] += 1
            table[key]["set_code"][1] += int(sc_hit)

    return table, diag


def write_report(gt_data, table, diag, out_path):
    lines = []
    lines.append(f"# OCR-Zonen-Messkorb -- Grundmessung ({date.today().isoformat()})\n")
    lines.append(
        "Baseline fuer Task 8 (Preprocessing je Zone), Task 10 (Mehrbild-Abstimmung) und Task 11 "
        "(Schwellenwerte). Gemessen wird die **heutige** Zonengeometrie (Task 7 ist bereits "
        "gemerged) -- nicht der Stand vor Task 7. Die historische Nulllinie davor ist bekannt: "
        "Task 1 fand 110 von 110 Band-Lesungen auf dem Geraet komplett leer (0 Treffer), bevor die "
        "gemessenen Zonen ueberhaupt existierten. Das ist der Ausgangspunkt, nicht diese Messung.\n"
    )
    lines.append(
        f"`labels.csv` hatte {gt_data['labels_csv_rows_used']} Zeilen, als dieser Lauf sie gelesen "
        "hat (ein Hintergrundjob haengt laufend weitere an -- das ist die Momentaufnahme dieses "
        "Laufs, nicht der Endstand der Datei).\n"
    )

    lines.append("## Stichprobe\n")
    lines.append("### eBay (geschichtet nach Layout)\n")
    lines.append("| layout | verfuegbar | Quote | ausgewaehlt | Detect fehlgeschlagen | mit set_code | bestaetigt Foil |")
    lines.append("|---|---:|---:|---:|---:|---:|---:|")
    for L in LAYOUTS:
        s = gt_data["ebay_stats"][L]
        lines.append(f"| {L} | {s['available_in_labels']} | {s['quota']} | {s['selected']} | "
                      f"{s['detect_failed']} | {s['with_set_code']} | {s['confirmed_foil']} |")
    total_selected = sum(gt_data["ebay_stats"][L]["selected"] for L in LAYOUTS)
    total_quota = sum(gt_data["ebay_stats"][L]["quota"] for L in LAYOUTS)
    shortfall_layouts = [L for L in LAYOUTS if gt_data["ebay_stats"][L]["selected"] < gt_data["ebay_stats"][L]["quota"]]
    lines.append(f"\nGesamt ausgewaehlt: {total_selected} (Ziel {total_quota}). "
                 + (f"Quote nicht erreicht bei: {', '.join(shortfall_layouts)} -- siehe Tabelle fuer "
                    "den Grund (Verfuegbarkeit in labels.csv oder Detektor-Fehlschlaege)."
                    if shortfall_layouts else "Quote in jedem Layout erreicht.") + "\n")
    if gt_data["dropped_no_layout"]:
        lines.append(f"{gt_data['dropped_no_layout']} labels.csv-Zeilen ohne verwertbares layout "
                     "uebersprungen (leeres Feld -- Typ beim Labeln nicht aufloesbar).\n")
    lines.append(
        "Foils wurden nicht separat gezogen: set_code-Zeilen wurden pro Layout bevorzugt "
        "ausgewaehlt (siehe `sample_ebay`), und von denen sind laut Katalog-Raritaet ~90% "
        "tatsaechlich Foils -- das deckt die 'mit Foils darin'-Vorgabe ab, ohne die Schichtung zu "
        "verzerren. Fuer die ubrigen Zeilen (kein gelabelter set_code) ist der Foil-Status nicht "
        "bestimmbar, nicht 'kein Foil' -- daher 'bestaetigt Foil' als Mindestzahl lesen.\n"
    )

    lines.append("### Rig (voller Korpus, keine Stichprobe)\n")
    lines.append("| layout | n |")
    lines.append("|---|---:|")
    for layout_label, n in sorted(gt_data["rig_by_layout"].items()):
        lines.append(f"| {layout_label} | {n} |")
    lines.append(f"\n{gt_data['rig_no_passcode']} Rig-Frames ohne Passcode-Ground-Truth "
                 "(`pcNONE` -- der Embedder hat die Karte verfehlt: Foils, steile Winkel). Diese "
                 "sind Teil des Korpus und oben mitgezaehlt, gehen aber in keine "
                 "Trefferquoten-Zelle unten ein, weil es nichts gibt, wogegen sie geprueft werden "
                 "koennten.\n")
    if gt_data["rig_unparsed"]:
        lines.append(f"{gt_data['rig_unparsed']} Rig-Dateien liessen sich nicht parsen und wurden "
                     "uebersprungen.\n")

    lines.append("## Trefferquoten je Feld x Layout x Quelle\n")
    lines.append("| Quelle | Layout | Feld | n (Ground Truth vorhanden) | Treffer | Trefferquote | uebersprungen (Box nicht artwork-foermig) |")
    lines.append("|---|---|---|---:|---:|---:|---:|")
    for (source, layout) in sorted(table.keys()):
        d = diag[(source, layout)]
        for field in ("passcode", "set_code"):
            n, hits = table[(source, layout)][field]
            if n == 0:
                continue
            rate = 100.0 * hits / n
            lines.append(f"| {source} | {layout} | {field} | {n} | {hits} | {rate:.1f}% | {d['skipped']}/{d['n']} |")
    lines.append("| alle | alle | edition | -- | -- | **nicht gemessen** | -- |")
    lines.append(
        "\n`edition` hat keine gemessene Zone: `Zone.EDITION` fehlt bewusst in jeder Map in "
        "`CardLayout.kt` (Task 2/3 haben nur PASSCODE und SET_CODE gemessen). Es gibt keinen "
        "Zonen-Crop, den dieser Messkorb dafuer OCRen koennte -- eine Ableitung aus der "
        "PASSCODE-Zone waere geraten, nicht gemessen, darum keine Zahl hier.\n"
    )

    lines.append("## Diagnose: uebersprungen / Fehler je Quelle x Layout\n")
    lines.append("| Quelle | Layout | n | uebersprungen (Box-Form) | Fehler |")
    lines.append("|---|---|---:|---:|---:|")
    for (source, layout), d in sorted(diag.items()):
        lines.append(f"| {source} | {layout} | {d['n']} | {d['skipped']} | {d['error']} |")

    lines.append(
        "\n## Was diese Messung NICHT abdeckt\n"
        "- Katalog-Gate auf der Passcode-Korrektur: `OcrBench.kt` ruft `OcrText.findPasscode` ohne "
        "Katalog-Anbindung auf (immer-true-Gate) -- der Messkorb braucht keine importierte "
        "catalog.db auf dem Geraet. Das misst OCR/Zonen-Qualitaet, nicht Katalog-Politik.\n"
        "- Detektorqualitaet: die Box kommt aus dem Manifest (Rig: aus dem Dateinamen; eBay: aus "
        "`measure_zones.detect_box()`), nicht aus dem On-Device-Detektor. Absichtlich -- das isoliert "
        "OCR/Zonen von der Detektion, die ein eigenes, bereits ausgeliefertes Thema ist.\n"
    )

    out_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {out_path}")


def do_score():
    gt_data = json.loads((WORK_DIR / "manifest_gt.json").read_text())
    results = json.loads((WORK_DIR / "results.json").read_text())
    table, diag = score(gt_data, results)
    out_path = BENCH_DIR / f"report-{date.today().isoformat()}.md"
    write_report(gt_data, table, diag, out_path)


# ---------------------------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stage", nargs="?", default="all",
                    choices=["build", "push", "run", "pull", "score", "all"])
    ap.add_argument("--n", type=int, default=DEFAULT_TARGET, help="eBay-Zielgroesse (>=300)")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    WORK_DIR.mkdir(parents=True, exist_ok=True)
    stages = ["build", "push", "run", "pull", "score"] if args.stage == "all" else [args.stage]
    for stage in stages:
        if stage == "build":
            build_manifest(args.n, args.seed)
        elif stage == "push":
            push()
        elif stage == "run":
            run_instrumentation()
        elif stage == "pull":
            pull()
        elif stage == "score":
            do_score()


if __name__ == "__main__":
    main()

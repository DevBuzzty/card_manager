#!/usr/bin/env python
"""Parallel CPU driver for label_photos: fan the pool across N worker processes.

EasyOCR on a single process leaves a 12-core CPU underused (per-image latency, not throughput).
Running several workers, each capped to a few torch threads, saturates the cores and cuts wall-clock.
Reuses label_photos.read_passcode so the OCR/validation logic stays in one place.

    PYTHONUTF8=1 python ml/label_photos_parallel.py [workers] [limit]

Resumable + crash-safe like label_photos.main(): checkpoints labeled_manifest.json every 200 kept,
skips photos already labeled. Output identical: ml/data/harvest/labeled/<passcode>/<file>.jpg.
"""
import json
import shutil
import sys
import time
from multiprocessing import Pool
from pathlib import Path

import label_photos as L


def _init(threads: int):
    import torch
    torch.set_num_threads(threads)


def _work(pathstr: str):
    p = Path(pathstr)
    try:
        return pathstr, L.read_passcode(p), None
    except Exception as e:  # a single bad JPG must not kill the pool
        return pathstr, None, str(e)


def main():
    workers = int(sys.argv[1]) if len(sys.argv) > 1 else 8
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    threads = max(1, 12 // workers)  # 12 physical cores

    L.OUT.mkdir(exist_ok=True)
    mpath = L.OUT / "labeled_manifest.json"
    manifest = json.loads(mpath.read_text()) if mpath.exists() else []
    done = {m["from_search"] + "/" + Path(m["file"]).name for m in manifest}

    files = [str(p) for p in sorted(L.HARVEST.rglob("*.jpg"))
             if L.OUT not in p.parents and (p.parent.name + "/" + p.name) not in done]
    if limit:
        files = files[:limit]
    print(f"{workers} workers x {threads} threads | {len(files)} photos to do "
          f"({len(manifest)} already labeled)")

    kept, dropped, errs = len(manifest), 0, 0
    t0 = time.time()
    with Pool(workers, initializer=_init, initargs=(threads,)) as pool:
        for i, (pathstr, pc, err) in enumerate(pool.imap_unordered(_work, files, chunksize=8), 1):
            p = Path(pathstr)
            if err:
                errs += 1
            elif not pc:
                dropped += 1
            else:
                d = L.OUT / pc
                d.mkdir(parents=True, exist_ok=True)
                shutil.copy(p, d / p.name)
                manifest.append({"file": f"{pc}/{p.name}", "passcode": pc,
                                 "from_search": p.parent.name})
                kept += 1
            if i % 200 == 0:
                mpath.write_text(json.dumps(manifest, indent=1))
                rate = i / (time.time() - t0)
                eta = (len(files) - i) / rate / 3600
                print(f"  {i}/{len(files)} done | kept {kept} drop {dropped} err {errs} "
                      f"| {rate:.1f} ph/s | ETA {eta:.1f}h")
    mpath.write_text(json.dumps(manifest, indent=1))
    dt = time.time() - t0
    print(f"\nLABELED: kept {kept}, dropped {dropped}, err {errs} in {dt/60:.1f}min "
          f"({len(files)/dt:.1f} ph/s) -> {L.OUT}")


if __name__ == "__main__":
    main()

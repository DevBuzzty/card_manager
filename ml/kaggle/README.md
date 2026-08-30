# Production training on Kaggle (Phase B)

Fine-tunes the embedder (unfrozen, full card set) and trains the detector at imgsz 640
(with card-less negative scenes) on a free Kaggle GPU, and exports both to ONNX. The
`index.bin` is rebuilt locally afterwards. **No app code changes** — the outputs are
drop-in replacements for the placeholder assets.

The notebook **downloads the ~14.7k card artworks itself**, so you only upload the tiny
code package.

## 1. Package the code (local, tiny)

```bash
ml/.venv/Scripts/python.exe -m ml.kaggle.package_data
```

Writes `kaggle_upload/` at the repo root, containing just `ml/` (the code, a few KB).

## 2. Create a Kaggle Dataset

- kaggle.com → **Datasets → New Dataset** → upload the `kaggle_upload` folder (or a zip of
  it — it's tiny). Title it e.g. `ygo-scanner-code`. Create it.
- The dataset root just needs to contain `ml/` (with `ml/__init__.py`). If Kaggle nests it,
  that's fine — the script searches for `*/ml/__init__.py`.

## 3. Create the Notebook

- **New Notebook** → **Add Input** → attach your `ygo-scanner-code` dataset.
- **Settings**: Accelerator = **GPU** (T4 or P100), **Internet = On** (needed for the
  artwork + DTD + pretrained-weights downloads).
- Cell 1:

```python
!pip install -q ultralytics onnx
```

- Cell 2 (find and run the training script):

```python
import glob
script = glob.glob('/kaggle/input/**/ml/kaggle/train_production.py', recursive=True)[0]
!python "{script}"
```

(Or just paste the contents of `ml/kaggle/train_production.py` into a cell and run it.)

## 4. Run + download

- Run all. It logs: download artworks (~14.7k — the slow part, tens of minutes) → DTD →
  scenes → embedder fine-tune (prints per-epoch loss + a **TOP-1** number) → detector
  training → exports. Budget a **single GPU session** (a few hours; keep the tab alive).
- When done, from the **Output** tab (`/kaggle/working/`) download:
  - `embedder.onnx`
  - `detector.onnx`
  - `embedder.pt`
- Send me those three files. I rebuild `index.bin` over all cards with the new embedder and
  drop all three into the app.

## Tunables

Edit the constants at the top of `train_production.py` if a session runs long:
`EPOCHS_EMB`, `EPOCHS_DET`, `IMGSZ_DET`, `N_SCENES`, `BG_FRACTION`, `BATCH_EMB`, `NUM_WORKERS`.

## Notes / gotchas

- If the in-notebook artwork download is throttled/slow, that's the main risk. It skips
  already-downloaded files, so re-running the cell resumes. As a fallback you can instead
  upload the artworks as a dataset — tell me and I'll switch the script back.
- Torch on Kaggle may differ from local. If the embedder ONNX export errors on the dynamo
  exporter, it falls back to the legacy tracer (needs the `onnx` pip package from step 3).
- The top-1 eval runs on CPU over a subset — a few minutes; a sanity number, not a gate.

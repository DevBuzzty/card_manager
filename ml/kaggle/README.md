# Production training on Kaggle (Phase B)

Fine-tunes the embedder (unfrozen, full card set) and trains the detector at imgsz 640
on a free Kaggle GPU, and exports both to ONNX. The `index.bin` is rebuilt locally
afterwards. **No app code changes** — the outputs are drop-in replacements for the
placeholder assets.

## 1. Package the upload (local, once the 14.7k download is done)

```bash
ml/.venv/Scripts/python.exe -m ml.kaggle.package_data
```

This writes `kaggle_upload/` at the repo root, containing:
- `ml/`    — the code (all `ml/*.py` modules)
- `cards/` — every artwork `<id>.jpg` + `manifest.json`

Zip that folder (right-click → Send to → Compressed folder), e.g. `ygo-scanner-data.zip`.

## 2. Create a Kaggle Dataset

- kaggle.com → **Datasets → New Dataset** → upload `ygo-scanner-data.zip`.
- Give it a title (e.g. `ygo-scanner-data`) and create it. Wait for it to finish processing.
- Make sure it unzips so the dataset root contains `ml/` and `cards/` (Kaggle usually
  auto-extracts zips). If it nests them under a folder, that's fine — the script searches
  for `*/cards/manifest.json`.

## 3. Create the Notebook

- **New Notebook** → in the right panel: **Add Input** → attach your `ygo-scanner-data` dataset.
- **Settings**: Accelerator = **GPU** (T4 or P100), **Internet = On**.
- In the first cell:

```python
!pip install -q ultralytics onnx
```

- In the second cell (find the dataset dir under `/kaggle/input/…` and run the script):

```python
import glob, sys
root = [p for p in glob.glob('/kaggle/input/*') if glob.glob(p + '/**/train_production.py', recursive=True)]
script = glob.glob('/kaggle/input/**/ml/kaggle/train_production.py', recursive=True)[0]
!python "{script}"
```

(Or simply paste the contents of `ml/kaggle/train_production.py` into a cell and run it.)

## 4. Run + download

- Run all. It logs progress: DTD → scenes → embedder fine-tune (prints per-epoch loss and a
  **TOP-1** number) → detector training → exports. Expect roughly **3–6 h** on one GPU session.
- When done, in the **Output** tab download from `/kaggle/working/`:
  - `embedder.onnx`
  - `detector.onnx`
  - `embedder.pt`
- Send me those three files. I rebuild `index.bin` over all cards with the new embedder and
  drop all three into the app.

## Tunables

Edit the constants at the top of `train_production.py` if a session runs long:
`EPOCHS_EMB`, `EPOCHS_DET`, `IMGSZ_DET`, `N_SCENES`, `BATCH_EMB`, `NUM_WORKERS`.

## Notes / gotchas

- Torch on Kaggle may differ from local (2.13). If the embedder ONNX export errors on the
  dynamo exporter, it already falls back to the legacy tracer (needs the `onnx` pip package,
  installed in step 3). If it still fails, tell me the error.
- The top-1 eval runs on CPU over a subset (`EVAL_SUBSET`) — it's a few minutes; it's only a
  sanity number, not the gate for shipping.

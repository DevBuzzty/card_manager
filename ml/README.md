# ml/

Python toolchain for the Yu-Gi-Oh card scanner: bulk-downloads card artwork + a
background dataset (DTD), then generates synthetic training data (YOLO detection
scenes and augmented embedder crops) used to train the instant artwork scanner.

## Setup

```bash
python -m venv ml/.venv
ml/.venv/Scripts/python.exe -m pip install --upgrade pip
ml/.venv/Scripts/python.exe -m pip install -r ml/requirements.txt
```

## Tests

```bash
ml/.venv/Scripts/python.exe -m pytest ml/tests -v
```

## Known hurdles

- `opencv-python` may not ship a prebuilt wheel for very new Python versions
  (e.g. 3.14 at the time of writing). If `pip install` fails only on
  `opencv-python`, swap it for `opencv-python-headless` in `requirements.txt`
  (the code only uses `cv2` image ops, so headless is fine).

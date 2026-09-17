"""Nachbau von DetectorModel/ScanPipeline (Android) auf Diagnosefotos."""
import sys, struct, numpy as np, onnxruntime as ort
from PIL import Image

A = r"C:\Users\Buzzty\Downloads\yugi\android\app\src\main\assets"
det = ort.InferenceSession(A + r"\detector.onnx")
emb = ort.InferenceSession(A + r"\embedder.onnx")
raw = open(A + r"\index.bin", "rb").read()
n, dim = struct.unpack_from("<II", raw, 0)
E = np.frombuffer(raw, "<f4", n * dim, 8).reshape(n, dim)
P = np.frombuffer(raw, "<i4", n, 8 + n * dim * 4)

def detect(img, conf=0.0, imgsz=640):
    w, h = img.size
    s = imgsz / max(w, h)
    nw, nh = round(w * s), round(h * s)
    px, py = (imgsz - nw) / 2, (imgsz - nh) / 2
    L = Image.new("RGB", (imgsz, imgsz), (114, 114, 114))
    L.paste(img.resize((nw, nh), Image.BILINEAR), (int(px), int(py)))
    x = np.asarray(L, np.float32).transpose(2, 0, 1)[None] / 255
    out = det.run(None, {det.get_inputs()[0].name: x})[0][0]
    res = []
    for d in out:
        if d[4] < conf: continue
        res.append(((d[0]-px)/s, (d[1]-py)/s, (d[2]-px)/s, (d[3]-py)/s, float(d[4])))
    return sorted(res, key=lambda r: -r[4])

MEAN = np.array([0.485, 0.456, 0.406], np.float32); STD = np.array([0.229, 0.224, 0.225], np.float32)
def embed(img, b):
    c = img.crop(tuple(int(v) for v in b[:4]))
    side = max(c.size); sq = Image.new("RGB", (side, side), (127, 127, 127))
    sq.paste(c, ((side - c.size[0]) // 2, (side - c.size[1]) // 2))
    x = ((np.asarray(sq.resize((224, 224), Image.BILINEAR), np.float32) / 255 - MEAN) / STD).transpose(2, 0, 1)[None]
    q = emb.run(None, {emb.get_inputs()[0].name: x})[0][0]
    q = q / np.linalg.norm(q)
    sims = E @ q; i = int(np.argmax(sims))
    return int(P[i]), float(sims[i])

if __name__ == "__main__":
    for f in sys.argv[1:]:
        img = Image.open(f).convert("RGB")
        boxes = detect(img)[:3]
        print(f.split("\\")[-1].split("/")[-1], img.size)
        for b in boxes:
            pc, sim = embed(img, b) if b[4] > 0.05 else (None, None)
            print(f"   score={b[4]:.3f} box={[int(v) for v in b[:4]]} -> {pc} sim={sim}")

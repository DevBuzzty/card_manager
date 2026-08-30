from pathlib import Path

ML_DIR = Path(__file__).resolve().parent
DATA_DIR = ML_DIR / "data"
CARDS_DIR = DATA_DIR / "cards"          # heruntergeladene Artworks (<artwork_id>.jpg) + manifest.json
BG_DIR = DATA_DIR / "backgrounds"        # DTD-Bilder
OUT_DIR = DATA_DIR / "out"               # generierte Trainingsdaten
DET_DIR = OUT_DIR / "detect"             # YOLO-Szenen (images/, labels/)
EMB_DIR = OUT_DIR / "embed"              # augmentierte Einzel-Crops (Preview / Phase 2)

CARDINFO_URL = "https://db.ygoprodeck.com/api/v7/cardinfo.php"
DTD_URL = "https://www.robots.ox.ac.uk/~vgg/data/dtd/download/dtd-r1.0.1.tar.gz"

SCENE_SIZE = 640     # Detektor-Szene (Quadrat, px)
CROP_SIZE = 224      # Embedder-Crop (Quadrat, px)
CARD_CLASS = 0       # einzige YOLO-Klasse: "card"

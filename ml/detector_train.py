import argparse
from pathlib import Path

from ultralytics import YOLO

from ml import config


def train_detector(data_yaml, epochs: int = 50, imgsz: int = 640,
                   model: str = "yolo11n.pt", device: str = "cpu",
                   project=None, name: str = "detector") -> Path:
    project = project or str(config.OUT_DIR / "runs")
    YOLO(model).train(
        data=str(data_yaml), epochs=epochs, imgsz=imgsz,
        device=device, project=project, name=name, exist_ok=True,
    )
    return Path(project) / name / "weights" / "best.pt"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True)
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--device", default="cpu")
    args = parser.parse_args()
    best = train_detector(args.data, epochs=args.epochs, imgsz=args.imgsz, device=args.device)
    print(f"best weights -> {best}")


if __name__ == "__main__":
    main()

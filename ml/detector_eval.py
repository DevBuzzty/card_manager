import argparse

from ultralytics import YOLO

from ml import config


def evaluate_detector(weights, data_yaml) -> dict:
    results = YOLO(weights).val(
        data=str(data_yaml), project=str(config.OUT_DIR / "runs"), name="val",
    )
    return {"mAP50": float(results.box.map50), "mAP50_95": float(results.box.map)}


def export_detector_onnx(weights) -> str:
    return YOLO(weights).export(format="onnx")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights", required=True)
    parser.add_argument("--data", required=True)
    args = parser.parse_args()
    metrics = evaluate_detector(args.weights, args.data)
    print(f"mAP50={metrics['mAP50']:.3f} mAP50-95={metrics['mAP50_95']:.3f}")


if __name__ == "__main__":
    main()

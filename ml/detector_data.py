from pathlib import Path

from ml import config


def write_data_yaml(out_path=None) -> Path:
    det = config.DET_DIR
    out_path = Path(out_path) if out_path else det / "data.yaml"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    content = (
        f"path: {det.as_posix()}\n"
        f"train: images/train\n"
        f"val: images/val\n"
        f"names:\n"
        f"  0: card\n"
    )
    out_path.write_text(content)
    return out_path

import tarfile
import urllib.request
from pathlib import Path

from ml import config

_EXTS = {".jpg", ".jpeg", ".png"}


def extract_archive(tar_path: Path, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    with tarfile.open(tar_path, "r:gz") as tar:
        tar.extractall(dest, filter="data")


def list_backgrounds(directory: Path = config.BG_DIR) -> list[Path]:
    return sorted(p for p in directory.rglob("*") if p.suffix.lower() in _EXTS)


def download_dtd(dest: Path = config.BG_DIR) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    archive = dest / "dtd.tar.gz"
    if not archive.exists():
        print("downloading DTD (~600 MB)…")
        urllib.request.urlretrieve(config.DTD_URL, archive)
    extract_archive(archive, dest)
    print(f"backgrounds ready: {len(list_backgrounds(dest))} images")


def main() -> None:
    download_dtd()


if __name__ == "__main__":
    main()

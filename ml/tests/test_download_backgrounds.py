import io
import tarfile
from ml import download_backgrounds


def test_extract_and_list(tmp_path):
    # Mini-tar.gz mit einer Fake-"Bild"-Datei bauen
    archive = tmp_path / "mini.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        data = b"not-a-real-image"
        info = tarfile.TarInfo(name="dtd/images/banded/x.jpg")
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))

    out = tmp_path / "bg"
    download_backgrounds.extract_archive(archive, out)
    found = download_backgrounds.list_backgrounds(out)

    assert len(found) == 1
    assert found[0].name == "x.jpg"

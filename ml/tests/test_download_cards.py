import io
import json
from ml import download_cards


FAKE_API = {
    "data": [
        {"id": 46986414, "card_images": [
            {"id": 46986414, "image_url_cropped": "http://x/46986414.jpg"},
            {"id": 46986415, "image_url_cropped": "http://x/46986415.jpg"},
        ]},
        {"id": 89631139, "card_images": [
            {"id": 89631139, "image_url_cropped": "http://x/89631139.jpg"},
        ]},
    ]
}


def test_fetch_card_manifest_flattens_artworks(monkeypatch):
    def fake_urlopen(url, timeout=0):
        return io.BytesIO(json.dumps(FAKE_API).encode())
    monkeypatch.setattr(download_cards.urllib.request, "urlopen", fake_urlopen)

    entries = download_cards.fetch_card_manifest("http://ignored")

    assert len(entries) == 3
    assert entries[0] == {"passcode": 46986414, "artwork_id": 46986414, "url": "http://x/46986414.jpg"}
    assert entries[1]["artwork_id"] == 46986415
    assert entries[2]["passcode"] == 89631139


def test_save_manifest_roundtrip(tmp_path):
    entries = [{"passcode": 1, "artwork_id": 2, "url": "u"}]
    path = download_cards.save_manifest(entries, dest=tmp_path)
    assert json.loads(path.read_text()) == entries

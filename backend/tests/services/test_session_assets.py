from app.services import disk_session_io as dio


def test_asset_write_read_delete(tmp_path, monkeypatch):
    monkeypatch.setattr(dio, "SESSIONS_DIR", tmp_path)
    dio.write_asset("s1", "genfill-w_1", b"PNGDATA")
    assert dio.read_asset("s1", "genfill-w_1") == b"PNGDATA"
    dio.delete_asset("s1", "genfill-w_1")
    assert dio.read_asset("s1", "genfill-w_1") is None
    dio.delete_asset("s1", "genfill-w_1")  # idempotent


def test_read_asset_missing_session(tmp_path, monkeypatch):
    monkeypatch.setattr(dio, "SESSIONS_DIR", tmp_path)
    assert dio.read_asset("nope", "genfill-w_1") is None


def test_per_node_image_scan_skips_genfill_assets(tmp_path, monkeypatch):
    monkeypatch.setattr(dio, "SESSIONS_DIR", tmp_path)
    dio.save_session("s1", b"primary", "image/png", created_at=0.0)
    dio.write_image("s1", "in-extra", b"nodeimg", "image/png")
    dio.write_asset("s1", "genfill-w_1", b"asset")
    scanned = dio.read_per_node_images("s1")
    assert "in-extra" in scanned
    assert all(not k.startswith("genfill-") for k in scanned)

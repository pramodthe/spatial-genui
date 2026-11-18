"""Routes that do not call a model, and the shapes the headset app reads from them."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.pipeline.prompts import EXAMPLE_MODULE


def test_health_catalog_example_and_errors() -> None:
    with TestClient(app) as client:
        health = client.get("/api/health")
        assert health.status_code == 200
        body = health.json()
        assert body["ok"] is True
        assert body["model"]
        assert "provider" in body
        assert "hasKey" in body
        assert set(body["spend"]) == {"usd", "runs", "budgetUsd"}

        kit = client.get("/api/kit.js")
        assert kit.status_code == 200
        assert "javascript" in kit.headers["content-type"]
        assert "kit" in kit.text[:500].lower() or "function" in kit.text[:500]

        catalog = client.get("/api/library/catalog")
        assert catalog.status_code == 200
        assets = catalog.json()["assets"]
        if assets:
            assert assets[0]["url"].startswith("/api/library/assets/")
            assert "creditShort" in assets[0]
            asset = client.get(assets[0]["url"])
            assert asset.status_code == 200
            assert asset.headers["content-type"].startswith("model/gltf-binary")

        missing = client.get("/api/library/assets/not-a-real-asset.glb")
        assert missing.status_code == 404
        assert missing.json()["error"] == "Unknown asset"

        example = client.post("/api/generate", json={"prompt": "/example"})
        assert example.status_code == 200
        payload = example.json()
        assert payload["ok"] is True
        assert payload["model"] == "built-in example"
        assert payload["code"] == EXAMPLE_MODULE
        assert payload["attempts"] == [{"stage": "ok", "ms": 0}]

        bad = client.post("/api/generate", json={"prompt": ""})
        assert bad.status_code == 400
        assert "1–2000" in bad.json()["error"]

        unknown = client.get("/api/courses/deadbeef")
        assert unknown.status_code == 404
        assert unknown.json()["error"] == "Unknown course"

        assert client.get("/api/courses").json() == {"courses": []}
        assert client.get("/api/games").json() == {"games": []}
        assert client.get("/api/nope").json()["error"] == "Not found"

        size = client.post("/api/real-size", json={})
        assert size.status_code == 400


def test_static_files_stay_inside_the_directory(tmp_path, monkeypatch) -> None:
    from app.core import config as config_mod

    site = tmp_path / "site"
    assets = site / "assets"
    assets.mkdir(parents=True)
    (site / "index.html").write_text("<p>home</p>", encoding="utf-8")
    (assets / "app.js").write_text("console.log(1)", encoding="utf-8")
    monkeypatch.setenv("STATIC_DIR", str(site))
    config_mod.reload_config()
    with TestClient(app) as client:
        page = client.get("/courses")
        assert page.status_code == 200
        assert "home" in page.text
        script = client.get("/assets/app.js")
        assert script.status_code == 200
        assert "immutable" in script.headers["cache-control"]
        missing = client.get("/missing.js")
        assert missing.status_code == 404
        escaped = client.get("/../pyproject.toml")
        assert escaped.status_code in {403, 404}


def test_a_game_card_gets_the_picture_of_its_finished_run() -> None:
    """The run's final view is kept as the game's card picture; until then (and for a bad name) there is none."""
    from app.services import studio

    run = studio.StudioRun("picture-run", "a kite", "game", "m")
    with TestClient(app) as client:
        assert client.get("/api/games/0a1b2c3d/picture").status_code == 404
        assert studio.keep_picture("game-0a1b2c3d", "picture-run") is False  # the run has no final view yet
        run.save("final-view.png", b"\x89PNG picture")
        assert studio.keep_picture("game-0a1b2c3d", "picture-run") is True
        assert studio.keep_picture("../escape", "picture-run") is False
        got = client.get("/api/games/0a1b2c3d/picture")
        assert got.status_code == 200 and got.headers["content-type"] == "image/png" and got.content == b"\x89PNG picture"
        assert client.get("/api/games/not-an-id/picture").status_code == 404
        from app.services import games

        assert games.summary({"id": "0a1b2c3d", "status": "ready", "code": "x"}) == {"id": "0a1b2c3d", "status": "ready", "picture": True}
        assert games.summary({"id": "ffffffff", "status": "ready"})["picture"] is False
        assert client.get("/api/courses/0a1b2c3d/lessons/0/picture").status_code == 404

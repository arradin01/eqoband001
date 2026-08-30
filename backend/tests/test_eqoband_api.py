import os
import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "http://127.0.0.1:8001").rstrip("/")


def test_telemetry_shape_and_values():
    response = requests.get(f"{BASE_URL}/api/telemetry", timeout=15)
    assert response.status_code == 200
    payload = response.json()
    assert payload["device_name"] == "EQOband Prototype"
    assert isinstance(payload["heart_rate"], int)
    assert isinstance(payload["weekly_steps"], list)


def test_insights_shape():
    response = requests.get(f"{BASE_URL}/api/insights", timeout=15)
    assert response.status_code == 200
    payload = response.json()
    assert len(payload["insights"]) >= 1
    assert {"title", "body"}.issubset(payload["insights"][0])


def test_ai_chat_returns_answer_for_custom_question():
    response = requests.post(
        f"{BASE_URL}/api/ai/chat",
        json={"message": "How is my pulse today?", "context": {}},
        timeout=30,
    )
    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload["answer"], str)
    assert payload["answer"]
    assert payload["source"] in {"baseline", "eqoai"}


def test_ai_chat_rejects_blank_message():
    response = requests.post(
        f"{BASE_URL}/api/ai/chat", json={"message": "   "}, timeout=15
    )
    assert response.status_code == 400
    payload = response.json()
    assert "detail" in payload


# Verify /api/ai/chat accepts new `language` field (en + id)
def test_ai_chat_accepts_language_param():
    for lang in ("en", "id"):
        response = requests.post(
            f"{BASE_URL}/api/ai/chat",
            json={"message": "how am i doing", "language": lang, "context": {"connected": True, "heart_rate": 72, "steps": 5000, "step_goal": 10000, "tracking": False, "battery": 80}},
            timeout=30,
        )
        assert response.status_code == 200, f"lang={lang} failed"
        payload = response.json()
        assert isinstance(payload["answer"], str) and payload["answer"]
        assert payload["source"] in {"baseline", "eqoai"}


# ---- TTS ----
def test_tts_generate_and_fetch_audio():
    """POST /api/tts should return a cached url and GET should stream audio/mpeg."""
    payload = {"text": "Hello from EQO band", "voice": "nova", "model": "tts-1", "format": "mp3"}
    resp = requests.post(f"{BASE_URL}/api/tts", json=payload, timeout=60)
    assert resp.status_code == 200, f"status={resp.status_code}, body={resp.text}"
    data = resp.json()
    assert "url" in data and data["url"].startswith("/api/tts/") and data["url"].endswith(".mp3")
    # fetch audio bytes
    audio_url = f"{BASE_URL}{data['url']}"
    audio_resp = requests.get(audio_url, timeout=30)
    assert audio_resp.status_code == 200
    assert audio_resp.headers.get("content-type", "").startswith("audio/mpeg")
    assert len(audio_resp.content) > 500


def test_tts_rejects_blank_text():
    resp = requests.post(f"{BASE_URL}/api/tts", json={"text": "   "}, timeout=15)
    assert resp.status_code == 400


def test_tts_get_missing_returns_404():
    resp = requests.get(f"{BASE_URL}/api/tts/nonexistent_hash_xyz.mp3", timeout=15)
    assert resp.status_code == 404


def test_tts_cache_reuse_same_key():
    """Same text/voice/model should reuse the same cached URL."""
    payload = {"text": "cache reuse test", "voice": "nova", "model": "tts-1", "format": "mp3"}
    r1 = requests.post(f"{BASE_URL}/api/tts", json=payload, timeout=60)
    r2 = requests.post(f"{BASE_URL}/api/tts", json=payload, timeout=60)
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["url"] == r2.json()["url"]


# ---- Tracking Sessions ----
def test_tracking_session_save_and_retrieve():
    """Test saving a completed tracking session and querying it."""
    session_data = {
        "steps": 1420,
        "duration": 480,
        "distance_km": 1.06,
        "calories_kcal": 56,
        "source": "ttp223_gesture",
    }
    resp = requests.post(f"{BASE_URL}/api/tracking/session", json=session_data, timeout=15)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["status"] == "saved"
    assert data["session"]["steps"] == 1420
    assert data["session"]["duration"] == 480

    # Retrieve sessions
    get_resp = requests.get(f"{BASE_URL}/api/tracking/sessions", timeout=15)
    assert get_resp.status_code == 200
    get_data = get_resp.json()
    assert "sessions" in get_data
    assert get_data["count"] >= 1


# ---- STT endpoint validation ----
def test_stt_rejects_empty_audio():
    resp = requests.post(f"{BASE_URL}/api/stt", json={"audio_base64": ""}, timeout=15)
    assert resp.status_code == 400

def test_stt_rejects_corrupted_short_payload():
    resp = requests.post(f"{BASE_URL}/api/stt", json={"audio_base64": "abc"}, timeout=15)
    assert resp.status_code == 400


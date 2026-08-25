import os
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/")


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
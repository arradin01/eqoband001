from fastapi import FastAPI, APIRouter, HTTPException, Response, UploadFile, File, Form
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import re
import hashlib
import logging
import base64
import tempfile
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone
from emergentintegrations.llm.chat import LlmChat, UserMessage
from emergentintegrations.llm.openai import OpenAITextToSpeech, OpenAISpeechToText
import emoji as emoji_lib


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')
AUDIO_CACHE = ROOT_DIR / "audio_cache"
AUDIO_CACHE.mkdir(exist_ok=True)

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")


class StatusCheck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class StatusCheckCreate(BaseModel):
    client_name: str

@api_router.get("/")
async def root():
    return {"message": "EQOband API ready", "version": "3.0"}

DEMO_TELEMETRY = {
    "heart_rate": 72,
    "steps": 6842,
    "step_goal": 10000,
    "activity_minutes": 48,
    "activity_goal": 60,
    "battery": 86,
    "connected": True,
    "device_name": "EQOband Prototype",
    "rssi": -54,
    "weekly_steps": [7200, 8450, 6120, 9040, 6842, 0, 0],
    "weekly_labels": ["M", "T", "W", "T", "F", "S", "S"],
}

@api_router.get("/telemetry")
async def get_telemetry():
    return {**DEMO_TELEMETRY, "updated_at": datetime.now(timezone.utc).isoformat()}

@api_router.get("/insights")
async def get_insights():
    telemetry = DEMO_TELEMETRY
    return {
        "insights": [
            {"title": "Strong momentum", "body": f"You are at {round(telemetry['steps'] / telemetry['step_goal'] * 100)}% of today's step goal.", "tone": "brand"},
            {"title": "Keep your rhythm", "body": "A 12-minute walk this afternoon would put you on track for your activity goal.", "tone": "success"},
            {"title": "Heart rate steady", "body": f"Your current pulse is {telemetry['heart_rate']} BPM. Use EQOAI for more context.", "tone": "info"},
        ]
    }

class ChatRequest(BaseModel):
    message: str
    language: Optional[str] = "en"
    context: dict = {}

@api_router.post("/ai/chat")
async def ai_chat(request: ChatRequest):
    message = request.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message is required")

    language = (request.language or "en").lower()
    ctx = request.context or {}
    connected = ctx.get("connected", False)
    bpm = ctx.get("heart_rate", 0)
    steps = ctx.get("steps", 0)
    step_goal = ctx.get("step_goal", 10000)
    tracking = ctx.get("tracking", False)
    battery = ctx.get("battery", 0)

    if language == "id":
        band_ctx = (
            f"Denyut: {bpm} BPM. Langkah: {steps:,}/{step_goal:,}. "
            f"Tracking: {'aktif' if tracking else 'nonaktif'}. Baterai: {battery}%."
            if connected else "Gelang belum terhubung."
        )
        system_message = (
            "Kamu adalah EQO AI - asisten kesehatan cerdas untuk EQOBand, gelang pintar berbasis ESP32-C3. "
            "Jawab pertanyaan apa saja secara singkat, natural, dan ramah dalam Bahasa Indonesia. "
            "Jangan pernah menyebut merek AI lain (Claude, OpenAI, dsb). Selalu identifikasi diri sebagai EQO AI. "
            f"Data gelang pengguna: {band_ctx} "
            "Hindari diagnosis medis - berikan saran umum kebugaran saja."
        )
    else:
        band_ctx = (
            f"Pulse: {bpm} BPM. Steps: {steps:,}/{step_goal:,}. "
            f"Tracking: {'active' if tracking else 'idle'}. Battery: {battery}%."
            if connected else "Band is not connected."
        )
        system_message = (
            "You are EQO AI, the smart health assistant embedded in the EQOBand ESP32-C3 wristband. "
            "Answer any question naturally, briefly, and warmly in English. "
            "Never mention other AI brand names (Claude, OpenAI, etc.). Always identify as EQO AI. "
            f"Wearer's band data: {band_ctx} "
            "Avoid medical diagnosis - give general wellness guidance only."
        )

    key = os.getenv("EMERGENT_LLM_KEY")
    if not key:
        fallback = "EQO AI is offline. Please try again later." if language == "en" else "EQO AI sedang offline. Coba lagi nanti."
        return {"answer": fallback, "source": "baseline"}

    try:
        chat = LlmChat(
            api_key=key,
            session_id=str(uuid.uuid4()),
            system_message=system_message,
        ).with_model("openai", "gpt-5.4-mini")
        answer = await chat.send_message(UserMessage(text=message))
        return {"answer": answer, "source": "eqoai"}
    except Exception as exc:
        logger.warning("EQOAI fallback: %s", exc)
        fallback = "I'm having trouble reaching my knowledge base. Try again in a moment." if language == "en" else "Saya kesulitan mengakses pengetahuan saya. Coba lagi sebentar."
        return {"answer": fallback, "source": "baseline"}


# ---------------- TTS ----------------
def clean_for_tts(text: str) -> str:
    text = emoji_lib.replace_emoji(text, replace="")
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"`{1,3}[^`]*`{1,3}", "", text)
    text = re.sub(r"[*_#>~|]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def tts_cache_key(text: str, voice: str, speed: float, model: str, fmt: str) -> str:
    return hashlib.sha256(f"{text}|{voice}|{speed}|{model}|{fmt}".encode()).hexdigest()


class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = "nova"
    speed: Optional[float] = 1.0
    model: Optional[str] = "tts-1"
    format: Optional[str] = "mp3"


@api_router.post("/tts")
async def tts_generate(request: TTSRequest):
    """Generate TTS audio, cache it, and return a URL to fetch it."""
    text = clean_for_tts(request.text or "")
    if not text:
        raise HTTPException(status_code=400, detail="Text is required")
    # OpenAI TTS max is 4096 chars — trim to avoid failures
    text = text[:4000]

    voice = request.voice or "nova"
    speed = float(request.speed or 1.0)
    model = request.model or "tts-1"
    fmt = request.format or "mp3"
    key = tts_cache_key(text, voice, speed, model, fmt)
    out_path = AUDIO_CACHE / f"{key}.{fmt}"

    if not out_path.exists():
        api_key = os.getenv("EMERGENT_LLM_KEY")
        if not api_key:
            raise HTTPException(status_code=500, detail="TTS unavailable: missing key")
        tts = OpenAITextToSpeech(api_key=api_key)
        try:
            audio = await tts.generate_speech(
                text=text, model=model, voice=voice, speed=speed, response_format=fmt,
            )
        except Exception as exc:
            logger.warning("TTS generation failed: %s", exc)
            raise HTTPException(status_code=502, detail="TTS generation failed") from exc
        out_path.write_bytes(audio)

    return {"url": f"/api/tts/{key}.{fmt}", "cached": out_path.exists()}


MEDIA_TYPES = {
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
    "opus": "audio/opus",
    "aac": "audio/aac",
    "flac": "audio/flac",
    "pcm": "audio/L16",
}


@api_router.get("/tts/{key}.{ext}")
async def get_tts_audio(key: str, ext: str):
    if ext not in MEDIA_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported format")
    path = AUDIO_CACHE / f"{key}.{ext}"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio not found")
    return Response(
        content=path.read_bytes(),
        media_type=MEDIA_TYPES[ext],
        headers={"Cache-Control": "public, max-age=31536000"},
    )


# ---------------- STT (Speech to Text) ----------------
class Base64STTRequest(BaseModel):
    audio_base64: str
    format: Optional[str] = "m4a"  # m4a, wav, mp3, webm
    language: Optional[str] = None
    prompt: Optional[str] = None


@api_router.post("/stt")
async def speech_to_text(request: Base64STTRequest):
    """Transcribe base64 encoded audio using Whisper via Emergent Universal Key."""
    raw_b64 = request.audio_base64
    if not raw_b64 or not raw_b64.strip():
        raise HTTPException(status_code=400, detail="Audio data is required")

    # Strip data URL prefix if present (e.g. data:audio/webm;base64,...)
    if "," in raw_b64:
        raw_b64 = raw_b64.split(",", 1)[1]

    try:
        audio_bytes = base64.b64decode(raw_b64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid base64 payload: {str(e)}")

    if len(audio_bytes) < 100:
        raise HTTPException(status_code=400, detail="Audio payload too short")

    ext = (request.format or "m4a").lower().strip(".")
    if ext not in ["m4a", "wav", "mp3", "webm", "mp4", "mpeg", "mpga"]:
        ext = "m4a"

    api_key = os.getenv("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="STT unavailable: missing key")

    stt = OpenAISpeechToText(api_key=api_key)
    with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = Path(tmp.name)

    try:
        res = await stt.transcribe(
            file=tmp_path,
            model="whisper-1",
            response_format="json",
            prompt=request.prompt,
            language=request.language,
        )
        # res can be a dict or object with text attribute
        text = ""
        if isinstance(res, dict):
            text = res.get("text", "")
        elif hasattr(res, "text"):
            text = str(res.text)
        elif hasattr(res, "get"):
            text = res.get("text", "")
        else:
            text = str(res)
        return {"text": text.strip(), "language": request.language}
    except Exception as exc:
        logger.warning("STT transcription error: %s", exc)
        raise HTTPException(status_code=502, detail=f"STT failed: {str(exc)}")
    finally:
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except Exception:
                pass


@api_router.post("/stt/upload")
async def speech_to_text_file(
    file: UploadFile = File(...),
    language: Optional[str] = Form(None),
    prompt: Optional[str] = Form(None),
):
    """Transcribe multipart uploaded audio file using Whisper."""
    api_key = os.getenv("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="STT unavailable: missing key")

    ext = Path(file.filename or "audio.m4a").suffix or ".m4a"
    content = await file.read()
    if len(content) < 100:
        raise HTTPException(status_code=400, detail="Audio file is empty or too short")

    stt = OpenAISpeechToText(api_key=api_key)
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(content)
        tmp_path = Path(tmp.name)

    try:
        res = await stt.transcribe(
            file=tmp_path,
            model="whisper-1",
            response_format="json",
            prompt=prompt,
            language=language,
        )
        text = res.get("text", "") if isinstance(res, dict) else getattr(res, "text", str(res))
        return {"text": str(text).strip(), "language": language}
    except Exception as exc:
        logger.warning("STT file transcription error: %s", exc)
        raise HTTPException(status_code=502, detail=f"STT file failed: {str(exc)}")
    finally:
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except Exception:
                pass


# ---------------- Tracking Sessions ----------------
class TrackingSessionCreate(BaseModel):
    steps: int = 0
    duration: int = 0  # seconds
    distance_km: float = 0.0
    calories_kcal: int = 0
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    source: Optional[str] = "ttp223_gesture"


class TrackingSession(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    steps: int
    duration: int
    distance_km: float
    calories_kcal: int
    start_time: str
    end_time: str
    source: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


@api_router.post("/tracking/session")
async def save_tracking_session(session: TrackingSessionCreate):
    """Save a completed tracking session (invoked on DOUBLE_TAP stop or manual stop)."""
    now_iso = datetime.now(timezone.utc).isoformat()
    record = {
        "id": str(uuid.uuid4()),
        "steps": session.steps,
        "duration": session.duration,
        "distance_km": session.distance_km,
        "calories_kcal": session.calories_kcal,
        "start_time": session.start_time or now_iso,
        "end_time": session.end_time or now_iso,
        "source": session.source or "ttp223_gesture",
        "created_at": datetime.now(timezone.utc),
    }
    await db.tracking_sessions.insert_one(record)
    # Remove Mongo's internal _id for serialization
    record.pop("_id", None)
    return {"status": "saved", "session": record}


@api_router.get("/tracking/sessions")
async def get_tracking_sessions(limit: int = 50):
    """Get list of recent saved tracking sessions."""
    docs = await db.tracking_sessions.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    # Convert datetime objects to isoformat strings
    for d in docs:
        if isinstance(d.get("created_at"), datetime):
            d["created_at"] = d["created_at"].isoformat()
    return {"sessions": docs, "count": len(docs)}


@api_router.delete("/tracking/sessions")
async def clear_tracking_sessions():
    """Clear all saved tracking sessions."""
    res = await db.tracking_sessions.delete_many({})
    return {"deleted_count": res.deleted_count}


@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_dict = input.dict()
    status_obj = StatusCheck(**status_dict)
    _ = await db.status_checks.insert_one(status_obj.dict())
    return status_obj

@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find().to_list(1000)
    return [StatusCheck(**status_check) for status_check in status_checks]

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone
from emergentintegrations.llm.chat import LlmChat, UserMessage


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

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
    return {"message": "EQOband API ready", "version": "2.0"}

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

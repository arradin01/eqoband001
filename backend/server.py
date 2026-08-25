from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List
import uuid
from datetime import datetime, timezone
from emergentintegrations.llm.chat import LlmChat, UserMessage


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# Define Models
class StatusCheck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class StatusCheckCreate(BaseModel):
    client_name: str

# Add your routes to the router instead of directly to app
@api_router.get("/")
async def root():
    return {"message": "EQOband API ready", "version": "1.0"}

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
    context: dict = {}

@api_router.post("/ai/chat")
async def ai_chat(request: ChatRequest):
    message = request.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message is required")
    lower = message.lower()
    if "step" in lower or "walk" in lower:
        baseline = f"You have {DEMO_TELEMETRY['steps']:,} steps today, which is {round(DEMO_TELEMETRY['steps'] / DEMO_TELEMETRY['step_goal'] * 100)}% of your goal."
    elif "heart" in lower or "pulse" in lower:
        baseline = f"Your current pulse is {DEMO_TELEMETRY['heart_rate']} BPM and your band is connected."
    else:
        baseline = "Your activity is trending well today. A short, easy movement break would support your goal."
    key = os.getenv("EMERGENT_LLM_KEY")
    if not key:
        return {"answer": baseline, "source": "baseline"}
    try:
        chat = LlmChat(api_key=key, session_id=str(uuid.uuid4()), system_message=(
            "You are EQOAI, a friendly professional wearable health assistant. "
            "Use only the supplied telemetry, avoid diagnosis, and keep responses concise. "
            f"Telemetry: {DEMO_TELEMETRY}"
        )).with_model("openai", "gpt-5.4-mini")
        answer = await chat.send_message(UserMessage(text=message))
        return {"answer": answer, "source": "eqoai"}
    except Exception as exc:
        logger.warning("EQOAI fallback: %s", exc)
        return {"answer": baseline, "source": "baseline"}

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

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

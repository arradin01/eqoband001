# EQOband Mobile App — PRD

## Overview
EQOband is a companion mobile app for a wearable wristband (Seeed Studio XIAO ESP32-C3 based) with an embedded AI assistant named **EQO AI**. Users can view real-time health data, track weekly goals, chat with EQO AI, and manage their band connection & settings.

## Tech Stack
- **Frontend**: Expo React Native (SDK 54), React Native Safe Area, MaterialCommunityIcons, expo-linear-gradient
- **Backend**: FastAPI (Python) + MongoDB
- **AI**: `emergentintegrations` LLM chat with `gpt-5.4-mini` via Emergent LLM key
- **BLE**: currently mocked in-app; ready to swap in `react-native-ble-plx` once ESP32-C3 firmware UUIDs are finalised.

## Screens (5-tab bottom navigation)

### 1. Health (Dashboard)
- Live BPM hero card with wave visualisation + 30s auto-refresh countdown
- Battery bar (appears only when connected)
- Metric cards: Steps today, Active time, EQO AI status, Goals %
- All cards **lock automatically when the band is disconnected** and prompt user to open Device tab
- EQOAI briefing + Activity signal panels

### 2. Weekly Goals
- Weekly movement score (gradient banner)
- 7-day steps bar chart (today highlighted, days meeting 60 % goal turn green)
- Daily progress bars: Steps, Heart zone minutes, Calories
- Achievements section (5-day rhythm)

### 3. EQO AI (chat)
- Full chat interface with typing indicator
- Preset prompt chips
- **Local intent detection** for device commands executes side-effects (start/stop tracking, power off, volume, tab navigation)
- **All replies come from LLM** (Emergent LLM key), locale-aware (EN/ID)
- Voice mode button (visual state)

### 4. Device (BLE)
- Big **hold-to-connect (2s)** button with animated progress bar
- Connection status, battery %, RSSI, connection state pills
- Step tracking start/stop control
- Service + Characteristic UUIDs displayed

### 5. Settings
- Language switch (EN ↔ ID) — persisted
- Bluetooth mirror indicator
- Notifications toggle — persisted
- Talkback toggle — persisted
- Volume slider (0–100) — persisted
- Edit daily goals modal (steps / active min / calories) — persisted

## Bilingual UI (EN + ID)
- Full string catalogue in `/app/frontend/src/i18n.ts`
- User can switch language via header pill OR Settings > Language
- Choice persisted via `@/src/utils/storage`
- LLM answers are also locale-aware — backend passes `language` into the system prompt

## Communication Model
1. **Band → App (BLE mocked)**: connection state, HR, steps, battery — all currently simulated client-side and gated behind connection state.
2. **App → Backend**: `/api/telemetry`, `/api/insights`, `/api/ai/chat` (accepts message, language, live context).
3. **EQO AI → App**: LLM returns concise, locale-aware, never-diagnostic wellness replies grounded in the current telemetry context.

## API Endpoints
- `GET /api/` → health check
- `GET /api/telemetry` → demo band telemetry
- `GET /api/insights` → three static insight cards
- `POST /api/ai/chat` → EQO AI conversational reply (LLM); accepts `{ message, language, context }`

## Persistence
- Language, volume, notifications, talkback, and custom step/active/calorie goals stored via `@/src/utils/storage` (AsyncStorage-backed).

## Future Work
- Wire real BLE (`react-native-ble-plx`) once ESP32-C3 firmware exposes service/characteristic UUIDs.
- Native voice pipeline (STT + TTS) once a direct OpenAI key is provided (current key routed via emergent integrations).

## Deployment
- Package manager: **Yarn 1.22.22** (deterministic via `yarn.lock`)
- `package-lock.json` removed to avoid lockfile collision on EAS cloud builds
- `eas.json` present with `development`, `preview` (APK internal), and `production` (AAB) profiles
- Build via Emergent Publish button → Android/iOS build pipeline

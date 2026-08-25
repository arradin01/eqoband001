# EQOband PRD

## Problem statement
EQOband is a premium mobile companion for an ESP32-C3 wearable, combining live health telemetry, weekly goals, BLE device management, and EQOAI insights with future hands-free voice interaction.

## Architecture and personas
- Expo 54 React Native mobile client with bottom-tab navigation.
- FastAPI `/api` backend with MongoDB-ready configuration and server-side LLM access.
- Primary persona: a health-conscious wearable owner who wants glanceable daily momentum and practical recommendations.

## Core requirements
- Health dashboard: pulse, steps, activity, battery, and connection state.
- Weekly goals: step/activity progress, trends, and achievements.
- EQOAI: rule-based baseline plus server-side LLM chat.
- Device: BLE-ready pairing, battery, RSSI, reconnect/disconnect, replaceable UUIDs.
- Settings: demo profile, notifications, goals, device information.
- Voice-ready microphone interaction and spoken-response permissions.

## Implemented (2026-03-03)
- Built the dark obsidian/ember premium health dashboard and five-section navigation.
- Added telemetry, insights, and EQOAI chat backend endpoints with safe baseline fallback.
- Added device management screen and placeholder ESP32-C3 UUID display.
- Added iOS/Android Bluetooth and microphone permissions.
- Voice UI is present and permission-ready; real Realtime voice requires a direct OpenAI voice-enabled key (the supplied key was OpenRouter-formatted).
- Regression verified (2026-03-03): all backend API checks and requested 390x844 mobile flows pass, including custom EQOAI chat, navigation, device toggle, settings actions, and overflow checks.

## Backlog
- P0: Replace placeholder UUIDs with firmware UUIDs and add native BLE scanning/notifications.
- P0: Add direct OpenAI Realtime voice credentials and connect audio session.
- P1: Persist telemetry history and goals in MongoDB.
- P1: Add firmware update flow and notification preferences.
- P2: Add HealthKit/Google Health Connect import and richer recovery metrics.
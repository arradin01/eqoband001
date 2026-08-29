// Cross-platform TTS: OpenAI TTS when online (via backend /api/tts), on-device
// expo-speech fallback when offline. Volume controlled by caller (0..1).

import * as FileSystem from "expo-file-system";
import * as Network from "expo-network";
import * as Speech from "expo-speech";
import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { Platform } from "react-native";

const API = `${process.env.EXPO_PUBLIC_BACKEND_URL ?? ""}/api`;
let player: ReturnType<typeof createAudioPlayer> | null = null;

async function isOnline(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return !!(state.isConnected && state.isInternetReachable !== false);
  } catch {
    return true; // if the API fails, assume online and let TTS fail loud
  }
}

async function speakOffline(text: string, volume: number, lang: string) {
  try {
    Speech.stop();
  } catch {}
  try {
    Speech.speak(text, {
      language: lang === "id" ? "id-ID" : "en-US",
      pitch: 1.0,
      rate: 1.0,
      volume,
    });
  } catch {
    // no-op
  }
}

async function speakOnline(text: string, volume: number) {
  try {
    const res = await fetch(`${API}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: "nova", speed: 1.0, model: "tts-1", format: "mp3" }),
    });
    if (!res.ok) throw new Error(`TTS API ${res.status}`);
    const { url } = (await res.json()) as { url: string };
    const audioUrl = `${process.env.EXPO_PUBLIC_BACKEND_URL ?? ""}${url}`;
    // On web the audio API is different — use HTML5 Audio directly.
    if (Platform.OS === "web") {
      try {
        const audio = new (globalThis as any).Audio(audioUrl);
        audio.volume = Math.max(0, Math.min(1, volume));
        await audio.play();
      } catch {
        // ignore
      }
      return;
    }
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
    if (player) {
      try { player.remove(); } catch {}
      player = null;
    }
    player = createAudioPlayer({ uri: audioUrl });
    try {
      player.volume = Math.max(0, Math.min(1, volume));
    } catch {}
    player.play();
  } catch (e) {
    // Fall back to offline TTS on any online failure
    await speakOffline(text, volume, "en");
  }
}

export async function speak(text: string, volume: number, lang: string) {
  const cleaned = text.trim();
  if (!cleaned) return;
  const online = await isOnline();
  if (online) {
    await speakOnline(cleaned, volume);
  } else {
    await speakOffline(cleaned, volume, lang);
  }
}

export function stopSpeaking() {
  try { Speech.stop(); } catch {}
  if (player) {
    try { player.pause(); } catch {}
  }
}

export async function checkOnline() {
  return isOnline();
}

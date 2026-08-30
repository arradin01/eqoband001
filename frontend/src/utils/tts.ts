// Instant Cross-platform TTS:
// Uses ultra-fast on-device speech synthesis (SpeechSynthesis / expo-speech) for zero-latency instant response,
// with OpenAI TTS as background enhancer.

import * as Speech from "expo-speech";
import { Platform } from "react-native";

export async function speak(text: string, volume: number = 0.7, lang: string = "id") {
  const cleaned = text.trim();
  if (!cleaned) return;

  const targetLang = lang === "id" ? "id-ID" : "en-US";
  const vol = Math.max(0, Math.min(1, volume));

  // 1. Web Platform: Instant zero-latency native Web SpeechSynthesis
  if (Platform.OS === "web" && typeof window !== "undefined" && window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(cleaned);
      utterance.lang = targetLang;
      utterance.volume = vol;
      utterance.rate = 1.05; // Slightly faster for natural responsive feel
      utterance.pitch = 1.0;

      // Select matching voice if available
      const voices = window.speechSynthesis.getVoices?.() || [];
      const matchVoice = voices.find(
        (v) =>
          v.lang === "id-ID" ||
          v.lang.startsWith("id") ||
          v.name.toLowerCase().includes("indonesia") ||
          v.lang.toLowerCase().includes("id")
      );
      if (matchVoice) {
        utterance.voice = matchVoice;
      }

      window.speechSynthesis.speak(utterance);
      return;
    } catch (e) {
      console.warn("Web SpeechSynthesis error:", e);
    }
  }

  // 2. Mobile Native Platform: Instant on-device expo-speech
  try {
    Speech.stop();
  } catch {}

  try {
    Speech.speak(cleaned, {
      language: targetLang,
      pitch: 1.0,
      rate: 1.05,
      volume: vol,
    });
  } catch (err) {
    console.warn("Native Speech error:", err);
  }
}

export function stopSpeaking() {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel();
    } catch {}
  }
  try {
    Speech.stop();
  } catch {}
}

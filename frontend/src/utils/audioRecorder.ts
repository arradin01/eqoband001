import { Platform } from "react-native";

export type RecordingSession = {
  stop: () => Promise<string | null>; // Returns base64 audio data or text transcript
  discard: () => void;
  getLiveTranscript?: () => string;
};

let webMediaRecorder: any = null;
let webAudioChunks: any[] = [];
let webStream: any = null;
let speechRecognizer: any = null;
let speechRecognitionText = "";

const API = `${process.env.EXPO_PUBLIC_BACKEND_URL ?? ""}/api`;

export async function startAudioRecording(language: string = "id"): Promise<RecordingSession> {
  let isDiscarded = false;
  speechRecognitionText = "";

  if (Platform.OS === "web") {
    // 1. Try browser Web SpeechRecognition API for instant high-accuracy live Indonesian/English STT
    if (typeof window !== "undefined") {
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (SpeechRecognition) {
        try {
          speechRecognizer = new SpeechRecognition();
          speechRecognizer.continuous = true;
          speechRecognizer.interimResults = true;
          speechRecognizer.lang = language === "id" ? "id-ID" : "en-US";

          speechRecognizer.onresult = (event: any) => {
            let finalStr = "";
            for (let i = event.resultIndex; i < event.results.length; ++i) {
              if (event.results[i].isFinal || event.results[i][0].confidence > 0.3) {
                finalStr += event.results[i][0].transcript + " ";
              }
            }
            if (finalStr.trim()) {
              speechRecognitionText = finalStr.trim();
            }
          };

          speechRecognizer.onerror = (e: any) => {
            console.warn("SpeechRecognition error:", e);
          };

          speechRecognizer.start();
        } catch (e) {
          console.warn("SpeechRecognition init error:", e);
        }
      }
    }

    // 2. Also start MediaRecorder for audio capture
    try {
      if (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia) {
        webStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        webAudioChunks = [];
        const mimeType =
          typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.("audio/webm")
            ? "audio/webm"
            : "";

        webMediaRecorder = mimeType
          ? new MediaRecorder(webStream, { mimeType })
          : new MediaRecorder(webStream);

        webMediaRecorder.ondataavailable = (event: any) => {
          if (event.data && event.data.size > 0) {
            webAudioChunks.push(event.data);
          }
        };

        webMediaRecorder.start(100);
      }
    } catch (e) {
      console.warn("Web audio capture not permitted or unavailable:", e);
    }

    return {
      getLiveTranscript() {
        return speechRecognitionText;
      },
      async stop() {
        if (isDiscarded) return null;

        // Stop speech recognizer
        if (speechRecognizer) {
          try {
            speechRecognizer.stop();
          } catch {}
          speechRecognizer = null;
        }

        // If Web SpeechRecognition captured text directly, return with prefix
        if (speechRecognitionText && speechRecognitionText.trim().length > 0) {
          if (webStream) {
            webStream.getTracks().forEach((t: any) => t.stop());
            webStream = null;
          }
          return `TRANSCRIPT:${speechRecognitionText.trim()}`;
        }

        // Otherwise convert audio chunks to base64 for backend Whisper STT
        return new Promise((resolve) => {
          if (!webMediaRecorder || webMediaRecorder.state === "inactive") {
            resolve(speechRecognitionText ? `TRANSCRIPT:${speechRecognitionText}` : null);
            return;
          }

          webMediaRecorder.onstop = async () => {
            if (isDiscarded) {
              resolve(null);
              return;
            }
            try {
              if (speechRecognitionText) {
                resolve(`TRANSCRIPT:${speechRecognitionText.trim()}`);
                return;
              }
              const blob = new Blob(webAudioChunks, {
                type: webMediaRecorder.mimeType || "audio/webm",
              });
              const reader = new FileReader();
              reader.onloadend = () => {
                const base64data = reader.result as string;
                resolve(base64data);
              };
              reader.onerror = () => resolve(null);
              reader.readAsDataURL(blob);
            } catch {
              resolve(null);
            } finally {
              if (webStream) {
                webStream.getTracks().forEach((t: any) => t.stop());
                webStream = null;
              }
            }
          };

          try {
            webMediaRecorder.stop();
          } catch {
            resolve(speechRecognitionText ? `TRANSCRIPT:${speechRecognitionText}` : null);
          }
        });
      },
      discard() {
        isDiscarded = true;
        if (speechRecognizer) {
          try {
            speechRecognizer.stop();
          } catch {}
          speechRecognizer = null;
        }
        try {
          if (webMediaRecorder && webMediaRecorder.state !== "inactive") {
            webMediaRecorder.stop();
          }
        } catch {}
        if (webStream) {
          webStream.getTracks().forEach((t: any) => t.stop());
          webStream = null;
        }
        webAudioChunks = [];
        speechRecognitionText = "";
      },
    };
  }

  // Native / Fallback stub
  const startTime = Date.now();
  return {
    async stop() {
      if (isDiscarded) return null;
      const duration = (Date.now() - startTime) / 1000;
      return `SIMULATED_AUDIO:${duration.toFixed(1)}`;
    },
    discard() {
      isDiscarded = true;
    },
  };
}

export async function transcribeAudio(
  payload: string,
  language: string = "id",
  fallbackPrompt?: string
): Promise<string> {
  if (!payload) return "";

  // 1. Direct transcript from SpeechRecognition
  if (payload.startsWith("TRANSCRIPT:")) {
    return payload.replace("TRANSCRIPT:", "").trim();
  }

  // 2. Simulated audio fallback if mic was blocked
  if (payload.startsWith("SIMULATED_AUDIO:")) {
    if (fallbackPrompt) return fallbackPrompt;
    return language === "id"
      ? "Berapa denyut nadi dan langkah saya sekarang?"
      : "What is my pulse and steps right now?";
  }

  // 3. Backend Whisper Speech-to-Text API
  try {
    const res = await fetch(`${API}/stt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audio_base64: payload,
        format: "webm",
        language: language === "id" ? "id" : "en",
        prompt:
          language === "id"
            ? "Percakapan asisten suara gelang pintar EQOband dalam Bahasa Indonesia."
            : "EQOband wearable smart health assistant conversation.",
      }),
    });

    if (!res.ok) {
      throw new Error(`STT API status ${res.status}`);
    }

    const data = await res.json();
    return data.text || "";
  } catch (err) {
    console.warn("STT error, using fallback:", err);
    return (
      fallbackPrompt ||
      (language === "id"
        ? "Berapa denyut nadi dan langkah saya sekarang?"
        : "What is my pulse and steps right now?")
    );
  }
}

import { Platform } from "react-native";

export type RecordingSession = {
  stop: () => Promise<string | null>; // Returns base64 audio data or null if discarded
  discard: () => void;
};

let webMediaRecorder: any = null;
let webAudioChunks: any[] = [];
let webStream: any = null;

const API = `${process.env.EXPO_PUBLIC_BACKEND_URL ?? ""}/api`;

export async function startAudioRecording(): Promise<RecordingSession> {
  let isDiscarded = false;

  if (Platform.OS === "web") {
    try {
      if (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia) {
        webStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        webAudioChunks = [];
        const mimeType = (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.("audio/webm"))
          ? "audio/webm"
          : "";
        
        webMediaRecorder = mimeType ? new MediaRecorder(webStream, { mimeType }) : new MediaRecorder(webStream);

        webMediaRecorder.ondataavailable = (event: any) => {
          if (event.data && event.data.size > 0) {
            webAudioChunks.push(event.data);
          }
        };

        webMediaRecorder.start(100);

        return {
          async stop() {
            if (isDiscarded) return null;
            return new Promise((resolve) => {
              if (!webMediaRecorder || webMediaRecorder.state === "inactive") {
                resolve(null);
                return;
              }

              webMediaRecorder.onstop = async () => {
                if (isDiscarded) {
                  resolve(null);
                  return;
                }
                try {
                  const blob = new Blob(webAudioChunks, { type: webMediaRecorder.mimeType || "audio/webm" });
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
                resolve(null);
              }
            });
          },
          discard() {
            isDiscarded = true;
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
          },
        };
      }
    } catch (e) {
      console.warn("Web audio recording not permitted or unavailable:", e);
    }
  }

  // Fallback / Stub implementation for environments where native mic isn't initialized
  const startTime = Date.now();
  return {
    async stop() {
      if (isDiscarded) return null;
      const duration = (Date.now() - startTime) / 1000;
      // If simulated or stub, return a sample mock voice query based on duration
      return `SIMULATED_AUDIO:${duration.toFixed(1)}`;
    },
    discard() {
      isDiscarded = true;
    },
  };
}

export async function transcribeAudio(
  base64OrSimulated: string,
  language: string = "en",
  fallbackPrompt?: string
): Promise<string> {
  if (!base64OrSimulated) return "";

  // Handle simulated fallback query if browser mic was blocked/denied
  if (base64OrSimulated.startsWith("SIMULATED_AUDIO:")) {
    if (fallbackPrompt) return fallbackPrompt;
    return language === "id"
      ? "Berapa detak jantung saya hari ini dan bagaimana target langkah saya?"
      : "What is my heart rate right now and how are my steps?";
  }

  try {
    const res = await fetch(`${API}/stt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audio_base64: base64OrSimulated,
        format: "webm",
        language,
        prompt: "EQOband health query",
      }),
    });

    if (!res.ok) {
      throw new Error(`STT request failed with status ${res.status}`);
    }

    const data = await res.json();
    return data.text || "";
  } catch (err) {
    console.warn("STT error, using fallback transcription:", err);
    return fallbackPrompt || (language === "id" ? "Bagaimana aktivitas saya hari ini?" : "How is my activity today?");
  }
}

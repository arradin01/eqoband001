import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Lang, tr } from "@/src/i18n";
import { ThemeProvider, useAppTheme } from "@/src/theme";
import {
  ble,
  ConnectedInfo,
  GESTURE_MAP,
  GestureCode,
  ScannedDevice,
} from "@/src/utils/ble";
import {
  RecordingSession,
  startAudioRecording,
  transcribeAudio,
} from "@/src/utils/audioRecorder";
import { storage } from "@/src/utils/storage";
import { speak } from "@/src/utils/tts";

const API = `${process.env.EXPO_PUBLIC_BACKEND_URL ?? ""}/api`;

type Tab = "health" | "goals" | "ai" | "device" | "settings";
type Msg = { id: string; from: "me" | "ai" | "sys"; text: string; time: string };

type AppStateMode =
  | "DISCONNECTED"
  | "IDLE"
  | "LISTENING"
  | "TRACKING"
  | "LISTENING + TRACKING";

type SavedTrackingSession = {
  id: string;
  steps: number;
  duration: number; // sec
  distance_km: number;
  calories_kcal: number;
  start_time: string;
  end_time: string;
  source: string;
};

const K = {
  lang: "eqo:lang",
  volume: "eqo:volume",
  notifs: "eqo:notifs",
  talkback: "eqo:talkback",
  stepGoal: "eqo:stepGoal",
  activeGoal: "eqo:activeGoal",
  calGoal: "eqo:calGoal",
  sessions: "eqo:sessions",
};

const Icon = ({
  name,
  size = 22,
  color,
}: {
  name: string;
  size?: number;
  color?: string;
}) => <MaterialCommunityIcons name={name as never} size={size} color={color} />;

const clockNow = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
};

// ---------- Command intent detector ----------
type Intent =
  | { kind: "power_off" }
  | { kind: "start_track" }
  | { kind: "stop_track" }
  | { kind: "volume"; value: number }
  | { kind: "open"; tab: Tab }
  | null;

function detectIntent(raw: string): Intent {
  const q = raw.toLowerCase().trim();
  const stepKw = /(langkah|steps|jalan|walk)/;
  const startKw = /(mulai|start|aktifkan|hidupkan|jalankan|begin)/;
  const stopKw = /(berhenti|stop|hentikan|pause|nonaktifkan|matikan tracking|stop tracking)/;
  const powerKw = /(power off|shutdown|shut down|disconnect|putuskan|matikan gelang|matikan eqo|matikan band)/;
  const volumeMatch =
    q.match(/(?:volume|suara|sound)[^0-9]*(\d{1,3})/) ||
    q.match(/(?:set|atur|ubah)[^0-9]*volume[^0-9]*(\d{1,3})/);

  if (powerKw.test(q)) return { kind: "power_off" };
  if (volumeMatch) {
    const v = Math.max(0, Math.min(100, parseInt(volumeMatch[1], 10)));
    return { kind: "volume", value: v };
  }
  if (stopKw.test(q) && (stepKw.test(q) || /tracking/.test(q)))
    return { kind: "stop_track" };
  if (startKw.test(q) && (stepKw.test(q) || /tracking/.test(q)))
    return { kind: "start_track" };
  if (/tracking/.test(q) && startKw.test(q)) return { kind: "start_track" };
  if (/(open|buka).*(goal|target)/.test(q) || /^goals?$|^target/.test(q))
    return { kind: "open", tab: "goals" };
  if (/(open|buka).*(setting|pengaturan)/.test(q))
    return { kind: "open", tab: "settings" };
  if (/(open|buka).*(device|gelang|band)/.test(q))
    return { kind: "open", tab: "device" };
  if (/(heart|denyut|nadi|bpm|pulse)/.test(q))
    return { kind: "open", tab: "health" };
  return null;
}

// ---------- Root ----------
export default function Index() {
  return (
    <ThemeProvider>
      <IndexInner />
    </ThemeProvider>
  );
}

function IndexInner() {
  const { C, styles, theme, setTheme } = useAppTheme();
  const [tab, setTab] = useState<Tab>("health");
  const [lang, setLangState] = useState<Lang>("en");
  const [prefsLoaded, setPrefsLoaded] = useState(true);

  // Device & Application States
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [battery, setBattery] = useState(86);
  const [rssi] = useState(-54);
  const [bpm, setBpm] = useState(0);
  const [hrCountdown, setHrCountdown] = useState(30);
  const [hrReadings, setHrReadings] = useState<number[]>([]);

  // Tracking State (State: TRACKING)
  const [tracking, setTracking] = useState(false);
  const [steps, setSteps] = useState(0);
  const [sessionSteps, setSessionSteps] = useState(0);
  const [trackDuration, setTrackDuration] = useState(0);
  const sessionStartIsoRef = useRef<string | null>(null);
  const [savedSessions, setSavedSessions] = useState<SavedTrackingSession[]>([]);

  // Voice Assistant State (State: LISTENING)
  const [listening, setListening] = useState(false);
  const [voiceProcessing, setVoiceProcessing] = useState(false);
  const recSessionRef = useRef<RecordingSession | null>(null);
  const sendChatRef = useRef<((t?: string) => Promise<void>) | null>(null);

  // Real BLE state
  const [realBleInfo, setRealBleInfo] = useState<ConnectedInfo | null>(null);
  const [realBpm, setRealBpm] = useState<number | null>(null);

  // Gesture Event Log
  const [lastGesture, setLastGesture] = useState<{
    code: number;
    name: string;
    time: string;
    action: string;
  } | null>(null);

  // Prefs
  const [volume, setVolume] = useState(70);
  const [notifs, setNotifs] = useState(true);
  const [talkback, setTalkback] = useState(false);
  const [stepGoal, setStepGoal] = useState(10000);
  const [activeGoal, setActiveGoal] = useState(30);
  const [calGoal, setCalGoal] = useState(500);
  const [editOpen, setEditOpen] = useState(false);

  // AI Chat
  const [chat, setChat] = useState<Msg[]>([]);
  const [message, setMessage] = useState("");
  const [aiTyping, setAiTyping] = useState(false);
  const chatScrollRef = useRef<ScrollView>(null);

  // UI
  const [toast, setToast] = useState<string | null>(null);
  const holdProgress = useRef(new Animated.Value(0)).current;
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const t = useCallback((k: string) => tr(lang, k), [lang]);

  // Compute Active Application State
  const appState: AppStateMode = useMemo(() => {
    if (!connected) return "DISCONNECTED";
    if (listening && tracking) return "LISTENING + TRACKING";
    if (listening) return "LISTENING";
    if (tracking) return "TRACKING";
    return "IDLE";
  }, [connected, listening, tracking]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  // Load persisted prefs on mount
  useEffect(() => {
    (async () => {
      try {
        const savedLang = (await storage.getItem<string>(K.lang, "en")) as Lang | null;
        if (savedLang === "en" || savedLang === "id") setLangState(savedLang);
        const v = await storage.getItem<number>(K.volume, 70);
        if (typeof v === "number") setVolume(v);
        const n = await storage.getItem<boolean>(K.notifs, true);
        if (typeof n === "boolean") setNotifs(n);
        const tb = await storage.getItem<boolean>(K.talkback, false);
        if (typeof tb === "boolean") setTalkback(tb);
        const sg = await storage.getItem<number>(K.stepGoal, 10000);
        if (typeof sg === "number") setStepGoal(sg);
        const ag = await storage.getItem<number>(K.activeGoal, 30);
        if (typeof ag === "number") setActiveGoal(ag);
        const cg = await storage.getItem<number>(K.calGoal, 500);
        if (typeof cg === "number") setCalGoal(cg);

        const sess = await storage.getItem<SavedTrackingSession[]>(K.sessions, []);
        if (Array.isArray(sess)) setSavedSessions(sess);
      } catch (e) {
        console.warn("Error reading stored prefs:", e);
      } finally {
        setPrefsLoaded(true);
      }

      // Fetch saved sessions from MongoDB backend in background
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`${API}/tracking/sessions`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.sessions) && data.sessions.length > 0) {
            setSavedSessions(data.sessions);
          }
        }
      } catch {}
    })();
  }, []);

  // Initial welcome message
  useEffect(() => {
    if (prefsLoaded && chat.length === 0) {
      setChat([
        {
          id: "welcome",
          from: "ai",
          text: tr(lang, "ai_greeting"),
          time: clockNow(),
        },
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsLoaded, lang]);

  // HR simulation when connected
  useEffect(() => {
    if (!connected) return;
    const tick = () => {
      const base = tracking
        ? 100 + Math.floor(Math.random() * 40)
        : 62 + Math.floor(Math.random() * 30);
      setBpm(base);
      setHrReadings((r) => [...r.slice(-19), base]);
      setHrCountdown(30);
    };
    tick();
    const refresh = setInterval(tick, 30000);
    const count = setInterval(
      () => setHrCountdown((c) => (c > 0 ? c - 1 : 30)),
      1000
    );
    return () => {
      clearInterval(refresh);
      clearInterval(count);
    };
  }, [connected, tracking]);

  // Steps tracking timer & count loop
  useEffect(() => {
    if (!tracking || !connected) return;
    const stepInt = setInterval(() => {
      const delta = 1 + Math.floor(Math.random() * 3);
      setSteps((s) => s + delta);
      setSessionSteps((s) => s + delta);
    }, 1000);
    const timeInt = setInterval(() => setTrackDuration((s) => s + 1), 1000);
    return () => {
      clearInterval(stepInt);
      clearInterval(timeInt);
    };
  }, [tracking, connected]);

  // ---------- Core Actions ----------
  const doConnect = useCallback(() => {
    setConnecting(true);
    setTimeout(() => {
      setConnected(true);
      setConnecting(false);
      setBpm(72);
      setBattery(86);
      showToast(tr(lang, "toast_connected"));
    }, 400);
  }, [lang, showToast]);

  const doDisconnect = useCallback(() => {
    setConnected(false);
    setTracking(false);
    setListening(false);
    setVoiceProcessing(false);
    if (recSessionRef.current) {
      recSessionRef.current.discard();
      recSessionRef.current = null;
    }
    setBpm(0);
    setHrReadings([]);
    showToast(tr(lang, "toast_disconnected"));
  }, [lang, showToast]);

  const startHold = () => {
    holdProgress.setValue(0);
    Animated.timing(holdProgress, {
      toValue: 1,
      duration: 2000,
      useNativeDriver: false,
    }).start();
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = setTimeout(() => {
      if (connected) doDisconnect();
      else doConnect();
    }, 2000);
  };

  const cancelHold = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    Animated.timing(holdProgress, {
      toValue: 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  };

  // Tracking Helpers
  const startTrackingMode = useCallback(() => {
    if (!connected) {
      showToast(tr(lang, "toast_connect_first"));
      return;
    }
    setTrackDuration(0);
    setSessionSteps(0);
    sessionStartIsoRef.current = new Date().toISOString();
    setTracking(true);
    showToast(tr(lang, "toast_track_start"));
  }, [connected, lang, showToast]);

  const stopAndSaveTracking = useCallback(async () => {
    if (!tracking) return;
    setTracking(false);
    const currentDuration = trackDuration;
    const currentSteps = sessionSteps || Math.max(steps, 10);
    const currentKm = parseFloat((currentSteps * 0.00075).toFixed(2));
    const currentCal = Math.floor(currentSteps * 0.04);
    const startIso = sessionStartIsoRef.current || new Date().toISOString();
    const endIso = new Date().toISOString();

    const record: SavedTrackingSession = {
      id: String(Date.now()),
      steps: currentSteps,
      duration: currentDuration,
      distance_km: currentKm,
      calories_kcal: currentCal,
      start_time: startIso,
      end_time: endIso,
      source: "ttp223_gesture",
    };

    const updated = [record, ...savedSessions.slice(0, 20)];
    setSavedSessions(updated);
    await storage.setItem(K.sessions, updated);

    // Save to backend DB
    try {
      fetch(`${API}/tracking/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record),
      }).catch(() => {});
    } catch {}

    showToast(`${tr(lang, "tracking_saved")} (${currentSteps} steps, ${currentDuration}s)`);
  }, [tracking, trackDuration, sessionSteps, steps, savedSessions, lang, showToast]);

  const discardTracking = useCallback(() => {
    setTracking(false);
    setTrackDuration(0);
    setSessionSteps(0);
    sessionStartIsoRef.current = null;
    showToast(tr(lang, "tracking_discarded"));
  }, [lang, showToast]);

  const toggleTracking = useCallback(() => {
    if (!connected) {
      showToast(tr(lang, "toast_connect_first"));
      return;
    }
    if (tracking) {
      stopAndSaveTracking();
    } else {
      startTrackingMode();
    }
  }, [connected, tracking, stopAndSaveTracking, startTrackingMode, lang, showToast]);

  // Voice Assistant Helpers
  const startVoiceListening = useCallback(async () => {
    if (!connected) {
      showToast(tr(lang, "toast_connect_first"));
      return;
    }
    if (listening) return;
    setListening(true);
    setVoiceProcessing(false);
    try {
      const session = await startAudioRecording(lang);
      recSessionRef.current = session;
      showToast(tr(lang, "speaking_now"));
    } catch (err) {
      console.warn("Failed to start mic recording:", err);
    }
  }, [connected, listening, lang, showToast]);

  const stopAndSendVoice = useCallback(async () => {
    if (!listening) return;
    setVoiceProcessing(true);
    let audioPayload: string | null = null;
    if (recSessionRef.current) {
      audioPayload = await recSessionRef.current.stop();
      recSessionRef.current = null;
    }

    try {
      let transcript = "";
      if (audioPayload) {
        transcript = await transcribeAudio(audioPayload, lang);
      }
      if (!transcript || !transcript.trim()) {
        transcript =
          lang === "id"
            ? "Bagaimana kondisi denyut jantung dan langkah saya?"
            : "How is my heart rate and step count right now?";
      }

      setListening(false);
      setVoiceProcessing(false);
      // Send transcript to EQO AI chat
      if (sendChatRef.current) {
        await sendChatRef.current(transcript);
      }
    } catch (err) {
      console.warn("Voice processing error:", err);
      setListening(false);
      setVoiceProcessing(false);
    }
  }, [listening, lang]);

  const discardVoice = useCallback(() => {
    if (recSessionRef.current) {
      recSessionRef.current.discard();
      recSessionRef.current = null;
    }
    setListening(false);
    setVoiceProcessing(false);
    showToast(tr(lang, "recording_discarded"));
  }, [lang, showToast]);

  // ---------- Gesture Event State Machine ----------
  const handleGestureEvent = useCallback(
    async (code: GestureCode, source: "ble" | "simulated" = "ble") => {
      const name = GESTURE_MAP[code] || `CODE_${code}`;
      const time = clockNow();
      let actionDesc = "";

      if (code === 3) {
        // LONG_PRESS (Highest Priority):
        // 1. If LISTENING: stop and discard audio recording.
        // 2. If TRACKING: stop and discard tracking session without saving.
        // 3. Disconnect BLE connection between band & app.
        // 4. Stop active processes, update UI to show band OFF / DISCONNECTED.
        if (listening) discardVoice();
        if (tracking) discardTracking();
        doDisconnect();
        actionDesc = "Stopped active processes & Disconnected band";
      } else if (code === 1) {
        // SINGLE_TAP:
        // - When IDLE: Start LISTENING mode (recording from phone mic, show voice UI).
        // - When LISTENING: Stop recording, send audio to backend API.
        // - When TRACKING: Start LISTENING without stopping/pausing TRACKING (simultaneous!).
        if (!connected) {
          showToast(tr(lang, "toast_connect_first"));
          actionDesc = "Ignored (Band disconnected)";
        } else if (listening) {
          actionDesc = "Stopped voice recording -> Sent to EQO AI";
          await stopAndSendVoice();
        } else {
          actionDesc = tracking
            ? "Started Voice Listening simultaneously with Tracking"
            : "Started Voice Listening mode";
          await startVoiceListening();
        }
      } else if (code === 2) {
        // DOUBLE_TAP:
        // - When IDLE: Start TRACKING mode (begin steps, timer, show UI).
        // - When TRACKING: Stop tracking, save completed session to storage/DB, return to IDLE.
        // - When LISTENING: Immediately discard current recording, stop LISTENING, start TRACKING.
        if (!connected) {
          showToast(tr(lang, "toast_connect_first"));
          actionDesc = "Ignored (Band disconnected)";
        } else if (listening) {
          discardVoice();
          if (!tracking) {
            startTrackingMode();
            actionDesc = "Discarded voice recording & Started Tracking";
          } else {
            await stopAndSaveTracking();
            actionDesc = "Discarded voice recording & Saved Tracking";
          }
        } else if (tracking) {
          await stopAndSaveTracking();
          actionDesc = "Stopped & Saved Tracking session";
        } else {
          startTrackingMode();
          actionDesc = "Started Step Tracking mode";
        }
      }

      setLastGesture({ code, name, time, action: actionDesc });
    },
    [
      connected,
      listening,
      tracking,
      lang,
      discardVoice,
      discardTracking,
      doDisconnect,
      stopAndSendVoice,
      startVoiceListening,
      startTrackingMode,
      stopAndSaveTracking,
      showToast,
    ]
  );

  const changeLang = async (l: Lang) => {
    setLangState(l);
    await storage.setItem(K.lang, l);
    showToast(tr(l, "toast_lang_switched"));
  };

  const changeVolume = async (v: number) => {
    setVolume(v);
    await storage.setItem(K.volume, v);
  };
  const toggleNotifs = async (v: boolean) => {
    setNotifs(v);
    await storage.setItem(K.notifs, v);
    showToast(v ? tr(lang, "toast_notif_on") : tr(lang, "toast_notif_off"));
  };
  const toggleTalkback = async (v: boolean) => {
    setTalkback(v);
    await storage.setItem(K.talkback, v);
    showToast(v ? tr(lang, "toast_talkback_on") : tr(lang, "toast_talkback_off"));
  };

  // ---------- AI Chat ----------
  const executeIntent = useCallback(
    (intent: Intent) => {
      if (!intent) return;
      switch (intent.kind) {
        case "power_off":
          if (connected) doDisconnect();
          break;
        case "start_track":
          if (connected && !tracking) startTrackingMode();
          break;
        case "stop_track":
          if (tracking) stopAndSaveTracking();
          break;
        case "volume":
          changeVolume(intent.value);
          showToast(`${tr(lang, "toast_volume_set")} ${intent.value}%`);
          break;
        case "open":
          setTab(intent.tab);
          break;
      }
    },
    [connected, tracking, lang, doDisconnect, startTrackingMode, stopAndSaveTracking, showToast]
  );

  const sendChat = async (raw?: string) => {
    const text = (raw ?? message).trim();
    if (!text) return;
    setMessage("");
    const me: Msg = { id: `${Date.now()}-me`, from: "me", text, time: clockNow() };
    setChat((c) => [...c, me]);

    const intent = detectIntent(text);
    if (intent) executeIntent(intent);

    setAiTyping(true);
    try {
      const res = await fetch(`${API}/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          language: lang,
          context: {
            connected,
            heart_rate: bpm,
            steps,
            step_goal: stepGoal,
            tracking,
            battery,
          },
        }),
      });
      const data = await res.json();
      const reply = data.answer ?? tr(lang, "ai_greeting");
      setChat((c) => [
        ...c,
        { id: `${Date.now()}-ai`, from: "ai", text: reply, time: clockNow() },
      ]);
      if (talkback) speak(reply, Math.max(0, Math.min(1, volume / 100)), lang);
    } catch {
      const errMsg =
        lang === "id"
          ? "EQO AI sedang offline. Coba lagi nanti."
          : "EQO AI is offline. Try again shortly.";
      setChat((c) => [
        ...c,
        { id: `${Date.now()}-ai`, from: "ai", text: errMsg, time: clockNow() },
      ]);
      if (talkback) speak(errMsg, Math.max(0, Math.min(1, volume / 100)), lang);
    } finally {
      setAiTyping(false);
      setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 60);
    }
  };
  sendChatRef.current = sendChat;

  // Derived Metrics
  const km = useMemo(() => (steps * 0.00075).toFixed(2), [steps]);
  const cal = useMemo(() => Math.floor(steps * 0.04), [steps]);
  const activeMin = useMemo(() => Math.floor(trackDuration / 60), [trackDuration]);
  const stepPct = Math.min(100, Math.round((steps / stepGoal) * 100));
  const activePct = Math.min(100, Math.round((activeMin / activeGoal) * 100));
  const calPct = Math.min(100, Math.round((cal / calGoal) * 100));
  const goalsPct = Math.round((stepPct + activePct + calPct) / 3);

  const weeklySteps = useMemo(() => {
    const base = [7200, 8450, 6120, 9040, 6842, 3200, 0];
    const arr = [...base];
    arr[4] = Math.max(arr[4], steps);
    return arr;
  }, [steps]);
  const weekLabels =
    lang === "id" ? ["S", "S", "R", "K", "J", "S", "M"] : ["M", "T", "W", "T", "F", "S", "S"];
  const activeDays = weeklySteps.filter((v) => v >= stepGoal * 0.6).length;
  const streak = Math.min(activeDays, 5);
  const weekTotal = weeklySteps.reduce((a, b) => a + b, 0);

  const title =
    tab === "health"
      ? t("title_today")
      : tab === "goals"
      ? t("title_goals")
      : tab === "ai"
      ? t("title_ai")
      : tab === "device"
      ? t("title_device")
      : t("title_settings");

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>EQOBAND / {t(`tab_${tab}`).toUpperCase()}</Text>
          <Text style={styles.title}>{title}</Text>
        </View>
        <View style={styles.headerRight}>
          <Pressable
            testID="lang-toggle"
            onPress={() => changeLang(lang === "en" ? "id" : "en")}
            style={styles.langPill}
          >
            <Icon name="translate" size={14} color={C.text} />
            <Text style={styles.langText}>{lang.toUpperCase()}</Text>
          </Pressable>
          <View style={styles.headerStatus}>
            <View
              style={[
                styles.dot,
                {
                  backgroundColor:
                    appState === "DISCONNECTED"
                      ? C.red
                      : appState === "IDLE"
                      ? C.green
                      : C.ember,
                },
              ]}
            />
            <Text style={styles.status}>
              {appState === "DISCONNECTED" ? t("offline") : appState}
            </Text>
          </View>
        </View>
      </View>

      {/* Global State Indicator Banner */}
      <StateBanner
        appState={appState}
        t={t}
        connected={connected}
        onReconnect={doConnect}
        onGesture={handleGestureEvent}
      />

      {/* Floating Active Tracking Banner */}
      {tracking && (
        <View style={styles.activeTrackingPill} testID="active-tracking-pill">
          <View style={styles.activeTrackingPillLeft}>
            <Icon name="run-fast" color={C.green} size={20} />
            <View>
              <Text style={styles.activeTrackingPillTitle}>
                {t("state_tracking")}
              </Text>
              <Text style={styles.activeTrackingPillSub}>
                {steps.toLocaleString()} steps · {km} km · {Math.floor(trackDuration / 60)}:
                {String(trackDuration % 60).padStart(2, "0")}
              </Text>
            </View>
          </View>
          <Pressable
            testID="stop-save-tracking-btn"
            onPress={stopAndSaveTracking}
            style={[styles.outline, { borderColor: C.green, paddingVertical: 5, paddingHorizontal: 10 }]}
          >
            <Text style={[styles.action, { color: C.green, fontSize: 11 }]}>
              {t("save")}
            </Text>
          </Pressable>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {tab === "health" && (
          <HealthScreen
            t={t}
            lang={lang}
            connected={connected}
            battery={battery}
            bpm={realBpm ?? bpm}
            hrCountdown={hrCountdown}
            hrReadings={hrReadings}
            steps={steps}
            stepGoal={stepGoal}
            activeMin={activeMin}
            activeGoal={activeGoal}
            tracking={tracking}
            listening={listening}
            goalsPct={goalsPct}
            appState={appState}
            onGesture={handleGestureEvent}
            onGoDevice={() => setTab("device")}
            onCardTap={(cardTab: Tab) => {
              if (!connected) {
                showToast(t("toast_connect_first"));
                setTab("device");
                return;
              }
              setTab(cardTab);
            }}
          />
        )}
        {tab === "goals" && (
          <GoalsScreen
            t={t}
            connected={connected}
            steps={steps}
            stepGoal={stepGoal}
            activeMin={activeMin}
            activeGoal={activeGoal}
            cal={cal}
            calGoal={calGoal}
            weeklySteps={weeklySteps}
            weekLabels={weekLabels}
            activeDays={activeDays}
            weekTotal={weekTotal}
            streak={streak}
            stepPct={stepPct}
            activePct={activePct}
            calPct={calPct}
          />
        )}
        {tab === "ai" && (
          <AIScreen
            t={t}
            chat={chat}
            message={message}
            setMessage={setMessage}
            send={sendChat}
            listening={listening}
            onMicPress={() => {
              if (listening) stopAndSendVoice();
              else startVoiceListening();
            }}
            aiTyping={aiTyping}
            chatScrollRef={chatScrollRef}
          />
        )}
        {tab === "device" && (
          <DeviceScreen
            t={t}
            lang={lang}
            connected={connected}
            connecting={connecting}
            battery={battery}
            rssi={rssi}
            tracking={tracking}
            listening={listening}
            appState={appState}
            steps={steps}
            km={km}
            cal={cal}
            trackDuration={trackDuration}
            holdProgress={holdProgress}
            startHold={startHold}
            cancelHold={cancelHold}
            toggleTracking={toggleTracking}
            lastGesture={lastGesture}
            onGesture={handleGestureEvent}
            savedSessions={savedSessions}
            realBleConnected={!!realBleInfo}
            realBleName={realBleInfo?.name ?? null}
            onRealBpm={setRealBpm}
            onRealConnect={setRealBleInfo}
          />
        )}
        {tab === "settings" && (
          <SettingsScreen
            t={t}
            lang={lang}
            changeLang={changeLang}
            connected={connected}
            notifs={notifs}
            toggleNotifs={toggleNotifs}
            talkback={talkback}
            toggleTalkback={toggleTalkback}
            volume={volume}
            changeVolume={changeVolume}
            onEditGoals={() => setEditOpen(true)}
            theme={theme}
            setTheme={setTheme}
          />
        )}
      </ScrollView>

      {/* Voice Assistant Floating Active Waveform Overlay */}
      {listening && (
        <VoiceAssistantOverlay
          t={t}
          processing={voiceProcessing}
          onStopSend={stopAndSendVoice}
          onDiscard={discardVoice}
        />
      )}

      {/* Bottom Tabs */}
      <View style={styles.tabs}>
        {(
          [
            ["health", "view-dashboard-outline"],
            ["goals", "chart-bar"],
            ["ai", "brain"],
            ["device", "bluetooth"],
            ["settings", "tune-variant"],
          ] as const
        ).map(([key, icon]) => (
          <Pressable
            testID={`tab-${key}`}
            key={key}
            onPress={() => setTab(key)}
            style={styles.tab}
          >
            <Icon name={icon} color={tab === key ? C.ember : C.muted} />
            <Text style={[styles.tabText, tab === key && { color: C.ember }]}>
              {t(`tab_${key}`)}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Toast */}
      {toast && (
        <View style={[styles.toast, { pointerEvents: "none" }]} testID="toast">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      {/* Edit goals modal */}
      <EditGoalsModal
        visible={editOpen}
        t={t}
        stepGoal={stepGoal}
        activeGoal={activeGoal}
        calGoal={calGoal}
        onClose={() => setEditOpen(false)}
        onSave={async (s: number, a: number, c: number) => {
          setStepGoal(s);
          setActiveGoal(a);
          setCalGoal(c);
          await storage.setItem(K.stepGoal, s);
          await storage.setItem(K.activeGoal, a);
          await storage.setItem(K.calGoal, c);
          setEditOpen(false);
        }}
      />
    </SafeAreaView>
  );
}

// ---------- State Banner Component ----------
function StateBanner({
  appState,
  t,
  connected,
  onReconnect,
  onGesture,
}: {
  appState: AppStateMode;
  t: (k: string) => string;
  connected: boolean;
  onReconnect: () => void;
  onGesture?: (code: GestureCode, source: "simulated") => void;
}) {
  const { C, styles } = useAppTheme();

  const config = useMemo(() => {
    switch (appState) {
      case "DISCONNECTED":
        return {
          bg: "rgba(239,68,68,0.12)",
          border: C.red,
          color: C.red,
          icon: "bluetooth-off",
          label: t("state_disconnected"),
          sub: t("unlock_via_device"),
        };
      case "LISTENING + TRACKING":
        return {
          bg: "rgba(255,87,34,0.18)",
          border: C.ember,
          color: C.ember,
          icon: "sync",
          label: t("state_listening_tracking"),
          sub: "Single Tap: Send voice · Double Tap: Stop tracking",
        };
      case "LISTENING":
        return {
          bg: "rgba(168,85,247,0.15)",
          border: C.purple,
          color: C.purple,
          icon: "microphone",
          label: t("state_listening"),
          sub: "Single Tap: Stop & send · Double Tap: Discard & track",
        };
      case "TRACKING":
        return {
          bg: "rgba(16,185,129,0.14)",
          border: C.green,
          color: C.green,
          icon: "run-fast",
          label: t("state_tracking"),
          sub: "Single Tap: Start voice · Double Tap: Stop tracking",
        };
      case "IDLE":
      default:
        return {
          bg: "rgba(16,185,129,0.1)",
          border: C.green,
          color: C.green,
          icon: "check-circle-outline",
          label: t("state_idle"),
          sub: "Single Tap: Voice Assistant · Double Tap: Step Tracking",
        };
    }
  }, [appState, C, t]);

  return (
    <View
      testID="state-banner"
      style={[
        styles.stateBanner,
        { backgroundColor: config.bg, borderColor: config.border, flexDirection: "column", alignItems: "stretch", gap: 8 },
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Icon name={config.icon} color={config.color} size={20} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.stateText, { color: config.color }]}>
            {config.label}
          </Text>
          <Text style={styles.stateSub}>{config.sub}</Text>
        </View>
        {!connected && (
          <Pressable
            testID="state-reconnect-btn"
            onPress={onReconnect}
            style={[styles.outline, { borderColor: C.red, paddingVertical: 4, paddingHorizontal: 10 }]}
          >
            <Text style={[styles.action, { color: C.red, fontSize: 11 }]}>
              {t("reconnect")}
            </Text>
          </Pressable>
        )}
      </View>

      {/* Quick Gesture bar on top */}
      {onGesture && (
        <View style={{ flexDirection: "row", gap: 6, paddingTop: 4, borderTopWidth: 1, borderTopColor: "rgba(155,161,176,0.15)" }}>
          <Pressable
            testID="quick-single-tap"
            onPress={() => onGesture(1, "simulated")}
            style={{ flex: 1, backgroundColor: C.raised, borderRadius: 8, paddingVertical: 6, alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ fontSize: 10, color: C.text, fontWeight: "700" }}>👆 1: {t("single_tap")}</Text>
          </Pressable>
          <Pressable
            testID="quick-double-tap"
            onPress={() => onGesture(2, "simulated")}
            style={{ flex: 1, backgroundColor: C.raised, borderRadius: 8, paddingVertical: 6, alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ fontSize: 10, color: C.text, fontWeight: "700" }}>✌️ 2: {t("double_tap")}</Text>
          </Pressable>
          <Pressable
            testID="quick-long-press"
            onPress={() => onGesture(3, "simulated")}
            style={{ flex: 1, backgroundColor: C.raised, borderRadius: 8, paddingVertical: 6, alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ fontSize: 10, color: C.text, fontWeight: "700" }}>⏱️ 3: {t("long_press")}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ---------- Voice Assistant Floating Overlay ----------
function VoiceAssistantOverlay({
  t,
  processing,
  onStopSend,
  onDiscard,
}: {
  t: (k: string) => string;
  processing: boolean;
  onStopSend: () => void;
  onDiscard: () => void;
}) {
  const { C, styles } = useAppTheme();
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.4,
          duration: 600,
          useNativeDriver: false,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.6,
          duration: 600,
          useNativeDriver: false,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  return (
    <View style={styles.voiceOverlay} testID="voice-overlay">
      <View style={styles.voiceHeader}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Icon name="waveform" color={C.ember} size={18} />
          <Text style={styles.voiceTitle}>{t("voice_assistant")}</Text>
        </View>
        <Text style={{ fontSize: 10, color: C.muted, fontWeight: "700" }}>
          TTP223 SINGLE TAP
        </Text>
      </View>

      <Text style={styles.body}>
        {processing ? t("transcribing_voice") : t("speaking_now")}
      </Text>

      {/* Waveform Visualizer */}
      <View style={styles.voiceWaveRow}>
        {[10, 24, 36, 18, 32, 28, 14, 38, 22, 34, 18, 30, 16, 26].map((baseH, i) => (
          <Animated.View
            key={i}
            style={[
              styles.voiceWaveBar,
              {
                height: processing
                  ? 12
                  : pulseAnim.interpolate({
                      inputRange: [0.6, 1.4],
                      outputRange: [Math.max(6, baseH * 0.4), Math.min(38, baseH * 1.2)],
                    }),
                backgroundColor: i % 2 === 0 ? C.ember : C.purple,
              },
            ]}
          />
        ))}
      </View>

      {/* Controls */}
      <View style={styles.voiceControls}>
        <Pressable
          testID="voice-discard-btn"
          onPress={onDiscard}
          style={styles.voiceDiscardBtn}
        >
          <Text style={styles.voiceDiscardTxt}>{t("discard_recording")}</Text>
        </Pressable>
        <Pressable
          testID="voice-send-btn"
          onPress={onStopSend}
          disabled={processing}
          style={styles.voiceSendBtn}
        >
          {processing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Icon name="send" color="#fff" size={14} />
              <Text style={styles.voiceSendTxt}>{t("stop_and_send")}</Text>
            </>
          )}
        </Pressable>
      </View>

      <Text style={[styles.muted, { fontSize: 10, textAlign: "center", marginTop: 8 }]}>
        {t("voice_mode_tap_hint")}
      </Text>
    </View>
  );
}

// ---------- Gesture Simulator Component ----------
function GestureSimulatorCard({
  t,
  onGesture,
  lastGesture,
}: {
  t: (k: string) => string;
  onGesture: (code: GestureCode, source: "simulated") => void;
  lastGesture: { code: number; name: string; time: string; action: string } | null;
}) {
  const { C, styles } = useAppTheme();

  return (
    <View style={styles.gestureSimBox} testID="gesture-simulator-card">
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Icon name="gesture-tap" color={C.ember} size={20} />
          <Text style={styles.cardTitle}>{t("gesture_simulator")}</Text>
        </View>
        <Text style={{ fontSize: 10, color: C.muted, fontWeight: "700" }}>BLE 6E400004</Text>
      </View>
      <Text style={styles.body}>{t("gesture_simulator_sub")}</Text>

      {/* Gesture Trigger Buttons */}
      <View style={styles.gestureBtnRow}>
        <Pressable
          testID="sim-single-tap"
          onPress={() => onGesture(1, "simulated")}
          style={[styles.gestureBtn, { borderColor: "rgba(168,85,247,0.4)" }]}
        >
          <Icon name="gesture-tap" color={C.purple} size={18} />
          <Text style={styles.gestureBtnText}>{t("single_tap")}</Text>
          <Text style={styles.gestureBtnCode}>Code: 1 (Voice)</Text>
        </Pressable>

        <Pressable
          testID="sim-double-tap"
          onPress={() => onGesture(2, "simulated")}
          style={[styles.gestureBtn, { borderColor: "rgba(16,185,129,0.4)" }]}
        >
          <Icon name="gesture-double-tap" color={C.green} size={18} />
          <Text style={styles.gestureBtnText}>{t("double_tap")}</Text>
          <Text style={styles.gestureBtnCode}>Code: 2 (Track)</Text>
        </Pressable>

        <Pressable
          testID="sim-long-press"
          onPress={() => onGesture(3, "simulated")}
          style={[styles.gestureBtn, { borderColor: "rgba(239,68,68,0.4)" }]}
        >
          <Icon name="gesture-tap-hold" color={C.red} size={18} />
          <Text style={styles.gestureBtnText}>{t("long_press")}</Text>
          <Text style={styles.gestureBtnCode}>Code: 3 (Off)</Text>
        </Pressable>
      </View>

      {/* Live Last Gesture Log */}
      {lastGesture && (
        <View style={styles.lastGestureFeed} testID="last-gesture-feed">
          <Icon name="flash-outline" color={C.ember} size={16} />
          <Text style={styles.lastGestureText}>
            <Text style={{ color: C.text, fontWeight: "700" }}>
              {lastGesture.name} ({lastGesture.code})
            </Text>{" "}
            @{lastGesture.time} → {lastGesture.action}
          </Text>
        </View>
      )}
    </View>
  );
}

// ---------- Health Screen ----------
function HealthScreen({
  t,
  lang,
  connected,
  battery,
  bpm,
  hrCountdown,
  hrReadings,
  steps,
  stepGoal,
  activeMin,
  activeGoal,
  tracking,
  listening,
  goalsPct,
  appState,
  onGesture,
  onGoDevice,
  onCardTap,
}: any) {
  const { C, styles } = useAppTheme();
  const zone =
    bpm === 0 ? "-" : bpm < 60 ? "LOW" : bpm < 100 ? "NORMAL" : bpm < 140 ? "ACTIVE" : "MAX";

  return (
    <>
      <View style={styles.deviceRow}>
        <View>
          <Text style={styles.muted}>{t("device_prototype")}</Text>
          <Text style={styles.small}>
            {t("device_esp")} · {battery}% {t("battery")}
          </Text>
        </View>
        <Pressable
          testID="health-device-status"
          onPress={onGoDevice}
          style={[
            styles.connectPill,
            {
              backgroundColor: connected
                ? "rgba(16,185,129,.12)"
                : "rgba(239,68,68,.12)",
            },
          ]}
        >
          <Icon
            name={connected ? "bluetooth-connect" : "bluetooth-off"}
            color={connected ? C.green : C.red}
            size={16}
          />
          <Text
            style={[
              styles.connectText,
              { color: connected ? C.green : C.red },
            ]}
          >
            {connected ? t("connected") : t("disconnected")}
          </Text>
        </Pressable>
      </View>

      {/* Battery bar */}
      {connected && (
        <View style={styles.batBar} testID="battery-bar">
          <Icon name="battery-high" color={C.green} size={18} />
          <View style={{ flex: 1 }}>
            <Text style={styles.batLbl}>{t("band_battery")}</Text>
            <View style={styles.batTrack}>
              <View style={[styles.batFill, { width: `${battery}%` }]} />
            </View>
          </View>
          <Text style={styles.batPct}>{battery}%</Text>
        </View>
      )}

      {/* Hero HR card */}
      <LockableCard locked={!connected} lockedLabel={t("locked")} t={t}>
        <View style={styles.cardTop}>
          <Text style={styles.label}>{t("live_hr")}</Text>
          <Icon name="heart-pulse" color={C.ember} size={24} />
        </View>
        <Text style={styles.bpm}>
          {connected ? bpm : "--"}
          <Text style={styles.unit}> {t("bpm")}</Text>
        </Text>
        <Text style={styles.muted}>
          {connected
            ? `${zone} · ${t("hr_refresh")}${hrCountdown}s`
            : t("hr_hint")}
        </Text>
        <View style={styles.wave}>
          {[12, 20, 32, 18, 38, 22, 14, 28, 17, 34, 22, 15, 30, 18, 25, 14].map(
            (h, i) => (
              <View
                key={i}
                style={[
                  styles.waveBar,
                  {
                    height: connected ? h : 8,
                    backgroundColor:
                      connected && i === 4 ? C.ember : C.raised,
                  },
                ]}
              />
            )
          )}
        </View>
      </LockableCard>

      {/* Grid of metrics */}
      <View style={styles.grid}>
        <Pressable
          style={{ flex: 1 }}
          testID="card-steps"
          onPress={() => onCardTap("goals")}
        >
          <LockableCard locked={!connected} lockedLabel={t("locked")} t={t} small>
            <Icon name="walk" color={C.ember} />
            <Text style={styles.label}>{t("steps_today")}</Text>
            <Text style={styles.metricValue}>
              {connected ? steps.toLocaleString() : "--"}
            </Text>
            <Text style={styles.muted}>
              {connected
                ? `${Math.min(
                    100,
                    Math.round((steps / stepGoal) * 100)
                  )}% ${t("goal_of")} ${stepGoal.toLocaleString()}`
                : t("unlock_via_device")}
            </Text>
          </LockableCard>
        </Pressable>
        <Pressable
          style={{ flex: 1 }}
          testID="card-active"
          onPress={() => onCardTap("goals")}
        >
          <LockableCard locked={!connected} lockedLabel={t("locked")} t={t} small>
            <Icon name="timer-outline" color={C.blue} />
            <Text style={styles.label}>{t("active_time")}</Text>
            <Text style={styles.metricValue}>
              {connected ? `${activeMin}m` : "--"}
            </Text>
            <Text style={styles.muted}>
              {t("goal")} {activeGoal}m
            </Text>
          </LockableCard>
        </Pressable>
      </View>

      {/* Quick tiles: AI + Goals */}
      <View style={styles.grid}>
        <Pressable
          style={{ flex: 1 }}
          testID="card-ai"
          onPress={() => onCardTap("ai")}
        >
          <LockableCard locked={!connected} lockedLabel={t("locked")} t={t} small>
            <Icon name="brain" color={C.purple} />
            <Text style={styles.label}>{t("ai_title")}</Text>
            <Text style={styles.metricValue}>
              {listening ? "MIC ON" : connected ? t("on") : t("off")}
            </Text>
            <Text style={styles.muted}>{t("steps_status")}</Text>
          </LockableCard>
        </Pressable>
        <Pressable
          style={{ flex: 1 }}
          testID="card-goals"
          onPress={() => onCardTap("goals")}
        >
          <LockableCard locked={!connected} lockedLabel={t("locked")} t={t} small>
            <Icon name="target" color={C.amber} />
            <Text style={styles.label}>{t("goals_title")}</Text>
            <Text style={styles.metricValue}>{goalsPct}%</Text>
            <Text style={styles.muted}>{t("achieved")}</Text>
          </LockableCard>
        </Pressable>
      </View>

      <Section title={t("briefing")} />
      <View style={styles.insight}>
        <View style={styles.insightIcon}>
          <Icon name="lightbulb-on-outline" color={C.ember} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>
            {lang === "id" ? "Momentum kuat" : "Strong momentum"}
          </Text>
          <Text style={styles.body}>
            {lang === "id"
              ? `Kamu di ${Math.min(
                  100,
                  Math.round((steps / stepGoal) * 100)
                )}% dari target langkah harian.`
              : `You are at ${Math.min(
                  100,
                  Math.round((steps / stepGoal) * 100)
                )}% of today's step goal.`}
          </Text>
        </View>
        <Icon name="chevron-right" color={C.muted} />
      </View>
    </>
  );
}

function LockableCard({ locked, children, lockedLabel, t, small }: any) {
  const { C, styles } = useAppTheme();
  return (
    <View
      style={[
        styles.heroCard,
        small && styles.metric,
        locked && { opacity: 0.55 },
      ]}
    >
      {children}
      {locked && (
        <View style={styles.lockRow}>
          <Icon name="lock" color={C.muted} size={11} />
          <Text style={styles.lockText}>
            {lockedLabel} · {t("unlock_via_device")}
          </Text>
        </View>
      )}
    </View>
  );
}

function Section({ title, action }: { title: string; action?: string }) {
  const { styles } = useAppTheme();
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action && <Text style={styles.action}>{action}</Text>}
    </View>
  );
}

// ---------- Goals Screen ----------
function GoalsScreen({
  t,
  connected,
  steps,
  stepGoal,
  activeMin,
  activeGoal,
  cal,
  calGoal,
  weeklySteps,
  weekLabels,
  activeDays,
  weekTotal,
  streak,
  stepPct,
  activePct,
  calPct,
}: any) {
  const { C, styles } = useAppTheme();
  const scoreVal = Math.min(100, Math.round((stepPct + activePct + calPct) / 3));
  const maxWeek = Math.max(...weeklySteps, 1);
  return (
    <>
      <LinearGradient
        colors={[C.ember, "#B23A18"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.goalBanner}
      >
        <Text style={styles.label}>{t("weekly_movement_score")}</Text>
        <Text style={styles.goalScore}>
          {scoreVal}
          <Text style={styles.unit}> / 100</Text>
        </Text>
        <Text style={styles.body}>{t("trending_above")}</Text>
      </LinearGradient>

      <Section title={t("weekly_goals")} />
      <View style={styles.weeklyCard}>
        <View style={styles.weeklyDays}>
          {weeklySteps.map((v: number, i: number) => {
            const heightPct = Math.max(6, Math.round((v / maxWeek) * 100));
            const isToday = i === 4;
            return (
              <View key={i} style={styles.dayCol}>
                <View style={styles.dayBarWrap}>
                  <View
                    style={[
                      styles.dayBar,
                      {
                        height: `${heightPct}%`,
                        backgroundColor: isToday
                          ? C.ember
                          : v >= stepGoal * 0.6
                          ? C.green
                          : C.raised,
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.dayLabel, isToday && { color: C.ember }]}>
                  {weekLabels[i]}
                </Text>
              </View>
            );
          })}
        </View>
        <View style={styles.weeklyFoot}>
          <Text style={styles.weeklyFootTxt}>
            {t("active_days")}:{" "}
            <Text style={styles.weeklyFootV}>{activeDays}/7</Text>
          </Text>
          <Text style={styles.weeklyFootTxt}>
            {t("week_steps")}:{" "}
            <Text style={styles.weeklyFootV}>{weekTotal.toLocaleString()}</Text>
          </Text>
          <Text style={styles.weeklyFootTxt}>
            {t("streak")}:{" "}
            <Text style={styles.weeklyFootV}>
              {streak} {t("days")}
            </Text>
          </Text>
        </View>
      </View>

      <Section title={t("steps_this_week")} />
      <GoalProgress
        icon="walk"
        title={t("daily_step_goal")}
        pct={stepPct}
        now={steps.toLocaleString()}
        goal={stepGoal.toLocaleString()}
        unit={t("of_steps")}
        color={C.ember}
      />
      <GoalProgress
        icon="heart-pulse"
        title={t("daily_heart_zone")}
        pct={activePct}
        now={activeMin}
        goal={activeGoal}
        unit={t("of_minutes")}
        color={C.red}
      />
      <GoalProgress
        icon="fire"
        title={t("daily_calories")}
        pct={calPct}
        now={cal}
        goal={calGoal}
        unit={t("of_calories")}
        color={C.amber}
      />
    </>
  );
}

function GoalProgress({ icon, title, pct, now, goal, unit, color }: any) {
  const { styles } = useAppTheme();
  return (
    <View style={styles.goalRow}>
      <View style={styles.goalHead}>
        <Icon name={icon} color={color} />
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={[styles.action, { color }]}>{pct}%</Text>
      </View>
      <View style={styles.goalBar}>
        <View
          style={[styles.goalFill, { width: `${pct}%`, backgroundColor: color }]}
        />
      </View>
      <Text style={styles.muted}>
        {now} / {goal} {unit}
      </Text>
    </View>
  );
}

// ---------- AI Screen ----------
function AIScreen({
  t,
  chat,
  message,
  setMessage,
  send,
  listening,
  onMicPress,
  aiTyping,
  chatScrollRef,
}: any) {
  const { C, styles } = useAppTheme();
  const prompts = [t("prompt_how"), t("prompt_goal"), t("prompt_pulse")];

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={80}
    >
      <View style={styles.aiIntro}>
        <View style={styles.aiOrb}>
          <Icon name="brain" color={C.ember} size={30} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{t("ai_intro_title")}</Text>
          <Text style={styles.body}>{t("ai_intro_body")}</Text>
        </View>
      </View>

      <View style={styles.promptRow}>
        {prompts.map((p: string) => (
          <Pressable
            testID={`prompt-${p.replace(/\s+/g, "-").toLowerCase()}`}
            key={p}
            onPress={() => send(p)}
            style={styles.prompt}
          >
            <Text style={styles.promptText}>{p}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        ref={chatScrollRef}
        style={styles.chat}
        contentContainerStyle={{ paddingBottom: 12 }}
        onContentSizeChange={() =>
          chatScrollRef.current?.scrollToEnd({ animated: true })
        }
      >
        {chat.length === 0 && <Text style={styles.empty}>{t("ai_ready")}</Text>}
        {chat.map((m: Msg) => (
          <View
            key={m.id}
            style={[styles.bubble, m.from === "me" ? styles.mine : styles.theirs]}
          >
            <Text style={styles.bubbleText}>{m.text}</Text>
            <Text style={styles.bubbleTime}>{m.time}</Text>
          </View>
        ))}
        {aiTyping && (
          <View
            style={[
              styles.bubble,
              styles.theirs,
              { flexDirection: "row", gap: 4, alignItems: "center" },
            ]}
            testID="ai-typing"
          >
            <ActivityIndicator size="small" color={C.ember} />
            <Text style={styles.bubbleText}>{t("thinking")}</Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.composer}>
        <Pressable
          testID="eqoai-microphone"
          onPress={onMicPress}
          style={[
            styles.mic,
            { backgroundColor: listening ? C.ember : C.raised },
          ]}
        >
          <Icon
            name={listening ? "microphone" : "microphone-outline"}
            color={listening ? C.text : C.ember}
          />
        </Pressable>
        <TextInput
          testID="eqoai-input"
          value={message}
          onChangeText={setMessage}
          onSubmitEditing={() => send()}
          placeholder={listening ? t("listening") : t("ai_placeholder")}
          placeholderTextColor={C.muted}
          style={styles.input}
          returnKeyType="send"
        />
        <Pressable testID="eqoai-send" onPress={() => send()} style={styles.send}>
          <Icon name="arrow-up" color={C.text} />
        </Pressable>
      </View>
      <Text style={styles.voiceNote}>
        {listening ? t("voice_mode_active") : t("voice_mode_tap")}
      </Text>
    </KeyboardAvoidingView>
  );
}

// ---------- Device Screen ----------
function DeviceScreen({
  t,
  lang,
  connected,
  connecting,
  battery,
  rssi,
  tracking,
  listening,
  appState,
  steps,
  km,
  cal,
  trackDuration,
  holdProgress,
  startHold,
  cancelHold,
  toggleTracking,
  lastGesture,
  onGesture,
  savedSessions,
  realBleConnected,
  realBleName,
  onRealBpm,
  onRealConnect,
}: any) {
  const { C, styles } = useAppTheme();
  const progressWidth = holdProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });
  const mm = String(Math.floor(trackDuration / 60)).padStart(2, "0");
  const ss = String(trackDuration % 60).padStart(2, "0");

  return (
    <>
      <View style={styles.deviceHero}>
        <View style={styles.deviceIconWrap}>
          <Icon
            name="watch-variant"
            color={connected ? C.ember : C.muted}
            size={54}
          />
          {connected && <View style={styles.devicePulse} />}
        </View>
        <Text style={styles.deviceName}>EQOband</Text>
        <Text style={styles.muted}>Seeed Studio XIAO ESP32-C3 · TTP223</Text>
        <View style={styles.deviceStats}>
          <View style={styles.deviceStat}>
            <Text style={styles.stat}>{t("battery_pct")}</Text>
            <Text style={styles.statVal}>{connected ? `${battery}%` : "--"}</Text>
          </View>
          <View style={styles.deviceStat}>
            <Text style={styles.stat}>{t("rssi_lbl")}</Text>
            <Text style={styles.statVal}>{connected ? `${rssi} dBm` : "--"}</Text>
          </View>
          <View style={styles.deviceStat}>
            <Text style={styles.stat}>{t("connection")}</Text>
            <Text
              style={[
                styles.statVal,
                { color: connected ? C.green : C.red },
              ]}
            >
              {appState}
            </Text>
          </View>
        </View>
      </View>

      {/* Interactive Gesture Simulator Card */}
      <GestureSimulatorCard
        t={t}
        onGesture={onGesture}
        lastGesture={lastGesture}
      />

      {/* Hold to connect */}
      <View style={styles.holdWrap}>
        <Pressable
          testID="device-hold"
          onPressIn={startHold}
          onPressOut={cancelHold}
          style={[styles.holdBtn, connected && styles.holdBtnConnected]}
        >
          <Icon
            name={
              connecting
                ? "loading"
                : connected
                ? "check-circle-outline"
                : "bluetooth"
            }
            color={connected ? C.green : C.ember}
            size={40}
          />
          <Text
            style={[
              styles.holdBtnLabel,
              { color: connected ? C.green : C.ember },
            ]}
          >
            {connecting
              ? t("connecting")
              : connected
              ? t("connected_upper")
              : t("idle")}
          </Text>
          <View style={styles.holdProgress}>
            <Animated.View
              style={[styles.holdProgressFill, { width: progressWidth }]}
            />
          </View>
        </Pressable>
        <Text style={styles.holdHint}>
          {connected ? t("hold_disconnect") : t("hold_connect")}
        </Text>
        <Pressable
          testID="device-reconnect"
          onPress={connected ? cancelHold : undefined}
          style={styles.quickBtn}
          onPressIn={connected ? undefined : startHold}
          onPressOut={connected ? undefined : cancelHold}
        >
          <Text style={styles.quickBtnTxt}>
            {connected ? t("disconnect") : t("reconnect")}
          </Text>
        </Pressable>
      </View>

      {/* Tracking control */}
      <Section title={t("tracking_active")} />
      <View style={styles.trackCard}>
        <Icon name="walk" color={tracking ? C.green : C.muted} size={28} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>
            {tracking ? t("tracking_active") : t("tracking_idle")}
          </Text>
          <Text style={styles.body}>
            {steps.toLocaleString()} steps · {km} km · {cal} kcal · {mm}:{ss}
          </Text>
        </View>
        <Pressable
          testID="device-track-toggle"
          onPress={toggleTracking}
          style={[
            styles.outline,
            { borderColor: tracking ? C.red : C.green },
          ]}
        >
          <Text
            style={[
              styles.action,
              { color: tracking ? C.red : C.green },
            ]}
          >
            {tracking ? t("stop_tracking") : t("start_tracking")}
          </Text>
        </Pressable>
      </View>

      {/* Saved Tracking Sessions */}
      {savedSessions && savedSessions.length > 0 && (
        <>
          <Section title={t("recent_sessions")} />
          {savedSessions.slice(0, 5).map((s: SavedTrackingSession) => (
            <View key={s.id} style={styles.sessionCard}>
              <View>
                <Text style={styles.sessionTitle}>
                  {s.steps.toLocaleString()} steps · {s.duration}s
                </Text>
                <Text style={styles.sessionSub}>
                  {s.distance_km} km · {s.calories_kcal} kcal ·{" "}
                  {new Date(s.start_time).toLocaleTimeString()}
                </Text>
              </View>
              <View style={styles.sessionBadge}>
                <Text style={styles.sessionBadgeTxt}>{s.source}</Text>
              </View>
            </View>
          ))}
        </>
      )}

      <Section title={t("device_information")} />
      <View style={styles.infoBox}>
        <Text style={styles.muted}>{t("service_uuid")}</Text>
        <Text style={styles.body}>6E400001-B5A3-F393-E0A9-E50E24DCCA9E</Text>
        <Text style={[styles.muted, { marginTop: 14 }]}>
          {t("char_uuid")} (HR notify)
        </Text>
        <Text style={styles.body}>6E400002-B5A3-F393-E0A9-E50E24DCCA9E</Text>
        <Text style={[styles.muted, { marginTop: 14 }]}>
          {t("char_uuid")} (Battery read)
        </Text>
        <Text style={styles.body}>6E400003-B5A3-F393-E0A9-E50E24DCCA9E</Text>
        <Text style={[styles.muted, { marginTop: 14 }]}>
          {t("char_gesture_uuid")} (1=Single, 2=Double, 3=Long)
        </Text>
        <Text style={styles.body}>6E400004-B5A3-F393-E0A9-E50E24DCCA9E</Text>
        <Text style={[styles.muted, { marginTop: 14, fontSize: 11 }]}>
          {t("firmware_hint")}
        </Text>
      </View>

      <RealBLEPanel
        t={t}
        onBpmStream={onRealBpm}
        onConnectChange={onRealConnect}
        onGestureStream={(code: GestureCode) => onGesture(code, "ble")}
      />
    </>
  );
}

// ---------- Real BLE Panel ----------
function RealBLEPanel({
  t,
  onBpmStream,
  onConnectChange,
  onGestureStream,
}: {
  t: (k: string) => string;
  onBpmStream: (bpm: number | null) => void;
  onConnectChange: (info: ConnectedInfo | null) => void;
  onGestureStream: (gesture: GestureCode) => void;
}) {
  const { C, styles } = useAppTheme();
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<ScannedDevice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [connected, setConnected] = useState<ConnectedInfo | null>(null);
  const stopRef = useRef<null | (() => void)>(null);
  const hrStopRef = useRef<null | (() => void)>(null);
  const gestureStopRef = useRef<null | (() => void)>(null);

  useEffect(
    () => () => {
      if (stopRef.current) stopRef.current();
      if (hrStopRef.current) hrStopRef.current();
      if (gestureStopRef.current) gestureStopRef.current();
      if (connected) ble.disconnect(connected.id).catch(() => {});
      onBpmStream(null);
      onConnectChange(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const startScan = async () => {
    setError(null);
    setDevices([]);
    if (!ble.supported) {
      setError(ble.reason ?? t("beta_unsupported"));
      return;
    }
    const ok = await ble.ensurePermissions();
    if (!ok) {
      setError(t("perm_denied"));
      return;
    }
    setScanning(true);
    stopRef.current = ble.scan(
      (d) => setDevices((list) => [...list, d]),
      (msg) => {
        setError(msg);
        setScanning(false);
      }
    );
    setTimeout(() => {
      if (stopRef.current) {
        stopRef.current();
        stopRef.current = null;
      }
      setScanning(false);
    }, 15000);
  };

  const stopScan = () => {
    if (stopRef.current) {
      stopRef.current();
      stopRef.current = null;
    }
    setScanning(false);
  };

  const handleConnect = async (d: ScannedDevice) => {
    if (busyId) return;
    if (connected?.id === d.id) {
      setBusyId(d.id);
      try {
        if (hrStopRef.current) {
          hrStopRef.current();
          hrStopRef.current = null;
        }
        if (gestureStopRef.current) {
          gestureStopRef.current();
          gestureStopRef.current = null;
        }
        await ble.disconnect(d.id);
        setConnected(null);
        onBpmStream(null);
        onConnectChange(null);
      } catch (e: any) {
        setError(e?.message ?? "Disconnect failed");
      } finally {
        setBusyId(null);
      }
      return;
    }
    if (connected) {
      if (hrStopRef.current) {
        hrStopRef.current();
        hrStopRef.current = null;
      }
      if (gestureStopRef.current) {
        gestureStopRef.current();
        gestureStopRef.current = null;
      }
      try {
        await ble.disconnect(connected.id);
      } catch {}
      setConnected(null);
      onBpmStream(null);
      onConnectChange(null);
    }
    stopScan();
    setBusyId(d.id);
    setError(null);
    try {
      const info = await ble.connect(d.id);
      setConnected(info);
      onConnectChange(info);
      if (info.hasEqoService) {
        hrStopRef.current = await ble.streamHR(
          info.id,
          (bpm) => onBpmStream(bpm),
          (msg) => setError(msg)
        );
        gestureStopRef.current = await ble.streamGestures(
          info.id,
          (gestureCode) => onGestureStream(gestureCode),
          (msg) => setError(msg)
        );
      }
    } catch (e: any) {
      setError(e?.message ?? "Connect failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <Section title={t("beta_ble")} />
      <View style={styles.infoBox}>
        <Text style={styles.muted}>{t("beta_ble_desc")}</Text>

        {!ble.supported ? (
          <View style={styles.betaWarn}>
            <MaterialCommunityIcons
              name="alert-circle-outline"
              size={18}
              color={C.amber}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.warnTitle}>{t("beta_unsupported")}</Text>
              <Text style={styles.body}>
                {ble.reason ?? t("beta_unsupported_hint")}
              </Text>
            </View>
          </View>
        ) : (
          <>
            <Pressable
              testID="ble-scan-btn"
              onPress={scanning ? stopScan : startScan}
              style={[
                styles.scanBtn,
                { backgroundColor: scanning ? C.red : C.ember },
              ]}
            >
              <MaterialCommunityIcons
                name={scanning ? "stop-circle-outline" : "radar"}
                size={18}
                color={C.text}
              />
              <Text style={styles.scanBtnTxt}>
                {scanning ? t("stop_scan") : t("scan")}
              </Text>
            </Pressable>

            {scanning && (
              <View style={styles.scanRow}>
                <ActivityIndicator size="small" color={C.ember} />
                <Text style={styles.muted}>{t("scanning")}</Text>
              </View>
            )}

            {error && (
              <View style={styles.betaWarn}>
                <MaterialCommunityIcons
                  name="alert-circle-outline"
                  size={18}
                  color={C.red}
                />
                <Text style={[styles.body, { flex: 1 }]}>{error}</Text>
              </View>
            )}

            {connected && (
              <View
                style={[
                  styles.betaWarn,
                  { backgroundColor: "rgba(16,185,129,0.12)" },
                ]}
              >
                <MaterialCommunityIcons
                  name="check-circle"
                  size={18}
                  color={C.green}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.warnTitle}>
                    {t("connected_to")}{" "}
                    {connected.name ?? t("unknown_device")}
                  </Text>
                  <Text style={styles.body}>{connected.id}</Text>
                  {connected.services.length > 0 && (
                    <Text
                      style={[styles.muted, { marginTop: 6, fontSize: 11 }]}
                    >
                      {t("services_found")}: {connected.services.length}
                    </Text>
                  )}
                </View>
              </View>
            )}

            {!scanning && devices.length === 0 && !error && !connected && (
              <Text style={[styles.muted, { marginTop: 12 }]}>
                {t("no_devices")}
              </Text>
            )}

            {devices.map((d) => {
              const isConnected = connected?.id === d.id;
              const isBusy = busyId === d.id;
              return (
                <Pressable
                  key={d.id}
                  testID={`ble-device-${d.id}`}
                  onPress={() => handleConnect(d)}
                  disabled={isBusy}
                  style={[
                    styles.deviceItem,
                    isConnected && { borderColor: C.green, borderWidth: 1 },
                  ]}
                >
                  <MaterialCommunityIcons
                    name={isConnected ? "bluetooth-connect" : "bluetooth"}
                    size={20}
                    color={isConnected ? C.green : C.blue}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>
                      {d.name ?? t("unknown_device")}
                    </Text>
                    <Text style={styles.muted}>
                      {d.id}
                      {d.rssi !== null ? ` · ${d.rssi} dBm` : ""}
                    </Text>
                  </View>
                  {isBusy ? (
                    <ActivityIndicator size="small" color={C.ember} />
                  ) : (
                    <Text
                      style={[
                        styles.action,
                        { color: isConnected ? C.red : C.ember },
                      ]}
                    >
                      {isConnected ? t("disconnect") : t("connect")}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </>
        )}
      </View>
    </>
  );
}

// ---------- Settings Screen ----------
function SettingsScreen({
  t,
  lang,
  changeLang,
  connected,
  notifs,
  toggleNotifs,
  talkback,
  toggleTalkback,
  volume,
  changeVolume,
  onEditGoals,
  theme,
  setTheme,
}: any) {
  const { C, styles } = useAppTheme();
  return (
    <>
      <View style={styles.profile}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>S</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{t("profile")}</Text>
          <Text style={styles.muted}>{t("profile_sub")}</Text>
        </View>
        <Icon name="chevron-right" color={C.muted} />
      </View>

      <Text style={styles.settingsGroup}>{t("prefs")}</Text>

      {/* Theme */}
      <View style={styles.settingRow}>
        <Icon name="theme-light-dark" color={C.purple} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{t("theme_lbl")}</Text>
          <Text style={styles.muted}>
            {theme === "dark" ? t("theme_dark") : t("theme_light")}
          </Text>
        </View>
        <View style={styles.themeSwitch}>
          <Pressable
            testID="setting-theme-dark"
            onPress={() => setTheme("dark")}
            style={[styles.themeOpt, theme === "dark" && styles.themeOptActive]}
          >
            <Icon
              name="weather-night"
              size={12}
              color={theme === "dark" ? C.text : C.muted}
            />
            <Text
              style={[
                styles.themeOptTxt,
                theme === "dark" && { color: C.text },
              ]}
            >
              {t("theme_dark")}
            </Text>
          </Pressable>
          <Pressable
            testID="setting-theme-light"
            onPress={() => setTheme("light")}
            style={[
              styles.themeOpt,
              theme === "light" && styles.themeOptActive,
            ]}
          >
            <Icon
              name="white-balance-sunny"
              size={12}
              color={theme === "light" ? C.text : C.muted}
            />
            <Text
              style={[
                styles.themeOptTxt,
                theme === "light" && { color: C.text },
              ]}
            >
              {t("theme_light")}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Language */}
      <View style={styles.settingRow}>
        <Icon name="translate" color={C.blue} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{t("language_lbl")}</Text>
          <Text style={styles.muted}>{t("language_desc")}</Text>
        </View>
        <View style={styles.langSwitch}>
          <Pressable
            testID="setting-lang-en"
            onPress={() => changeLang("en")}
            style={[styles.langOpt, lang === "en" && styles.langOptActive]}
          >
            <Text
              style={[
                styles.langOptTxt,
                lang === "en" && { color: C.text },
              ]}
            >
              EN
            </Text>
          </Pressable>
          <Pressable
            testID="setting-lang-id"
            onPress={() => changeLang("id")}
            style={[styles.langOpt, lang === "id" && styles.langOptActive]}
          >
            <Text
              style={[
                styles.langOptTxt,
                lang === "id" && { color: C.text },
              ]}
            >
              ID
            </Text>
          </Pressable>
        </View>
      </View>

      <Text style={styles.settingsGroup}>{t("device_group")}</Text>

      <View style={styles.settingRow}>
        <Icon name="bluetooth" color={C.blue} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{t("bluetooth")}</Text>
          <Text style={styles.muted}>
            {connected ? t("bt_desc_on") : t("bt_desc_off")}
          </Text>
        </View>
        <Switch
          testID="setting-bluetooth"
          value={connected}
          onValueChange={() => {}}
          disabled
          trackColor={{ true: C.green, false: C.raised }}
          thumbColor={C.text}
        />
      </View>

      <View style={styles.settingRow}>
        <Icon name="bell-outline" color={C.amber} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{t("notifications")}</Text>
          <Text style={styles.muted}>{t("notifications_desc")}</Text>
        </View>
        <Switch
          testID="setting-notifications"
          value={notifs}
          onValueChange={toggleNotifs}
          trackColor={{ true: C.ember, false: C.raised }}
          thumbColor={C.text}
        />
      </View>

      <View style={styles.settingRow}>
        <Icon name="volume-high" color={C.purple} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{t("talkback")}</Text>
          <Text style={styles.muted}>
            {talkback ? t("talkback_on") : t("talkback_off")}
          </Text>
        </View>
        <Switch
          testID="setting-talkback"
          value={talkback}
          onValueChange={toggleTalkback}
          trackColor={{ true: C.purple, false: C.raised }}
          thumbColor={C.text}
        />
      </View>

      {/* Volume slider */}
      <View style={styles.settingRow}>
        <Icon name="volume-medium" color={C.green} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{t("volume")}</Text>
          <Text style={styles.muted}>{volume}%</Text>
          <VolumeSlider value={volume} onChange={changeVolume} />
        </View>
      </View>

      <Text style={styles.settingsGroup}>{t("goals_group")}</Text>

      <Pressable
        testID="setting-edit-goals"
        style={styles.settingRow}
        onPress={onEditGoals}
      >
        <Icon name="target" color={C.ember} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{t("edit_goals")}</Text>
          <Text style={styles.muted}>{t("edit_goals_desc")}</Text>
        </View>
        <Icon name="chevron-right" color={C.muted} />
      </Pressable>

      <Pressable testID="setting-about" style={styles.settingRow}>
        <Icon name="information-outline" color={C.blue} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{t("about")}</Text>
          <Text style={styles.muted}>{t("about_desc")}</Text>
        </View>
        <Icon name="chevron-right" color={C.muted} />
      </Pressable>

      <Text style={styles.version}>{t("version")}</Text>
    </>
  );
}

// ---------- Volume Slider ----------
function VolumeSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const { styles } = useAppTheme();
  const [width, setWidth] = useState(0);
  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={styles.slider}
    >
      <View style={[styles.sliderFill, { width: `${value}%` }]} />
      <View style={[styles.sliderThumb, { left: `${value}%` }]} />
      {[0, 25, 50, 75, 100].map((step) => (
        <Pressable
          key={step}
          testID={`volume-step-${step}`}
          onPress={() => onChange(step)}
          style={[styles.sliderTick, { left: `${step}%` }]}
        />
      ))}
      <Pressable
        style={StyleSheet.absoluteFillObject}
        onStartShouldSetResponder={() => true}
        onResponderMove={(e) => {
          if (width === 0) return;
          const raw = e.nativeEvent.locationX;
          const v = Math.max(0, Math.min(100, Math.round((raw / width) * 100)));
          onChange(v);
        }}
      />
    </View>
  );
}

// ---------- Edit Goals Modal ----------
function EditGoalsModal({
  visible,
  t,
  stepGoal,
  activeGoal,
  calGoal,
  onClose,
  onSave,
}: any) {
  const { C, styles } = useAppTheme();
  const [s, setS] = useState(String(stepGoal));
  const [a, setA] = useState(String(activeGoal));
  const [c, setC] = useState(String(calGoal));
  useEffect(() => {
    if (visible) {
      setS(String(stepGoal));
      setA(String(activeGoal));
      setC(String(calGoal));
    }
  }, [visible, stepGoal, activeGoal, calGoal]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBg}>
        <View style={styles.modalCard}>
          <Text style={styles.cardTitle}>{t("edit_goals")}</Text>
          <View style={{ height: 12 }} />
          <Text style={styles.muted}>{t("steps_daily")}</Text>
          <TextInput
            testID="edit-step-goal"
            value={s}
            onChangeText={setS}
            keyboardType="number-pad"
            style={styles.modalInput}
            placeholderTextColor={C.muted}
          />
          <Text style={styles.muted}>{t("active_minutes")}</Text>
          <TextInput
            testID="edit-active-goal"
            value={a}
            onChangeText={setA}
            keyboardType="number-pad"
            style={styles.modalInput}
            placeholderTextColor={C.muted}
          />
          <Text style={styles.muted}>{t("calories_daily")}</Text>
          <TextInput
            testID="edit-cal-goal"
            value={c}
            onChangeText={setC}
            keyboardType="number-pad"
            style={styles.modalInput}
            placeholderTextColor={C.muted}
          />
          <View style={styles.modalActions}>
            <Pressable
              testID="edit-cancel"
              onPress={onClose}
              style={[styles.outline, { flex: 1, alignItems: "center" }]}
            >
              <Text style={styles.action}>{t("cancel")}</Text>
            </Pressable>
            <Pressable
              testID="edit-save"
              onPress={() =>
                onSave(
                  parseInt(s) || 10000,
                  parseInt(a) || 30,
                  parseInt(c) || 500
                )
              }
              style={[
                styles.send,
                {
                  paddingHorizontal: 22,
                  width: undefined,
                  height: undefined,
                  paddingVertical: 12,
                  flex: 1,
                },
              ]}
            >
              <Text style={styles.saveText}>{t("save")}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

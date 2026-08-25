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
import { ble, ScannedDevice } from "@/src/utils/ble";
import { storage } from "@/src/utils/storage";

const API = `${process.env.EXPO_PUBLIC_BACKEND_URL ?? ""}/api`;

const C = {
  bg: "#121316",
  card: "#1A1C23",
  raised: "#232630",
  text: "#F4F5F7",
  muted: "#9BA1B0",
  ember: "#FF5722",
  green: "#10B981",
  blue: "#3B82F6",
  purple: "#7C3AED",
  red: "#EF4444",
  border: "#2A2E3D",
  amber: "#F59E0B",
};

type Tab = "health" | "goals" | "ai" | "device" | "settings";
type Msg = { id: string; from: "me" | "ai" | "sys"; text: string; time: string };

const K = {
  lang: "eqo:lang",
  volume: "eqo:volume",
  notifs: "eqo:notifs",
  talkback: "eqo:talkback",
  stepGoal: "eqo:stepGoal",
  activeGoal: "eqo:activeGoal",
  calGoal: "eqo:calGoal",
};

const Icon = ({ name, size = 22, color = C.muted }: { name: string; size?: number; color?: string }) => (
  <MaterialCommunityIcons name={name as never} size={size} color={color} />
);

const clockNow = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// ---------- Command intent detector (fires alongside LLM) ----------
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
  const volumeMatch = q.match(/(?:volume|suara|sound)[^0-9]*(\d{1,3})/) || q.match(/(?:set|atur|ubah)[^0-9]*volume[^0-9]*(\d{1,3})/);

  if (powerKw.test(q)) return { kind: "power_off" };
  if (volumeMatch) {
    const v = Math.max(0, Math.min(100, parseInt(volumeMatch[1], 10)));
    return { kind: "volume", value: v };
  }
  if (stopKw.test(q) && (stepKw.test(q) || /tracking/.test(q))) return { kind: "stop_track" };
  if (startKw.test(q) && (stepKw.test(q) || /tracking/.test(q))) return { kind: "start_track" };
  if (/tracking/.test(q) && startKw.test(q)) return { kind: "start_track" };
  if (/(open|buka).*(goal|target)/.test(q) || /^goals?$|^target/.test(q)) return { kind: "open", tab: "goals" };
  if (/(open|buka).*(setting|pengaturan)/.test(q)) return { kind: "open", tab: "settings" };
  if (/(open|buka).*(device|gelang|band)/.test(q)) return { kind: "open", tab: "device" };
  if (/(heart|denyut|nadi|bpm|pulse)/.test(q)) return { kind: "open", tab: "health" };
  return null;
}

// ---------- Root ----------
export default function Index() {
  const [tab, setTab] = useState<Tab>("health");
  const [lang, setLangState] = useState<Lang>("en");
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  // device state
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [battery, setBattery] = useState(86);
  const [rssi] = useState(-54);
  const [bpm, setBpm] = useState(0);
  const [hrCountdown, setHrCountdown] = useState(30);
  const [hrReadings, setHrReadings] = useState<number[]>([]);
  const [steps, setSteps] = useState(0);
  const [tracking, setTracking] = useState(false);
  const [trackDuration, setTrackDuration] = useState(0);

  // prefs
  const [volume, setVolume] = useState(70);
  const [notifs, setNotifs] = useState(true);
  const [talkback, setTalkback] = useState(false);
  const [stepGoal, setStepGoal] = useState(10000);
  const [activeGoal, setActiveGoal] = useState(30);
  const [calGoal, setCalGoal] = useState(500);
  const [editOpen, setEditOpen] = useState(false);

  // chat
  const [chat, setChat] = useState<Msg[]>([]);
  const [message, setMessage] = useState("");
  const [aiTyping, setAiTyping] = useState(false);
  const [listening, setListening] = useState(false);
  const chatScrollRef = useRef<ScrollView>(null);

  // ui
  const [toast, setToast] = useState<string | null>(null);
  const holdProgress = useRef(new Animated.Value(0)).current;
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const t = useCallback((k: string) => tr(lang, k), [lang]);

  // Load persisted prefs on mount
  useEffect(() => {
    (async () => {
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
      setPrefsLoaded(true);
    })();
  }, []);

  // Initial welcome message
  useEffect(() => {
    if (prefsLoaded && chat.length === 0) {
      setChat([{ id: "welcome", from: "ai", text: tr(lang, "ai_greeting"), time: clockNow() }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsLoaded, lang]);

  // HR simulation when connected
  useEffect(() => {
    if (!connected) return;
    const tick = () => {
      const base = tracking ? 100 + Math.floor(Math.random() * 40) : 62 + Math.floor(Math.random() * 30);
      setBpm(base);
      setHrReadings((r) => [...r.slice(-19), base]);
      setHrCountdown(30);
    };
    tick();
    const refresh = setInterval(tick, 30000);
    const count = setInterval(() => setHrCountdown((c) => (c > 0 ? c - 1 : 30)), 1000);
    return () => {
      clearInterval(refresh);
      clearInterval(count);
    };
  }, [connected, tracking]);

  // Steps tracking loop
  useEffect(() => {
    if (!tracking || !connected) return;
    const stepInt = setInterval(() => setSteps((s) => s + (1 + Math.floor(Math.random() * 3))), 1000);
    const timeInt = setInterval(() => setTrackDuration((s) => s + 1), 1000);
    return () => {
      clearInterval(stepInt);
      clearInterval(timeInt);
    };
  }, [tracking, connected]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }, []);

  // ---------- Actions ----------
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
    setBpm(0);
    setHrReadings([]);
    showToast(tr(lang, "toast_disconnected"));
  }, [lang, showToast]);

  const startHold = () => {
    holdProgress.setValue(0);
    Animated.timing(holdProgress, { toValue: 1, duration: 2000, useNativeDriver: false }).start();
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
    Animated.timing(holdProgress, { toValue: 0, duration: 200, useNativeDriver: false }).start();
  };

  const toggleTracking = () => {
    if (!connected) {
      showToast(tr(lang, "toast_connect_first"));
      return;
    }
    if (tracking) {
      setTracking(false);
      showToast(tr(lang, "toast_track_stop"));
    } else {
      setTrackDuration(0);
      setTracking(true);
      showToast(tr(lang, "toast_track_start"));
    }
  };

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

  // ---------- AI chat ----------
  const executeIntent = useCallback(
    (intent: Intent) => {
      if (!intent) return;
      switch (intent.kind) {
        case "power_off":
          if (connected) doDisconnect();
          break;
        case "start_track":
          if (connected && !tracking) {
            setTrackDuration(0);
            setTracking(true);
            showToast(tr(lang, "toast_track_start"));
          }
          break;
        case "stop_track":
          if (tracking) {
            setTracking(false);
            showToast(tr(lang, "toast_track_stop"));
          }
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
    [connected, tracking, lang, doDisconnect, showToast],
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
      setChat((c) => [...c, { id: `${Date.now()}-ai`, from: "ai", text: reply, time: clockNow() }]);
    } catch {
      setChat((c) => [
        ...c,
        { id: `${Date.now()}-ai`, from: "ai", text: lang === "id" ? "EQO AI sedang offline. Coba lagi nanti." : "EQO AI is offline. Try again shortly.", time: clockNow() },
      ]);
    } finally {
      setAiTyping(false);
      setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 60);
    }
  };

  // ---------- Derived ----------
  const km = useMemo(() => (steps * 0.00075).toFixed(2), [steps]);
  const cal = useMemo(() => Math.floor(steps * 0.04), [steps]);
  const activeMin = useMemo(() => Math.floor(trackDuration / 60), [trackDuration]);
  const stepPct = Math.min(100, Math.round((steps / stepGoal) * 100));
  const activePct = Math.min(100, Math.round((activeMin / activeGoal) * 100));
  const calPct = Math.min(100, Math.round((cal / calGoal) * 100));
  const goalsPct = Math.round((stepPct + activePct + calPct) / 3);

  const weeklySteps = useMemo(() => {
    const base = [7200, 8450, 6120, 9040, 6842, 3200, 0];
    // Put today's live steps in slot 4 (Fri equivalent)
    const arr = [...base];
    arr[4] = Math.max(arr[4], steps);
    return arr;
  }, [steps]);
  const weekLabels = lang === "id" ? ["S", "S", "R", "K", "J", "S", "M"] : ["M", "T", "W", "T", "F", "S", "S"];
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

  if (!prefsLoaded) {
    return (
      <SafeAreaView style={styles.center} edges={["top", "bottom"]}>
        <ActivityIndicator color={C.ember} size="large" />
        <Text style={styles.muted}>EQOband</Text>
      </SafeAreaView>
    );
  }

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
            <View style={[styles.dot, { backgroundColor: connected ? C.green : C.red }]} />
            <Text style={styles.status}>{connected ? t("live") : t("offline")}</Text>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {tab === "health" && (
          <HealthScreen
            t={t}
            lang={lang}
            connected={connected}
            battery={battery}
            bpm={bpm}
            hrCountdown={hrCountdown}
            hrReadings={hrReadings}
            steps={steps}
            stepGoal={stepGoal}
            activeMin={activeMin}
            activeGoal={activeGoal}
            tracking={tracking}
            goalsPct={goalsPct}
            onGoDevice={() => setTab("device")}
            onCardTap={(cardTab) => {
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
            setListening={setListening}
            aiTyping={aiTyping}
            chatScrollRef={chatScrollRef}
          />
        )}
        {tab === "device" && (
          <DeviceScreen
            t={t}
            connected={connected}
            connecting={connecting}
            battery={battery}
            rssi={rssi}
            tracking={tracking}
            steps={steps}
            km={km}
            cal={cal}
            trackDuration={trackDuration}
            holdProgress={holdProgress}
            startHold={startHold}
            cancelHold={cancelHold}
            toggleTracking={toggleTracking}
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
          />
        )}
      </ScrollView>

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
          <Pressable testID={`tab-${key}`} key={key} onPress={() => setTab(key)} style={styles.tab}>
            <Icon name={icon} color={tab === key ? C.ember : C.muted} />
            <Text style={[styles.tabText, tab === key && { color: C.ember }]}>{t(`tab_${key}`)}</Text>
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
        onSave={async (s, a, c) => {
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

// ---------- Health Screen ----------
function HealthScreen({
  t, lang, connected, battery, bpm, hrCountdown, hrReadings, steps, stepGoal, activeMin, activeGoal, tracking, goalsPct, onGoDevice, onCardTap,
}: any) {
  const zone = bpm === 0 ? "-" : bpm < 60 ? "LOW" : bpm < 100 ? "NORMAL" : bpm < 140 ? "ACTIVE" : "MAX";
  return (
    <>
      <View style={styles.deviceRow}>
        <View>
          <Text style={styles.muted}>{t("device_prototype")}</Text>
          <Text style={styles.small}>{t("device_esp")} · {battery}% {t("battery")}</Text>
        </View>
        <Pressable
          testID="health-device-status"
          onPress={onGoDevice}
          style={[styles.connectPill, { backgroundColor: connected ? "rgba(16,185,129,.12)" : "rgba(239,68,68,.12)" }]}
        >
          <Icon name={connected ? "bluetooth-connect" : "bluetooth-off"} color={connected ? C.green : C.red} size={16} />
          <Text style={[styles.connectText, { color: connected ? C.green : C.red }]}>
            {connected ? t("connected") : t("disconnected")}
          </Text>
        </Pressable>
      </View>

      {/* Battery bar (only when connected) */}
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
        <Text style={styles.muted}>{connected ? `${zone} · ${t("hr_refresh")}${hrCountdown}s` : t("hr_hint")}</Text>
        <View style={styles.wave}>
          {[12, 20, 32, 18, 38, 22, 14, 28, 17, 34, 22, 15, 30, 18, 25, 14].map((h, i) => (
            <View
              key={i}
              style={[
                styles.waveBar,
                { height: connected ? h : 8, backgroundColor: connected && i === 4 ? C.ember : C.raised },
              ]}
            />
          ))}
        </View>
      </LockableCard>

      {/* Grid of metrics */}
      <View style={styles.grid}>
        <Pressable style={{ flex: 1 }} testID="card-steps" onPress={() => onCardTap("goals")}>
          <LockableCard locked={!connected} lockedLabel={t("locked")} t={t} small>
            <Icon name="walk" color={C.ember} />
            <Text style={styles.label}>{t("steps_today")}</Text>
            <Text style={styles.metricValue}>{connected ? steps.toLocaleString() : "--"}</Text>
            <Text style={styles.muted}>
              {connected ? `${Math.min(100, Math.round((steps / stepGoal) * 100))}% ${t("goal_of")} ${stepGoal.toLocaleString()}` : t("unlock_via_device")}
            </Text>
          </LockableCard>
        </Pressable>
        <Pressable style={{ flex: 1 }} testID="card-active" onPress={() => onCardTap("goals")}>
          <LockableCard locked={!connected} lockedLabel={t("locked")} t={t} small>
            <Icon name="timer-outline" color={C.blue} />
            <Text style={styles.label}>{t("active_time")}</Text>
            <Text style={styles.metricValue}>{connected ? `${activeMin}m` : "--"}</Text>
            <Text style={styles.muted}>{t("goal")} {activeGoal}m</Text>
          </LockableCard>
        </Pressable>
      </View>

      {/* Quick tiles: AI + Goals */}
      <View style={styles.grid}>
        <Pressable style={{ flex: 1 }} testID="card-ai" onPress={() => onCardTap("ai")}>
          <LockableCard locked={!connected} lockedLabel={t("locked")} t={t} small>
            <Icon name="brain" color={C.purple} />
            <Text style={styles.label}>{t("ai_title")}</Text>
            <Text style={styles.metricValue}>{connected ? t("on") : t("off")}</Text>
            <Text style={styles.muted}>{t("steps_status")}</Text>
          </LockableCard>
        </Pressable>
        <Pressable style={{ flex: 1 }} testID="card-goals" onPress={() => onCardTap("goals")}>
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
          <Text style={styles.cardTitle}>{lang === "id" ? "Momentum kuat" : "Strong momentum"}</Text>
          <Text style={styles.body}>
            {lang === "id"
              ? `Kamu di ${Math.min(100, Math.round((steps / stepGoal) * 100))}% dari target langkah harian.`
              : `You are at ${Math.min(100, Math.round((steps / stepGoal) * 100))}% of today's step goal.`}
          </Text>
        </View>
        <Icon name="chevron-right" color={C.muted} />
      </View>

      <Section title={t("activity_signal")} />
      <View style={styles.activityCard}>
        <Icon name="run-fast" color={C.green} size={28} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{t("movement_day")}</Text>
          <Text style={styles.body}>{t("movement_body")}</Text>
        </View>
        <Text style={styles.greenText}>{t("good")}</Text>
      </View>
    </>
  );
}

function LockableCard({ locked, children, lockedLabel, t, small }: any) {
  return (
    <View style={[styles.heroCard, small && styles.metric, locked && { opacity: 0.55 }]}>
      {children}
      {locked && (
        <View style={styles.lockRow}>
          <Icon name="lock" color={C.muted} size={11} />
          <Text style={styles.lockText}>{lockedLabel} · {t("unlock_via_device")}</Text>
        </View>
      )}
    </View>
  );
}

function Section({ title, action }: { title: string; action?: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action && <Text style={styles.action}>{action}</Text>}
    </View>
  );
}

// ---------- Goals Screen ----------
function GoalsScreen({
  t, connected, steps, stepGoal, activeMin, activeGoal, cal, calGoal, weeklySteps, weekLabels, activeDays, weekTotal, streak, stepPct, activePct, calPct,
}: any) {
  const scoreVal = Math.min(100, Math.round((stepPct + activePct + calPct) / 3));
  const maxWeek = Math.max(...weeklySteps, 1);
  return (
    <>
      <LinearGradient colors={[C.ember, "#B23A18"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.goalBanner}>
        <Text style={styles.label}>{t("weekly_movement_score")}</Text>
        <Text style={styles.goalScore}>{scoreVal}<Text style={styles.unit}> / 100</Text></Text>
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
                        backgroundColor: isToday ? C.ember : v >= stepGoal * 0.6 ? C.green : C.raised,
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.dayLabel, isToday && { color: C.ember }]}>{weekLabels[i]}</Text>
              </View>
            );
          })}
        </View>
        <View style={styles.weeklyFoot}>
          <Text style={styles.weeklyFootTxt}>{t("active_days")}: <Text style={styles.weeklyFootV}>{activeDays}/7</Text></Text>
          <Text style={styles.weeklyFootTxt}>{t("week_steps")}: <Text style={styles.weeklyFootV}>{weekTotal.toLocaleString()}</Text></Text>
          <Text style={styles.weeklyFootTxt}>{t("streak")}: <Text style={styles.weeklyFootV}>{streak} {t("days")}</Text></Text>
        </View>
      </View>

      <Section title={t("steps_this_week")} />
      <GoalProgress icon="walk" title={t("daily_step_goal")} pct={stepPct} now={steps.toLocaleString()} goal={stepGoal.toLocaleString()} unit={t("of_steps")} color={C.ember} />
      <GoalProgress icon="heart-pulse" title={t("daily_heart_zone")} pct={activePct} now={activeMin} goal={activeGoal} unit={t("of_minutes")} color={C.red} />
      <GoalProgress icon="fire" title={t("daily_calories")} pct={calPct} now={cal} goal={calGoal} unit={t("of_calories")} color={C.amber} />

      <Section title={t("achievements")} />
      <View style={styles.achievement}>
        <Icon name="medal-outline" color={C.ember} size={28} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{t("five_day_rhythm")}</Text>
          <Text style={styles.body}>{t("move_five_days")}</Text>
        </View>
        <Text style={[styles.achieved, { color: streak >= 5 ? C.green : C.muted }]}>{streak >= 5 ? t("earned") : `${streak}/5`}</Text>
      </View>
    </>
  );
}

function GoalProgress({ icon, title, pct, now, goal, unit, color }: any) {
  return (
    <View style={styles.goalRow}>
      <View style={styles.goalHead}>
        <Icon name={icon} color={color} />
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={[styles.action, { color }]}>{pct}%</Text>
      </View>
      <View style={styles.goalBar}>
        <View style={[styles.goalFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <Text style={styles.muted}>{now} / {goal} {unit}</Text>
    </View>
  );
}

// ---------- AI Screen ----------
function AIScreen({ t, chat, message, setMessage, send, listening, setListening, aiTyping, chatScrollRef }: any) {
  const prompts = [t("prompt_how"), t("prompt_goal"), t("prompt_pulse")];
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={80}>
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
        onContentSizeChange={() => chatScrollRef.current?.scrollToEnd({ animated: true })}
      >
        {chat.length === 0 && <Text style={styles.empty}>{t("ai_ready")}</Text>}
        {chat.map((m: Msg) => (
          <View key={m.id} style={[styles.bubble, m.from === "me" ? styles.mine : styles.theirs]}>
            <Text style={styles.bubbleText}>{m.text}</Text>
            <Text style={styles.bubbleTime}>{m.time}</Text>
          </View>
        ))}
        {aiTyping && (
          <View style={[styles.bubble, styles.theirs, { flexDirection: "row", gap: 4, alignItems: "center" }]} testID="ai-typing">
            <ActivityIndicator size="small" color={C.ember} />
            <Text style={styles.bubbleText}>{t("thinking")}</Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.composer}>
        <Pressable
          testID="eqoai-microphone"
          onPress={() => setListening(!listening)}
          style={[styles.mic, { backgroundColor: listening ? C.ember : C.raised }]}
        >
          <Icon name={listening ? "microphone" : "microphone-outline"} color={listening ? C.text : C.ember} />
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
  t, connected, connecting, battery, rssi, tracking, steps, km, cal, trackDuration, holdProgress, startHold, cancelHold, toggleTracking,
}: any) {
  const progressWidth = holdProgress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] });
  const mm = String(Math.floor(trackDuration / 60)).padStart(2, "0");
  const ss = String(trackDuration % 60).padStart(2, "0");
  return (
    <>
      <View style={styles.deviceHero}>
        <View style={styles.deviceIconWrap}>
          <Icon name="watch-variant" color={connected ? C.ember : C.muted} size={54} />
          {connected && <View style={styles.devicePulse} />}
        </View>
        <Text style={styles.deviceName}>EQOband</Text>
        <Text style={styles.muted}>Seeed Studio XIAO ESP32-C3</Text>
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
            <Text style={[styles.statVal, { color: connected ? C.green : C.red }]}>
              {connected ? t("connected_upper") : t("idle")}
            </Text>
          </View>
        </View>
      </View>

      {/* Hold to connect */}
      <View style={styles.holdWrap}>
        <Pressable
          testID="device-hold"
          onPressIn={startHold}
          onPressOut={cancelHold}
          style={[styles.holdBtn, connected && styles.holdBtnConnected]}
        >
          <Icon
            name={connecting ? "loading" : connected ? "check-circle-outline" : "bluetooth"}
            color={connected ? C.green : C.ember}
            size={40}
          />
          <Text style={[styles.holdBtnLabel, { color: connected ? C.green : C.ember }]}>
            {connecting ? t("connecting") : connected ? t("connected_upper") : t("idle")}
          </Text>
          <View style={styles.holdProgress}>
            <Animated.View style={[styles.holdProgressFill, { width: progressWidth }]} />
          </View>
        </Pressable>
        <Text style={styles.holdHint}>{connected ? t("hold_disconnect") : t("hold_connect")}</Text>
        <Pressable
          testID="device-reconnect"
          onPress={connected ? cancelHold : undefined}
          style={styles.quickBtn}
          onPressIn={connected ? undefined : startHold}
          onPressOut={connected ? undefined : cancelHold}
        >
          <Text style={styles.quickBtnTxt}>{connected ? t("disconnect") : t("reconnect")}</Text>
        </Pressable>
      </View>

      {/* Tracking control */}
      <Section title={t("tracking_active")} />
      <View style={styles.trackCard}>
        <Icon name="walk" color={tracking ? C.green : C.muted} size={28} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{tracking ? t("tracking_active") : t("tracking_idle")}</Text>
          <Text style={styles.body}>
            {steps.toLocaleString()} steps · {km} km · {cal} kcal · {mm}:{ss}
          </Text>
        </View>
        <Pressable testID="device-track-toggle" onPress={toggleTracking} style={[styles.outline, { borderColor: tracking ? C.red : C.green }]}>
          <Text style={[styles.action, { color: tracking ? C.red : C.green }]}>
            {tracking ? t("stop_tracking") : t("start_tracking")}
          </Text>
        </Pressable>
      </View>

      <Section title={t("device_information")} />
      <View style={styles.infoBox}>
        <Text style={styles.muted}>{t("service_uuid")}</Text>
        <Text style={styles.body}>0000FFE0-0000-1000-8000-00805F9B34FB</Text>
        <Text style={[styles.muted, { marginTop: 14 }]}>{t("char_uuid")}</Text>
        <Text style={styles.body}>0000FFE1-0000-1000-8000-00805F9B34FB</Text>
        <Text style={[styles.muted, { marginTop: 14 }]}>{t("ble_service")}</Text>
      </View>

      <RealBLEPanel t={t} />
    </>
  );
}

// ---------- Real BLE Panel ----------
function RealBLEPanel({ t }: { t: (k: string) => string }) {
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<ScannedDevice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef<null | (() => void)>(null);

  useEffect(() => () => {
    if (stopRef.current) stopRef.current();
  }, []);

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
      },
    );
    // Auto-stop after 15s
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

  return (
    <>
      <Section title={t("beta_ble")} />
      <View style={styles.infoBox}>
        <Text style={styles.muted}>{t("beta_ble_desc")}</Text>

        {!ble.supported ? (
          <View style={styles.betaWarn}>
            <MaterialCommunityIcons name="alert-circle-outline" size={18} color={C.amber} />
            <View style={{ flex: 1 }}>
              <Text style={styles.warnTitle}>{t("beta_unsupported")}</Text>
              <Text style={styles.body}>{ble.reason ?? t("beta_unsupported_hint")}</Text>
            </View>
          </View>
        ) : (
          <>
            <Pressable
              testID="ble-scan-btn"
              onPress={scanning ? stopScan : startScan}
              style={[styles.scanBtn, { backgroundColor: scanning ? C.red : C.ember }]}
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
                <MaterialCommunityIcons name="alert-circle-outline" size={18} color={C.red} />
                <Text style={styles.body}>{error}</Text>
              </View>
            )}

            {!scanning && devices.length === 0 && !error && (
              <Text style={[styles.muted, { marginTop: 12 }]}>{t("no_devices")}</Text>
            )}

            {devices.map((d) => (
              <View key={d.id} style={styles.deviceItem} testID={`ble-device-${d.id}`}>
                <MaterialCommunityIcons name="bluetooth" size={20} color={C.blue} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{d.name ?? t("unknown_device")}</Text>
                  <Text style={styles.muted}>{d.id}{d.rssi !== null ? ` · ${d.rssi} dBm` : ""}</Text>
                </View>
              </View>
            ))}
          </>
        )}
      </View>
    </>
  );
}

// ---------- Settings Screen ----------
function SettingsScreen({
  t, lang, changeLang, connected, notifs, toggleNotifs, talkback, toggleTalkback, volume, changeVolume, onEditGoals,
}: any) {
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
            <Text style={[styles.langOptTxt, lang === "en" && { color: C.text }]}>EN</Text>
          </Pressable>
          <Pressable
            testID="setting-lang-id"
            onPress={() => changeLang("id")}
            style={[styles.langOpt, lang === "id" && styles.langOptActive]}
          >
            <Text style={[styles.langOptTxt, lang === "id" && { color: C.text }]}>ID</Text>
          </Pressable>
        </View>
      </View>

      <Text style={styles.settingsGroup}>{t("device_group")}</Text>

      <View style={styles.settingRow}>
        <Icon name="bluetooth" color={C.blue} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{t("bluetooth")}</Text>
          <Text style={styles.muted}>{connected ? t("bt_desc_on") : t("bt_desc_off")}</Text>
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
          <Text style={styles.muted}>{talkback ? t("talkback_on") : t("talkback_off")}</Text>
        </View>
        <Switch
          testID="setting-talkback"
          value={talkback}
          onValueChange={toggleTalkback}
          trackColor={{ true: C.purple, false: C.raised }}
          thumbColor={C.text}
        />
      </View>

      {/* Volume slider — bespoke */}
      <View style={styles.settingRow}>
        <Icon name="volume-medium" color={C.green} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{t("volume")}</Text>
          <Text style={styles.muted}>{volume}%</Text>
          <VolumeSlider value={volume} onChange={changeVolume} />
        </View>
      </View>

      <Text style={styles.settingsGroup}>{t("goals_group")}</Text>

      <Pressable testID="setting-edit-goals" style={styles.settingRow} onPress={onEditGoals}>
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

// ---------- Volume Slider (custom) ----------
function VolumeSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
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
function EditGoalsModal({ visible, t, stepGoal, activeGoal, calGoal, onClose, onSave }: any) {
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
            <Pressable testID="edit-cancel" onPress={onClose} style={[styles.outline, { flex: 1, alignItems: "center" }]}>
              <Text style={styles.action}>{t("cancel")}</Text>
            </Pressable>
            <Pressable
              testID="edit-save"
              onPress={() => onSave(parseInt(s) || 10000, parseInt(a) || 30, parseInt(c) || 500)}
              style={[styles.send, { paddingHorizontal: 22, width: undefined, height: undefined, paddingVertical: 12, flex: 1 }]}
            >
              <Text style={styles.saveText}>{t("save")}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ---------- Styles ----------
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center", gap: 16 },
  content: { padding: 20, paddingBottom: 130 },

  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 18, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  eyebrow: { fontSize: 11, letterSpacing: 1.5, color: C.ember, fontWeight: "700" },
  title: { fontSize: 30, color: C.text, fontWeight: "700", marginTop: 5 },
  headerRight: { alignItems: "flex-end", gap: 6 },
  headerStatus: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 5 },
  status: { fontSize: 11, color: C.muted, letterSpacing: 1 },
  langPill: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  langText: { fontSize: 11, color: C.text, fontWeight: "700", letterSpacing: 1 },

  muted: { fontSize: 13, color: C.muted },
  small: { fontSize: 12, color: C.muted, marginTop: 4 },

  deviceRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  connectPill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20 },
  connectText: { fontSize: 12, fontWeight: "700" },

  batBar: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 14 },
  batLbl: { fontSize: 10, color: C.muted, letterSpacing: 1 },
  batTrack: { height: 5, backgroundColor: C.raised, borderRadius: 4, marginTop: 4, overflow: "hidden" },
  batFill: { height: 5, backgroundColor: C.green, borderRadius: 4 },
  batPct: { fontSize: 13, color: C.green, fontWeight: "700" },

  heroCard: { backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 20, padding: 20, marginBottom: 12 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: { fontSize: 11, letterSpacing: 1.2, color: C.muted, fontWeight: "700" },
  bpm: { fontSize: 54, color: C.text, fontWeight: "700", marginTop: 9 },
  unit: { fontSize: 15, color: C.muted, fontWeight: "500" },
  wave: { height: 44, flexDirection: "row", alignItems: "center", gap: 5, marginTop: 20 },
  waveBar: { width: 7, borderRadius: 4 },
  lockRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 },
  lockText: { fontSize: 9, color: C.muted, letterSpacing: 1 },

  grid: { flexDirection: "row", gap: 12, marginBottom: 0 },
  metric: { flex: 1, minHeight: 130, marginBottom: 12 },
  metricValue: { fontSize: 25, color: C.text, fontWeight: "700", marginTop: 12, marginBottom: 4 },

  section: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 24, marginBottom: 12 },
  sectionTitle: { color: C.text, fontSize: 18, fontWeight: "700" },
  action: { color: C.ember, fontWeight: "700", fontSize: 13 },

  insight: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 16, padding: 16 },
  insightIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: "rgba(255,87,34,.15)", alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 15, color: C.text, fontWeight: "700" },
  body: { fontSize: 13, color: C.muted, lineHeight: 19, marginTop: 4 },

  activityCard: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 16, padding: 16 },
  greenText: { fontSize: 11, color: C.green, fontWeight: "700" },

  goalBanner: { borderRadius: 20, padding: 20 },
  goalScore: { fontSize: 44, color: C.text, fontWeight: "700", marginTop: 8 },

  weeklyCard: { backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 16, padding: 16 },
  weeklyDays: { flexDirection: "row", justifyContent: "space-between", height: 120, gap: 6, marginBottom: 12 },
  dayCol: { flex: 1, alignItems: "center", justifyContent: "flex-end", gap: 6 },
  dayBarWrap: { width: "100%", height: 90, backgroundColor: C.raised, borderRadius: 6, overflow: "hidden", justifyContent: "flex-end" },
  dayBar: { width: "100%", borderRadius: 6 },
  dayLabel: { fontSize: 10, color: C.muted },
  weeklyFoot: { flexDirection: "row", justifyContent: "space-between", borderTopColor: C.border, borderTopWidth: 1, paddingTop: 10 },
  weeklyFootTxt: { fontSize: 10, color: C.muted },
  weeklyFootV: { color: C.text, fontWeight: "700" },

  goalRow: { backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 10 },
  goalHead: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  goalBar: { height: 6, backgroundColor: C.raised, borderRadius: 4, overflow: "hidden", marginBottom: 6 },
  goalFill: { height: 6, borderRadius: 4 },

  achievement: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 16, padding: 16 },
  achieved: { fontSize: 10, fontWeight: "700" },

  aiIntro: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: C.card, borderRadius: 18, padding: 18, borderWidth: 1, borderColor: C.border },
  aiOrb: { width: 58, height: 58, borderRadius: 29, backgroundColor: "rgba(255,87,34,.15)", alignItems: "center", justifyContent: "center" },
  promptRow: { flexDirection: "row", gap: 8, marginTop: 18, flexWrap: "wrap" },
  prompt: { borderColor: C.border, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 9 },
  promptText: { fontSize: 12, color: C.text },

  chat: { maxHeight: 350, paddingTop: 20 },
  empty: { color: C.muted, textAlign: "center", fontSize: 14 },
  bubble: { padding: 12, borderRadius: 16, maxWidth: "88%", marginBottom: 10 },
  mine: { backgroundColor: C.ember, alignSelf: "flex-end", borderBottomRightRadius: 4 },
  theirs: { backgroundColor: C.card, alignSelf: "flex-start", borderBottomLeftRadius: 4, borderWidth: 1, borderColor: C.border },
  bubbleText: { color: C.text, fontSize: 14, lineHeight: 20 },
  bubbleTime: { fontSize: 9, color: "rgba(244,245,247,0.55)", marginTop: 4, letterSpacing: 0.5 },

  composer: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 18, padding: 7, marginTop: 6 },
  mic: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, color: C.text, fontSize: 14, paddingHorizontal: 4, minHeight: 42 },
  send: { width: 42, height: 42, borderRadius: 14, backgroundColor: C.ember, alignItems: "center", justifyContent: "center" },
  saveText: { color: C.text, fontWeight: "700", fontSize: 14 },
  voiceNote: { textAlign: "center", color: C.muted, fontSize: 11, marginTop: 10 },

  deviceHero: { alignItems: "center", backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 20, padding: 25, marginBottom: 20 },
  deviceIconWrap: { alignItems: "center", justifyContent: "center", padding: 20 },
  devicePulse: { position: "absolute", width: 100, height: 100, borderRadius: 50, borderColor: "rgba(16,185,129,0.3)", borderWidth: 2 },
  deviceName: { fontSize: 22, color: C.text, fontWeight: "700", marginTop: 4 },
  deviceStats: { flexDirection: "row", gap: 22, marginTop: 22 },
  deviceStat: { alignItems: "center" },
  stat: { fontSize: 10, color: C.muted, letterSpacing: 1 },
  statVal: { fontSize: 14, color: C.text, fontWeight: "700", marginTop: 4 },

  holdWrap: { alignItems: "center", padding: 20, backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 20, marginBottom: 12 },
  holdBtn: { width: 140, height: 140, borderRadius: 70, borderColor: C.ember, borderWidth: 3, alignItems: "center", justifyContent: "center", gap: 6 },
  holdBtnConnected: { borderColor: C.green },
  holdBtnLabel: { fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  holdProgress: { position: "absolute", bottom: 0, left: 0, right: 0, height: 4, backgroundColor: C.raised, borderRadius: 2, overflow: "hidden" },
  holdProgressFill: { height: 4, backgroundColor: C.ember, borderRadius: 2 },
  holdHint: { fontSize: 10, color: C.muted, letterSpacing: 1.5, marginTop: 14 },
  quickBtn: { marginTop: 12, paddingHorizontal: 16, paddingVertical: 8, borderColor: C.border, borderWidth: 1, borderRadius: 20 },
  quickBtnTxt: { fontSize: 12, color: C.text, fontWeight: "700" },

  trackCard: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 10 },
  outline: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, borderColor: C.border },
  infoBox: { backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 14, padding: 16 },

  profile: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 18, padding: 16, marginBottom: 8 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.ember, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 20, color: C.text, fontWeight: "700" },
  settingsGroup: { fontSize: 10, letterSpacing: 2, color: C.muted, fontWeight: "700", marginTop: 20, marginBottom: 10 },
  settingRow: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 10, minHeight: 68 },

  langSwitch: { flexDirection: "row", backgroundColor: C.raised, borderRadius: 10, padding: 3 },
  langOpt: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  langOptActive: { backgroundColor: C.ember },
  langOptTxt: { fontSize: 11, color: C.muted, fontWeight: "700" },

  slider: { height: 26, backgroundColor: C.raised, borderRadius: 6, marginTop: 8, position: "relative", justifyContent: "center" },
  sliderFill: { height: 6, backgroundColor: C.green, borderRadius: 4, position: "absolute", left: 0, top: 10 },
  sliderThumb: { position: "absolute", width: 16, height: 16, borderRadius: 8, backgroundColor: C.text, top: 5, marginLeft: -8 },
  sliderTick: { position: "absolute", width: 2, height: 6, backgroundColor: "rgba(155,161,176,0.5)", top: 10, marginLeft: -1 },

  version: { textAlign: "center", color: C.muted, fontSize: 11, marginTop: 28 },

  tabs: { position: "absolute", bottom: 0, left: 0, right: 0, height: 82, backgroundColor: C.card, borderTopColor: C.border, borderTopWidth: 1, flexDirection: "row", justifyContent: "space-around", paddingTop: 12, paddingBottom: 10 },
  tab: { alignItems: "center", gap: 4, minWidth: 55 },
  tabText: { fontSize: 10, color: C.muted, fontWeight: "600" },

  toast: { position: "absolute", top: 80, alignSelf: "center", backgroundColor: "rgba(16,185,129,0.18)", borderColor: C.green, borderWidth: 1, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  toastText: { color: C.green, fontSize: 12, fontWeight: "700", letterSpacing: 1 },

  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", alignItems: "center", padding: 24 },
  modalCard: { width: "100%", backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 20, padding: 24 },
  modalInput: { backgroundColor: C.raised, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: C.text, fontSize: 15, marginTop: 6, marginBottom: 12 },
  modalActions: { flexDirection: "row", gap: 12, marginTop: 12 },

  // Real BLE panel
  betaWarn: { flexDirection: "row", gap: 10, backgroundColor: C.raised, borderRadius: 10, padding: 12, marginTop: 12, alignItems: "flex-start" },
  warnTitle: { fontSize: 13, color: C.text, fontWeight: "700", marginBottom: 2 },
  scanBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 12, marginTop: 14 },
  scanBtnTxt: { color: C.text, fontWeight: "700", fontSize: 14, letterSpacing: 1 },
  scanRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  deviceItem: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.raised, borderRadius: 10, padding: 12, marginTop: 10 },
});

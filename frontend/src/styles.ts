import { StyleSheet } from "react-native";
import type { Palette } from "@/src/theme";

export function makeStyles(C: Palette) {
  return StyleSheet.create({
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
    bubbleTime: { fontSize: 9, color: C.bubbleAlpha, marginTop: 4, letterSpacing: 0.5 },

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

    modalBg: { flex: 1, backgroundColor: C.overlay, justifyContent: "center", alignItems: "center", padding: 24 },
    modalCard: { width: "100%", backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 20, padding: 24 },
    modalInput: { backgroundColor: C.raised, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: C.text, fontSize: 15, marginTop: 6, marginBottom: 12 },
    modalActions: { flexDirection: "row", gap: 12, marginTop: 12 },

    betaWarn: { flexDirection: "row", gap: 10, backgroundColor: C.raised, borderRadius: 10, padding: 12, marginTop: 12, alignItems: "flex-start" },
    warnTitle: { fontSize: 13, color: C.text, fontWeight: "700", marginBottom: 2 },
    scanBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 12, marginTop: 14 },
    scanBtnTxt: { color: C.text, fontWeight: "700", fontSize: 14, letterSpacing: 1 },
    scanRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
    deviceItem: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.raised, borderRadius: 10, padding: 12, marginTop: 10 },

    // Theme segmented
    themeSwitch: { flexDirection: "row", backgroundColor: C.raised, borderRadius: 10, padding: 3 },
    themeOpt: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, flexDirection: "row", alignItems: "center", gap: 4 },
    themeOptActive: { backgroundColor: C.ember },
    themeOptTxt: { fontSize: 11, color: C.muted, fontWeight: "700" },

    // State & Gesture Bar
    stateBanner: { marginHorizontal: 20, marginBottom: 12, borderRadius: 14, padding: 12, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1 },
    stateText: { fontSize: 11, fontWeight: "800", letterSpacing: 1.2 },
    stateSub: { fontSize: 11, color: C.muted, marginTop: 2 },

    // Floating tracking banner
    activeTrackingPill: { marginHorizontal: 20, marginBottom: 10, backgroundColor: "rgba(16,185,129,0.14)", borderColor: C.green, borderWidth: 1, borderRadius: 16, padding: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    activeTrackingPillLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
    activeTrackingPillTitle: { fontSize: 12, color: C.green, fontWeight: "700", letterSpacing: 0.8 },
    activeTrackingPillSub: { fontSize: 11, color: C.text, marginTop: 2 },

    // Gesture Simulator Card
    gestureSimBox: { backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 18, padding: 16, marginBottom: 14 },
    gestureBtnRow: { flexDirection: "row", gap: 8, marginTop: 12 },
    gestureBtn: { flex: 1, backgroundColor: C.raised, borderColor: C.border, borderWidth: 1, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 6, alignItems: "center", justifyContent: "center", gap: 4 },
    gestureBtnText: { fontSize: 11, fontWeight: "700", color: C.text, textAlign: "center" },
    gestureBtnCode: { fontSize: 9, color: C.muted, fontWeight: "600" },
    lastGestureFeed: { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border, flexDirection: "row", alignItems: "center", gap: 8 },
    lastGestureText: { fontSize: 11, color: C.muted, flex: 1 },

    // Voice Assistant Sheet / Overlay
    voiceOverlay: { position: "absolute", bottom: 84, left: 20, right: 20, backgroundColor: C.card, borderColor: C.ember, borderWidth: 1.5, borderRadius: 20, padding: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 10, elevation: 8 },
    voiceHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
    voiceTitle: { fontSize: 13, fontWeight: "800", color: C.ember, letterSpacing: 1 },
    voiceWaveRow: { height: 38, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, marginVertical: 8 },
    voiceWaveBar: { width: 4, backgroundColor: C.ember, borderRadius: 2 },
    voiceControls: { flexDirection: "row", gap: 10, marginTop: 8 },
    voiceDiscardBtn: { flex: 1, backgroundColor: C.raised, borderRadius: 10, paddingVertical: 10, alignItems: "center", justifyContent: "center" },
    voiceDiscardTxt: { fontSize: 12, color: C.muted, fontWeight: "600" },
    voiceSendBtn: { flex: 1, backgroundColor: C.ember, borderRadius: 10, paddingVertical: 10, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
    voiceSendTxt: { fontSize: 12, color: "#fff", fontWeight: "700" },

    // Session History Item
    sessionCard: { backgroundColor: C.raised, borderRadius: 12, padding: 12, marginBottom: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    sessionTitle: { fontSize: 13, color: C.text, fontWeight: "700" },
    sessionSub: { fontSize: 11, color: C.muted, marginTop: 2 },
    sessionBadge: { backgroundColor: "rgba(16,185,129,0.14)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
    sessionBadgeTxt: { fontSize: 10, color: C.green, fontWeight: "700" },
  });
}

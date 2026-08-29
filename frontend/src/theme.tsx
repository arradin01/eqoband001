// Dark + light theme palettes and provider hook. Wraps the app so any
// screen can call `useAppTheme()` to get the palette + memoized styles.
import { createContext, ReactNode, useContext, useMemo, useState, useEffect } from "react";
import { StatusBar } from "expo-status-bar";

import { storage } from "@/src/utils/storage";
import { makeStyles } from "@/src/styles";

export type Theme = "dark" | "light";

export type Palette = {
  bg: string;
  card: string;
  raised: string;
  text: string;
  muted: string;
  ember: string;
  green: string;
  blue: string;
  purple: string;
  red: string;
  border: string;
  amber: string;
  overlay: string;
  waveMuted: string;
  bubbleAlpha: string;
};

export const PALETTES: Record<Theme, Palette> = {
  dark: {
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
    overlay: "rgba(0,0,0,0.7)",
    waveMuted: "rgba(255,255,255,0.06)",
    bubbleAlpha: "rgba(244,245,247,0.55)",
  },
  light: {
    bg: "#F6F7FB",
    card: "#FFFFFF",
    raised: "#EEF0F5",
    text: "#111827",
    muted: "#64748B",
    ember: "#EA580C",
    green: "#059669",
    blue: "#2563EB",
    purple: "#7C3AED",
    red: "#DC2626",
    border: "#E2E5EE",
    amber: "#D97706",
    overlay: "rgba(15,23,42,0.55)",
    waveMuted: "rgba(0,0,0,0.05)",
    bubbleAlpha: "rgba(17,24,39,0.55)",
  },
};

type Ctx = {
  theme: Theme;
  C: Palette;
  styles: ReturnType<typeof makeStyles>;
  setTheme: (t: Theme) => void;
  ready: boolean;
};

const ThemeCtx = createContext<Ctx>({
  theme: "dark",
  C: PALETTES.dark,
  styles: makeStyles(PALETTES.dark),
  setTheme: () => {},
  ready: false,
});

const K_THEME = "eqo:theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const saved = await storage.getItem<string>(K_THEME, "dark");
      if (saved === "dark" || saved === "light") setThemeState(saved);
      setReady(true);
    })();
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    storage.setItem(K_THEME, t);
  };

  const value = useMemo(() => {
    const C = PALETTES[theme];
    return { theme, C, styles: makeStyles(C), setTheme, ready };
  }, [theme, ready]);

  return (
    <ThemeCtx.Provider value={value}>
      <StatusBar style={theme === "dark" ? "light" : "dark"} />
      {children}
    </ThemeCtx.Provider>
  );
}

export const useAppTheme = () => useContext(ThemeCtx);

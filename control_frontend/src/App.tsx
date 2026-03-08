import { useState, useEffect, useRef, useCallback, type CSSProperties } from "react";
import "./App.css";

import { RotaryEncoder, type RotaryEvent } from "./lib/RotaryEncoder";
import {
  isLoggedIn,
  initiateLogin,
  exchangeCode,
  getPlaybackState,
  play,
  pause,
  nextTrack,
  previousTrack,
  seekToPosition,
  setVolume,
  getLyrics,
  type PlaybackState,
  type LyricsState,
} from "./lib/spotify";
import {
  getHomeAssistantStates,
  getHomeAssistantTodoItems,
  hasHomeAssistantCredentials,
  loadHomeAssistantPanelConfig,
  toggleHomeAssistantEntity,
  setHomeAssistantBrightness,
  type HomeAssistantEntityState,
  type HomeAssistantPanelConfig,
  type HomeAssistantTodoItem,
  type HomeAssistantDeviceConfig,
} from "./lib/homeAssistant";

const WS_URL = "ws://localhost:6789";
const VOLUME_STEP = 2;
const SEEK_STEP_MS = 5_000;
const VOLUME_COMMIT_MS = 160;
const SEEK_COMMIT_MS = 120;
const VOLUME_SYNC_GRACE_MS = 1_200;
const SEEK_SYNC_GRACE_MS = 1_200;
const SPOTIFY_POLL_INTERVAL_MS = 2_000;
const HOME_POLL_INTERVAL_MS = 10_000;
const HOME_BRIGHTNESS_STEP = 5;
const HOME_BRIGHTNESS_COMMIT_MS = 150;
const HOME_BRIGHTNESS_SYNC_GRACE_MS = 1_200;
const LYRIC_LEAD_MS = 40;

const SPOTIFY_NAV_ITEMS = ["prev", "play", "next", "progress", "volume"] as const;
const TABS = ["spotify", "home"] as const;

type NavItem = (typeof SPOTIFY_NAV_ITEMS)[number];
type AppTab = (typeof TABS)[number];
type AuthState = "loading" | "unauthenticated" | "authenticated";

type FocusTarget =
  | { kind: "tab"; tab: AppTab }
  | { kind: "spotify-login" }
  | { kind: "spotify-control"; item: NavItem }
  | { kind: "home-device"; entityId: string }
  | { kind: "home-brightness"; entityId: string }
  | { kind: "home-todo"; entityId: string };

interface SyncedLyricLine {
  timeMs: number;
  text: string;
}

interface LineProgress {
  fill: number;
}

function getApproximateWordIndex(text: string, fill: number): number {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return -1;
  return Math.max(0, Math.min(words.length - 1, Math.floor(fill * words.length)));
}

function fmt(ms: number) {
  const seconds = Math.floor(ms / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function getTabLabel(tab: AppTab) {
  return tab === "spotify" ? "Spotify" : "Home";
}

function parseTimestampToMs(timestamp: string): number | null {
  const match = timestamp.match(/^(\d+):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) return null;

  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const fraction = match[3] ?? "0";
  const millis = Number(fraction.padEnd(3, "0").slice(0, 3));
  return (minutes * 60 + seconds) * 1000 + millis;
}

function parseSyncedLyrics(lyrics: string | null | undefined): SyncedLyricLine[] {
  if (!lyrics) return [];

  return lyrics
    .split("\n")
    .flatMap((line) => {
      const matches = [...line.matchAll(/\[(\d+:\d{2}(?:\.\d{1,3})?)\]/g)];
      const withoutLineTags = line.replace(/\[[^\]]+\]/g, "");
      const text = withoutLineTags.replace(/<[^>]+>/g, "").trim();

      if (!matches.length || !text) return [];

      return matches
        .map((match) => parseTimestampToMs(match[1]))
        .filter((timeMs): timeMs is number => timeMs !== null)
        .map((timeMs) => ({ timeMs, text }));
    })
    .sort((left, right) => left.timeMs - right.timeMs);
}

function findActiveLyricIndex(lines: SyncedLyricLine[], progressMs: number): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (progressMs >= lines[index].timeMs) return index;
  }

  return -1;
}

function getLineProgress(
  lines: SyncedLyricLine[],
  lineIndex: number,
  progressMs: number,
  trackDurationMs: number,
): LineProgress {
  const line = lines[lineIndex];
  const nextLineStart = lines[lineIndex + 1]?.timeMs ?? trackDurationMs;
  const segmentDuration = Math.max(500, nextLineStart - line.timeMs);
  const clamped = Math.max(0, Math.min(segmentDuration, progressMs - line.timeMs));
  const fill = Math.max(0, Math.min(1, clamped / segmentDuration));

  return { fill };
}

function getBrightnessPercentFromState(state: HomeAssistantEntityState | undefined): number | null {
  if (!state) return null;

  const rawBrightness = state.attributes.brightness;
  if (typeof rawBrightness === "number") {
    return Math.max(0, Math.min(100, Math.round((rawBrightness / 255) * 100)));
  }

  return state.state === "on" ? 100 : 0;
}

function isBrightnessCapable(device: HomeAssistantDeviceConfig, state: HomeAssistantEntityState | undefined): boolean {
  const domain = device.entityId.split(".")[0] ?? "";
  return domain === "light" || typeof state?.attributes.brightness === "number" || device.icon === "light";
}

function getHomeDeviceSubtitle(state: HomeAssistantEntityState | undefined): string {
  if (!state) return "Unavailable";

  return state.state.replace(/_/g, " ");
}

function getTodoPreview(items: HomeAssistantTodoItem[] | undefined): HomeAssistantTodoItem[] {
  if (!items) return [];
  return items.filter((item) => item.status !== "completed").slice(0, 4);
}

function SpotifyLogo() {
  return (
    <svg className="spotify-logo" viewBox="0 0 168 168" xmlns="http://www.w3.org/2000/svg">
      <circle cx="84" cy="84" r="84" fill="#1DB954" />
      <path
        fill="#fff"
        d="M120.3 118.5c-1.2 2-3.8 2.7-5.8 1.5-17-10-38-12.1-62.7-6.6-2.2.5-4.4-.9-4.9-3.1-.5-2.2.9-4.4 3.1-4.9 26.9-6 50-3.6 69.1 7.7 2 1.2 2.4 3.4 1.2 5.4zm8.5-18.1c-1.5 2.5-4.7 3.3-7.2 1.9C102 91.6 72.6 88.6 49.6 95.6c-2.8.9-5.8-.7-6.6-3.5-.9-2.8.7-5.8 3.5-6.6 26.2-7.8 58.5-4.4 80.9 8 2.5 1.4 3.4 4.6 1.9 6.9zm.7-18.6C106.3 68.8 68.5 67.6 46.3 74.4c-3.4 1-7-.9-8.1-4.3-1-3.4.9-7 4.3-8.1 25.5-7.7 67-6.3 93.9 8.6 3.1 1.8 4.1 5.8 2.3 8.9-1.7 3-5.8 4-9.2 2.3z"
      />
    </svg>
  );
}

function PreviousIcon() {
  return (
    <svg className="ctrl-icon ctrl-icon--prev" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17 6.5a1 1 0 0 0-1.55-.83L7 11.5a1 1 0 0 0 0 1.67l8.45 5.83A1 1 0 0 0 17 18.17z" fill="currentColor" />
      <rect x="17.5" y="5.5" width="2.5" height="13" rx="1" fill="currentColor" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg className="ctrl-icon ctrl-icon--next" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 6.5a1 1 0 0 1 1.55-.83L17 11.5a1 1 0 0 1 0 1.67l-8.45 5.83A1 1 0 0 1 7 18.17z" fill="currentColor" />
      <rect x="4" y="5.5" width="2.5" height="13" rx="1" fill="currentColor" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg className="ctrl-icon ctrl-icon--play" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 6.6c0-.78.85-1.26 1.52-.87l8.15 4.8c.66.4.66 1.35 0 1.74l-8.15 4.8A1 1 0 0 1 8 16.2z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg className="ctrl-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="6" width="3.5" height="12" rx="1" fill="currentColor" />
      <rect x="13.5" y="6" width="3.5" height="12" rx="1" fill="currentColor" />
    </svg>
  );
}

function SeekIcon() {
  return (
    <svg className="seek-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function HomeIcon({ kind }: { kind?: string }) {
  if (kind === "switch") {
    return (
      <svg className="home-card-icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="8" width="16" height="8" rx="4" fill="currentColor" opacity="0.35" />
        <circle cx="9" cy="12" r="3" fill="currentColor" />
      </svg>
    );
  }

  if (kind === "todo") {
    return (
      <svg className="home-card-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 6h10v2H7zM7 11h10v2H7zM7 16h6v2H7z" fill="currentColor" />
        <path d="M5.5 11.5 4 10l-1 1 2.5 2.5L9 10l-1-1z" fill="currentColor" />
      </svg>
    );
  }

  return (
    <svg className="home-card-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 21h6v-1.5H9zm3-19a6 6 0 0 0-3.72 10.7c.86.68 1.72 1.72 2.01 2.8h3.42c.29-1.08 1.15-2.12 2.01-2.8A6 6 0 0 0 12 2z" fill="currentColor" />
    </svg>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>("spotify");
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const [volume, setVolumeState] = useState(50);
  const [displayMs, setDisplayMs] = useState(0);
  const [wsConnected, setWsConnected] = useState(false);
  const [focusIdx, setFocusIdx] = useState(3);
  const [progressEditing, setProgressEditing] = useState(false);
  const [volumeEditing, setVolumeEditing] = useState(false);
  const [lyrics, setLyrics] = useState<LyricsState | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [homeConfig, setHomeConfig] = useState<HomeAssistantPanelConfig>({ devices: [], todoLists: [] });
  const [homeConfigLoading, setHomeConfigLoading] = useState(true);
  const [homeLoading, setHomeLoading] = useState(false);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [homeDeviceStates, setHomeDeviceStates] = useState<Record<string, HomeAssistantEntityState>>({});
  const [homeTodoItems, setHomeTodoItems] = useState<Record<string, HomeAssistantTodoItem[]>>({});
  const [homeBrightnessLevels, setHomeBrightnessLevels] = useState<Record<string, number>>({});
  const [homeActionPending, setHomeActionPending] = useState<string | null>(null);
  const [homeBrightnessEditingId, setHomeBrightnessEditingId] = useState<string | null>(null);

  const playbackRef = useRef<PlaybackState | null>(null);
  const pollTimeRef = useRef<number>(Date.now());
  const displayMsRef = useRef(0);
  const volumeRef = useRef(50);
  const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const volumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const homeBrightnessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSeekRequestRef = useRef<number | null>(null);
  const lastVolumeRequestRef = useRef<number | null>(null);
  const lastHomeBrightnessRequestRef = useRef<Record<string, number>>({});
  const inflightSeekRef = useRef<Promise<void> | null>(null);
  const inflightVolumeRef = useRef<Promise<void> | null>(null);
  const inflightHomeBrightnessRef = useRef<Promise<void> | null>(null);
  const queuedSeekRef = useRef<number | null>(null);
  const queuedVolumeRef = useRef<number | null>(null);
  const queuedHomeBrightnessRef = useRef<{ entityId: string; percent: number } | null>(null);
  const focusIdxRef = useRef(3);
  const progressEditingRef = useRef(false);
  const volumeEditingRef = useRef(false);
  const homeConfigRef = useRef<HomeAssistantPanelConfig>({ devices: [], todoLists: [] });
  const homeBrightnessLevelsRef = useRef<Record<string, number>>({});
  const homeBrightnessEditingIdRef = useRef<string | null>(null);
  const focusTargetsRef = useRef<FocusTarget[]>([]);
  const focusedTargetRef = useRef<FocusTarget>({ kind: "tab", tab: "home" });
  const selectedItemRef = useRef<NavItem | null>(null);
  const performFocusedActionRef = useRef<() => void>(() => {});

  const setFocusedIndex = useCallback((nextIndex: number) => {
    focusIdxRef.current = nextIndex;
    setFocusIdx(nextIndex);
  }, []);

  const setProgressEditingState = useCallback((next: boolean) => {
    progressEditingRef.current = next;
    setProgressEditing(next);
  }, []);

  const setVolumeEditingState = useCallback((next: boolean) => {
    volumeEditingRef.current = next;
    setVolumeEditing(next);
  }, []);

  const setHomeBrightnessEditingState = useCallback((entityId: string | null) => {
    homeBrightnessEditingIdRef.current = entityId;
    setHomeBrightnessEditingId(entityId);
  }, []);

  useEffect(() => {
    homeConfigRef.current = homeConfig;
  }, [homeConfig]);

  useEffect(() => {
    homeBrightnessLevelsRef.current = homeBrightnessLevels;
  }, [homeBrightnessLevels]);

  const refreshHomeData = useCallback(async (configOverride?: HomeAssistantPanelConfig) => {
    const config = configOverride ?? homeConfigRef.current;

    if (!hasHomeAssistantCredentials()) {
      setHomeDeviceStates({});
      setHomeTodoItems({});
      setHomeError("Set VITE_HOME_ASSISTANT_URL and VITE_HOME_ASSISTANT_TOKEN in your env to enable Home Assistant.");
      return;
    }

    setHomeLoading(true);
    setHomeError(null);

    try {
      const [states, todoEntries] = await Promise.all([
        config.devices.length > 0
          ? getHomeAssistantStates(config.devices.map((device) => device.entityId))
          : Promise.resolve({}),
        Promise.all(config.todoLists.map(async (list) => [list.entityId, await getHomeAssistantTodoItems(list.entityId)] as const)),
      ]);

      setHomeDeviceStates(states);
      setHomeTodoItems(Object.fromEntries(todoEntries));
      setHomeBrightnessLevels((current) => {
        const next = { ...current };

        config.devices.forEach((device) => {
          const state = states[device.entityId];
          const brightness = getBrightnessPercentFromState(state);
          const lastRequest = lastHomeBrightnessRequestRef.current[device.entityId] ?? 0;
          const waitingForSync = Date.now() - lastRequest < HOME_BRIGHTNESS_SYNC_GRACE_MS;

          if (brightness !== null && !waitingForSync) {
            next[device.entityId] = brightness;
          }
        });

        return next;
      });
    } catch (error) {
      setHomeError(error instanceof Error ? error.message : "Failed to refresh Home Assistant data.");
    } finally {
      setHomeLoading(false);
    }
  }, []);

  const reloadHomePanel = useCallback(async () => {
    setHomeConfigLoading(true);
    setHomeError(null);

    try {
      const config = await loadHomeAssistantPanelConfig();
      setHomeConfig(config);
      await refreshHomeData(config);
    } catch (error) {
      setHomeError(error instanceof Error ? error.message : "Failed to load Home Assistant panel configuration.");
    } finally {
      setHomeConfigLoading(false);
    }
  }, [refreshHomeData]);

  const switchTab = useCallback((nextTab: AppTab) => {
    setProgressEditingState(false);
    setVolumeEditingState(false);
    setHomeBrightnessEditingState(null);
    setActiveTab(nextTab);
    setFocusedIndex(nextTab === "spotify" ? (authState === "unauthenticated" ? 2 : 3) : 2);
  }, [authState, setFocusedIndex, setHomeBrightnessEditingState, setProgressEditingState, setVolumeEditingState]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) {
      window.history.replaceState({}, "", "/");
      exchangeCode(code)
        .then(() => setAuthState("authenticated"))
        .catch(() => setAuthState("unauthenticated"));
    } else {
      setAuthState(isLoggedIn() ? "authenticated" : "unauthenticated");
    }
  }, []);

  useEffect(() => {
    if (authState !== "authenticated") return;
    let alive = true;

    async function poll() {
      try {
        const state = await getPlaybackState();
        if (!alive) return;
        if (state) {
          const waitingForSeekAck =
            lastSeekRequestRef.current !== null
            && Date.now() - lastSeekRequestRef.current < SEEK_SYNC_GRACE_MS;
          const polledVolume = state.device?.volume_percent ?? 50;
          const waitingForVolumeAck =
            lastVolumeRequestRef.current !== null
            && Date.now() - lastVolumeRequestRef.current < VOLUME_SYNC_GRACE_MS;

          const nextPlayback = waitingForSeekAck && playbackRef.current
            ? { ...state, progress_ms: playbackRef.current.progress_ms }
            : state;

          playbackRef.current = nextPlayback;
          pollTimeRef.current = Date.now();
          setPlayback(nextPlayback);

          if (!waitingForVolumeAck) {
            volumeRef.current = polledVolume;
            setVolumeState(polledVolume);
          }

          if (!waitingForSeekAck) {
            displayMsRef.current = state.progress_ms;
            setDisplayMs(state.progress_ms);
          }
        } else {
          playbackRef.current = null;
          pollTimeRef.current = Date.now();
          setPlayback(null);
        }
      } catch {}

      if (alive) setTimeout(poll, SPOTIFY_POLL_INTERVAL_MS);
    }

    poll();
    return () => { alive = false; };
  }, [authState]);

  useEffect(() => {
    let frameId = 0;

    const tick = () => {
      const pb = playbackRef.current;
      if (pb?.item) {
        const nextMs = pb.is_playing
          ? Math.min(pb.progress_ms + (Date.now() - pollTimeRef.current), pb.item.duration_ms)
          : pb.progress_ms;

        displayMsRef.current = nextMs;
        setDisplayMs(nextMs);
      }

      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  useEffect(() => {
    if (authState !== "authenticated") {
      setLyrics(null);
      setLyricsLoading(false);
      return;
    }

    const trackId = playback?.item?.id;
    if (!trackId || !playback?.item) {
      setLyrics(null);
      setLyricsLoading(false);
      return;
    }

    let cancelled = false;
    setLyricsLoading(true);

    getLyrics({
      trackName: playback.item.name,
      artistName: playback.item.artists[0]?.name ?? "",
      albumName: playback.item.album.name,
      durationMs: playback.item.duration_ms,
    })
      .then((result) => {
        if (!cancelled) setLyrics(result);
      })
      .catch(() => {
        if (!cancelled) setLyrics(null);
      })
      .finally(() => {
        if (!cancelled) setLyricsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authState, playback?.item?.id]);

  useEffect(() => {
    reloadHomePanel().catch(() => {});
  }, [reloadHomePanel]);

  useEffect(() => {
    if (homeConfigLoading) return;

    const intervalId = window.setInterval(() => {
      refreshHomeData().catch(() => {});
    }, HOME_POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [homeConfigLoading, refreshHomeData]);

  const commitVolume = useCallback((nextVolume: number) => {
    queuedVolumeRef.current = nextVolume;

    if (inflightVolumeRef.current) return;

    const run = async () => {
      while (queuedVolumeRef.current !== null) {
        const target = queuedVolumeRef.current;
        queuedVolumeRef.current = null;
        lastVolumeRequestRef.current = Date.now();
        try {
          await setVolume(target);
          volumeRef.current = target;
        } catch {}
      }
    };

    const promise = run().finally(() => {
      inflightVolumeRef.current = null;
    });

    inflightVolumeRef.current = promise;
  }, []);

  const scheduleVolumeCommit = useCallback((nextVolume: number) => {
    if (volumeTimerRef.current) clearTimeout(volumeTimerRef.current);
    volumeTimerRef.current = setTimeout(() => {
      commitVolume(nextVolume);
    }, VOLUME_COMMIT_MS);
  }, [commitVolume]);

  const commitSeek = useCallback((nextPositionMs: number) => {
    queuedSeekRef.current = nextPositionMs;

    if (inflightSeekRef.current) return;

    const run = async () => {
      while (queuedSeekRef.current !== null) {
        const target = queuedSeekRef.current;
        queuedSeekRef.current = null;
        lastSeekRequestRef.current = Date.now();
        try {
          await seekToPosition(target);
          if (playbackRef.current) {
            playbackRef.current = { ...playbackRef.current, progress_ms: target };
            pollTimeRef.current = Date.now();
          }
        } catch {}
      }
    };

    const promise = run().finally(() => {
      inflightSeekRef.current = null;
    });

    inflightSeekRef.current = promise;
  }, []);

  const scheduleSeekCommit = useCallback((nextPositionMs: number) => {
    if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
    seekTimerRef.current = setTimeout(() => {
      commitSeek(nextPositionMs);
    }, SEEK_COMMIT_MS);
  }, [commitSeek]);

  const commitHomeBrightness = useCallback((entityId: string, percent: number) => {
    queuedHomeBrightnessRef.current = { entityId, percent };

    if (inflightHomeBrightnessRef.current) return;

    const run = async () => {
      while (queuedHomeBrightnessRef.current !== null) {
        const target = queuedHomeBrightnessRef.current;
        queuedHomeBrightnessRef.current = null;
        lastHomeBrightnessRequestRef.current[target.entityId] = Date.now();
        try {
          await setHomeAssistantBrightness(target.entityId, target.percent);
        } catch {}
      }
    };

    const promise = run().finally(() => {
      inflightHomeBrightnessRef.current = null;
    });

    inflightHomeBrightnessRef.current = promise;
  }, []);

  const scheduleHomeBrightnessCommit = useCallback((entityId: string, percent: number) => {
    if (homeBrightnessTimerRef.current) clearTimeout(homeBrightnessTimerRef.current);
    homeBrightnessTimerRef.current = setTimeout(() => {
      commitHomeBrightness(entityId, percent);
    }, HOME_BRIGHTNESS_COMMIT_MS);
  }, [commitHomeBrightness]);

  const toggleDevice = useCallback(async (entityId: string) => {
    const previousState = homeDeviceStates[entityId];

    if (previousState) {
      setHomeDeviceStates((current) => ({
        ...current,
        [entityId]: {
          ...previousState,
          state: previousState.state === "on" ? "off" : "on",
        },
      }));
    }

    setHomeActionPending(entityId);

    try {
      await toggleHomeAssistantEntity(entityId);
      await refreshHomeData();
    } catch (error) {
      if (previousState) {
        setHomeDeviceStates((current) => ({
          ...current,
          [entityId]: previousState,
        }));
      }
      setHomeError(error instanceof Error ? error.message : "Failed to toggle Home Assistant entity.");
    } finally {
      setHomeActionPending(null);
    }
  }, [homeDeviceStates, refreshHomeData]);

  const focusTargets: FocusTarget[] = [
    { kind: "tab", tab: "spotify" },
    { kind: "tab", tab: "home" },
  ];

  if (activeTab === "spotify") {
    if (authState === "unauthenticated") {
      focusTargets.push({ kind: "spotify-login" });
    } else if (authState === "authenticated") {
      SPOTIFY_NAV_ITEMS.forEach((item) => {
        focusTargets.push({ kind: "spotify-control", item });
      });
    }
  } else {
    homeConfig.devices.forEach((device) => {
      const state = homeDeviceStates[device.entityId];
      focusTargets.push({ kind: "home-device", entityId: device.entityId });
      if (isBrightnessCapable(device, state)) {
        focusTargets.push({ kind: "home-brightness", entityId: device.entityId });
      }
    });
    homeConfig.todoLists.forEach((list) => {
      focusTargets.push({ kind: "home-todo", entityId: list.entityId });
    });
  }

  useEffect(() => {
    const maxIndex = Math.max(0, focusTargets.length - 1);
    if (focusIdxRef.current > maxIndex) {
      setFocusedIndex(maxIndex);
    }
  }, [focusTargets.length, setFocusedIndex]);

  const focusedTarget = focusTargets[focusIdx] ?? focusTargets[0];
  const selectedItem = focusedTarget.kind === "spotify-control" ? focusedTarget.item : null;

  const performFocusedAction = useCallback(() => {
    if (focusedTarget.kind === "tab") {
      switchTab(focusedTarget.tab);
      return;
    }

    if (focusedTarget.kind === "spotify-login") {
      initiateLogin().catch(() => {});
      return;
    }

    if (focusedTarget.kind === "spotify-control") {
      if (focusedTarget.item === "progress") {
        setProgressEditingState(!progressEditingRef.current);
      } else if (focusedTarget.item === "volume") {
        setVolumeEditingState(!volumeEditingRef.current);
      } else if (focusedTarget.item === "prev") {
        previousTrack().catch(() => {});
      } else if (focusedTarget.item === "play") {
        const playbackState = playbackRef.current;
        (playbackState?.is_playing ? pause() : play()).catch(() => {});
      } else if (focusedTarget.item === "next") {
        nextTrack().catch(() => {});
      }
      return;
    }

    if (focusedTarget.kind === "home-refresh") {
      reloadHomePanel().catch(() => {});
      return;
    }

    if (focusedTarget.kind === "home-device") {
      toggleDevice(focusedTarget.entityId).catch(() => {});
      return;
    }

    if (focusedTarget.kind === "home-brightness") {
      setHomeBrightnessEditingState(
        homeBrightnessEditingIdRef.current === focusedTarget.entityId ? null : focusedTarget.entityId,
      );
      return;
    }

    refreshHomeData().catch(() => {});
  }, [focusedTarget, refreshHomeData, reloadHomePanel, setHomeBrightnessEditingState, setProgressEditingState, setVolumeEditingState, switchTab, toggleDevice]);

  useEffect(() => {
    focusTargetsRef.current = focusTargets;
    focusedTargetRef.current = focusedTarget;
    selectedItemRef.current = selectedItem;
    performFocusedActionRef.current = performFocusedAction;
  }, [focusTargets, focusedTarget, performFocusedAction, selectedItem]);

  useEffect(() => {
    const encoder = new RotaryEncoder(WS_URL);
    const cleanupStatus = encoder.onStatus(setWsConnected);

    const cleanupEvent = encoder.onEvent((event: RotaryEvent) => {
      if (event.type === "rotate") {
        if (selectedItemRef.current === "progress" && progressEditingRef.current) {
          const durationMs = playbackRef.current?.item?.duration_ms ?? 0;
          if (durationMs > 0) {
            const nextPositionMs = Math.max(0, Math.min(durationMs, displayMsRef.current + event.delta * SEEK_STEP_MS));
            if (playbackRef.current) {
              playbackRef.current = { ...playbackRef.current, progress_ms: nextPositionMs };
            }
            pollTimeRef.current = Date.now();
            displayMsRef.current = nextPositionMs;
            setDisplayMs(nextPositionMs);
            scheduleSeekCommit(nextPositionMs);
          }
        } else if (selectedItemRef.current === "volume" && volumeEditingRef.current) {
          const nextVolume = Math.max(0, Math.min(100, volumeRef.current + event.delta * VOLUME_STEP));
          volumeRef.current = nextVolume;
          setVolumeState(nextVolume);
          scheduleVolumeCommit(nextVolume);
        } else if (
          focusedTargetRef.current.kind === "home-brightness"
          && homeBrightnessEditingIdRef.current === focusedTargetRef.current.entityId
        ) {
          const entityId = focusedTargetRef.current.entityId;
          const currentBrightness = homeBrightnessLevelsRef.current[entityId] ?? 0;
          const nextBrightness = Math.max(1, Math.min(100, currentBrightness + event.delta * HOME_BRIGHTNESS_STEP));
          setHomeBrightnessLevels((current) => ({
            ...current,
            [entityId]: nextBrightness,
          }));
          setHomeDeviceStates((current) => {
            const state = current[entityId];
            if (!state) return current;

            return {
              ...current,
              [entityId]: {
                ...state,
                state: "on",
                attributes: {
                  ...state.attributes,
                  brightness: Math.round((nextBrightness / 100) * 255),
                },
              },
            };
          });
          scheduleHomeBrightnessCommit(entityId, nextBrightness);
        } else {
          const dir = Math.sign(event.delta);
          const nextIndex = Math.max(0, Math.min(focusTargetsRef.current.length - 1, focusIdxRef.current + dir));
          if (nextIndex !== focusIdxRef.current && progressEditingRef.current) {
            setProgressEditingState(false);
          }
          if (nextIndex !== focusIdxRef.current && volumeEditingRef.current) {
            setVolumeEditingState(false);
          }
          if (nextIndex !== focusIdxRef.current && homeBrightnessEditingIdRef.current) {
            setHomeBrightnessEditingState(null);
          }
          setFocusedIndex(nextIndex);
        }
      } else if (event.type === "button" && !event.pressed) {
        performFocusedActionRef.current();
      }
    });

    return () => {
      if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
      if (volumeTimerRef.current) clearTimeout(volumeTimerRef.current);
      if (homeBrightnessTimerRef.current) clearTimeout(homeBrightnessTimerRef.current);
      cleanupEvent();
      cleanupStatus();
      encoder.close();
    };
  }, [scheduleHomeBrightnessCommit, scheduleSeekCommit, scheduleVolumeCommit, setFocusedIndex, setHomeBrightnessEditingState, setProgressEditingState, setVolumeEditingState]);

  const track = playback?.item ?? null;
  const albumArt = track?.album.images[0]?.url ?? null;
  const artistName = track?.artists.map((artist) => artist.name).join(", ") ?? "";
  const trackName = track?.name ?? "";
  const albumName = track?.album.name ?? "";
  const duration = track?.duration_ms ?? 1;
  const progress = Math.min(displayMs / duration, 1);
  const lyricDisplayMs = Math.max(0, displayMs + LYRIC_LEAD_MS);
  const syncedLyrics = parseSyncedLyrics(lyrics?.syncedLyrics);
  const activeLyricIndex = syncedLyrics.length > 0 ? findActiveLyricIndex(syncedLyrics, lyricDisplayMs) : -1;
  const visibleSyncedLyrics = activeLyricIndex >= 0
    ? syncedLyrics.slice(Math.max(0, activeLyricIndex - 2), Math.min(syncedLyrics.length, activeLyricIndex + 4))
    : syncedLyrics.slice(0, 6);
  const fallbackLyricsLines = lyrics?.plainLyrics
    ? lyrics.plainLyrics
        .split("\n")
        .map((line) => line.replace(/^\[[^\]]+\]\s*/, "").trim())
        .filter(Boolean)
        .slice(0, 8)
    : [];
  const hasLyricsContent = lyricsLoading || visibleSyncedLyrics.length > 0 || fallbackLyricsLines.length > 0;

  const interactionLabel = focusedTarget.kind === "tab"
    ? "Tabs"
    : focusedTarget.kind === "spotify-login"
    ? "Spotify"
    : focusedTarget.kind === "spotify-control" && focusedTarget.item === "progress" && progressEditing
    ? "Seeking"
    : focusedTarget.kind === "spotify-control" && focusedTarget.item === "progress"
    ? "Progress"
    : focusedTarget.kind === "spotify-control" && focusedTarget.item === "volume" && volumeEditing
    ? "Adjusting"
    : focusedTarget.kind === "spotify-control" && focusedTarget.item === "volume"
    ? "Volume"
    : focusedTarget.kind === "spotify-control"
    ? "Transport"
    : focusedTarget.kind === "home-refresh"
    ? "Refresh"
    : focusedTarget.kind === "home-device"
    ? "Device"
    : focusedTarget.kind === "home-brightness" && homeBrightnessEditingId === focusedTarget.entityId
    ? "Brightness"
    : focusedTarget.kind === "home-brightness"
    ? "Dimmer"
    : "Todo";

  const interactionHint = focusedTarget.kind === "tab"
    ? "Press to switch tabs."
    : focusedTarget.kind === "spotify-login"
    ? "Press to connect Spotify."
    : focusedTarget.kind === "spotify-control" && focusedTarget.item === "progress" && progressEditing
    ? "Rotate to seek. Press to stop."
    : focusedTarget.kind === "spotify-control" && focusedTarget.item === "progress"
    ? "Press to scrub with the knob."
    : focusedTarget.kind === "spotify-control" && focusedTarget.item === "volume" && volumeEditing
    ? "Rotate to change volume. Press to stop."
    : focusedTarget.kind === "spotify-control" && focusedTarget.item === "volume"
    ? "Press to adjust volume."
    : focusedTarget.kind === "spotify-control"
    ? "Rotate to choose a control. Press to activate it."
    : focusedTarget.kind === "home-refresh"
    ? "Press to reload Home Assistant devices and lists."
    : focusedTarget.kind === "home-device"
    ? "Press to toggle this device."
    : focusedTarget.kind === "home-brightness" && homeBrightnessEditingId === focusedTarget.entityId
    ? "Rotate to change brightness. Press to stop."
    : focusedTarget.kind === "home-brightness"
    ? "Press to adjust brightness with the knob."
    : "Press to refresh the todo list preview.";

  function handlePlayPause() {
    (playback?.is_playing ? pause() : play()).catch(() => {});
  }

  return (
    <div className="app-shell">
      {!wsConnected ? (
        <div className="ws-banner">Encoder disconnected. Reconnecting.</div>
      ) : null}

      <div className="tab-strip tab-strip--overlay" role="tablist" aria-label="Panel tabs">
        {TABS.map((tab, index) => {
          const isActive = activeTab === tab;
          const isFocused = focusIdx === index;

          return (
            <button
              key={tab}
              type="button"
              className={[
                "tab-chip",
                isActive ? "tab-chip--active" : "",
                isFocused ? "tab-chip--focused" : "",
              ].filter(Boolean).join(" ")}
              onClick={() => switchTab(tab)}
            >
              <span className="tab-chip-label">{getTabLabel(tab)}</span>
            </button>
          );
        })}
      </div>

      <main className="app-content">
        {activeTab === "spotify" ? (
          authState === "loading" ? (
            <div className="loading">
              <div className="spinner" />
            </div>
          ) : authState === "unauthenticated" ? (
            <div className="login-screen">
              <div className="login-card">
                <SpotifyLogo />
                <h1>Spotify</h1>
                <p>Connect Spotify to use transport, progress scrubbing, and the lyrics view.</p>
                <button
                  className={[
                    "login-btn",
                    focusedTarget.kind === "spotify-login" ? "login-btn--focused" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => initiateLogin().catch(() => {})}
                >
                  Connect to Spotify
                </button>
              </div>
            </div>
          ) : !track ? (
            <div className="car-thing car-thing--idle">
              <div className="album-panel">
                <div className="album-art album-art--placeholder album-art--idle" />
              </div>

              <div className="info-panel info-panel--idle">
                <div className="track-meta track-meta--idle">
                  <div className="artist-name artist-name--ghost">Spotify</div>
                  <div className="track-name track-name--ghost">Nothing playing</div>
                  <div className="album-name album-name--ghost">Start playback on any device to control it here.</div>
                </div>

                <div className="controls controls--ghost" aria-hidden="true">
                  <div className="ctrl-btn ctrl-btn--ghost"><PreviousIcon /></div>
                  <div className="ctrl-btn ctrl-btn--play ctrl-btn--ghost"><PlayIcon /></div>
                  <div className="ctrl-btn ctrl-btn--ghost"><NextIcon /></div>
                </div>

                <div className="progress-section progress-section--ghost" aria-hidden="true">
                  <SeekIcon />
                  <div className="progress-body">
                    <div className="progress-time">
                      <span>0:00</span>
                      <span>0:00</span>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-fill progress-fill--ghost" style={{ transform: "scaleX(0.28)" }} />
                    </div>
                  </div>
                </div>

                <div className="volume-section volume-section--ghost" aria-hidden="true">
                  <svg className="vol-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                  </svg>
                  <div className="volume-bar">
                    <div className="volume-fill volume-fill--ghost" style={{ width: "38%" }} />
                  </div>
                  <span className="volume-num">--</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="car-thing">
              <div className="album-panel">
                {albumArt ? (
                  <img className="album-art" src={albumArt} alt={albumName} />
                ) : (
                  <div className="album-art album-art--placeholder" />
                )}
              </div>

              <div className="info-panel">
                <div className="track-meta">
                  <div className="artist-name">{artistName}</div>
                  <div className="track-name">{trackName}</div>
                  <div className="album-name">{albumName}</div>
                </div>

                <div className="controls">
                  <button
                    className={[
                      "ctrl-btn",
                      selectedItem === "prev" ? "ctrl-btn--focused" : "",
                    ].filter(Boolean).join(" ")}
                    onClick={() => previousTrack().catch(() => {})}
                    aria-label="Previous"
                  >
                    <PreviousIcon />
                  </button>
                  <button
                    className={[
                      "ctrl-btn ctrl-btn--play",
                      selectedItem === "play" ? "ctrl-btn--focused" : "",
                    ].filter(Boolean).join(" ")}
                    onClick={handlePlayPause}
                    aria-label={playback?.is_playing ? "Pause" : "Play"}
                  >
                    {playback?.is_playing ? <PauseIcon /> : <PlayIcon />}
                  </button>
                  <button
                    className={[
                      "ctrl-btn",
                      selectedItem === "next" ? "ctrl-btn--focused" : "",
                    ].filter(Boolean).join(" ")}
                    onClick={() => nextTrack().catch(() => {})}
                    aria-label="Next"
                  >
                    <NextIcon />
                  </button>
                </div>

                <div className={[
                  "progress-section",
                  selectedItem === "progress" ? "progress-section--focused" : "",
                  progressEditing ? "progress-section--editing" : "",
                ].filter(Boolean).join(" ")}>
                  <SeekIcon />
                  <div className="progress-body">
                    <div className="progress-time">
                      <span>{fmt(displayMs)}</span>
                      <span>{fmt(duration)}</span>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ transform: `scaleX(${progress})` }} />
                    </div>
                  </div>
                </div>

                <div className={[
                  "volume-section",
                  selectedItem === "volume" ? "volume-section--focused" : "",
                  volumeEditing ? "volume-section--editing" : "",
                ].filter(Boolean).join(" ")}>
                  <svg className="vol-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                  </svg>
                  <div className="volume-bar">
                    <div className="volume-fill" style={{ width: `${volume}%` }} />
                  </div>
                  <span className="volume-num">{volume}</span>
                </div>

                {hasLyricsContent ? (
                  <div className="lyrics-panel">
                    <div className="section-label">Lyrics</div>
                    {lyricsLoading ? (
                      <p className="lyrics-placeholder">Loading current track lyrics.</p>
                    ) : visibleSyncedLyrics.length > 0 ? (
                      <div className="lyrics-lines">
                        {visibleSyncedLyrics.map((line, index) => {
                          const absoluteIndex = Math.max(0, activeLyricIndex - 2) + index;
                          const isActive = absoluteIndex === activeLyricIndex;
                          const lineProgress = isActive
                            ? getLineProgress(syncedLyrics, absoluteIndex, lyricDisplayMs, duration)
                            : null;
                          const activeWordIndex = isActive
                            ? getApproximateWordIndex(line.text, lineProgress?.fill ?? 0)
                            : -1;
                          const words = line.text.split(/\s+/).filter(Boolean);

                          return (
                            <p
                              key={`${track.id}-${line.timeMs}-${index}`}
                              className={isActive ? "lyrics-line lyrics-line--active" : "lyrics-line"}
                            >
                              <span className="lyrics-line-text">
                                {isActive
                                  ? words.map((word, wordIndex) => (
                                      <span
                                        key={`${line.timeMs}-word-${wordIndex}`}
                                        className={wordIndex === activeWordIndex ? "lyrics-word-cue" : undefined}
                                      >
                                        {word}
                                        {wordIndex < words.length - 1 ? " " : ""}
                                      </span>
                                    ))
                                  : line.text}
                              </span>
                              {isActive ? (
                                <span
                                  className="lyrics-line-progress"
                                  style={({ "--line-fill": String(lineProgress?.fill ?? 0) } as CSSProperties)}
                                  aria-hidden="true"
                                >
                                  <span className="lyrics-line-text lyrics-line-text--overlay">{line.text}</span>
                                </span>
                              ) : null}
                            </p>
                          );
                        })}
                      </div>
                    ) : fallbackLyricsLines.length > 0 ? (
                      <div className="lyrics-lines">
                        {fallbackLyricsLines.map((line, index) => (
                          <p key={`${track.id}-plain-${index}`} className="lyrics-line">
                            {line}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          )
        ) : (
          <div className="home-view">
            {homeError ? <div className="home-alert">{homeError}</div> : null}

            <div className="home-grid">
              {homeConfig.devices.map((device) => {
                const state = homeDeviceStates[device.entityId];
                const brightnessSupported = isBrightnessCapable(device, state);
                const brightnessLevel = homeBrightnessLevels[device.entityId] ?? getBrightnessPercentFromState(state) ?? 0;
                const isDeviceFocused = focusedTarget.kind === "home-device" && focusedTarget.entityId === device.entityId;
                const isBrightnessFocused = focusedTarget.kind === "home-brightness" && focusedTarget.entityId === device.entityId;
                const isBrightnessEditing = homeBrightnessEditingId === device.entityId;
                const isBusy = homeActionPending === device.entityId;

                return (
                  <div
                    key={device.entityId}
                    className={[
                      "home-card",
                      state?.state === "on" ? "home-card--on" : "",
                      isDeviceFocused || isBrightnessFocused ? "home-card--active" : "",
                    ].filter(Boolean).join(" ")}
                  >
                    <button
                      type="button"
                      className={[
                        "home-card-main",
                        isDeviceFocused ? "home-card-main--focused" : "",
                      ].filter(Boolean).join(" ")}
                      onClick={() => toggleDevice(device.entityId).catch(() => {})}
                    >
                      <div className="home-card-head">
                        <HomeIcon kind={device.icon} />
                        <span className="home-card-state">{isBusy ? "Updating" : state?.state ?? "Unknown"}</span>
                      </div>
                      <div className="home-card-title">{device.label}</div>
                      <div className="home-card-subtitle">{getHomeDeviceSubtitle(state)}</div>
                    </button>

                    {brightnessSupported ? (
                      <button
                        type="button"
                        className={[
                          "home-brightness-control",
                          isBrightnessFocused ? "home-brightness-control--focused" : "",
                          isBrightnessEditing ? "home-brightness-control--editing" : "",
                        ].filter(Boolean).join(" ")}
                        onClick={() => setHomeBrightnessEditingState(isBrightnessEditing ? null : device.entityId)}
                      >
                        <span className="home-brightness-label">Brightness</span>
                        <div className="home-brightness-bar">
                          <div className="home-brightness-fill" style={{ transform: `scaleX(${brightnessLevel / 100})` }} />
                        </div>
                        <span className="home-brightness-value">{brightnessLevel}%</span>
                      </button>
                    ) : null}
                  </div>
                );
              })}

              {homeConfig.todoLists.map((list) => {
                const previewItems = getTodoPreview(homeTodoItems[list.entityId]);
                const isFocused = focusedTarget.kind === "home-todo" && focusedTarget.entityId === list.entityId;

                return (
                  <button
                    key={list.entityId}
                    type="button"
                    className={[
                      "home-card home-card--todo",
                      isFocused ? "home-card--active home-card-main--focused" : "",
                    ].filter(Boolean).join(" ")}
                    onClick={() => refreshHomeData().catch(() => {})}
                  >
                    <div className="home-card-head">
                      <HomeIcon kind="todo" />
                      <span className="home-card-state">{previewItems.length} open</span>
                    </div>
                    <div className="home-card-title">{list.label}</div>
                    <div className="todo-list-preview">
                      {previewItems.length > 0 ? previewItems.map((item) => (
                        <span key={item.uid ?? item.summary} className="todo-item">
                          {item.summary}
                        </span>
                      )) : (
                        <span className="todo-empty">No open items.</span>
                      )}
                    </div>
                  </button>
                );
              })}

              {!homeConfigLoading && homeConfig.devices.length === 0 && homeConfig.todoLists.length === 0 ? (
                <div className="home-empty">
                  <p>No Home Assistant entities are configured yet.</p>
                  <p className="hint">Edit public/home-assistant.json and add devices or todo list entities.</p>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </main>

      <footer className="app-footer">
        <span className={`mode-pill${activeTab === "home" ? " mode-pill--volume" : ""}`}>
          {interactionLabel}
        </span>
        <span className="interaction-copy">{interactionHint}</span>
      </footer>
    </div>
  );
}
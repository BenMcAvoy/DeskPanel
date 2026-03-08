import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";

import { FooterStatus } from "./components/FooterStatus";
import { HomeView } from "./components/home/HomeView";
import { SpotifyView } from "./components/spotify/SpotifyView";
import { TabStrip } from "./components/TabStrip";
import {
  getHomeAssistantStates,
  getHomeAssistantTodoItems,
  hasHomeAssistantCredentials,
  loadHomeAssistantPanelConfig,
  setHomeAssistantBrightness,
  toggleHomeAssistantEntity,
  type HomeAssistantEntityState,
  type HomeAssistantPanelConfig,
  type HomeAssistantTodoItem,
} from "./lib/homeAssistant";
import { RotaryEncoder, type RotaryEvent } from "./lib/RotaryEncoder";
import {
  exchangeCode,
  getLyrics,
  getPlaybackState,
  initiateLogin,
  isLoggedIn,
  nextTrack,
  pause,
  play,
  previousTrack,
  restoreSession,
  seekToPosition,
  setVolume,
  type LyricsState,
  type PlaybackState,
} from "./lib/spotify";
import {
  SPOTIFY_NAV_ITEMS,
  type AppTab,
  type AuthState,
  type FocusTarget,
  type NavItem,
} from "./types/panel";
import { getBrightnessPercentFromState, isBrightnessCapable } from "./utils/home";

const WS_URL = import.meta.env.VITE_ROTARY_WS_URL
  ?? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:6789`;
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
  const [, setHomeLoading] = useState(false);
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
          : Promise.resolve({} as Record<string, HomeAssistantEntityState>),
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
      exchangeCode(code)
        .then(() => {
          window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash}`);
          setAuthState("authenticated");
        })
        .catch(() => setAuthState("unauthenticated"));
    } else if (!isLoggedIn()) {
      setAuthState("unauthenticated");
    } else {
      restoreSession()
        .then((authenticated) => setAuthState(authenticated ? "authenticated" : "unauthenticated"))
        .catch(() => setAuthState("unauthenticated"));
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

      if (alive) {
        setTimeout(poll, SPOTIFY_POLL_INTERVAL_MS);
      }
    }

    poll();
    return () => {
      alive = false;
    };
  }, [authState]);

  useEffect(() => {
    let frameId = 0;

    const tick = () => {
      const currentPlayback = playbackRef.current;
      if (currentPlayback?.item) {
        const nextMs = currentPlayback.is_playing
          ? Math.min(currentPlayback.progress_ms + (Date.now() - pollTimeRef.current), currentPlayback.item.duration_ms)
          : currentPlayback.progress_ms;

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
        if (!cancelled) {
          setLyrics(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLyrics(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLyricsLoading(false);
        }
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
        const currentPlayback = playbackRef.current;
        (currentPlayback?.is_playing ? pause() : play()).catch(() => {});
      } else if (focusedTarget.item === "next") {
        nextTrack().catch(() => {});
      }
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
  }, [focusedTarget, refreshHomeData, setHomeBrightnessEditingState, setProgressEditingState, setVolumeEditingState, switchTab, toggleDevice]);

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
          const direction = Math.sign(event.delta);
          const nextIndex = Math.max(0, Math.min(focusTargetsRef.current.length - 1, focusIdxRef.current + direction));
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
    : focusedTarget.kind === "home-device"
    ? "Press to toggle this device."
    : focusedTarget.kind === "home-brightness" && homeBrightnessEditingId === focusedTarget.entityId
    ? "Rotate to change brightness. Press to stop."
    : focusedTarget.kind === "home-brightness"
    ? "Press to adjust brightness with the knob."
    : "Press to refresh the todo list preview.";

  const handlePlayPause = useCallback(() => {
    (playback?.is_playing ? pause() : play()).catch(() => {});
  }, [playback?.is_playing]);

  return (
    <div className="app-shell">
      {!wsConnected ? (
        <div className="ws-banner">Encoder disconnected. Reconnecting.</div>
      ) : null}

      <TabStrip activeTab={activeTab} focusIndex={focusIdx} onSwitchTab={switchTab} />

      <main className="app-content">
        {activeTab === "spotify" ? (
          <SpotifyView
            authState={authState}
            focusedTarget={focusedTarget}
            playback={playback}
            selectedItem={selectedItem}
            progressEditing={progressEditing}
            volumeEditing={volumeEditing}
            displayMs={displayMs}
            volume={volume}
            lyrics={lyrics}
            lyricsLoading={lyricsLoading}
            lyricLeadMs={LYRIC_LEAD_MS}
            onLogin={() => {
              initiateLogin().catch(() => {});
            }}
            onPrevious={() => {
              previousTrack().catch(() => {});
            }}
            onPlayPause={handlePlayPause}
            onNext={() => {
              nextTrack().catch(() => {});
            }}
          />
        ) : (
          <HomeView
            homeConfig={homeConfig}
            homeConfigLoading={homeConfigLoading}
            homeError={homeError}
            homeDeviceStates={homeDeviceStates}
            homeTodoItems={homeTodoItems}
            homeBrightnessLevels={homeBrightnessLevels}
            homeActionPending={homeActionPending}
            homeBrightnessEditingId={homeBrightnessEditingId}
            focusedTarget={focusedTarget}
            onToggleDevice={(entityId) => {
              toggleDevice(entityId).catch(() => {});
            }}
            onToggleBrightnessEditing={(entityId) => {
              setHomeBrightnessEditingState(homeBrightnessEditingId === entityId ? null : entityId);
            }}
            onRefreshTodos={() => {
              refreshHomeData().catch(() => {});
            }}
          />
        )}
      </main>

      <FooterStatus
        activeTab={activeTab}
        interactionLabel={interactionLabel}
        interactionHint={interactionHint}
      />
    </div>
  );
}

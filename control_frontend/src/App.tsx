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

const WS_URL = "ws://localhost:6789";
const VOLUME_STEP = 2;        // % per encoder tick
const SEEK_STEP_MS = 5_000;
const VOLUME_COMMIT_MS = 160;
const SEEK_COMMIT_MS = 120;
const VOLUME_SYNC_GRACE_MS = 1_200;
const SEEK_SYNC_GRACE_MS = 1_200;
const POLL_INTERVAL_MS = 2_000;
const LYRIC_LEAD_MS = 40;

const NAV_ITEMS = ["prev", "play", "next", "progress", "volume"] as const;
type NavItem = (typeof NAV_ITEMS)[number];

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
  const s = Math.floor(ms / 1_000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
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
    <svg className="ctrl-icon ctrl-icon--next" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17 6.5a1 1 0 0 0-1.55-.83L7 11.5a1 1 0 0 0 0 1.67l8.45 5.83A1 1 0 0 0 17 18.17z" fill="currentColor" />
      <rect x="17.5" y="5.5" width="2.5" height="13" rx="1" fill="currentColor" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg className="ctrl-icon ctrl-icon--prev" viewBox="0 0 24 24" aria-hidden="true">
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

type AuthState = "loading" | "unauthenticated" | "authenticated";

export default function App() {
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const [volume, setVolumeState] = useState(50);
  const [displayMs, setDisplayMs] = useState(0);
  const [wsConnected, setWsConnected] = useState(false);
  const [focusIdx, setFocusIdx] = useState(1); // 0=prev, 1=play/pause, 2=next, 3=progress, 4=volume
  const [progressEditing, setProgressEditing] = useState(false);
  const [volumeEditing, setVolumeEditing] = useState(false);
  const [lyrics, setLyrics] = useState<LyricsState | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);

  // Refs updated synchronously so interval callbacks see fresh data
  const playbackRef = useRef<PlaybackState | null>(null);
  const pollTimeRef = useRef<number>(Date.now());
  const displayMsRef = useRef(0);
  const volumeRef = useRef(50);
  const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const volumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSeekRequestRef = useRef<number | null>(null);
  const lastVolumeRequestRef = useRef<number | null>(null);
  const inflightSeekRef = useRef<Promise<void> | null>(null);
  const inflightVolumeRef = useRef<Promise<void> | null>(null);
  const queuedSeekRef = useRef<number | null>(null);
  const queuedVolumeRef = useRef<number | null>(null);
  const focusIdxRef = useRef(1);
  const progressEditingRef = useRef(false);
  const volumeEditingRef = useRef(false);
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
      if (alive) setTimeout(poll, POLL_INTERVAL_MS);
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
  }, [playback?.item?.id]);
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

  const setProgressEditingState = useCallback((next: boolean) => {
    progressEditingRef.current = next;
    setProgressEditing(next);
  }, []);

  const setVolumeEditingState = useCallback((next: boolean) => {
    volumeEditingRef.current = next;
    setVolumeEditing(next);
  }, []);
  useEffect(() => {
    const encoder = new RotaryEncoder(WS_URL);
    const cleanupStatus = encoder.onStatus(setWsConnected);

    const cleanupEvent = encoder.onEvent((event: RotaryEvent) => {
      if (event.type === "rotate") {
        if (NAV_ITEMS[focusIdxRef.current] === "progress" && progressEditingRef.current) {
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
        } else if (NAV_ITEMS[focusIdxRef.current] === "volume" && volumeEditingRef.current) {
          const nextVolume = Math.max(0, Math.min(100, volumeRef.current + event.delta * VOLUME_STEP));
          volumeRef.current = nextVolume;
          setVolumeState(nextVolume);
          scheduleVolumeCommit(nextVolume);
        } else {
          const dir = Math.sign(event.delta);
          const next = Math.max(0, Math.min(NAV_ITEMS.length - 1, focusIdxRef.current + dir));
          if (next !== focusIdxRef.current && progressEditingRef.current) {
            setProgressEditingState(false);
          }
          if (next !== focusIdxRef.current && volumeEditingRef.current) {
            setVolumeEditingState(false);
          }
          focusIdxRef.current = next;
          setFocusIdx(next);
        }
      } else if (event.type === "button") {
        if (!event.pressed) {
          const item = NAV_ITEMS[focusIdxRef.current];
          if (item === "progress") {
            setProgressEditingState(!progressEditingRef.current);
          } else if (item === "volume") {
            setVolumeEditingState(!volumeEditingRef.current);
          } else if (item === "prev") previousTrack().catch(() => {});
          else if (item === "play") {
            const pb = playbackRef.current;
            (pb?.is_playing ? pause() : play()).catch(() => {});
          } else if (item === "next") nextTrack().catch(() => {});
        }
      }
    });

    return () => {
      if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
      if (volumeTimerRef.current) clearTimeout(volumeTimerRef.current);
      cleanupEvent();
      cleanupStatus();
      encoder.close();
    };
  }, [scheduleSeekCommit, scheduleVolumeCommit, setProgressEditingState, setVolumeEditingState]);
  if (authState === "loading") {
    return (
      <div className="loading">
        <div className="spinner" />
      </div>
    );
  }
  if (authState === "unauthenticated") {
    return (
      <div className="login-screen">
        <div className="login-card">
          <SpotifyLogo />
          <h1>DeskPanel</h1>
          <p>Connect Spotify to control playback with your rotary encoder.</p>
          <button className="login-btn" onClick={initiateLogin}>
            Connect to Spotify
          </button>
        </div>
      </div>
    );
  }
  const track = playback?.item ?? null;
  const albumArt = track?.album.images[0]?.url ?? null;
  const artistName = track?.artists.map((a) => a.name).join(", ") ?? "";
  const trackName = track?.name ?? "";
  const albumName = track?.album.name ?? "";
  const duration = track?.duration_ms ?? 1;
  const progress = Math.min(displayMs / duration, 1);
  const lyricDisplayMs = Math.max(0, displayMs + LYRIC_LEAD_MS);
  const selectedItem: NavItem = NAV_ITEMS[focusIdx];
  const interactionLabel = selectedItem === "progress" && progressEditing
    ? "Seeking"
    : selectedItem === "progress"
    ? "Progress"
    : selectedItem === "volume" && volumeEditing
    ? "Adjusting"
    : selectedItem === "volume"
    ? "Volume"
    : "Navigate";
  const interactionHint = selectedItem === "progress" && progressEditing
    ? "Rotate to seek. Press to stop."
    : selectedItem === "progress"
    ? "Press to scrub with the knob."
    : selectedItem === "volume" && volumeEditing
    ? "Rotate to change volume. Press to stop."
    : selectedItem === "volume"
    ? "Press to adjust volume."
    : "Rotate to select a control. Press to activate it.";
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

  function handlePlayPause() {
    (playback?.is_playing ? pause() : play()).catch(() => {});
  }

  return (
    <div className="car-thing">
      {!wsConnected && (
        <div className="ws-banner">⚠ Encoder disconnected — reconnecting…</div>
      )}

      {!track ? (
        <div className="nothing-playing">
          <SpotifyLogo />
          <p>Nothing playing</p>
          <p className="hint">Start something on Spotify, then control it here.</p>
        </div>
      ) : (
        <>
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
                  focusIdx === 0 ? "ctrl-btn--focused" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => previousTrack().catch(() => {})}
                aria-label="Previous"
              >
                <PreviousIcon />
              </button>
              <button
                className={[
                  "ctrl-btn ctrl-btn--play",
                  focusIdx === 1 ? "ctrl-btn--focused" : "",
                ].filter(Boolean).join(" ")}
                onClick={handlePlayPause}
                aria-label={playback?.is_playing ? "Pause" : "Play"}
              >
                {playback?.is_playing ? <PauseIcon /> : <PlayIcon />}
              </button>
              <button
                className={[
                  "ctrl-btn",
                  focusIdx === 2 ? "ctrl-btn--focused" : "",
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
              <div className="progress-bar">
                <div className="progress-fill" style={{ transform: `scaleX(${progress})` }} />
              </div>
              <div className="progress-time">
                <span>{fmt(displayMs)}</span>
                <span>{fmt(duration)}</span>
              </div>
            </div>

            <div className={[
              "volume-section",
              selectedItem === "volume" ? "volume-section--focused" : "",
              volumeEditing ? "volume-section--editing" : "",
            ].filter(Boolean).join(" ")}>
              <svg className="vol-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
              </svg>
              <div className="volume-bar">
                <div className="volume-fill" style={{ width: `${volume}%` }} />
              </div>
              <span className="volume-num">{volume}</span>
            </div>

            <div className="lyrics-panel">
              <div className="section-label">Lyrics</div>
              {lyricsLoading ? (
                <p className="lyrics-placeholder">Loading current track lyrics…</p>
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
                        key={`${track?.id ?? "track"}-${line.timeMs}-${index}`}
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
                        {isActive && (
                          <span
                            className="lyrics-line-progress"
                            style={({ "--line-fill": String(lineProgress?.fill ?? 0) } as CSSProperties)}
                            aria-hidden="true"
                          >
                            <span className="lyrics-line-text lyrics-line-text--overlay">{line.text}</span>
                          </span>
                        )}
                      </p>
                    );
                  })}
                </div>
              ) : fallbackLyricsLines.length > 0 ? (
                <div className="lyrics-lines">
                  {fallbackLyricsLines.map((line, index) => (
                    <p key={`${track?.id ?? "track"}-plain-${index}`} className="lyrics-line">
                      {line}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="lyrics-placeholder">No lyrics found for this track.</p>
              )}
            </div>

            <div className="control-hint control-hint--footer">
              <span className={`mode-pill${selectedItem === "progress" || selectedItem === "volume" ? " mode-pill--volume" : ""}`}>
                {interactionLabel}
              </span>
              <span className="interaction-copy">{interactionHint}</span>
            </div>

          </div>
        </>
      )}
    </div>
  );
}

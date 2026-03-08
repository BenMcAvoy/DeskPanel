import type { CSSProperties } from "react";

import type { LyricsState, SpotifyTrack } from "../../lib/spotify";
import {
  findActiveLyricIndex,
  getApproximateWordIndex,
  getLineProgress,
  parseSyncedLyrics,
} from "../../utils/lyrics";

interface LyricsPanelProps {
  track: SpotifyTrack;
  lyrics: LyricsState | null;
  lyricsLoading: boolean;
  displayMs: number;
  durationMs: number;
  lyricLeadMs: number;
}

export function LyricsPanel({
  track,
  lyrics,
  lyricsLoading,
  displayMs,
  durationMs,
  lyricLeadMs,
}: LyricsPanelProps) {
  const lyricDisplayMs = Math.max(0, displayMs + lyricLeadMs);
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

  if (!hasLyricsContent) {
    return null;
  }

  return (
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
              ? getLineProgress(syncedLyrics, absoluteIndex, lyricDisplayMs, durationMs)
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
  );
}

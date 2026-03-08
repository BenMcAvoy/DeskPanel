import type { PlaybackState, LyricsState, SpotifyTrack } from "../../lib/spotify";
import type { NavItem } from "../../types/panel";
import { fmt } from "../../utils/lyrics";
import { NextIcon, PauseIcon, PlayIcon, PreviousIcon, SeekIcon } from "../icons";
import { LyricsPanel } from "./LyricsPanel";

interface SpotifyPlayerViewProps {
  track: SpotifyTrack;
  playback: PlaybackState;
  selectedItem: NavItem | null;
  progressEditing: boolean;
  volumeEditing: boolean;
  displayMs: number;
  volume: number;
  lyrics: LyricsState | null;
  lyricsLoading: boolean;
  lyricLeadMs: number;
  onPrevious: () => void;
  onPlayPause: () => void;
  onNext: () => void;
}

export function SpotifyPlayerView({
  track,
  playback,
  selectedItem,
  progressEditing,
  volumeEditing,
  displayMs,
  volume,
  lyrics,
  lyricsLoading,
  lyricLeadMs,
  onPrevious,
  onPlayPause,
  onNext,
}: SpotifyPlayerViewProps) {
  const albumArt = track.album.images[0]?.url ?? null;
  const artistName = track.artists.map((artist) => artist.name).join(", ");
  const duration = track.duration_ms;
  const progress = Math.min(displayMs / Math.max(duration, 1), 1);

  return (
    <div className="car-thing">
      <div className="album-panel">
        {albumArt ? (
          <img className="album-art" src={albumArt} alt={track.album.name} />
        ) : (
          <div className="album-art album-art--placeholder" />
        )}
      </div>

      <div className="info-panel">
        <div className="track-meta">
          <div className="artist-name">{artistName}</div>
          <div className="track-name">{track.name}</div>
          <div className="album-name">{track.album.name}</div>
        </div>

        <div className="controls">
          <button
            className={[
              "ctrl-btn",
              selectedItem === "prev" ? "ctrl-btn--focused" : "",
            ].filter(Boolean).join(" ")}
            onClick={onPrevious}
            aria-label="Previous"
          >
            <PreviousIcon />
          </button>
          <button
            className={[
              "ctrl-btn ctrl-btn--play",
              selectedItem === "play" ? "ctrl-btn--focused" : "",
            ].filter(Boolean).join(" ")}
            onClick={onPlayPause}
            aria-label={playback.is_playing ? "Pause" : "Play"}
          >
            {playback.is_playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            className={[
              "ctrl-btn",
              selectedItem === "next" ? "ctrl-btn--focused" : "",
            ].filter(Boolean).join(" ")}
            onClick={onNext}
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

        <LyricsPanel
          track={track}
          lyrics={lyrics}
          lyricsLoading={lyricsLoading}
          displayMs={displayMs}
          durationMs={duration}
          lyricLeadMs={lyricLeadMs}
        />
      </div>
    </div>
  );
}

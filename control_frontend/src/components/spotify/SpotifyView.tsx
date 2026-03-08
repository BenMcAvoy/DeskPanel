import type { LyricsState, PlaybackState } from "../../lib/spotify";
import type { AuthState, FocusTarget, NavItem } from "../../types/panel";
import { SpotifyIdleView } from "./SpotifyIdleView";
import { SpotifyLoginView } from "./SpotifyLoginView";
import { SpotifyPlayerView } from "./SpotifyPlayerView";

interface SpotifyViewProps {
  authState: AuthState;
  focusedTarget: FocusTarget;
  playback: PlaybackState | null;
  selectedItem: NavItem | null;
  progressEditing: boolean;
  volumeEditing: boolean;
  displayMs: number;
  volume: number;
  lyrics: LyricsState | null;
  lyricsLoading: boolean;
  lyricLeadMs: number;
  onLogin: () => void;
  onPrevious: () => void;
  onPlayPause: () => void;
  onNext: () => void;
}

export function SpotifyView({
  authState,
  focusedTarget,
  playback,
  selectedItem,
  progressEditing,
  volumeEditing,
  displayMs,
  volume,
  lyrics,
  lyricsLoading,
  lyricLeadMs,
  onLogin,
  onPrevious,
  onPlayPause,
  onNext,
}: SpotifyViewProps) {
  if (authState === "loading") {
    return (
      <div className="loading">
        <div className="spinner" />
      </div>
    );
  }

  if (authState === "unauthenticated") {
    return (
      <SpotifyLoginView
        isFocused={focusedTarget.kind === "spotify-login"}
        onLogin={onLogin}
      />
    );
  }

  if (!playback?.item) {
    return <SpotifyIdleView />;
  }

  return (
    <SpotifyPlayerView
      track={playback.item}
      playback={playback}
      selectedItem={selectedItem}
      progressEditing={progressEditing}
      volumeEditing={volumeEditing}
      displayMs={displayMs}
      volume={volume}
      lyrics={lyrics}
      lyricsLoading={lyricsLoading}
      lyricLeadMs={lyricLeadMs}
      onPrevious={onPrevious}
      onPlayPause={onPlayPause}
      onNext={onNext}
    />
  );
}

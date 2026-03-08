import { NextIcon, PlayIcon, PreviousIcon, SeekIcon } from "../icons";

export function SpotifyIdleView() {
  return (
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
  );
}

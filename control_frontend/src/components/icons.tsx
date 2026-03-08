export function SpotifyLogo() {
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

export function PreviousIcon() {
  return (
    <svg className="ctrl-icon ctrl-icon--prev" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17 6.5a1 1 0 0 0-1.55-.83L7 11.5a1 1 0 0 0 0 1.67l8.45 5.83A1 1 0 0 0 17 18.17z" fill="currentColor" />
      <rect x="17.5" y="5.5" width="2.5" height="13" rx="1" fill="currentColor" />
    </svg>
  );
}

export function NextIcon() {
  return (
    <svg className="ctrl-icon ctrl-icon--next" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 6.5a1 1 0 0 1 1.55-.83L17 11.5a1 1 0 0 1 0 1.67l-8.45 5.83A1 1 0 0 1 7 18.17z" fill="currentColor" />
      <rect x="4" y="5.5" width="2.5" height="13" rx="1" fill="currentColor" />
    </svg>
  );
}

export function PlayIcon() {
  return (
    <svg className="ctrl-icon ctrl-icon--play" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 6.6c0-.78.85-1.26 1.52-.87l8.15 4.8c.66.4.66 1.35 0 1.74l-8.15 4.8A1 1 0 0 1 8 16.2z" fill="currentColor" />
    </svg>
  );
}

export function PauseIcon() {
  return (
    <svg className="ctrl-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="6" width="3.5" height="12" rx="1" fill="currentColor" />
      <rect x="13.5" y="6" width="3.5" height="12" rx="1" fill="currentColor" />
    </svg>
  );
}

export function SeekIcon() {
  return (
    <svg className="seek-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

export function HomeIcon({ kind }: { kind?: string }) {
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

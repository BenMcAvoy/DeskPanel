import { SpotifyLogo } from "../icons";

interface SpotifyLoginViewProps {
  isFocused: boolean;
  onLogin: () => void;
}

export function SpotifyLoginView({ isFocused, onLogin }: SpotifyLoginViewProps) {
  return (
    <div className="login-screen">
      <div className="login-card">
        <SpotifyLogo />
        <h1>Spotify</h1>
        <p>Connect Spotify to use transport, progress scrubbing, and the lyrics view.</p>
        <button
          className={[
            "login-btn",
            isFocused ? "login-btn--focused" : "",
          ].filter(Boolean).join(" ")}
          onClick={onLogin}
        >
          Connect to Spotify
        </button>
      </div>
    </div>
  );
}

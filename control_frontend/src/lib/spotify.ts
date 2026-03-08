// https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string;
const CONFIGURED_REDIRECT_URI = (import.meta.env.VITE_SPOTIFY_REDIRECT_URI as string | undefined)?.trim() ?? "";
const SPOTIFY_ACCESS_TOKEN_KEY = "sp_at";
const SPOTIFY_REFRESH_TOKEN_KEY = "sp_rt";
const SPOTIFY_EXPIRY_KEY = "sp_exp";
const SPOTIFY_CODE_VERIFIER_KEY = "spotify_cv";
const SPOTIFY_AUTH_PENDING_KEY = "spotify_auth_pending";

function isLoopbackHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost";
}

function getRedirectUri(): string {
  if (!CONFIGURED_REDIRECT_URI) {
    const current = new URL(window.location.href);
    current.search = "";
    current.hash = "";
    return current.toString();
  }

  try {
    const configured = new URL(CONFIGURED_REDIRECT_URI);
    const current = new URL(window.location.href);
    current.search = "";
    current.hash = "";

    if (isLoopbackHost(configured.hostname) && isLoopbackHost(current.hostname)) {
      configured.protocol = current.protocol;
      configured.hostname = current.hostname;
      configured.port = current.port;
      configured.pathname = current.pathname;
      configured.search = "";
      configured.hash = "";
      return configured.toString();
    }
  } catch {
    return CONFIGURED_REDIRECT_URI;
  }

  return CONFIGURED_REDIRECT_URI;
}

const REDIRECT_URI = getRedirectUri();

const SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
].join(" ");

function setStoredValue(key: string, value: string): void {
  localStorage.setItem(key, value);
  sessionStorage.setItem(key, value);
}

function getStoredValue(key: string): string {
  return localStorage.getItem(key) ?? sessionStorage.getItem(key) ?? "";
}

function clearStoredValue(key: string): void {
  localStorage.removeItem(key);
  sessionStorage.removeItem(key);
}

async function generateVerifier(): Promise<string> {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function deriveChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export async function initiateLogin(): Promise<void> {
  const verifier = await generateVerifier();
  const challenge = await deriveChallenge(verifier);
  setStoredValue(SPOTIFY_CODE_VERIFIER_KEY, verifier);
  setStoredValue(SPOTIFY_AUTH_PENDING_KEY, "1");

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });

  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

export async function exchangeCode(code: string): Promise<void> {
  const verifier = getStoredValue(SPOTIFY_CODE_VERIFIER_KEY);
  if (!verifier) throw new Error("Missing Spotify PKCE verifier");

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error("Token exchange failed");
  storeTokens(await res.json());
  clearStoredValue(SPOTIFY_CODE_VERIFIER_KEY);
  clearStoredValue(SPOTIFY_AUTH_PENDING_KEY);
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

function getStoredRefreshToken(): string {
  const refreshToken = getStoredValue(SPOTIFY_REFRESH_TOKEN_KEY);
  return refreshToken === "undefined" || refreshToken === "null" ? "" : refreshToken;
}

function storeTokens(t: TokenResponse) {
  setStoredValue(SPOTIFY_ACCESS_TOKEN_KEY, t.access_token);

  const refreshToken = t.refresh_token?.trim() || getStoredRefreshToken();
  if (refreshToken) {
    setStoredValue(SPOTIFY_REFRESH_TOKEN_KEY, refreshToken);
  } else {
    clearStoredValue(SPOTIFY_REFRESH_TOKEN_KEY);
  }

  setStoredValue(SPOTIFY_EXPIRY_KEY, String(Date.now() + t.expires_in * 1_000));
}

async function refreshTokens(): Promise<string> {
  const refresh = getStoredRefreshToken();
  if (!refresh) throw new Error("Missing Spotify refresh token");

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refresh,
    }),
  });
  if (!res.ok) throw new Error("Token refresh failed");
  const t: TokenResponse = await res.json();
  storeTokens(t);
  return t.access_token;
}

async function getAccessToken(): Promise<string> {
  const accessToken = getStoredValue(SPOTIFY_ACCESS_TOKEN_KEY);
  const exp = Number(getStoredValue(SPOTIFY_EXPIRY_KEY) ?? 0);

  if (!accessToken) {
    return refreshTokens();
  }

  if (Date.now() > exp - 60_000) {
    return refreshTokens();
  }

  return accessToken;
}

export function isLoggedIn(): boolean {
  return !!(getStoredValue(SPOTIFY_ACCESS_TOKEN_KEY) || getStoredRefreshToken());
}

export async function restoreSession(): Promise<boolean> {
  if (!isLoggedIn()) return false;

  try {
    await getAccessToken();
    return isLoggedIn();
  } catch {
    logout();
    return false;
  }
}

export function logout(): void {
  [
    SPOTIFY_ACCESS_TOKEN_KEY,
    SPOTIFY_REFRESH_TOKEN_KEY,
    SPOTIFY_EXPIRY_KEY,
    SPOTIFY_CODE_VERIFIER_KEY,
    SPOTIFY_AUTH_PENDING_KEY,
  ].forEach(clearStoredValue);
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  return fetch(`https://api.spotify.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

export interface SpotifyTrack {
  id: string;
  name: string;
  duration_ms: number;
  artists: { name: string }[];
  album: {
    name: string;
    images: { url: string; width: number; height: number }[];
  };
}

export interface PlaybackState {
  is_playing: boolean;
  progress_ms: number;
  item: SpotifyTrack | null;
  device: { name: string; volume_percent: number } | null;
}

export interface LyricsState {
  plainLyrics: string | null;
  syncedLyrics: string | null;
  provider: string;
}

interface LyricsLookupParams {
  trackName: string;
  artistName: string;
  albumName: string;
  durationMs: number;
}

export async function getPlaybackState(): Promise<PlaybackState | null> {
  const res = await api("/me/player");
  if (res.status === 204 || res.status === 404) return null;
  if (!res.ok) throw new Error("getPlaybackState failed");
  return res.json();
}

export async function play(): Promise<void> {
  await api("/me/player/play", { method: "PUT" });
}

export async function pause(): Promise<void> {
  await api("/me/player/pause", { method: "PUT" });
}

export async function nextTrack(): Promise<void> {
  await api("/me/player/next", { method: "POST" });
}

export async function previousTrack(): Promise<void> {
  await api("/me/player/previous", { method: "POST" });
}

export async function seekToPosition(positionMs: number): Promise<void> {
  const position = Math.max(0, Math.round(positionMs));
  await api(`/me/player/seek?position_ms=${position}`, { method: "PUT" });
}

export async function setVolume(percent: number): Promise<void> {
  const v = Math.max(0, Math.min(100, Math.round(percent)));
  await api(`/me/player/volume?volume_percent=${v}`, { method: "PUT" });
}

function buildLyricsUrl(base: string, params: Record<string, string>): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value.trim()) search.set(key, value.trim());
  });
  return `${base}?${search.toString()}`;
}

function normalizeLyricsPayload(payload: any): LyricsState | null {
  if (!payload || (!payload.plainLyrics && !payload.syncedLyrics)) return null;

  return {
    plainLyrics: payload.plainLyrics ?? payload.plain_lyrics ?? null,
    syncedLyrics: payload.syncedLyrics ?? payload.synced_lyrics ?? null,
    provider: payload.provider ?? "LRCLIB",
  };
}

export async function getLyrics(params: LyricsLookupParams): Promise<LyricsState | null> {
  const directUrl = buildLyricsUrl("https://lrclib.net/api/get", {
    track_name: params.trackName,
    artist_name: params.artistName,
    album_name: params.albumName,
    duration: String(Math.round(params.durationMs / 1000)),
  });

  const directRes = await fetch(directUrl);
  if (directRes.ok) {
    return normalizeLyricsPayload(await directRes.json());
  }

  const searchUrl = buildLyricsUrl("https://lrclib.net/api/search", {
    track_name: params.trackName,
    artist_name: params.artistName,
  });

  const searchRes = await fetch(searchUrl);
  if (!searchRes.ok) return null;

  const candidates = (await searchRes.json()) as any[];
  const bestMatch = candidates.find((candidate) => {
    const candidateTrack = String(candidate.trackName ?? candidate.track_name ?? "").toLowerCase();
    const candidateArtist = String(candidate.artistName ?? candidate.artist_name ?? "").toLowerCase();
    return candidateTrack === params.trackName.toLowerCase() && candidateArtist === params.artistName.toLowerCase();
  }) ?? candidates[0];

  return normalizeLyricsPayload(bestMatch ?? null);
}

export const SPOTIFY_NAV_ITEMS = ["prev", "play", "next", "progress", "volume"] as const;
export const TABS = ["spotify", "home"] as const;

export type NavItem = (typeof SPOTIFY_NAV_ITEMS)[number];
export type AppTab = (typeof TABS)[number];
export type AuthState = "loading" | "unauthenticated" | "authenticated";

export type FocusTarget =
  | { kind: "tab"; tab: AppTab }
  | { kind: "spotify-login" }
  | { kind: "spotify-control"; item: NavItem }
  | { kind: "home-device"; entityId: string }
  | { kind: "home-brightness"; entityId: string }
  | { kind: "home-todo"; entityId: string };

export function getTabLabel(tab: AppTab): string {
  return tab === "spotify" ? "Spotify" : "Home";
}

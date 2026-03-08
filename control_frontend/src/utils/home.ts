import type {
  HomeAssistantDeviceConfig,
  HomeAssistantEntityState,
  HomeAssistantTodoItem,
} from "../lib/homeAssistant";

export function getBrightnessPercentFromState(state: HomeAssistantEntityState | undefined): number | null {
  if (!state) return null;

  const rawBrightness = state.attributes.brightness;
  if (typeof rawBrightness === "number") {
    return Math.max(0, Math.min(100, Math.round((rawBrightness / 255) * 100)));
  }

  return state.state === "on" ? 100 : 0;
}

export function isBrightnessCapable(
  device: HomeAssistantDeviceConfig,
  state: HomeAssistantEntityState | undefined,
): boolean {
  const domain = device.entityId.split(".")[0] ?? "";
  return domain === "light" || typeof state?.attributes.brightness === "number" || device.icon === "light";
}

export function getHomeDeviceSubtitle(state: HomeAssistantEntityState | undefined): string {
  if (!state) return "Unavailable";
  return state.state.replace(/_/g, " ");
}

export function getTodoPreview(items: HomeAssistantTodoItem[] | undefined): HomeAssistantTodoItem[] {
  if (!items) return [];
  return items.filter((item) => item.status !== "completed").slice(0, 4);
}

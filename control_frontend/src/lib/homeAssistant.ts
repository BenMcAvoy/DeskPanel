export interface HomeAssistantDeviceConfig {
  entityId: string;
  label: string;
  icon?: string;
}

export interface HomeAssistantTodoListConfig {
  entityId: string;
  label: string;
}

export interface HomeAssistantPanelConfig {
  devices: HomeAssistantDeviceConfig[];
  todoLists: HomeAssistantTodoListConfig[];
}

export interface HomeAssistantEntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
}

export interface HomeAssistantTodoItem {
  summary: string;
  uid?: string;
  status?: string;
  due?: string | null;
  description?: string | null;
}

const HOME_ASSISTANT_URL = (import.meta.env.VITE_HOME_ASSISTANT_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const HOME_ASSISTANT_TOKEN = (import.meta.env.VITE_HOME_ASSISTANT_TOKEN as string | undefined)?.trim() ?? "";
const HOME_ASSISTANT_PROXY_BASE = "/__ha";

function normalizeDeviceConfig(value: unknown): HomeAssistantDeviceConfig | null {
  if (!value || typeof value !== "object") return null;

  const entityId = typeof (value as { entityId?: unknown }).entityId === "string"
    ? (value as { entityId: string }).entityId.trim()
    : "";
  const label = typeof (value as { label?: unknown }).label === "string"
    ? (value as { label: string }).label.trim()
    : "";
  const icon = typeof (value as { icon?: unknown }).icon === "string"
    ? (value as { icon: string }).icon.trim()
    : undefined;

  if (!entityId || !label) return null;
  return { entityId, label, icon: icon || undefined };
}

function normalizeTodoConfig(value: unknown): HomeAssistantTodoListConfig | null {
  if (!value || typeof value !== "object") return null;

  const entityId = typeof (value as { entityId?: unknown }).entityId === "string"
    ? (value as { entityId: string }).entityId.trim()
    : "";
  const label = typeof (value as { label?: unknown }).label === "string"
    ? (value as { label: string }).label.trim()
    : "";

  if (!entityId || !label) return null;
  return { entityId, label };
}

function getHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${HOME_ASSISTANT_TOKEN}`,
    "Content-Type": "application/json",
    "X-Home-Assistant-Url": HOME_ASSISTANT_URL,
  };
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!HOME_ASSISTANT_URL || !HOME_ASSISTANT_TOKEN) {
    throw new Error("Home Assistant credentials are not configured");
  }

  const response = await fetch(`${HOME_ASSISTANT_PROXY_BASE}${path}`, {
    ...init,
    headers: {
      ...getHeaders(),
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Home Assistant request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function hasHomeAssistantCredentials(): boolean {
  return Boolean(HOME_ASSISTANT_URL && HOME_ASSISTANT_TOKEN);
}

export async function loadHomeAssistantPanelConfig(): Promise<HomeAssistantPanelConfig> {
  const response = await fetch("/home-assistant.json", { cache: "no-store" });

  if (response.status === 404) {
    return { devices: [], todoLists: [] };
  }

  if (!response.ok) {
    throw new Error(`Failed to load Home Assistant config: ${response.status}`);
  }

  const payload = await response.json() as {
    devices?: unknown[];
    todoLists?: unknown[];
  };

  return {
    devices: Array.isArray(payload.devices) ? payload.devices.map(normalizeDeviceConfig).filter((value): value is HomeAssistantDeviceConfig => value !== null) : [],
    todoLists: Array.isArray(payload.todoLists) ? payload.todoLists.map(normalizeTodoConfig).filter((value): value is HomeAssistantTodoListConfig => value !== null) : [],
  };
}

export async function getHomeAssistantStates(entityIds: string[]): Promise<Record<string, HomeAssistantEntityState>> {
  const states = await Promise.all(entityIds.map(async (entityId) => {
    const state = await api<HomeAssistantEntityState>(`/api/states/${encodeURIComponent(entityId)}`);
    return [entityId, state] as const;
  }));

  return Object.fromEntries(states);
}

export async function toggleHomeAssistantEntity(entityId: string): Promise<void> {
  const domain = entityId.split(".")[0] ?? "homeassistant";
  const serviceDomain = ["light", "switch", "input_boolean", "fan"].includes(domain)
    ? domain
    : "homeassistant";

  await api<unknown[]>(`/api/services/${serviceDomain}/toggle`, {
    method: "POST",
    body: JSON.stringify({ entity_id: entityId }),
  });
}

export async function setHomeAssistantBrightness(entityId: string, percent: number): Promise<void> {
  const clampedPercent = Math.max(0, Math.min(100, Math.round(percent)));
  const brightness = Math.round((clampedPercent / 100) * 255);

  await api<unknown[]>("/api/services/light/turn_on", {
    method: "POST",
    body: JSON.stringify({
      entity_id: entityId,
      brightness,
    }),
  });
}

export async function getHomeAssistantTodoItems(entityId: string): Promise<HomeAssistantTodoItem[]> {
  const response = await api<Array<Record<string, { items?: HomeAssistantTodoItem[] }>>>("/api/services/todo/get_items?return_response", {
    method: "POST",
    body: JSON.stringify({
      entity_id: entityId,
      status: ["needs_action"],
    }),
  });

  const firstPayload = response[0];
  if (!firstPayload || typeof firstPayload !== "object") {
    return [];
  }

  const items = firstPayload[entityId]?.items;
  return Array.isArray(items) ? items : [];
}
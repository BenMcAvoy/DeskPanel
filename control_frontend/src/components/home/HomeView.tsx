import type {
  HomeAssistantEntityState,
  HomeAssistantPanelConfig,
  HomeAssistantTodoItem,
} from "../../lib/homeAssistant";
import type { FocusTarget } from "../../types/panel";
import {
  getBrightnessPercentFromState,
  getHomeDeviceSubtitle,
  getTodoPreview,
  isBrightnessCapable,
} from "../../utils/home";
import { HomeIcon } from "../icons";

interface HomeViewProps {
  homeConfig: HomeAssistantPanelConfig;
  homeConfigLoading: boolean;
  homeError: string | null;
  homeDeviceStates: Record<string, HomeAssistantEntityState>;
  homeTodoItems: Record<string, HomeAssistantTodoItem[]>;
  homeBrightnessLevels: Record<string, number>;
  homeActionPending: string | null;
  homeBrightnessEditingId: string | null;
  focusedTarget: FocusTarget;
  onToggleDevice: (entityId: string) => void;
  onToggleBrightnessEditing: (entityId: string) => void;
  onRefreshTodos: () => void;
}

export function HomeView({
  homeConfig,
  homeConfigLoading,
  homeError,
  homeDeviceStates,
  homeTodoItems,
  homeBrightnessLevels,
  homeActionPending,
  homeBrightnessEditingId,
  focusedTarget,
  onToggleDevice,
  onToggleBrightnessEditing,
  onRefreshTodos,
}: HomeViewProps) {
  return (
    <div className="home-view">
      {homeError ? <div className="home-alert">{homeError}</div> : null}

      <div className="home-grid">
        {homeConfig.devices.map((device) => {
          const state = homeDeviceStates[device.entityId];
          const brightnessSupported = isBrightnessCapable(device, state);
          const brightnessLevel = homeBrightnessLevels[device.entityId] ?? getBrightnessPercentFromState(state) ?? 0;
          const isDeviceFocused = focusedTarget.kind === "home-device" && focusedTarget.entityId === device.entityId;
          const isBrightnessFocused = focusedTarget.kind === "home-brightness" && focusedTarget.entityId === device.entityId;
          const isBrightnessEditing = homeBrightnessEditingId === device.entityId;
          const isBusy = homeActionPending === device.entityId;

          return (
            <div
              key={device.entityId}
              className={[
                "home-card",
                state?.state === "on" ? "home-card--on" : "",
                isDeviceFocused || isBrightnessFocused ? "home-card--active" : "",
              ].filter(Boolean).join(" ")}
            >
              <button
                type="button"
                className={[
                  "home-card-main",
                  isDeviceFocused ? "home-card-main--focused" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => onToggleDevice(device.entityId)}
              >
                <div className="home-card-head">
                  <HomeIcon kind={device.icon} />
                  <span className="home-card-state">{isBusy ? "Updating" : state?.state ?? "Unknown"}</span>
                </div>
                <div className="home-card-title">{device.label}</div>
                <div className="home-card-subtitle">{getHomeDeviceSubtitle(state)}</div>
              </button>

              {brightnessSupported ? (
                <button
                  type="button"
                  className={[
                    "home-brightness-control",
                    isBrightnessFocused ? "home-brightness-control--focused" : "",
                    isBrightnessEditing ? "home-brightness-control--editing" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => onToggleBrightnessEditing(device.entityId)}
                >
                  <span className="home-brightness-label">Brightness</span>
                  <div className="home-brightness-bar">
                    <div className="home-brightness-fill" style={{ transform: `scaleX(${brightnessLevel / 100})` }} />
                  </div>
                  <span className="home-brightness-value">{brightnessLevel}%</span>
                </button>
              ) : null}
            </div>
          );
        })}

        {homeConfig.todoLists.map((list) => {
          const previewItems = getTodoPreview(homeTodoItems[list.entityId]);
          const isFocused = focusedTarget.kind === "home-todo" && focusedTarget.entityId === list.entityId;

          return (
            <button
              key={list.entityId}
              type="button"
              className={[
                "home-card home-card--todo",
                isFocused ? "home-card--active home-card-main--focused" : "",
              ].filter(Boolean).join(" ")}
              onClick={onRefreshTodos}
            >
              <div className="home-card-head">
                <HomeIcon kind="todo" />
                <span className="home-card-state">{previewItems.length} open</span>
              </div>
              <div className="home-card-title">{list.label}</div>
              <div className="todo-list-preview">
                {previewItems.length > 0 ? previewItems.map((item) => (
                  <span key={item.uid ?? item.summary} className="todo-item">
                    {item.summary}
                  </span>
                )) : (
                  <span className="todo-empty">No open items.</span>
                )}
              </div>
            </button>
          );
        })}

        {!homeConfigLoading && homeConfig.devices.length === 0 && homeConfig.todoLists.length === 0 ? (
          <div className="home-empty">
            <p>No Home Assistant entities are configured yet.</p>
            <p className="hint">Edit public/home-assistant.json and add devices or todo list entities.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
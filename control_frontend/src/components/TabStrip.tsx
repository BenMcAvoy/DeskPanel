import { TABS, type AppTab, getTabLabel } from "../types/panel";

interface TabStripProps {
  activeTab: AppTab;
  focusIndex: number;
  onSwitchTab: (tab: AppTab) => void;
}

export function TabStrip({ activeTab, focusIndex, onSwitchTab }: TabStripProps) {
  return (
    <div className="tab-strip tab-strip--overlay" role="tablist" aria-label="Panel tabs">
      {TABS.map((tab, index) => {
        const isActive = activeTab === tab;
        const isFocused = focusIndex === index;

        return (
          <button
            key={tab}
            type="button"
            className={[
              "tab-chip",
              isActive ? "tab-chip--active" : "",
              isFocused ? "tab-chip--focused" : "",
            ].filter(Boolean).join(" ")}
            onClick={() => onSwitchTab(tab)}
          >
            <span className="tab-chip-label">{getTabLabel(tab)}</span>
          </button>
        );
      })}
    </div>
  );
}

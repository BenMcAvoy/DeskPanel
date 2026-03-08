import type { AppTab } from "../types/panel";

interface FooterStatusProps {
  activeTab: AppTab;
  interactionLabel: string;
  interactionHint: string;
}

export function FooterStatus({ activeTab, interactionLabel, interactionHint }: FooterStatusProps) {
  return (
    <footer className="app-footer">
      <span className={`mode-pill${activeTab === "home" ? " mode-pill--volume" : ""}`}>
        {interactionLabel}
      </span>
      <span className="interaction-copy">{interactionHint}</span>
    </footer>
  );
}

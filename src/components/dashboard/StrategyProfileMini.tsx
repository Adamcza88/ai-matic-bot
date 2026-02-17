import { Button } from "@/components/ui/button";
import Panel from "@/components/dashboard/Panel";

type ProfileMeta = {
  label: string;
  timeframes: string;
  session: string;
  risk: string;
  entry: string;
};

type StrategyProfileMiniProps = {
  profileMeta: ProfileMeta;
  onOpenSettings: () => void;
};

function compactText(value: string, max = 96) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

export default function StrategyProfileMini({
  profileMeta,
  onOpenSettings,
}: StrategyProfileMiniProps) {
  return (
    <Panel
      title="Strategy profile (mini)"
      fileId="PROFILE MINI ID: TR-13-P"
      className="dashboard-strategy-mini"
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenSettings}
          className="h-8 text-xs dm-button-control"
        >
          Settings
        </Button>
      }
    >
      <div className="space-y-2 text-xs">
        <div className="flex items-start justify-between gap-3">
          <span className="text-muted-foreground">Profile</span>
          <span className="text-right font-semibold text-foreground">{profileMeta.label}</span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <span className="text-muted-foreground">Timeframes</span>
          <span className="text-right text-foreground">{compactText(profileMeta.timeframes)}</span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <span className="text-muted-foreground">POI priority</span>
          <span className="text-right text-foreground">{compactText(profileMeta.session)}</span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <span className="text-muted-foreground">Risk</span>
          <span className="text-right text-foreground">{compactText(profileMeta.risk)}</span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <span className="text-muted-foreground">Entry model</span>
          <span className="text-right text-foreground">{compactText(profileMeta.entry)}</span>
        </div>
      </div>
    </Panel>
  );
}

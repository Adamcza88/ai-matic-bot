import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PanelProps = {
  title?: string;
  action?: ReactNode;
  description?: string;
  fileId?: string;
  className?: string;
  children: ReactNode;
};

export default function Panel({
  title,
  action,
  description,
  fileId,
  className,
  children,
}: PanelProps) {
  return (
    <section
      className={cn(
        "rounded-xl border border-border/70 bg-card/96 p-4 text-sm text-foreground shadow-[0_6px_8px_-6px_rgba(0,0,0,0.45)] lm-panel dm-surface",
        className
      )}
    >
      {(title || action || description) && (
        <div className="mb-3 border-b-2 border-border/80 pb-2 lm-panel-header dm-border-soft">
          {fileId && (
            <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground lm-micro lm-file-id">
              {fileId}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            {title && (
              <h3 className="text-sm font-semibold tracking-tight lm-heading">{title}</h3>
            )}
            {description && (
              <p className="mt-1 text-xs text-muted-foreground max-w-[70ch]">
                {description}
              </p>
            )}
          </div>
          {action && <div className="flex items-center gap-2">{action}</div>}
        </div>
        </div>
      )}
      {children}
    </section>
  );
}

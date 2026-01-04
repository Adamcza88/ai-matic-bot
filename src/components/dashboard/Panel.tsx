import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PanelProps = {
  title?: string;
  action?: ReactNode;
  description?: string;
  className?: string;
  children: ReactNode;
};

export default function Panel({
  title,
  action,
  description,
  className,
  children,
}: PanelProps) {
  return (
    <section
      className={cn(
        "rounded-xl border border-border/60 bg-card/60 p-4 text-sm text-foreground",
        className
      )}
    >
      {(title || action || description) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            {title && (
              <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
            )}
            {description && (
              <p className="mt-1 text-xs text-muted-foreground max-w-[70ch]">
                {description}
              </p>
            )}
          </div>
          {action && <div className="flex items-center gap-2">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

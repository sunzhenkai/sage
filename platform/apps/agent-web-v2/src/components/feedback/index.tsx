import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

/**
 * Semantic feedback primitives (spec §3.3, §14):
 * error uses an assertive live region, success/info use a polite status region.
 */

export interface BannerAction {
  label: string;
  onClick: () => void;
}

export function Banner({
  variant,
  title,
  children,
  action,
  onDismiss,
  className,
}: {
  variant: "success" | "error";
  title?: string;
  children?: ReactNode;
  action?: BannerAction;
  onDismiss?: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-md border px-4 py-3 text-sm",
        variant === "error" && "border-destructive/50 bg-destructive/10 text-foreground",
        variant === "success" && "border-success/50 bg-success/10 text-foreground",
        className,
      )}
    >
      <div className="flex-1 space-y-1">
        {title ? <div className="font-semibold">{title}</div> : null}
        {children ? <div className="text-sm">{children}</div> : null}
        {action ? (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-1 text-sm font-medium underline underline-offset-4 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {action.label}
          </button>
        ) : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("feedback.dismiss")}
          className="shrink-0 rounded-sm opacity-70 hover:opacity-100 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

export function InlineNotice({
  variant = "info",
  children,
  className,
}: {
  variant?: "info" | "error" | "warning";
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        variant === "error" && "border-destructive/50 bg-destructive/10",
        variant === "warning" && "border-warning/50 bg-warning/10",
        variant === "info" && "border-info/50 bg-info/10",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function LoadingState({ label, description, className }: { label: string; description?: string; className?: string }) {
  return (
    <div role="status" className={cn("flex flex-col items-center justify-center gap-2 py-12 text-center", className)}>
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" aria-hidden="true" />
      <div className="text-sm font-medium">{label}</div>
      {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
    </div>
  );
}

export function EmptyPanel({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: BannerAction;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center", className)}>
      <div className="text-sm font-semibold">{title}</div>
      {description ? <div className="max-w-md text-sm text-muted-foreground">{description}</div> : null}
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-2 text-sm font-medium underline underline-offset-4 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

import { Component, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n";

/**
 * Startup render failure fallback (spec §3.2.6): show that the workspace is
 * unavailable, the raw error message (or the default runtime failure copy),
 * and an action back to `/`.
 */

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override render(): ReactNode {
    if (this.state.error) {
      return <WorkspaceErrorPage error={this.state.error} />;
    }
    return this.props.children;
  }
}

function WorkspaceErrorPage({ error }: { error: Error }) {
  const { t } = useI18n();
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div role="alert" className="w-full max-w-md rounded-lg border border-destructive/50 bg-card p-6">
        <h1 className="text-lg font-semibold">{t("error.workspaceUnavailable")}</h1>
        <p className="mt-2 break-words font-mono text-sm text-muted-foreground">
          {error.message || t("error.workspaceUnavailableDescription")}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">{t("error.workspaceUnavailableDescription")}</p>
        <a
          href="/"
          className="mt-4 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("error.backHome")}
        </a>
      </div>
    </main>
  );
}

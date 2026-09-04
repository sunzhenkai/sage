import { ErrorBoundary } from "./error-boundary";
import { useGlobalLinkInterceptor, useRoute, type RouteState } from "./router";
import { Shell } from "./shell";
import { ChatView } from "@/features/chat";
import { TasksView } from "@/features/tasks";
import { ProvidersView } from "@/features/providers";
import { PackagesView } from "@/features/packages";
import { SchedulesView } from "@/features/schedules";

/**
 * App assembly: global link interception (spec §3.1), error boundary
 * (spec §3.2.6), then the shell rendering the active view.
 *
 * Content components are keyed by their active entity (spec §3.1 rule 6) so
 * switching session/task/package rebuilds the view instead of leaking stale
 * requests or state across entities.
 */
export function App() {
  useGlobalLinkInterceptor();
  return (
    <ErrorBoundary>
      <Workspace />
    </ErrorBoundary>
  );
}

function Workspace() {
  const route = useRoute();
  return <Shell route={route}>{renderView(route)}</Shell>;
}

function renderView(route: RouteState) {
  switch (route.view) {
    case "tasks":
      return <TasksView key={route.task ?? ""} task={route.task} session={route.session} />;
    case "providers":
      return <ProvidersView />;
    case "packages":
      return <PackagesView key={route.package ?? ""} packageId={route.package} session={route.session} />;
    case "schedules":
      return <SchedulesView key="schedules" session={route.session} />;
    case "chat":
      return <ChatView key={route.session ?? ""} session={route.session} />;
  }
}

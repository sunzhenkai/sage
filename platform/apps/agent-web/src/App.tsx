import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AppShell } from './components/layout/app-shell';
import { AppDetailPage, AppsPage } from './pages/apps';
import { AppReleaseDetailPage } from './pages/app-release';
import { AppRunDetailPage } from './pages/app-runs';
import { ChatPage } from './pages/chat';
import { OverviewPage } from './pages/overview';
import { ProvidersPage } from './pages/providers';
import { ScheduleDetailPage, SchedulesPage } from './pages/schedules';
import { NotFoundPage } from './pages/not-found';
import { SettingsPage } from './pages/settings';
import { TaskDetailPage, TasksPage } from './pages/tasks';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/overview" replace />} />
          <Route path="overview" element={<OverviewPage />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="chat/:sessionId" element={<ChatPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="tasks/:taskId" element={<TaskDetailPage />} />
          <Route path="apps" element={<AppsPage />} />
          <Route path="apps/:appId" element={<AppDetailPage />} />
          <Route path="apps/:appId/releases/:releaseId" element={<AppReleaseDetailPage />} />
          <Route path="apps/:appId/runs/:taskId" element={<AppRunDetailPage />} />
          <Route path="packages" element={<Navigate to="/apps" replace />} />
          <Route path="packages/*" element={<Navigate to="/apps" replace />} />
          <Route path="schedules" element={<SchedulesPage />} />
          <Route path="schedules/:scheduleId" element={<ScheduleDetailPage />} />
          <Route path="providers" element={<ProvidersPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="settings/:section" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

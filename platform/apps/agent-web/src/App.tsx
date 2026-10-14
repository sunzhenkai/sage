import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AppShell } from './components/layout/app-shell';
import { AppDetailPage, AppsPage } from './pages/apps';
import { ChatPage } from './pages/chat';
import { PackageDetailPage, PackagesPage } from './pages/packages';
import { ProvidersPage } from './pages/providers';
import { ScheduleDetailPage, SchedulesPage } from './pages/schedules';
import { SettingsPage } from './pages/settings';
import { TaskDetailPage, TasksPage } from './pages/tasks';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/chat" replace />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="chat/:sessionId" element={<ChatPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="tasks/:taskId" element={<TaskDetailPage />} />
          <Route path="apps" element={<AppsPage />} />
          <Route path="apps/:appId" element={<AppDetailPage />} />
          <Route path="packages" element={<PackagesPage />} />
          <Route path="packages/:packageId" element={<PackageDetailPage />} />
          <Route path="schedules" element={<SchedulesPage />} />
          <Route path="schedules/:scheduleId" element={<ScheduleDetailPage />} />
          <Route path="providers" element={<ProvidersPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

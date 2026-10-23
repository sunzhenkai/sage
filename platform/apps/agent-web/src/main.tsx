import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyLocaleFromEnvironment } from './lib/i18n';
import { installAutoHideScrollbars } from './lib/scrollbar-idle';
import { applyTheme, getSettings } from './lib/settings';
import './index.css';

installAutoHideScrollbars();

// Apply the interface language before the first render (persisted pref + ?lang= + browser languages).
applyLocaleFromEnvironment();
applyTheme(getSettings().theme);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(getSettings().theme));

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: false } } });
const root = document.getElementById('root');
if (!root) throw new Error('#root missing');
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}><App /></QueryClientProvider>
  </StrictMode>
);

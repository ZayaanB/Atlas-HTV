import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './app/App';
import { createHttpApi } from './lib/api';
import { createQueryClient } from './lib/queries';
import './styles/global.css';

const root = createRoot(document.getElementById('root')!);
const mode = import.meta.env.VITE_DATA_MODE ?? 'api';
if (mode !== 'api' && mode !== 'fixture') {
  root.render(<p role="alert">Invalid VITE_DATA_MODE. Choose api or fixture.</p>);
} else {
  const api = mode === 'fixture' ? (await import('./lib/fixture-api')).createFixtureApi() : createHttpApi();
  root.render(<StrictMode><QueryClientProvider client={createQueryClient()}><App api={api} /></QueryClientProvider></StrictMode>);
}

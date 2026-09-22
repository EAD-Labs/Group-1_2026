/*
 * Application entry point.
 *
 * Written with createElement rather than JSX so the file can keep the .js
 * extension the specification asks for: Vite's esbuild pass treats .js as plain
 * JavaScript and would reject JSX here without extra configuration. Four lines
 * is a cheaper price than a build-tool workaround.
 */
import { StrictMode, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/index.css';
import { startSync } from './offline/outbox';
import { refreshInBackground } from './offline/pack';

createRoot(document.getElementById('root')).render(
  createElement(StrictMode, null, createElement(App)),
);

// Upload anything played offline, and keep the downloaded pack current.
startSync();
refreshInBackground();

// The service worker keeps the app itself on the device. Built pages only:
// in development it would serve stale code over every edit.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* works online without it */ });
  });
}

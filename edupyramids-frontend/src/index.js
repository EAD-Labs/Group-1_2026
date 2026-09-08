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

createRoot(document.getElementById('root')).render(
  createElement(StrictMode, null, createElement(App)),
);

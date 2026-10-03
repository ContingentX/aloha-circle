import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import AppBridge from './AppBridge.jsx';
import { About } from './About.jsx';
import './styles.css';

const isBridge = /^\/app(login|return)\b/.test(window.location.pathname);
const isAbout = /^\/about\/?$/.test(window.location.pathname);

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isBridge ? <AppBridge /> : isAbout ? <About /> : <App />}
  </React.StrictMode>
);

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import AppBridge from './AppBridge.jsx';
import { About } from './About.jsx';
import { EventPage } from './EventPage.jsx';
import './styles.css';

const isBridge = /^\/app(login|return)\b/.test(window.location.pathname);
const isAbout = /^\/about\/?$/.test(window.location.pathname);
// Event pages: /e/<slug-with-date> (CloudFront serves index.html for unknown
// paths, so the SPA owns the route).
const eventSlug = /^\/e\/([a-z0-9-]{1,120})\/?$/i.exec(window.location.pathname)?.[1]?.toLowerCase();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isBridge ? <AppBridge /> : isAbout ? <About /> : eventSlug ? <EventPage slug={eventSlug} /> : <App />}
  </React.StrictMode>
);

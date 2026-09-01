// Scroll-world hero: a scroll-scrubbed camera flight through a miniature clay
// Maui — airport → Paia town → upcountry farm → reef cove → farm dinner — that
// hands off to the app below. Assets pre-rendered (Higgsfield/Seedance); the
// engine (scrollWorld.js) just scrubs video time from scroll position.
import { useEffect, useRef } from 'react';
import { mountScrollWorld } from './scrollWorld.js';

// Site media lives in the site S3 buckets under media/ (see CLAUDE.md) and is
// referenced site-relative — never third-party URLs.
const M = '/media/world';
const STILLS = [1, 2, 3, 4, 5].map((n) => `${M}/scene_${n}.webp`);
const DIVES = [1, 2, 3, 4, 5].map((n) => `${M}/dive_${n}.mp4`);
const CONNS = [1, 2, 3, 4].map((n) => `${M}/conn_${n}.mp4`);

const CONFIG = {
  brand: { name: 'Aloha Circle', href: '#top', logo: '/aloha-circle-logo.svg' },
  diveScroll: 1.25,
  connScroll: 0.85,
  hint: 'scroll to fly in',
  nav: true,
  atmosphere: true,
  sections: [
    {
      id: 'arrive', label: 'Arrive', still: STILLS[0], clip: DIVES[0],
      accent: '#ff6b57', eyebrow: 'Touchdown at OGG',
      title: "You just landed. Maui already has plans for you.",
      body: 'A lei, warm wind, and the Aloha Circle waiting at baggage claim — this is where visiting becomes meeting.',
      tags: ['Kahului Airport', 'Aloha Circle'],
    },
    {
      id: 'meet', label: 'Meet', still: STILLS[1], clip: DIVES[1],
      accent: '#0b5d8a', eyebrow: 'Meet Maui',
      title: 'A local already shares your interests.',
      body: 'Tell the Aloha Agent what you love and it pairs you with a local who loves it too — shave ice optional, talk-story guaranteed.',
      tags: ['Real locals', 'Shared interests'],
    },
    {
      id: 'grow', label: 'Give', still: STILLS[2], clip: DIVES[2],
      accent: '#1c7c54', eyebrow: 'Give a morning',
      title: 'Welcome to the Ohana',
      body: "You are a Voluntourist: plant trees for Lāhainā families, work a farm row, or pack food boxes before your won experience brings you together with a Maui resident. Share your conversations and ratings in Aloha Circle so locals and visitors can create a better Maui. Now we're family.",
      tags: ['Treecovery', 'Hua Momona Farms'],
      scroll: 1.5, linger: 0.4,
    },
    {
      id: 'ocean', label: 'Protect', still: STILLS[3], clip: DIVES[3],
      accent: '#0b5d8a', eyebrow: 'Protect what you love',
      title: 'The reef keeps score.',
      body: 'Dawn turtle patrols and beach cleanups where every piece of debris becomes conservation data.',
      tags: ['Sea turtles', 'Reef cleanups'],
    },
    {
      id: 'circle', label: 'Circle', still: STILLS[4], clip: DIVES[4],
      accent: '#ffd166', eyebrow: 'The Aloha Circle',
      title: 'Step into the Aloha Circle.',
      body: 'Land at OGG and the kiʻi of the Hawaiian akua are waiting at baggage claim — a small donation joins you to the ohana and opens an AR experience you carry across Maui.',
      tags: ['OGG baggage claim', 'AR experience'],
      scroll: 1.6, linger: 0.45,
      cta: {
        primary: { label: 'Join the Aloha Circle', href: '#aloha-circle' },
        secondary: { label: 'Meet Maui now', href: '#app' },
      },
    },
  ],
  connectors: CONNS,
};

export function World() {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    const cleanup = mountScrollWorld(ref.current, CONFIG);
    return typeof cleanup === 'function' ? cleanup : undefined;
  }, []);
  return <div ref={ref} className="world-hero" />;
}

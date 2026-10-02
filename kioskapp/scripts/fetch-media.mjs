// Download Kanaloa's speak clips from the site media bucket into assets/clips/
// so the kiosk can run fully offline. Media is never committed (see CLAUDE.md).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const MEDIA_BASE = 'https://aloha-circle.com/media/kiosk';
const CLIPS = ['welcome', 'honi', 'eyes', 'ears', 'nose', 'heart', 'mahalo'];

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'clips');
fs.mkdirSync(dir, { recursive: true });

for (const name of CLIPS) {
  const out = path.join(dir, `${name}.mp4`);
  if (fs.existsSync(out)) {
    console.log(`have ${name}.mp4`);
    continue;
  }
  const url = `${MEDIA_BASE}/${name}.mp4`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`FAILED ${url} -> ${res.status}`);
    continue;
  }
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  console.log(`fetched ${name}.mp4 (${fs.statSync(out).size} bytes)`);
}

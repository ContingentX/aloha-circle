// Admin mode for the pose-debug visuals (keypoint dots, face box, gesture
// label, backend pill). Visitors never see them: typing the key sequence
// ("aloha") reveals a switch in the top-right with debug ON; flipping the
// switch off hides the visuals AND the switch, re-arming the key sequence.

export const ADMIN_SEQUENCE = 'aloha';

export function createAdminMode({ sequence = ADMIN_SEQUENCE } = {}) {
  const want = sequence.toLowerCase();
  let armed = false; // switch visible
  let debug = false; // debug visuals visible
  let buf = '';

  return {
    get armed() {
      return armed;
    },
    get debug() {
      return debug;
    },
    // Feed one typed character; returns true when the state changed.
    key(char) {
      if (armed || typeof char !== 'string' || char.length !== 1) return false;
      buf = (buf + char.toLowerCase()).slice(-want.length);
      if (buf !== want) return false;
      armed = true;
      debug = true;
      buf = '';
      return true;
    },
    // Switch handler: off also hides the switch and re-arms the sequence.
    setDebug(on) {
      debug = !!on;
      if (!debug) armed = false;
    },
  };
}

export function initAdminMode(doc = document, mode = createAdminMode()) {
  const toggle = doc.getElementById('admin-toggle');
  const sw = doc.getElementById('admin-debug-switch');
  if (!toggle || !sw) return mode;

  const sync = () => {
    toggle.classList.toggle('hidden', !mode.armed);
    sw.checked = mode.debug;
    doc.body.classList.toggle('admin-debug', mode.debug);
  };

  doc.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (mode.key(e.key)) sync();
  });
  sw.addEventListener('change', () => {
    mode.setDebug(sw.checked);
    sync();
  });

  sync();
  return mode;
}

// Avatar placement logic for the kiosk.
// Repositions Kanaloa's video card to avoid occluding the visitor, with smooth
// eased transitions and scaling for close-up (Honi Ihu) scenarios.

const SAFE_MARGIN_X = 0.03;  // 3vw from screen edges
const SAFE_MARGIN_Y = 0.16;  // 16vh from bottom (above controls)
const AVATAR_WIDTH_VW = 0.24; // 24vw default width
const AVATAR_MIN_WIDTH_VW = 0.16; // 16vw when scaled down
const SCALE_THRESHOLD = 0.35; // Scale down when person fills >35% of frame
const HYSTERESIS_BAND = 0.08; // 8% of screen width deadband before switching sides
const UPDATE_INTERVAL_MS = 200; // ~5 Hz re-layout

/**
 * Calculate avatar position to avoid the person's bounding box.
 * Returns { side: 'left' | 'right', scale: number, x: number, y: number }
 * in viewport-relative units (0-1).
 *
 * Camera is CSS-mirrored: video x=0 is the right edge of the screen.
 * So when personBox.cx is large, the person appears on the LEFT of the screen.
 */
export function calculateAvatarPosition(personBox, viewport, currentSide = 'right') {
  if (!personBox || !viewport || !viewport.width) {
    return { side: 'right', scale: 1, x: 1 - SAFE_MARGIN_X - AVATAR_WIDTH_VW, y: 1 - SAFE_MARGIN_Y, avatarWidth: AVATAR_WIDTH_VW };
  }

  const personCxScreen = 1 - (personBox.cx / viewport.width);
  const personWidthNorm = personBox.w / viewport.width;
  const avatarWidth = personBox.frameFill > SCALE_THRESHOLD ? AVATAR_MIN_WIDTH_VW : AVATAR_WIDTH_VW;

  const personLeft = personCxScreen - personWidthNorm / 2;
  const personRight = personCxScreen + personWidthNorm / 2;

  const freeLeft = personLeft - SAFE_MARGIN_X;
  const freeRight = 1 - personRight - SAFE_MARGIN_X;

  let side = currentSide;
  const leftFits = freeLeft >= avatarWidth;
  const rightFits = freeRight >= avatarWidth;

  if (currentSide === 'right') {
    if (!rightFits && leftFits && freeLeft > freeRight + HYSTERESIS_BAND) {
      side = 'left';
    } else if (leftFits && freeLeft > freeRight + HYSTERESIS_BAND * 2) {
      side = 'left';
    }
  } else {
    if (!leftFits && rightFits && freeRight > freeLeft + HYSTERESIS_BAND) {
      side = 'right';
    } else if (rightFits && freeRight > freeLeft + HYSTERESIS_BAND * 2) {
      side = 'right';
    }
  }

  const x = side === 'left' ? SAFE_MARGIN_X : 1 - SAFE_MARGIN_X - avatarWidth;
  const scale = personBox.frameFill > SCALE_THRESHOLD
    ? Math.max(0.65, 1 - (personBox.frameFill - SCALE_THRESHOLD) * 1.2)
    : 1;

  return { side, scale, x, y: 1 - SAFE_MARGIN_Y, avatarWidth };
}

/**
 * Check if two rectangles intersect (both in normalized 0-1 coords).
 */
export function rectsIntersect(a, b) {
  if (!a || !b) return false;
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

/**
 * Convert person box to normalized viewport coordinates (mirrored).
 */
export function normalizePersonBox(personBox, viewport) {
  if (!personBox || !viewport || !viewport.width) return null;
  return {
    x: 1 - (personBox.x + personBox.w) / viewport.width,
    y: personBox.y / viewport.height,
    w: personBox.w / viewport.width,
    h: personBox.h / viewport.height,
  };
}

/**
 * Get avatar rect in normalized viewport coordinates.
 */
export function getAvatarRect(position) {
  const aspectRatio = 0.75;
  return {
    x: position.x,
    y: position.y - position.avatarWidth * aspectRatio,
    w: position.avatarWidth * position.scale,
    h: position.avatarWidth * aspectRatio * position.scale,
  };
}

/**
 * Create a placement controller with hysteresis and debouncing.
 * Returns an object with update() method and current state.
 */
export function createAvatarPlacer(options = {}) {
  const interval = options.intervalMs || UPDATE_INTERVAL_MS;
  let currentSide = 'right';
  let currentScale = 1;
  let lastUpdateTime = -Infinity;
  let pendingPersonBox = null;
  let pendingViewport = null;

  return {
    get side() { return currentSide; },
    get scale() { return currentScale; },

    /**
     * Queue an update. Returns the new position if enough time has passed,
     * or null if debounced.
     */
    update(personBox, viewport, now = Date.now()) {
      pendingPersonBox = personBox;
      pendingViewport = viewport;

      if (now - lastUpdateTime < interval) {
        return null;
      }

      lastUpdateTime = now;
      const position = calculateAvatarPosition(pendingPersonBox, pendingViewport, currentSide);
      currentSide = position.side;
      currentScale = position.scale;

      return position;
    },

    /**
     * Force an immediate update, bypassing debounce.
     */
    forceUpdate(personBox, viewport) {
      lastUpdateTime = -Infinity;
      return this.update(personBox, viewport, Date.now());
    },

    /**
     * Reset to default position.
     */
    reset() {
      currentSide = 'right';
      currentScale = 1;
      lastUpdateTime = -Infinity;
      pendingPersonBox = null;
      pendingViewport = null;
    },
  };
}

/**
 * Apply placement to a DOM element with smooth CSS transitions.
 */
export function applyPlacement(element, position, options = {}) {
  if (!element || !position) return;

  const { side, scale, avatarWidth } = position;
  const transitionDuration = options.transitionDuration || '0.4s';
  const easing = options.easing || 'cubic-bezier(0.4, 0, 0.2, 1)';

  element.style.transition = `left ${transitionDuration} ${easing}, right ${transitionDuration} ${easing}, transform ${transitionDuration} ${easing}, width ${transitionDuration} ${easing}`;

  if (side === 'left') {
    element.style.right = 'auto';
    element.style.left = `${SAFE_MARGIN_X * 100}vw`;
  } else {
    element.style.left = 'auto';
    element.style.right = `${SAFE_MARGIN_X * 100}vw`;
  }

  const widthVw = (avatarWidth || AVATAR_WIDTH_VW) * scale * 100;
  element.style.width = `${widthVw}vw`;
  element.style.minWidth = `${Math.max(180, widthVw * 4)}px`;
  element.style.transform = `scale(${scale})`;
  element.style.transformOrigin = side === 'left' ? 'bottom left' : 'bottom right';
}

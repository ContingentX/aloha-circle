#!/bin/sh
# Keep the kiosk alive: restart Electron a few seconds after any crash-exit.
# A clean exit (code 0 — Cmd+Q, window closed, KIOSK_SHOT smoke run) stops the
# loop, so quitting on purpose still works. KIOSK_WATCHDOG=1 tells main.js not
# to also app.relaunch() on a GPU crash loop (the wrapper owns restarts).
#
#   npm run start:watch   — windowed, auto-restarting
#   npm run kiosk:watch   — fullscreen kiosk, auto-restarting
set -u
cd "$(dirname "$0")/.."
DELAY="${KIOSK_RESTART_DELAY:-5}"
export KIOSK_WATCHDOG=1
while :; do
  npx electron . "$@"
  code=$?
  [ "$code" -eq 0 ] && exit 0
  echo "[watchdog] kiosk exited with code $code — restarting in ${DELAY}s" >&2
  sleep "$DELAY"
done

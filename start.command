#!/bin/bash
# Mac: double-click to start. Same as npm start.
cd "$(dirname "$0")" || exit 1
node scripts/dev/components.mjs start
status=$?
# Keep the window open so the outcome (every component ready, or the failure) stays readable.
read -r -p "Press Return to close..."
exit $status

#!/bin/bash
# Mac: double-click to stop. Same as npm stop.
cd "$(dirname "$0")" || exit 1
node scripts/dev/components.mjs stop
status=$?
if [ $status -ne 0 ]; then read -r -p "Press Return to close..."; fi
exit $status

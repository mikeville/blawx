#!/usr/bin/env bash
# Run the 15-term baseline panel through generate3d, retrying on Replicate's
# per-model job-rate limit. Writes a per-term log + a summary at the end.
set -u

TERMS=(cat chair duck fish flower fox hat house lighthouse mug mushroom robot sailboat sword tree)
LOG_DIR="out/3d-panel-log"
mkdir -p "$LOG_DIR"
SUMMARY="$LOG_DIR/summary.txt"
: > "$SUMMARY"

for term in "${TERMS[@]}"; do
  log="$LOG_DIR/$term.log"
  status="?"
  attempts=0
  for attempt in 1 2 3 4 5 6 7 8; do
    attempts=$attempt
    npm run generate3d -- "$term" >"$log" 2>&1
    if grep -q "^  wrote " "$log"; then
      status="ok"
      break
    fi
    if grep -qE "JobNumExceed|Insufficient credit" "$log"; then
      sleep 40
      continue
    fi
    status="failed-other"
    break
  done
  if [ "$status" = "?" ]; then status="failed-rate-limit"; fi
  voxels=$(grep -oE "voxelized: [0-9]+ voxels" "$log" | head -1 || echo "")
  echo "$term  $status  attempts=$attempts  $voxels" | tee -a "$SUMMARY"
done

echo "---"
echo "panel complete. summary at $SUMMARY"

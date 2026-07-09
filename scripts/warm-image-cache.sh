#!/usr/bin/env bash
# Pre-warm the weserv edge cache for every curated listing photo.
#
# The photos live on Wikimedia, which answers 429 (rate limit) when weserv cold-fetches
# many of them at once. Once weserv has an image cached it serves it from the edge, so
# this only needs to run when the pools in web/src/lib/images.ts change. Requests are
# sequential with backoff so we never trip the limit.
#
#   ./scripts/warm-image-cache.sh
set -uo pipefail

IMAGES_TS="$(dirname "$0")/../web/src/lib/images.ts"
# Keep in sync with cdn() in images.ts.
PARAMS="w=800&h=600&fit=cover&output=webp&q=72"

mapfile -t paths < <(grep -oE "upload\.wikimedia\.org/[^']+" "$IMAGES_TS")
total=${#paths[@]}
ok=0; failed=0

echo "Warming $total images into the weserv cache…"
for i in "${!paths[@]}"; do
  url="https://images.weserv.nl/?url=${paths[$i]}&${PARAMS}"
  for attempt in 1 2 3 4; do
    code=$(curl -sS -o /dev/null -L --max-time 30 -w '%{http_code}' "$url" 2>/dev/null)
    [ "$code" = "200" ] && break
    sleep $((attempt * 5))   # Wikimedia's 429 clears on a short backoff
  done
  if [ "$code" = "200" ]; then
    ok=$((ok + 1))
  else
    failed=$((failed + 1))
    echo "  FAILED ($code): ${paths[$i]##*/}"
  fi
  printf '\r  %d/%d ok=%d failed=%d' "$((i + 1))" "$total" "$ok" "$failed"
  sleep 1
done

echo
[ "$failed" -eq 0 ] && echo "All $ok images cached." || echo "$ok cached, $failed failed — re-run to retry."
exit $((failed > 0))

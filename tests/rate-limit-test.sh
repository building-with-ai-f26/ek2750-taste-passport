#!/bin/bash
# Security test for SECURITY.md: calls an AI route 30 times in a row and shows when the rate limit kicks in.
# The requests are empty, so they fail the app's input check before any AI call: this test costs $0.
# Usage: bash tests/rate-limit-test.sh [app URL]   (default: the live Render app)
# Note: afterwards, this network is blocked from the app's AI features for 10 minutes.

URL="${1:-https://taste-passport-7jya.onrender.com}"
echo "Rate limit test: 30 calls in a row to $URL/api/split"
echo "Started $(date)"
echo
for i in $(seq 1 30); do
  code=$(curl -s -m 90 -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d '{}' "$URL/api/split")
  case "$code" in
    429) echo "Call $i: $code Too Many Requests  <-- BLOCKED by rate limit" ;;
    400) echo "Call $i: $code allowed (empty request, never reaches the AI)" ;;
    *)   echo "Call $i: $code" ;;
  esac
done
echo
echo "Finished $(date)"

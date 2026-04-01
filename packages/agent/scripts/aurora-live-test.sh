#!/bin/bash
# Anticipy Live Test Harness
# Sends test inputs through the REAL production pipeline via /task/v2
# Usage: bash anticipy-live-test.sh <test_number>

set -euo pipefail

# Load env
source /workspaces/Aevoy_Omar-copy/.env 2>/dev/null || true

AGENT_URL="https://agent-production-1339.up.railway.app"
WEBHOOK_SECRET="${AGENT_WEBHOOK_SECRET}"
USER_ID="11684ec6-80cd-4bb6-9aed-8f0947afd06a"
USERNAME="Jordan Chen"

if [ -z "${WEBHOOK_SECRET:-}" ]; then
  echo "ERROR: AGENT_WEBHOOK_SECRET not set"
  exit 1
fi

send_test() {
  local test_num="$1"
  local message="$2"

  echo "============================================"
  echo "TEST $test_num"
  echo "INPUT: $message"
  echo "============================================"

  local response
  response=$(curl -s --max-time 120 \
    -X POST "${AGENT_URL}/task/v2" \
    -H "Content-Type: application/json" \
    -H "x-webhook-secret: ${WEBHOOK_SECRET}" \
    -d "{
      \"userId\": \"${USER_ID}\",
      \"username\": \"${USERNAME}\",
      \"from\": \"web\",
      \"subject\": \"$(echo "$message" | sed 's/"/\\"/g')\",
      \"body\": \"$(echo "$message" | sed 's/"/\\"/g')\",
      \"inputChannel\": \"web\"
    }" 2>&1)

  echo ""
  echo "RAW RESPONSE:"
  echo "$response" | python3 -m json.tool 2>/dev/null || echo "$response"
  echo ""
  echo "============================================"
  echo ""
}

TEST_NUM="${1:-all}"

case "$TEST_NUM" in
  1) send_test 1 "Honestly I keep forgetting to follow up with that insurance company, it's been like three weeks now" ;;
  2) send_test 2 "Sarah just pinged me, she wants to move the product review to 3pm instead of 2" ;;
  3) send_test 3 "I think Alex would love that new ramen place for our anniversary, we should check it out" ;;
  4) send_test 4 "Ugh, I'm completely out of oat milk at home" ;;
  5) send_test 5 "Hey can you send that competitor analysis to Sarah before the standup on Monday" ;;
  6) send_test 6 "I was telling my mom about the Japan trip and she got so excited, she wants to come too now" ;;
  7) send_test 7 "I need to cancel that subscription to Headspace, I never use it anymore" ;;
  8) send_test 8 "My gym bag is still in the car, I keep forgetting to bring it up" ;;
  9) send_test 9 "Oh wonderful, another all-hands meeting, can't wait" ;;
  10) send_test 10 "Alex asked if we should do Thai or Italian tonight, honestly I'm craving pasta" ;;
  all)
    for i in $(seq 1 10); do
      bash "$0" "$i"
      sleep 2
    done
    ;;
  *) echo "Usage: $0 <1-10|all>" ;;
esac

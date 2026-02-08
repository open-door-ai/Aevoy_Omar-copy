#!/bin/bash
#
# Email Testing Script for aevoy.com
#
# This script sends test emails to verify email routing is working.
# It supports multiple testing methods:
#   - swaks (SMTP test tool - most reliable)
#   - sendmail (if available)
#   - curl with mailgun API (if configured)
#

set -e

# Configuration
TEST_DOMAIN="aevoy.com"
TEST_RECIPIENTS=("nova@aevoy.com" "omarkebrahim@gmail.com")
TEST_SENDER="test@$(hostname -f 2>/dev/null || echo 'localhost')"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║              EMAIL TESTING SCRIPT                          ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Parse arguments
SEND_TO=""
METHOD="auto"

while [[ $# -gt 0 ]]; do
    case $1 in
        --to)
            SEND_TO="$2"
            shift 2
            ;;
        --method)
            METHOD="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --to EMAIL       Send test to specific email address"
            echo "  --method METHOD  Force testing method (swaks|sendmail|curl|auto)"
            echo "  --help, -h       Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0                                    # Test all configured recipients"
            echo "  $0 --to test@example.com              # Test specific address"
            echo "  $0 --method swaks                     # Force use of swaks"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Detect available methods
detect_methods() {
    local methods=""
    
    if command -v swaks &> /dev/null; then
        methods="$methods swaks"
    fi
    
    if command -v sendmail &> /dev/null; then
        methods="$methods sendmail"
    fi
    
    if command -v curl &> /dev/null; then
        methods="$methods curl"
    fi
    
    echo "$methods"
}

AVAILABLE_METHODS=$(detect_methods)

if [ -z "$AVAILABLE_METHODS" ]; then
    echo -e "${RED}❌ No email testing tools found!${NC}"
    echo ""
    echo "Please install one of the following:"
    echo "  - swaks (recommended): apt-get install swaks / brew install swaks"
    echo "  - sendmail: Usually pre-installed on Linux"
    echo "  - curl: apt-get install curl / brew install curl"
    echo ""
    echo "Or test manually by sending an email to:"
    for recipient in "${TEST_RECIPIENTS[@]}"; do
        echo "  - $recipient"
    done
    exit 1
fi

echo -e "${BLUE}📧 Available testing methods:${NC} $AVAILABLE_METHODS"

# Select method
if [ "$METHOD" == "auto" ]; then
    if echo "$AVAILABLE_METHODS" | grep -q "swaks"; then
        METHOD="swaks"
    elif echo "$AVAILABLE_METHODS" | grep -q "sendmail"; then
        METHOD="sendmail"
    else
        METHOD="curl"
    fi
fi

echo -e "${BLUE}🔧 Selected method:${NC} $METHOD"
echo ""

# Test timestamp
TIMESTAMP=$(date -u +"%Y-%m-%d %H:%M:%S UTC")
TEST_ID=$(date +%s)

# Email content
SUBJECT="Aevoy Email Test [$TEST_ID]"
BODY="This is a test email from the Aevoy DNS testing script.

Test ID: $TEST_ID
Timestamp: $TIMESTAMP
Recipient: RECIPIENT_PLACEHOLDER
Method: $METHOD

If you received this email, the email routing is working correctly!

---
Sent from: $TEST_SENDER
"

# Function to send email using swaks
send_with_swaks() {
    local to=$1
    local subject="$SUBJECT"
    local body="${BODY//RECIPIENT_PLACEHOLDER/$to}"
    
    echo -e "${BLUE}📤 Sending via swaks to $to...${NC}"
    
    # Find MX server for the domain
    local domain=${to#*@}
    local mx_server
    mx_server=$(dig +short MX "$domain" | head -1 | awk '{print $2}' | sed 's/\.$//')
    
    if [ -z "$mx_server" ]; then
        echo -e "${YELLOW}⚠️  No MX record found for $domain, trying direct delivery${NC}"
        mx_server="$domain"
    fi
    
    if swaks --to "$to" --from "$TEST_SENDER" --server "$mx_server" --header "Subject: $subject" --body "$body" --timeout 30 2>/dev/null; then
        echo -e "${GREEN}✅ Email sent successfully to $to${NC}"
        return 0
    else
        echo -e "${RED}❌ Failed to send email to $to${NC}"
        return 1
    fi
}

# Function to send email using sendmail
send_with_sendmail() {
    local to=$1
    local subject="$SUBJECT"
    local body="${BODY//RECIPIENT_PLACEHOLDER/$to}"
    
    echo -e "${BLUE}📤 Sending via sendmail to $to...${NC}"
    
    {
        echo "To: $to"
        echo "From: $TEST_SENDER"
        echo "Subject: $subject"
        echo "Content-Type: text/plain; charset=UTF-8"
        echo ""
        echo "$body"
    } | sendmail "$to" 2>/dev/null
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Email queued successfully to $to${NC}"
        return 0
    else
        echo -e "${RED}❌ Failed to queue email to $to${NC}"
        return 1
    fi
}

# Function to simulate with curl (just checks DNS/MX)
send_with_curl() {
    local to=$1
    local domain=${to#*@}
    
    echo -e "${BLUE}🔍 Checking MX records for $domain via curl...${NC}"
    
    # Use Google's DNS over HTTPS to check MX
    local response
    response=$(curl -s "https://dns.google/resolve?name=$domain&type=MX" 2>/dev/null || echo "")
    
    if [ -z "$response" ]; then
        echo -e "${YELLOW}⚠️  Could not query DNS${NC}"
        return 1
    fi
    
    if echo "$response" | grep -q "cloudflare"; then
        echo -e "${GREEN}✅ MX records point to Cloudflare${NC}"
    elif echo "$response" | grep -q "porkbun\|fwd"; then
        echo -e "${RED}❌ MX records still point to Porkbun!${NC}"
        return 1
    else
        echo -e "${YELLOW}⚠️  MX status unknown from response${NC}"
        echo "   Response: $response"
    fi
    
    echo ""
    echo -e "${YELLOW}Note: curl method only checks DNS, cannot send actual emails.${NC}"
    echo "Please install swaks or sendmail for full email testing."
    
    return 0
}

# Send test emails
RECIPIENTS=()
if [ -n "$SEND_TO" ]; then
    RECIPIENTS=("$SEND_TO")
else
    RECIPIENTS=("${TEST_RECIPIENTS[@]}")
fi

echo -e "${BLUE}📋 Test Recipients:${NC}"
for recipient in "${RECIPIENTS[@]}"; do
    echo "   - $recipient"
done
echo ""

SUCCESS_COUNT=0
FAIL_COUNT=0

for recipient in "${RECIPIENTS[@]}"; do
    case $METHOD in
        swaks)
            if send_with_swaks "$recipient"; then
                SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
            else
                FAIL_COUNT=$((FAIL_COUNT + 1))
            fi
            ;;
        sendmail)
            if send_with_sendmail "$recipient"; then
                SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
            else
                FAIL_COUNT=$((FAIL_COUNT + 1))
            fi
            ;;
        curl)
            send_with_curl "$recipient"
            SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
            ;;
        *)
            echo -e "${RED}❌ Unknown method: $METHOD${NC}"
            exit 1
            ;;
    esac
    echo ""
done

# Summary
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}📊 TEST SUMMARY${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Test ID: $TEST_ID"
echo "Timestamp: $TIMESTAMP"
echo "Method: $METHOD"
echo ""

if [ $FAIL_COUNT -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed ($SUCCESS_COUNT successful)${NC}"
else
    echo -e "${YELLOW}⚠️  Some tests failed: $SUCCESS_COUNT passed, $FAIL_COUNT failed${NC}"
fi

echo ""
echo -e "${BLUE}💡 Next Steps:${NC}"
echo "   1. Check recipient inbox for test email"
echo "   2. If using aevoy routing, check Cloudflare Worker logs:"
echo "      cd workers/email-router && npx wrangler tail"
echo "   3. Verify email appears in the system"
echo ""
echo -e "${BLUE}🔗 Useful Commands:${NC}"
echo "   Check MX records: dig aevoy.com MX"
echo "   Check DNS propagation: https://www.whatsmydns.net/?type=MX&q=aevoy.com"

exit $FAIL_COUNT

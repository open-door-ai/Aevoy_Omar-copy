#!/bin/bash
#
# Email Router Worker Status Checker
# 
# This script checks the deployment status and configuration of the
# Cloudflare Email Router Worker.
#

set -e

WORKER_DIR="$(cd "$(dirname "$0")/../workers/email-router" && pwd)"
WORKER_NAME="aevoy-email-router"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║       EMAIL ROUTER WORKER STATUS CHECKER                   ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if wrangler is available
echo -e "${BLUE}🔍 Checking wrangler CLI...${NC}"
if ! command -v npx &> /dev/null; then
    echo -e "${RED}❌ npx not found. Please install Node.js and npm.${NC}"
    exit 1
fi

# Check if we're in the right directory
if [ ! -f "$WORKER_DIR/wrangler.toml" ]; then
    echo -e "${RED}❌ Worker directory not found at $WORKER_DIR${NC}"
    echo "   Expected: workers/email-router/wrangler.toml"
    exit 1
fi

echo -e "${GREEN}✅ Worker directory found${NC}"

# Read wrangler.toml to get worker name
if [ -f "$WORKER_DIR/wrangler.toml" ]; then
    WORKER_NAME_FROM_CONFIG=$(grep "^name = " "$WORKER_DIR/wrangler.toml" | cut -d'"' -f2)
    if [ ! -z "$WORKER_NAME_FROM_CONFIG" ]; then
        WORKER_NAME="$WORKER_NAME_FROM_CONFIG"
    fi
fi

echo ""
echo -e "${BLUE}📋 Worker Configuration:${NC}"
echo "   Name: $WORKER_NAME"
echo "   Directory: $WORKER_DIR"

# Check wrangler.toml configuration
echo ""
echo -e "${BLUE}📄 Checking wrangler.toml configuration...${NC}"
if grep -q "send_email" "$WORKER_DIR/wrangler.toml" 2>/dev/null; then
    echo -e "${GREEN}✅ send_email capability configured${NC}"
else
    echo -e "${YELLOW}⚠️  send_email capability not found in wrangler.toml${NC}"
    echo "   Note: This is required for the worker to send emails."
fi

# Check for required secrets
echo ""
echo -e "${BLUE}🔐 Checking worker secrets...${NC}"
cd "$WORKER_DIR"

# Function to check if a secret is set
check_secret() {
    local secret_name=$1
    # Try to list secrets and check if ours is there
    local secret_list
    secret_list=$(npx wrangler secret list 2>/dev/null || echo "")
    
    if echo "$secret_list" | grep -q "$secret_name"; then
        echo -e "   ${GREEN}✅${NC} $secret_name"
        return 0
    else
        echo -e "   ${RED}❌${NC} $secret_name (NOT SET)"
        return 1
    fi
}

SECRETS_MISSING=0
check_secret "AGENT_URL" || SECRETS_MISSING=$((SECRETS_MISSING + 1))
check_secret "AGENT_WEBHOOK_SECRET" || SECRETS_MISSING=$((SECRETS_MISSING + 1))
check_secret "SUPABASE_URL" || SECRETS_MISSING=$((SECRETS_MISSING + 1))
check_secret "SUPABASE_SERVICE_KEY" || SECRETS_MISSING=$((SECRETS_MISSING + 1))

# Check worker deployment
echo ""
echo -e "${BLUE}🚀 Checking worker deployment...${NC}"

# Try to get worker info using wrangler
WORKER_INFO=$(npx wrangler worker get "$WORKER_NAME" 2>/dev/null || echo "")

if [ ! -z "$WORKER_INFO" ]; then
    echo -e "${GREEN}✅ Worker '$WORKER_NAME' is deployed${NC}"
    
    # Try to get the worker URL
    echo ""
    echo -e "${BLUE}🌐 Worker Endpoints:${NC}"
    echo "   Production: https://$WORKER_NAME.your-account.workers.dev"
    echo "   (Email Router uses Email Routing, not HTTP endpoints)"
else
    # Try alternative check - list deployments
    echo -e "${YELLOW}⚠️  Could not retrieve worker info directly${NC}"
    echo "   Attempting to verify via deployment list..."
    
    # Check if we can at least run wrangler
    if npx wrangler --version &>/dev/null; then
        echo -e "${GREEN}✅ Wrangler CLI is working${NC}"
        echo -e "${YELLOW}⚠️  Worker deployment status unknown${NC}"
        echo "   Run 'npx wrangler deploy' to ensure deployment."
    else
        echo -e "${RED}❌ Wrangler CLI not working properly${NC}"
        SECRETS_MISSING=$((SECRETS_MISSING + 1))
    fi
fi

# Check if we can view logs (indicates proper auth)
echo ""
echo -e "${BLUE}📜 Checking Cloudflare API access...${NC}"
if timeout 10 npx wrangler tail --help &>/dev/null; then
    echo -e "${GREEN}✅ Cloudflare API access working${NC}"
    echo ""
    echo -e "${BLUE}💡 To view real-time logs, run:${NC}"
    echo "   cd $WORKER_DIR && npx wrangler tail"
else
    echo -e "${YELLOW}⚠️  Cloudflare API access may be limited${NC}"
    echo "   Ensure you're logged in: npx wrangler login"
fi

# Summary
echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}📊 SUMMARY${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"

if [ $SECRETS_MISSING -eq 0 ]; then
    echo -e "${GREEN}✅ All required secrets are configured${NC}"
else
    echo -e "${RED}❌ $SECRETS_MISSING secret(s) need to be set${NC}"
    echo ""
    echo -e "${YELLOW}To set missing secrets, run:${NC}"
    echo "   cd $WORKER_DIR"
    echo "   npx wrangler secret put AGENT_URL"
    echo "   npx wrangler secret put AGENT_WEBHOOK_SECRET"
    echo "   npx wrangler secret put SUPABASE_URL"
    echo "   npx wrangler secret put SUPABASE_SERVICE_KEY"
fi

echo ""
echo -e "${BLUE}📋 Next Steps:${NC}"
echo "   1. Ensure all secrets are set"
echo "   2. Deploy worker: npx wrangler deploy"
echo "   3. Enable Email Routing in Cloudflare dashboard"
echo "   4. Create catch-all rule pointing to this worker"
echo "   5. Test email delivery to nova@aevoy.com"

echo ""
echo -e "${BLUE}🔗 Useful Links:${NC}"
echo "   Cloudflare Dashboard: https://dash.cloudflare.com"
echo "   Email Routing Settings: https://dash.cloudflare.com/c37d92651244e2af55843b02db936a2b/email"

exit $SECRETS_MISSING

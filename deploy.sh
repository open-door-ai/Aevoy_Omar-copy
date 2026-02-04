#!/bin/bash
set -e

# Aevoy Deployment Script
# Usage: ./deploy.sh [agent|worker|web|all]

COMPONENT="${1:-all}"

echo "=== Aevoy Deployment ==="
echo "Component: $COMPONENT"
echo ""

# --- Agent Server (VPS) ---
deploy_agent() {
    echo "--- Deploying Agent Server ---"

    if [ -z "$VPS_HOST" ]; then
        echo "ERROR: Set VPS_HOST environment variable (e.g., export VPS_HOST=agent.aevoy.com)"
        echo "       Also set VPS_USER (default: root)"
        exit 1
    fi

    VPS_USER="${VPS_USER:-root}"

    echo "1. Building agent Docker image locally..."
    cd packages/agent
    docker build -t aevoy-agent:latest .

    echo "2. Saving and transferring image to VPS..."
    docker save aevoy-agent:latest | gzip > /tmp/aevoy-agent.tar.gz
    scp /tmp/aevoy-agent.tar.gz "$VPS_USER@$VPS_HOST:/tmp/"

    echo "3. Loading image and starting on VPS..."
    ssh "$VPS_USER@$VPS_HOST" << 'REMOTE'
        docker load < /tmp/aevoy-agent.tar.gz
        rm /tmp/aevoy-agent.tar.gz

        # Stop existing container if running
        docker stop aevoy-agent 2>/dev/null || true
        docker rm aevoy-agent 2>/dev/null || true

        # Start new container
        docker run -d \
            --name aevoy-agent \
            --restart unless-stopped \
            -p 3001:3001 \
            --env-file /opt/aevoy/.env \
            -v aevoy-workspaces:/app/workspaces \
            aevoy-agent:latest

        echo "Agent container started. Checking health..."
        sleep 5
        curl -s http://localhost:3001/health | python3 -m json.tool || echo "Health check pending..."
REMOTE

    cd ../..
    echo "Agent deployed to $VPS_HOST:3001"
    echo ""
}

# --- Cloudflare Email Worker ---
deploy_worker() {
    echo "--- Deploying Cloudflare Email Worker ---"

    cd workers/email-router

    echo "1. Installing dependencies..."
    pnpm install

    echo "2. Deploying to Cloudflare..."
    npx wrangler deploy

    echo ""
    echo "IMPORTANT: After deployment, set secrets:"
    echo "  cd workers/email-router"
    echo "  npx wrangler secret put AGENT_URL           # https://agent.aevoy.com"
    echo "  npx wrangler secret put AGENT_WEBHOOK_SECRET"
    echo "  npx wrangler secret put SUPABASE_URL"
    echo "  npx wrangler secret put SUPABASE_SERVICE_KEY"
    echo ""
    echo "Then in Cloudflare Dashboard:"
    echo "  1. Go to Email > Email Routing"
    echo "  2. Enable Email Routing for aevoy.com"
    echo "  3. Add catch-all rule -> Worker: aevoy-email-router"

    cd ../..
    echo ""
}

# --- Web App (Vercel) ---
deploy_web() {
    echo "--- Deploying Web App to Vercel ---"

    cd apps/web

    echo "1. Building..."
    pnpm build

    echo "2. Deploying to Vercel..."
    if command -v vercel &> /dev/null; then
        vercel --prod
    else
        echo "Vercel CLI not installed. Install with: npm i -g vercel"
        echo "Then run: cd apps/web && vercel --prod"
    fi

    cd ../..
    echo ""
}

# --- Run selected deployment ---
case "$COMPONENT" in
    agent)
        deploy_agent
        ;;
    worker)
        deploy_worker
        ;;
    web)
        deploy_web
        ;;
    all)
        deploy_agent
        deploy_worker
        deploy_web
        ;;
    *)
        echo "Usage: ./deploy.sh [agent|worker|web|all]"
        exit 1
        ;;
esac

echo "=== Deployment Complete ==="

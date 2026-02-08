# Email Routing Setup Guide for aevoy.com

## Current Status

| Component | Status | Details |
|-----------|--------|---------|
| Nameservers | ✅ Working | Pointing to Cloudflare (osmar.ns.cloudflare.com, zelda.ns.cloudflare.com) |
| Email Worker | ✅ Deployed | aevoy-email-router is deployed to Cloudflare Workers |
| MX Records | ❌ **BROKEN** | Still pointing to Porkbun (fwd1.porkbun.com, fwd2.porkbun.com) |
| Email Routing | ❌ Disabled | Needs to be enabled in Cloudflare dashboard |
| Catch-all Rule | ⚠️ Not Created | Needs to be configured after Email Routing is enabled |

## Why Emails Are Bouncing

The error **"550 5.1.1 Domain does not exist"** occurs because:

1. **MX records point to Porkbun's mail forwarding servers** (`fwd1.porkbun.com`, `fwd2.porkbun.com`)
2. **Porkbun only supports basic forwarding to ONE email address**
3. When trying to forward to the Cloudflare Worker, Porkbun rejects it
4. Senders see "Domain does not exist" because the Porkbun forwarder cannot resolve the destination

## What Needs To Be Fixed

### ❌ PROBLEM: Current MX Records (WRONG)
```
10 fwd1.porkbun.com.   ← DELETE THIS
20 fwd2.porkbun.com.   ← DELETE THIS
```

### ✅ SOLUTION: Cloudflare Email Routing MX Records
```
69 route1.mx.cloudflare.net.   ← ADD THIS
23 route2.mx.cloudflare.net.   ← ADD THIS
86 route3.mx.cloudflare.net.   ← ADD THIS
```

---

## Step-by-Step Fix Instructions

### Step 1: Update MX Records in Cloudflare Dashboard

1. **Log in to Cloudflare Dashboard:**
   - URL: https://dash.cloudflare.com/login
   - Use account with access to aevoy.com

2. **Navigate to DNS Settings:**
   - Select domain: **aevoy.com**
   - Click: **DNS** → **Records**

3. **Delete Old Porkbun MX Records:**
   Find and delete these records:
   - ❌ Delete: `MX` record with content `fwd1.porkbun.com` (Priority: 10)
   - ❌ Delete: `MX` record with content `fwd2.porkbun.com` (Priority: 20)

4. **Add Cloudflare Email Routing MX Records:**

   | Priority | Type | Name | Content | TTL |
   |----------|------|------|---------|-----|
   | 69 | MX | @ | route1.mx.cloudflare.net | Auto |
   | 23 | MX | @ | route2.mx.cloudflare.net | Auto |
   | 86 | MX | @ | route3.mx.cloudflare.net | Auto |

   **How to add each record:**
   - Click **"Add record"**
   - Type: Select **MX**
   - Name: Enter **@** (or leave blank for root domain)
   - Mail server: Enter the content from table above
   - Priority: Enter the number from table above
   - TTL: Leave as **Auto**
   - Click **Save**

### Step 2: Enable Email Routing in Cloudflare

1. **Navigate to Email Routing:**
   - Direct URL: https://dash.cloudflare.com/c37d92651244e2af55843b02db936a2b/email
   - Or: Click **Email** → **Email Routing**

2. **Enable Email Routing:**
   - Click **"Get Started"** or **"Enable Email Routing"**
   - Confirm you're adding routing for **aevoy.com**
   - Accept the prompt to add/update MX records (this is optional if you already added them in Step 1)

3. **Wait for Activation:**
   - Cloudflare will verify the MX records
   - This may take a few minutes

### Step 3: Create a Catch-all Email Routing Rule

After Email Routing is enabled:

1. **Go to Email Routing Rules:**
   - Dashboard: https://dash.cloudflare.com/c37d92651244e2af55843b02db936a2b/email/routing-rules
   - Or: Click **Email** → **Routing Rules**

2. **Create Catch-all Rule:**
   - Click **"Create Address"** or **"Add Rule"**
   - **Custom address:** Enter `*` (asterisk - this matches all addresses)
   - **Action:** Select **"Send to Workers"**
   - **Worker:** Select **`aevoy-email-router`**
   - Click **Save**

3. **Verify the Rule:**
   - You should see a rule like: `*@aevoy.com` → Worker: `aevoy-email-router`

### Step 4: Verify Worker Secrets

Ensure the email-router worker has these secrets set:

```bash
cd /workspaces/Aevoy_Omar-copy/workers/email-router

# Set the agent URL
npx wrangler secret put AGENT_URL
# Value: https://hissing-verile-aevoy-e721b4a6.koyeb.app

# Set the webhook secret (same as in agent .env)
npx wrangler secret put AGENT_WEBHOOK_SECRET
# Value: (get from agent .env file)

# Set Supabase URL
npx wrangler secret put SUPABASE_URL
# Value: https://eawoquqgfndmphogwjeu.supabase.co

# Set Supabase service key
npx wrangler secret put SUPABASE_SERVICE_KEY
# Value: (from Supabase dashboard)
```

### Step 5: Redeploy Email Router Worker

```bash
cd /workspaces/Aevoy_Omar-copy/workers/email-router
npx wrangler deploy
```

### Step 6: Test Email Delivery

1. **Send a test email:**
   ```bash
   # Use the test script
   cd /workspaces/Aevoy_Omar-copy
   ./scripts/test-email.sh --to nova@aevoy.com
   ```

2. **Or manually send an email to:** `test@aevoy.com`

3. **Check Cloudflare Worker logs:**
   ```bash
   cd /workspaces/Aevoy_Omar-copy/workers/email-router
   npx wrangler tail
   ```

4. **Verify email was processed by checking:**
   - Worker logs show email received
   - Agent received the webhook
   - Task was created in the system

---

## Automated Scripts

We've created helper scripts to check status and test email:

### Check DNS Status
```bash
# Check current MX records and DNS configuration
node /tmp/check-dns.mjs
# Or run the full checker:
cd /workspaces/Aevoy_Omar-copy && npx tsx scripts/check-dns-status.ts
```

### Check Worker Status
```bash
# Check if worker is deployed and secrets are set
cd /workspaces/Aevoy_Omar-copy
./scripts/check-worker-status.sh
```

### Test Email Delivery
```bash
# Send test emails
cd /workspaces/Aevoy_Omar-copy
./scripts/test-email.sh --to nova@aevoy.com
```

---

## DNS Verification Commands

### Check Current MX Records
```bash
dig aevoy.com MX +short
```

**Expected output after fix:**
```
23 route2.mx.cloudflare.net.
69 route1.mx.cloudflare.net.
86 route3.mx.cloudflare.net.
```

### Check Nameservers
```bash
dig aevoy.com NS +short
```

**Expected output:**
```
osmar.ns.cloudflare.com.
zelda.ns.cloudflare.com.
```

### Check DNS Propagation
Use online tools to verify DNS changes have propagated globally:
- https://www.whatsmydns.net/?type=MX&q=aevoy.com

---

## Troubleshooting

### "Domain does not exist" Error

**Cause:** MX records still point to Porkbun

**Fix:**
1. Run `dig aevoy.com MX +short` to verify current records
2. If you see `fwd1.porkbun.com` or `fwd2.porkbun.com`, follow Step 1 above
3. Wait for DNS propagation (1-48 hours)

### Worker Not Receiving Emails

**Checklist:**
- [ ] Email Routing is enabled in Cloudflare dashboard
- [ ] Catch-all rule (`*`) points to `aevoy-email-router` worker
- [ ] Worker is deployed: `npx wrangler deploy`
- [ ] All secrets are set: `npx wrangler secret list`
- [ ] Check logs: `npx wrangler tail`

### Agent Not Processing Emails

**Checklist:**
- [ ] `AGENT_URL` secret is correct and reachable
- [ ] `AGENT_WEBHOOK_SECRET` matches the agent's webhook secret
- [ ] Agent's `/task/incoming` endpoint exists and responds
- [ ] Check agent logs for webhook errors

### "User not found" Error

**Cause:** Email sent to username that doesn't exist in Supabase

**Fix:**
- Ensure the username part of the email (before @) matches a username in the `profiles` table
- Test with a known valid user like `nova@aevoy.com`

---

## Current DNS Configuration (Verified)

### Nameservers (✅ Correct)
```
osmar.ns.cloudflare.com
zelda.ns.cloudflare.com
```

### MX Records (❌ Must be Fixed)
```
# Current (WRONG - Porkbun):
10 fwd1.porkbun.com
20 fwd2.porkbun.com

# Required (CORRECT - Cloudflare):
69 route1.mx.cloudflare.net
23 route2.mx.cloudflare.net
86 route3.mx.cloudflare.net
```

---

## Related Files

- **Worker code:** `workers/email-router/src/index.ts`
- **Worker config:** `workers/email-router/wrangler.toml`
- **DNS checker:** `scripts/check-dns-status.ts`
- **Worker checker:** `scripts/check-worker-status.sh`
- **Email tester:** `scripts/test-email.sh`

---

## Quick Reference Card

### Cloudflare Dashboard Links
- **DNS Records:** https://dash.cloudflare.com/c37d92651244e2af55843b02db936a2b/aevoy.com/dns
- **Email Routing:** https://dash.cloudflare.com/c37d92651244e2af55843b02db936a2b/email
- **Workers:** https://dash.cloudflare.com/c37d92651244e2af55843b02db936a2b/workers

### Worker Commands
```bash
# Deploy worker
cd workers/email-router && npx wrangler deploy

# View logs
cd workers/email-router && npx wrangler tail

# Set secrets
cd workers/email-router && npx wrangler secret put NAME

# List secrets
cd workers/email-router && npx wrangler secret list
```

### Testing Commands
```bash
# Check MX records
dig aevoy.com MX +short

# Check nameservers
dig aevoy.com NS +short

# Test email routing
curl -v smtp://route1.mx.cloudflare.net:25 --mail-from test@test.com --mail-rcpt nova@aevoy.com
```

---

## Last Updated

**Date:** 2026-02-08
**Status:** Waiting for MX record update in Cloudflare dashboard
**Next Action:** Delete Porkbun MX records, add Cloudflare MX records, enable Email Routing

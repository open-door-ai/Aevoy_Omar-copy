# Onboarding Critical Issues - Implementation Plan
**Date:** 2026-02-07
**Priority:** URGENT
**Timeline:** 24 hours

---

## Issues Identified (From User Feedback):

### 1. UI Contrast Issues ⚠️ CRITICAL
**Problem:**
- Black on black (illegible)
- White on light blue (poor contrast)
- Dark on dark, light on light (elements fade into each other)

### 2. Email Verification Broken ⚠️ CRITICAL
**Problem:**
- Auto-sends user through without clicking "Confirm Email" button
- Verification process bypassed

### 3. Phone Verification Not Working ⚠️ CRITICAL
**Problem:**
- "Call Me" button doesn't actually call
- Demo calls work, but onboarding calls don't
- Twilio shows as "configured" in health check

---

## Step 1: Audit Onboarding Files (Next 10 minutes)

Need to locate and read:
- [ ] `apps/web/components/onboarding/step-welcome.tsx`
- [ ] `apps/web/components/onboarding/step-email.tsx`
- [ ] `apps/web/components/onboarding/step-phone.tsx`
- [ ] `apps/web/components/onboarding/step-interview.tsx`
- [ ] `apps/web/components/onboarding/step-tour.tsx`

Already Read:
- ✅ `apps/web/components/onboarding/onboarding-flow.tsx` (main orchestrator)

---

## Step 2: Fix UI Contrast Issues (2 hours)

### Changes Required:

#### File: All step-*.tsx files

**Current Problem Examples:**
```tsx
// BAD: Black on black
<div className="bg-black text-black">Text</div>

// BAD: White on light blue
<div className="bg-blue-100 text-white">Text</div>

// BAD: Low contrast
<div className="bg-gray-800 text-gray-700">Text</div>
```

**Fix: WCAG AAA Contrast (7:1 minimum)**
```tsx
// GOOD: Dark text on light background
<div className="bg-white text-gray-900">Text</div>

// GOOD: Light text on dark background
<div className="bg-gray-900 text-white">Text</div>

// GOOD: High contrast blue
<div className="bg-blue-600 text-white">Text</div>
```

**Color Palette (Safe for Onboarding):**
- Background: `bg-white`
- Primary text: `text-gray-900` (almost black, high contrast)
- Secondary text: `text-gray-600` (medium gray, still readable)
- Accent: `bg-blue-600` with `text-white`
- Borders: `border-gray-300`
- Disabled: `text-gray-400`

**Testing:**
- Use WebAIM Contrast Checker (https://webaim.org/resources/contrastchecker/)
- Test with Chrome DevTools "Emulate vision deficiencies"
- All combinations must be 7:1+ contrast ratio

---

## Step 3: Fix Email Verification (4 hours)

### Current Flow (Broken):
```
User enters email → ??? → Next step
```

### Expected Flow:
```
User enters email
  → Send verification email (with 6-digit code or link)
  → User clicks link OR enters code
  → Backend verifies code
  → Email confirmed
  → Next step
```

### Implementation Plan:

#### A. Update `step-email.tsx` (Add Verification Input)

**Current (Hypothetical):**
```tsx
<input
  type="email"
  value={email}
  onChange={(e) => setEmail(e.target.value)}
/>
<Button onClick={() => onNext(username)}>Next</Button>
```

**Fix: Add Verification Step**
```tsx
const [step, setStep] = useState<'input' | 'verify'>('input');
const [code, setCode] = useState('');
const [verifying, setVerifying] = useState(false);

// Step 1: Enter email
{step === 'input' && (
  <>
    <input
      type="email"
      value={email}
      onChange={(e) => setEmail(e.target.value)}
    />
    <Button onClick={handleSendCode}>Send Verification Code</Button>
  </>
)}

// Step 2: Verify code
{step === 'verify' && (
  <>
    <p className="text-gray-900">
      We sent a 6-digit code to <strong>{email}</strong>
    </p>
    <input
      type="text"
      maxLength={6}
      value={code}
      onChange={(e) => setCode(e.target.value)}
      placeholder="000000"
      className="text-center text-2xl tracking-widest"
    />
    <Button onClick={handleVerifyCode} disabled={verifying}>
      {verifying ? 'Verifying...' : 'Confirm Email'}
    </Button>
    <Button variant="ghost" onClick={() => setStep('input')}>
      Use different email
    </Button>
  </>
)}
```

#### B. Create API Route: `/api/auth/send-verification`

**File:** `apps/web/app/api/auth/send-verification/route.ts` (NEW)

```typescript
import { createClient } from '@/lib/supabase/server';
import { sendResponse } from '@/lib/email';
import crypto from 'crypto';

export async function POST(request: Request) {
  const { email, userId } = await request.json();

  // Generate 6-digit code
  const code = crypto.randomInt(100000, 999999).toString();

  // Store in database (expires in 10 minutes)
  const supabase = createClient();
  await supabase.from('email_verification_codes').insert({
    user_id: userId,
    email,
    code,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });

  // Send email
  await sendResponse({
    to: email,
    from: 'noreply@aevoy.com',
    subject: 'Your Aevoy verification code',
    body: `Your verification code is: ${code}\n\nThis code expires in 10 minutes.`,
  });

  return Response.json({ success: true });
}
```

#### C. Create API Route: `/api/auth/verify-code`

**File:** `apps/web/app/api/auth/verify-code/route.ts` (NEW)

```typescript
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  const { userId, code } = await request.json();

  const supabase = createClient();

  // Check code
  const { data, error } = await supabase
    .from('email_verification_codes')
    .select('*')
    .eq('user_id', userId)
    .eq('code', code)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (error || !data) {
    return Response.json({ success: false, error: 'Invalid or expired code' });
  }

  // Mark email as verified
  await supabase
    .from('profiles')
    .update({ email_verified: true })
    .eq('id', userId);

  // Delete used code
  await supabase
    .from('email_verification_codes')
    .delete()
    .eq('id', data.id);

  return Response.json({ success: true });
}
```

#### D. Database Migration (v17)

**File:** `apps/web/supabase/migration_v17.sql` (NEW)

```sql
-- Email verification codes table
CREATE TABLE IF NOT EXISTS email_verification_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add email_verified field to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;

-- Index for fast lookups
CREATE INDEX idx_email_verification_user_code ON email_verification_codes(user_id, code);

-- RLS
ALTER TABLE email_verification_codes ENABLE ROW LEVEL SECURITY;

-- Cleanup function (auto-delete expired codes)
CREATE OR REPLACE FUNCTION cleanup_expired_verification_codes()
RETURNS void AS $$
BEGIN
  DELETE FROM email_verification_codes WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;
```

---

## Step 4: Fix Phone Verification (6 hours)

### Current Flow (Broken):
```
User clicks "Call Me" → ??? (nothing happens)
```

### Expected Flow:
```
User enters phone number
  → User clicks "Call Me"
  → Frontend calls API endpoint
  → Backend calls Twilio
  → Twilio calls user's phone
  → User hears AI greeting
  → User presses 1 to verify
  → Backend confirms verification
  → Next step
```

### Investigation Steps:

#### A. Find step-phone.tsx File
```bash
find /workspaces/Aevoy_Omar-copy -name "step-phone.tsx" -type f
```

#### B. Check What API It Calls
Read the file and look for:
```tsx
fetch('/api/...', { ... })
```

#### C. Verify API Endpoint Exists
Check if the endpoint is in `apps/web/app/api/`

#### D. Common Issues to Check:

**Issue 1: Wrong Endpoint**
```tsx
// WRONG (doesn't exist)
fetch('/api/onboarding/call-me', { ... })

// RIGHT (exists in agent)
fetch('https://hissing-verile-aevoy-e721b4a6.koyeb.app/webhook/voice/:userId', { ... })
```

**Issue 2: Missing userId**
```tsx
// WRONG (onboarding user not created yet)
fetch(`/api/call/${userId}`)

// RIGHT (create profile first, then call)
const { data: user } = await supabase.auth.getUser();
fetch(`/api/call/${user.id}`)
```

**Issue 3: Twilio Webhook Not Configured**
- Check Twilio console: https://console.twilio.com
- Verify webhook URL is correct
- Verify phone number has webhook attached

#### E. Create Onboarding-Specific Call Endpoint

**File:** `apps/web/app/api/onboarding/verify-phone/route.ts` (NEW)

```typescript
export async function POST(request: Request) {
  const { userId, phone } = await request.json();

  // Forward to agent server
  const agentUrl = process.env.AGENT_URL;
  const response = await fetch(`${agentUrl}/webhook/voice/onboarding`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Secret': process.env.AGENT_WEBHOOK_SECRET!,
    },
    body: JSON.stringify({ userId, phone }),
  });

  if (!response.ok) {
    return Response.json({ success: false, error: 'Failed to initiate call' });
  }

  return Response.json({ success: true });
}
```

#### F. Create Agent Endpoint for Onboarding Calls

**File:** `packages/agent/src/index.ts` (Add route)

```typescript
app.post("/webhook/voice/onboarding", twilioLimiter, async (req, res) => {
  const { userId, phone } = req.body;

  // Verify webhook secret
  const secret = req.headers["x-webhook-secret"];
  if (!verifyWebhookSecret(secret)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Call user via Twilio
  try {
    const twilio = require("twilio");
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    const call = await client.calls.create({
      to: phone,
      from: process.env.TWILIO_PHONE_NUMBER,
      url: `${process.env.AGENT_URL}/webhook/voice/onboarding-greeting/${userId}`,
      statusCallback: `${process.env.AGENT_URL}/webhook/voice/onboarding-status/${userId}`,
    });

    res.json({ success: true, callSid: call.sid });
  } catch (error) {
    console.error("[ONBOARDING] Twilio call error:", error);
    res.status(500).json({ success: false, error: "Twilio error" });
  }
});

app.post("/webhook/voice/onboarding-greeting/:userId", twilioLimiter, validateTwilioSignature, async (req, res) => {
  const { userId } = req.params;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">
    Hi! This is Aevoy, your AI assistant. I'm calling to verify your phone number for onboarding.

    Press 1 to confirm this is your number, or press 2 to cancel.
  </Say>
  <Gather numDigits="1" action="${process.env.AGENT_URL}/webhook/voice/onboarding-verify/${userId}">
    <Pause length="5" />
  </Gather>
  <Say>I didn't receive a response. Goodbye.</Say>
</Response>`;

  res.type("text/xml");
  res.send(twiml);
});

app.post("/webhook/voice/onboarding-verify/:userId", twilioLimiter, validateTwilioSignature, async (req, res) => {
  const { userId } = req.params;
  const digit = req.body.Digits;

  if (digit === "1") {
    // Mark phone as verified
    await getSupabaseClient()
      .from("profiles")
      .update({ phone_verified: true })
      .eq("id", userId);

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Perfect! Your phone number is verified. You can now continue with onboarding. Goodbye!</Say>
  <Hangup />
</Response>`;

    res.type("text/xml");
    res.send(twiml);
  } else {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Verification cancelled. Please try again from the onboarding page. Goodbye!</Say>
  <Hangup />
</Response>`;

    res.type("text/xml");
    res.send(twiml);
  }
});
```

#### G. Update step-phone.tsx to Use New Endpoint

```tsx
const handleCallMe = async () => {
  setCalling(true);

  try {
    const response = await fetch('/api/onboarding/verify-phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: user.id, // Get from Supabase auth
        phone: formattedPhone,
      }),
    });

    const data = await response.json();

    if (data.success) {
      setStep('waiting'); // Show "Waiting for call..." UI
      // Poll for verification status
      pollVerificationStatus();
    } else {
      alert('Failed to initiate call: ' + data.error);
    }
  } catch (error) {
    alert('Error calling Twilio');
  } finally {
    setCalling(false);
  }
};

const pollVerificationStatus = async () => {
  const interval = setInterval(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('phone_verified')
      .eq('id', user.id)
      .single();

    if (data?.phone_verified) {
      clearInterval(interval);
      onNext(formattedPhone); // Proceed to next step
    }
  }, 2000); // Poll every 2 seconds
};
```

---

## Step 5: Testing Plan (2 hours)

### A. UI Contrast Testing
1. Open onboarding in Chrome DevTools
2. Run Lighthouse accessibility audit
3. Check contrast ratios (must be 7:1+)
4. Test with vision deficiency emulation:
   - Protanopia (red-blind)
   - Deuteranopia (green-blind)
   - Tritanopia (blue-blind)
   - Achromatopsia (monochrome)
5. All text must be readable in all modes

### B. Email Verification Testing
1. Start onboarding, enter email
2. Click "Send Verification Code"
3. Check email inbox for code
4. Enter code
5. Verify "Next" button becomes enabled
6. Proceed to next step
7. Confirm email_verified = true in database

### C. Phone Verification Testing
1. Start onboarding, enter phone number
2. Click "Call Me"
3. Wait 10 seconds (Twilio latency)
4. Phone should ring
5. Answer call
6. Hear AI greeting
7. Press 1 to verify
8. Hear confirmation message
9. Onboarding UI updates automatically
10. Proceed to next step
11. Confirm phone_verified = true in database

---

## Step 6: Deployment Checklist

- [ ] Apply migration v17 (email_verification_codes table)
- [ ] Build and deploy web app (Vercel)
- [ ] Build and deploy agent (Koyeb)
- [ ] Test all 3 issues on production
- [ ] Update CLAUDE.md with fixes
- [ ] Mark issues as resolved in this document

---

## Timeline:

| Task | Duration | Start | End |
|------|----------|-------|-----|
| Audit onboarding files | 10 min | Now | Now+10m |
| Fix UI contrast | 2 hours | Now+10m | Now+2h10m |
| Fix email verification | 4 hours | Now+2h10m | Now+6h10m |
| Fix phone verification | 6 hours | Now+6h10m | Now+12h10m |
| Testing | 2 hours | Now+12h10m | Now+14h10m |
| Deployment | 30 min | Now+14h10m | Now+14h40m |
| **Total** | **14h40m** | **Today** | **Tomorrow** |

---

## Immediate Next Steps (Right Now):

1. Find all step-*.tsx files (Glob search)
2. Read each file and document current state
3. Identify contrast issues (screenshot with DevTools)
4. Identify verification flow bugs
5. Create detailed fix plan for each file
6. Implement fixes one by one
7. Test thoroughly
8. Deploy

Let's start NOW.

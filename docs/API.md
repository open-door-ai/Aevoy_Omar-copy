# API Specifications

## Three APIs

1. **Web API** — Dashboard, auth (Vercel)
2. **Agent API** — Task processing (VPS)
3. **Desktop API** — Local task processing (Electron)

---

## Web API

Base: `https://aevoy.com/api`

### Auth (via Supabase)

Handled by Supabase Auth SDK. No custom endpoints needed.

### GET /api/user

Get current user's profile.

**Response:**
```json
{
  "id": "uuid",
  "username": "omar",
  "email": "omar@gmail.com",
  "aiEmail": "omar@aevoy.com",
  "twilioNumber": "+16041234567",
  "proactiveEnabled": true,
  "subscription": {
    "tier": "pro",
    "status": "beta",
    "messagesUsed": 47,
    "messagesLimit": 500
  }
}
```

### PATCH /api/user

Update profile.

### GET /api/tasks

List user's tasks.

**Query:** `?limit=20&offset=0&status=completed`

### GET /api/tasks/:id

Get single task with verification data.

### GET /api/scheduled-tasks

List scheduled tasks.

### POST /api/scheduled-tasks

Create scheduled task.

### DELETE /api/scheduled-tasks/:id

Delete scheduled task.

### GET /api/memory

Get user memories (filtered by type).

**Query:** `?type=long_term&limit=20`

**Response:**
```json
{
  "memories": [
    {
      "id": "uuid",
      "type": "long_term",
      "content": "Prefers window seats",
      "importance": 0.9,
      "createdAt": "2026-01-15T09:00:00Z"
    }
  ]
}
```

### POST /api/memory

Add new memory.

**Request:**
```json
{
  "type": "long_term",
  "content": "Prefers Italian food"
}
```

### GET /api/usage

Get detailed usage stats and costs.

**Query:** `?month=2026-02`

**Response:**
```json
{
  "month": "2026-02",
  "browserTasks": 15,
  "simpleTasks": 42,
  "smsCount": 8,
  "voiceMinutes": 12,
  "aiCostCents": 245,
  "totalTasks": 57
}
```

### GET /api/stats

Get summary statistics.

### DELETE /api/user/data

Delete all user data (GDPR).

---

## Agent API

Base: `https://agent.aevoy.com` (or `localhost:3001` in dev)

### POST /task

Receive task from email worker (legacy direct processing).

**Headers:**
```
X-Webhook-Secret: <secret>
Content-Type: application/json
```

### POST /task/incoming

Receive task with confirmation flow.

### POST /task/confirm

Handle user confirmation reply.

### POST /task/verification

Handle verification code from user.

### POST /webhook/voice/:userId

Handle incoming Twilio voice call.

**Response:** TwiML XML for voice flow.

### POST /webhook/voice/process/:userId

Process voice command after transcription.

### POST /webhook/sms/:userId

Handle incoming SMS.

### GET /health

Health check.

**Response:**
```json
{
  "status": "healthy",
  "version": "2.0.0",
  "timestamp": "2026-02-02T09:00:00Z"
}
```

---

## Webhook Endpoints (Twilio)

### POST /api/webhooks/twilio/voice

Proxy for Twilio voice webhooks from web app.

### POST /api/webhooks/twilio/sms

Proxy for Twilio SMS webhooks from web app.

---

## Error Responses

All errors follow this format:

```json
{
  "error": "error_code",
  "message": "Human readable message"
}
```

**Error codes:**
- `unauthorized` (401)
- `forbidden` (403)
- `not_found` (404)
- `over_quota` (402)
- `rate_limited` (429)
- `internal_error` (500)

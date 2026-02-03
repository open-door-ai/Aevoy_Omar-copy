# Database Schema

Using Supabase (PostgreSQL) with Row Level Security.

## Tables

### profiles

Extends Supabase auth.users with app-specific data.

```sql
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT,
  phone VARCHAR(50),

  -- Settings
  timezone TEXT DEFAULT 'America/Los_Angeles',
  proactive_enabled BOOLEAN DEFAULT FALSE,

  -- Subscription
  subscription_tier TEXT DEFAULT 'free',
  subscription_status VARCHAR(50) DEFAULT 'trial',
  subscription_ends_at TIMESTAMPTZ,
  messages_used INT DEFAULT 0,
  messages_limit INT DEFAULT 20,

  -- Integrations
  stripe_customer_id VARCHAR(255),
  twilio_number VARCHAR(50),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_active_at TIMESTAMPTZ
);
```

### tasks

Records of every task processed.

```sql
CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,

  -- Task info
  status TEXT DEFAULT 'pending',
  type TEXT,
  email_subject TEXT,
  input_text TEXT,
  input_channel TEXT DEFAULT 'email',

  -- AI classification
  structured_intent JSONB,
  confidence DECIMAL(3,2),
  stuck_reason TEXT,

  -- Verification
  verification_status TEXT,
  verification_data JSONB,

  -- Timing
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  execution_time_ms INT,

  -- Cost
  tokens_used INT DEFAULT 0,
  cost_usd DECIMAL(10,6) DEFAULT 0,

  -- Error
  error_message TEXT
);
```

### action_history (Undo system)

```sql
CREATE TABLE public.action_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  action_data JSONB NOT NULL,
  undo_data JSONB,
  screenshot_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### transactions (Purchase tracking)

```sql
CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  amount_cents INT NOT NULL,
  merchant TEXT,
  description TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### prepaid_cards (Stub — deferred)

```sql
CREATE TABLE public.prepaid_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  provider TEXT DEFAULT 'stripe',
  card_token_encrypted TEXT,
  last_four VARCHAR(4),
  balance_cents INT DEFAULT 0,
  per_tx_limit_cents INT DEFAULT 5000,
  monthly_limit_cents INT DEFAULT 20000,
  is_frozen BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### user_memory

```sql
CREATE TABLE public.user_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  memory_type TEXT NOT NULL DEFAULT 'working',
  encrypted_data TEXT NOT NULL,
  importance DECIMAL(3,2) DEFAULT 0.5,
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### user_credentials (Encrypted logins)

```sql
CREATE TABLE public.user_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  site_domain VARCHAR(255) NOT NULL,
  encrypted_data TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_user_site UNIQUE(user_id, site_domain)
);
```

### failure_memory (Global learning)

```sql
CREATE TABLE public.failure_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_domain VARCHAR(255) NOT NULL,
  site_path VARCHAR(500),
  action_type VARCHAR(50) NOT NULL,
  original_selector VARCHAR(1000) DEFAULT '',
  original_method VARCHAR(50),
  error_type VARCHAR(100) NOT NULL,
  error_message TEXT,
  solution_method VARCHAR(50),
  solution_selector VARCHAR(1000),
  solution_steps JSONB,
  success_rate DECIMAL(5,2) DEFAULT 100.00,
  times_used INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_failure UNIQUE(site_domain, action_type, original_selector)
);
```

### usage (Cost tracking)

```sql
CREATE TABLE public.usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  month VARCHAR(7) NOT NULL,
  browser_tasks INTEGER DEFAULT 0,
  simple_tasks INTEGER DEFAULT 0,
  sms_count INTEGER DEFAULT 0,
  voice_minutes INTEGER DEFAULT 0,
  ai_cost_cents INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_user_month UNIQUE(user_id, month)
);
```

### scheduled_tasks

```sql
CREATE TABLE public.scheduled_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  task_template TEXT,
  cron_expression TEXT NOT NULL,
  timezone TEXT DEFAULT 'America/Los_Angeles',
  next_run_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  run_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Row Level Security

All tables with user data have RLS enabled:

```sql
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prepaid_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage ENABLE ROW LEVEL SECURITY;

-- Pattern: auth.uid() = user_id (or id for profiles)
-- Service role bypasses for agent server operations
```

## Migrations

- `supabase/migration.sql` — Initial schema (profiles, tasks, scheduled_tasks)
- `supabase/migration_v2.sql` — V2 additions (failure_memory, user_credentials, user_memory, usage)
- `supabase/migration_v3.sql` — V3 additions (action_history, transactions, prepaid_cards, column updates)

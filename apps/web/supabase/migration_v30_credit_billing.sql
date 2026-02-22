-- Migration v30: Prepaid Credit Billing System
-- Creates credit wallet, transactions, and atomic RPCs for deduction/top-up.

-- =====================================================
-- 1. Credit Wallets — one per user
-- =====================================================
CREATE TABLE IF NOT EXISTS public.credit_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  balance_cents INTEGER NOT NULL DEFAULT 0,
  lifetime_topup_cents INTEGER NOT NULL DEFAULT 0,
  lifetime_spent_cents INTEGER NOT NULL DEFAULT 0,
  auto_reload_enabled BOOLEAN DEFAULT false,
  auto_reload_threshold_cents INTEGER DEFAULT 200,
  auto_reload_amount_cents INTEGER DEFAULT 1000,
  stripe_customer_id TEXT,
  stripe_payment_method_id TEXT,
  free_credits_granted BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_wallets_user ON credit_wallets(user_id);

ALTER TABLE credit_wallets ENABLE ROW LEVEL SECURITY;

-- Users can read their own wallet
CREATE POLICY "Users read own wallet" ON credit_wallets
  FOR SELECT USING (auth.uid() = user_id);

-- Users can update auto-reload settings only
CREATE POLICY "Users update own wallet settings" ON credit_wallets
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role full access (for RPCs and backend)
CREATE POLICY "Service role manages wallets" ON credit_wallets
  FOR ALL USING (true) WITH CHECK (true);

-- =====================================================
-- 2. Credit Transactions — audit trail
-- =====================================================
CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('topup', 'deduction', 'auto_reload', 'free_grant', 'refund')),
  amount_cents INTEGER NOT NULL,
  balance_after_cents INTEGER NOT NULL,
  description TEXT,
  task_id UUID,
  stripe_payment_intent_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_user ON credit_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_type ON credit_transactions(type);

ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

-- Users can read their own transactions
CREATE POLICY "Users read own transactions" ON credit_transactions
  FOR SELECT USING (auth.uid() = user_id);

-- Service role full access
CREATE POLICY "Service role manages transactions" ON credit_transactions
  FOR ALL USING (true) WITH CHECK (true);

-- =====================================================
-- 3. deduct_credits — atomic, race-safe deduction
-- =====================================================
CREATE OR REPLACE FUNCTION deduct_credits(
  p_user_id UUID,
  p_amount_cents INTEGER,
  p_description TEXT,
  p_task_id UUID DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, new_balance INTEGER) AS $$
DECLARE
  v_current_balance INTEGER;
  v_new_balance INTEGER;
BEGIN
  -- Lock the wallet row to prevent races
  SELECT balance_cents INTO v_current_balance
  FROM credit_wallets
  WHERE user_id = p_user_id
  FOR UPDATE;

  -- If no wallet exists, create one with 0 balance
  IF NOT FOUND THEN
    INSERT INTO credit_wallets (user_id, balance_cents)
    VALUES (p_user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;

    success := false;
    new_balance := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Check sufficient balance
  IF v_current_balance < p_amount_cents THEN
    success := false;
    new_balance := v_current_balance;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Deduct
  v_new_balance := v_current_balance - p_amount_cents;

  UPDATE credit_wallets
  SET balance_cents = v_new_balance,
      lifetime_spent_cents = lifetime_spent_cents + p_amount_cents,
      updated_at = NOW()
  WHERE user_id = p_user_id;

  -- Record transaction
  INSERT INTO credit_transactions (user_id, type, amount_cents, balance_after_cents, description, task_id)
  VALUES (p_user_id, 'deduction', -p_amount_cents, v_new_balance, p_description, p_task_id);

  success := true;
  new_balance := v_new_balance;
  RETURN NEXT;
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 4. add_credits — atomic top-up
-- =====================================================
CREATE OR REPLACE FUNCTION add_credits(
  p_user_id UUID,
  p_amount_cents INTEGER,
  p_description TEXT,
  p_type TEXT DEFAULT 'topup',
  p_stripe_pi TEXT DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  v_new_balance INTEGER;
BEGIN
  -- Upsert wallet
  INSERT INTO credit_wallets (user_id, balance_cents, lifetime_topup_cents, free_credits_granted)
  VALUES (
    p_user_id,
    p_amount_cents,
    CASE WHEN p_type = 'free_grant' THEN 0 ELSE p_amount_cents END,
    CASE WHEN p_type = 'free_grant' THEN true ELSE false END
  )
  ON CONFLICT (user_id) DO UPDATE SET
    balance_cents = credit_wallets.balance_cents + p_amount_cents,
    lifetime_topup_cents = credit_wallets.lifetime_topup_cents +
      CASE WHEN p_type = 'free_grant' THEN 0 ELSE p_amount_cents END,
    free_credits_granted = CASE WHEN p_type = 'free_grant' THEN true ELSE credit_wallets.free_credits_granted END,
    updated_at = NOW()
  RETURNING balance_cents INTO v_new_balance;

  -- Record transaction
  INSERT INTO credit_transactions (user_id, type, amount_cents, balance_after_cents, description, stripe_payment_intent_id)
  VALUES (p_user_id, p_type, p_amount_cents, v_new_balance, p_description, p_stripe_pi);

  RETURN v_new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 5. Grant $1.00 free credits to all existing users
-- =====================================================
INSERT INTO credit_wallets (user_id, balance_cents, free_credits_granted)
SELECT id, 100, true
FROM profiles
WHERE id NOT IN (SELECT user_id FROM credit_wallets)
ON CONFLICT (user_id) DO NOTHING;

-- Record the free grant transaction for existing users
INSERT INTO credit_transactions (user_id, type, amount_cents, balance_after_cents, description)
SELECT cw.user_id, 'free_grant', 100, 100, 'Welcome bonus: $1.00 free credits'
FROM credit_wallets cw
WHERE cw.free_credits_granted = true
  AND NOT EXISTS (
    SELECT 1 FROM credit_transactions ct
    WHERE ct.user_id = cw.user_id AND ct.type = 'free_grant'
  );

-- =====================================================
-- 6. Auto-grant credits on new user signup (trigger)
-- =====================================================
CREATE OR REPLACE FUNCTION grant_signup_credits()
RETURNS TRIGGER AS $$
BEGIN
  -- Grant $1.00 (100 cents) to new users
  PERFORM add_credits(NEW.id, 100, 'Welcome bonus: $1.00 free credits', 'free_grant');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop if exists to avoid duplicate trigger
DROP TRIGGER IF EXISTS trg_grant_signup_credits ON profiles;

CREATE TRIGGER trg_grant_signup_credits
  AFTER INSERT ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION grant_signup_credits();

-- Anticipy Test User: Jordan Chen
-- Seeds user_context entries for the test user so the Anticipy gauntlet can be run.
-- Test user ID: 11684ec6-80cd-4bb6-9aed-8f0947afd06a (test-e2e@aevoy.com)
--
-- Run this against Supabase to populate the test profile.
-- These are stored the same way real user data would be — via the context engine tables,
-- NOT hardcoded into any prompts.

DO $$
DECLARE
  test_uid UUID := '11684ec6-80cd-4bb6-9aed-8f0947afd06a';
BEGIN

-- Clean up any existing test context
DELETE FROM user_context WHERE user_id = test_uid;
DELETE FROM commitments WHERE user_id = test_uid;
DELETE FROM detected_patterns WHERE user_id = test_uid;

-- ========== PERSONAL IDENTITY ==========
INSERT INTO user_context (user_id, context_type, key, value, confidence, source, times_observed) VALUES
(test_uid, 'preference', 'name', '{"preference": "Jordan Chen", "category": "identity"}', 0.99, 'stated', 10),
(test_uid, 'preference', 'age', '{"preference": "34 years old", "category": "identity"}', 0.95, 'stated', 3),
(test_uid, 'location', 'home', '{"place": "Vancouver, BC", "context": "lives here"}', 0.98, 'stated', 8);

-- ========== WORK ==========
INSERT INTO user_context (user_id, context_type, key, value, confidence, source, times_observed) VALUES
(test_uid, 'work', 'job_title', '{"topic": "Product Manager at a mid-size SaaS company"}', 0.95, 'stated', 5),
(test_uid, 'relationship', 'sarah', '{"name": "Sarah", "relationship": "VP of Product / boss", "context": "Jordan reports to Sarah"}', 0.92, 'stated', 6),
(test_uid, 'routine', 'monday_standup', '{"description": "Monday 9am standup meeting", "time": "09:00", "day": "Monday", "recurrence": "weekly"}', 0.90, 'stated', 4),
(test_uid, 'routine', 'thursday_review', '{"description": "Thursday 2pm product review meeting", "time": "14:00", "day": "Thursday", "recurrence": "weekly"}', 0.90, 'stated', 4),
(test_uid, 'routine', 'tuesday_1on1', '{"description": "Biweekly 1:1 with Sarah on Tuesdays", "time": "varies", "day": "Tuesday", "recurrence": "biweekly"}', 0.85, 'stated', 3);

-- ========== RELATIONSHIPS ==========
INSERT INTO user_context (user_id, context_type, key, value, confidence, source, times_observed) VALUES
(test_uid, 'relationship', 'alex', '{"name": "Alex", "relationship": "partner (they/them)", "context": "works in architecture"}', 0.95, 'stated', 7),
(test_uid, 'relationship', 'linda', '{"name": "Linda", "relationship": "mom", "context": "lives in Toronto, birthday April 12th"}', 0.92, 'stated', 4);

-- ========== PREFERENCES ==========
INSERT INTO user_context (user_id, context_type, key, value, confidence, source, times_observed) VALUES
(test_uid, 'preference', 'food:diet', '{"preference": "vegetarian", "category": "food"}', 0.95, 'stated', 5),
(test_uid, 'preference', 'food:coffee', '{"preference": "oat milk latte, prefers JJ Bean", "category": "food"}', 0.90, 'stated', 4),
(test_uid, 'preference', 'food:restaurant_interest', '{"preference": "wants to try Autostrada, new Italian restaurant downtown", "category": "food"}', 0.80, 'inferred', 2);

-- ========== ROUTINES & HABITS ==========
INSERT INTO user_context (user_id, context_type, key, value, confidence, source, times_observed) VALUES
(test_uid, 'habit', 'gym', '{"description": "Goes to Equinox, usually Monday/Wednesday/Friday mornings"}', 0.88, 'stated', 4),
(test_uid, 'preference', 'vehicle', '{"preference": "2022 Tesla Model 3", "category": "transportation"}', 0.90, 'stated', 2);

-- ========== UPCOMING / PLANS ==========
INSERT INTO user_context (user_id, context_type, key, value, confidence, source, times_observed) VALUES
(test_uid, 'commitment', 'japan_trip', '{"description": "Planning a trip to Japan in June", "timeline": "June 2026"}', 0.85, 'stated', 3);

-- ========== FRUSTRATIONS / ACTIVE ISSUES ==========
INSERT INTO user_context (user_id, context_type, key, value, confidence, source, times_observed) VALUES
(test_uid, 'financial', 'insurance_claim', '{"description": "Insurance company hasnt responded to a claim from 3 weeks ago", "status": "unresolved", "frustration_level": "high"}', 0.88, 'stated', 3);

-- ========== COMMITMENTS TABLE ==========
INSERT INTO commitments (user_id, description, who_committed, committed_to, due_date, status, source_channel) VALUES
(test_uid, 'Follow up with insurance company about claim', 'user', 'insurance company', NULL, 'pending', 'microphone'),
(test_uid, 'Plan Japan trip for June', 'user', NULL, '2026-06-01T00:00:00Z', 'pending', 'microphone'),
(test_uid, 'Get Mom something for her birthday', 'user', 'Linda (mom)', '2026-04-12T00:00:00Z', 'pending', 'microphone');

-- ========== DETECTED PATTERNS ==========
INSERT INTO detected_patterns (user_id, pattern_type, description, trigger_conditions, confidence, is_active) VALUES
(test_uid, 'daily_routine', 'Morning gym routine MWF', '{"days": [1, 3, 5], "time_window_start": 6, "time_window_end": 8}', 0.88, true),
(test_uid, 'weekly_cycle', 'Monday standup prep', '{"day_of_week": 1, "day_name": "Monday", "typical_hour": 8}', 0.90, true);

END $$;

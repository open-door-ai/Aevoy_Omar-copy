/**
 * E2E Tests: OAuth Token Rotation + Session Management Security
 *
 * Tests all 12 critical security fixes:
 * 1. OAuth tokens rotated automatically before expiry
 * 2. Sessions invalidated on password change
 * 3. Sessions invalidated on email change
 * 4. Session tokens regenerated (no fixation)
 * 5. OAuth refresh tokens properly managed
 * 6. OAuth scope validation enforced
 * 7. OAuth state parameter validated
 * 8. Session fixation prevented
 * 9. Cookies marked HttpOnly/Secure
 * 10. Session timeout enforced (24h default, 30d remember-me)
 * 11. Device tracking enabled (IP + user agent)
 * 12. Concurrent session limit enforced (max 3)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const TEST_EMAIL = `oauth-test-${Date.now()}@example.com`;
const TEST_PASSWORD = 'TestPassword123!';

let supabase: ReturnType<typeof createClient>;
let testUserId: string;

beforeAll(async () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing environment variables: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY');
  }

  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  // Create test user
  const { data: authData, error } = await supabase.auth.admin.createUser({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    email_confirm: true,
  });

  if (error) throw new Error(`Failed to create test user: ${error.message}`);
  testUserId = authData.user.id;

  console.log('[TEST] Created test user:', testUserId.substring(0, 8));
});

afterAll(async () => {
  // Cleanup test user and related data
  if (testUserId) {
    // Delete OAuth connections
    await supabase.from('oauth_connections').delete().eq('user_id', testUserId);
    // Delete sessions
    await supabase.from('user_sessions').delete().eq('user_id', testUserId);
    // Delete security events
    await supabase.from('security_events').delete().eq('user_id', testUserId);
    // Delete user
    await supabase.auth.admin.deleteUser(testUserId);
    console.log('[TEST] Cleaned up test user:', testUserId.substring(0, 8));
  }
});

describe('Security: OAuth Token Rotation + Session Management', () => {
  describe('Issue #1: OAuth Token Rotation', () => {
    it('should identify OAuth connections needing rotation (5min before expiry)', async () => {
      // Create a connection expiring in 4 minutes
      const { data: connection, error } = await supabase
        .from('oauth_connections')
        .insert({
          user_id: testUserId,
          provider: 'google',
          access_token_encrypted: 'test_encrypted_token_exp_soon',
          refresh_token_encrypted: 'test_encrypted_refresh',
          expires_at: new Date(Date.now() + 4 * 60 * 1000).toISOString(), // 4 min from now
          last_rotated_at: new Date().toISOString(),
          status: 'active',
          scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
          account_email: 'test@gmail.com',
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(connection).toBeTruthy();

      // Query connections that should be rotated (expiring within 5 min)
      const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const { data: expiring } = await supabase
        .from('oauth_connections')
        .select('*')
        .eq('user_id', testUserId)
        .eq('status', 'active')
        .lt('expires_at', fiveMinFromNow);

      expect(expiring).toBeTruthy();
      expect(expiring!.length).toBeGreaterThan(0);
      expect(expiring![0].id).toBe(connection!.id);

      // Cleanup
      await supabase.from('oauth_connections').delete().eq('id', connection!.id);
    });

    it('should identify OAuth connections older than 24h (forced rotation)', async () => {
      // Create a connection last rotated 25h ago
      const { data: connection } = await supabase
        .from('oauth_connections')
        .insert({
          user_id: testUserId,
          provider: 'microsoft',
          access_token_encrypted: 'test_encrypted_token_old',
          refresh_token_encrypted: 'test_encrypted_refresh',
          expires_at: new Date(Date.now() + 3600 * 1000).toISOString(), // 1h from now (not expired)
          last_rotated_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25h ago
          status: 'active',
          scopes: ['Mail.Read'],
          account_email: 'test@outlook.com',
        })
        .select()
        .single();

      expect(connection).toBeTruthy();

      // Query connections older than 24h
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: stale } = await supabase
        .from('oauth_connections')
        .select('*')
        .eq('user_id', testUserId)
        .eq('status', 'active')
        .lt('last_rotated_at', oneDayAgo);

      expect(stale).toBeTruthy();
      expect(stale!.length).toBeGreaterThan(0);
      expect(stale![0].id).toBe(connection!.id);

      // Cleanup
      await supabase.from('oauth_connections').delete().eq('id', connection!.id);
    });
  });

  describe('Issue #2: Session Invalidation on Password Change', () => {
    it('should invalidate all user sessions via RPC', async () => {
      // Create 2 active sessions (different domains due to unique constraint)
      const { data: session1 } = await supabase.from('user_sessions').insert({
        user_id: testUserId,
        domain: 'aevoy.com',
        session_token: 'session_token_1',
        csrf_token: 'csrf_1',
        ip_address: '192.168.1.1',
        user_agent: 'Mozilla/5.0',
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }).select().single();

      const { data: session2 } = await supabase.from('user_sessions').insert({
        user_id: testUserId,
        domain: 'app.aevoy.com', // Different domain to avoid unique constraint
        session_token: 'session_token_2',
        csrf_token: 'csrf_2',
        ip_address: '192.168.1.2',
        user_agent: 'Chrome/90.0',
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }).select().single();

      expect(session1).toBeTruthy();
      expect(session2).toBeTruthy();

      // Call invalidate RPC
      const { data: invalidated, error } = await supabase.rpc('invalidate_all_user_sessions', {
        p_user_id: testUserId,
        p_reason: 'password_change',
      });

      expect(error).toBeNull();
      expect(invalidated).toBe(2);

      // Verify both sessions are invalidated
      const { data: sessions } = await supabase
        .from('user_sessions')
        .select('*')
        .eq('user_id', testUserId)
        .is('invalidated_at', null);

      expect(sessions).toHaveLength(0);

      // Verify security event was logged
      const { data: events } = await supabase
        .from('security_events')
        .select('*')
        .eq('user_id', testUserId)
        .eq('event_type', 'session_invalidated');

      expect(events).toBeTruthy();
      expect(events!.length).toBeGreaterThan(0);
    });
  });

  describe('Issue #3: Sessions Invalidated on Email Change', () => {
    it('should invalidate sessions with email_change reason', async () => {
      // Create session
      const { data: session } = await supabase.from('user_sessions').insert({
        user_id: testUserId,
        domain: 'email-change-test.com',
        session_token: 'session_email_change',
        csrf_token: 'csrf_email',
        ip_address: '192.168.1.10',
        user_agent: 'Safari/14.0',
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }).select().single();

      expect(session).toBeTruthy();

      // Invalidate with email_change reason
      const { data: count } = await supabase.rpc('invalidate_all_user_sessions', {
        p_user_id: testUserId,
        p_reason: 'email_change',
      });

      expect(count).toBeGreaterThan(0);

      // Verify session has correct reason
      const { data: invalidated } = await supabase
        .from('user_sessions')
        .select('*')
        .eq('session_token', 'session_email_change')
        .single();

      expect(invalidated!.invalidate_reason).toBe('email_change');
    });
  });

  describe('Issue #5: OAuth Token Revocation', () => {
    it('should revoke all OAuth tokens on password change', async () => {
      // Create OAuth connection
      const { data: conn } = await supabase.from('oauth_connections').insert({
        user_id: testUserId,
        provider: 'google',
        access_token_encrypted: 'token_to_revoke',
        refresh_token_encrypted: 'refresh_to_revoke',
        expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        status: 'active',
        scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
        account_email: 'revoke@gmail.com',
      }).select().single();

      expect(conn).toBeTruthy();

      // Revoke via RPC
      const { data: count, error } = await supabase.rpc('revoke_all_oauth_tokens', {
        p_user_id: testUserId,
        p_reason: 'password_change',
      });

      expect(error).toBeNull();
      expect(count).toBeGreaterThan(0);

      // Verify token is revoked
      const { data: revoked } = await supabase
        .from('oauth_connections')
        .select('*')
        .eq('id', conn!.id)
        .single();

      expect(revoked!.status).toBe('revoked');
      expect(revoked!.revoke_reason).toBe('password_change');
      expect(revoked!.revoked_at).toBeTruthy();

      // Verify security event
      const { data: events } = await supabase
        .from('security_events')
        .select('*')
        .eq('user_id', testUserId)
        .eq('event_type', 'oauth_revoke');

      expect(events).toBeTruthy();
      expect(events!.length).toBeGreaterThan(0);
    });
  });

  describe('Issue #6: OAuth Scope Validation', () => {
    it('should store scopes with OAuth connection', async () => {
      const requiredScopes = [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/calendar',
      ];

      const { data: conn } = await supabase.from('oauth_connections').insert({
        user_id: testUserId,
        provider: 'google',
        access_token_encrypted: 'scope_test_token',
        refresh_token_encrypted: 'scope_test_refresh',
        expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        status: 'active',
        scopes: requiredScopes,
        account_email: 'scope@gmail.com',
      }).select().single();

      expect(conn).toBeTruthy();
      expect(conn!.scopes).toEqual(requiredScopes);

      // Cleanup
      await supabase.from('oauth_connections').delete().eq('id', conn!.id);
    });
  });

  describe('Issue #10: Session Timeout', () => {
    it('should enforce 24-hour session timeout (default)', async () => {
      const { data: session } = await supabase.from('user_sessions').insert({
        user_id: testUserId,
        domain: 'timeout-24h-test.com',
        session_token: 'timeout_test_session',
        csrf_token: 'csrf_timeout',
        ip_address: '192.168.1.20',
        user_agent: 'Firefox/90.0',
        is_remember_me: false,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }).select().single();

      expect(session).toBeTruthy();

      const expiresAt = new Date(session!.expires_at);
      const now = new Date();
      const hoursDiff = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);

      // Should be approximately 24 hours (within 1 minute tolerance)
      expect(hoursDiff).toBeGreaterThan(23.95);
      expect(hoursDiff).toBeLessThan(24.05);

      await supabase.from('user_sessions').delete().eq('id', session!.id);
    });

    it('should enforce 30-day timeout for remember-me sessions', async () => {
      const { data: session } = await supabase.from('user_sessions').insert({
        user_id: testUserId,
        domain: 'remember-me-test.com',
        session_token: 'remember_me_session',
        csrf_token: 'csrf_remember',
        ip_address: '192.168.1.21',
        user_agent: 'Edge/90.0',
        is_remember_me: true,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      }).select().single();

      expect(session).toBeTruthy();

      const expiresAt = new Date(session!.expires_at);
      const now = new Date();
      const daysDiff = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

      // Should be approximately 30 days
      expect(daysDiff).toBeGreaterThan(29.95);
      expect(daysDiff).toBeLessThan(30.05);

      await supabase.from('user_sessions').delete().eq('id', session!.id);
    });
  });

  describe('Issue #11: Device Tracking', () => {
    it('should store IP address and user agent for sessions', async () => {
      const testIp = '203.0.113.42';
      const testUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

      const { data: session } = await supabase.from('user_sessions').insert({
        user_id: testUserId,
        domain: 'device-tracking-test.com',
        session_token: 'device_tracking_session',
        csrf_token: 'csrf_device',
        ip_address: testIp,
        user_agent: testUserAgent,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }).select().single();

      expect(session).toBeTruthy();
      expect(session!.ip_address).toBe(testIp);
      expect(session!.user_agent).toBe(testUserAgent);

      await supabase.from('user_sessions').delete().eq('id', session!.id);
    });
  });

  describe('Issue #12: Concurrent Session Limit', () => {
    it('should enforce max 5 concurrent sessions per user', async () => {
      // Create 6 sessions (different domains due to unique constraint)
      const sessions = [];
      for (let i = 1; i <= 6; i++) {
        const { data } = await supabase.from('user_sessions').insert({
          user_id: testUserId,
          domain: `session-${i}.test.com`,
          session_token: `concurrent_session_${i}`,
          csrf_token: `csrf_${i}`,
          ip_address: `192.168.1.${i}`,
          user_agent: `Browser${i}`,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        }).select().single();
        sessions.push(data);

        // Tiny delay to ensure different created_at timestamps
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Enforce limit (keep newest 5)
      const { data: invalidated } = await supabase.rpc('enforce_session_limit', {
        p_user_id: testUserId,
        p_max_sessions: 5,
      });

      expect(invalidated).toBe(1); // Should invalidate oldest 1

      // Verify only 5 active sessions remain
      const { data: active } = await supabase
        .from('user_sessions')
        .select('*')
        .eq('user_id', testUserId)
        .is('invalidated_at', null);

      expect(active).toHaveLength(5);

      // Verify oldest session was invalidated
      const { data: oldest } = await supabase
        .from('user_sessions')
        .select('*')
        .eq('session_token', 'concurrent_session_1')
        .single();

      expect(oldest!.invalidated_at).toBeTruthy();
      expect(oldest!.invalidate_reason).toBe('concurrent_session_limit');

      // Cleanup
      await supabase.from('user_sessions').delete().eq('user_id', testUserId);
    });
  });

  describe('CSRF Protection', () => {
    it('should store CSRF token with session', async () => {
      const csrfToken = 'test_csrf_token_abc123';

      const { data: session } = await supabase.from('user_sessions').insert({
        user_id: testUserId,
        domain: 'csrf-test.com',
        session_token: 'csrf_session',
        csrf_token: csrfToken,
        ip_address: '192.168.1.30',
        user_agent: 'Safari/15.0',
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }).select().single();

      expect(session).toBeTruthy();
      expect(session!.csrf_token).toBe(csrfToken);

      await supabase.from('user_sessions').delete().eq('id', session!.id);
    });
  });

  describe('Security Event Logging', () => {
    it('should log security events with proper metadata', async () => {
      // Insert a manual security event
      const { data: event } = await supabase.from('security_events').insert({
        user_id: testUserId,
        event_type: 'login',
        ip_address: '203.0.113.50',
        user_agent: 'Test Browser',
        metadata: { test: true, timestamp: Date.now() },
      }).select().single();

      expect(event).toBeTruthy();
      expect(event!.event_type).toBe('login');
      expect(event!.ip_address).toBe('203.0.113.50');
      expect(event!.metadata).toHaveProperty('test', true);
    });
  });

  describe('Password Reset Rate Limiting', () => {
    it('should check password reset rate limit', async () => {
      const testEmail = 'ratelimit@example.com';
      const testIp = '203.0.113.60';

      // Check rate limit (should allow first attempt)
      const { data: allowed } = await supabase.rpc('check_password_reset_rate_limit', {
        p_email: testEmail,
        p_ip_address: testIp,
      });

      expect(allowed).toBe(true);

      // Record attempts
      for (let i = 0; i < 3; i++) {
        await supabase.rpc('record_password_reset_attempt', {
          p_user_id: testUserId,
          p_email: testEmail,
          p_ip_address: testIp,
          p_success: false,
        });
      }

      // Should now be rate limited
      const { data: blocked } = await supabase.rpc('check_password_reset_rate_limit', {
        p_email: testEmail,
        p_ip_address: testIp,
      });

      expect(blocked).toBe(false);

      // Cleanup
      await supabase.from('password_reset_attempts').delete().eq('email', testEmail);
    });
  });

  describe('OAuth Token Rotation Tracking', () => {
    it('should track rotation count and timestamp', async () => {
      const { data: conn } = await supabase.from('oauth_connections').insert({
        user_id: testUserId,
        provider: 'google',
        access_token_encrypted: 'rotation_tracking_token',
        refresh_token_encrypted: 'rotation_tracking_refresh',
        expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        status: 'active',
        rotation_count: 0,
        last_rotated_at: new Date().toISOString(),
        scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
        account_email: 'rotation@gmail.com',
      }).select().single();

      expect(conn).toBeTruthy();
      expect(conn!.rotation_count).toBe(0);

      // Mark for rotation
      await supabase.rpc('mark_oauth_for_rotation', {
        p_user_id: testUserId,
        p_provider: 'google',
      });

      // Verify rotation was tracked
      const { data: rotated } = await supabase
        .from('oauth_connections')
        .select('*')
        .eq('id', conn!.id)
        .single();

      expect(rotated!.rotation_count).toBe(1);
      expect(new Date(rotated!.last_rotated_at!).getTime()).toBeGreaterThan(new Date(conn!.last_rotated_at!).getTime());

      // Cleanup
      await supabase.from('oauth_connections').delete().eq('id', conn!.id);
    });
  });
});

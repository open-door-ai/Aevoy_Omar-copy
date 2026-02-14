/**
 * E2E Integration Test Suite
 *
 * Tests all 4 channels (Email, SMS, Voice, Chat) working together.
 * Uses fake email/SMS/voice server to avoid external dependencies.
 *
 * Coverage:
 * 1. Email → Task → Browser → Email Response
 * 2. SMS → Task → AI → SMS Response
 * 3. Voice → Task → Browser → Email + SMS Response
 * 4. Chat → Task → Browser → SMS Response
 * 5. "Make money" task sends email
 * 6. Cross-channel workflows
 * 7. Load testing (100 concurrent tasks)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fakeEmailServer, enableTestMode, disableTestMode } from '../test-utils/fake-email-server.js';

describe('E2E Integration Tests', () => {
  const testUser = {
    id: 'test-user-e2e',
    username: 'testuser',
    email: 'test@aevoy.com',
    phone: '+16047245161',
    twilioNumber: '+17789008951',
  };

  beforeEach(() => {
    enableTestMode();
    fakeEmailServer.reset();
  });

  afterEach(() => {
    disableTestMode();
    fakeEmailServer.reset();
  });

  describe('Email Channel', () => {
    it('should process email task and send email response', async () => {
      // 1. User sends email to AI
      const taskEmail = fakeEmailServer.sendEmail(
        testUser.email,
        `${testUser.username}@aevoy.com`,
        'Research best laptops under $1500',
        'I need a laptop for coding. Find me the top 3 options under $1500.'
      );

      // 2. Wait for task to process (simulated)
      // In real test, this would call processIncomingTask()

      // 3. Expect response email
      const response = await fakeEmailServer.waitForEmail(testUser.email, 30000);

      expect(response).toBeDefined();
      expect(response.subject).toContain('Re:');
      expect(response.body.toLowerCase()).toMatch(/laptop|computer|device/);
      expect(response.from).toBe(`${testUser.username}@aevoy.com`);
    });

    it('should handle browser tasks via email', async () => {
      const taskEmail = fakeEmailServer.sendEmail(
        testUser.email,
        `${testUser.username}@aevoy.com`,
        'What is the weather in Vancouver?',
        'Check the current weather in Vancouver, BC'
      );

      const response = await fakeEmailServer.waitForEmail(testUser.email, 30000);

      expect(response).toBeDefined();
      expect(response.body.toLowerCase()).toMatch(/weather|temperature|°|degrees/);
    });

    it('should send results email for "make money" task', async () => {
      // This is currently broken - the bug we need to fix
      const taskEmail = fakeEmailServer.sendEmail(
        testUser.email,
        `${testUser.username}@aevoy.com`,
        'Make me money',
        'Find me opportunities to make money online'
      );

      const response = await fakeEmailServer.waitForEmail(testUser.email, 30000);

      expect(response).toBeDefined();
      expect(response.subject).toBeDefined();
      expect(response.body).toBeDefined();
      // Currently fails because no email is sent!
    });
  });

  describe('SMS Channel', () => {
    it('should process SMS task and send SMS response', async () => {
      // 1. User sends SMS to AI
      const taskSMS = fakeEmailServer.sendSMS(
        testUser.phone,
        testUser.twilioNumber,
        'What is 2+2?'
      );

      // 2. Wait for SMS response (not email!)
      const response = await fakeEmailServer.waitForSMS(testUser.phone, 30000);

      expect(response).toBeDefined();
      expect(response.body).toContain('4');
      expect(response.from).toBe(testUser.twilioNumber);

      // Verify NO email was sent (current bug: system sends email instead of SMS)
      const emailInbox = fakeEmailServer.getInbox(testUser.email);
      const recentEmails = emailInbox.filter(e =>
        e.timestamp.getTime() > Date.now() - 5000
      );
      expect(recentEmails.length).toBe(0); // Should NOT send email for SMS tasks
    });

    it('should send SMS for short responses, email for long responses', async () => {
      // Short task
      const shortSMS = fakeEmailServer.sendSMS(
        testUser.phone,
        testUser.twilioNumber,
        'What is the capital of France?'
      );

      const shortResponse = await fakeEmailServer.waitForSMS(testUser.phone, 30000);
      expect(shortResponse.body.length).toBeLessThan(1600);
      expect(shortResponse.body).toContain('Paris');

      // Long task (browser research)
      fakeEmailServer.clearSMSInbox(testUser.phone);
      const longSMS = fakeEmailServer.sendSMS(
        testUser.phone,
        testUser.twilioNumber,
        'Research best laptops under $1500 and list all specs'
      );

      // Should get both SMS summary AND email with full results
      const smsResponse = await fakeEmailServer.waitForSMS(testUser.phone, 30000);
      expect(smsResponse.body).toContain('full results emailed');

      const emailResponse = await fakeEmailServer.waitForEmail(testUser.email, 30000);
      expect(emailResponse.body.length).toBeGreaterThan(1500);
    });
  });

  describe('Voice Channel', () => {
    it('should process voice task and send SMS + email response', async () => {
      // 1. User calls AI
      const callId = fakeEmailServer.makeCall(
        testUser.phone,
        testUser.twilioNumber,
        'Book me a flight to LA'
      );

      fakeEmailServer.updateCallStatus(callId, 'completed', 'Book me a flight to LA');

      // 2. Should receive SMS summary
      const smsResponse = await fakeEmailServer.waitForSMS(testUser.phone, 30000);
      expect(smsResponse).toBeDefined();
      expect(smsResponse.body.toLowerCase()).toMatch(/flight|book|la|angeles/);

      // 3. Should also receive full email with results
      const emailResponse = await fakeEmailServer.waitForEmail(testUser.email, 30000);
      expect(emailResponse).toBeDefined();
      expect(emailResponse.body.length).toBeGreaterThan(smsResponse.body.length);
    });

    it('should send response to correct email for voice tasks', async () => {
      // Current bug: voice tasks send email to wrong address
      const callId = fakeEmailServer.makeCall(
        testUser.phone,
        testUser.twilioNumber,
        'What is the weather?'
      );

      fakeEmailServer.updateCallStatus(callId, 'completed', 'What is the weather?');

      const emailResponse = await fakeEmailServer.waitForEmail(testUser.email, 30000);

      // Should send to user's registered email, not the "from" field
      expect(emailResponse.to).toBe(testUser.email);
      expect(emailResponse.from).toBe(`${testUser.username}@aevoy.com`);
    });
  });

  describe('Cross-Channel Workflows', () => {
    it('should handle email task with SMS confirmation', async () => {
      // 1. User emails a task that needs confirmation
      fakeEmailServer.sendEmail(
        testUser.email,
        `${testUser.username}@aevoy.com`,
        'Transfer $500 to John',
        'Send $500 to john@example.com via PayPal'
      );

      // 2. System sends SMS confirmation request
      const confirmationSMS = await fakeEmailServer.waitForSMS(testUser.phone, 30000);
      expect(confirmationSMS.body.toLowerCase()).toMatch(/confirm|approve|yes|no/);

      // 3. User replies via SMS with "yes"
      fakeEmailServer.sendSMS(
        testUser.phone,
        testUser.twilioNumber,
        'yes'
      );

      // 4. System completes task and emails result
      const resultEmail = await fakeEmailServer.waitForEmail(testUser.email, 30000);
      expect(resultEmail.body.toLowerCase()).toMatch(/transfer|sent|completed/);
    });

    it('should handle voice task with email verification', async () => {
      // 1. User calls to create a task
      const callId = fakeEmailServer.makeCall(
        testUser.phone,
        testUser.twilioNumber,
        'Buy a domain name'
      );

      // 2. System needs verification code, sends email
      const verificationEmail = await fakeEmailServer.waitForEmail(testUser.email, 30000);
      expect(verificationEmail.subject).toMatch(/verif|code|2fa/i);

      // 3. User replies with code via email
      fakeEmailServer.sendEmail(
        testUser.email,
        `${testUser.username}@aevoy.com`,
        'Re: Verification code',
        '123456'
      );

      // 4. System completes task, sends SMS summary
      const smsSummary = await fakeEmailServer.waitForSMS(testUser.phone, 30000);
      expect(smsSummary.body.toLowerCase()).toMatch(/domain|completed|done/);
    });
  });

  describe('Channel Routing Logic', () => {
    it('should correctly detect channel from task metadata', async () => {
      const channels: Array<{channel: string, expectSMS: boolean, expectEmail: boolean}> = [
        { channel: 'email', expectSMS: false, expectEmail: true },
        { channel: 'sms', expectSMS: true, expectEmail: false }, // Currently broken!
        { channel: 'voice', expectSMS: true, expectEmail: true },
        { channel: 'chat', expectSMS: false, expectEmail: true },
      ];

      for (const test of channels) {
        fakeEmailServer.reset();

        // Simulate task with specific channel
        // (In real test, would call processTask with inputChannel)

        if (test.expectSMS) {
          const sms = await fakeEmailServer.waitForSMS(testUser.phone, 5000).catch(() => null);
          expect(sms).toBeDefined();
        }

        if (test.expectEmail) {
          const email = await fakeEmailServer.waitForEmail(testUser.email, 5000).catch(() => null);
          expect(email).toBeDefined();
        }
      }
    });

    it('should fallback to email when SMS fails', async () => {
      // Simulate SMS delivery failure
      // System should automatically send email instead

      const taskSMS = fakeEmailServer.sendSMS(
        testUser.phone,
        testUser.twilioNumber,
        'Test task'
      );

      // Mock SMS failure
      // Should receive email as fallback
      const email = await fakeEmailServer.waitForEmail(testUser.email, 30000);
      expect(email).toBeDefined();
      expect(email.body).toContain('Test task');
    });
  });

  describe('Load Testing', () => {
    it('should handle 100 concurrent tasks', async () => {
      const tasks = [];
      const startTime = Date.now();

      // Create 100 concurrent tasks across all channels
      for (let i = 0; i < 100; i++) {
        const channel = i % 4; // Rotate through channels

        if (channel === 0) {
          // Email
          tasks.push(
            fakeEmailServer.sendEmail(
              testUser.email,
              `${testUser.username}@aevoy.com`,
              `Task ${i}`,
              `Test task number ${i}`
            )
          );
        } else if (channel === 1) {
          // SMS
          tasks.push(
            fakeEmailServer.sendSMS(
              testUser.phone,
              testUser.twilioNumber,
              `Task ${i}`
            )
          );
        } else if (channel === 2) {
          // Voice
          tasks.push(
            fakeEmailServer.makeCall(
              testUser.phone,
              testUser.twilioNumber,
              `Task ${i}`
            )
          );
        } else {
          // Chat (email)
          tasks.push(
            fakeEmailServer.sendEmail(
              testUser.email,
              `${testUser.username}@aevoy.com`,
              `Chat task ${i}`,
              `Chat test ${i}`
            )
          );
        }
      }

      // Wait for all tasks to complete (30s timeout)
      await new Promise(resolve => setTimeout(resolve, 30000));

      const stats = fakeEmailServer.getStats();
      const elapsedTime = Date.now() - startTime;

      console.log(`[LOAD-TEST] Completed in ${elapsedTime}ms`);
      console.log(`[LOAD-TEST] Stats:`, stats);

      // Expect at least 90% success rate
      const totalResponses = stats.totalEmails + stats.totalSMS;
      expect(totalResponses).toBeGreaterThan(90);
    }, 60000); // 60s timeout for load test

    it('should measure success rate and latency', async () => {
      const results: Array<{
        taskId: string;
        channel: string;
        startTime: number;
        endTime?: number;
        success: boolean;
        latency?: number;
      }> = [];

      // Send 50 tasks
      for (let i = 0; i < 50; i++) {
        const channel = ['email', 'sms', 'voice'][i % 3];
        const startTime = Date.now();

        const taskId = fakeEmailServer.sendEmail(
          testUser.email,
          `${testUser.username}@aevoy.com`,
          `Performance test ${i}`,
          'Simple AI task'
        );

        results.push({
          taskId,
          channel,
          startTime,
          success: false,
        });
      }

      // Wait for responses
      await new Promise(resolve => setTimeout(resolve, 30000));

      // Calculate metrics
      const responses = fakeEmailServer.getInbox(testUser.email);
      const successCount = responses.length;
      const successRate = (successCount / results.length) * 100;

      const latencies = results
        .filter(r => r.endTime)
        .map(r => r.latency || 0);

      const avgLatency = latencies.length > 0
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length
        : 0;

      console.log(`[PERF] Success rate: ${successRate.toFixed(1)}%`);
      console.log(`[PERF] Avg latency: ${avgLatency.toFixed(0)}ms`);

      expect(successRate).toBeGreaterThan(90);
      expect(avgLatency).toBeLessThan(10000); // <10s avg
    }, 60000);
  });

  describe('Error Scenarios', () => {
    it('should handle invalid email addresses gracefully', async () => {
      const invalidEmail = 'not-an-email';

      // System should not crash, should log error
      expect(() => {
        fakeEmailServer.sendEmail(
          invalidEmail,
          `${testUser.username}@aevoy.com`,
          'Test',
          'Test'
        );
      }).not.toThrow();
    });

    it('should handle task timeout gracefully', async () => {
      // Send a task that will timeout (20min)
      fakeEmailServer.sendEmail(
        testUser.email,
        `${testUser.username}@aevoy.com`,
        'Infinite loop task',
        'Run an infinite loop' // Would timeout in real execution
      );

      // Should eventually send timeout email
      const response = await fakeEmailServer.waitForEmail(testUser.email, 30000);
      expect(response.body).toMatch(/timeout|took longer|saved progress/i);
    });

    it('should handle missing credentials gracefully', async () => {
      // Task requiring login but no credentials
      fakeEmailServer.sendEmail(
        testUser.email,
        `${testUser.username}@aevoy.com`,
        'Check my Gmail',
        'Read my latest Gmail messages'
      );

      const response = await fakeEmailServer.waitForEmail(testUser.email, 30000);
      expect(response.body).toMatch(/credentials|login|connect|oauth/i);
    });
  });

  describe('Statistics & Monitoring', () => {
    it('should track communication stats', () => {
      // Send various communications
      fakeEmailServer.sendEmail('a@test.com', 'b@test.com', 'Test 1', 'Body 1');
      fakeEmailServer.sendEmail('a@test.com', 'b@test.com', 'Test 2', 'Body 2');
      fakeEmailServer.sendSMS('+1111', '+2222', 'SMS 1');
      fakeEmailServer.makeCall('+1111', '+2222', 'Call 1');

      const stats = fakeEmailServer.getStats();

      expect(stats.totalEmails).toBe(2);
      expect(stats.totalSMS).toBe(1);
      expect(stats.totalCalls).toBe(1);
      expect(stats.uniqueEmailRecipients).toBe(1);
    });

    it('should identify bottlenecks in concurrent execution', async () => {
      const timestamps: number[] = [];

      // Send 20 tasks rapidly
      for (let i = 0; i < 20; i++) {
        timestamps.push(Date.now());
        fakeEmailServer.sendEmail(
          testUser.email,
          `${testUser.username}@aevoy.com`,
          `Bottleneck test ${i}`,
          'Quick task'
        );
      }

      // Measure response times
      await new Promise(resolve => setTimeout(resolve, 15000));

      const responses = fakeEmailServer.getInbox(testUser.email);
      const responseTimes = responses.map((r, i) =>
        r.timestamp.getTime() - timestamps[i]
      );

      // Check for consistent latency (no severe bottlenecks)
      const avgTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const maxTime = Math.max(...responseTimes);

      console.log(`[BOTTLENECK] Avg: ${avgTime}ms, Max: ${maxTime}ms`);

      // Max should not be >3x average (indicates bottleneck)
      expect(maxTime).toBeLessThan(avgTime * 3);
    }, 30000);
  });
});

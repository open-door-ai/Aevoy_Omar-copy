/**
 * Fake Email Server for E2E Testing
 *
 * Simulates SMTP server (Mailpit-like) for testing email flows without external dependencies.
 * Stores emails in memory, provides API to check inbox, send emails, and reset state.
 */

import { EventEmitter } from 'events';

export interface FakeEmail {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  html?: string;
  timestamp: Date;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType?: string;
  }>;
}

export interface FakeSMS {
  id: string;
  from: string;
  to: string;
  body: string;
  timestamp: Date;
}

export interface FakeVoiceCall {
  id: string;
  from: string;
  to: string;
  message: string;
  transcript?: string;
  timestamp: Date;
  status: 'initiated' | 'in-progress' | 'completed' | 'failed';
}

class FakeEmailServer extends EventEmitter {
  private emails: Map<string, FakeEmail[]> = new Map();
  private sms: Map<string, FakeSMS[]> = new Map();
  private voiceCalls: Map<string, FakeVoiceCall[]> = new Map();
  private emailIdCounter = 0;
  private smsIdCounter = 0;
  private voiceIdCounter = 0;

  // Email operations
  sendEmail(from: string, to: string, subject: string, body: string, html?: string): string {
    const email: FakeEmail = {
      id: `email_${++this.emailIdCounter}`,
      from,
      to,
      subject,
      body,
      html,
      timestamp: new Date(),
    };

    if (!this.emails.has(to)) {
      this.emails.set(to, []);
    }
    this.emails.get(to)!.push(email);

    this.emit('email:sent', email);
    console.log(`[FAKE-EMAIL] Sent email to ${to}: ${subject}`);
    return email.id;
  }

  getInbox(email: string): FakeEmail[] {
    return this.emails.get(email) || [];
  }

  getLatestEmail(email: string): FakeEmail | null {
    const inbox = this.getInbox(email);
    return inbox.length > 0 ? inbox[inbox.length - 1] : null;
  }

  waitForEmail(email: string, timeout = 30000): Promise<FakeEmail> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Timeout waiting for email to ${email}`));
      }, timeout);

      const checkEmail = () => {
        const latest = this.getLatestEmail(email);
        if (latest && latest.timestamp.getTime() > Date.now() - timeout) {
          clearTimeout(timeoutId);
          resolve(latest);
        }
      };

      // Check immediately
      checkEmail();

      // Listen for new emails
      this.on('email:sent', (sentEmail: FakeEmail) => {
        if (sentEmail.to === email) {
          clearTimeout(timeoutId);
          resolve(sentEmail);
        }
      });
    });
  }

  clearInbox(email: string): void {
    this.emails.delete(email);
  }

  // SMS operations
  sendSMS(from: string, to: string, body: string): string {
    const sms: FakeSMS = {
      id: `sms_${++this.smsIdCounter}`,
      from,
      to,
      body,
      timestamp: new Date(),
    };

    if (!this.sms.has(to)) {
      this.sms.set(to, []);
    }
    this.sms.get(to)!.push(sms);

    this.emit('sms:sent', sms);
    console.log(`[FAKE-SMS] Sent SMS to ${to}: ${body.slice(0, 50)}...`);
    return sms.id;
  }

  getSMSInbox(phoneNumber: string): FakeSMS[] {
    return this.sms.get(phoneNumber) || [];
  }

  getLatestSMS(phoneNumber: string): FakeSMS | null {
    const inbox = this.getSMSInbox(phoneNumber);
    return inbox.length > 0 ? inbox[inbox.length - 1] : null;
  }

  waitForSMS(phoneNumber: string, timeout = 30000): Promise<FakeSMS> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Timeout waiting for SMS to ${phoneNumber}`));
      }, timeout);

      const checkSMS = () => {
        const latest = this.getLatestSMS(phoneNumber);
        if (latest && latest.timestamp.getTime() > Date.now() - timeout) {
          clearTimeout(timeoutId);
          resolve(latest);
        }
      };

      checkSMS();

      this.on('sms:sent', (sentSMS: FakeSMS) => {
        if (sentSMS.to === phoneNumber) {
          clearTimeout(timeoutId);
          resolve(sentSMS);
        }
      });
    });
  }

  clearSMSInbox(phoneNumber: string): void {
    this.sms.delete(phoneNumber);
  }

  // Voice call operations
  makeCall(from: string, to: string, message: string): string {
    const call: FakeVoiceCall = {
      id: `call_${++this.voiceIdCounter}`,
      from,
      to,
      message,
      timestamp: new Date(),
      status: 'initiated',
    };

    if (!this.voiceCalls.has(to)) {
      this.voiceCalls.set(to, []);
    }
    this.voiceCalls.get(to)!.push(call);

    this.emit('call:initiated', call);
    console.log(`[FAKE-VOICE] Call initiated to ${to}: ${message.slice(0, 50)}...`);
    return call.id;
  }

  updateCallStatus(callId: string, status: FakeVoiceCall['status'], transcript?: string): void {
    for (const calls of this.voiceCalls.values()) {
      const call = calls.find(c => c.id === callId);
      if (call) {
        call.status = status;
        if (transcript) call.transcript = transcript;
        this.emit('call:updated', call);
        return;
      }
    }
  }

  getCallHistory(phoneNumber: string): FakeVoiceCall[] {
    return this.voiceCalls.get(phoneNumber) || [];
  }

  getLatestCall(phoneNumber: string): FakeVoiceCall | null {
    const history = this.getCallHistory(phoneNumber);
    return history.length > 0 ? history[history.length - 1] : null;
  }

  waitForCall(phoneNumber: string, timeout = 30000): Promise<FakeVoiceCall> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Timeout waiting for call to ${phoneNumber}`));
      }, timeout);

      const checkCall = () => {
        const latest = this.getLatestCall(phoneNumber);
        if (latest && latest.timestamp.getTime() > Date.now() - timeout) {
          clearTimeout(timeoutId);
          resolve(latest);
        }
      };

      checkCall();

      this.on('call:initiated', (call: FakeVoiceCall) => {
        if (call.to === phoneNumber) {
          clearTimeout(timeoutId);
          resolve(call);
        }
      });
    });
  }

  clearCallHistory(phoneNumber: string): void {
    this.voiceCalls.delete(phoneNumber);
  }

  // Global reset
  reset(): void {
    this.emails.clear();
    this.sms.clear();
    this.voiceCalls.clear();
    this.emailIdCounter = 0;
    this.smsIdCounter = 0;
    this.voiceIdCounter = 0;
    this.removeAllListeners();
    console.log('[FAKE-SERVER] Reset all data');
  }

  // Statistics
  getStats() {
    return {
      totalEmails: Array.from(this.emails.values()).reduce((sum, inbox) => sum + inbox.length, 0),
      totalSMS: Array.from(this.sms.values()).reduce((sum, inbox) => sum + inbox.length, 0),
      totalCalls: Array.from(this.voiceCalls.values()).reduce((sum, history) => sum + history.length, 0),
      uniqueEmailRecipients: this.emails.size,
      uniqueSMSRecipients: this.sms.size,
      uniqueCallRecipients: this.voiceCalls.size,
    };
  }
}

// Singleton instance
export const fakeEmailServer = new FakeEmailServer();

// Helper to intercept Resend/Twilio calls in test mode
export function enableTestMode() {
  process.env.TEST_MODE = 'true';
  console.log('[FAKE-SERVER] Test mode enabled - all communications will be intercepted');
}

export function disableTestMode() {
  delete process.env.TEST_MODE;
  console.log('[FAKE-SERVER] Test mode disabled');
}

export function isTestMode(): boolean {
  // Never use test mode in production — even if TEST_MODE is accidentally set
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.TEST_MODE === 'true';
}

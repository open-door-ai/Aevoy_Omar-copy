export interface IncomingMessage {
  userId: string;
  username: string;
  channel: 'email' | 'sms' | 'voice' | 'whatsapp' | 'web';
  from: string;
  body: string;
  subject?: string;
  metadata?: Record<string, any>;
}

export interface User {
  id: string;
  username: string;
  email?: string;
  phone?: string;
}

export interface TriggerResult {
  type: string;
  shouldTrigger: boolean;
  description: string;
  taskDescription: string;
  critical: boolean;
}

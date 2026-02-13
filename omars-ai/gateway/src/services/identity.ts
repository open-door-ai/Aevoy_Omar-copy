import type { User } from '../types.js';

// Simple in-memory user store (replace with Supabase in production)
const users: User[] = [
  {
    id: 'omar',
    username: 'omar',
    email: 'omar@example.com',
    phone: '+17789008951',
  },
];

export function normalizeEmail(email: string): string {
  const [local, domain] = email.toLowerCase().split('@');

  // Remove Gmail dots and plus addressing
  if (domain === 'gmail.com') {
    const cleanLocal = local.replace(/\./g, '').split('+')[0];
    return `${cleanLocal}@${domain}`;
  }

  return email.toLowerCase();
}

export function normalizePhone(phone: string): string {
  // Remove non-digits
  const digits = phone.replace(/\D/g, '');

  // Add +1 if missing (assuming North America)
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  return `+${digits}`;
}

export async function resolveUserByEmail(email: string): Promise<User | null> {
  const normalized = normalizeEmail(email);
  return users.find(u => u.email && normalizeEmail(u.email) === normalized) || null;
}

export async function resolveUserByPhone(phone: string): Promise<User | null> {
  const normalized = normalizePhone(phone);
  return users.find(u => u.phone && normalizePhone(u.phone) === normalized) || null;
}

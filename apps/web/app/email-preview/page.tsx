'use client';

import { useState, useEffect } from 'react';
import { render } from '@react-email/render';
import ConfirmEmail from '@/emails/confirm-email';
import ResetPassword from '@/emails/reset-password';
import MagicLink from '@/emails/magic-link';

export default function EmailPreview() {
  const [selectedTemplate, setSelectedTemplate] = useState<'confirm' | 'reset' | 'magic'>('confirm');
  const [html, setHtml] = useState<string>('');

  useEffect(() => {
    async function renderEmail() {
      const templates = {
        confirm: ConfirmEmail({
          confirmationUrl: 'https://aevoy.com/auth/confirm?token=xxx',
          userEmail: 'user@example.com',
        }),
        reset: ResetPassword({
          resetUrl: 'https://aevoy.com/auth/reset?token=xxx',
          userEmail: 'user@example.com',
        }),
        magic: MagicLink({
          magicLinkUrl: 'https://aevoy.com/auth/magic?token=xxx',
          userEmail: 'user@example.com',
        }),
      };

      const rendered = await render(templates[selectedTemplate]);
      setHtml(rendered);
    }

    renderEmail();
  }, [selectedTemplate]);

  return (
    <div className="min-h-screen bg-stone-50 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Email Template Preview</h1>

        <div className="flex gap-4 mb-6">
          <button
            onClick={() => setSelectedTemplate('confirm')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              selectedTemplate === 'confirm'
                ? 'bg-purple-600 text-white'
                : 'bg-white hover:bg-stone-100'
            }`}
          >
            Confirm Email
          </button>
          <button
            onClick={() => setSelectedTemplate('reset')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              selectedTemplate === 'reset'
                ? 'bg-purple-600 text-white'
                : 'bg-white hover:bg-stone-100'
            }`}
          >
            Reset Password
          </button>
          <button
            onClick={() => setSelectedTemplate('magic')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              selectedTemplate === 'magic'
                ? 'bg-purple-600 text-white'
                : 'bg-white hover:bg-stone-100'
            }`}
          >
            Magic Link
          </button>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-6">
          <iframe
            srcDoc={html}
            className="w-full h-[800px] border-0"
            title="Email Preview"
          />
        </div>
      </div>
    </div>
  );
}

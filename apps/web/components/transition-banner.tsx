'use client';

import { useState, useEffect } from 'react';

const COOKIE_NAME = 'anticipy_banner_dismissed';
const COOKIE_DAYS = 30;

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? match[2] : null;
}

function setCookie(name: string, value: string, days: number) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${value}; expires=${expires}; path=/; SameSite=Lax`;
}

export function TransitionBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!getCookie(COOKIE_NAME)) {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  function dismiss(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setCookie(COOKIE_NAME, '1', COOKIE_DAYS);
    setVisible(false);
  }

  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 9999,
        backgroundColor: '#0C0C0C',
        color: '#F5F0EB',
        width: '100%',
      }}
    >
      <a
        href="https://anticipy.ai"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.25rem',
          padding: '0.625rem 2.5rem 0.625rem 1rem',
          color: '#F5F0EB',
          textDecoration: 'none',
          fontSize: '0.875rem',
          lineHeight: '1.25rem',
          textAlign: 'center',
        }}
      >
        <span>
          Aevoy is no longer in service. See{' '}
          <span style={{ textDecoration: 'underline', textUnderlineOffset: '2px', fontWeight: 600 }}>
            Anticipy.ai
          </span>
        </span>
      </a>
      <button
        onClick={dismiss}
        aria-label="Dismiss banner"
        style={{
          position: 'absolute',
          right: '0.75rem',
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'none',
          border: 'none',
          color: '#F5F0EB',
          cursor: 'pointer',
          padding: '0.25rem',
          fontSize: '1.125rem',
          lineHeight: 1,
          opacity: 0.7,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.7')}
      >
        &#x2715;
      </button>
    </div>
  );
}

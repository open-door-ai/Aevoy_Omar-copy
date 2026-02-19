'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Global error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', margin: 0, background: '#0f0f0f', color: '#fff' }}>
        <div style={{ textAlign: 'center', maxWidth: '480px', padding: '2rem' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Something went wrong</h1>
          <p style={{ color: '#999', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
            An unexpected error occurred. Please try again.
            {error.digest && <span style={{ display: 'block', marginTop: '0.5rem', fontSize: '0.75rem', color: '#666' }}>Error ID: {error.digest}</span>}
          </p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
            <button
              onClick={reset}
              style={{ padding: '0.6rem 1.4rem', background: '#fff', color: '#000', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{ padding: '0.6rem 1.4rem', background: 'transparent', color: '#fff', border: '1px solid #333', borderRadius: '6px', textDecoration: 'none' }}
            >
              Go home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}

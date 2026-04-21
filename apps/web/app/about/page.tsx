import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'About Anticipation Labs',
  description:
    'Aevoy and Anticipy are products of Anticipation Labs — building proactive AI that acts before you ask.',
  alternates: {
    canonical: 'https://anticipy.ai/about',
  },
};

export default function AboutPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        backgroundColor: '#0C0C0C',
        color: '#F5F0EB',
        fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: '42rem',
          margin: '0 auto',
          padding: '5rem 1.5rem',
        }}
      >
        <h1
          style={{
            fontSize: '2.25rem',
            fontWeight: 700,
            lineHeight: 1.2,
            marginBottom: '2rem',
          }}
        >
          About Anticipation Labs
        </h1>

        <section style={{ marginBottom: '2.5rem' }}>
          <p style={{ fontSize: '1.125rem', lineHeight: 1.8, opacity: 0.9 }}>
            <strong>Aevoy</strong> and <strong>Anticipy</strong> are both products of{' '}
            <strong>Anticipation Labs Inc.</strong> — a company building proactive AI that
            understands what you need before you ask.
          </p>
        </section>

        <section style={{ marginBottom: '2.5rem' }}>
          <h2
            style={{
              fontSize: '1.5rem',
              fontWeight: 600,
              marginBottom: '1rem',
            }}
          >
            Aevoy
          </h2>
          <p style={{ lineHeight: 1.8, opacity: 0.85 }}>
            Aevoy is where it started — an AI employee you can email, text, or call to get
            real tasks done. It books reservations, fills forms, researches topics, manages
            your calendar, and follows up when something needs attention. Aevoy runs on the
            belief that AI should <em>do</em> things, not just talk about them.
          </p>
        </section>

        <section style={{ marginBottom: '2.5rem' }}>
          <h2
            style={{
              fontSize: '1.5rem',
              fontWeight: 600,
              marginBottom: '1rem',
            }}
          >
            Anticipy
          </h2>
          <p style={{ lineHeight: 1.8, opacity: 0.85 }}>
            Anticipy is the next step — a proactive AI assistant that learns from your
            interactions and acts autonomously. It observes patterns, anticipates needs, and
            takes initiative. Where Aevoy waits for instructions, Anticipy reaches out
            first.
          </p>
          <p
            style={{
              marginTop: '1rem',
              lineHeight: 1.8,
              opacity: 0.85,
            }}
          >
            Learn more at{' '}
            <a
              href="https://anticipy.ai"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: '#F5F0EB',
                textDecoration: 'underline',
                textUnderlineOffset: '3px',
                fontWeight: 600,
              }}
            >
              anticipy.ai
            </a>
            .
          </p>
        </section>

        <section style={{ marginBottom: '2.5rem' }}>
          <h2
            style={{
              fontSize: '1.5rem',
              fontWeight: 600,
              marginBottom: '1rem',
            }}
          >
            One Company, Two Products
          </h2>
          <p style={{ lineHeight: 1.8, opacity: 0.85 }}>
            Both products share the same infrastructure, the same commitment to getting
            things done, and the same team at Anticipation Labs. Aevoy.com remains fully
            operational — everything you rely on continues to work.
          </p>
        </section>

        <footer style={{ borderTop: '1px solid rgba(245,240,235,0.15)', paddingTop: '2rem', marginTop: '3rem' }}>
          <p style={{ fontSize: '0.875rem', opacity: 0.6 }}>
            &copy; {new Date().getFullYear()} Anticipation Labs Inc.
          </p>
        </footer>
      </div>
    </main>
  );
}

import { Section, Text, Link, Hr } from '@react-email/components';

export function EmailFooter() {
  return (
    <>
      <Hr style={hrStyle} />
      <Section style={footerStyle}>
        <Text style={footerTextStyle}>
          Sent by your AI assistant at{' '}
          <Link href="https://aevoy.com" style={linkStyle}>
            Aevoy
          </Link>
        </Text>
        <Text style={footerLinksStyle}>
          <Link href="https://aevoy.com/dashboard" style={linkStyle}>
            Dashboard
          </Link>
          {' · '}
          <Link href="https://aevoy.com/dashboard/settings" style={linkStyle}>
            Settings
          </Link>
          {' · '}
          <Link href="https://aevoy.com/help" style={linkStyle}>
            Help
          </Link>
        </Text>
        <Text style={addressStyle}>
          © 2026 Aevoy. All rights reserved.
        </Text>
      </Section>
    </>
  );
}

const hrStyle = {
  borderColor: '#e7e5e4', // stone-200
  margin: '0',
};

const footerStyle = {
  padding: '32px 40px',
  backgroundColor: '#fafaf9', // stone-50
};

const footerTextStyle = {
  fontSize: '14px',
  color: '#57534e', // stone-600
  margin: '0 0 8px 0',
  textAlign: 'center' as const,
};

const footerLinksStyle = {
  fontSize: '14px',
  color: '#78716c', // stone-500
  margin: '0 0 16px 0',
  textAlign: 'center' as const,
};

const linkStyle = {
  color: '#8e5ef2', // brand purple
  textDecoration: 'none',
};

const addressStyle = {
  fontSize: '12px',
  color: '#a8a29e', // stone-400
  margin: 0,
  textAlign: 'center' as const,
};

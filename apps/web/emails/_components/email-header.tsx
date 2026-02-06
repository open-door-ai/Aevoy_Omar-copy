import { Section, Heading } from '@react-email/components';

export function EmailHeader() {
  return (
    <Section style={headerStyle}>
      {/* Text-based logo (matching current branding) */}
      <Heading as="h1" style={logoStyle}>
        Aevoy
      </Heading>
      <div style={taglineStyle}>Your AI Employee</div>
    </Section>
  );
}

const headerStyle = {
  background: 'linear-gradient(135deg, #8e5ef2 0%, #8f63f5 50%, #7f5ef0 100%)',
  padding: '32px 40px',
  textAlign: 'center' as const,
};

const logoStyle = {
  color: '#ffffff',
  fontSize: '32px',
  fontWeight: '700',
  margin: '0 0 4px 0',
  letterSpacing: '-0.02em',
  textShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
};

const taglineStyle = {
  color: 'rgba(255, 255, 255, 0.9)',
  fontSize: '14px',
  fontWeight: '400',
  margin: 0,
};

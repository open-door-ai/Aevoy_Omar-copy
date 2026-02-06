import { Button as EmailButton } from '@react-email/components';

interface ButtonProps {
  href: string;
  children: React.ReactNode;
}

export function Button({ href, children }: ButtonProps) {
  return (
    <EmailButton href={href} style={buttonStyle}>
      {children}
    </EmailButton>
  );
}

const buttonStyle = {
  backgroundColor: '#8e5ef2', // brand purple
  color: '#ffffff',
  fontSize: '16px',
  fontWeight: '600',
  textDecoration: 'none',
  textAlign: 'center' as const,
  padding: '14px 32px',
  borderRadius: '12px',
  display: 'inline-block',
  cursor: 'pointer',
  boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
};

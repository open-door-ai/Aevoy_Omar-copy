import { Section, Text } from '@react-email/components';
import { EmailLayout } from './_components/email-layout';
import { EmailHeader } from './_components/email-header';
import { Button } from './_components/email-button';
import { EmailFooter } from './_components/email-footer';

interface MagicLinkProps {
  magicLinkUrl: string;
  userEmail: string;
}

export function MagicLink({ magicLinkUrl, userEmail }: MagicLinkProps) {
  return (
    <EmailLayout previewText="Your Aevoy sign-in link">
      <EmailHeader />

      <Section style={contentStyle}>
        <Text style={headingStyle}>Sign In to Aevoy</Text>

        <Text style={bodyStyle}>
          Click the button below to securely sign in to your Aevoy account:
        </Text>

        <Section style={buttonContainerStyle}>
          <Button href={magicLinkUrl}>
            Sign In
          </Button>
        </Section>

        <Text style={bodyStyle}>
          This link will sign you in automatically without requiring a password.
        </Text>

        <Text style={smallTextStyle}>
          If you didn't request this sign-in link, you can safely ignore this email.
        </Text>

        <Text style={smallTextStyle}>
          This link will expire in 1 hour. If the button doesn't work, copy and paste this link into your browser:
          <br />
          <span style={urlStyle}>{magicLinkUrl}</span>
        </Text>
      </Section>

      <EmailFooter />
    </EmailLayout>
  );
}

const contentStyle = { padding: '40px' };
const headingStyle = { fontSize: '24px', fontWeight: '700', color: '#1c1917', margin: '0 0 16px 0', lineHeight: '1.3' };
const bodyStyle = { fontSize: '16px', color: '#44403c', margin: '0 0 16px 0', lineHeight: '1.6' };
const buttonContainerStyle = { textAlign: 'center' as const, margin: '32px 0' };
const smallTextStyle = { fontSize: '14px', color: '#78716c', margin: '16px 0 0 0', lineHeight: '1.5' };
const urlStyle = { color: '#8e5ef2', wordBreak: 'break-all' as const, fontSize: '12px' };

export default MagicLink;

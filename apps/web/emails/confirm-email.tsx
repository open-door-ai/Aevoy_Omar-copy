import { Section, Text } from '@react-email/components';
import { EmailLayout } from './_components/email-layout';
import { EmailHeader } from './_components/email-header';
import { Button } from './_components/email-button';
import { EmailFooter } from './_components/email-footer';

interface ConfirmEmailProps {
  confirmationUrl: string;
  userEmail: string;
}

export function ConfirmEmail({ confirmationUrl, userEmail }: ConfirmEmailProps) {
  return (
    <EmailLayout previewText="Confirm your Aevoy account">
      <EmailHeader />

      <Section style={contentStyle}>
        <Text style={headingStyle}>Welcome to Aevoy!</Text>

        <Text style={bodyStyle}>
          Thanks for signing up for Aevoy, your AI employee that never fails. We're excited to have you on board.
        </Text>

        <Text style={bodyStyle}>
          To get started, please confirm your email address by clicking the button below:
        </Text>

        <Section style={buttonContainerStyle}>
          <Button href={confirmationUrl}>
            Confirm Email Address
          </Button>
        </Section>

        <Text style={bodyStyle}>
          Once confirmed, you'll be able to access your dashboard and start delegating tasks to your AI assistant via email, SMS, or voice calls.
        </Text>

        <Text style={smallTextStyle}>
          If you didn't create an account with Aevoy, you can safely ignore this email.
        </Text>

        <Text style={smallTextStyle}>
          This link will expire in 24 hours. If the button doesn't work, copy and paste this link into your browser:
          <br />
          <span style={urlStyle}>{confirmationUrl}</span>
        </Text>
      </Section>

      <EmailFooter />
    </EmailLayout>
  );
}

const contentStyle = {
  padding: '40px',
};

const headingStyle = {
  fontSize: '24px',
  fontWeight: '700',
  color: '#1c1917', // stone-900
  margin: '0 0 16px 0',
  lineHeight: '1.3',
};

const bodyStyle = {
  fontSize: '16px',
  color: '#44403c', // stone-700
  margin: '0 0 16px 0',
  lineHeight: '1.6',
};

const buttonContainerStyle = {
  textAlign: 'center' as const,
  margin: '32px 0',
};

const smallTextStyle = {
  fontSize: '14px',
  color: '#78716c', // stone-500
  margin: '16px 0 0 0',
  lineHeight: '1.5',
};

const urlStyle = {
  color: '#8e5ef2',
  wordBreak: 'break-all' as const,
  fontSize: '12px',
};

// Default export for dynamic rendering
export default ConfirmEmail;

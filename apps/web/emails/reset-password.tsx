import { Section, Text } from '@react-email/components';
import { EmailLayout } from './_components/email-layout';
import { EmailHeader } from './_components/email-header';
import { Button } from './_components/email-button';
import { EmailFooter } from './_components/email-footer';

interface ResetPasswordProps {
  resetUrl: string;
  userEmail: string;
}

export function ResetPassword({ resetUrl, userEmail }: ResetPasswordProps) {
  return (
    <EmailLayout previewText="Reset your Aevoy password">
      <EmailHeader />

      <Section style={contentStyle}>
        <Text style={headingStyle}>Reset Your Password</Text>

        <Text style={bodyStyle}>
          We received a request to reset the password for your Aevoy account ({userEmail}).
        </Text>

        <Text style={bodyStyle}>
          Click the button below to create a new password:
        </Text>

        <Section style={buttonContainerStyle}>
          <Button href={resetUrl}>
            Reset Password
          </Button>
        </Section>

        <Text style={warningStyle}>
          ⚠️ If you didn't request a password reset, please ignore this email or contact support if you have concerns about your account security.
        </Text>

        <Text style={smallTextStyle}>
          This link will expire in 1 hour for security reasons. If the button doesn't work, copy and paste this link into your browser:
          <br />
          <span style={urlStyle}>{resetUrl}</span>
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
  color: '#1c1917',
  margin: '0 0 16px 0',
  lineHeight: '1.3',
};

const bodyStyle = {
  fontSize: '16px',
  color: '#44403c',
  margin: '0 0 16px 0',
  lineHeight: '1.6',
};

const buttonContainerStyle = {
  textAlign: 'center' as const,
  margin: '32px 0',
};

const warningStyle = {
  fontSize: '14px',
  color: '#dc2626', // red-600
  backgroundColor: '#fef2f2', // red-50
  padding: '12px 16px',
  borderRadius: '8px',
  margin: '24px 0 16px 0',
  lineHeight: '1.5',
};

const smallTextStyle = {
  fontSize: '14px',
  color: '#78716c',
  margin: '16px 0 0 0',
  lineHeight: '1.5',
};

const urlStyle = {
  color: '#8e5ef2',
  wordBreak: 'break-all' as const,
  fontSize: '12px',
};

export default ResetPassword;

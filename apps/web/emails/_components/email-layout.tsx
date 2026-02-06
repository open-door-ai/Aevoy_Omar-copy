import { Html, Head, Body, Container, Text } from '@react-email/components';

interface EmailLayoutProps {
  children: React.ReactNode;
  previewText: string;
}

export function EmailLayout({ children, previewText }: EmailLayoutProps) {
  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
      </Head>
      <Body style={bodyStyle}>
        {/* Preview text (shows in inbox preview) */}
        <Text style={{ display: 'none', fontSize: '1px', lineHeight: '1px', maxHeight: '0px', overflow: 'hidden' }}>
          {previewText}
        </Text>

        {/* Main container: 600px max-width */}
        <Container style={containerStyle}>
          {children}
        </Container>
      </Body>
    </Html>
  );
}

const bodyStyle = {
  backgroundColor: '#f5f5f4', // stone-100
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  margin: 0,
  padding: 0,
};

const containerStyle = {
  backgroundColor: '#ffffff',
  maxWidth: '600px',
  margin: '40px auto',
  padding: '0',
  borderRadius: '16px',
  overflow: 'hidden',
  boxShadow: '0 4px 6px rgba(0, 0, 0, 0.05)',
};

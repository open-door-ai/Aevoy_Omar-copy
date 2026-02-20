'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SkeletonList, SkeletonCard } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import {
  CheckCircle2,
  XCircle,
  ExternalLink,
  Trash2,
  Plus,
  Key,
  Shield,
  Loader2,
  Plug,
  Eye,
  EyeOff,
} from 'lucide-react';

interface IntegrationStatus {
  connected: boolean;
  connectedAt: string | null;
  email: string | null;
}

interface Credential {
  id: string;
  site_domain: string;
  username: string;
  created_at: string;
}

export default function ConnectedAppsPage() {
  return (
    <Suspense>
      <ConnectedAppsContent />
    </Suspense>
  );
}

function ConnectedAppsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [googleStatus, setGoogleStatus] = useState<IntegrationStatus | null>(null);
  const [microsoftStatus, setMicrosoftStatus] = useState<IntegrationStatus | null>(null);
  const [twitterStatus, setTwitterStatus] = useState<IntegrationStatus | null>(null);
  const [telegramStatus, setTelegramStatus] = useState<IntegrationStatus | null>(null);
  const [whatsappStatus, setWhatsappStatus] = useState<IntegrationStatus | null>(null);
  const [telegramQrData, setTelegramQrData] = useState<{ qrCodeDataUrl: string; deepLink: string } | null>(null);
  const [whatsappQrData, setWhatsappQrData] = useState<{ joinQrDataUrl: string; joinUrl: string } | null>(null);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loadingIntegrations, setLoadingIntegrations] = useState(true);
  const [loadingCredentials, setLoadingCredentials] = useState(true);
  const [connectingGoogle, setConnectingGoogle] = useState(false);
  const [connectingMicrosoft, setConnectingMicrosoft] = useState(false);
  const [connectingTwitter, setConnectingTwitter] = useState(false);
  const [connectingTelegram, setConnectingTelegram] = useState(false);
  const [disconnectingGoogle, setDisconnectingGoogle] = useState(false);
  const [disconnectingMicrosoft, setDisconnectingMicrosoft] = useState(false);
  const [disconnectingTwitter, setDisconnectingTwitter] = useState(false);
  const [disconnectingTelegram, setDisconnectingTelegram] = useState(false);
  const [disconnectingWhatsapp, setDisconnectingWhatsapp] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCred, setNewCred] = useState({ site_domain: '', username: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const toast = useToast();

  const fetchIntegrations = useCallback(async () => {
    try {
      const [googleRes, msRes, twitterRes, telegramRes, whatsappRes] = await Promise.all([
        fetch('/api/integrations/gmail'),
        fetch('/api/integrations/microsoft'),
        fetch('/api/integrations/twitter'),
        fetch('/api/integrations/telegram'),
        fetch('/api/integrations/whatsapp'),
      ]);
      if (googleRes.ok) setGoogleStatus(await googleRes.json());
      if (msRes.ok) setMicrosoftStatus(await msRes.json());
      if (twitterRes.ok) setTwitterStatus(await twitterRes.json());
      if (telegramRes.ok) {
        const td = await telegramRes.json();
        setTelegramStatus({ connected: td.connected || false, connectedAt: td.connectedAt || null, email: td.username || null });
      }
      if (whatsappRes.ok) {
        const wd = await whatsappRes.json();
        setWhatsappStatus({ connected: wd.connected || false, connectedAt: wd.connectedAt || null, email: wd.phone || null });
        if (!wd.connected && (wd.joinQrDataUrl || wd.joinUrl)) {
          setWhatsappQrData({ joinQrDataUrl: wd.joinQrDataUrl || '', joinUrl: wd.joinUrl || '' });
        }
      }
    } catch (err) {
      console.error('Error fetching integrations:', err);
    } finally {
      setLoadingIntegrations(false);
    }
  }, []);

  const fetchCredentials = useCallback(async () => {
    try {
      const response = await fetch('/api/credentials');
      if (response.ok) {
        const data = await response.json();
        setCredentials(data.credentials || []);
      }
    } catch (err) {
      console.error('Error fetching credentials:', err);
    } finally {
      setLoadingCredentials(false);
    }
  }, []);

  useEffect(() => {
    fetchIntegrations();
    fetchCredentials();
  }, [fetchIntegrations, fetchCredentials]);

  useEffect(() => {
    const gmail = searchParams.get('gmail');
    const microsoft = searchParams.get('microsoft');
    const twitter = searchParams.get('twitter');
    const telegram = searchParams.get('telegram');
    const whatsapp = searchParams.get('whatsapp');

    if (gmail === 'connected') {
      toast.success('Google account connected successfully');
      fetchIntegrations();
    } else if (gmail && gmail !== 'connected') {
      toast.error(`Google connection failed: ${gmail}`);
    }

    if (microsoft === 'connected') {
      toast.success('Microsoft account connected successfully');
      fetchIntegrations();
    } else if (microsoft && microsoft !== 'connected') {
      toast.error(`Microsoft connection failed: ${microsoft}`);
    }

    if (twitter === 'connected') {
      toast.success('Twitter account connected successfully');
      fetchIntegrations();
    } else if (twitter && twitter !== 'connected') {
      toast.error(`Twitter connection failed: ${twitter}`);
    }

    if (telegram === 'connected') {
      toast.success('Telegram connected successfully');
      fetchIntegrations();
    } else if (telegram && telegram !== 'connected') {
      toast.error(`Telegram connection failed: ${telegram}`);
    }

    if (whatsapp === 'connected') {
      toast.success('WhatsApp connected successfully');
      fetchIntegrations();
    } else if (whatsapp && whatsapp !== 'connected') {
      toast.error(`WhatsApp connection failed: ${whatsapp}`);
    }

    if (gmail || microsoft || twitter || telegram || whatsapp) {
      router.replace('/dashboard/apps', { scroll: false });
    }
  }, [searchParams]);

  const handleConnectGoogle = async () => {
    setConnectingGoogle(true);
    try {
      const response = await fetch('/api/integrations/gmail', { method: 'POST' });
      const data = await response.json();
      if (data.authUrl) {
        window.location.href = data.authUrl;
      } else {
        toast.error(data.error || 'Failed to start Google connection');
      }
    } catch {
      toast.error('Failed to connect Google');
    } finally {
      setConnectingGoogle(false);
    }
  };

  const handleDisconnectGoogle = async () => {
    setDisconnectingGoogle(true);
    try {
      const response = await fetch('/api/integrations/gmail', { method: 'DELETE' });
      if (response.ok) {
        setGoogleStatus({ connected: false, connectedAt: null, email: null });
        toast.success('Google disconnected');
      }
    } catch {
      toast.error('Failed to disconnect Google');
    } finally {
      setDisconnectingGoogle(false);
    }
  };

  const handleConnectMicrosoft = async () => {
    setConnectingMicrosoft(true);
    try {
      const response = await fetch('/api/integrations/microsoft', { method: 'POST' });
      const data = await response.json();
      if (data.authUrl) {
        window.location.href = data.authUrl;
      } else {
        toast.error(data.error || 'Failed to start Microsoft connection');
      }
    } catch {
      toast.error('Failed to connect Microsoft');
    } finally {
      setConnectingMicrosoft(false);
    }
  };

  const handleDisconnectMicrosoft = async () => {
    setDisconnectingMicrosoft(true);
    try {
      const response = await fetch('/api/integrations/microsoft', { method: 'DELETE' });
      if (response.ok) {
        setMicrosoftStatus({ connected: false, connectedAt: null, email: null });
        toast.success('Microsoft disconnected');
      }
    } catch {
      toast.error('Failed to disconnect Microsoft');
    } finally {
      setDisconnectingMicrosoft(false);
    }
  };

  const handleConnectTwitter = async () => {
    setConnectingTwitter(true);
    try {
      const response = await fetch('/api/integrations/twitter', { method: 'POST' });
      const data = await response.json();
      if (data.authUrl) {
        window.location.href = data.authUrl;
      } else {
        toast.error(data.error || 'Failed to start Twitter connection');
      }
    } catch {
      toast.error('Failed to connect Twitter');
    } finally {
      setConnectingTwitter(false);
    }
  };

  const handleDisconnectTwitter = async () => {
    setDisconnectingTwitter(true);
    try {
      const response = await fetch('/api/integrations/twitter', { method: 'DELETE' });
      if (response.ok) {
        setTwitterStatus({ connected: false, connectedAt: null, email: null });
        toast.success('Twitter disconnected');
      }
    } catch {
      toast.error('Failed to disconnect Twitter');
    } finally {
      setDisconnectingTwitter(false);
    }
  };

  const handleConnectTelegram = async () => {
    setConnectingTelegram(true);
    try {
      const response = await fetch('/api/integrations/telegram', { method: 'POST' });
      const data = await response.json();
      if (data.qrCodeDataUrl || data.deepLink) {
        setTelegramQrData({ qrCodeDataUrl: data.qrCodeDataUrl || '', deepLink: data.deepLink || '' });
      } else {
        toast.error(data.error || 'Failed to start Telegram connection');
      }
    } catch {
      toast.error('Failed to connect Telegram');
    } finally {
      setConnectingTelegram(false);
    }
  };

  const handleDisconnectTelegram = async () => {
    setDisconnectingTelegram(true);
    try {
      const response = await fetch('/api/integrations/telegram', { method: 'DELETE' });
      if (response.ok) {
        setTelegramStatus({ connected: false, connectedAt: null, email: null });
        setTelegramQrData(null);
        toast.success('Telegram disconnected');
      }
    } catch {
      toast.error('Failed to disconnect Telegram');
    } finally {
      setDisconnectingTelegram(false);
    }
  };

  const handleDisconnectWhatsapp = async () => {
    setDisconnectingWhatsapp(true);
    try {
      const response = await fetch('/api/integrations/whatsapp', { method: 'DELETE' });
      if (response.ok) {
        setWhatsappStatus({ connected: false, connectedAt: null, email: null });
        toast.success('WhatsApp disconnected');
      }
    } catch {
      toast.error('Failed to disconnect WhatsApp');
    } finally {
      setDisconnectingWhatsapp(false);
    }
  };

  // Poll for Telegram connection after QR is shown
  useEffect(() => {
    if (!telegramQrData || telegramStatus?.connected) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/integrations/telegram');
        if (!res.ok) return;
        const d = await res.json();
        if (d.connected) {
          setTelegramStatus({ connected: true, connectedAt: d.connectedAt || null, email: d.username || null });
          setTelegramQrData(null);
          toast.success('Telegram connected successfully');
          clearInterval(interval);
        }
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  }, [telegramQrData, telegramStatus?.connected]);

  const handleAddCredential = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCred.site_domain || !newCred.username || !newCred.password) {
      toast.error('All fields are required');
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch('/api/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCred),
      });
      if (response.ok) {
        const data = await response.json();
        setCredentials((prev) => [data.credential, ...prev]);
        setNewCred({ site_domain: '', username: '', password: '' });
        setShowAddForm(false);
        setShowPassword(false);
        toast.success('Credential saved securely');
      } else {
        toast.error('Failed to save credential');
      }
    } catch {
      toast.error('Failed to save credential');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteCredential = async (id: string) => {
    setDeletingId(id);
    try {
      const response = await fetch(`/api/credentials/${id}`, { method: 'DELETE' });
      if (response.ok) {
        setCredentials((prev) => prev.filter((c) => c.id !== id));
        toast.success('Credential removed');
      } else {
        toast.error('Failed to remove credential');
      }
    } catch {
      toast.error('Failed to remove credential');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Connected Apps</h1>
        <p className="text-muted-foreground">
          Manage integrations and stored credentials for your AI assistant
        </p>
      </div>

      {/* Integrations */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Google */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" className="w-6 h-6" aria-label="Google">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                </div>
                <div>
                  <CardTitle className="text-base">Google</CardTitle>
                  <CardDescription>Gmail, Calendar, Drive</CardDescription>
                </div>
              </div>
              {loadingIntegrations ? null : googleStatus?.connected ? (
                <CheckCircle2 className="w-5 h-5 text-green-500" />
              ) : (
                <XCircle className="w-5 h-5 text-muted-foreground" />
              )}
            </div>
          </CardHeader>
          <CardContent>
            {loadingIntegrations ? (
              <SkeletonCard variant="stats" />
            ) : googleStatus?.connected ? (
              <div className="space-y-3">
                <div className="text-sm">
                  <span className="text-muted-foreground">Connected as: </span>
                  <span className="font-medium">{googleStatus.email}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Since {new Date(googleStatus.connectedAt!).toLocaleDateString()}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDisconnectGoogle}
                  disabled={disconnectingGoogle}
                  className="text-red-500 hover:text-red-700"
                >
                  {disconnectingGoogle ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-1" />
                  ) : null}
                  Disconnect
                </Button>
              </div>
            ) : (
              <Button onClick={handleConnectGoogle} disabled={connectingGoogle}>
                {connectingGoogle ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-1" />
                ) : (
                  <ExternalLink className="w-4 h-4 mr-1" />
                )}
                Connect Google
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Microsoft */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" className="w-6 h-6" aria-label="Microsoft">
                    <rect fill="#F25022" x="1" y="1" width="10" height="10" />
                    <rect fill="#7FBA00" x="13" y="1" width="10" height="10" />
                    <rect fill="#00A4EF" x="1" y="13" width="10" height="10" />
                    <rect fill="#FFB900" x="13" y="13" width="10" height="10" />
                  </svg>
                </div>
                <div>
                  <CardTitle className="text-base">Microsoft</CardTitle>
                  <CardDescription>Outlook, Calendar, OneDrive</CardDescription>
                </div>
              </div>
              {loadingIntegrations ? null : microsoftStatus?.connected ? (
                <CheckCircle2 className="w-5 h-5 text-green-500" />
              ) : (
                <XCircle className="w-5 h-5 text-muted-foreground" />
              )}
            </div>
          </CardHeader>
          <CardContent>
            {loadingIntegrations ? (
              <SkeletonCard variant="stats" />
            ) : microsoftStatus?.connected ? (
              <div className="space-y-3">
                <div className="text-sm">
                  <span className="text-muted-foreground">Connected as: </span>
                  <span className="font-medium">{microsoftStatus.email}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Since {new Date(microsoftStatus.connectedAt!).toLocaleDateString()}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDisconnectMicrosoft}
                  disabled={disconnectingMicrosoft}
                  className="text-red-500 hover:text-red-700"
                >
                  {disconnectingMicrosoft ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-1" />
                  ) : null}
                  Disconnect
                </Button>
              </div>
            ) : (
              <Button onClick={handleConnectMicrosoft} disabled={connectingMicrosoft}>
                {connectingMicrosoft ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-1" />
                ) : (
                  <ExternalLink className="w-4 h-4 mr-1" />
                )}
                Connect Microsoft
              </Button>
            )}
          </CardContent>
        </Card>
        {/* Twitter */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" className="w-6 h-6" aria-label="Twitter / X">
                    <path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                </div>
                <div>
                  <CardTitle className="text-base">Twitter / X</CardTitle>
                  <CardDescription>Post tweets via API</CardDescription>
                </div>
              </div>
              {loadingIntegrations ? null : twitterStatus?.connected ? (
                <CheckCircle2 className="w-5 h-5 text-green-500" />
              ) : (
                <XCircle className="w-5 h-5 text-muted-foreground" />
              )}
            </div>
          </CardHeader>
          <CardContent>
            {loadingIntegrations ? (
              <SkeletonCard variant="stats" />
            ) : twitterStatus?.connected ? (
              <div className="space-y-3">
                <div className="text-sm">
                  <span className="text-muted-foreground">Connected as: </span>
                  <span className="font-medium">{twitterStatus.email}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Since {new Date(twitterStatus.connectedAt!).toLocaleDateString()}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDisconnectTwitter}
                  disabled={disconnectingTwitter}
                  className="text-red-500 hover:text-red-700"
                >
                  {disconnectingTwitter ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-1" />
                  ) : null}
                  Disconnect
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Button onClick={handleConnectTwitter} disabled={connectingTwitter}>
                  {connectingTwitter ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-1" />
                  ) : (
                    <ExternalLink className="w-4 h-4 mr-1" />
                  )}
                  Connect Twitter
                </Button>
                <p className="text-xs text-muted-foreground">
                  Or save your login in the Credential Vault below — the agent can use the browser instead.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Telegram */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#2AABEE' }}>
                  <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white" aria-label="Telegram">
                    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.820 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.800-.945-.629-.332-1.077.205-1.551.137-.12 2.583-2.364 2.63-2.575.006-.026.012-.12-.046-.169-.058-.051-.144-.033-.205-.019-.088.02-1.495.949-4.22 2.787-.399.27-.76.402-1.085.395-.357-.008-1.044-.2-1.556-.364-.627-.2-1.126-.307-1.082-.648.021-.177.333-.357.934-.539 3.660-1.598 6.1-2.652 7.324-3.164 3.488-1.434 4.212-1.683 4.684-1.69z"/>
                  </svg>
                </div>
                <div>
                  <CardTitle className="text-base">Telegram</CardTitle>
                  <CardDescription>Chat with your AI via Telegram bot</CardDescription>
                </div>
              </div>
              {loadingIntegrations ? null : telegramStatus?.connected ? (
                <CheckCircle2 className="w-5 h-5 text-green-500" />
              ) : (
                <XCircle className="w-5 h-5 text-muted-foreground" />
              )}
            </div>
          </CardHeader>
          <CardContent>
            {loadingIntegrations ? (
              <SkeletonCard variant="stats" />
            ) : telegramStatus?.connected ? (
              <div className="space-y-3">
                {telegramStatus.email && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Connected as: </span>
                    <span className="font-medium">@{telegramStatus.email}</span>
                  </div>
                )}
                {telegramStatus.connectedAt && (
                  <div className="text-xs text-muted-foreground">
                    Since {new Date(telegramStatus.connectedAt).toLocaleDateString()}
                  </div>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDisconnectTelegram}
                  disabled={disconnectingTelegram}
                  className="text-red-500 hover:text-red-700"
                >
                  {disconnectingTelegram ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-1" />
                  ) : null}
                  Disconnect
                </Button>
              </div>
            ) : telegramQrData ? (
              <div className="space-y-3">
                <img
                  src={telegramQrData.qrCodeDataUrl}
                  alt="Telegram QR Code"
                  className="w-36 h-36 rounded-lg"
                />
                <a
                  href={telegramQrData.deepLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-500 hover:underline flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" />
                  Open Telegram
                </a>
                <p className="text-xs text-muted-foreground animate-pulse">Waiting for connection...</p>
              </div>
            ) : (
              <Button onClick={handleConnectTelegram} disabled={connectingTelegram}>
                {connectingTelegram ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-1" />
                ) : (
                  <ExternalLink className="w-4 h-4 mr-1" />
                )}
                Connect Telegram
              </Button>
            )}
          </CardContent>
        </Card>

        {/* WhatsApp */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#25D366' }}>
                  <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white" aria-label="WhatsApp">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.890-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/>
                  </svg>
                </div>
                <div>
                  <CardTitle className="text-base">WhatsApp</CardTitle>
                  <CardDescription>Chat with your AI via WhatsApp</CardDescription>
                </div>
              </div>
              {loadingIntegrations ? null : whatsappStatus?.connected ? (
                <CheckCircle2 className="w-5 h-5 text-green-500" />
              ) : (
                <XCircle className="w-5 h-5 text-muted-foreground" />
              )}
            </div>
          </CardHeader>
          <CardContent>
            {loadingIntegrations ? (
              <SkeletonCard variant="stats" />
            ) : whatsappStatus?.connected ? (
              <div className="space-y-3">
                {whatsappStatus.email && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Connected: </span>
                    <span className="font-medium">{whatsappStatus.email}</span>
                  </div>
                )}
                {whatsappStatus.connectedAt && (
                  <div className="text-xs text-muted-foreground">
                    Since {new Date(whatsappStatus.connectedAt).toLocaleDateString()}
                  </div>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDisconnectWhatsapp}
                  disabled={disconnectingWhatsapp}
                  className="text-red-500 hover:text-red-700"
                >
                  {disconnectingWhatsapp ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-1" />
                  ) : null}
                  Disconnect
                </Button>
              </div>
            ) : whatsappQrData ? (
              <div className="space-y-3">
                <img
                  src={whatsappQrData.joinQrDataUrl}
                  alt="WhatsApp QR Code"
                  className="w-36 h-36 rounded-lg"
                />
                <a
                  href={whatsappQrData.joinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-green-600 hover:underline flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" />
                  Open WhatsApp
                </a>
                <p className="text-xs text-muted-foreground">Scan the QR or tap the link, then send any message to connect</p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">WhatsApp not configured</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Credential Vault */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-muted-foreground" />
            <div>
              <CardTitle>Credential Vault</CardTitle>
              <CardDescription>
                Stored login credentials for websites (encrypted with AES-256-GCM)
              </CardDescription>
            </div>
          </div>
          <Button
            variant={showAddForm ? 'outline' : 'default'}
            size="sm"
            onClick={() => {
              setShowAddForm(!showAddForm);
              if (showAddForm) {
                setNewCred({ site_domain: '', username: '', password: '' });
                setShowPassword(false);
              }
            }}
          >
            {showAddForm ? 'Cancel' : (
              <>
                <Plus className="w-4 h-4 mr-1" />
                Add Credential
              </>
            )}
          </Button>
        </CardHeader>
        <CardContent>
          {showAddForm && (
            <form onSubmit={handleAddCredential} className="mb-6 p-4 bg-muted rounded-lg space-y-4">
              <div className="space-y-2">
                <Label htmlFor="site_domain">Service / Website</Label>
                <Input
                  id="site_domain"
                  placeholder="e.g., linkedin.com"
                  value={newCred.site_domain}
                  onChange={(e) => setNewCred((p) => ({ ...p, site_domain: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="username">Username / Email</Label>
                <Input
                  id="username"
                  placeholder="e.g., user@example.com"
                  value={newCred.username}
                  onChange={(e) => setNewCred((p) => ({ ...p, username: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter password"
                    value={newCred.password}
                    onChange={(e) => setNewCred((p) => ({ ...p, password: e.target.value }))}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" disabled={submitting}>
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-1" />
                ) : (
                  <Key className="w-4 h-4 mr-1" />
                )}
                Save Credential
              </Button>
            </form>
          )}

          {loadingCredentials ? (
            <SkeletonList count={2} variant="task" />
          ) : credentials.length > 0 ? (
            <div className="space-y-3">
              {credentials.map((cred) => (
                <div
                  key={cred.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <Key className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium truncate">{cred.site_domain}</p>
                      <p className="text-sm text-muted-foreground truncate">{cred.username}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground">
                      {new Date(cred.created_at).toLocaleDateString()}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteCredential(cred.id)}
                      disabled={deletingId === cred.id}
                      className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20"
                    >
                      {deletingId === cred.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Plug}
              title="No stored credentials"
              description="Add login credentials for websites so your AI assistant can log in on your behalf."
              action={{
                label: 'Add Credential',
                onClick: () => setShowAddForm(true),
              }}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

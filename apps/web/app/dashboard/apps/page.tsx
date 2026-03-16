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
  Copy,
  Check,
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
    <Suspense fallback={<SkeletonList count={3} />}>
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
  const [whatsappQrData, setWhatsappQrData] = useState<{ sandboxJoinQr: string; sandboxJoinUrl: string; linkQrDataUrl: string; linkUrl: string; sandboxNumber: string } | null>(null);
  const [connectingWhatsapp, setConnectingWhatsapp] = useState(false);
  const [whatsappPolling, setWhatsappPolling] = useState(false);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loadingIntegrations, setLoadingIntegrations] = useState(true);
  const [loadingCredentials, setLoadingCredentials] = useState(true);
  const [connectingTwitter, setConnectingTwitter] = useState(false);
  const [connectingTelegram, setConnectingTelegram] = useState(false);
  const [disconnectingTwitter, setDisconnectingTwitter] = useState(false);
  const [disconnectingTelegram, setDisconnectingTelegram] = useState(false);
  const [disconnectingWhatsapp, setDisconnectingWhatsapp] = useState(false);
  const [imapStatus, setImapStatus] = useState<{ connected: boolean; email?: string } | null>(null);
  const [showImapForm, setShowImapForm] = useState(false);
  const [imapEmail, setImapEmail] = useState('');
  const [imapPassword, setImapPassword] = useState('');
  const [connectingImap, setConnectingImap] = useState(false);
  const [disconnectingImap, setDisconnectingImap] = useState(false);
  const [imapProvider, setImapProvider] = useState<'gmail' | 'outlook' | 'yahoo' | 'icloud' | 'other'>('gmail');
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
        setWhatsappStatus({ connected: wd.connected || false, connectedAt: null, email: wd.phone || null });
      }
      // Check IMAP email connection
      try {
        const imapRes = await fetch('/api/integrations/email');
        if (imapRes.ok) {
          const imap = await imapRes.json();
          setImapStatus({ connected: imap.connected || false, email: imap.email });
        }
      } catch { /* non-critical */ }
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

  const handleConnectImap = async () => {
    if (!imapEmail || !imapPassword) return;
    setConnectingImap(true);
    try {
      const res = await fetch('/api/integrations/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: imapEmail, password: imapPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        setImapStatus({ connected: true, email: imapEmail });
        setShowImapForm(false);
        setImapEmail('');
        setImapPassword('');
        toast.success('Email connected');
      } else {
        toast.error(data.error || 'Could not connect email — check your app password');
      }
    } catch {
      toast.error('Failed to connect email');
    } finally {
      setConnectingImap(false);
    }
  };

  const handleDisconnectImap = async () => {
    setDisconnectingImap(true);
    try {
      await fetch('/api/integrations/email', { method: 'DELETE' });
      setImapStatus({ connected: false });
      toast.success('Email disconnected');
    } catch {
      toast.error('Failed to disconnect email');
    } finally {
      setDisconnectingImap(false);
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
        setWhatsappQrData(null);
        toast.success('WhatsApp disconnected');
      }
    } catch {
      toast.error('Failed to disconnect WhatsApp');
    } finally {
      setDisconnectingWhatsapp(false);
    }
  };

  const handleConnectWhatsapp = async () => {
    setConnectingWhatsapp(true);
    try {
      const res = await fetch('/api/integrations/whatsapp', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to generate code');
      const data = await res.json();
      setWhatsappQrData({
        sandboxJoinQr: data.sandboxJoinQr || '',
        sandboxJoinUrl: data.sandboxJoinUrl || '',
        linkQrDataUrl: data.linkQrDataUrl || '',
        linkUrl: data.linkUrl || '',
        sandboxNumber: data.sandboxNumber || '+14155238886',
      });
      // Poll every 3s to detect when user has linked
      setWhatsappPolling(true);
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        if (attempts > 200) { clearInterval(poll); setWhatsappPolling(false); return; } // 10 min max
        const check = await fetch('/api/integrations/whatsapp');
        if (check.ok) {
          const status = await check.json();
          if (status.connected) {
            clearInterval(poll);
            setWhatsappPolling(false);
            setWhatsappQrData(null);
            setWhatsappStatus({ connected: true, connectedAt: null, email: status.phone || null });
            toast.success('WhatsApp connected!');
          }
        }
      }, 3000);
    } catch {
      toast.error('Failed to generate WhatsApp link code');
    } finally {
      setConnectingWhatsapp(false);
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
        {/* Google (IMAP migration) */}
        <Card className="opacity-60">
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
              <span className="text-[10px] font-medium bg-muted text-muted-foreground px-2 py-0.5 rounded-full">Use IMAP</span>
            </div>
          </CardHeader>
          <CardContent>
            {googleStatus?.connected ? (
              <div className="space-y-3">
                <div className="text-sm">
                  <span className="text-muted-foreground">Connected as: </span>
                  <span className="font-medium">{googleStatus.email}</span>
                </div>
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  OAuth is being migrated to IMAP. Please reconnect using the Email (IMAP) card below, then this connection will be removed automatically.
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Use the Email (IMAP) card below to connect Gmail with an app password instead.</p>
            )}
          </CardContent>
        </Card>

        {/* Microsoft (IMAP migration) */}
        <Card className="opacity-60">
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
              <span className="text-[10px] font-medium bg-muted text-muted-foreground px-2 py-0.5 rounded-full">Use IMAP</span>
            </div>
          </CardHeader>
          <CardContent>
            {microsoftStatus?.connected ? (
              <div className="space-y-3">
                <div className="text-sm">
                  <span className="text-muted-foreground">Connected as: </span>
                  <span className="font-medium">{microsoftStatus.email}</span>
                </div>
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  OAuth is being migrated to IMAP. Please reconnect using the Email (IMAP) card below, then this connection will be removed automatically.
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Use the Email (IMAP) card below to connect Outlook with an app password instead.</p>
            )}
          </CardContent>
        </Card>
        {/* Other Email (IMAP + App Password) */}
        <Card className={showImapForm && !imapStatus?.connected ? 'md:col-span-2 lg:col-span-3' : ''}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-50 dark:bg-amber-950/20 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" className="w-6 h-6" aria-label="Email" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                  </svg>
                </div>
                <div>
                  <CardTitle className="text-base">Email (IMAP)</CardTitle>
                  <CardDescription>Gmail, Outlook, Yahoo, iCloud, corporate</CardDescription>
                </div>
              </div>
              {imapStatus?.connected ? (
                <CheckCircle2 className="w-5 h-5 text-green-500" />
              ) : (
                <XCircle className="w-5 h-5 text-muted-foreground" />
              )}
            </div>
          </CardHeader>
          <CardContent>
            {imapStatus?.connected ? (
              <div className="space-y-3">
                <div className="text-sm">
                  <span className="text-muted-foreground">Connected as: </span>
                  <span className="font-medium">{imapStatus.email}</span>
                </div>
                <div className="text-xs text-muted-foreground">Email ✓ | Read &amp; send from your account</div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDisconnectImap}
                  disabled={disconnectingImap}
                  className="text-red-500 hover:text-red-700"
                >
                  {disconnectingImap ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                  Disconnect
                </Button>
              </div>
            ) : showImapForm ? (
              <div className="space-y-5">
                {/* Provider selector */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Select your email provider</p>
                  <div className="flex flex-wrap gap-2">
                    {(['gmail', 'outlook', 'yahoo', 'icloud', 'other'] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => setImapProvider(p)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors capitalize ${
                          imapProvider === p
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/40'
                        }`}
                      >
                        {p === 'gmail' ? 'Gmail' : p === 'outlook' ? 'Outlook' : p === 'yahoo' ? 'Yahoo' : p === 'icloud' ? 'iCloud' : 'Other'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Step-by-step guide */}
                <div className="bg-muted/30 rounded-xl p-4 border border-border">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-semibold text-foreground">
                      {imapProvider === 'gmail' && 'How to get a Gmail App Password'}
                      {imapProvider === 'outlook' && 'How to get an Outlook App Password'}
                      {imapProvider === 'yahoo' && 'How to get a Yahoo App Password'}
                      {imapProvider === 'icloud' && 'How to get an iCloud App Password'}
                      {imapProvider === 'other' && 'How to get an App Password'}
                    </p>
                    {imapProvider === 'gmail' && (
                      <a href="https://www.youtube.com/watch?v=N_J3HCATA1c" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] font-medium text-red-600 hover:text-red-700 transition-colors shrink-0 ml-2">
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                        Watch 41s →
                      </a>
                    )}
                    {imapProvider === 'outlook' && (
                      <a href="https://www.youtube.com/watch?v=nP1F5NEpuWQ" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] font-medium text-red-600 hover:text-red-700 transition-colors shrink-0 ml-2">
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                        Watch 51s →
                      </a>
                    )}
                    {imapProvider === 'yahoo' && (
                      <a href="https://www.youtube.com/watch?v=h_LrGeNV36g" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] font-medium text-red-600 hover:text-red-700 transition-colors shrink-0 ml-2">
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                        Watch 48s →
                      </a>
                    )}
                    {imapProvider === 'icloud' && (
                      <a href="https://www.youtube.com/watch?v=IeFkbBI0DXs" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] font-medium text-red-600 hover:text-red-700 transition-colors shrink-0 ml-2">
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                        Watch 33s →
                      </a>
                    )}
                  </div>
                  <ol className="space-y-2.5">
                    {imapProvider === 'gmail' && (<>
                      <li className="flex gap-3 text-xs">
                        <span className="w-5 h-5 rounded-full bg-primary/15 text-primary font-bold flex items-center justify-center shrink-0 text-[10px]">1</span>
                        <span className="text-muted-foreground">Sign in to your Google Account → go to <a href="https://myaccount.google.com/security" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">Security settings</a></span>
                      </li>
                      <li className="flex gap-3 text-xs">
                        <span className="w-5 h-5 rounded-full bg-primary/15 text-primary font-bold flex items-center justify-center shrink-0 text-[10px]">2</span>
                        <span className="text-muted-foreground">Under "How you sign in to Google", ensure <strong className="text-foreground">2-Step Verification</strong> is turned On</span>
                      </li>
                      <li className="flex gap-3 text-xs">
                        <span className="w-5 h-5 rounded-full bg-primary/15 text-primary font-bold flex items-center justify-center shrink-0 text-[10px]">3</span>
                        <span className="text-muted-foreground">Go to <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">App Passwords</a> (search "App Passwords" in your account)</span>
                      </li>
                      <li className="flex gap-3 text-xs">
                        <span className="w-5 h-5 rounded-full bg-primary/15 text-primary font-bold flex items-center justify-center shrink-0 text-[10px]">4</span>
                        <span className="text-muted-foreground">Type <strong className="text-foreground">Aevoy</strong> in the app name box → click <strong className="text-foreground">Create</strong></span>
                      </li>
                      <li className="flex gap-3 text-xs">
                        <span className="w-5 h-5 rounded-full bg-primary/15 text-primary font-bold flex items-center justify-center shrink-0 text-[10px]">5</span>
                        <span className="text-muted-foreground">Copy the <strong className="text-foreground">16-character password</strong> shown (spaces don't matter) → paste below</span>
                      </li>
                    </>)}
                    {imapProvider === 'outlook' && (<>
                      <li className="flex gap-3 text-xs">
                        <span className="w-5 h-5 rounded-full bg-primary/15 text-primary font-bold flex items-center justify-center shrink-0 text-[10px]">1</span>
                        <span className="text-muted-foreground">Sign in at <a href="https://account.microsoft.com/security" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">account.microsoft.com/security</a></span>
                      </li>
                      <li className="flex gap-3 text-xs">
                        <span className="w-5 h-5 rounded-full bg-primary/15 text-primary font-bold flex items-center justify-center shrink-0 text-[10px]">2</span>
                        <span className="text-muted-foreground">Click <strong className="text-foreground">Advanced security options</strong> → turn on <strong className="text-foreground">Two-step verification</strong></span>
                      </li>
                      <li className="flex gap-3 text-xs">
                        <span className="w-5 h-5 rounded-full bg-primary/15 text-primary font-bold flex items-center justify-center shrink-0 text-[10px]">3</span>
                        <span className="text-muted-foreground">Scroll to <strong className="text-foreground">App passwords</strong> → click <a href="https://account.live.com/proofs/AppPassword" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">Create a new app password</a></span>
                      </li>
                      <li className="flex gap-3 text-xs">
                        <span className="w-5 h-5 rounded-full bg-primary/15 text-primary font-bold flex items-center justify-center shrink-0 text-[10px]">4</span>
                        <span className="text-muted-foreground">Copy the generated password → paste it below</span>
                      </li>
                    </>)}
                    {imapProvider === 'yahoo' && (<>
                      <li className="flex gap-3 text-xs">
                        <span className="w-5 h-5 rounded-full bg-primary/15 text-primary font-bold flex items-center justify-center shrink-0 text-[10px]">1</span>
                        <span className="text-muted-foreground">Sign in at <a href="https://login.yahoo.com" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">Yahoo Mail</a> → click your name → <strong className="text-foreground">Account Info</strong></span>
                      </li>
                      <li className="flex gap-3 text-xs">
                        <span className="w-5 h-5 rounded-full bg-primary/15 text-primary font-bold flex items-center justify-center shrink-0 text-[10px]">2</span>
                        <span className="text-muted-foreground">Go to <a href="https://login.yahoo.com/account/security" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">Account Security</a> → turn on <strong className="text-foreground">Two-step verification</strong></span>
                      </li>
                      <li className="flex gap-3 text-xs">
                        <span className="w-5 h-5 rounded-full bg-primary/15 text-primary font-bold flex items-center justify-center shrink-0 text-[10px]">3</span>
                        <span className="text-muted-foreground">Click <strong className="text-foreground">Generate app password</strong> → select <strong className="text-foreground">Other app</strong> → type Aevoy</span>
                      </li>
                      <li className="flex gap-3 text-xs">
                        <span className="w-5 h-5 rounded-full bg-primary/15 text-primary font-bold flex items-center justify-center shrink-0 text-[10px]">4</span>
                        <span className="text-muted-foreground">Click <strong className="text-foreground">Generate</strong> → copy the password shown → paste below</span>
                      </li>
                    </>)}
                    {imapProvider === 'icloud' && (<>
                      <li className="flex gap-3 text-xs">
                        <span className="w-5 h-5 rounded-full bg-primary/15 text-primary font-bold flex items-center justify-center shrink-0 text-[10px]">1</span>
                        <span className="text-muted-foreground">Sign in at <a href="https://appleid.apple.com" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">appleid.apple.com</a></span>
                      </li>
                      <li className="flex gap-3 text-xs">
                        <span className="w-5 h-5 rounded-full bg-primary/15 text-primary font-bold flex items-center justify-center shrink-0 text-[10px]">2</span>
                        <span className="text-muted-foreground">Under <strong className="text-foreground">Sign-In and Security</strong>, click <strong className="text-foreground">App-Specific Passwords</strong></span>
                      </li>
                      <li className="flex gap-3 text-xs">
                        <span className="w-5 h-5 rounded-full bg-primary/15 text-primary font-bold flex items-center justify-center shrink-0 text-[10px]">3</span>
                        <span className="text-muted-foreground">Click <strong className="text-foreground">+</strong> → enter <strong className="text-foreground">Aevoy</strong> as the label → click <strong className="text-foreground">Create</strong></span>
                      </li>
                      <li className="flex gap-3 text-xs">
                        <span className="w-5 h-5 rounded-full bg-primary/15 text-primary font-bold flex items-center justify-center shrink-0 text-[10px]">4</span>
                        <span className="text-muted-foreground">Copy the password shown (<strong className="text-foreground">xxxx-xxxx-xxxx-xxxx</strong>) → paste below</span>
                      </li>
                    </>)}
                    {imapProvider === 'other' && (<>
                      <li className="flex gap-3 text-xs">
                        <span className="w-5 h-5 rounded-full bg-primary/15 text-primary font-bold flex items-center justify-center shrink-0 text-[10px]">1</span>
                        <span className="text-muted-foreground">In your email provider's settings, find <strong className="text-foreground">Security</strong> or <strong className="text-foreground">Account</strong></span>
                      </li>
                      <li className="flex gap-3 text-xs">
                        <span className="w-5 h-5 rounded-full bg-primary/15 text-primary font-bold flex items-center justify-center shrink-0 text-[10px]">2</span>
                        <span className="text-muted-foreground">Enable <strong className="text-foreground">IMAP access</strong> and <strong className="text-foreground">App passwords</strong> or <strong className="text-foreground">2-factor auth</strong></span>
                      </li>
                      <li className="flex gap-3 text-xs">
                        <span className="w-5 h-5 rounded-full bg-primary/15 text-primary font-bold flex items-center justify-center shrink-0 text-[10px]">3</span>
                        <span className="text-muted-foreground">Generate an app-specific password → copy it → paste below</span>
                      </li>
                    </>)}
                  </ol>
                </div>

                {/* Credential inputs */}
                <div className="space-y-2">
                  <Input
                    type="email"
                    placeholder={`your@${imapProvider === 'gmail' ? 'gmail.com' : imapProvider === 'outlook' ? 'outlook.com' : imapProvider === 'yahoo' ? 'yahoo.com' : imapProvider === 'icloud' ? 'icloud.com' : 'email.com'}`}
                    value={imapEmail}
                    onChange={(e) => setImapEmail(e.target.value)}
                    className="h-9 text-sm"
                  />
                  <Input
                    type="password"
                    placeholder="App password (from steps above)"
                    value={imapPassword}
                    onChange={(e) => setImapPassword(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleConnectImap} disabled={connectingImap || !imapEmail || !imapPassword}>
                    {connectingImap ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                    Connect Email
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowImapForm(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <Button onClick={() => setShowImapForm(true)}>
                <Key className="w-4 h-4 mr-1" />
                Connect via App Password
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
              <div className="space-y-4">
                {/* Step 1: Join sandbox */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Step 1 — Join sandbox (first time only)</p>
                  {whatsappQrData.sandboxJoinQr && (
                    <img src={whatsappQrData.sandboxJoinQr} alt="WhatsApp Sandbox QR" className="w-36 h-36 rounded-lg border" />
                  )}
                  <a
                    href={whatsappQrData.sandboxJoinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-green-600 hover:underline flex items-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Open WhatsApp ({whatsappQrData.sandboxNumber})
                  </a>
                </div>
                {/* Step 2: Link account */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Step 2 — Link your account</p>
                  {whatsappQrData.linkQrDataUrl && (
                    <img src={whatsappQrData.linkQrDataUrl} alt="WhatsApp Link QR" className="w-36 h-36 rounded-lg border" />
                  )}
                  <a
                    href={whatsappQrData.linkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-green-600 hover:underline flex items-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Send link message
                  </a>
                  {whatsappPolling && (
                    <p className="text-xs text-muted-foreground animate-pulse flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Waiting for connection...
                    </p>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">Link expires in 10 minutes</p>
              </div>
            ) : (
              <Button onClick={handleConnectWhatsapp} disabled={connectingWhatsapp}>
                {connectingWhatsapp ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-1" />
                ) : (
                  <ExternalLink className="w-4 h-4 mr-1" />
                )}
                Connect WhatsApp
              </Button>
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

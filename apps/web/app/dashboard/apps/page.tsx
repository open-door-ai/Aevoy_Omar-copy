'use client';

import { useState, useEffect, useCallback } from 'react';
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
  const [googleStatus, setGoogleStatus] = useState<IntegrationStatus | null>(null);
  const [microsoftStatus, setMicrosoftStatus] = useState<IntegrationStatus | null>(null);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loadingIntegrations, setLoadingIntegrations] = useState(true);
  const [loadingCredentials, setLoadingCredentials] = useState(true);
  const [connectingGoogle, setConnectingGoogle] = useState(false);
  const [connectingMicrosoft, setConnectingMicrosoft] = useState(false);
  const [disconnectingGoogle, setDisconnectingGoogle] = useState(false);
  const [disconnectingMicrosoft, setDisconnectingMicrosoft] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCred, setNewCred] = useState({ site_domain: '', username: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const toast = useToast();

  const fetchIntegrations = useCallback(async () => {
    try {
      const [googleRes, msRes] = await Promise.all([
        fetch('/api/integrations/gmail'),
        fetch('/api/integrations/microsoft'),
      ]);
      if (googleRes.ok) setGoogleStatus(await googleRes.json());
      if (msRes.ok) setMicrosoftStatus(await msRes.json());
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
      <div className="grid md:grid-cols-2 gap-4">
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

"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface TokenPayload {
  userId: string;
  purpose: string;
  serviceName: string;
  exp: number;
}

export default function ConnectPage() {
  const params = useParams();
  const token = params.token as string;
  const [payload, setPayload] = useState<TokenPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    try {
      // Decode JWT payload (not verified client-side — server verifies)
      const parts = token.split(".");
      if (parts.length !== 3) {
        setError("Invalid link");
        return;
      }
      const decoded = JSON.parse(atob(parts[1])) as TokenPayload;

      if (decoded.exp && decoded.exp * 1000 < Date.now()) {
        setError("This link has expired. Please request a new one.");
        return;
      }

      setPayload(decoded);
    } catch {
      setError("Invalid link format");
    }
  }, [token]);

  const handleConnect = async () => {
    if (!payload) return;
    setConnecting(true);

    try {
      // Determine the OAuth endpoint based on purpose
      const provider = payload.purpose.replace("connect_", "");
      const endpoint = provider === "microsoft"
        ? "/api/integrations/microsoft"
        : "/api/integrations/gmail";

      const res = await fetch(endpoint, { method: "POST" });
      const data = await res.json();

      if (data.authUrl) {
        window.location.href = data.authUrl;
      } else {
        setError(data.error || "Failed to start connection");
        setConnecting(false);
      }
    } catch {
      setError("Connection failed. Please try again.");
      setConnecting(false);
    }
  };

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-sm w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="text-4xl mb-4">&#9888;</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Connection Error</h1>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-sm w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <span className="text-2xl font-bold text-blue-600">A</span>
        </div>

        <h1 className="text-xl font-bold text-gray-900 mb-2">
          Connect {payload.serviceName}
        </h1>
        <p className="text-gray-600 mb-8">
          Aevoy needs access to your {payload.serviceName} account to complete tasks on your behalf.
        </p>

        <button
          onClick={handleConnect}
          disabled={connecting}
          className="w-full py-3 px-6 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {connecting ? "Connecting..." : `Connect ${payload.serviceName}`}
        </button>

        <p className="text-xs text-gray-400 mt-6">
          Your data is encrypted. Aevoy only accesses what&apos;s needed for your tasks.
        </p>
      </div>
    </div>
  );
}

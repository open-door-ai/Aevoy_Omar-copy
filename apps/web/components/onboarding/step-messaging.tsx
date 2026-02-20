"use client";

import { useState, useEffect } from "react";

interface StepMessagingProps {
  onNext: () => void;
  onBack: () => void;
}

export default function StepMessaging({ onNext, onBack }: StepMessagingProps) {
  const [telegramQr, setTelegramQr] = useState<string>("");
  const [telegramDeepLink, setTelegramDeepLink] = useState<string>("");
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [whatsappQr, setWhatsappQr] = useState<string>("");
  const [whatsappJoinUrl, setWhatsappJoinUrl] = useState<string>("");
  const [whatsappConnected, setWhatsappConnected] = useState(false);
  const [loadingTelegram, setLoadingTelegram] = useState(false);
  const [loadingWhatsapp, setLoadingWhatsapp] = useState(true);

  // Load WhatsApp QR on mount
  useEffect(() => {
    fetch("/api/integrations/whatsapp")
      .then((r) => r.json())
      .then((d) => {
        setWhatsappQr(d.joinQrDataUrl || "");
        setWhatsappJoinUrl(d.joinUrl || "");
        setWhatsappConnected(d.connected || false);
      })
      .catch(() => {})
      .finally(() => setLoadingWhatsapp(false));
  }, []);

  // Generate Telegram link code + QR on demand
  const handleGetTelegramQr = async () => {
    setLoadingTelegram(true);
    try {
      const res = await fetch("/api/integrations/telegram", { method: "POST" });
      const d = await res.json();
      setTelegramQr(d.qrCodeDataUrl || "");
      setTelegramDeepLink(d.deepLink || "");
    } catch {}
    setLoadingTelegram(false);
  };

  // Poll for Telegram connection after showing QR
  useEffect(() => {
    if (!telegramDeepLink) return;
    const interval = setInterval(async () => {
      const res = await fetch("/api/integrations/telegram").catch(() => null);
      if (!res?.ok) return;
      const d = await res.json();
      if (d.connected) {
        setTelegramConnected(true);
        clearInterval(interval);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [telegramDeepLink]);

  return (
    <div className="max-w-2xl mx-auto px-6">
      {/* Header */}
      <div className="text-center mb-10">
        <div className="text-4xl mb-4">💬</div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Connect Messaging Apps</h1>
        <p className="text-gray-500 text-lg">
          Chat with your AI from Telegram or WhatsApp — same memory, same assistant.
        </p>
        <span className="inline-block mt-3 text-xs font-medium text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
          Optional — you can do this later in Settings
        </span>
      </div>

      {/* Cards row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-10">
        {/* Telegram Card */}
        <div className="bg-white border border-gray-200 rounded-2xl p-6 text-center shadow-sm">
          <div className="w-12 h-12 mx-auto mb-3 bg-[#2AABEE] rounded-xl flex items-center justify-center">
            {/* Telegram icon SVG */}
            <svg className="w-7 h-7 fill-white" viewBox="0 0 24 24">
              <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.820 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.800-.945-.629-.332-1.077.205-1.551.137-.12 2.583-2.364 2.63-2.575.006-.026.012-.12-.046-.169-.058-.051-.144-.033-.205-.019-.088.02-1.495.949-4.22 2.787-.399.27-.76.402-1.085.395-.357-.008-1.044-.2-1.556-.364-.627-.2-1.126-.307-1.082-.648.021-.177.333-.357.934-.539 3.660-1.598 6.1-2.652 7.324-3.164 3.488-1.434 4.212-1.683 4.684-1.69z"/>
            </svg>
          </div>
          <h3 className="font-semibold text-gray-900 mb-1">Telegram</h3>
          <p className="text-sm text-gray-500 mb-4">Scan to connect via Telegram bot</p>

          {telegramConnected ? (
            <div className="text-green-600 font-medium text-sm">✓ Connected!</div>
          ) : telegramQr ? (
            <div>
              <img src={telegramQr} alt="Telegram QR" className="w-40 h-40 mx-auto mb-3 rounded-xl" />
              <a
                href={telegramDeepLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[#2AABEE] underline"
              >
                Open Telegram →
              </a>
              <p className="text-xs text-gray-400 mt-2 animate-pulse">Waiting for connection...</p>
            </div>
          ) : (
            <button
              onClick={handleGetTelegramQr}
              disabled={loadingTelegram}
              className="w-full py-2 px-4 bg-[#2AABEE] text-white text-sm font-medium rounded-lg hover:bg-[#1a9de0] transition-colors disabled:opacity-50"
            >
              {loadingTelegram ? "Generating..." : "Get QR Code"}
            </button>
          )}
        </div>

        {/* WhatsApp Card */}
        <div className="bg-white border border-gray-200 rounded-2xl p-6 text-center shadow-sm">
          <div className="w-12 h-12 mx-auto mb-3 bg-[#25D366] rounded-xl flex items-center justify-center">
            {/* WhatsApp icon SVG */}
            <svg className="w-7 h-7 fill-white" viewBox="0 0 24 24">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.890-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/>
            </svg>
          </div>
          <h3 className="font-semibold text-gray-900 mb-1">WhatsApp</h3>
          <p className="text-sm text-gray-500 mb-4">Scan to join the WhatsApp sandbox</p>

          {whatsappConnected ? (
            <div className="text-green-600 font-medium text-sm">✓ Connected!</div>
          ) : loadingWhatsapp ? (
            <div className="w-40 h-40 mx-auto bg-gray-100 rounded-xl animate-pulse" />
          ) : whatsappQr ? (
            <div>
              <img src={whatsappQr} alt="WhatsApp QR" className="w-40 h-40 mx-auto mb-3 rounded-xl" />
              <a
                href={whatsappJoinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[#25D366] underline"
              >
                Open WhatsApp →
              </a>
              <p className="text-xs text-gray-400 mt-2">Then send any message to connect</p>
            </div>
          ) : (
            <p className="text-xs text-gray-400">WhatsApp not configured</p>
          )}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          ← Back
        </button>
        <button
          onClick={onNext}
          className="py-3 px-8 bg-gray-900 text-white font-medium rounded-xl hover:bg-gray-800 transition-colors"
        >
          {telegramConnected || whatsappConnected ? "Continue →" : "Skip for now →"}
        </button>
      </div>
    </div>
  );
}

import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    // During SSR/build, env vars may not be available yet for client components.
    // Return a client with empty strings — it will fail at call time, not import time.
    if (typeof window === "undefined") {
      return createBrowserClient("https://placeholder.supabase.co", "placeholder");
    }
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
      "Set these in your .env.local file."
    );
  }
  return createBrowserClient(url, key);
}

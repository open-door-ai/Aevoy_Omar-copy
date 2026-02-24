/**
 * URL Security Validator
 *
 * Blocks navigation to localhost, private IPs, cloud metadata endpoints,
 * and file:// URLs to prevent SSRF (Server-Side Request Forgery) attacks.
 */

/**
 * Check if a URL targets a private/internal network address.
 * Returns an error message if blocked, or null if the URL is safe.
 */
export function validateUrlSafety(url: string): string | null {
  // Block file:// and other dangerous protocols
  const lowerUrl = url.toLowerCase().trim();
  if (lowerUrl.startsWith('file://') || lowerUrl.startsWith('ftp://') || lowerUrl.startsWith('gopher://') || lowerUrl.startsWith('data:')) {
    return `Blocked: "${lowerUrl.split(':')[0]}:" protocol is not allowed`;
  }

  let parsed: URL;
  try {
    // Auto-prepend https:// if needed for parsing
    const urlToParse = (!lowerUrl.startsWith('http://') && !lowerUrl.startsWith('https://'))
      ? `https://${url}`
      : url;
    parsed = new URL(urlToParse);
  } catch {
    return `Blocked: Invalid URL "${url}"`;
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost variants
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname === '0' ||
    hostname.endsWith('.localhost')
  ) {
    return `Blocked: Navigation to localhost (${hostname}) is not allowed`;
  }

  // Block private IP ranges (RFC 1918 + RFC 6598 + link-local)
  const ipMatch = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipMatch) {
    const [, a, b, c, d] = ipMatch.map(Number);

    // 10.0.0.0/8 — Private
    if (a === 10) {
      return `Blocked: Navigation to private IP 10.x.x.x is not allowed`;
    }

    // 172.16.0.0/12 — Private (172.16.0.0 - 172.31.255.255)
    if (a === 172 && b >= 16 && b <= 31) {
      return `Blocked: Navigation to private IP 172.16-31.x.x is not allowed`;
    }

    // 192.168.0.0/16 — Private
    if (a === 192 && b === 168) {
      return `Blocked: Navigation to private IP 192.168.x.x is not allowed`;
    }

    // 169.254.0.0/16 — Link-local (includes AWS metadata 169.254.169.254)
    if (a === 169 && b === 254) {
      return `Blocked: Navigation to link-local/metadata IP 169.254.x.x is not allowed`;
    }

    // 100.64.0.0/10 — Carrier-grade NAT (RFC 6598)
    if (a === 100 && b >= 64 && b <= 127) {
      return `Blocked: Navigation to CGNAT IP 100.64-127.x.x is not allowed`;
    }

    // 0.0.0.0/8 — Current network
    if (a === 0) {
      return `Blocked: Navigation to 0.x.x.x is not allowed`;
    }
  }

  // Block AWS/cloud metadata endpoints by hostname pattern
  // (covers cases where DNS resolves to 169.254.169.254)
  if (
    hostname === 'metadata.google.internal' ||
    hostname === 'metadata' ||
    hostname.includes('metadata.azure') ||
    hostname === 'instance-data'
  ) {
    return `Blocked: Navigation to cloud metadata endpoint (${hostname}) is not allowed`;
  }

  return null; // URL is safe
}

/**
 * Returns true if the URL is safe to navigate to, false otherwise.
 */
export function isUrlSafe(url: string): boolean {
  return validateUrlSafety(url) === null;
}

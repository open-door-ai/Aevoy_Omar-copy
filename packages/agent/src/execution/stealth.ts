/**
 * Browser Stealth Patches
 *
 * Makes automated browsers indistinguishable from real users.
 * Covers: fingerprinting, navigator overrides, canvas/WebGL noise,
 * WebRTC leak prevention, realistic timing, and human-like interaction.
 */

import type { BrowserContext, Page } from 'playwright';

// ---------------------------------------------------------------------------
// 1. USER-AGENT ROTATION — Current Chrome 131+ (Jan 2026)
// ---------------------------------------------------------------------------
const USER_AGENTS = [
  // Chrome 131 (Dec 2025)
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  // Chrome 130 (Nov 2025)
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  // Chrome 129 (Oct 2025)
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
];

export function getRealisticUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ---------------------------------------------------------------------------
// 2. VIEWPORT PROFILES — Consistent device characteristics per session
// ---------------------------------------------------------------------------
interface DeviceProfile {
  viewport: { width: number; height: number };
  screen: { width: number; height: number };
  deviceScaleFactor: number;
  platform: string;
  hardwareConcurrency: number;
  deviceMemory: number;
}

const DEVICE_PROFILES: DeviceProfile[] = [
  // MacBook Pro 14"
  { viewport: { width: 1512, height: 982 }, screen: { width: 1512, height: 982 }, deviceScaleFactor: 2, platform: 'MacIntel', hardwareConcurrency: 10, deviceMemory: 16 },
  // MacBook Air 13"
  { viewport: { width: 1470, height: 956 }, screen: { width: 1470, height: 956 }, deviceScaleFactor: 2, platform: 'MacIntel', hardwareConcurrency: 8, deviceMemory: 8 },
  // Windows desktop 1080p
  { viewport: { width: 1920, height: 1080 }, screen: { width: 1920, height: 1080 }, deviceScaleFactor: 1, platform: 'Win32', hardwareConcurrency: 8, deviceMemory: 16 },
  // Windows laptop 1366x768
  { viewport: { width: 1366, height: 768 }, screen: { width: 1366, height: 768 }, deviceScaleFactor: 1, platform: 'Win32', hardwareConcurrency: 4, deviceMemory: 8 },
  // Windows 1440p
  { viewport: { width: 2560, height: 1440 }, screen: { width: 2560, height: 1440 }, deviceScaleFactor: 1, platform: 'Win32', hardwareConcurrency: 12, deviceMemory: 32 },
  // Linux 1080p
  { viewport: { width: 1920, height: 1080 }, screen: { width: 1920, height: 1080 }, deviceScaleFactor: 1, platform: 'Linux x86_64', hardwareConcurrency: 8, deviceMemory: 16 },
];

let sessionProfile: DeviceProfile | null = null;

export function getDeviceProfile(): DeviceProfile {
  if (!sessionProfile) {
    sessionProfile = DEVICE_PROFILES[Math.floor(Math.random() * DEVICE_PROFILES.length)];
  }
  return sessionProfile;
}

// ---------------------------------------------------------------------------
// 3. STEALTH INIT SCRIPT — Injected into every page before any site JS runs
// ---------------------------------------------------------------------------
export async function applyStealthPatches(context: BrowserContext): Promise<void> {
  const profile = getDeviceProfile();

  await context.addInitScript((p: DeviceProfile) => {
    // --- navigator.webdriver: the #1 detection signal ---
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    // Also delete it from the prototype chain
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (Object.getPrototypeOf(navigator) as any).webdriver;

    // --- navigator.plugins: real Chrome has 5 ---
    const pluginData = [
      { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format', mimeType: 'application/x-google-chrome-pdf' },
      { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '', mimeType: 'application/pdf' },
      { name: 'Native Client', filename: 'internal-nacl-plugin', description: '', mimeType: 'application/x-nacl' },
      { name: 'Chromium PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format', mimeType: 'application/x-google-chrome-pdf' },
      { name: 'Chromium PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '', mimeType: 'application/pdf' },
    ];
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const arr = Object.create(PluginArray.prototype);
        for (let i = 0; i < pluginData.length; i++) {
          const pl = Object.create(Plugin.prototype);
          Object.defineProperties(pl, {
            name: { value: pluginData[i].name, enumerable: true },
            filename: { value: pluginData[i].filename, enumerable: true },
            description: { value: pluginData[i].description, enumerable: true },
            length: { value: 1, enumerable: true },
          });
          Object.defineProperty(arr, i, { value: pl, enumerable: true });
        }
        Object.defineProperty(arr, 'length', { value: pluginData.length });
        arr.refresh = () => {};
        return arr;
      },
    });

    // --- navigator.mimeTypes ---
    Object.defineProperty(navigator, 'mimeTypes', {
      get: () => {
        const arr = Object.create(MimeTypeArray.prototype);
        Object.defineProperty(arr, 'length', { value: 2 });
        return arr;
      },
    });

    // --- navigator.languages ---
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });

    // --- navigator.platform / hardwareConcurrency / deviceMemory ---
    Object.defineProperty(navigator, 'platform', { get: () => p.platform });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => p.hardwareConcurrency });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => p.deviceMemory });

    // --- window.chrome (must exist in real Chrome) ---
    if (!(window as unknown as Record<string, unknown>).chrome) {
      (window as unknown as Record<string, unknown>).chrome = {
        runtime: {
          onConnect: { addListener: () => {}, removeListener: () => {} },
          onMessage: { addListener: () => {}, removeListener: () => {} },
          sendMessage: () => {},
          connect: () => ({ onMessage: { addListener: () => {} }, postMessage: () => {} }),
        },
        loadTimes: () => ({
          commitLoadTime: Date.now() / 1000 - Math.random() * 2,
          connectionInfo: 'h2',
          finishDocumentLoadTime: Date.now() / 1000 - Math.random(),
          finishLoadTime: Date.now() / 1000 - Math.random() * 0.5,
          firstPaintAfterLoadTime: 0,
          firstPaintTime: Date.now() / 1000 - Math.random() * 1.5,
          navigationType: 'Other',
          npnNegotiatedProtocol: 'h2',
          requestTime: Date.now() / 1000 - Math.random() * 3,
          startLoadTime: Date.now() / 1000 - Math.random() * 2.5,
          wasAlternateProtocolAvailable: false,
          wasFetchedViaSpdy: true,
          wasNpnNegotiated: true,
        }),
        csi: () => ({
          onloadT: Date.now(),
          startE: Date.now() - Math.floor(Math.random() * 2000),
          pageT: Math.random() * 5000,
          tran: 15,
        }),
        app: {
          isInstalled: false,
          InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
          RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
        },
      };
    }

    // --- screen dimensions (must match viewport) ---
    Object.defineProperty(screen, 'width', { get: () => p.screen.width });
    Object.defineProperty(screen, 'height', { get: () => p.screen.height });
    Object.defineProperty(screen, 'availWidth', { get: () => p.screen.width });
    Object.defineProperty(screen, 'availHeight', { get: () => p.screen.height - 40 }); // taskbar
    Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
    Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });
    Object.defineProperty(window, 'devicePixelRatio', { get: () => p.deviceScaleFactor });
    Object.defineProperty(window, 'outerWidth', { get: () => p.viewport.width });
    Object.defineProperty(window, 'outerHeight', { get: () => p.viewport.height + 85 }); // toolbar

    // --- Canvas fingerprint noise ---
    // Adds imperceptible random noise to canvas readouts so each session
    // produces a unique-but-realistic fingerprint
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (type?: string, quality?: unknown) {
      const ctx = this.getContext('2d');
      if (ctx && this.width > 0 && this.height > 0) {
        try {
          const imageData = ctx.getImageData(0, 0, Math.min(this.width, 16), Math.min(this.height, 16));
          for (let i = 0; i < imageData.data.length; i += 4) {
            // Shift RGB channels by ±1 (imperceptible)
            imageData.data[i] = Math.max(0, Math.min(255, imageData.data[i] + (Math.random() > 0.5 ? 1 : -1)));
          }
          ctx.putImageData(imageData, 0, 0);
        } catch { /* security error on tainted canvases — fine */ }
      }
      return origToDataURL.call(this, type, quality as number | undefined);
    };

    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback, type?: string, quality?: number) {
      const ctx = this.getContext('2d');
      if (ctx && this.width > 0 && this.height > 0) {
        try {
          const imageData = ctx.getImageData(0, 0, Math.min(this.width, 16), Math.min(this.height, 16));
          for (let i = 0; i < imageData.data.length; i += 4) {
            imageData.data[i] = Math.max(0, Math.min(255, imageData.data[i] + (Math.random() > 0.5 ? 1 : -1)));
          }
          ctx.putImageData(imageData, 0, 0);
        } catch { /* tainted canvas */ }
      }
      return origToBlob.call(this, cb, type, quality as number | undefined);
    };

    // --- WebGL fingerprint spoofing ---
    const getParameterOrig = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (param: number) {
      // UNMASKED_VENDOR_WEBGL
      if (param === 0x9245) return 'Google Inc. (NVIDIA)';
      // UNMASKED_RENDERER_WEBGL
      if (param === 0x9246) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)';
      return getParameterOrig.call(this, param);
    };
    // Also patch WebGL2
    if (typeof WebGL2RenderingContext !== 'undefined') {
      const getParam2Orig = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function (param: number) {
        if (param === 0x9245) return 'Google Inc. (NVIDIA)';
        if (param === 0x9246) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)';
        return getParam2Orig.call(this, param);
      };
    }

    // --- AudioContext fingerprint noise ---
    const origGetFloatFrequencyData = AnalyserNode.prototype.getFloatFrequencyData;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    AnalyserNode.prototype.getFloatFrequencyData = function (array: any) {
      origGetFloatFrequencyData.call(this, array);
      for (let i = 0; i < array.length; i++) {
        array[i] += (Math.random() - 0.5) * 0.1; // Tiny noise
      }
    };

    // --- WebRTC leak prevention ---
    // Block WebRTC from exposing local IP (used for fingerprinting, not just privacy)
    const origRTC = window.RTCPeerConnection;
    if (origRTC) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).RTCPeerConnection = function (config: RTCConfiguration) {
        if (config && config.iceServers) {
          config.iceServers = []; // Strip STUN/TURN servers to prevent IP leak
        }
        return new origRTC(config);
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).RTCPeerConnection.prototype = origRTC.prototype;
    }

    // --- Permissions API ---
    const originalQuery = Permissions.prototype.query;
    Permissions.prototype.query = function (parameters: PermissionDescriptor) {
      if (parameters.name === 'notifications') {
        return Promise.resolve({ state: 'prompt', onchange: null } as PermissionStatus);
      }
      return originalQuery.call(this, parameters);
    };

    // --- Iframe contentWindow access ---
    const originalAttachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init: ShadowRootInit) {
      return originalAttachShadow.call(this, { ...init, mode: 'open' });
    };

    // --- Prevent detection via error stack traces ---
    // Playwright errors sometimes leak "playwright" or "puppeteer" in stack traces
    const origError = Error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).Error = function (...args: unknown[]) {
      const err = new origError(...(args as [string?]));
      if (err.stack) {
        err.stack = err.stack.replace(/playwright|puppeteer|automation|webdriver/gi, 'chrome-extension');
      }
      return err;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).Error.prototype = origError.prototype;

    // --- Connection type (real browsers have this) ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(navigator as any).connection) {
      Object.defineProperty(navigator, 'connection', {
        get: () => ({
          effectiveType: '4g',
          rtt: 50,
          downlink: 10,
          saveData: false,
        }),
      });
    }

    // --- Battery API (some detectors check for it) ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(navigator as any).getBattery) {
      Object.defineProperty(navigator, 'getBattery', {
        value: () => Promise.resolve({
          charging: true,
          chargingTime: 0,
          dischargingTime: Infinity,
          level: 1.0,
          addEventListener: () => {},
          removeEventListener: () => {},
        }),
      });
    }
  }, profile);
}

// ---------------------------------------------------------------------------
// 4. HUMAN-LIKE INTERACTIONS — Applied per-page
// ---------------------------------------------------------------------------

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Humanize mouse and keyboard interactions on a page.
 */
export async function humanizeInteraction(page: Page): Promise<void> {
  // Random delay before clicks (50-300ms, like a real person aiming)
  const originalClick = page.click.bind(page);
  page.click = async (selector: string, options?: Record<string, unknown>) => {
    await page.waitForTimeout(randomBetween(80, 350));
    return originalClick(selector, { ...options, delay: randomBetween(30, 80) });
  };

  // Random delay before fills (type like a human)
  const originalFill = page.fill.bind(page);
  page.fill = async (selector: string, value: string, options?: Record<string, unknown>) => {
    await page.waitForTimeout(randomBetween(100, 400));
    // Clear and type character by character for short values (looks more human)
    if (value.length <= 100) {
      try {
        await page.click(selector, { timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(randomBetween(50, 150));
        // Use keyboard.type for character-by-character typing with delays
        await page.locator(selector).pressSequentially(value, { delay: randomBetween(40, 120) });
        return;
      } catch {
        // Fall back to direct fill if pressSequentially fails
      }
    }
    return originalFill(selector, value, options);
  };
}

/**
 * Simulate a realistic scroll pattern on the page.
 */
export async function humanScroll(page: Page, direction: 'down' | 'up' = 'down'): Promise<void> {
  const scrolls = randomBetween(2, 5);
  for (let i = 0; i < scrolls; i++) {
    const amount = randomBetween(150, 450) * (direction === 'up' ? -1 : 1);
    await page.mouse.wheel(0, amount);
    await page.waitForTimeout(randomBetween(200, 600));
  }
}

/**
 * Move the mouse in a somewhat realistic path before clicking.
 * Uses 3-point quadratic bezier instead of teleporting.
 */
export async function humanMouseMove(page: Page, targetX: number, targetY: number): Promise<void> {
  const steps = randomBetween(8, 20);
  // Start from a random position (simulate existing cursor position)
  let currentX = randomBetween(100, 800);
  let currentY = randomBetween(100, 500);
  // Control point for bezier curve (creates a natural arc)
  const cpX = (currentX + targetX) / 2 + randomBetween(-100, 100);
  const cpY = (currentY + targetY) / 2 + randomBetween(-80, 80);

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Quadratic bezier interpolation
    const x = (1 - t) * (1 - t) * currentX + 2 * (1 - t) * t * cpX + t * t * targetX;
    const y = (1 - t) * (1 - t) * currentY + 2 * (1 - t) * t * cpY + t * t * targetY;
    await page.mouse.move(x, y);
    await page.waitForTimeout(randomBetween(5, 25));
  }
}

/** Get a random typing delay per character (ms). */
export function getTypingDelay(): number {
  return randomBetween(40, 130);
}

/** Get a random pause between actions (ms). */
export function getActionPause(): number {
  return randomBetween(200, 800);
}

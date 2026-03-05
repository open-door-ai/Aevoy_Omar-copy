/**
 * ViGoRL-style Visual Grounding — coordinate prediction fallback
 *
 * When all DOM-based click strategies fail (sparse tree, stale refs, dynamic content),
 * take a screenshot and ask a vision model to locate the target element by pixel coordinates.
 *
 * Inspired by ViGoRL (Qwen3-VL + RL fine-tuning for GUI grounding). We use the same
 * visual-grounding approach but backed by Haiku/Gemini rather than a dedicated RL model,
 * providing the same capability without requiring a fine-tuned model deployment.
 *
 * Security hardening:
 * - Element name sanitized before injecting into prompt (no prompt injection)
 * - Coordinate values clamped to viewport bounds (no out-of-bounds clicks)
 * - Hard timeout 8s — never blocks the main vision loop
 * - Fallback chain: Haiku → Gemini Flash → null (never throws)
 * - Only activates when page has content (no blank-page false positives)
 * - Confidence threshold: rejects if model hedges (no "I cannot see" responses)
 */

import type { Page } from 'patchright';

export interface GroundingResult {
  x: number;
  y: number;
  confidence: 'high' | 'medium' | 'low';
  modelUsed: string;
}

const GROUNDING_TIMEOUT_MS = 8000;
const MIN_PAGE_CONTENT_LENGTH = 200; // chars — skip on blank/error pages
const MAX_ELEMENT_NAME_LENGTH = 80;

/**
 * Sanitize an element name/description for safe prompt injection.
 * Strips control characters, quotes, and oversized strings.
 */
function sanitizeElementDesc(name: string): string {
  return name
    .replace(/[\x00-\x1f\x7f"'`\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, MAX_ELEMENT_NAME_LENGTH);
}

/**
 * Parse coordinates from vision model response.
 * Handles multiple formats:
 *   x=123 y=456
 *   (123, 456)
 *   coordinates: 123, 456
 *   click at 123 456
 */
function parseCoordinates(text: string): { x: number; y: number } | null {
  // Reject hedged/uncertain responses
  const unsurePatterns = /\b(cannot|can't|not (visible|found|see|present)|unclear|unable|don't see|no (such|element|button))\b/i;
  if (unsurePatterns.test(text)) return null;

  // Format 1: x=NNN y=NNN or x: NNN y: NNN
  const xyFormat = text.match(/x[=:\s]+(\d+)\D+y[=:\s]+(\d+)/i);
  if (xyFormat) return { x: parseInt(xyFormat[1]), y: parseInt(xyFormat[2]) };

  // Format 2: (NNN, NNN) — standard coordinate tuple
  const tupleFormat = text.match(/\(\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (tupleFormat) return { x: parseInt(tupleFormat[1]), y: parseInt(tupleFormat[2]) };

  // Format 3: "at NNN, NNN" or "NNN, NNN"
  const commaFormat = text.match(/\bat\s+(\d+)\s*,\s*(\d+)\b/i) ||
                      text.match(/coordinates?[:\s]+(\d+)\s*,\s*(\d+)/i);
  if (commaFormat) return { x: parseInt(commaFormat[1]), y: parseInt(commaFormat[2]) };

  // Format 4: Two standalone numbers on a line like "345 678"
  const bareFormat = text.match(/^\s*(\d{2,4})\s+(\d{2,4})\s*$/m);
  if (bareFormat) return { x: parseInt(bareFormat[1]), y: parseInt(bareFormat[2]) };

  return null;
}

/**
 * Clamp coordinates to viewport bounds with a 5px inset (avoid border/scrollbar edge clicks).
 */
function clampToViewport(x: number, y: number, width: number, height: number): { x: number; y: number } {
  const INSET = 5;
  return {
    x: Math.max(INSET, Math.min(x, width - INSET)),
    y: Math.max(INSET, Math.min(y, height - INSET)),
  };
}

/**
 * Build the grounding prompt. Compact — designed for models that prefer concise instructions.
 */
function buildGroundingPrompt(elementDesc: string, role: string, width: number, height: number): string {
  return `You are a precise GUI element locator. The screenshot is ${width}×${height} pixels.

Find this element: ${role} "${elementDesc}"

Respond with ONLY the pixel coordinates in this exact format:
x=NNN y=NNN

Where NNN are integer pixel values. If you cannot find the element, respond:
NOT_FOUND`;
}

/**
 * Predict click coordinates for an element using vision AI.
 *
 * @param page - Active Playwright page
 * @param elementName - Text/name of the element (from accessibility tree)
 * @param elementRole - ARIA role hint (button, link, textbox, etc.)
 * @returns GroundingResult with (x,y) coordinates, or null if grounding failed
 */
export async function predictClickCoordinates(
  page: Page,
  elementName: string,
  elementRole: string = 'button',
): Promise<GroundingResult | null> {
  try {
    // Guard: skip if page appears blank or errored
    const pageText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '').catch(() => '');
    if (pageText.length < MIN_PAGE_CONTENT_LENGTH) {
      console.log('[VIGORL] Skipping — page appears blank or minimal');
      return null;
    }

    // Get viewport dimensions for coordinate validation
    const viewport = page.viewportSize() || { width: 1280, height: 900 };

    // Take screenshot (JPEG 55 — good quality/size balance for coordinate prediction)
    const screenshotBuffer = await page.screenshot({
      type: 'jpeg',
      quality: 55,
      clip: { x: 0, y: 0, width: viewport.width, height: viewport.height },
    });
    const imageBase64 = screenshotBuffer.toString('base64');

    const safeDesc = sanitizeElementDesc(elementName);
    const safeRole = sanitizeElementDesc(elementRole);
    const prompt = buildGroundingPrompt(safeDesc, safeRole, viewport.width, viewport.height);

    // Build system prompt — terse, coordinate-focused
    const systemPrompt = 'You locate GUI elements and return pixel coordinates. Never explain. Only output x=NNN y=NNN or NOT_FOUND.';

    // Try vision models with 8s hard timeout
    const { generateVisionResponse } = await import('../services/ai.js');
    const result = await Promise.race([
      generateVisionResponse(prompt, imageBase64, systemPrompt),
      new Promise<null>((resolve) => setTimeout(() => {
        console.warn('[VIGORL] 8s timeout — coordinate prediction too slow');
        resolve(null);
      }, GROUNDING_TIMEOUT_MS)),
    ]);

    if (!result) return null;

    // NOT_FOUND explicit signal
    if (/NOT_FOUND/i.test(result.content)) {
      console.log(`[VIGORL] Element "${safeDesc}" not found by vision model`);
      return null;
    }

    const coords = parseCoordinates(result.content);
    if (!coords) {
      console.log(`[VIGORL] Could not parse coordinates from: "${result.content.substring(0, 100)}"`);
      return null;
    }

    // Validate: coords must be positive and within viewport (with 5px margin)
    if (coords.x <= 0 || coords.y <= 0 || coords.x >= viewport.width || coords.y >= viewport.height) {
      console.log(`[VIGORL] Coordinates (${coords.x},${coords.y}) out of viewport ${viewport.width}×${viewport.height}`);
      return null;
    }

    const clamped = clampToViewport(coords.x, coords.y, viewport.width, viewport.height);

    // Confidence scoring: high if near-center, medium if near-edge
    const centerDist = Math.sqrt(
      Math.pow(clamped.x - viewport.width / 2, 2) +
      Math.pow(clamped.y - viewport.height / 2, 2)
    );
    const maxDist = Math.sqrt(Math.pow(viewport.width / 2, 2) + Math.pow(viewport.height / 2, 2));
    const confidence = centerDist < maxDist * 0.3 ? 'high' : centerDist < maxDist * 0.7 ? 'medium' : 'low';

    console.log(`[VIGORL] Grounded "${safeDesc}" at (${clamped.x},${clamped.y}) confidence=${confidence} model=${'vision'}`);
    return { ...clamped, confidence, modelUsed: 'vision-grounding' };

  } catch (err) {
    // Never throw — this is always a fallback
    console.warn('[VIGORL] Coordinate prediction failed:', err);
    return null;
  }
}

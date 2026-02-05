/**
 * Page Structure Hashing
 *
 * Computes a structural hash of a web page's DOM to detect layout changes.
 * Used to validate cached browser steps before replaying.
 */

import crypto from "crypto";

// Page type compatible with both Playwright and Stagehand
interface PageLike {
  evaluate: (fn: () => string) => Promise<string>;
}

/**
 * Compute a structural hash of the current page.
 * Extracts tag names, roles, and important attributes to create a
 * layout fingerprint that ignores text content but detects structural changes.
 */
export async function computePageHash(page: PageLike): Promise<string> {
  try {
    const structure = await page.evaluate(() => {
      const elements: string[] = [];
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_ELEMENT,
        {
          acceptNode: (node: Node) => {
            const el = node as Element;
            const tag = el.tagName.toLowerCase();
            // Skip script, style, svg internals
            if (["script", "style", "noscript", "path", "line", "circle", "rect"].includes(tag)) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          },
        }
      );

      let count = 0;
      while (walker.nextNode() && count < 200) {
        const el = walker.currentNode as Element;
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute("role") || "";
        const type = el.getAttribute("type") || "";
        const name = el.getAttribute("name") || "";
        const ariaLabel = el.getAttribute("aria-label") || "";

        elements.push(`${tag}|${role}|${type}|${name}|${ariaLabel}`);
        count++;
      }

      return elements.join("\n");
    });

    return crypto.createHash("sha256").update(structure).digest("hex");
  } catch {
    return "";
  }
}

/**
 * Check if the page layout has changed from the stored hash.
 * Returns true if layout has changed (cached steps should not be used).
 */
export async function checkLayoutChanged(
  page: PageLike,
  storedHash: string
): Promise<boolean> {
  if (!storedHash) return true; // No stored hash = assume changed

  const currentHash = await computePageHash(page);
  if (!currentHash) return true; // Failed to compute = assume changed

  return currentHash !== storedHash;
}

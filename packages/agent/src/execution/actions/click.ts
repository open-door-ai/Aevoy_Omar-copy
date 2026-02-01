/**
 * Click Action with 10+ Fallback Methods
 * 
 * If one method doesn't work, try the next. Never give up.
 */

import type { Page } from 'playwright';

interface ClickTarget {
  selector?: string;
  text?: string;
  description?: string;
  role?: string;
}

interface ClickResult {
  success: boolean;
  method?: string;
  methodIndex?: number;
  error?: string;
}

type ClickMethod = (page: Page, target: ClickTarget) => Promise<boolean>;

const CLICK_METHODS: Array<{ name: string; fn: ClickMethod }> = [
  // 1. CSS selector
  {
    name: 'css_selector',
    fn: async (page, target) => {
      if (!target.selector) return false;
      await page.click(target.selector, { timeout: 5000 });
      return true;
    }
  },
  
  // 2. Text content (partial match)
  {
    name: 'text_content',
    fn: async (page, target) => {
      if (!target.text) return false;
      await page.getByText(target.text, { exact: false }).first().click({ timeout: 5000 });
      return true;
    }
  },
  
  // 3. Exact text match
  {
    name: 'text_exact',
    fn: async (page, target) => {
      if (!target.text) return false;
      await page.getByText(target.text, { exact: true }).first().click({ timeout: 5000 });
      return true;
    }
  },
  
  // 4. Role-based (button)
  {
    name: 'role_button',
    fn: async (page, target) => {
      if (!target.text && !target.description) return false;
      const name = target.text || target.description;
      await page.getByRole('button', { name: new RegExp(name!, 'i') }).first().click({ timeout: 5000 });
      return true;
    }
  },
  
  // 5. Role-based (link)
  {
    name: 'role_link',
    fn: async (page, target) => {
      if (!target.text && !target.description) return false;
      const name = target.text || target.description;
      await page.getByRole('link', { name: new RegExp(name!, 'i') }).first().click({ timeout: 5000 });
      return true;
    }
  },
  
  // 6. Force click (bypasses overlays)
  {
    name: 'force_click',
    fn: async (page, target) => {
      if (!target.selector) return false;
      await page.click(target.selector, { force: true, timeout: 5000 });
      return true;
    }
  },
  
  // 7. JavaScript click
  {
    name: 'js_click',
    fn: async (page, target) => {
      if (!target.selector) return false;
      const clicked = await page.evaluate((sel) => {
        const el = document.querySelector(sel) as HTMLElement;
        if (el) { 
          el.click(); 
          return true; 
        }
        return false;
      }, target.selector);
      return clicked;
    }
  },
  
  // 8. Coordinates click (center of element)
  {
    name: 'coordinates_click',
    fn: async (page, target) => {
      if (!target.selector) return false;
      const box = await page.locator(target.selector).boundingBox();
      if (!box) return false;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      return true;
    }
  },
  
  // 9. Scroll into view then click
  {
    name: 'scroll_then_click',
    fn: async (page, target) => {
      if (!target.selector) return false;
      await page.locator(target.selector).scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await page.click(target.selector, { timeout: 5000 });
      return true;
    }
  },
  
  // 10. Focus then Enter key
  {
    name: 'focus_enter',
    fn: async (page, target) => {
      if (!target.selector) return false;
      await page.locator(target.selector).focus();
      await page.keyboard.press('Enter');
      return true;
    }
  },
  
  // 11. Wait longer and retry
  {
    name: 'wait_and_retry',
    fn: async (page, target) => {
      if (!target.selector) return false;
      await page.waitForSelector(target.selector, { state: 'visible', timeout: 10000 });
      await page.waitForTimeout(500);
      await page.click(target.selector);
      return true;
    }
  },
  
  // 12. Double click
  {
    name: 'double_click',
    fn: async (page, target) => {
      if (!target.selector) return false;
      await page.dblclick(target.selector, { timeout: 5000 });
      return true;
    }
  },
  
  // 13. Hover then click
  {
    name: 'hover_then_click',
    fn: async (page, target) => {
      if (!target.selector) return false;
      await page.hover(target.selector);
      await page.waitForTimeout(200);
      await page.click(target.selector, { timeout: 5000 });
      return true;
    }
  },
  
  // 14. XPath by text
  {
    name: 'xpath_text',
    fn: async (page, target) => {
      if (!target.text) return false;
      const xpath = `//*[contains(text(), "${target.text}")]`;
      await page.locator(`xpath=${xpath}`).first().click({ timeout: 5000 });
      return true;
    }
  },
  
  // 15. Dispatch click event
  {
    name: 'dispatch_event',
    fn: async (page, target) => {
      if (!target.selector) return false;
      await page.evaluate((sel) => {
        const el = document.querySelector(sel) as HTMLElement;
        if (el) {
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          return true;
        }
        return false;
      }, target.selector);
      return true;
    }
  }
];

export async function executeClick(page: Page, target: ClickTarget): Promise<ClickResult> {
  for (let i = 0; i < CLICK_METHODS.length; i++) {
    const method = CLICK_METHODS[i];
    try {
      const success = await method.fn(page, target);
      if (success) {
        return { 
          success: true, 
          method: method.name, 
          methodIndex: i + 1 
        };
      }
    } catch (e) {
      // Method failed, try next
      continue;
    }
  }
  
  return { 
    success: false, 
    error: `All ${CLICK_METHODS.length} click methods failed for target: ${JSON.stringify(target)}` 
  };
}

export const CLICK_METHOD_COUNT = CLICK_METHODS.length;

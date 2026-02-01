/**
 * Fill Action with 10+ Fallback Methods
 * 
 * If one method doesn't work, try the next. Never give up.
 */

import type { Page } from 'playwright';

interface FillTarget {
  selector?: string;
  label?: string;
  placeholder?: string;
  name?: string;
  value: string;
}

interface FillResult {
  success: boolean;
  method?: string;
  methodIndex?: number;
  error?: string;
}

type FillMethod = (page: Page, target: FillTarget) => Promise<boolean>;

const FILL_METHODS: Array<{ name: string; fn: FillMethod }> = [
  // 1. CSS selector
  {
    name: 'css_selector',
    fn: async (page, target) => {
      if (!target.selector) return false;
      await page.fill(target.selector, target.value);
      return true;
    }
  },
  
  // 2. Label
  {
    name: 'label',
    fn: async (page, target) => {
      if (!target.label) return false;
      await page.getByLabel(target.label, { exact: false }).fill(target.value);
      return true;
    }
  },
  
  // 3. Placeholder
  {
    name: 'placeholder',
    fn: async (page, target) => {
      if (!target.placeholder) return false;
      await page.getByPlaceholder(target.placeholder).fill(target.value);
      return true;
    }
  },
  
  // 4. Name attribute
  {
    name: 'name_attr',
    fn: async (page, target) => {
      if (!target.name && !target.label) return false;
      const name = target.name || target.label?.toLowerCase().replace(/\s/g, '');
      await page.fill(`[name="${name}"], [name*="${name}"]`, target.value);
      return true;
    }
  },
  
  // 5. ID attribute
  {
    name: 'id_attr',
    fn: async (page, target) => {
      if (!target.name && !target.label) return false;
      const id = target.name || target.label?.toLowerCase().replace(/\s/g, '');
      await page.fill(`#${id}`, target.value);
      return true;
    }
  },
  
  // 6. Type character by character
  {
    name: 'sequential_type',
    fn: async (page, target) => {
      if (!target.selector) return false;
      await page.locator(target.selector).fill('');
      await page.locator(target.selector).pressSequentially(target.value, { delay: 50 });
      return true;
    }
  },
  
  // 7. JavaScript value set
  {
    name: 'js_value_set',
    fn: async (page, target) => {
      if (!target.selector) return false;
      const success = await page.evaluate(({ sel, val }) => {
        const el = document.querySelector(sel) as HTMLInputElement;
        if (el) {
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
        return false;
      }, { sel: target.selector, val: target.value });
      return success;
    }
  },
  
  // 8. Focus then type
  {
    name: 'focus_type',
    fn: async (page, target) => {
      if (!target.selector) return false;
      await page.locator(target.selector).focus();
      await page.keyboard.type(target.value);
      return true;
    }
  },
  
  // 9. Clear first then fill
  {
    name: 'clear_then_fill',
    fn: async (page, target) => {
      if (!target.selector) return false;
      await page.locator(target.selector).clear();
      await page.fill(target.selector, target.value);
      return true;
    }
  },
  
  // 10. Select all then type
  {
    name: 'select_all_type',
    fn: async (page, target) => {
      if (!target.selector) return false;
      await page.locator(target.selector).focus();
      await page.keyboard.press('Meta+a');
      await page.keyboard.type(target.value);
      return true;
    }
  },
  
  // 11. Label with for attribute
  {
    name: 'label_for',
    fn: async (page, target) => {
      if (!target.label) return false;
      const forAttr = await page.locator(`label:has-text("${target.label}")`).first().getAttribute('for');
      if (!forAttr) return false;
      await page.fill(`#${forAttr}`, target.value);
      return true;
    }
  },
  
  // 12. Aria label
  {
    name: 'aria_label',
    fn: async (page, target) => {
      if (!target.label && !target.placeholder) return false;
      const label = target.label || target.placeholder;
      await page.fill(`[aria-label*="${label}" i]`, target.value);
      return true;
    }
  },
  
  // 13. Input by type and position
  {
    name: 'input_by_type',
    fn: async (page, target) => {
      // Guess input type based on label
      const label = (target.label || target.placeholder || target.name || '').toLowerCase();
      let type = 'text';
      if (label.includes('email')) type = 'email';
      else if (label.includes('password')) type = 'password';
      else if (label.includes('phone')) type = 'tel';
      else if (label.includes('number')) type = 'number';
      
      const inputs = await page.$$(`input[type="${type}"]:visible`);
      if (inputs.length > 0) {
        await inputs[0].fill(target.value);
        return true;
      }
      return false;
    }
  },
  
  // 14. Nth input on page (guessed by label)
  {
    name: 'nth_input',
    fn: async (page, target) => {
      const label = (target.label || target.placeholder || '').toLowerCase();
      let index = 0;
      if (label.includes('email') || label.includes('username') || label.includes('first')) index = 0;
      else if (label.includes('password') || label.includes('last')) index = 1;
      else if (label.includes('confirm') || label.includes('phone')) index = 2;
      
      const inputs = await page.$$('input:visible, textarea:visible');
      if (index < inputs.length) {
        await inputs[index].fill(target.value);
        return true;
      }
      return false;
    }
  },
  
  // 15. Textarea fallback
  {
    name: 'textarea',
    fn: async (page, target) => {
      if (!target.selector && !target.label) return false;
      const sel = target.selector || `textarea[name*="${target.label}" i], textarea[placeholder*="${target.label}" i]`;
      await page.fill(sel, target.value);
      return true;
    }
  }
];

export async function executeFill(page: Page, target: FillTarget): Promise<FillResult> {
  for (let i = 0; i < FILL_METHODS.length; i++) {
    const method = FILL_METHODS[i];
    try {
      const success = await method.fn(page, target);
      if (success) {
        // Verify value was actually set if we have a selector
        if (target.selector) {
          try {
            const actualValue = await page.inputValue(target.selector);
            if (actualValue === target.value) {
              return { success: true, method: method.name, methodIndex: i + 1 };
            }
          } catch {
            // Verification failed but fill might have worked
            return { success: true, method: method.name, methodIndex: i + 1 };
          }
        } else {
          return { success: true, method: method.name, methodIndex: i + 1 };
        }
      }
    } catch (e) {
      // Method failed, try next
      continue;
    }
  }
  
  return { 
    success: false, 
    error: `All ${FILL_METHODS.length} fill methods failed for target: ${JSON.stringify(target)}` 
  };
}

export const FILL_METHOD_COUNT = FILL_METHODS.length;

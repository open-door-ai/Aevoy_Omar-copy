/**
 * Click Action with 15 Fallback Methods
 *
 * If one method doesn't work, try the next. Never give up.
 * Copied from Aevoy with minimal modifications.
 */
import type { Page } from 'playwright';
export interface ClickTarget {
    selector?: string;
    text?: string;
    description?: string;
    role?: string;
}
export interface ClickResult {
    success: boolean;
    method?: string;
    methodIndex?: number;
    error?: string;
}
export declare function executeClick(page: Page, target: ClickTarget): Promise<ClickResult>;
export declare const CLICK_METHOD_COUNT: number;

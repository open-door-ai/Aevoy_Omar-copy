/**
 * Fill Action with 17 Fallback Methods
 *
 * If one method doesn't work, try the next. Never give up.
 * Copied from Aevoy with minimal modifications.
 */
import type { Page } from 'playwright';
export interface FillTarget {
    selector?: string;
    label?: string;
    placeholder?: string;
    name?: string;
    value: string;
}
export interface FillResult {
    success: boolean;
    method?: string;
    methodIndex?: number;
    error?: string;
}
export declare function executeFill(page: Page, target: FillTarget): Promise<FillResult>;
export declare const FILL_METHOD_COUNT: number;

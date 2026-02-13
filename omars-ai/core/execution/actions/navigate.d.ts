/**
 * Navigation Actions - 8 Fallback Methods
 *
 * Never fails to navigate. If one method fails, tries the next.
 * Simplified version for Omar's Personal AI Assistant.
 */
import type { Page } from 'playwright';
export interface NavigateParams {
    url?: string;
    target?: string;
    siteDomain?: string;
}
export interface NavigateResult {
    success: boolean;
    method?: string;
    finalUrl?: string;
    error?: string;
}
export declare function executeNavigate(page: Page, params: NavigateParams): Promise<NavigateResult>;

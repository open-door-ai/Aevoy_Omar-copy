/**
 * Login Actions - 10 Fallback Methods
 *
 * Never gives up on login. If one method fails, tries the next.
 * Simplified version for Omar's Personal AI Assistant.
 */
import type { Page } from 'playwright';
export interface LoginParams {
    url: string;
    username: string;
    password: string;
}
export interface LoginResult {
    success: boolean;
    method?: string;
    error?: string;
    redirectUrl?: string;
}
export declare function executeLogin(page: Page, params: LoginParams): Promise<LoginResult>;

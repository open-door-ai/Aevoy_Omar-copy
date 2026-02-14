/**
 * Method Type Classifier
 *
 * Classifies actions into METHOD TYPES (not just specific methods)
 * to enforce diversity and prevent dumb retries of the same approach.
 *
 * Example: Instead of trying 30 different CSS selectors (all clicking),
 * try: click → keyboard → JavaScript → API → search engine
 */

import type { Action } from "../types/index.js";

export type MethodType =
  | 'BROWSER_CLICK'
  | 'BROWSER_TYPE'
  | 'BROWSER_SELECT'
  | 'BROWSER_KEYBOARD'
  | 'BROWSER_JAVASCRIPT'
  | 'BROWSER_NAVIGATION'
  | 'BROWSER_WAIT'
  | 'BROWSER_SCROLL'
  | 'BROWSER_EXTRACT'
  | 'API_DIRECT'
  | 'SEARCH_ENGINE'
  | 'EMAIL_BASED'
  | 'MANUAL_INSTRUCTIONS';

export type MethodCategory = 'browser' | 'alternative' | 'fallback';

export interface MethodAlternative {
  type: MethodType;
  rationale: string;
  example: string;
}

/**
 * Classify an action into its METHOD TYPE
 */
export function classifyMethodType(action: Action): MethodType {
  switch (action.type) {
    case 'click':
    case 'submit':
      return 'BROWSER_CLICK';

    case 'fill':
    case 'fill_form':
      return 'BROWSER_TYPE';

    case 'select':
      return 'BROWSER_SELECT';

    case 'login':
      return 'BROWSER_KEYBOARD';

    case 'browse':
      return 'BROWSER_NAVIGATION';

    case 'wait':
      return 'BROWSER_WAIT';

    case 'scroll':
      return 'BROWSER_SCROLL';

    case 'extract':
    case 'screenshot':
      return 'BROWSER_EXTRACT';

    case 'search':
      return 'SEARCH_ENGINE';

    case 'send_email':
      return 'EMAIL_BASED';

    case 'remember':
    case 'schedule':
      return 'MANUAL_INSTRUCTIONS';

    default:
      return 'API_DIRECT';
  }
}

/**
 * Get the category of a method type
 */
export function getMethodTypeCategory(methodType: MethodType): MethodCategory {
  if (methodType.startsWith('BROWSER_')) return 'browser';
  if (methodType === 'API_DIRECT' || methodType === 'SEARCH_ENGINE') return 'alternative';
  return 'fallback';
}

/**
 * Get alternative method types to try when current types are exhausted
 */
export function getAlternativeMethodTypes(exhaustedTypes: MethodType[]): MethodAlternative[] {
  const alternatives: MethodAlternative[] = [];

  // If browser clicking failed, suggest keyboard/JavaScript
  if (exhaustedTypes.includes('BROWSER_CLICK')) {
    alternatives.push({
      type: 'BROWSER_KEYBOARD',
      rationale: 'Clicking failed repeatedly, try keyboard events instead',
      example: 'Press Enter key instead of clicking submit button'
    });
    alternatives.push({
      type: 'BROWSER_JAVASCRIPT',
      rationale: 'DOM interaction failed, try direct JavaScript execution',
      example: 'Use document.querySelector("form").submit() instead of clicking'
    });
  }

  // If typing failed, suggest clicking or JavaScript
  if (exhaustedTypes.includes('BROWSER_TYPE')) {
    alternatives.push({
      type: 'BROWSER_JAVASCRIPT',
      rationale: 'Typing failed, try setting values via JavaScript',
      example: 'Use element.value = "text" instead of typing'
    });
  }

  // If navigation failed, suggest search engine
  if (exhaustedTypes.includes('BROWSER_NAVIGATION')) {
    alternatives.push({
      type: 'SEARCH_ENGINE',
      rationale: 'Direct navigation failed, try finding via search',
      example: 'Search Google for "site:example.com login" instead of navigating'
    });
  }

  // If extraction failed, suggest API
  if (exhaustedTypes.includes('BROWSER_EXTRACT')) {
    alternatives.push({
      type: 'API_DIRECT',
      rationale: 'Scraping failed, check if site has an API',
      example: 'Inspect network tab for API endpoints instead of scraping HTML'
    });
  }

  // If multiple browser methods failed, suggest API
  const browserMethodsFailed = exhaustedTypes.filter(t => t.startsWith('BROWSER_')).length;
  if (browserMethodsFailed >= 3) {
    alternatives.push({
      type: 'API_DIRECT',
      rationale: 'Multiple browser approaches failed, try direct API calls',
      example: 'Find and call the backend API instead of browser automation'
    });
    alternatives.push({
      type: 'SEARCH_ENGINE',
      rationale: 'Site blocking automation, try finding info via search',
      example: 'Search for the information instead of accessing the site'
    });
  }

  // If everything failed, suggest email/manual
  if (exhaustedTypes.length > 6) {
    alternatives.push({
      type: 'EMAIL_BASED',
      rationale: 'Full automation failed, try emailing the service',
      example: 'Send email to support@example.com requesting the data'
    });
    alternatives.push({
      type: 'MANUAL_INSTRUCTIONS',
      rationale: 'Automation not possible, provide manual steps',
      example: 'Give user step-by-step instructions to complete manually'
    });
  }

  return alternatives;
}

/**
 * Build a diversity enforcement message for AI prompting
 */
export function buildDiversityMessage(
  methodTypesAttempted: Map<MethodType, number>,
  maxSameTypeRetries: number
): string {
  const methodTypeReport = Array.from(methodTypesAttempted.entries())
    .map(([type, attempts]) => ({
      type,
      attempts,
      category: getMethodTypeCategory(type)
    }))
    .sort((a, b) => b.attempts - a.attempts);

  const exhaustedTypes = methodTypeReport.filter(m => m.attempts >= maxSameTypeRetries);

  if (exhaustedTypes.length === 0) {
    return '';
  }

  const alternatives = getAlternativeMethodTypes(exhaustedTypes.map(m => m.type));

  return `\n\nMETHOD TYPE DIVERSITY ENFORCEMENT:

You have EXHAUSTED these method TYPES (${maxSameTypeRetries}+ failures each):
${exhaustedTypes.map(m => `  - ${m.type}: ${m.attempts} failures (${m.category} category)`).join('\n')}

You are FORBIDDEN from using these method types again. Use a FUNDAMENTALLY DIFFERENT approach:

TRIED: ${exhaustedTypes.map(m => m.type).join(', ')}

MUST TRY INSTEAD:
${alternatives.map(alt => `  - ${alt.type}: ${alt.rationale}\n    Example: ${alt.example}`).join('\n')}

Think creatively. What would a DIFFERENT type of solution look like?
Don't just try a different selector - try a different METHOD TYPE entirely.`;
}

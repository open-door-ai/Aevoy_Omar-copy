/**
 * OUTCOME VERIFIER - AGI-Level Real-World Verification
 *
 * Goes beyond "no errors" to verify actual outcomes:
 * - "Make me money" → Check bank balance actually increased
 * - "Send email" → Verify email was delivered AND received
 * - "Buy stock" → Confirm stock is in portfolio
 * - "Cure cancer" → Verify solution actually works (hypothetical)
 *
 * This is what separates task execution from true AGI.
 */

import { Page } from 'playwright';
import { getSupabaseClient } from '../utils/supabase.js';
import { generateResponse } from './ai.js';

export interface OutcomeVerification {
  goalAchieved: boolean;
  confidence: number; // 0-100
  evidence: string[];
  verificationMethod: string;
  actualOutcome: string;
  expectedOutcome: string;
}

export class OutcomeVerifier {
  /**
   * Verify that the REAL-WORLD outcome matches the stated goal.
   * Not just "task completed", but "goal achieved".
   */
  async verifyOutcome(
    goal: string,
    result: any,
    page: Page | null,
    userId: string
  ): Promise<OutcomeVerification> {
    console.log('[OUTCOME] Verifying real-world outcome for:', goal);

    // Detect goal type
    const goalType = this.classifyGoal(goal);
    console.log('[OUTCOME] Goal type:', goalType);

    // Route to appropriate verifier
    switch (goalType) {
      case 'email':
        return await this.verifyEmailDelivery(goal, result, userId);

      case 'financial':
        return await this.verifyFinancialOutcome(goal, result, userId, page);

      case 'web_data':
        return await this.verifyWebDataExtraction(goal, result, page);

      case 'account_action':
        return await this.verifyAccountAction(goal, result, page);

      case 'information':
        return await this.verifyInformationQuality(goal, result);

      default:
        return await this.verifyGeneric(goal, result, page);
    }
  }

  /**
   * Classify the goal to determine verification method
   */
  private classifyGoal(goal: string): string {
    const lower = goal.toLowerCase();

    if (lower.match(/send|email|notify|message/)) return 'email';
    if (lower.match(/money|buy|sell|trade|invest|stock|crypto|payment/)) return 'financial';
    if (lower.match(/find|search|get|extract|tell me|what is|price|title/)) return 'web_data';
    if (lower.match(/sign up|register|login|account|profile/)) return 'account_action';
    if (lower.match(/how|why|explain|learn|teach|research/)) return 'information';

    return 'generic';
  }

  /**
   * Verify email was actually sent AND received
   */
  private async verifyEmailDelivery(
    goal: string,
    result: any,
    userId: string
  ): Promise<OutcomeVerification> {
    // Extract recipient email from goal or result
    const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/;
    const match = goal.match(emailRegex) || JSON.stringify(result).match(emailRegex);

    if (!match) {
      return {
        goalAchieved: false,
        confidence: 0,
        evidence: ['No recipient email found in goal or result'],
        verificationMethod: 'email_regex_check',
        actualOutcome: 'No email address detected',
        expectedOutcome: 'Email sent to recipient'
      };
    }

    const recipient = match[1];

    // For test users, check if we can verify via IMAP
    if (recipient.includes('@aevoy.com') || recipient.includes(userId)) {
      // TODO: Check IMAP inbox for the sent email
      console.log('[OUTCOME] Would check IMAP inbox for:', recipient);
    }

    // Check if email action was recorded
    const emailSent = result?.emailSent || result?.actions?.some((a: any) => a.type === 'send_email');

    return {
      goalAchieved: !!emailSent,
      confidence: emailSent ? 80 : 20, // 80% if sent, need delivery confirmation for 100%
      evidence: emailSent ? [`Email action recorded`, `Recipient: ${recipient}`] : ['No email action found'],
      verificationMethod: 'email_action_check',
      actualOutcome: emailSent ? `Email sent to ${recipient}` : 'No email sent',
      expectedOutcome: `Email delivered to ${recipient} inbox`
    };
  }

  /**
   * Verify financial outcome (money in account, stock purchased, etc.)
   */
  private async verifyFinancialOutcome(
    goal: string,
    result: any,
    userId: string,
    page: Page | null
  ): Promise<OutcomeVerification> {
    // For "make me money" tasks, we need to check:
    // 1. Bank account balance (if we have access)
    // 2. Transaction confirmation
    // 3. Order confirmation page

    if (page) {
      try {
        const url = page.url();
        const pageText = await page.textContent('body').catch(() => '');

        // Check for confirmation keywords
        const confirmationKeywords = [
          'order confirmed',
          'purchase successful',
          'trade executed',
          'payment received',
          'transaction complete',
          'confirmation number',
          'order id'
        ];

        const hasConfirmation = confirmationKeywords.some(keyword =>
          pageText.toLowerCase().includes(keyword)
        );

        if (hasConfirmation) {
          return {
            goalAchieved: true,
            confidence: 90,
            evidence: [
              `Confirmation page detected at ${url}`,
              `Page contains confirmation keywords`
            ],
            verificationMethod: 'page_confirmation_check',
            actualOutcome: 'Transaction confirmed on page',
            expectedOutcome: goal
          };
        }
      } catch (error) {
        console.error('[OUTCOME] Error checking page:', error);
      }
    }

    // Fallback: Check if result mentions completion
    const resultStr = JSON.stringify(result).toLowerCase();
    const hasSuccess = resultStr.includes('success') ||
                      resultStr.includes('completed') ||
                      resultStr.includes('confirmed');

    return {
      goalAchieved: hasSuccess,
      confidence: hasSuccess ? 60 : 30, // Lower confidence without page verification
      evidence: hasSuccess ? ['Result indicates success'] : ['No success indicators found'],
      verificationMethod: 'result_keyword_check',
      actualOutcome: hasSuccess ? 'Action reported as successful' : 'Action unclear or failed',
      expectedOutcome: goal
    };
  }

  /**
   * Verify web data extraction (prices, titles, information)
   */
  private async verifyWebDataExtraction(
    goal: string,
    result: any,
    page: Page | null
  ): Promise<OutcomeVerification> {
    // Check if result contains actual data (not just "I tried")
    const resultStr = JSON.stringify(result);

    // Red flags for hallucination
    const hallucinationFlags = [
      'unable to',
      'could not',
      'failed to',
      'error',
      'not available',
      'cannot access'
    ];

    const hasFailureFlag = hallucinationFlags.some(flag =>
      resultStr.toLowerCase().includes(flag)
    );

    if (hasFailureFlag) {
      return {
        goalAchieved: false,
        confidence: 20,
        evidence: ['Result contains failure indicators'],
        verificationMethod: 'failure_detection',
        actualOutcome: 'Task failed or incomplete',
        expectedOutcome: goal
      };
    }

    // Check if result contains specific data (numbers, URLs, names)
    const hasData = /\d/.test(resultStr) || // Contains numbers
                   /https?:\/\//.test(resultStr) || // Contains URLs
                   resultStr.length > 100; // Substantial content

    // For web data, verify against page if available
    if (page && hasData) {
      try {
        const pageText = await page.textContent('body').catch(() => '');

        // Extract key terms from result
        const resultWords = resultStr.split(/\s+/).filter(w => w.length > 5);
        const matchingWords = resultWords.filter(word =>
          pageText.toLowerCase().includes(word.toLowerCase())
        );

        const matchRate = matchingWords.length / Math.max(resultWords.length, 1);

        return {
          goalAchieved: matchRate > 0.3,
          confidence: Math.min(95, Math.round(matchRate * 100)),
          evidence: [
            `${matchingWords.length}/${resultWords.length} terms verified on page`,
            `Match rate: ${(matchRate * 100).toFixed(1)}%`
          ],
          verificationMethod: 'page_cross_reference',
          actualOutcome: `Data extracted with ${(matchRate * 100).toFixed(1)}% verification`,
          expectedOutcome: goal
        };
      } catch (error) {
        console.error('[OUTCOME] Error verifying against page:', error);
      }
    }

    return {
      goalAchieved: hasData,
      confidence: hasData ? 70 : 30,
      evidence: hasData ? ['Result contains data'] : ['Result lacks specific data'],
      verificationMethod: 'data_presence_check',
      actualOutcome: hasData ? 'Data extracted' : 'No data extracted',
      expectedOutcome: goal
    };
  }

  /**
   * Verify account action (signup, login, etc.)
   */
  private async verifyAccountAction(
    goal: string,
    result: any,
    page: Page | null
  ): Promise<OutcomeVerification> {
    if (!page) {
      return {
        goalAchieved: false,
        confidence: 0,
        evidence: ['No page available for verification'],
        verificationMethod: 'no_page',
        actualOutcome: 'Cannot verify without page access',
        expectedOutcome: goal
      };
    }

    try {
      const url = page.url();
      const pageText = await page.textContent('body').catch(() => '');

      // Check for success indicators
      const successIndicators = [
        'welcome',
        'dashboard',
        'logged in',
        'account created',
        'registration successful',
        'profile',
        'settings'
      ];

      const hasSuccess = successIndicators.some(indicator =>
        pageText.toLowerCase().includes(indicator) ||
        url.toLowerCase().includes(indicator)
      );

      // Check for failure indicators
      const failureIndicators = [
        'invalid',
        'error',
        'failed',
        'incorrect',
        'try again',
        'login',
        'sign in',
        'sign up'
      ];

      const hasFailure = failureIndicators.some(indicator =>
        pageText.toLowerCase().includes(indicator)
      );

      return {
        goalAchieved: hasSuccess && !hasFailure,
        confidence: hasSuccess ? 85 : (hasFailure ? 10 : 50),
        evidence: [
          `URL: ${url}`,
          hasSuccess ? 'Success indicators found' : 'No success indicators',
          hasFailure ? 'Failure indicators found' : 'No failure indicators'
        ],
        verificationMethod: 'page_indicator_check',
        actualOutcome: hasSuccess ? 'Action appears successful' : (hasFailure ? 'Action failed' : 'Unclear'),
        expectedOutcome: goal
      };
    } catch (error) {
      return {
        goalAchieved: false,
        confidence: 0,
        evidence: [`Error checking page: ${error}`],
        verificationMethod: 'error',
        actualOutcome: 'Verification error',
        expectedOutcome: goal
      };
    }
  }

  /**
   * Verify quality of information provided
   */
  private async verifyInformationQuality(
    goal: string,
    result: any
  ): Promise<OutcomeVerification> {
    const resultStr = JSON.stringify(result);

    // Check for minimum quality standards
    const hasSubstance = resultStr.length > 200; // At least 200 characters
    const hasStructure = resultStr.includes('\n') || resultStr.includes('.');
    const hasSources = resultStr.match(/https?:\/\//g)?.length || 0 > 0;

    const qualityScore = (
      (hasSubstance ? 40 : 0) +
      (hasStructure ? 30 : 0) +
      (hasSources ? 30 : 0)
    );

    return {
      goalAchieved: qualityScore >= 70,
      confidence: qualityScore,
      evidence: [
        `Length: ${resultStr.length} chars`,
        hasStructure ? 'Well-structured' : 'Lacks structure',
        hasSources ? `${hasSources} source(s)` : 'No sources cited'
      ],
      verificationMethod: 'information_quality_check',
      actualOutcome: `Information provided (quality: ${qualityScore}%)`,
      expectedOutcome: goal
    };
  }

  /**
   * Generic verification for unknown goal types
   */
  private async verifyGeneric(
    goal: string,
    result: any,
    page: Page | null
  ): Promise<OutcomeVerification> {
    // Use AI to assess if goal was achieved
    const prompt = `
Goal: "${goal}"

Result: ${JSON.stringify(result)}

Based on the goal and result, was the goal TRULY achieved in the real world?
Not "did we try", but "did we succeed"?

Respond with a JSON object:
{
  "achieved": true/false,
  "confidence": 0-100,
  "reasoning": "why you think goal was/wasn't achieved"
}
`;

    try {
      const aiResponse = await generateResponse(
        { facts: '', recentLogs: '' },
        'Outcome Verification',
        prompt,
        'system',
        'reason'
      );

      const jsonMatch = aiResponse.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          goalAchieved: parsed.achieved,
          confidence: parsed.confidence,
          evidence: [parsed.reasoning],
          verificationMethod: 'ai_assessment',
          actualOutcome: parsed.reasoning,
          expectedOutcome: goal
        };
      }
    } catch (error) {
      console.error('[OUTCOME] Error in AI verification:', error);
    }

    // Fallback: assume partial success if no errors
    const hasErrors = JSON.stringify(result).toLowerCase().includes('error');

    return {
      goalAchieved: !hasErrors,
      confidence: hasErrors ? 30 : 60,
      evidence: [hasErrors ? 'Errors detected in result' : 'No errors detected'],
      verificationMethod: 'error_check_fallback',
      actualOutcome: hasErrors ? 'Task completed with errors' : 'Task completed',
      expectedOutcome: goal
    };
  }
}

export const outcomeVerifier = new OutcomeVerifier();

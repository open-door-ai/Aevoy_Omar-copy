/**
 * Autonomous Executor - Iterative Observe-Plan-Act Loop
 *
 * Simplified version for Omar's Personal AI Assistant.
 * Executes tasks with max 5 iterations, 20-minute timeout.
 */
import { executeClick } from './actions/click.js';
import { executeFill } from './actions/fill.js';
import { executeNavigate } from './actions/navigate.js';
export class AutonomousExecutor {
    state = null;
    startTime = 0;
    async execute(page, plan) {
        this.startTime = Date.now();
        if (!page) {
            return this.returnResult(false, 'Browser not available');
        }
        this.state = {
            plan,
            currentStepIndex: 0,
            attemptCount: 0,
            result: {},
        };
        console.log(`[EXECUTOR] Starting: ${plan.goal}`);
        console.log(`[EXECUTOR] ${plan.steps.length} steps`);
        try {
            // Execute all steps sequentially
            for (let i = 0; i < plan.steps.length; i++) {
                const step = plan.steps[i];
                this.state.currentStepIndex = i;
                console.log(`[EXECUTOR] Step ${step.order}: ${step.type} - ${step.description}`);
                const result = await this.executeStep(step, page);
                if (result.success) {
                    console.log(`[EXECUTOR] ✓ Step complete`);
                    if (result.data) {
                        this.state.result = { ...this.state.result, ...result.data };
                    }
                }
                else {
                    console.log(`[EXECUTOR] ✗ Step failed: ${result.error}`);
                    // Try one retry
                    this.state.attemptCount++;
                    await page.waitForTimeout(2000);
                    const retry = await this.executeStep(step, page);
                    if (retry.success) {
                        console.log(`[EXECUTOR] ✓ Retry succeeded`);
                        if (retry.data) {
                            this.state.result = { ...this.state.result, ...retry.data };
                        }
                    }
                    else if (!step.canSkip) {
                        return this.returnResult(false, `Step '${step.type}' failed: ${retry.error}`);
                    }
                }
            }
            // Build final result
            this.state.result = {
                goal: plan.goal,
                stepsCompleted: this.state.currentStepIndex + 1,
                finalUrl: page.url(),
                title: await page.title().catch(() => ''),
                ...this.state.result,
            };
            return this.returnResult(true, undefined, this.state.result);
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            return this.returnResult(false, errorMsg);
        }
    }
    async executeStep(step, page) {
        try {
            switch (step.type) {
                case 'navigate':
                    if (!step.target) {
                        throw new Error(`Navigate step missing URL`);
                    }
                    const navResult = await executeNavigate(page, { url: step.target });
                    return { success: navResult.success, error: navResult.error };
                case 'login':
                    // Would need credentials from vault
                    return { success: false, error: 'Login not implemented yet' };
                case 'fill':
                    if (!step.target || !step.value) {
                        throw new Error(`Fill step missing target or value`);
                    }
                    const fillResult = await executeFill(page, {
                        selector: step.target,
                        value: step.value,
                    });
                    return { success: fillResult.success, error: fillResult.error };
                case 'click':
                    if (!step.target) {
                        throw new Error(`Click step missing target`);
                    }
                    const clickResult = await executeClick(page, {
                        selector: step.target,
                    });
                    return { success: clickResult.success, error: clickResult.error };
                case 'wait':
                    await page.waitForTimeout(2000);
                    return { success: true };
                case 'extract':
                    console.log(`[EXECUTOR] Extracting content from page`);
                    const content = await page.evaluate(() => {
                        const h1 = document.querySelector('h1');
                        if (h1)
                            return { heading: h1.textContent?.trim(), fullText: document.body.innerText.slice(0, 500) };
                        const p = document.querySelector('p');
                        return {
                            heading: document.title,
                            firstParagraph: p?.textContent?.trim(),
                            fullText: document.body.innerText.slice(0, 500)
                        };
                    });
                    console.log(`[EXECUTOR] Extracted:`, content);
                    return { success: true, data: { extracted: content } };
                case 'screenshot':
                    const buffer = await page.screenshot({ type: 'png' });
                    const base64 = buffer.toString('base64');
                    return { success: true, data: { screenshot: base64 } };
                default:
                    throw new Error(`Unknown step type: ${step.type}`);
            }
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
    returnResult(success, error, result) {
        return {
            success,
            completed: success,
            result,
            error,
            stepsExecuted: this.state?.currentStepIndex ? this.state.currentStepIndex + 1 : 0,
            durationMs: Date.now() - this.startTime,
            attempts: this.state?.attemptCount || 0,
        };
    }
}
export function createAutonomousExecutor() {
    return new AutonomousExecutor();
}
//# sourceMappingURL=autonomous-executor.js.map
/**
 * Planning Service - Simplified for Omar's Personal AI Assistant
 *
 * Generates execution plans from task descriptions.
 */
/**
 * Generate a simple execution plan from a task description.
 * In the future, this will use AI to generate better plans.
 */
export async function generateExecutionPlan(taskDescription) {
    const taskId = crypto.randomUUID();
    // Simple keyword-based plan generation
    const lower = taskDescription.toLowerCase();
    const steps = [];
    let order = 1;
    // Extract URL if present
    const urlMatch = taskDescription.match(/https?:\/\/[^\s]+|www\.[^\s]+|\b[a-z0-9-]+\.(com|org|net|io|ai)\b/i);
    if (urlMatch) {
        let url = urlMatch[0];
        if (!url.startsWith('http')) {
            url = `https://${url}`;
        }
        steps.push({
            order: order++,
            type: 'navigate',
            description: `Navigate to ${url}`,
            target: url,
            expectedOutcome: 'Page loaded',
            canSkip: false,
        });
    }
    // Check for extraction/research tasks
    if (lower.includes('find') || lower.includes('get') || lower.includes('extract') || lower.includes('what is')) {
        steps.push({
            order: order++,
            type: 'extract',
            description: 'Extract page content',
            expectedOutcome: 'Content extracted',
            canSkip: false,
        });
    }
    // Check for screenshot requests
    if (lower.includes('screenshot') || lower.includes('capture')) {
        steps.push({
            order: order++,
            type: 'screenshot',
            description: 'Take screenshot',
            expectedOutcome: 'Screenshot captured',
            canSkip: false,
        });
    }
    // If no steps generated, add a basic extract step
    if (steps.length === 0) {
        steps.push({
            order: 1,
            type: 'extract',
            description: 'Extract page content',
            expectedOutcome: 'Content extracted',
            canSkip: false,
        });
    }
    return {
        taskId,
        goal: taskDescription,
        steps,
    };
}
//# sourceMappingURL=planning.js.map
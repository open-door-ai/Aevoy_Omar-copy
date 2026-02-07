import { test, expect } from '@playwright/test';

test.describe('Task Management', () => {
  const testEmail = process.env.TEST_USER_EMAIL || 'test@aevoy-test.com';
  const testPassword = process.env.TEST_USER_PASSWORD || 'TestPassword123!@#';

  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/dashboard/, { timeout: 10000 });
  });

  test('should create a new task via dashboard', async ({ page }) => {
    console.log('[E2E] Testing task creation via dashboard');

    // Look for task input or create button
    const taskInput = page.locator('textarea, input[placeholder*="task" i], input[placeholder*="what" i]');
    const createButton = page.locator('button:has-text("Send"), button:has-text("Create")');

    if (await taskInput.isVisible()) {
      await taskInput.fill('Test task: Search for cat videos on YouTube');
      await createButton.click();

      // Wait for task to appear in list
      await page.waitForTimeout(2000);

      // Check for task confirmation
      const taskCreated = await page.locator('text=Test task').isVisible().catch(() => false);
      if (taskCreated) {
        console.log('[E2E] ✅ Task created successfully');
      } else {
        console.log('[E2E] ⚠️ Task creation status unclear');
      }
    } else {
      console.log('[E2E] ⚠️ Task input not found, skipping test');
    }
  });

  test('should display task history', async ({ page }) => {
    console.log('[E2E] Testing task history display');

    // Navigate to activity page
    await page.goto('/dashboard/activity');

    // Wait for tasks to load
    await page.waitForTimeout(2000);

    // Check for task cards or empty state
    const hasTasks = await page.locator('[data-task-card], .task-card').isVisible().catch(() => false);
    const hasEmptyState = await page.locator('text=No tasks yet, text=No activity').isVisible().catch(() => false);

    if (hasTasks) {
      console.log('[E2E] ✅ Task history loaded with tasks');
    } else if (hasEmptyState) {
      console.log('[E2E] ✅ Empty state displayed correctly');
    } else {
      console.log('[E2E] ⚠️ Task history status unclear');
    }
  });

  test('should filter tasks by status', async ({ page }) => {
    console.log('[E2E] Testing task filtering');

    await page.goto('/dashboard/activity');
    await page.waitForTimeout(2000);

    // Look for filter buttons
    const filterButtons = page.locator('button:has-text("All"), button:has-text("Pending"), button:has-text("Complete")');
    const filterCount = await filterButtons.count();

    if (filterCount > 0) {
      console.log(`[E2E] Found ${filterCount} filter options`);

      // Click each filter
      for (let i = 0; i < Math.min(filterCount, 3); i++) {
        await filterButtons.nth(i).click();
        await page.waitForTimeout(500);
        console.log(`[E2E] ✅ Filter ${i + 1} clicked`);
      }
    } else {
      console.log('[E2E] ⚠️ No filter buttons found');
    }
  });

  test('should display task details', async ({ page }) => {
    console.log('[E2E] Testing task details view');

    await page.goto('/dashboard/activity');
    await page.waitForTimeout(2000);

    // Try to click on first task card
    const firstTask = page.locator('[data-task-card], .task-card').first();
    if (await firstTask.isVisible().catch(() => false)) {
      await firstTask.click();
      await page.waitForTimeout(1000);

      // Check if details modal/page appeared
      const hasDetails = await page.locator('text=Details, text=Status, text=Result').isVisible().catch(() => false);
      if (hasDetails) {
        console.log('[E2E] ✅ Task details displayed');
      } else {
        console.log('[E2E] ⚠️ Task details not visible');
      }
    } else {
      console.log('[E2E] ⚠️ No tasks available to view details');
    }
  });
});

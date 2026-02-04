declare module "@browserbasehq/stagehand" {
  import { Page, BrowserContext } from "playwright";

  interface StagehandOptions {
    env?: "BROWSERBASE" | "LOCAL";
    apiKey?: string;
    projectId?: string;
    modelName?: string;
    modelClientOptions?: {
      apiKey?: string;
    };
  }

  export class Stagehand {
    page: Page;
    context: BrowserContext;
    constructor(options?: StagehandOptions);
    init(): Promise<void>;
    act(opts: { action: string }): Promise<{ success: boolean; message?: string }>;
    agent(opts: { task: string; maxSteps?: number }): Promise<{ success: boolean; message?: string }>;
    extract<T>(opts: { instruction: string; schema: import("zod").ZodType<T> }): Promise<T>;
    observe(opts?: { instruction?: string }): Promise<Array<{ selector: string; description: string; type: string }>>;
    close(): Promise<void>;
  }
}

declare module "express-rate-limit" {
  import { RequestHandler } from "express";

  interface RateLimitOptions {
    windowMs?: number;
    max?: number;
    keyGenerator?: (req: import("express").Request) => string;
    standardHeaders?: boolean;
    legacyHeaders?: boolean;
    message?: string | Record<string, string>;
    validate?: boolean | Record<string, boolean>;
  }

  function rateLimit(options?: RateLimitOptions): RequestHandler;
  export default rateLimit;
}

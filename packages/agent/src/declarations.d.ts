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

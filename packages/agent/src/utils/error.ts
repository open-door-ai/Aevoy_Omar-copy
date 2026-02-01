export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number = 500,
    code: string = "internal_error",
    isOperational: boolean = true
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;

    // Maintains proper stack trace for where our error was thrown
    Error.captureStackTrace(this, this.constructor);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = "Unauthorized") {
    super(message, 401, "unauthorized");
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = "Forbidden") {
    super(message, 403, "forbidden");
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = "Not found") {
    super(message, 404, "not_found");
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = "Too many requests") {
    super(message, 429, "rate_limited");
  }
}

export class OverQuotaError extends AppError {
  constructor(message: string = "Message limit reached") {
    super(message, 402, "over_quota");
  }
}

// Error response formatter
export function formatErrorResponse(error: unknown): {
  error: string;
  message: string;
  statusCode: number;
} {
  if (error instanceof AppError) {
    return {
      error: error.code,
      message: error.message,
      statusCode: error.statusCode,
    };
  }

  // For unknown errors, don't expose internal details
  console.error("Unhandled error:", error);
  
  return {
    error: "internal_error",
    message: "An unexpected error occurred",
    statusCode: 500,
  };
}

// Safe logger that strips sensitive data
export function logEvent(
  event: string,
  data: Record<string, unknown>
): void {
  // Fields that should never be logged
  const sensitiveFields = [
    "password",
    "email_body",
    "body",
    "content",
    "api_key",
    "secret",
    "token",
  ];

  const sanitizedData: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = sensitiveFields.some(
      (field) => lowerKey.includes(field)
    );

    if (isSensitive) {
      sanitizedData[key] = "[REDACTED]";
    } else if (typeof value === "string" && value.length > 100) {
      sanitizedData[key] = value.substring(0, 100) + "...";
    } else {
      sanitizedData[key] = value;
    }
  }

  console.log(JSON.stringify({ event, ...sanitizedData, timestamp: new Date().toISOString() }));
}

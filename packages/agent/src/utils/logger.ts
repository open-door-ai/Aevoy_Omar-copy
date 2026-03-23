import pino from 'pino';
import { randomUUID } from 'crypto';

export const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV === 'development' ? {
        target: 'pino-pretty',
        options: { colorize: true }
    } : undefined,
    base: {
        service: 'aurora-agent',
    },
});

// Create a child logger with correlation ID for request tracing
export function createRequestLogger(correlationId?: string) {
    return logger.child({
        correlationId: correlationId || randomUUID()
    });
}

export type Logger = pino.Logger;

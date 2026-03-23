import pino from 'pino';
import { randomUUID } from 'crypto';

const pinoInstance = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV === 'development' ? {
        target: 'pino-pretty',
        options: { colorize: true }
    } : undefined,
    base: {
        service: 'aurora-agent',
    },
});

/**
 * Console-compatible logger wrapper around Pino.
 * Supports both Pino-style `logger.info({ key }, 'msg')` and
 * console-style `logger.info('msg', extra1, extra2)` calls.
 */
function wrapLevel(level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal') {
    return (...args: unknown[]): void => {
        if (args.length === 0) return;
        // Pino-native call: first arg is object, second is string
        if (args.length >= 1 && typeof args[0] === 'object' && args[0] !== null && !(args[0] instanceof Error)) {
            (pinoInstance[level] as Function).apply(pinoInstance, args);
            return;
        }
        // Console-style: logger.error('msg', error) or logger.info('msg', obj)
        if (args.length === 1) {
            if (typeof args[0] === 'string') {
                pinoInstance[level](args[0]);
            } else {
                pinoInstance[level]({ data: args[0] }, String(args[0]));
            }
            return;
        }
        // Multiple args: first is string message, rest are context
        const msg = String(args[0]);
        const extra = args.slice(1);
        if (extra.length === 1) {
            const val = extra[0];
            if (val instanceof Error) {
                pinoInstance[level]({ err: val }, msg);
            } else if (typeof val === 'object' && val !== null) {
                pinoInstance[level](val as object, msg);
            } else {
                pinoInstance[level]({ extra: val }, msg);
            }
        } else {
            pinoInstance[level]({ extra }, msg);
        }
    };
}

export const logger = {
    trace: wrapLevel('trace'),
    debug: wrapLevel('debug'),
    info: wrapLevel('info'),
    warn: wrapLevel('warn'),
    error: wrapLevel('error'),
    fatal: wrapLevel('fatal'),
    child: pinoInstance.child.bind(pinoInstance),
    level: pinoInstance.level,
};

// Create a child logger with correlation ID for request tracing
export function createRequestLogger(correlationId?: string) {
    return pinoInstance.child({
        correlationId: correlationId || randomUUID()
    });
}

export type Logger = typeof logger;

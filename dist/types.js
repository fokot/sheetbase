export class SheetbaseError extends Error {
    code;
    retryable;
    constructor(code, message, retryable = false) {
        super(message);
        this.code = code;
        this.retryable = retryable;
        this.name = 'SheetbaseError';
    }
}
export function asError(error, fallback = 'network') {
    return error instanceof SheetbaseError ? error : new SheetbaseError(fallback, error instanceof Error ? error.message : 'Unexpected error.', fallback === 'network');
}
//# sourceMappingURL=types.js.map
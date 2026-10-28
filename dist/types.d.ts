export type ErrorCode = 'auth-required' | 'offline' | 'schema' | 'storage' | 'network' | 'closed' | 'invalid-value' | 'unsupported';
export declare class SheetbaseError extends Error {
    readonly code: ErrorCode;
    readonly retryable: boolean;
    constructor(code: ErrorCode, message: string, retryable?: boolean);
}
export interface Column<T> {
    readonly header: string;
    readonly codec: string;
    encode(value: T | null): string;
    decode(value: string): T | null;
}
export type Columns = Record<string, Column<any>>;
export type Values<C extends Columns> = {
    [K in keyof C]: C[K] extends Column<infer T> ? T | null : never;
};
export interface Row<C extends Columns> {
    key: string;
    values: Values<C>;
}
export type RawValues = Record<string, string>;
export type RawRows = Record<string, RawValues>;
export interface TableDefinition<C extends Columns> {
    spreadsheetId: string;
    sheet: string;
    /** The first column (A). Its values must be unique, non-empty strings. */
    keyColumn: string;
    columns: C;
}
export interface Target {
    accountId: string;
    spreadsheetId: string;
    sheet: string;
    keyColumn: string;
    headers: string[];
    fingerprint: string;
}
export interface Operation {
    id: string;
    key: string;
    values: RawValues;
}
export interface Batch {
    id: string;
    operationIds: string[];
}
export interface StoredTable {
    version: 1;
    key: string;
    target: Target;
    revision: number;
    initialized: boolean;
    base: RawRows;
    operations: Operation[];
    batch: Batch | null;
    syncedAt: number | null;
    error: {
        code: ErrorCode;
        message: string;
    } | null;
}
export interface Storage {
    readonly kind: 'memory' | 'indexeddb';
    read(key: string): Promise<StoredTable | null>;
    update(key: string, change: (record: StoredTable | null) => StoredTable): Promise<StoredTable>;
    subscribe(listener: (key: string) => void): () => void;
    /** Must coordinate clients using this storage, including browser tabs. */
    withLock<T>(name: string, task: () => Promise<T>): Promise<T>;
    close(): void;
}
export type Guard = () => void;
export interface Remote {
    initialize(target: Target, guard: Guard): Promise<void>;
    read(target: Target, guard: Guard): Promise<RawRows>;
    commit(target: Target, operations: Operation[], batchId: string, guard: Guard): Promise<void>;
}
export interface Credentials {
    accountId: string;
    accessToken: string;
}
export type Phase = 'opening' | 'ready' | 'pending' | 'syncing' | 'offline' | 'auth-required' | 'error' | 'closed';
export interface Snapshot<C extends Columns> {
    phase: Phase;
    rows: Row<C>[];
    pending: number;
    syncedAt: number | null;
    error: {
        code: ErrorCode;
        message: string;
    } | null;
}
export interface ClientOptions {
    accountId: string;
    storage: Storage;
    remote: Remote;
    namespace?: string;
    autoSync?: boolean;
    debounceMs?: number;
    retry?: {
        attempts?: number;
        baseDelayMs?: number;
        maxDelayMs?: number;
    };
}
export declare function asError(error: unknown, fallback?: ErrorCode): SheetbaseError;
//# sourceMappingURL=types.d.ts.map
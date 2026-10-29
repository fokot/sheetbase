import { type Credentials, type Guard, type Operation, type RawRows, type Remote, type Target, type DynamicColumn } from './types.js';
export interface GoogleRemoteOptions {
    /** Return credentials already held in memory. Never open a popup here. */
    getCredentials: () => Credentials | Promise<Credentials>;
    fetch?: typeof fetch;
    timeoutMs?: number;
    /** Optional receipt tabs used by an earlier application, checked during cache migration. */
    legacyLedgers?: string[];
}
export declare function createGoogleSheetsRemote(options: GoogleRemoteOptions): Remote;
/** A deterministic backend for examples/tests. It never calls Google. */
export declare function createMemoryRemote(initial?: Record<string, RawRows>, savedReceipts?: Record<string, string[]>, savedSchemas?: Record<string, DynamicColumn[]>): {
    initialize(target: Target, guard: Guard): Promise<void>;
    readSchema(target: Target, guard: Guard): Promise<DynamicColumn[]>;
    read(target: Target, guard: Guard): Promise<RawRows>;
    commit(target: Target, operations: Operation[], batchId: string, guard: Guard): Promise<void>;
    setOnline(value: boolean): void;
    loseNextResponse(): void;
    inspect(target: Target): RawRows;
    stats(): {
        reads: number;
        writes: number;
    };
    checkpoint(): {
        tables: {
            [k: string]: RawRows;
        };
        schemas: {
            [k: string]: DynamicColumn[];
        };
        receipts: {
            [k: string]: string[];
        };
    };
};
//# sourceMappingURL=google.d.ts.map
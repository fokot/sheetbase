import { SheetbaseError, type ClientOptions, type Columns, type Row, type Snapshot, type StoredTable, type TableDefinition, type Target, type Values, type DynamicColumn, type Transaction } from './types.js';
export declare class SheetbaseClient {
    readonly accountId: string;
    readonly options: ClientOptions;
    private tables;
    private timers;
    private attempts;
    private generation;
    private active;
    private closed;
    private online;
    private cleanup;
    constructor(options: ClientOptions);
    table<C extends Columns>(definition: TableDefinition<C>): SheetTable<C>;
    guard(version?: number): void;
    capture(): () => void;
    available(): {
        online: boolean;
        active: boolean;
        closed: boolean;
    };
    requireConnection(): void;
    schedule(table: SheetTable<any>, retry?: boolean): void;
    cancelTimer(key: string): void;
    completed(table: SheetTable<any>, error?: SheetbaseError): void;
    private wake;
    setOnline(online: boolean): void;
    pause(): void;
    resume(): void;
    sync(): Promise<void>;
    dispose(): void;
}
export declare class SheetTable<C extends Columns> {
    readonly client: SheetbaseClient;
    readonly key: string;
    readonly target: Target;
    readonly definition: TableDefinition<C>;
    private record;
    private transient;
    private listeners;
    private tail;
    busy: boolean;
    constructor(client: SheetbaseClient, key: string, target: Target, definition: TableDefinition<C>);
    private publish;
    reload(): Promise<void>;
    private raw;
    private decode;
    columns(): DynamicColumn[];
    private codecs;
    all(): Row<C>[];
    get(key: string): Row<C> | undefined;
    pending(): number;
    snapshot(): Snapshot<C>;
    subscribe(listener: (snapshot: Snapshot<C>) => void): () => void;
    emit(): void;
    report(reason: unknown): void;
    private exclusive;
    open(options?: {
        create?: boolean;
        refresh?: boolean;
        cachedOnly?: boolean;
    }): Promise<Snapshot<C>>;
    transaction(change: (transaction: Transaction<C>) => void): Promise<void>;
    set(key: string, patch: Partial<Values<C>>): Promise<void>;
    delete(key: string): Promise<void>;
    addColumn(column: DynamicColumn): Promise<void>;
    renameColumn(id: string, header: string): Promise<void>;
    removeColumn(id: string): Promise<void>;
    export(): Promise<StoredTable | null>;
    refresh(options?: {
        create?: boolean;
    }): Promise<void>;
    sync(): Promise<void>;
}
export declare function createSheetbase(options: ClientOptions): SheetbaseClient;
//# sourceMappingURL=client.d.ts.map
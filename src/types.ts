export type ErrorCode = 'auth-required' | 'offline' | 'schema' | 'storage' | 'network' | 'closed' | 'invalid-value' | 'unsupported';
export class SheetbaseError extends Error {
  constructor(public readonly code: ErrorCode, message: string, public readonly retryable = false) { super(message); this.name = 'SheetbaseError'; }
}
export interface Column<T> {
  readonly header: string;
  readonly codec: string;
  encode(value: T | null): string;
  decode(value: string): T | null;
}
export type Columns = Record<string, Column<any>>;
export type Values<C extends Columns> = { [K in keyof C]: C[K] extends Column<infer T> ? T | null : never };
export interface Row<C extends Columns> { key: string; values: Values<C> }
export type RawValues = Record<string, string>;
export type RawRows = Record<string, RawValues>;
export interface TableDefinition<C extends Columns> {
  spreadsheetId: string;
  sheet: string;
  /** The first column (A). Its values must be unique, non-empty strings. */
  keyColumn: string;
  columns: C;
  /** Dynamic columns are discovered by stable IDs in a separate metadata tab. */
  dynamic?: { sheet: string; defaultType: string; codecs: Record<string, (header: string) => Column<any>> };
}
export interface DynamicColumn { id: string; header: string; type: string }
export type SchemaChange = { type: 'add'; column: DynamicColumn } | { type: 'rename'; id: string; header: string } | { type: 'remove'; id: string };
export interface TableState { rows: RawRows; columns: DynamicColumn[] }
export interface Transaction<C extends Columns> {
  readonly columns: DynamicColumn[];
  get(key: string): Row<C> | undefined;
  set(key: string, patch: Partial<Values<C>>): void;
  addColumn(column: DynamicColumn): void;
  renameColumn(id: string, header: string): void;
  removeColumn(id: string): void;
}
export interface Target {
  accountId: string; spreadsheetId: string; sheet: string; keyColumn: string;
  headers: string[]; fingerprint: string;
  dynamic?: { sheet: string; defaultType: string };
  columns?: DynamicColumn[];
}
export interface Operation { id: string; key: string; values: RawValues; schema?: SchemaChange; transaction?: string }
export interface Batch { id: string; operationIds: string[] }
export interface StoredTable {
  version: 1; key: string; target: Target; revision: number; initialized: boolean;
  base: RawRows; columns?: DynamicColumn[]; operations: Operation[]; batch: Batch | null;
  syncedAt: number | null; error: { code: ErrorCode; message: string } | null;
}
export interface Storage {
  readonly kind: 'memory' | 'indexeddb';
  read(key: string): Promise<StoredTable | null>;
  update(key: string, change: (record: StoredTable | null) => StoredTable): Promise<StoredTable>;
  subscribe(listener: (key: string) => void): () => void;
  /** Must coordinate clients using this storage, including browser tabs. */
  withLock<T>(name: string, task: () => Promise<T>): Promise<T>;
  list(): Promise<StoredTable[]>;
  close(): void;
}
export type Guard = () => void;
export interface Remote {
  initialize(target: Target, guard: Guard): Promise<void>;
  read(target: Target, guard: Guard): Promise<RawRows>;
  readSchema?(target: Target, guard: Guard): Promise<DynamicColumn[]>;
  commit(target: Target, operations: Operation[], batchId: string, guard: Guard): Promise<void | TableState>;
}
export interface Credentials { accountId: string; accessToken: string }
export type Phase = 'opening' | 'ready' | 'pending' | 'syncing' | 'offline' | 'auth-required' | 'error' | 'closed';
export interface Snapshot<C extends Columns> {
  phase: Phase; rows: Row<C>[]; columns: DynamicColumn[]; initialized: boolean; pending: number; syncedAt: number | null;
  error: { code: ErrorCode; message: string } | null;
}
export interface ClientOptions {
  accountId: string; storage: Storage; remote: Remote;
  namespace?: string; autoSync?: boolean; debounceMs?: number;
  retry?: { attempts?: number; baseDelayMs?: number; maxDelayMs?: number };
}
export function asError(error: unknown, fallback: ErrorCode = 'network'): SheetbaseError {
  return error instanceof SheetbaseError ? error : new SheetbaseError(fallback, error instanceof Error ? error.message : 'Unexpected error.', fallback === 'network');
}

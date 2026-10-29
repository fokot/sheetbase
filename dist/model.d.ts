import { type Operation, type RawRows, type StoredTable, type Target, type DynamicColumn, type TableState } from './types.js';
export declare const identity: (namespace: string, target: Target) => string;
export declare function emptyTable(key: string, target: Target): StoredTable;
export declare function assertRecord(record: StoredTable, target: Target): void;
export declare function apply(base: RawRows, operations: Operation[]): RawRows;
export declare function project(base: RawRows, columns: DynamicColumn[], operations: Operation[], dynamic?: boolean): TableState;
export declare function compact(operations: Operation[], protectedIds?: string[]): Operation[];
export declare function validateKey(key: string): void;
export declare function validateColumns(columns: DynamicColumn[], keyColumn?: string): void;
//# sourceMappingURL=model.d.ts.map
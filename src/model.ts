import { SheetbaseError, type Operation, type RawRows, type StoredTable, type Target, type DynamicColumn, type TableState } from './types.js';
export const identity = (namespace: string, target: Target) => JSON.stringify([namespace, target.accountId, target.spreadsheetId, target.sheet]);
export function emptyTable(key: string, target: Target): StoredTable {
  return { version: 1, key, target, revision: 0, initialized: false, base: {}, operations: [], batch: null, syncedAt: null, error: null };
}
export function assertRecord(record: StoredTable, target: Target) {
  if (record.version !== 1 || record.target.fingerprint !== target.fingerprint) throw new SheetbaseError('schema', 'The cached schema differs. Reopen with the original schema and sync/export pending changes before changing it.');
}
export function apply(base: RawRows, operations: Operation[]): RawRows {
  return project(base, [], operations).rows;
}
export function project(base: RawRows, columns: DynamicColumn[], operations: Operation[], dynamic = columns.length > 0): TableState {
  const rows = structuredClone(base);
  let schema = structuredClone(columns);
  for (const operation of operations) {
    if (operation.schema) {
      const change = operation.schema;
      if (change.type === 'add') {
        const existing = schema.find(column => column.id === change.column.id);
        if (existing && JSON.stringify(existing) !== JSON.stringify(change.column)) throw new SheetbaseError('schema', 'Column ID already exists.');
        if (!existing) schema.push(structuredClone(change.column));
      } else if (change.type === 'rename') {
        const column = schema.find(column => column.id === change.id);
        if (!column) throw new SheetbaseError('schema', 'Column no longer exists. Pending changes are retained.');
        column.header = change.header;
      } else { schema = schema.filter(column => column.id !== change.id); for (const [key, row] of Object.entries(rows)) { delete row[change.id]; if (!Object.values(row).some(Boolean)) delete rows[key]; } }
      validateColumns(schema); continue;
    }
    if (dynamic && Object.keys(operation.values).some(id => !schema.some(column => column.id === id))) throw new SheetbaseError('schema', 'An edited column no longer exists. Pending changes are retained.');
    const row = { ...rows[operation.key], ...operation.values };
    if (Object.values(row).some((value) => value !== '')) Object.defineProperty(rows, operation.key, { value: row, enumerable: true, writable: true, configurable: true });
    else delete rows[operation.key];
  }
  return { rows, columns: schema };
}
export function compact(operations: Operation[], protectedIds: string[] = []): Operation[] {
  const counts = new Map<string, number>();
  for (const operation of operations) if (operation.transaction) counts.set(operation.transaction, (counts.get(operation.transaction) ?? 0) + 1);
  const structuralTransactions = new Set(operations.filter(operation => operation.transaction && (operation.schema || counts.get(operation.transaction)! > 1)).map(operation => operation.transaction));
  const protectedSet = new Set(protectedIds), previous = new Map<string, number>(), result: (Operation | null)[] = [];
  for (const operation of operations) {
    if (operation.schema || (operation.transaction && structuralTransactions.has(operation.transaction)) || protectedSet.has(operation.id)) { previous.clear(); result.push(operation); continue; }
    const index = previous.get(operation.key), old = index === undefined ? null : result[index];
    if (index !== undefined) result[index] = null;
    previous.set(operation.key, result.length); result.push({ ...operation, values: { ...old?.values, ...operation.values } });
  }
  return result.filter((operation): operation is Operation => operation !== null);
}
export function validateKey(key: string) {
  if (typeof key !== 'string' || !key.trim() || key.length > 300) throw new SheetbaseError('invalid-value', 'Use a non-empty string key of at most 300 characters.');
}

export function validateColumns(columns: DynamicColumn[], keyColumn?: string) {
  const names = columns.map(column => column.header.trim().toLowerCase());
  if (columns.some(column => !column.id.trim() || !column.type.trim() || !column.header.trim() || column.header.length > 200)
    || new Set(columns.map(column => column.id)).size !== columns.length || new Set(names).size !== names.length
    || (keyColumn && names.includes(keyColumn.trim().toLowerCase()))) throw new SheetbaseError('schema', 'Column IDs and names must be distinct and non-empty.');
}

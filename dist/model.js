import { SheetbaseError } from './types.js';
export const identity = (namespace, target) => JSON.stringify([namespace, target.accountId, target.spreadsheetId, target.sheet]);
export function emptyTable(key, target) {
    return { version: 1, key, target, revision: 0, initialized: false, base: {}, operations: [], batch: null, syncedAt: null, error: null };
}
export function assertRecord(record, target) {
    if (record.version !== 1 || record.target.fingerprint !== target.fingerprint)
        throw new SheetbaseError('schema', 'The cached schema differs. Reopen with the original schema and sync/export pending changes before changing it.');
}
export function apply(base, operations) {
    const rows = structuredClone(base);
    for (const operation of operations) {
        const row = { ...rows[operation.key], ...operation.values };
        if (Object.values(row).some((value) => value !== ''))
            Object.defineProperty(rows, operation.key, { value: row, enumerable: true, writable: true, configurable: true });
        else
            delete rows[operation.key];
    }
    return rows;
}
export function compact(operations, protectedIds = []) {
    const protectedSet = new Set(protectedIds), previous = new Map(), result = [];
    for (const operation of operations) {
        if (protectedSet.has(operation.id)) {
            previous.clear();
            result.push(operation);
            continue;
        }
        const index = previous.get(operation.key), old = index === undefined ? null : result[index];
        if (index !== undefined)
            result[index] = null;
        previous.set(operation.key, result.length);
        result.push({ ...operation, values: { ...old?.values, ...operation.values } });
    }
    return result.filter((operation) => operation !== null);
}
export function validateKey(key) {
    if (typeof key !== 'string' || !key.trim() || key.length > 300)
        throw new SheetbaseError('invalid-value', 'Use a non-empty string key of at most 300 characters.');
}
//# sourceMappingURL=model.js.map
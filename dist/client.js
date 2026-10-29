import { assertRecord, compact, emptyTable, identity, validateKey, project, validateColumns } from './model.js';
import { asError, SheetbaseError } from './types.js';
export class SheetbaseClient {
    accountId;
    options;
    tables = new Map();
    timers = new Map();
    attempts = new Map();
    generation = 0;
    active = true;
    closed = false;
    online = typeof navigator === 'undefined' || navigator.onLine !== false;
    cleanup = [];
    constructor(options) {
        if (!options.accountId.trim())
            throw new SheetbaseError('invalid-value', 'A verified account ID is required.');
        this.accountId = options.accountId;
        this.options = options;
        const unsubscribe = options.storage.subscribe((key) => { const table = this.tables.get(key); if (table)
            void table.reload().then(() => this.schedule(table)).catch((error) => table.report(error)); });
        this.cleanup.push(unsubscribe);
        if (typeof window !== 'undefined') {
            const online = () => this.setOnline(navigator.onLine !== false), focus = () => { if (document.visibilityState === 'visible')
                this.wake(); };
            window.addEventListener('online', online);
            window.addEventListener('offline', online);
            window.addEventListener('focus', focus);
            document.addEventListener('visibilitychange', focus);
            this.cleanup.push(() => { window.removeEventListener('online', online); window.removeEventListener('offline', online); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); });
        }
    }
    table(definition) {
        this.guard();
        const entries = Object.entries(definition.columns), names = [definition.keyColumn, ...entries.map(([, column]) => column.header)];
        if (!definition.spreadsheetId.trim() || !definition.sheet.trim() || (!entries.length && !definition.dynamic) || names.some((name) => !name.trim()) || new Set(names.map((name) => name.toLowerCase())).size !== names.length)
            throw new SheetbaseError('schema', 'Provide a sheet, spreadsheet ID and distinct, non-empty column headers.');
        if (definition.dynamic && (!definition.dynamic.sheet.trim() || definition.dynamic.sheet === definition.sheet || definition.dynamic.sheet === '_Sheetbase' || !Object.prototype.hasOwnProperty.call(definition.dynamic.codecs, definition.dynamic.defaultType)))
            throw new SheetbaseError('schema', 'Dynamic tables need a separate metadata tab and a registered default codec.');
        const target = { accountId: this.accountId, spreadsheetId: definition.spreadsheetId, sheet: definition.sheet, keyColumn: definition.keyColumn, headers: entries.map(([, column]) => column.header), ...(definition.duplicateKeys ? { duplicateKeys: definition.duplicateKeys } : {}), fingerprint: JSON.stringify(definition.dynamic ? [definition.keyColumn, 'dynamic:v1', definition.dynamic.sheet, definition.dynamic.defaultType] : [definition.keyColumn, ...entries.map(([field, column]) => [field, column.header, column.codec])]), ...(definition.dynamic ? { dynamic: { sheet: definition.dynamic.sheet, defaultType: definition.dynamic.defaultType } } : {}) };
        const key = identity(this.options.namespace ?? 'sheetbase', target), existing = this.tables.get(key);
        if (existing) {
            if (existing.target.fingerprint !== target.fingerprint)
                throw new SheetbaseError('schema', 'This table is already registered with another schema.');
            return existing;
        }
        const table = new SheetTable(this, key, target, definition);
        this.tables.set(key, table);
        return table;
    }
    guard(version = this.generation) { if (this.closed || version !== this.generation)
        throw new SheetbaseError('closed', 'This operation belongs to a closed or replaced client session.'); }
    capture() { const version = this.generation; return () => this.guard(version); }
    available() { return { online: this.online, active: this.active, closed: this.closed }; }
    requireConnection() { this.guard(); if (!this.online)
        throw new SheetbaseError('offline', 'Offline. Pending edits remain saved.'); if (!this.active)
        throw new SheetbaseError('auth-required', 'Authorize this Google account and call resume().'); }
    schedule(table, retry = false) {
        const state = this.available();
        if (this.options.autoSync === false || !state.online || !state.active || state.closed || !table.pending() || table.busy || this.timers.has(table.key))
            return;
        const failures = this.attempts.get(table.key) ?? 0;
        if (!retry && table.snapshot().error)
            return;
        if (retry && failures >= (this.options.retry?.attempts ?? 4))
            return;
        const delay = retry ? Math.min(this.options.retry?.maxDelayMs ?? 30000, (this.options.retry?.baseDelayMs ?? 1000) * 2 ** failures) : this.options.debounceMs ?? 650;
        this.timers.set(table.key, setTimeout(() => { this.timers.delete(table.key); void table.sync().catch(() => { }); }, delay));
    }
    cancelTimer(key) { const timer = this.timers.get(key); if (timer)
        clearTimeout(timer); this.timers.delete(key); }
    completed(table, error) {
        if (!error) {
            this.attempts.delete(table.key);
            this.schedule(table);
        }
        else if (error.code === 'auth-required')
            this.pause();
        else if (error.retryable) {
            this.attempts.set(table.key, (this.attempts.get(table.key) ?? 0) + 1);
            this.schedule(table, true);
        }
    }
    wake() { for (const table of this.tables.values()) {
        this.attempts.delete(table.key);
        table.emit();
        this.schedule(table, !!table.snapshot().error);
    } }
    setOnline(online) { this.guard(); this.online = online; if (!online) {
        for (const key of this.timers.keys())
            this.cancelTimer(key);
    } this.wake(); }
    pause() { this.active = false; this.generation++; for (const key of this.timers.keys())
        this.cancelTimer(key); for (const table of this.tables.values())
        table.emit(); }
    resume() { this.guard(); this.active = true; this.generation++; this.wake(); }
    async sync() { this.requireConnection(); await Promise.all([...this.tables.values()].map((table) => table.sync())); }
    dispose() { if (this.closed)
        return; this.closed = true; this.generation++; for (const key of this.timers.keys())
        this.cancelTimer(key); for (const cleanup of this.cleanup)
        cleanup(); for (const table of this.tables.values())
        table.emit(); }
}
export class SheetTable {
    client;
    key;
    target;
    definition;
    record = null;
    transient = null;
    listeners = new Set();
    tail = Promise.resolve();
    busy = false;
    constructor(client, key, target, definition) {
        this.client = client;
        this.key = key;
        this.target = target;
        this.definition = definition;
    }
    publish(record) { assertRecord(record, this.target); if (!this.record || record.revision >= this.record.revision) {
        this.record = record;
        this.transient = null;
        this.emit();
    } }
    async reload() { const record = await this.client.options.storage.read(this.key); if (record)
        this.publish(record); }
    raw() { if (!this.record?.initialized)
        throw new SheetbaseError('schema', 'Open this table online once before reading or editing it.'); return project(this.record.base, this.record.columns ?? [], this.record.operations, !!this.target.dynamic).rows; }
    decode(key, values, columns = this.columns()) {
        return { key, values: Object.fromEntries(Object.entries(this.codecs(columns)).map(([field, column]) => [field, column.decode(values[this.definition.dynamic ? field : column.header] ?? '')])) };
    }
    columns() { return this.record ? project({}, this.record.columns ?? [], this.record.operations.filter(operation => operation.schema), !!this.target.dynamic).columns : []; }
    codecs(columns = this.columns()) {
        if (!this.definition.dynamic)
            return this.definition.columns;
        return Object.fromEntries(columns.map(column => {
            const factory = this.definition.dynamic.codecs[column.type];
            if (!Object.prototype.hasOwnProperty.call(this.definition.dynamic.codecs, column.type) || !factory)
                throw new SheetbaseError('schema', `Unknown column type: ${column.type}`);
            return [column.id, factory(column.header)];
        }));
    }
    all() { const columns = this.columns(); return Object.entries(this.raw()).map(([key, values]) => this.decode(key, values, columns)); }
    get(key) { const values = this.raw(); return Object.prototype.hasOwnProperty.call(values, key) ? this.decode(key, values[key]) : undefined; }
    pending() { return this.record?.operations.length ?? 0; }
    snapshot() {
        const state = this.client.available(), error = this.transient ?? this.record?.error ?? null;
        const phase = state.closed ? 'closed' : !state.online ? 'offline' : !state.active ? 'auth-required' : this.busy ? 'syncing' : error ? 'error' : !this.record?.initialized ? 'opening' : this.pending() ? 'pending' : 'ready';
        return { phase, columns: this.columns(), initialized: this.record?.initialized ?? false, rows: this.record?.initialized ? this.all() : [], pending: this.pending(), syncedAt: this.record?.syncedAt ?? null, error };
    }
    subscribe(listener) { this.listeners.add(listener); try {
        listener(this.snapshot());
    }
    catch { /* A consumer must not block storage. */ } return () => { this.listeners.delete(listener); }; }
    emit() { for (const listener of this.listeners) {
        try {
            listener(this.snapshot());
        }
        catch { /* Isolate consumer callbacks. */ }
    } }
    report(reason) { const error = asError(reason); this.transient = { code: error.code, message: error.message }; this.emit(); }
    exclusive(task) {
        const work = this.tail.catch(() => { }).then(() => this.client.options.storage.withLock(this.key, task));
        this.tail = work;
        return work;
    }
    async open(options = {}) {
        this.client.guard();
        const storage = this.client.options.storage, record = await storage.read(this.key) ?? await storage.update(this.key, (current) => current ?? emptyTable(this.key, this.target));
        this.publish(record);
        if (!options.cachedOnly && (!record.initialized || options.refresh))
            await this.refresh({ create: options.create });
        this.client.schedule(this);
        return this.snapshot();
    }
    async transaction(change) {
        this.client.guard();
        this.raw();
        const guard = this.client.capture();
        const result = await this.client.options.storage.update(this.key, record => {
            guard();
            if (!record?.initialized)
                throw new SheetbaseError('schema', 'The table is not initialized.');
            assertRecord(record, this.target);
            const added = [], transactionId = crypto.randomUUID();
            const state = () => project(record.base, record.columns ?? [], [...record.operations, ...added], !!this.target.dynamic);
            const structural = (schema) => {
                if (!this.definition.dynamic)
                    throw new SheetbaseError('schema', 'Enable dynamic columns before changing the schema.');
                added.push({ id: crypto.randomUUID(), key: '', values: {}, schema, transaction: transactionId });
                validateColumns(state().columns, this.target.keyColumn);
                this.codecs(state().columns);
            };
            const table = this;
            const transaction = {
                get columns() { return state().columns; },
                get(key) {
                    const current = state(), values = current.rows[key];
                    if (!Object.prototype.hasOwnProperty.call(current.rows, key))
                        return undefined;
                    return { key, values: Object.fromEntries(Object.entries(table.codecs(current.columns)).map(([field, column]) => [field, column.decode(values[table.definition.dynamic ? field : column.header] ?? '')])) };
                },
                set(key, patch) {
                    validateKey(key);
                    const codecs = table.codecs(state().columns);
                    const values = Object.fromEntries(Object.entries(patch).map(([field, value]) => {
                        const column = codecs[field];
                        if (!Object.prototype.hasOwnProperty.call(codecs, field) || !column || value === undefined)
                            throw new SheetbaseError('invalid-value', `Unknown or undefined field: ${field}`);
                        return [table.definition.dynamic ? field : column.header, column.encode(value)];
                    }));
                    if (Object.keys(values).length)
                        added.push({ id: crypto.randomUUID(), key, values, transaction: transactionId });
                },
                addColumn(column) { structural({ type: 'add', column: structuredClone(column) }); },
                renameColumn(id, header) { structural({ type: 'rename', id, header }); },
                removeColumn(id) { structural({ type: 'remove', id }); },
            };
            const returned = change(transaction);
            if (returned && typeof returned.then === 'function')
                throw new SheetbaseError('invalid-value', 'Transactions must be synchronous.');
            return { ...record, operations: compact([...record.operations, ...added], record.batch?.operationIds), error: null };
        });
        guard();
        this.publish(result);
        this.client.schedule(this);
    }
    async set(key, patch) { await this.transaction(transaction => transaction.set(key, patch)); }
    async delete(key) { await this.transaction(transaction => transaction.set(key, Object.fromEntries(Object.keys(this.codecs(transaction.columns)).map(field => [field, null])))); }
    async addColumn(column) { await this.transaction(transaction => transaction.addColumn(column)); }
    async renameColumn(id, header) { await this.transaction(transaction => transaction.renameColumn(id, header)); }
    async removeColumn(id) { await this.transaction(transaction => transaction.removeColumn(id)); }
    /** Seed a new cache during an application-owned migration. Never replaces existing initialized data. */
    async import(data) {
        const guard = this.client.capture();
        const result = await this.client.options.storage.update(this.key, current => {
            guard();
            if (current?.initialized || current?.operations.length)
                return current;
            const columns = project(data.base, data.columns ?? [], data.operations, !!this.target.dynamic).columns;
            validateColumns(columns, this.target.keyColumn);
            this.codecs(columns);
            return { ...emptyTable(this.key, this.target), ...structuredClone(data) };
        });
        guard();
        this.publish(result);
    }
    async export() { return this.client.options.storage.read(this.key); }
    async refresh(options = {}) {
        const guard = this.client.capture();
        return this.exclusive(async () => {
            this.client.requireConnection();
            guard();
            this.busy = true;
            this.emit();
            let failure;
            try {
                const remote = await this.client.options.storage.withLock(`file:${this.target.accountId}:${this.target.spreadsheetId}`, async () => {
                    if (options.create)
                        await this.client.options.remote.initialize(this.target, guard);
                    const columns = this.target.dynamic ? await this.client.options.remote.readSchema?.(this.target, guard) : undefined;
                    if (this.target.dynamic && !columns)
                        throw new SheetbaseError('unsupported', 'The remote does not support dynamic columns.');
                    if (columns) {
                        validateColumns(columns, this.target.keyColumn);
                        this.codecs(columns);
                    }
                    const rows = await this.client.options.remote.read({ ...this.target, columns }, guard);
                    for (const [key, values] of Object.entries(rows))
                        this.decode(key, values, columns);
                    return { rows, columns };
                });
                guard();
                const record = await this.client.options.storage.update(this.key, (old) => { guard(); const next = old ?? emptyTable(this.key, this.target); assertRecord(next, this.target); const projected = project(remote.rows, remote.columns ?? [], next.operations, !!this.target.dynamic); for (const [key, values] of Object.entries(projected.rows))
                    this.decode(key, values, projected.columns); return { ...next, base: remote.rows, columns: remote.columns, initialized: true, syncedAt: Date.now(), error: null }; });
                this.publish(record);
            }
            catch (reason) {
                failure = asError(reason);
                this.report(failure);
                throw failure;
            }
            finally {
                this.busy = false;
                this.emit();
                this.client.completed(this, failure);
            }
        });
    }
    async sync() {
        const guard = this.client.capture();
        this.client.cancelTimer(this.key);
        return this.exclusive(async () => {
            this.client.requireConnection();
            guard();
            this.busy = true;
            this.emit();
            let failure;
            try {
                for (let count = 0; count < 100; count++) {
                    const current = await this.client.options.storage.read(this.key);
                    if (!current?.operations.length)
                        break;
                    assertRecord(current, this.target);
                    guard();
                    const frozen = await this.client.options.storage.update(this.key, (record) => {
                        guard();
                        if (!record)
                            throw new SheetbaseError('storage', 'The table disappeared.');
                        if (record.batch)
                            return record;
                        const operations = compact(record.operations);
                        let end = Math.min(100, operations.length);
                        while (end < operations.length && operations[end - 1].transaction && operations[end - 1].transaction === operations[end].transaction)
                            end++;
                        return { ...record, operations, batch: { id: crypto.randomUUID(), operationIds: operations.slice(0, end).map((operation) => operation.id) } };
                    });
                    const batch = frozen.batch, operations = frozen.operations.filter((operation) => batch.operationIds.includes(operation.id));
                    const remote = await this.client.options.storage.withLock(`file:${this.target.accountId}:${this.target.spreadsheetId}`, () => this.client.options.remote.commit({ ...this.target, columns: frozen.columns }, operations, batch.id, guard));
                    guard();
                    const acknowledged = await this.client.options.storage.update(this.key, (record) => {
                        guard();
                        if (!record)
                            throw new SheetbaseError('storage', 'The table disappeared.');
                        const next = remote ?? project(record.base, record.columns ?? [], operations, !!this.target.dynamic);
                        return { ...record, base: next.rows, columns: next.columns, operations: record.operations.filter((operation) => !batch.operationIds.includes(operation.id)), batch: null, syncedAt: Date.now(), error: null };
                    });
                    this.publish(acknowledged);
                }
            }
            catch (reason) {
                failure = asError(reason);
                try {
                    guard();
                    this.publish(await this.client.options.storage.update(this.key, (record) => { guard(); if (!record)
                        throw failure; return { ...record, error: { code: failure.code, message: failure.message } }; }));
                }
                catch {
                    this.report(failure);
                }
                throw failure;
            }
            finally {
                this.busy = false;
                this.emit();
                this.client.completed(this, failure);
            }
        });
    }
}
export function createSheetbase(options) { return new SheetbaseClient(options); }
//# sourceMappingURL=client.js.map
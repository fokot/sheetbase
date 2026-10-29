import { project, validateColumns } from './model.js';
import { SheetbaseError, type Credentials, type Guard, type Operation, type RawRows, type Remote, type Target, type DynamicColumn, type TableState } from './types.js';
const ROOT = 'https://sheets.googleapis.com/v4/spreadsheets';
const LEDGER = '_Sheetbase';
interface Properties { sheetId: number; title: string; gridProperties: { rowCount: number; columnCount: number }; hidden?: boolean }
interface Cell { userEnteredValue?: { stringValue?: string; numberValue?: number; boolValue?: boolean }; formattedValue?: string }
interface Sheet { properties: Properties; data?: { startRow?: number; startColumn?: number; rowData?: { values?: Cell[] }[] }[] }
interface Tab { properties: Properties; rows: string[][] }
const cells = (rows: string[][]) => rows.map((row) => ({ values: row.map((stringValue) => ({ userEnteredValue: { stringValue } })) }));
const quote = (name: string) => `'${name.replaceAll("'", "''")}'`;
function decode(sheet: Sheet): Tab {
  const rows: string[][] = [];
  for (const grid of sheet.data ?? []) for (const [offset, row] of (grid.rowData ?? []).entries()) {
    const target = rows[(grid.startRow ?? 0) + offset] ??= [];
    for (const [column, cell] of (row.values ?? []).entries()) {
      const value = cell.userEnteredValue;
      target[(grid.startColumn ?? 0) + column] = value?.stringValue ?? (value?.numberValue !== undefined ? String(value.numberValue) : value?.boolValue !== undefined ? String(value.boolValue) : cell.formattedValue ?? '');
    }
  }
  while (rows.length && !rows.at(-1)?.some((value) => value !== '')) rows.pop();
  return { properties: sheet.properties, rows: Array.from({ length: rows.length }, (_, index) => rows[index] ?? []) };
}
function validate(tab: Tab, target: Target): Map<string, number> {
  const header = tab.rows[0] ?? [];
  if (header[0] !== target.keyColumn) throw new SheetbaseError('schema', `Column A must be ${target.keyColumn}.`);
  const nonEmpty = header.filter(Boolean);
  if (new Set(nonEmpty.map((name) => name.toLowerCase())).size !== nonEmpty.length) throw new SheetbaseError('schema', 'Sheet headers must be unique.');
  const positions = new Map<string, number>();
  for (const name of target.headers) { const index = header.indexOf(name); if (index < 1) throw new SheetbaseError('schema', `Missing column: ${name}. Pending changes are retained.`); positions.set(name, index); }
  const seen = new Set<string>();
  for (const row of tab.rows.slice(1)) if (row[0]) { if (seen.has(row[0]) && target.duplicateKeys !== 'last') throw new SheetbaseError('schema', `Duplicate row key: ${row[0]}. Resolve it in Sheets before syncing.`); seen.add(row[0]); }
  return positions;
}
function ledgerBatches(tab?: Tab): Map<string, string> {
  if (!tab?.rows.length) return new Map();
  if (JSON.stringify(tab.rows[0].slice(0, 3)) !== JSON.stringify(['Batch', 'Table', 'Saved at'])) throw new SheetbaseError('schema', 'The reserved _Sheetbase tab has an incompatible header.');
  return new Map(tab.rows.slice(1).filter((row) => row[0]).map((row) => [row[0], row[1]]));
}
function dynamicSchema(table: Tab, definitions: Tab | undefined, target: Target): DynamicColumn[] {
  validate(table, { ...target, headers: [] });
  if (definitions?.rows.length && JSON.stringify(definitions.rows[0].slice(0, 3)) !== JSON.stringify(['ID', 'Name', 'Type'])) throw new SheetbaseError('schema', 'Column definitions must start with ID, Name, Type.');
  const known = definitions?.rows.slice(1).filter(row => row.some(Boolean)) ?? [];
  if (known.some(row => !row[0] || !row[1] || !row[2]) || new Set(known.map(row => row[0])).size !== known.length || new Set(known.map(row => row[1])).size !== known.length) throw new SheetbaseError('schema', 'Column definitions need distinct IDs and names.');
  const headers = table.rows[0].slice(1);
  if (headers.some(header => !header.trim())) throw new SheetbaseError('schema', 'Dynamic column headers cannot be empty.');
  if (known.some(row => !headers.includes(row[1]))) throw new SheetbaseError('schema', 'A defined column is missing from the table. Repair the sheet before syncing.');
  const columns = headers.map(header => { const entry = known.find(row => row[1] === header); return { id: entry?.[0] ?? target.columns?.find(column => column.header === header)?.id ?? `legacy:${header}`, header, type: entry?.[2] ?? target.columns?.find(column => column.header === header)?.type ?? target.dynamic!.defaultType }; });
  validateColumns(columns, target.keyColumn); return columns;
}
function rawDynamic(table: Tab, columns: DynamicColumn[]): TableState {
  const rows = table.rows.slice(1).flatMap(row => {
    if (!row[0]) return [];
    const values = Object.fromEntries(columns.map(column => [column.id, row[table.rows[0].indexOf(column.header)] ?? '']));
    return [[row[0], values] as const];
  });
  return { rows: Object.fromEntries(Object.entries(Object.fromEntries(rows)).filter(([, values]) => Object.values(values).some(Boolean))), columns };
}
export interface GoogleRemoteOptions {
  /** Return credentials already held in memory. Never open a popup here. */
  getCredentials: () => Credentials | Promise<Credentials>;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Optional receipt tabs used by an earlier application, checked during cache migration. */
  legacyLedgers?: string[];
}
export function createGoogleSheetsRemote(options: GoogleRemoteOptions): Remote {
  const metadata = new Map<string, { expires: number; sheets: Properties[] }>();
  const fetcher = options.fetch ?? globalThis.fetch;
  async function request<T>(target: Target, suffix: string, guard: Guard, body?: unknown): Promise<T> {
    guard(); const credentials = await options.getCredentials(); guard();
    if (!credentials.accessToken || credentials.accountId !== target.accountId) throw new SheetbaseError('auth-required', 'The token must belong to this table’s verified Google account.');
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20000);
    try {
      guard(); const response = await fetcher(`${ROOT}/${encodeURIComponent(target.spreadsheetId)}${suffix}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${credentials.accessToken}`, 'Content-Type': 'application/json' }, signal: controller.signal, ...(body ? { body: JSON.stringify(body) } : {}) });
      guard(); const current = await options.getCredentials(); guard();
      if (current.accountId !== credentials.accountId || current.accessToken !== credentials.accessToken) throw new SheetbaseError('auth-required', 'Authorization changed during the request. Retry under the original account.');
      if (response.status === 401 || response.status === 403) throw new SheetbaseError('auth-required', 'Google authorization or edit access is missing. Reauthorize and retry.');
      let result: { error?: { message?: string } };
      try { result = await response.json(); } catch { throw new SheetbaseError('network', 'Google returned an unreadable response.', true); }
      guard();
      if (!response.ok) throw new SheetbaseError(response.status === 400 || response.status === 404 ? 'schema' : 'network', result.error?.message ?? `Google returned ${response.status}.`, response.status === 429 || response.status >= 500);
      return result as T;
    } catch (error) {
      if (error instanceof SheetbaseError) throw error;
      throw new SheetbaseError('network', error instanceof Error && error.name === 'AbortError' ? 'Google request timed out. Pending changes are retained.' : 'Cannot reach Google. Pending changes are retained.', true);
    } finally { clearTimeout(timeout); }
  }
  async function meta(target: Target, guard: Guard, fresh = false): Promise<Properties[]> {
    const old = metadata.get(target.spreadsheetId);
    if (old && old.expires > Date.now() && !fresh) return old.sheets;
    const data = await request<{ sheets: Sheet[] }>(target, '?fields=sheets(properties)', guard);
    const sheets = data.sheets.map((sheet) => sheet.properties); metadata.set(target.spreadsheetId, { sheets, expires: Date.now() + 60000 }); return sheets;
  }
  async function tabs(target: Target, ranges: string[], guard: Guard): Promise<Tab[]> {
    const query = new URLSearchParams({ fields: 'sheets(properties,data(startRow,startColumn,rowData(values(userEnteredValue,formattedValue))))' });
    for (const range of ranges) query.append('ranges', range);
    const result = await request<{ sheets: Sheet[] }>(target, `?${query}`, guard); return result.sheets.map(decode);
  }
  async function update(target: Target, requests: unknown[], guard: Guard) { await request(target, ':batchUpdate', guard, { requests }); }
  async function commitDynamic(target: Target, operations: Operation[], batchId: string, guard: Guard): Promise<void | TableState> {
    const structural = operations.some(operation => operation.schema);
    const sheets = await meta(target, guard, structural);
    const names = [target.dynamic!.sheet, LEDGER, ...(options.legacyLedgers ?? [])];
    const ranges = structural ? [quote(target.sheet)] : [`${quote(target.sheet)}!1:1`, `${quote(target.sheet)}!A2:A`];
    for (const name of names) if (sheets.some(sheet => sheet.title === name)) ranges.push(quote(name));
    const result = await tabs(target, ranges, guard), table = result.find(tab => tab.properties.title === target.sheet);
    if (!table) throw new SheetbaseError('schema', `Missing sheet ${target.sheet}.`);
    const ledger = result.find(tab => tab.properties.title === LEDGER), receipts = ledgerBatches(ledger);
    const receipt = receipts.get(batchId);
    if (receipt !== undefined && receipt !== target.sheet) throw new SheetbaseError('schema', 'A batch receipt belongs to another table.');
    const legacyReceipt = (options.legacyLedgers ?? []).some(name => {
      const tab = result.find(tab => tab.properties.title === name);
      if (tab?.rows.length && tab.rows[0][0] !== 'Batch ID') throw new SheetbaseError('schema', 'Legacy receipt tab has an incompatible header.');
      return tab?.rows.slice(1).some(row => row[0] === batchId);
    });
    if (receipt !== undefined || legacyReceipt) {
      const recovered = legacyReceipt ? { ...target, columns: project({}, target.columns ?? [], operations).columns } : target;
      const columns = await remote.readSchema!(recovered, guard), rows = await remote.read({ ...target, columns }, guard);
      return { rows, columns };
    }
    let definitions = result.find(tab => tab.properties.title === target.dynamic!.sheet);
    let columns = dynamicSchema(table, definitions, target);
    const requests: unknown[] = [], newRows = new Map<string, string[]>();
    let nextId = Math.max(-1, ...sheets.map(sheet => sheet.sheetId)) + 1;
    if (!definitions) {
      definitions = { properties: { sheetId: nextId++, title: target.dynamic!.sheet, gridProperties: { rowCount: 1000, columnCount: 3 } }, rows: [] };
      requests.push({ addSheet: { properties: definitions.properties } });
    }
    const write = (tab: Tab, rowIndex: number, columnIndex: number, value: string) => {
      if (columnIndex < 0) throw new SheetbaseError('schema', 'The target column is missing.');
      if (columnIndex >= tab.properties.gridProperties.columnCount) {
        requests.push({ appendDimension: { sheetId: tab.properties.sheetId, dimension: 'COLUMNS', length: columnIndex + 1 - tab.properties.gridProperties.columnCount } });
        tab.properties.gridProperties.columnCount = columnIndex + 1;
      }
      if (rowIndex >= tab.properties.gridProperties.rowCount) {
        requests.push({ appendDimension: { sheetId: tab.properties.sheetId, dimension: 'ROWS', length: rowIndex + 1 - tab.properties.gridProperties.rowCount } });
        tab.properties.gridProperties.rowCount = rowIndex + 1;
      }
      requests.push({ updateCells: { start: { sheetId: tab.properties.sheetId, rowIndex, columnIndex }, rows: cells([[value]]), fields: 'userEnteredValue' } });
      tab.rows[rowIndex] ??= []; tab.rows[rowIndex][columnIndex] = value;
    };
    if (!definitions.rows.length) ['ID', 'Name', 'Type'].forEach((value, index) => write(definitions!, 0, index, value));
    const addDefinition = (column: DynamicColumn) => { const row = definitions!.rows.length; [column.id, column.header, column.type].forEach((value, index) => write(definitions!, row, index, value)); };
    for (const column of columns) if (!definitions.rows.some(row => row[0] === column.id)) addDefinition(column);
    for (const operation of operations) {
      if (operation.schema) {
        const change = operation.schema, next = project({}, columns, [operation]).columns;
        validateColumns(next, target.keyColumn);
        if (change.type === 'add') {
          if (!columns.some(column => column.id === change.column.id)) { write(table, 0, table.rows[0].length, change.column.header); addDefinition(change.column); }
        } else {
          const column = columns.find(column => column.id === change.id);
          if (!column && change.type === 'rename') throw new SheetbaseError('schema', 'Column no longer exists.');
          if (column) {
            const index = table.rows[0].indexOf(column.header), definitionRow = definitions.rows.findIndex(row => row[0] === column.id);
            if (change.type === 'rename') { write(table, 0, index, change.header); write(definitions, definitionRow, 1, change.header); }
            else {
              requests.push({ deleteDimension: { range: { sheetId: table.properties.sheetId, dimension: 'COLUMNS', startIndex: index, endIndex: index + 1 } } });
              for (const row of table.rows) row.splice(index, 1); for (const row of newRows.values()) row.splice(index, 1); table.properties.gridProperties.columnCount--;
              requests.push({ deleteDimension: { range: { sheetId: definitions.properties.sheetId, dimension: 'ROWS', startIndex: definitionRow, endIndex: definitionRow + 1 } } });
              definitions.rows.splice(definitionRow, 1); definitions.properties.gridProperties.rowCount--;
            }
          }
        }
        columns = next; continue;
      }
      for (const [id, value] of Object.entries(operation.values)) {
        const column = columns.find(column => column.id === id);
        if (!column) throw new SheetbaseError('schema', 'The edited column no longer exists. Pending changes are retained.');
        // Reject an ID whose codec changed remotely before sending an old encoded value.
        const original = target.columns?.find(column => column.id === id);
        if (original && original.type !== column.type) throw new SheetbaseError('schema', 'The column type changed remotely.');
        const index = table.rows[0].indexOf(column.header), matching = table.rows.flatMap((row, offset) => offset > 0 && row[0] === operation.key ? [offset] : []);
        if (matching.length) { for (const rowIndex of matching) write(table, rowIndex, index, value); }
        else { const row = newRows.get(operation.key) ?? [operation.key]; while (row.length <= index) row.push(''); row[index] = value; newRows.set(operation.key, row); }
      }
    }
    const appended = [...newRows.values()].filter(row => row.slice(1).some(Boolean));
    if (appended.length) requests.push({ appendCells: { sheetId: table.properties.sheetId, rows: cells(appended), fields: 'userEnteredValue' } });
    const ledgerId = ledger?.properties.sheetId ?? nextId++;
    if (!ledger) requests.push({ addSheet: { properties: { sheetId: ledgerId, title: LEDGER, hidden: true, gridProperties: { rowCount: 1000, columnCount: 3 } } } });
    if (!ledger?.rows.length) requests.push({ updateCells: { start: { sheetId: ledgerId, rowIndex: 0, columnIndex: 0 }, rows: cells([['Batch', 'Table', 'Saved at']]), fields: 'userEnteredValue' } });
    requests.push({ appendCells: { sheetId: ledgerId, rows: cells([[batchId, target.sheet, new Date().toISOString()]]), fields: 'userEnteredValue' } });
    try { await update(target, requests, guard); } finally { metadata.delete(target.spreadsheetId); }
    if (structural) { table.rows.push(...appended); return rawDynamic(table, columns); }
  }
  const remote: Remote = {
    async initialize(target, guard) {
      const sheets = await meta(target, guard, true), existing = sheets.find((sheet) => sheet.title === target.sheet);
      const header = [target.keyColumn, ...target.headers], requests: unknown[] = [];
      let sheetId: number;
      if (existing) {
        const [tab] = await tabs(target, [quote(target.sheet)], guard);
        if (tab.rows.some((row) => row.some((value) => value !== ''))) { validate(tab, target); return; }
        sheetId = existing.sheetId;
        if (existing.gridProperties.columnCount < header.length) requests.push({ appendDimension: { sheetId, dimension: 'COLUMNS', length: header.length - existing.gridProperties.columnCount } });
      } else {
        sheetId = Math.max(-1, ...sheets.map((sheet) => sheet.sheetId)) + 1;
        requests.push({ addSheet: { properties: { sheetId, title: target.sheet, gridProperties: { rowCount: 1000, columnCount: Math.max(26, header.length), frozenRowCount: 1, frozenColumnCount: 1 } } } });
      }
      requests.push({ updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 }, rows: cells([header]), fields: 'userEnteredValue' } });
      try { await update(target, requests, guard); } finally { metadata.delete(target.spreadsheetId); }
    },
    async readSchema(target, guard) {
      if (!target.dynamic) return [];
      const sheets = await meta(target, guard);
      const result = await tabs(target, [`${quote(target.sheet)}!1:1`, ...(sheets.some(sheet => sheet.title === target.dynamic!.sheet) ? [quote(target.dynamic.sheet)] : [])], guard);
      const table = result.find(tab => tab.properties.title === target.sheet);
      if (!table) throw new SheetbaseError('schema', `Missing sheet ${target.sheet}.`);
      const definitions = result.find(tab => tab.properties.title === target.dynamic!.sheet), columns = dynamicSchema(table, definitions, target);
      const requests: unknown[] = [];
      const id = definitions?.properties.sheetId ?? Math.max(-1, ...sheets.map(sheet => sheet.sheetId)) + 1;
      if (!definitions) requests.push({ addSheet: { properties: { sheetId: id, title: target.dynamic.sheet, gridProperties: { rowCount: Math.max(1000, columns.length + 1), columnCount: 3 } } } });
      if (!definitions?.rows.length) requests.push({ updateCells: { start: { sheetId: id, rowIndex: 0, columnIndex: 0 }, rows: cells([['ID', 'Name', 'Type']]), fields: 'userEnteredValue' } });
      const missing = columns.filter(column => !definitions?.rows.some(row => row[0] === column.id));
      if (missing.length) requests.push({ appendCells: { sheetId: id, rows: cells(missing.map(column => [column.id, column.header, column.type])), fields: 'userEnteredValue' } });
      if (requests.length) { try { await update(target, requests, guard); } finally { metadata.delete(target.spreadsheetId); } }
      return columns;
    },
    async read(target, guard) {
      const sheets = await meta(target, guard);
      if (!sheets.some((sheet) => sheet.title === target.sheet)) throw new SheetbaseError('schema', `Missing sheet ${target.sheet}. Use open({ create: true }) to initialize it.`);
      const [tab] = await tabs(target, [quote(target.sheet)], guard);
      if (target.dynamic) {
        const columns = target.columns ?? await remote.readSchema!(target, guard);
        validate(tab, { ...target, headers: columns.map(column => column.header) });
        return rawDynamic(tab, columns).rows;
      }
      const positions = validate(tab, target);
      const rows = tab.rows.slice(1).flatMap((row) => {
        if (!row[0]) return [];
        const values = Object.fromEntries([...positions].map(([header, column]) => [header, row[column] ?? '']));
        return [[row[0], values] as const];
      });
      return Object.fromEntries(Object.entries(Object.fromEntries(rows)).filter(([, values]) => Object.values(values).some(Boolean))) as RawRows;
    },
    async commit(target, operations, batchId, guard) {
      try {
        if (target.dynamic) return await commitDynamic(target, operations, batchId, guard);
        const sheets = await meta(target, guard);
        if (!sheets.some((sheet) => sheet.title === target.sheet)) throw new SheetbaseError('schema', `Missing sheet ${target.sheet}.`);
        const ranges = [`${quote(target.sheet)}!1:1`, `${quote(target.sheet)}!A2:A`];
        if (sheets.some((sheet) => sheet.title === LEDGER)) ranges.push(`${quote(LEDGER)}!A:C`);
        const result = await tabs(target, ranges, guard), table = result.find((sheet) => sheet.properties.title === target.sheet)!;
        const positions = validate(table, target), ledger = result.find((sheet) => sheet.properties.title === LEDGER), receipts = ledgerBatches(ledger);
        const receipt = receipts.get(batchId);
        if (receipt !== undefined) { if (receipt !== target.sheet) throw new SheetbaseError('schema', 'A batch receipt belongs to another table.'); return; }
        const requests: unknown[] = [], combined = new Map<string, Record<string, string>>();
        for (const operation of operations) {
          if (Object.keys(operation.values).some((header) => !positions.has(header))) throw new SheetbaseError('schema', 'An operation targets a column outside the registered schema.');
          combined.set(operation.key, { ...combined.get(operation.key), ...operation.values });
        }
        const newRows: string[][] = [];
        for (const [key, values] of combined) {
          const matching = table.rows.flatMap((row, rowIndex) => rowIndex > 0 && row[0] === key ? [rowIndex] : []);
          if (matching.length) for (const index of matching) for (const [header, value] of Object.entries(values)) requests.push({ updateCells: { start: { sheetId: table.properties.sheetId, rowIndex: index, columnIndex: positions.get(header)! }, rows: cells([[value]]), fields: 'userEnteredValue' } });
          else if (Object.values(values).some(Boolean)) {
            const row = Array.from({ length: Math.max(...Object.keys(values).map((header) => positions.get(header)!)) + 1 }, () => ''); row[0] = key;
            for (const [header, value] of Object.entries(values)) row[positions.get(header)!] = value; newRows.push(row);
          }
        }
        if (newRows.length) requests.push({ appendCells: { sheetId: table.properties.sheetId, rows: cells(newRows), fields: 'userEnteredValue' } });
        const ledgerId = ledger?.properties.sheetId ?? Math.max(-1, ...sheets.map((sheet) => sheet.sheetId)) + 1;
        if (!ledger) requests.push({ addSheet: { properties: { sheetId: ledgerId, title: LEDGER, hidden: true, gridProperties: { rowCount: 1000, columnCount: 3 } } } });
        if (!ledger?.rows.length) requests.push({ updateCells: { start: { sheetId: ledgerId, rowIndex: 0, columnIndex: 0 }, rows: cells([['Batch', 'Table', 'Saved at']]), fields: 'userEnteredValue' } });
        requests.push({ appendCells: { sheetId: ledgerId, rows: cells([[batchId, target.sheet, new Date().toISOString()]]), fields: 'userEnteredValue' } });
        await update(target, requests, guard); if (!ledger) metadata.delete(target.spreadsheetId);
      } catch (error) { metadata.delete(target.spreadsheetId); throw error; }
    },
  };
  return remote;
}

/** A deterministic backend for examples/tests. It never calls Google. */
export function createMemoryRemote(initial: Record<string, RawRows> = {}, savedReceipts: Record<string, string[]> = {}, savedSchemas: Record<string, DynamicColumn[]> = {}) {
  const tables = new Map(Object.entries(structuredClone(initial))), receipts = new Map(Object.entries(savedReceipts).map(([key, values]) => [key, new Set(values)]));
  const schemas = new Map(Object.entries(structuredClone(savedSchemas)));
  let online = true, loseNext = false, reads = 0, writes = 0;
  const id = (target: Target) => JSON.stringify([target.accountId, target.spreadsheetId, target.sheet]);
  const check = (guard: Guard) => { guard(); if (!online) throw new SheetbaseError('network', 'The simulated remote is offline.', true); };
  return {
    async initialize(target: Target, guard: Guard) { check(guard); if (!tables.has(id(target))) tables.set(id(target), {}); },
    async readSchema(target: Target, guard: Guard) { check(guard); return structuredClone(schemas.get(id(target)) ?? target.columns ?? []); },
    async read(target: Target, guard: Guard) { check(guard); reads++; if (!tables.has(id(target))) throw new SheetbaseError('schema', 'The simulated table does not exist.'); return structuredClone(tables.get(id(target))!); },
    async commit(target: Target, operations: Operation[], batchId: string, guard: Guard) {
      check(guard); const key = id(target), saved = receipts.get(key) ?? new Set<string>(); if (saved.has(batchId)) return;
      if (!tables.has(key)) throw new SheetbaseError('schema', 'The simulated table does not exist.');
      const next = project(tables.get(key)!, schemas.get(key) ?? target.columns ?? [], operations, !!target.dynamic); tables.set(key, next.rows); schemas.set(key, next.columns); saved.add(batchId); receipts.set(key, saved); writes++;
      if (loseNext) { loseNext = false; throw new SheetbaseError('network', 'The remote saved the batch, but the reply was lost. Retry to acknowledge its receipt.', true); }
    },
    setOnline(value: boolean) { online = value; },
    loseNextResponse() { loseNext = true; },
    inspect(target: Target) { return structuredClone(tables.get(id(target)) ?? {}); },
    stats() { return { reads, writes }; },
    checkpoint() { return { tables: structuredClone(Object.fromEntries(tables)), schemas: structuredClone(Object.fromEntries(schemas)), receipts: Object.fromEntries([...receipts].map(([key, ids]) => [key, [...ids]])) }; },
  } satisfies Remote & Record<string, unknown>;
}

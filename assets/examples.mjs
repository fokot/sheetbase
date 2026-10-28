export function codeExamples(english) {
  return {
    connect: `import {
  createSheetbase, createIndexedDBStorage,
  createGoogleSheetsRemote, column
} from '@fokot/sheetbase';

const db = createSheetbase({
  accountId: googleUser.id,
  storage: createIndexedDBStorage('my-app'),
  remote: createGoogleSheetsRemote({
    getCredentials: () => ({
      accountId: googleUser.id,
      accessToken: tokenInMemory
    })
  })
});

const journal = db.table({
  spreadsheetId: sheetId,
  sheet: 'Journal',
  keyColumn: 'Date',
  columns: {
    walk: column.boolean('Walk'),
    pages: column.number('Pages')
  }
});

await journal.open({ create: true });
await journal.set('2026-10-27', { walk: true });`,
    offline: `// ${english ? 'After the table has been opened successfully once.' : 'Po prvom úspešnom otvorení tabuľky.'}
// ${english ? 'The client also follows browser connection events.' : 'Klient sleduje aj udalosti spojenia prehliadača.'}
db.setOnline(false);

await journal.set('2026-10-27', { pages: 24 });
await journal.set('2026-10-27', { pages: 25 });

// ${english ? 'Two writes. One pending operation.' : 'Dva zápisy. Jedna čakajúca operácia.'}
console.log(journal.snapshot().pending); // 1
console.log(journal.get('2026-10-27'));

const stop = journal.subscribe(({ rows, phase }) => {
  render(rows, phase);
});

// ${english ? 'Once online with valid credentials.' : 'Po návrate spojenia a pri platnom prihlásení.'}
db.setOnline(true);
await journal.sync();
stop();`,
    workouts: `// ${english ? 'A readable custom format for one cell.' : 'Čitateľný vlastný formát jednej bunky.'}
const sets = column.custom('Bench press', {
  id: 'sets:v1',
  encode: rows => rows
    .map(s => s.reps + '×' + s.kg).join(', '),
  decode: text => text.split(', ').map(part => {
    const [reps, kg] = part.split('×').map(Number);
    if (!Number.isFinite(reps) || !Number.isFinite(kg)) {
      throw new Error('Invalid set');
    }
    return { reps, kg };
  })
});

const workouts = db.table({
  spreadsheetId: workoutSheetId,
  sheet: 'Workouts', keyColumn: 'Date',
  columns: { bench: sets }
});

await workouts.open({ create: true });
await workouts.set('2026-10-27', {
  bench: [{ reps: 5, kg: 100 }, { reps: 3, kg: 120 }]
});
// ${english ? 'In the cell' : 'V bunke'}: 5×100, 3×120`
  };
}

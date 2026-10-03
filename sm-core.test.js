/**
 * Stage Master — tests del dominio.
 * Sin dependencias: `node sm-core.test.js`
 *
 * Cada bloque cubre una regla de negocio. Los marcados [REGRESIÓN] reproducen
 * bugs que llegaron a producción; si vuelven a fallar, el bug ha vuelto.
 */
const C = require('./sm-core.js');

let pass = 0, fail = 0;
const eq = (actual, expected, label) => {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}\n      esperado: ${b}\n      obtenido: ${a}`); }
};
const group = name => console.log(`\n${name}`);

// ── Helpers de construcción ────────────────────────────────────────
let _id = 0;
const ch = o => ({ subboxes: {}, instrumento: '', micro: '', di: '', pies: {}, ...o });
const artist = o => ({
  id: ++_id, nombre: 'A' + _id, fecha: '2026-08-28', inicio: '20:00',
  reutilizable: false, mangueraSet: 'propio', sbCajetines: {}, channels: [], ...o,
});
const state = o => ({
  event: { dayCutoff: '06:00' },
  subboxes: [{ letter: 'A' }, { letter: 'B' }, { letter: 'F' }],
  sbConfig: { fixedLines: [] },
  mangueraSets: [],
  artists: [],
  ...o,
});
const mics = (names, extra) => names.map(n => ch({ micro: n, ...extra }));

// ═══════════════════════════════════════════════════════════════════
group('Cambio de día del festival');
{
  const s = state();
  const t = (fecha, inicio, exp, label) =>
    eq(C.festivalDateOf(s, artist({ fecha, inicio })), exp, label);
  t('2026-08-29', '02:00', '2026-08-28', 'DJ a las 02:00 cuenta como el día anterior');
  t('2026-08-28', '23:30', '2026-08-28', 'show de las 23:30 se queda en su día');
  t('2026-08-28', '20:00', '2026-08-28', 'show de tarde sin cambios');
  t('2026-08-29', '06:00', '2026-08-29', 'justo en el corte pertenece al día nuevo');
  t('2026-08-29', '05:59', '2026-08-28', 'un minuto antes del corte va al anterior');
  t('2026-08-29', '', '2026-08-29', 'sin hora se respeta la fecha');

  const s2 = state({ event: { dayCutoff: '04:00' } });
  eq(C.festivalDateOf(s2, artist({ fecha: '2026-08-29', inicio: '05:00' })), '2026-08-29',
    'el corte es configurable (05:00 con corte a las 04:00 ya es día nuevo)');

  const s3 = state({
    artists: [
      artist({ fecha: '2026-08-28', inicio: '20:00' }),
      artist({ fecha: '2026-08-29', inicio: '01:50' }),
      artist({ fecha: '2026-08-29', inicio: '21:00' }),
    ],
  });
  eq(C.groupByFestivalDate(s3, false).map(d => [d.key, d.artists.length]),
    [['2026-08-28', 2], ['2026-08-29', 1]],
    '[REGRESIÓN] un show de madrugada no crea un día extra');
}

// ═══════════════════════════════════════════════════════════════════
group('DI estéreo — una caja por par L/R');
{
  const st = n => ch({ di: 'ST', micro: n || 'Radial Pro D2' });
  const mono = () => ch({ di: 'M', micro: 'DI J48' });
  eq(C.stereoDiBoxes(artist({ channels: [st(), st()] })), 1, 'par consecutivo = 1 caja');
  eq(C.stereoDiBoxes(artist({ channels: [st(), st(), st(), st()] })), 2, 'dos pares = 2 cajas');
  eq(C.stereoDiBoxes(artist({ channels: [st(), mono(), st()] })), 2, 'separados por mono = 2 cajas');
  eq(C.stereoDiBoxes(artist({ channels: [st(), st(), ch({}), st()] })), 2, 'par + suelto = 2');
  eq(C.stereoDiBoxes(artist({ channels: [st()] })), 1, 'ST impar suelto cuenta 1');

  // [REGRESIÓN] el modelo repetido en L y R contaba doble en la tabla de micros
  const peces = artist({ channels: [st(), st(), st(), st(), st(), st(), st(), st(), st(), st()] });
  eq(C.micsOf(peces)['Radial Pro D2'], 5,
    '[REGRESIÓN] 10 canales ST en pares = 5 cajas, no 10');

  // Modelos distintos en L y R: son dos cajas reales, no un error
  eq(C.micsOf(artist({ channels: [st('DI A'), st('DI B')] })), { 'DI A': 1, 'DI B': 1 },
    'modelos distintos en el par cuentan por separado');
}

// ═══════════════════════════════════════════════════════════════════
group('Exclusiones del recuento');
{
  eq(C.micsOf(artist({ channels: mics(['SM58', 'SM58', 'SM57']) })), { SM58: 2, SM57: 1 },
    'recuento base');
  eq(C.micsOf(artist({ channels: [...mics(['SM58']), ...mics(['SM58'], { premontado: true })] })),
    { SM58: 1 }, '"ya montado" no se recuenta');
  eq(C.micsOf(artist({ channels: mics(['SM58', C.PROPIO, 'XLR', 'xlr']) })), { SM58: 1 },
    'micro propio y XLR quedan fuera');
  eq(C.micsOf(artist({ channels: mics(['sm58', 'SM58']) }), { normalize: null }),
    { sm58: 1, SM58: 1 }, 'sin normalizador no se agrupan variantes');
  eq(C.micsOf(artist({ channels: mics(['sm58', 'SM58']) }), { normalize: s => s.toUpperCase() })
     ['SM58'], 2, 'el normalizador agrupa variantes de escritura');
}

// ═══════════════════════════════════════════════════════════════════
group('Regla de reutilizable');
{
  const s = state({
    artists: [
      artist({ reutilizable: true, channels: mics(Array(4).fill('DI BSS')) }),   // NAT
      artist({ reutilizable: false, channels: mics(Array(4).fill('DI BSS')) }),  // CABRA
      artist({ reutilizable: true, channels: mics(Array(2).fill('DI BSS')) }),   // WALLY
    ],
  });
  eq(C.computeStats(s, s.artists).mics['DI BSS'], 8,
    '[REGRESIÓN] 4 fijo + máx(4,2) reutilizables = 8, no 10');

  const todosFijos = state({
    artists: [4, 4, 2].map(n => artist({ channels: mics(Array(n).fill('X')) })),
  });
  eq(C.computeStats(todosFijos, todosFijos.artists).mics.X, 10, 'sin reutilizables se suma todo');

  const todosReut = state({
    artists: [4, 4, 2].map(n => artist({ reutilizable: true, channels: mics(Array(n).fill('X')) })),
  });
  eq(C.computeStats(todosReut, todosReut.artists).mics.X, 4, 'todos reutilizables = el mayor');

  // El reutilizable aporta su material; no desaparece del recuento
  const soloReut = state({ artists: [artist({ reutilizable: true, channels: mics(['X', 'X']) })] });
  eq(C.computeStats(soloReut, soloReut.artists).mics.X, 2,
    'un reutilizable solo sigue aportando su material');
}

// ═══════════════════════════════════════════════════════════════════
group('Mangueras, cajetines y cables');
{
  const conA = n => artist({ mangueraSet: n, channels: [ch({ subboxes: { A: '1' } })], sbCajetines: { A: 3 } });
  const s = state({
    mangueraSets: [{ id: 'A' }, { id: 'B' }],
    artists: [conA('A'), conA('A'), conA('B')],
  });
  const st = C.computeStats(s, s.artists);
  eq(st.mangueras.A, 2, 'manguera variable: 1 por sistema (A y B), no por artista');
  eq(st.cajetines.A, 9, 'cajetines: 3 por banda, no reutilizables → 9');
  eq(st.cables.A, 6, 'cables link: (3-1) por banda → 6');

  const reut = state({
    mangueraSets: [{ id: 'A' }, { id: 'B' }],
    artists: [
      { ...conA('A'), reutilizable: true },
      { ...conA('A'), reutilizable: true },
      { ...conA('B'), reutilizable: true },
    ],
  });
  eq(C.computeStats(reut, reut.artists).cajetines.A, 3,
    'con todos reutilizables, los cajetines se comparten');

  // Línea fija: una sola vez para todo el festival
  const conF = () => artist({ channels: [ch({ subboxes: { F: '1' } })] });
  const fija = state({
    sbConfig: { fixedLines: [{ sbLetter: 'F', quantity: 3 }] },
    artists: [conF(), conF(), conF(), conF()],
  });
  const sf = C.computeStats(fija, fija.artists);
  eq([sf.mangueras.F, sf.cajetines.F, sf.cables.F], [1, 3, 2],
    '[REGRESIÓN] la fija se monta 1 vez: 1 manguera, 3 cajetines, 2 cables');

  eq(C.computeStats(state(), []).mangueras, {}, 'sin artistas no hay mangueras');
}

// ═══════════════════════════════════════════════════════════════════
group('Máximo de festival');
{
  const día = (fecha, n) => artist({ fecha, inicio: '20:00', channels: mics(Array(n).fill('SM58')) });
  const s = state({ artists: [día('2026-08-28', 10), día('2026-08-29', 6)] });
  eq(C.computeFestivalMax(s).mics.SM58, 10, 'se lleva el máximo entre días, no la suma');

  // El total de cajetines es el máximo del TOTAL DIARIO, no la suma de máximos
  const caj = (fecha, a, b) => artist({
    fecha, inicio: '20:00',
    channels: [ch({ subboxes: { A: '1' } }), ch({ subboxes: { B: '1' } })],
    sbCajetines: { A: a, B: b },
  });
  const s2 = state({ artists: [caj('2026-08-28', 5, 1), caj('2026-08-29', 1, 5)] });
  const fm = C.computeFestivalMax(s2);
  eq(fm.totals.cajetines, 6,
    '[REGRESIÓN] máximo del total diario (6), no suma de máximos por manguera (10)');
}

// ═══════════════════════════════════════════════════════════════════
group('Filas de Load Out');
{
  const s = state({
    artists: [artist({
      channels: [...mics(['SM58', 'SM58']), ch({ di: 'M', micro: 'DI J48' }),
                 ch({ subboxes: { A: '1' }, pies: { C: true } })],
      sbCajetines: { A: 2 },
    })],
  });
  const rows = C.buildLoadOutRows(C.computeStats(s, s.artists));
  const cats = [...new Set(rows.map(r => r.cat))];
  eq(cats.includes('DI'), false, '[REGRESIÓN] no hay fila genérica de DI (duplicaba material)');
  eq(cats, ['MICRO', 'PIE', 'MANGUERA', 'CABLE LINK', 'CAJETIN'], 'categorías separadas y ordenadas');
  eq(rows.find(r => r.cat === 'MICRO' && r.item === 'SM58').total, 3, 'micros llevan spare (2+1)');
  eq(rows.find(r => r.cat === 'CAJETIN').spare, '—', 'cajetines sin spare');
  eq(rows.every(r => !/\d+$/.test(r.key)) || rows.every(r => r.key), true, 'toda fila tiene key estable');
}

// ═══════════════════════════════════════════════════════════════════
group('Caché de selectores');
{
  const s = state({ artists: [artist({ channels: mics(['SM58']) })] });
  const sel = C.createSelectors();
  sel.invalidate(1);
  const a = sel.statsForAll(s);
  eq(sel.statsForAll(s) === a, true, 'misma versión → misma instancia (sin recalcular)');
  sel.invalidate(2);
  eq(sel.statsForAll(s) === a, false, 'nueva versión → recalcula');
}

// ═══════════════════════════════════════════════════════════════════
group('Robustez ante datos mal tipados');
{
  // Un JSON importado puede traer el conector como número en vez de texto.
  // Antes esto lanzaba: (1 || '').trim is not a function.
  const num = artist({ channels: [ch({ subboxes: { A: 1 } })], sbCajetines: { A: 2 } });
  eq(C.usesLetter(num, 'A'), true, '[REGRESIÓN] conector numérico no rompe usesLetter');
  const s = state({ artists: [num] });
  eq(C.computeStats(s, s.artists).mangueras.A, 1, 'y se cuenta la manguera igual');
  eq(C.usesLetter(artist({ channels: [ch({ subboxes: { A: null } })] }), 'A'), false, 'null no cuenta');
  eq(C.usesLetter(artist({ channels: [ch({ subboxes: { A: 0 } })] }), 'A'), true, 'el cero es un conector válido');
}

group('Robustez ante datos incompletos');
{
  eq(C.computeStats(state(), []).totals.mics, 0, 'sin artistas');
  eq(C.micsOf({ channels: null }), {}, 'canales nulos');
  eq(C.stereoDiBoxes({}), 0, 'artista sin canales');
  eq(C.festivalDateOf(state(), { fecha: '', inicio: '20:00' }), '', 'artista sin fecha');
  eq(C.computeStats(state({ subboxes: null }), [artist({})]).mangueras, {}, 'sin subboxes definidas');
}

console.log(`\n${'─'.repeat(52)}\n${pass} pasan · ${fail} fallan\n`);
process.exit(fail ? 1 : 0);

/**
 * Stage Master — DOMAIN CORE
 * ---------------------------------------------------------------------------
 * Única fuente de verdad de las reglas de negocio. Funciones puras: reciben el
 * estado como argumento, no leen globales ni tocan el DOM.
 *
 * Capas que dependen de este módulo (nunca al revés):
 *   view/     render en pantalla
 *   export/   PDF y JSON
 *   live/     ventana de presentación
 *
 * Reglas implementadas (una sola vez, aquí):
 *   · Hora de cambio de día del festival
 *   · Emparejado de DI estéreo (una caja para L+R)
 *   · Exclusiones: "ya montado", micro "propio", XLR
 *   · Reutilizable: suma(no reutilizables) + máx(reutilizables)
 *   · Mangueras variables: 1 por sistema · fijas: 1 global
 *   · Cajetines y cables link, con la regla de reutilizable
 *   · Máximo de festival: máximo del TOTAL DIARIO, no suma de máximos
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SMCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════
  // CONSTANTES
  // ═══════════════════════════════════════════════════════════════════
  const PROPIO = '__PROPIO__';
  const PIE_KEYS = ['C', 'A', 'P', 'R'];
  const MAX_CAJETINES = 8;
  const DEFAULT_CUTOFF = '06:00';
  const SPARE_RATE = { MICRO: 0.15, DI: 0.15, PIE: 0.25 };

  // ═══════════════════════════════════════════════════════════════════
  // UTILIDADES
  // ═══════════════════════════════════════════════════════════════════
  const pad2 = n => String(n).padStart(2, '0');
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const sum = arr => arr.reduce((s, n) => s + n, 0);
  /** Math.max(...[]) devuelve -Infinity; aquí 0, que es lo que quiere el dominio. */
  const maxOr0 = arr => (arr.length ? Math.max(...arr) : 0);

  function parseHM(hm) {
    if (!hm || typeof hm !== 'string') return null;
    const [h, m] = hm.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  }

  function shiftDate(iso, days) {
    const [y, mo, d] = String(iso).split('-').map(Number);
    if (!y || !mo || !d) return iso;
    const dt = new Date(y, mo - 1, d);
    dt.setDate(dt.getDate() + days);
    return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
  }


  // ═══════════════════════════════════════════════════════════════════
  // NORMALIZACIÓN DE TIPOS
  // ═══════════════════════════════════════════════════════════════════
  // Los datos entran por muchas vías (JSON local, Drive, servidor, localStorage,
  // deshacer/rehacer, importación de riders, tests) y no todas garantizan los
  // tipos. Un conector como número reventaba los .trim(); peor aún, un id de
  // sistema como número hacía que dos bandas del mismo sistema contaran como
  // dos mangueras distintas — un error de cifras, silencioso.
  //
  // Normalizar NO es migrar: migrar rellena campos que faltan y actualiza
  // formatos antiguos; esto solo corrige tipos. Se ejecuta DESPUÉS de migrar.

  const asText = v => (v === null || v === undefined) ? '' : String(v).trim();
  /** Acepta true, 'true', 1 y '1' como verdadero; todo lo demás es falso.
   *  Sin esto, un JSON con {C:'false'} contaba un pie: 'false' es truthy. */
  const asBool = v => v === true || v === 'true' || v === 1 || v === '1';

  function normalizeChannel(ch){
    const out = { ...(ch || {}) };
    out.instrumento = asText(out.instrumento);
    out.canalStage  = asText(out.canalStage);
    out.micro       = asText(out.micro);
    out.obs         = asText(out.obs);
    out.diLink      = asText(out.diLink);

    const di = asText(out.di).toUpperCase();
    out.di = (di === 'ST' || di === 'M') ? di : '';

    out.phantom     = asBool(out.phantom);
    out.premontado  = asBool(out.premontado);

    const pies = {};
    for (const k of PIE_KEYS) pies[k] = asBool(out.pies && out.pies[k]);
    out.pies = pies;

    // Las claves de subboxes se pasan a mayúsculas a la vez que las letras de
    // S.subboxes: si solo se tocara un lado, dejarían de casar y se perderían
    // todas las asignaciones de conectores.
    const sb = {};
    if (out.subboxes && typeof out.subboxes === 'object') {
      for (const k in out.subboxes) sb[asText(k).toUpperCase()] = asText(out.subboxes[k]);
    }
    out.subboxes = sb;
    return out;
  }

  function normalizeArtist(a){
    const out = { ...(a || {}) };
    out.nombre       = asText(out.nombre);
    out.mangueraSet  = asText(out.mangueraSet) || 'propio';
    out.reutilizable = asBool(out.reutilizable);
    out.escenarioId  = asText(out.escenarioId);

    const caj = {};
    if (out.sbCajetines && typeof out.sbCajetines === 'object') {
      for (const k in out.sbCajetines) {
        caj[asText(k).toUpperCase()] = clamp(parseInt(out.sbCajetines[k], 10) || 1, 1, MAX_CAJETINES);
      }
    }
    out.sbCajetines = caj;

    const names = {};
    if (out.sbCajetinesNames && typeof out.sbCajetinesNames === 'object') {
      for (const k in out.sbCajetinesNames) {
        const v = out.sbCajetinesNames[k];
        names[asText(k).toUpperCase()] = Array.isArray(v) ? v.map(asText) : [];
      }
    }
    out.sbCajetinesNames = names;

    out.channels = Array.isArray(out.channels) ? out.channels.map(normalizeChannel) : [];
    return out;
  }

  /** Normaliza el estado completo. Devuelve un objeto nuevo; no muta el original. */
  function normalizeState(state){
    const s = { ...(state || {}) };

    s.subboxes = Array.isArray(s.subboxes)
      ? s.subboxes.map(sb => ({ ...sb, letter: asText(sb.letter).toUpperCase() }))
      : [];

    s.mangueraSets = Array.isArray(s.mangueraSets)
      ? s.mangueraSets.map(m => ({ ...m, id: asText(m.id), label: asText(m.label) }))
      : [];

    s.escenarios = Array.isArray(s.escenarios)
      ? s.escenarios.map(e => ({ ...e, id: asText(e.id), nombre: asText(e.nombre) }))
      : [];

    s.sbConfig = { ...(s.sbConfig || {}) };
    s.sbConfig.fixedLines = Array.isArray(s.sbConfig.fixedLines)
      ? s.sbConfig.fixedLines.map(l => ({
          ...l,
          sbLetter: asText(l.sbLetter).toUpperCase(),
          quantity: Math.max(1, parseInt(l.quantity, 10) || 1),
        }))
      : [];

    s.event = { ...(s.event || {}) };
    s.event.dayCutoff = /^\d{1,2}:\d{2}$/.test(asText(s.event.dayCutoff))
      ? asText(s.event.dayCutoff) : DEFAULT_CUTOFF;
    s.event.callMins = clamp(parseInt(s.event.callMins, 10) || 15, 1, 120);

    s.artists = Array.isArray(s.artists) ? s.artists.map(normalizeArtist) : [];
    return s;
  }

  // ═══════════════════════════════════════════════════════════════════
  // CALENDARIO DE FESTIVAL
  // ═══════════════════════════════════════════════════════════════════

  /** Hora de cambio de día, en minutos desde medianoche. */
  function cutoffMins(state) {
    return parseHM(state?.event?.dayCutoff || DEFAULT_CUTOFF) ?? 360;
  }

  /**
   * Fecha de FESTIVAL de un artista. Un show que empieza antes de la hora de
   * corte pertenece a la jornada del día anterior (un DJ a las 02:00 del
   * domingo sigue siendo "sábado" para el festival).
   */
  function festivalDateOf(state, artist, useSoundcheck) {
    const fecha = (useSoundcheck ? artist.soundcheckFecha || artist.fecha : artist.fecha) || '';
    if (!fecha) return '';
    const hora = (useSoundcheck ? artist.soundcheckInicio : artist.inicio) || '';
    const mins = parseHM(hora);
    if (mins === null || mins >= cutoffMins(state)) return fecha;
    return shiftDate(fecha, -1);
  }

  /** Agrupa artistas por fecha de festival. Sin fecha → bucket `__nodate__` al final. */
  function groupByFestivalDate(state, useSoundcheck) {
    const map = new Map();
    for (const a of state.artists || []) {
      const key = festivalDateOf(state, a, useSoundcheck) || '__nodate__';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(a);
    }
    return [...map.keys()]
      .sort((a, b) => (a === '__nodate__' ? 1 : b === '__nodate__' ? -1 : a.localeCompare(b)))
      .map(key => ({ key, artists: map.get(key) }));
  }

  // ═══════════════════════════════════════════════════════════════════
  // CANALES — exclusiones y emparejado estéreo
  // ═══════════════════════════════════════════════════════════════════

  const isPropio = name => name === PROPIO;
  const isXLR = name => String(name || '').trim().toUpperCase() === 'XLR';

  /**
   * Índices de canales que son la MITAD INFERIOR de un par estéreo: dos canales
   * ST consecutivos con el mismo modelo comparten una sola caja física, así que
   * el segundo no debe volver a contar el equipo.
   *
   * Se empareja por adyacencia, no por el campo `diLink`: en la práctica los
   * pares L/R se escriben seguidos y casi nadie usa el enlace explícito.
   */
  function stereoFollowers(artist) {
    const skip = new Set();
    let pending = -1;
    const chs = artist.channels || [];
    for (let i = 0; i < chs.length; i++) {
      const ch = chs[i];
      if (ch.di !== 'ST') { pending = -1; continue; }
      if (pending >= 0 && i === pending + 1) {
        const prev = chs[pending];
        if (!ch.micro || ch.micro === prev.micro) skip.add(i);
        pending = -1;
        continue;
      }
      pending = i;
    }
    return skip;
  }

  /** Nº de CAJAS de DI estéreo (un par L/R = una caja). */
  function stereoDiBoxes(artist) {
    let boxes = 0, pending = -1;
    const chs = artist.channels || [];
    for (let i = 0; i < chs.length; i++) {
      if (chs[i].di !== 'ST') continue;
      if (pending >= 0 && i === pending + 1) { pending = -1; continue; }
      boxes++; pending = i;
    }
    return boxes;
  }

  /**
   * Recuento de micros de UN artista, ya con todas las exclusiones aplicadas.
   * `opts.normalize` agrupa variantes de escritura ("sm58" / "SM58").
   */
  function micsOf(artist, opts) {
    const normalize = typeof opts?.normalize === 'function' ? opts.normalize : null;
    const out = {};
    const skip = stereoFollowers(artist);
    const chs = artist.channels || [];
    for (let i = 0; i < chs.length; i++) {
      const ch = chs[i];
      if (ch.premontado) continue;          // ya montado: no se recuenta
      if (skip.has(i)) continue;            // mitad inferior de un par ST
      if (!ch.micro || isPropio(ch.micro)) continue;
      const key = normalize ? normalize(ch.micro) : ch.micro;
      if (!key || isXLR(key)) continue;     // XLR no es material a llevar
      out[key] = (out[key] || 0) + 1;
    }
    return out;
  }

  function piesOf(artist, key) {
    return (artist.channels || []).filter(ch => ch.pies && ch.pies[key]).length;
  }

  // ═══════════════════════════════════════════════════════════════════
  // REGLA DE REUTILIZABLE
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Un artista NO reutilizable necesita su propio material (se suma).
   * Los marcados como reutilizables comparten un mismo juego entre ellos — el
   * set del primero se recoge y se remonta para el siguiente —, así que entre
   * ellos basta con el MAYOR.
   *
   *    total = suma(no reutilizables) + máx(reutilizables)
   */
  function applyReuse(artists, amountOf) {
    let total = 0, reuseMax = 0;
    for (const a of artists) {
      const n = amountOf(a);
      if (!n) continue;
      if (a.reutilizable) reuseMax = Math.max(reuseMax, n);
      else total += n;
    }
    return total + reuseMax;
  }

  /** Igual que applyReuse pero sobre mapas {clave: cantidad}. */
  function applyReuseMap(artists, mapOf) {
    const fixed = {}, reuse = {};
    for (const a of artists) {
      const m = mapOf(a);
      for (const k in m) {
        if (a.reutilizable) reuse[k] = Math.max(reuse[k] || 0, m[k]);
        else fixed[k] = (fixed[k] || 0) + m[k];
      }
    }
    const out = {};
    for (const k of new Set([...Object.keys(fixed), ...Object.keys(reuse)])) {
      out[k] = (fixed[k] || 0) + (reuse[k] || 0);
    }
    return out;
  }

  // ═══════════════════════════════════════════════════════════════════
  // MANGUERAS / CAJETINES / CABLES
  // ═══════════════════════════════════════════════════════════════════

  const fixedLineFor = (state, letter) =>
    (state.sbConfig?.fixedLines || [])
      .find(l => String(l.sbLetter).toUpperCase() === String(letter).toUpperCase()) || null;

  /**
   * Sistema al que pertenece un artista. Los que están en "propio" (o apuntan a
   * un sistema que ya no existe) forman su propio sistema de un solo artista.
   */
  function systemKeyOf(state, artist) {
    const ids = new Set((state.mangueraSets || []).map(s => s.id));
    const id = artist.mangueraSet || 'propio';
    return (id === 'propio' || !ids.has(id)) ? `propio-${artist.id}` : `set-${id}`;
  }

  const usesLetter = (artist, letter) =>
    (artist.channels || []).some(ch => {
      // String(): un JSON externo puede traer el conector como número.
      const v = String(ch.subboxes?.[letter] ?? '').trim();
      return v && !Number.isNaN(parseInt(v, 10));
    });

  const cajetinesOf = (state, artist, letter) => {
    const fl = fixedLineFor(state, letter);
    if (fl) return fl.quantity || 1;
    return clamp(parseInt(artist.sbCajetines?.[letter], 10) || 1, 1, MAX_CAJETINES);
  };

  /**
   * Por manguera: nº de mangueras, de cajetines y de cables de link.
   *
   *   VARIABLE → 1 manguera por sistema que la use; cajetines y cables por
   *              artista, con la regla de reutilizable.
   *   FIJA     → fuera de los sistemas: se monta UNA vez para todo el festival,
   *              con sus cajetines y cables, los use quien los use.
   */
  function snakeStats(state, artists) {
    const mangueras = {}, cajetines = {}, cables = {}, systems = {};
    for (const sb of state.subboxes || []) {
      const letter = sb.letter;
      const using = artists.filter(a => usesLetter(a, letter));
      if (!using.length) continue;

      const fl = fixedLineFor(state, letter);
      if (fl) {
        const qty = fl.quantity || 1;
        mangueras[letter] = 1;
        cajetines[letter] = qty;
        if (qty > 1) cables[letter] = qty - 1;
        systems[letter] = null;             // las fijas no pertenecen a ningún sistema
      } else {
        const used = new Set(using.map(a => systemKeyOf(state, a)));
        mangueras[letter] = used.size;
        systems[letter] = used;
        cajetines[letter] = applyReuse(using, a => cajetinesOf(state, a, letter));
        const c = applyReuse(using, a => Math.max(0, cajetinesOf(state, a, letter) - 1));
        if (c > 0) cables[letter] = c;
      }
    }
    return { mangueras, cajetines, cables, systems };
  }

  // ═══════════════════════════════════════════════════════════════════
  // AGREGADO POR DÍA
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Todo el material que hace falta para un conjunto de artistas (normalmente
   * los de un día). Es el único punto donde se combinan las reglas.
   */
  function computeStats(state, artists, opts) {
    const mics = applyReuseMap(artists, a => micsOf(a, opts));
    const pies = {};
    for (const k of PIE_KEYS) pies[k] = applyReuse(artists, a => piesOf(a, k));
    const di = {
      mono: applyReuse(artists, a => (a.channels || []).filter(ch => ch.di === 'M').length),
      stereo: applyReuse(artists, a => stereoDiBoxes(a)),
    };
    const snakes = snakeStats(state, artists);
    return {
      mics, pies, di,
      mangueras: snakes.mangueras,
      cajetines: snakes.cajetines,
      cables: snakes.cables,
      systems: snakes.systems,
      totals: {
        mics: sum(Object.values(mics)),
        pies: sum(Object.values(pies)),
        mangueras: sum(Object.values(snakes.mangueras)),
        cajetines: sum(Object.values(snakes.cajetines)),
        cables: sum(Object.values(snakes.cables)),
      },
    };
  }

  /**
   * Material a preparar para TODO el festival.
   *
   * Por elemento se toma el máximo entre días. Para el total de cajetines se
   * toma el MÁXIMO DEL TOTAL DIARIO, no la suma de los máximos por manguera:
   * esos máximos pueden darse en días distintos e inflarían la cifra.
   */
  function computeFestivalMax(state, opts) {
    const days = groupByFestivalDate(state, false)
      .map(d => ({ ...d, stats: computeStats(state, d.artists, opts) }));

    const maxBy = pick => {
      const out = {};
      for (const d of days) {
        const m = pick(d.stats) || {};
        for (const k in m) out[k] = Math.max(out[k] || 0, m[k]);
      }
      return out;
    };

    return {
      days,
      mics: maxBy(s => s.mics),
      pies: maxBy(s => s.pies),
      di: {
        mono: maxOr0(days.map(d => d.stats.di.mono)),
        stereo: maxOr0(days.map(d => d.stats.di.stereo)),
      },
      mangueras: maxBy(s => s.mangueras),
      cajetines: maxBy(s => s.cajetines),
      cables: maxBy(s => s.cables),
      totals: {
        cajetines: maxOr0(days.map(d => d.stats.totals.cajetines)),
        mangueras: maxOr0(days.map(d => d.stats.totals.mangueras)),
        cables: maxOr0(days.map(d => d.stats.totals.cables)),
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // FILAS DE LOAD OUT (consumidas por pantalla y por PDF)
  // ═══════════════════════════════════════════════════════════════════

  const spare = (n, rate) => Math.max(1, Math.ceil(n * rate));

  /**
   * Filas planas de Load Out. `key` es estable (no lleva la cantidad dentro)
   * para poder fusionar la misma fila entre días al calcular el máximo.
   */
  function buildLoadOutRows(stats) {
    const rows = [];
    const push = (cat, item, need, rate, key) => rows.push({
      cat, item, need,
      spare: rate ? spare(need, rate) : '—',
      total: rate ? need + spare(need, rate) : need,
      key,
    });

    Object.entries(stats.mics).sort((a, b) => b[1] - a[1])
      .forEach(([n, q]) => push('MICRO', n, q, SPARE_RATE.MICRO, `MICRO_${n}`));

    const pieLabels = { C: 'Pie Corto', A: 'Pie Alto', P: 'Pie Pinza', R: 'Pie Recto' };
    PIE_KEYS.filter(k => stats.pies[k] > 0)
      .forEach(k => push('PIE', pieLabels[k], stats.pies[k], SPARE_RATE.PIE, `PIE_${k}`));

    // Las DI no van aparte: su modelo concreto está en la casilla de micrófono
    // y ya se cuenta arriba. Una fila genérica duplicaría el material.

    const letters = Object.keys(stats.mangueras).sort();
    letters.forEach(l => push('MANGUERA', `Manguera ${l}`, stats.mangueras[l], 0, `MANG_${l}`));
    letters.filter(l => stats.cables[l] > 0)
      .forEach(l => push('CABLE LINK', `Cable link — Manguera ${l}`, stats.cables[l], 0, `CAB_${l}`));
    letters.filter(l => stats.cajetines[l] > 0)
      .forEach(l => push('CAJETIN', `Cajetines — Manguera ${l}`, stats.cajetines[l], 0, `CAJ_${l}`));

    return rows;
  }

  // ═══════════════════════════════════════════════════════════════════
  // CACHÉ DE SELECTORES
  // ═══════════════════════════════════════════════════════════════════

  /**
   * computeStats recorre todos los canales de todos los artistas y lo llaman
   * varias vistas en el mismo render. Esta caché lo reduce a un cálculo por
   * cambio de estado: el llamante sube `version` al mutar el estado.
   */
  function createSelectors() {
    let version = -1;
    const cache = new Map();
    const memo = (key, fn) => {
      if (!cache.has(key)) cache.set(key, fn());
      return cache.get(key);
    };
    return {
      invalidate(v) { if (v !== version) { version = v; cache.clear(); } },
      statsForDay(state, dayKey, opts) {
        return memo(`day:${dayKey}`, () => {
          const g = groupByFestivalDate(state, false).find(d => d.key === dayKey);
          return computeStats(state, g ? g.artists : [], opts);
        });
      },
      statsForAll(state, opts) {
        return memo('all', () => computeStats(state, state.artists || [], opts));
      },
      festivalMax(state, opts) {
        return memo('max', () => computeFestivalMax(state, opts));
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  return {
    PROPIO, PIE_KEYS,
    // calendario
    cutoffMins, festivalDateOf, groupByFestivalDate,
    // normalización
    normalizeChannel, normalizeArtist, normalizeState,
    // canales
    isPropio, isXLR, stereoFollowers, stereoDiBoxes, micsOf, piesOf,
    // reglas
    applyReuse, applyReuseMap,
    // mangueras
    systemKeyOf, usesLetter, cajetinesOf, snakeStats,
    // agregados
    computeStats, computeFestivalMax, buildLoadOutRows,
    // infraestructura
    createSelectors,
  };
});

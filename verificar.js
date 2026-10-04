#!/usr/bin/env node
/* verificar.js — comprobaciones rápidas de Stage Master
   Uso: node verificar.js   (desde la carpeta del proyecto)

   1 · Los tests del dominio pasan
   2 · No hay código mutilado por ediciones masivas
   3 · Las dos copias del dominio son IDÉNTICAS, carácter a carácter
   4 · El JavaScript de index.html compila

   Lo que esto NO comprueba: que la app se vea bien. Eso solo lo dice abrirla.

   v3 — dos fragilidades corregidas:
     · Chequeo 3: el fin del bloque se ancla al </script> en vez de a la primera
       línea "});", que podía aparecer sin indentar dentro del dominio y dar
       un "han divergido" falso.
     · Chequeo 4: cada bloque <script> se comprueba por separado; concatenarlos
       producía falsos "error de sintaxis" si dos bloques declaraban el mismo
       const de nivel superior. */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let fallos = 0;
const FICHEROS = ['index.html', 'sm-core.js'];

for (const f of FICHEROS) {
  if (!fs.existsSync(f)) {
    console.log('❌ No encuentro ' + f + '. ¿Estás en la carpeta del proyecto?');
    process.exit(1);
  }
}

// ── 1 · Tests del dominio ───────────────────────────────────────────
console.log('\n── 1/4 · Tests del dominio ──');
if (!fs.existsSync('sm-core.test.js')) {
  console.log('⚠️  No encuentro sm-core.test.js — me salto los tests');
} else {
  const t = spawnSync('node', ['sm-core.test.js'], { encoding: 'utf8' });
  const salida = (t.stdout || '') + (t.stderr || '');
  const resumen = salida.split('\n').filter(l => /pasan|fallan/.test(l)).pop() || '';
  if (t.status === 0 && /0 fallan/.test(salida)) {
    console.log('✅ Tests OK — ' + (resumen.trim() || 'sin resumen'));
  } else {
    console.log('❌ Los tests no han pasado:');
    console.log(salida.split('\n').slice(-25).join('\n'));
    fallos++;
  }
}

// ── 2 · Código mutilado por ediciones masivas ───────────────────────
// Heurístico: puede avisar de un ",," o un ".." que estén dentro de un texto.
// Los comentarios se ignoran.
console.log('\n── 2/4 · Código mutilado ──');
const patrones = [
  { nombre: 'identificador duplicado',   re: /\b([A-Za-z_$][A-Za-z0-9_$]{2,})\1\s*\(/ },
  { nombre: 'palabra clave duplicada',   re: /\b(const|let|var|return|function|await|typeof|new)\s+\1\b/ },
  { nombre: 'String anidado sospechoso', re: /\bString\s*\(\s*String\s*\(/ },
  { nombre: 'punto doble',               re: /[A-Za-z_$)\]]\.\.[A-Za-z_$]/ },
  { nombre: 'coma doble en argumentos',  re: /\(\s*,|,\s*,\s*[^\s)]/ },
];
let hallazgos = 0;
for (const f of FICHEROS) {
  fs.readFileSync(f, 'utf8').split('\n').forEach((linea, i) => {
    const codigo = linea.split('//')[0];
    if (!codigo.trim()) return;
    for (const p of patrones) {
      if (p.re.test(codigo)) {
        console.log('   ' + f + ':' + (i + 1) + '  [' + p.nombre + ']  ' + codigo.trim().slice(0, 90));
        hallazgos++;
      }
    }
  });
}
if (!hallazgos) console.log('✅ Sin mutilaciones detectadas');
else { console.log('❌ ' + hallazgos + ' posible(s) — revísalo antes de dar nada por bueno'); fallos++; }

// ── 3 · Las dos copias del dominio, idénticas ───────────────────────
// Comparar solo los NOMBRES no basta: si una función cambia de cuerpo en una
// copia y no en la otra, los nombres siguen estando y el fallo pasa inadvertido.
// Por eso se comparan los dos bloques carácter a carácter.
console.log('\n── 3/4 · Copias de sm-core.js idénticas ──');
const core = fs.readFileSync('sm-core.js', 'utf8').trim();
const htmlLineas = fs.readFileSync('index.html', 'utf8').split('\n');
const ini = htmlLineas.findIndex(l => l.includes('Stage Master — DOMAIN CORE'));
if (ini < 0) {
  console.log('❌ No encuentro el bloque del dominio dentro de index.html');
  fallos++;
} else {
  // El fin del bloque se ancla al </script> que lo cierra (mucho más fiable
  // que buscar la primera línea "});" del interior).
  const cierre = htmlLineas.findIndex((l, i) => i > ini && l.includes('</script>'));
  let incrustado = null;
  if (cierre > ini) {
    incrustado = htmlLineas.slice(ini - 1, cierre).join('\n').replace(/<\/script>\s*$/, '').trim();
  } else {
    // Reserva: si no hay </script> tras el marcador, escaneo clásico de "});"
    for (let i = ini; i < Math.min(ini + 800, htmlLineas.length); i++) {
      if (htmlLineas[i] === '});') { incrustado = htmlLineas.slice(ini - 1, i + 1).join('\n').trim(); break; }
    }
  }
  if (incrustado === null) {
    console.log('❌ No encuentro el final del bloque del dominio en index.html');
    fallos++;
  } else if (incrustado === core) {
    console.log('✅ Las dos copias son idénticas (' + core.split('\n').length + ' líneas)');
  } else {
    console.log('❌ LAS COPIAS HAN DIVERGIDO. Primeras diferencias:');
    const a = core.split('\n'), b = incrustado.split('\n');
    let mostradas = 0;
    for (let i = 0; i < Math.max(a.length, b.length) && mostradas < 6; i++) {
      if (a[i] !== b[i]) {
        console.log('   línea ' + (i + 1));
        console.log('     sm-core.js : ' + (a[i] === undefined ? '(no existe)' : a[i].trim().slice(0, 80)));
        console.log('     index.html : ' + (b[i] === undefined ? '(no existe)' : b[i].trim().slice(0, 80)));
        mostradas++;
      }
    }
    fallos++;
  }
}

// ── 4 · El JavaScript de index.html compila ─────────────────────────
// Un error de sintaxis dentro de un <script> no se ve hasta abrir la app.
// Cada bloque se comprueba por separado: concatenarlos daría falsos positivos
// si dos bloques declaran el mismo const de nivel superior.
console.log('\n── 4/4 · Sintaxis de index.html ──');
const html = fs.readFileSync('index.html', 'utf8');
const bloques = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (!bloques.length) {
  console.log('⚠️  No he encontrado bloques <script> en index.html');
} else {
  const os = require('os');
  let malos = 0;
  bloques.forEach((bloque, n) => {
    const tmp = path.join(os.tmpdir(), 'sm-sintaxis-' + Date.now() + '-' + n + '.js');
    fs.writeFileSync(tmp, bloque);
    const r = spawnSync('node', ['--check', tmp], { encoding: 'utf8' });
    fs.unlinkSync(tmp);
    if (r.status !== 0) {
      console.log('❌ Bloque <script> nº ' + (n + 1) + ' con error de sintaxis:');
      console.log((r.stderr || '').split('\n').slice(0, 8).join('\n'));
      malos++;
    }
  });
  if (!malos) console.log('✅ Los ' + bloques.length + ' bloques <script> compilan');
  else fallos++;
}

// ── Resultado ───────────────────────────────────────────────────────
console.log('\n──────────────────────────────');
if (fallos === 0) {
  console.log('🎉 Todo OK.');
  console.log('   Esto no comprueba que la app se VEA bien: ábrela, entra en un par');
  console.log('   de CH lists, mira Load Out y pasa smCheck() en la consola.');
} else {
  console.log('⚠️  ' + fallos + ' comprobación(es) con problemas.');
  process.exit(1);
}

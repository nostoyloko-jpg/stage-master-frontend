#!/usr/bin/env node
/* verificar.js — comprobaciones rápidas de Stage Master
   Uso: node verificar.js   (desde la carpeta del proyecto) */

const { spawnSync } = require('child_process');
const fs = require('fs');
let fallos = 0;
const FICHEROS = ['index.html', 'sm-core.js'];

for (const f of FICHEROS) {
  if (!fs.existsSync(f)) { console.log('❌ No encuentro ' + f + '. ¿Estás en la carpeta del proyecto?'); process.exit(1); }
}

// 1 · Tests del dominio
console.log('\n── 1/3 · Tests del dominio ──');
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

// 2 · Código mutilado por ediciones masivas
console.log('\n── 2/3 · Código mutilado ──');
const patrones = [
  { nombre: 'identificador duplicado', re: /\b([A-Za-z_$][A-Za-z0-9_$]{2,})\1\s*\(/ },
  { nombre: 'palabra clave duplicada', re: /\b(const|let|var|return|function|await|typeof|new)\s+\1\b/ },
  { nombre: 'String anidado sospechoso', re: /\bString\s*\(\s*String\s*\(/ }
];
let hallazgos = 0;
for (const f of FICHEROS) {
  fs.readFileSync(f, 'utf8').split('\n').forEach((linea, i) => {
    for (const p of patrones) {
      if (p.re.test(linea)) { console.log('   ' + f + ':' + (i + 1) + '  [' + p.nombre + ']  ' + linea.trim().slice(0, 90)); hallazgos++; }
    }
  });
}
if (!hallazgos) console.log('✅ Sin mutilaciones detectadas');
else { console.log('❌ ' + hallazgos + ' posible(s) — revísalo antes de dar nada por bueno'); fallos++; }

// 3 · Las dos copias del dominio, sincronizadas
console.log('\n── 3/3 · Copias de sm-core.js sincronizadas ──');
const core = fs.readFileSync('sm-core.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const nombres = new Set();
for (const m of core.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)) nombres.add(m[1]);
for (const m of core.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) nombres.add(m[1]);
const faltan = [...nombres].filter(n => !html.includes(n));
if (nombres.size === 0) console.log('⚠️  No he detectado funciones/constantes en sm-core.js');
else if (!faltan.length) console.log('✅ Las ' + nombres.size + ' funciones/constantes del dominio están también en index.html');
else { console.log('❌ En index.html faltan: ' + faltan.join(', ') + ' — las copias han divergido'); fallos++; }

console.log('\n──────────────────────────────');
if (fallos === 0) console.log('🎉 Todo OK. Recuerda: abre la app y mira las vistas.');
else { console.log('⚠️  ' + fallos + ' comprobación(es) con problemas.'); process.exit(1); }

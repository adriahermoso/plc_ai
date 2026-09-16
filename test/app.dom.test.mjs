import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';

let pass = 0, fail = 0;
function ok(desc, cond) { if (cond) { pass++; console.log('OK   ', desc); } else { fail++; console.log('FALLO', desc); } }

const html = `<!DOCTYPE html><html><body>
<button id="btnParse"></button>
<button id="btnReset"></button>
<button id="btnTick"></button>
<select id="examples">
  <option value="">Elegir…</option>
  <option value="lights">lights</option>
</select>
<span id="exampleDesc"></span>
<div id="chips"></div>
<textarea id="src"></textarea>
<svg id="svg"></svg>
<div id="toast"></div>
<div id="status"></div>
<span id="tickLabel"></span>
<span id="clockLabel"></span>
<span id="runLabel"></span>
</body></html>`;

const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
// OJO: no sobrescribir global.performance con dom.window.performance —
// jsdom y el performance nativo de Node se llaman entre sí infinitamente
// (recursión) si se mezclan así. El performance nativo de Node ya sirve.
global.MouseEvent = dom.window.MouseEvent;

await import('../js/app.js');

const $ = id => document.getElementById(id);

// 1. arranque: el ejemplo "lights" se carga solo y compila sin error
ok('status inicial contiene "OK"', $('status').textContent.includes('OK'));
ok('el toast de error está oculto tras arrancar bien', $('toast').style.display !== 'block');
ok('se crearon 2 chips de entrada (SB1, SB2)', $('chips').children.length === 2);
ok('el runLabel dice RUN tras cargar', $('runLabel').textContent === 'RUN');

const svgBefore = $('svg').innerHTML;
const liveBefore = (svgBefore.match(/var\(--live-soft\)/g) || []).length;
ok('nada está encendido en reposo', liveBefore === 0);

// 2. pulsar SB1 (momentáneo): debe activar el LATCH "RUN"
const chipSB1 = [...$('chips').children].find(b => b.textContent === 'SB1');
ok('existe el chip SB1', !!chipSB1);
chipSB1.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
// jsdom no soporta PointerEvent con propiedades completas en todas las versiones;
// onpointerdown está asignado directamente como propiedad, así que lo invocamos
// igual que lo haría el navegador al recibir el evento:
if (typeof chipSB1.onpointerdown === 'function') {
  chipSB1.onpointerdown({ preventDefault() {} });
}
const liveAfterPress = ($('svg').innerHTML.match(/var\(--live-soft\)/g) || []).length;
ok('al pulsar SB1 algo se enciende (RUN)', liveAfterPress > 0);
ok('el status refleja "SB1 = 1"', $('status').textContent.includes('SB1 = 1'));

if (typeof chipSB1.onpointerup === 'function') chipSB1.onpointerup();
ok('al soltar SB1 el status refleja "SB1 = 0"', $('status').textContent.includes('SB1 = 0'));
const liveAfterRelease = ($('svg').innerHTML.match(/var\(--live-soft\)/g) || []).length;
ok('RUN sigue encendido tras soltar (auto-retención)', liveAfterRelease > 0);

// 3. esperar tiempo real y comprobar que la cascada de temporizadores avanza
await new Promise(r => setTimeout(r, 2300));
const svgAfterWait = $('svg').innerHTML;
ok('tras ~2.3s el temporizador T1 ya cuenta (aparece "1/2" o "2/2")',
   /1\/2/.test(svgAfterWait) || /2\/2/.test(svgAfterWait));
ok('tickLabel avanza con tiempo real', parseFloat($('tickLabel').textContent.replace('t = ', '')) > 1.5);

// 4. error de oscilación se distingue de error de sintaxis
// (sin entradas de por medio, para que oscile ya en el primer settle())
$('src').value = 'COIL M2 = !M2';
$('btnParse').onclick();
ok('estado marca error de simulación (no de sintaxis) para una oscilación',
   $('status').textContent.includes('simulación'));
ok('el toast de oscilación es visible', $('toast').style.display === 'block');

// 5. error de sintaxis real
$('src').value = 'ESTO NO ES VALIDO';
$('btnParse').onclick();
ok('estado marca "Error de sintaxis" para una línea no reconocida',
   $('status').textContent === 'Error de sintaxis');

console.log(`\n${pass} OK, ${fail} FALLOS`);
process.exit(fail ? 1 : 0);

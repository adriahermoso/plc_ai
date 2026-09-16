// app.js — arranque de la aplicación: reloj en tiempo real, manejo de
// estado y eventos de interfaz. Se usa TAL CUAL desde index.html y desde
// mobile.html: ambas páginas exponen los mismos IDs de elemento
// (btnParse, btnReset, btnTick, examples, chips, src, svg, toast, status,
// tickLabel, clockLabel, runLabel), así que esta lógica no se duplica.

import { parseProgram, evalAst, settle, isMom, blankState } from './core.js';
import { drawAll } from './render.js';
import { EXAMPLES } from './examples.js';

const POLL_MS = 100; // resolución del reloj/UI

let program = null;
let states = {};
let tCnt = {};    // contador visible (segundos hacia el preset)
let tEdge = {};   // muestra anterior de la entrada del timer
let tArmed = {};  // armado para OFFDELAY/PULSE
let tStart = {};  // performance.now() al iniciar la fase de temporizado
let tick = 0;
let clockOn = true;
let clockTimer = null;
let clockOrigin = 0;
let pausedTotal = 0;
let pauseStarted = null;

const el = {
  btnParse: document.getElementById('btnParse'),
  btnReset: document.getElementById('btnReset'),
  btnTick: document.getElementById('btnTick'),
  examples: document.getElementById('examples'),
  exampleDesc: document.getElementById('exampleDesc'),
  chips: document.getElementById('chips'),
  src: document.getElementById('src'),
  svg: document.getElementById('svg'),
  toast: document.getElementById('toast'),
  status: document.getElementById('status'),
  tickLabel: document.getElementById('tickLabel'),
  clockLabel: document.getElementById('clockLabel'),
  runLabel: document.getElementById('runLabel'),
};

/* ─── Reloj en tiempo real ─── */
function nowEff() {
  const n = performance.now();
  if (pauseStarted != null) return n - pausedTotal - (n - pauseStarted);
  return n - pausedTotal;
}
function startClock() {
  if (pauseStarted != null) {
    pausedTotal += performance.now() - pauseStarted;
    pauseStarted = null;
  }
  if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
  clockOn = true;
  if (!clockOrigin) clockOrigin = nowEff();
  if (el.btnTick) el.btnTick.textContent = 'Pausar reloj';
  if (el.clockLabel) { el.clockLabel.textContent = '⏱ auto'; el.clockLabel.style.color = 'var(--live)'; }
  clockTimer = setInterval(() => {
    if (!program || !clockOn) return;
    try {
      hideToast();
      tick = (nowEff() - clockOrigin) / 1000;
      runCycle();
      el.tickLabel.textContent = 't = ' + tick.toFixed(1) + ' s';
      renderChips();
      redraw();
    } catch (e) {
      showToast(e.message, false);
      stopClock(true);
    }
  }, POLL_MS);
}
function stopClock(updateUi) {
  if (clockOn && pauseStarted == null) pauseStarted = performance.now();
  clockOn = false;
  if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
  if (updateUi === false) return;
  if (el.btnTick) el.btnTick.textContent = 'Reanudar reloj';
  if (el.clockLabel) { el.clockLabel.textContent = '⏱ pausa'; el.clockLabel.style.color = 'var(--muted)'; }
}
function toggleClock() {
  if (clockOn) stopClock(true);
  else startClock();
}

function resetTimerMem(prog) {
  tCnt = {}; tEdge = {}; tArmed = {}; tStart = {};
  prog.timers.forEach(t => {
    tCnt[t.name] = 0;
    tEdge[t.name] = false;
    tArmed[t.name] = false;
    tStart[t.name] = null;
  });
}

/**
 * Temporizadores en tiempo real (performance.now).
 * Fase 1: muestrear todas las entradas con el estado actual (sin escribir salidas).
 * Fase 2: actualizar memoria interna.
 * Fase 3: escribir salidas.
 * Así un TON en cascada no "come" un segundo al siguiente en el mismo ciclo.
 */
function updateTimersRealtime() {
  if (!program) return;
  const now = nowEff();

  const samples = program.timers.map(t => ({
    t, raw: !!evalAst(t.inAst, states), prev: !!tEdge[t.name],
  }));

  samples.forEach(({ t, raw, prev }) => {
    if (t.kind === 'on') {
      if (!raw) { tStart[t.name] = null; tCnt[t.name] = 0; }
      else {
        if (tStart[t.name] == null) tStart[t.name] = now;
        const sec = (now - tStart[t.name]) / 1000;
        tCnt[t.name] = Math.min(t.preset, Math.floor(sec + 1e-9));
      }
    } else if (t.kind === 'off') {
      if (raw) { tStart[t.name] = null; tCnt[t.name] = 0; tArmed[t.name] = true; }
      else if (tArmed[t.name]) {
        if (tStart[t.name] == null) tStart[t.name] = now;
        const sec = (now - tStart[t.name]) / 1000;
        tCnt[t.name] = Math.min(t.preset, Math.floor(sec + 1e-9));
        if (sec >= t.preset) tArmed[t.name] = false;
      } else { tStart[t.name] = null; tCnt[t.name] = 0; }
    } else {
      if (raw && !prev) { tStart[t.name] = now; tArmed[t.name] = true; tCnt[t.name] = 0; }
      if (tArmed[t.name] && tStart[t.name] != null) {
        const sec = (now - tStart[t.name]) / 1000;
        tCnt[t.name] = Math.min(t.preset, Math.floor(sec + 1e-9));
        if (sec >= t.preset) tArmed[t.name] = false;
      } else if (!tArmed[t.name]) { tCnt[t.name] = 0; }
    }
    tEdge[t.name] = raw;
  });

  samples.forEach(({ t, raw }) => {
    if (t.kind === 'on') {
      states[t.name] = !!(raw && tStart[t.name] != null && (now - tStart[t.name]) / 1000 >= t.preset);
    } else if (t.kind === 'off') {
      if (raw) states[t.name] = true;
      else if (tArmed[t.name] && tStart[t.name] != null) states[t.name] = (now - tStart[t.name]) / 1000 < t.preset;
      else states[t.name] = false;
    } else {
      states[t.name] = !!(tArmed[t.name] && tStart[t.name] != null && (now - tStart[t.name]) / 1000 < t.preset);
    }
  });
}

function runCycle() {
  updateTimersRealtime();
  if (!settle(program, states)) throw new Error('No converge (oscilación / realimentación)');
}

/* ─── UI helpers ─── */
function showToast(msg, ok) {
  el.toast.textContent = msg;
  el.toast.className = 'toast' + (ok ? ' ok' : '');
  el.toast.style.display = 'block';
}
function hideToast() { el.toast.style.display = 'none'; }
function setStatus(s) { el.status.textContent = s; }
function setRun(on) {
  el.runLabel.textContent = on ? 'RUN' : 'STOP';
  el.runLabel.style.color = on ? 'var(--live)' : 'var(--muted)';
}
function redraw() {
  drawAll(el.svg, program, states, tCnt, {
    onToggleInput: name => setInput(name, !states[name]),
    onPressStart: name => setInput(name, true),
    onPressEnd: name => { if (states[name]) setInput(name, false); },
  });
}

function loadProgram(text) {
  hideToast();
  let parsed;
  try {
    parsed = parseProgram(text);
  } catch (e) {
    e.isSyntax = true;
    throw e;
  }
  program = parsed;
  states = blankState(program);
  resetTimerMem(program);
  pausedTotal = 0;
  pauseStarted = null;
  clockOrigin = nowEff();
  tick = 0;
  runCycle();
  setRun(true);
  el.tickLabel.textContent = 't = 0.0 s';
  renderChips();
  redraw();
  setStatus(`OK · ${program.inputs.length} entradas · ${program.coils.length + program.latches.length + program.timers.length} bloques · TIMER en segundos reales`);
  startClock();
}

function setInput(name, val) {
  states[name] = val;
  try {
    hideToast();
    runCycle();
    renderChips();
    redraw();
    setStatus(`${name} = ${val ? 1 : 0}`);
  } catch (e) {
    showToast(e.message, false);
  }
}

/* ─── Chips de entradas físicas ─── */
function renderChips() {
  el.chips.innerHTML = '';
  if (!program) return;
  program.inputs.forEach(name => {
    const b = document.createElement('button');
    b.className = 'chip' + (states[name] ? ' on' : '') + (isMom(name) ? ' mom' : '');
    b.textContent = name;
    if (isMom(name)) {
      b.onpointerdown = e => { e.preventDefault(); setInput(name, true); };
      b.onpointerup = () => setInput(name, false);
      b.onpointerleave = () => { if (states[name]) setInput(name, false); };
    } else {
      b.onclick = () => setInput(name, !states[name]);
    }
    el.chips.appendChild(b);
  });
}

/* ─── Controles ─── */
el.btnParse.onclick = () => {
  try {
    loadProgram(el.src.value);
  } catch (e) {
    showToast(e.message, false);
    setRun(false);
    setStatus(e.isSyntax ? 'Error de sintaxis' : 'Error de simulación (revisa la realimentación)');
  }
};

el.btnReset.onclick = () => {
  if (!program) return;
  states = blankState(program);
  resetTimerMem(program);
  pausedTotal = 0;
  pauseStarted = null;
  clockOrigin = nowEff();
  tick = 0;
  try {
    hideToast();
    runCycle();
    el.tickLabel.textContent = 't = 0.0 s';
    renderChips();
    redraw();
    setStatus('Reiniciado');
    if (!clockOn) startClock();
  } catch (e) {
    showToast(e.message, false);
  }
};

el.btnTick.onclick = () => {
  if (!program) return;
  toggleClock();
  setStatus(clockOn ? 'Reloj automático ON (segundos reales)' : 'Reloj en pausa');
};

el.examples.onchange = (e) => {
  const k = e.target.value;
  if (!k || !EXAMPLES[k]) return;
  el.src.value = EXAMPLES[k].code;
  if (el.exampleDesc) el.exampleDesc.textContent = EXAMPLES[k].description;
  try { loadProgram(EXAMPLES[k].code); }
  catch (err) { showToast(err.message, false); }
};

el.src.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    el.btnParse.click();
  }
});

// arranque — secuencia de bombillas + reloj automático
el.src.value = EXAMPLES.lights.code;
if (el.exampleDesc) el.exampleDesc.textContent = EXAMPLES.lights.description;
try { loadProgram(EXAMPLES.lights.code); }
catch (e) { showToast(e.message, false); }

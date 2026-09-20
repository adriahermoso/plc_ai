// app.js — arranque de la aplicación: reloj en tiempo real, manejo de
// estado y eventos de interfaz. Se usa TAL CUAL desde index.html y desde
// mobile.html: ambas páginas exponen los mismos IDs de elemento
// (btnParse, btnReset, btnTick, examples, chips, src, svg, toast, status,
// tickLabel, clockLabel, runLabel), así que esta lógica no se duplica.

import { parseProgram, evalAst, settle, commitEdgeMemory, isMom, isEStop, blankState, setSelectorPosition, computePowerNetwork } from './core.js';
import { drawAll } from './render.js';
import { EXAMPLES } from './examples.js';

const POLL_MS = 100; // resolución del reloj/UI

let program = null;
let states = {};
let tCnt = {};    // contador visible (segundos hacia el preset, o fase actual en FLASH)
let tEdge = {};   // muestra anterior de la entrada del timer
let tArmed = {};  // armado para OFFDELAY/PULSE
let tStart = {};  // performance.now() al iniciar la fase de temporizado
let tPhase = {};  // 'on'/'off' — fase actual de un TIMER FLASH
let cCnt = {};    // valor actual de cada COUNTER
let cEdge = {};   // muestra anterior del disparo del contador (para detectar el flanco)
let iEdge = {};   // muestra anterior del disparo de cada IMPULSE (telerruptor)
let trippedSet = new Set(); // dispositivos de protección disparados ahora mismo
let faultActive = false;    // true mientras haya alguna protección disparada — congela la simulación
let lastPowerNet = null;    // último resultado de computePowerNetwork (para el mensaje de fallo)
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
  tCnt = {}; tEdge = {}; tArmed = {}; tStart = {}; tPhase = {};
  cCnt = {}; cEdge = {}; iEdge = {};
  prog.timers.forEach(t => {
    tCnt[t.name] = 0;
    tEdge[t.name] = false;
    tArmed[t.name] = false;
    tStart[t.name] = null;
    tPhase[t.name] = 'off';
  });
  prog.counters.forEach(c => {
    cCnt[c.name] = c.kind === 'ctd' ? c.preset : 0;
    cEdge[c.name] = false;
  });
  prog.impulses.forEach(imp => { iEdge[imp.name] = false; });
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
    } else if (t.kind === 'pulse') {
      if (raw && !prev) { tStart[t.name] = now; tArmed[t.name] = true; tCnt[t.name] = 0; }
      if (tArmed[t.name] && tStart[t.name] != null) {
        const sec = (now - tStart[t.name]) / 1000;
        tCnt[t.name] = Math.min(t.preset, Math.floor(sec + 1e-9));
        if (sec >= t.preset) tArmed[t.name] = false;
      } else if (!tArmed[t.name]) { tCnt[t.name] = 0; }
    } else if (t.kind === 'flash') {
      // relé intermitente: mientras `raw` (enable) esté activo, alterna
      // fase ON/OFF con sus propios segundos; tCnt lleva el contador de
      // la fase actual (para mostrarlo en el diagrama).
      if (!raw) { tStart[t.name] = null; tPhase[t.name] = 'off'; tCnt[t.name] = 0; }
      else {
        if (tStart[t.name] == null) { tStart[t.name] = now; tPhase[t.name] = 'on'; }
        const curPreset = tPhase[t.name] === 'on' ? t.presetOn : t.presetOff;
        const sec = (now - tStart[t.name]) / 1000;
        tCnt[t.name] = Math.min(curPreset, Math.floor(sec + 1e-9));
        if (sec >= curPreset) {
          tPhase[t.name] = tPhase[t.name] === 'on' ? 'off' : 'on';
          tStart[t.name] = now;
          tCnt[t.name] = 0;
        }
      }
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
    } else if (t.kind === 'pulse') {
      states[t.name] = !!(tArmed[t.name] && tStart[t.name] != null && (now - tStart[t.name]) / 1000 < t.preset);
    } else if (t.kind === 'flash') {
      states[t.name] = raw && tPhase[t.name] === 'on';
    }
  });
}

/**
 * Contadores CTU/CTD en tiempo real: incrementan/decrementan en cada
 * flanco de subida de su entrada de disparo (no en cada sondeo de 100ms,
 * para que pulsar dos veces cuente dos, no un número indefinido de veces).
 */
function updateCountersRealtime() {
  if (!program) return;
  const samples = program.counters.map(c => ({
    c, raw: !!evalAst(c.triggerAst, states), resetNow: !!evalAst(c.resetAst, states), prev: !!cEdge[c.name],
  }));
  samples.forEach(({ c, raw, resetNow, prev }) => {
    const rising = raw && !prev;
    if (resetNow) {
      cCnt[c.name] = c.kind === 'ctd' ? c.preset : 0;
    } else if (rising) {
      if (c.kind === 'ctu') cCnt[c.name] = Math.min(c.preset, cCnt[c.name] + 1);
      else cCnt[c.name] = Math.max(0, cCnt[c.name] - 1);
    }
    cEdge[c.name] = raw;
  });
  samples.forEach(({ c }) => {
    states[c.name] = c.kind === 'ctd' ? cCnt[c.name] <= 0 : cCnt[c.name] >= c.preset;
  });
}

/**
 * Telerruptor (IMPULSE): cada flanco de subida de su entrada conmuta el
 * estado — el primer pulso enciende, el segundo apaga, y así alternando.
 * Se resuelve una vez por ciclo, fuera del punto fijo de settle() (igual
 * que los contadores), porque conmutar dentro del propio punto fijo
 * oscilaría sin converger nunca.
 */
function updateImpulsesRealtime() {
  if (!program) return;
  program.impulses.forEach(imp => {
    const raw = !!evalAst(imp.ast, states);
    const prev = !!iEdge[imp.name];
    if (raw && !prev) states[imp.name] = !states[imp.name];
    iEdge[imp.name] = raw;
  });
}

/**
 * Continuidad del circuito de potencia (motor de grafo de core.js):
 * calcula bloqueo mecánico por INTERLOCK, cortocircuitos reales por
 * conflicto de fases, y si cada motor queda energizado y con qué sentido
 * de giro. Si computePowerNetwork encuentra un cortocircuito, esta misma
 * función dispara automáticamente la protección aguas arriba responsable
 * (además de que el usuario pueda disparar una a mano tocándola).
 */
function updatePowerNetwork() {
  if (!program) return;
  const net = computePowerNetwork(program, states);
  net.toTrip.forEach(name => { states[name] = true; }); // disparo automático por cortocircuito
  program.motors.forEach(motor => {
    const r = net.motorResults[motor.name];
    states[motor.name] = r.energized;
    states['__rot_' + motor.name] = r.rotation;
  });
  lastPowerNet = net; // para que el render pueda mostrar el bloqueo mecánico/cortos si quiere
}

/**
 * Si alguna protección referenciada en un LINK/POWERCHAIN está disparada
 * (a mano, o automáticamente por un cortocircuito), se congela toda la
 * simulación (reloj parado, entradas bloqueadas) hasta que esa protección
 * se resetea a mano — "se para y además queda marcada hasta que la
 * reseteas".
 */
function checkPowerFaults() {
  if (!program) return;
  trippedSet = new Set([...program.protectiveNames].filter(n => !!states[n]));
  if (trippedSet.size > 0) {
    if (!faultActive) { faultActive = true; stopClock(true); }
    let short = '';
    if (lastPowerNet && lastPowerNet.shortedNodes.length) {
      short = lastPowerNet.groundFaultNodes.length
        ? ` (fuga a tierra en: ${lastPowerNet.groundFaultNodes.join(', ')})`
        : ` (cortocircuito en: ${lastPowerNet.shortedNodes.join(', ')})`;
    }
    showToast(`⚠ Protección disparada: ${[...trippedSet].join(', ')}${short}. Pulsa sobre ella para resetear y continuar.`, false);
  } else if (faultActive) {
    faultActive = false;
    hideToast();
    startClock();
  }
}

function runCycle() {
  updateTimersRealtime();
  updateCountersRealtime();
  updateImpulsesRealtime();
  if (!settle(program, states)) throw new Error('No converge (oscilación / realimentación)');
  commitEdgeMemory(program, states); // guarda "valor de este ciclo" para P()/N() la próxima vez
  updatePowerNetwork();
  checkPowerFaults();
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
  drawAll(el.svg, program, states, { ...tCnt, ...cCnt }, {
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
  trippedSet = new Set();
  faultActive = false;
  pausedTotal = 0;
  pauseStarted = null;
  clockOrigin = nowEff();
  tick = 0;
  runCycle();
  setRun(true);
  el.tickLabel.textContent = 't = 0.0 s';
  renderChips();
  redraw();
  const nSR = new Set(program.setResets.map(op => op.name)).size;
  const nBlocks = program.coils.length + program.latches.length + nSR + program.timers.length + program.counters.length + program.impulses.length + program.powerLinks.length;
  setStatus(`OK · ${program.inputs.length} entradas · ${nBlocks} bloques · TIMER/COUNTER en tiempo real`);
  startClock();
}

function setInput(name, val) {
  if (faultActive && !trippedSet.has(name)) {
    showToast(`⚠ Protección disparada: ${[...trippedSet].join(', ')}. Pulsa sobre ella para resetear antes de seguir.`, false);
    return;
  }
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

function setSelector(selName, index) {
  if (faultActive) {
    showToast(`⚠ Protección disparada: ${[...trippedSet].join(', ')}. Pulsa sobre ella para resetear antes de seguir.`, false);
    return;
  }
  setSelectorPosition(program, states, selName, index);
  try {
    hideToast();
    runCycle();
    renderChips();
    redraw();
    setStatus(`${selName} → posición ${index + 1}`);
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
    b.className = 'chip' + (states[name] ? ' on' : '') + (isMom(name) ? ' mom' : '') + (isEStop(name) ? ' estop' : '');
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
  (program.selectors || []).forEach(sel => {
    const group = document.createElement('div');
    group.className = 'selector-group';
    group.setAttribute('data-selector', sel.name);
    const label = document.createElement('span');
    label.className = 'selector-label';
    label.textContent = sel.name;
    group.appendChild(label);
    sel.positions.forEach((pos, i) => {
      const on = !!states[sel.name + '_' + pos];
      const b = document.createElement('button');
      b.className = 'chip sel-pos' + (on ? ' on' : '');
      b.textContent = pos;
      b.onclick = () => setSelector(sel.name, i);
      group.appendChild(b);
    });
    el.chips.appendChild(group);
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
  trippedSet = new Set();
  faultActive = false;
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
  if (faultActive) {
    showToast(`⚠ Protección disparada: ${[...trippedSet].join(', ')}. Pulsa sobre ella para resetear antes de reanudar.`, false);
    return;
  }
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

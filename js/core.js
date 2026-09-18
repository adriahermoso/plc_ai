// core.js — parser y motor de simulación de relaysim.
// Lógica pura, sin DOM.
//
// v2: añade sobre la v1 original
//   - SET / RESET  (bobinas de asignación, pueden repetirse por nombre —
//     semántica de orden de escaneo: la última línea cuyo bit importa gana)
//   - P(...) / N(...)  contactos de flanco positivo/negativo, usables en
//     cualquier expresión
//   - COUNTER ... = CTU(...) / CTD(...)  contadores ascendente/descendente
//   - TIMER ... = FLASH(enable, segEncendido, segApagado)  relé intermitente
//   - isEStop()  convención de nombre para setas de emergencia (prefijo ES)

/* ─── Tokenizado y parser de expresiones ─── */
export function tokenize(s) {
  // P( / N( se convierten en tokens propios (con límite de palabra, para no
  // romper nombres de señal que empiecen por P o N seguidos de otra letra)
  const withEdges = s.replace(/\bP\(/g, ' PEDGE( ').replace(/\bN\(/g, ' NEDGE( ');
  return withEdges.replace(/([()!,])/g, ' $1 ').trim().split(/\s+/).filter(Boolean);
}

export function parseExpr(tokens) {
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];

  function parseOr() {
    let left = parseAnd();
    while (peek() === 'OR') {
      next();
      left = { type: 'or', children: [left, parseAnd()] };
    }
    return left;
  }
  function parseAnd() {
    let left = parseAtom();
    while (peek() === 'AND') {
      next();
      left = { type: 'and', children: [left, parseAtom()] };
    }
    return left;
  }
  function parseAtom() {
    if (peek() === '(') {
      next();
      const e = parseOr();
      if (peek() !== ')') throw new Error("Falta ')'");
      next();
      return e;
    }
    if (peek() === 'PEDGE' || peek() === 'NEDGE') {
      const kind = next() === 'PEDGE' ? 'pedge' : 'nedge';
      if (peek() !== '(') throw new Error(`Falta '(' tras ${kind === 'pedge' ? 'P' : 'N'}`);
      next();
      const e = parseOr();
      if (peek() !== ')') throw new Error(`Falta ')' tras ${kind === 'pedge' ? 'P' : 'N'}(...)`);
      next();
      return { type: kind, child: e };
    }
    if (peek() === '!') {
      next();
      if (peek() === '(') {
        next();
        const e = parseOr();
        if (peek() !== ')') throw new Error("Falta ')' tras !");
        next();
        return { type: 'not', child: e };
      }
      const ref = next();
      if (!ref) throw new Error("Falta referencia tras '!'");
      return { type: 'contact', ref, no: false };
    }
    const ref = next();
    if (!ref) throw new Error('Expresión incompleta');
    if (['AND', 'OR', ')', ','].includes(ref)) throw new Error(`Token inesperado: ${ref}`);
    return { type: 'contact', ref, no: true };
  }

  const ast = parseOr();
  if (i !== tokens.length) throw new Error('Tokens sobrantes: ' + tokens.slice(i).join(' '));
  return ast;
}

// Divide argumentos separados por comas de nivel superior (respeta paréntesis anidados)
export function splitArgs(s) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === ',' && depth === 0) {
      parts.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(s.slice(start).trim());
  return parts;
}

function stripWrapper(s, keyword) {
  s = s.trim();
  const re = new RegExp(`^${keyword}\\s*\\((.+)\\)$`, 'i');
  const m = s.match(re);
  if (!m) throw new Error(`Se esperaba ${keyword}(...) en: ${s}`);
  return m[1].trim();
}

export function refsOf(node, set) {
  if (node.type === 'contact') { set.add(node.ref); return; }
  if (node.type === 'not' || node.type === 'pedge' || node.type === 'nedge') { refsOf(node.child, set); return; }
  node.children.forEach(c => refsOf(c, set));
}

// Recorre todo el programa y asigna un id secuencial a cada nodo de flanco
// P()/N() que encuentra (para poder llevar memoria de "valor anterior" por
// nodo, en vez de por nombre de señal — así dos P(X) en dos sitios
// distintos del programa no se pisan entre sí).
function collectEdgeNodes(program) {
  const nodes = [];
  function walk(ast) {
    if (!ast) return;
    if (ast.type === 'pedge' || ast.type === 'nedge') {
      ast.edgeId = nodes.length;
      nodes.push(ast);
      walk(ast.child);
      return;
    }
    if (ast.type === 'not') { walk(ast.child); return; }
    if (ast.children) ast.children.forEach(walk);
  }
  program.coils.forEach(c => walk(c.ast));
  program.latches.forEach(l => { walk(l.setAst); walk(l.resetAst); });
  program.timers.forEach(t => walk(t.inAst));
  program.counters.forEach(c => { walk(c.triggerAst); walk(c.resetAst); });
  program.setResets.forEach(op => walk(op.ast));
  program.impulses.forEach(imp => walk(imp.ast));
  return nodes;
}

/* ─── Parser del programa completo ─── */
export function parseProgram(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const inputs = [];
  const coils = [];
  const latches = [];
  const timers = [];
  const counters = [];
  const setResets = []; // { name, kind: 'set'|'reset', ast }
  const selectors = []; // { name, positions: [...] }
  const impulses = []; // { name, ast } — telerruptor
  const declared = new Set();  // nombres de COIL/LATCH/TIMER/COUNTER (únicos)
  const srNames = new Set();   // nombres usados en SET/RESET (pueden repetirse)
  const selDerived = new Set(); // nombres derivados NOMBRE_POSICION de cada SELECTOR
  const selBaseNames = new Set(); // nombres base de los SELECTOR (no son señal booleana)

  function checkTarget(name) {
    if (srNames.has(name)) throw new Error(`"${name}" ya se usa en SET/RESET; no puede ser también COIL/LATCH/TIMER/COUNTER.`);
    if (selBaseNames.has(name) || selDerived.has(name)) throw new Error(`"${name}" ya está en uso por un SELECTOR.`);
    if (declared.has(name)) throw new Error(`"${name}" ya definido`);
    declared.add(name);
  }
  function checkSetResetTarget(name) {
    if (declared.has(name)) throw new Error(`"${name}" ya es COIL/LATCH/TIMER/COUNTER; no puede usarse también en SET/RESET.`);
    if (selBaseNames.has(name) || selDerived.has(name)) throw new Error(`"${name}" ya está en uso por un SELECTOR.`);
    srNames.add(name);
  }

  for (const line of lines) {
    if (line.startsWith('INPUT')) {
      line.slice(5).trim().split(/\s+/).filter(Boolean).forEach(r => {
        if (!inputs.includes(r)) inputs.push(r);
      });
      continue;
    }
    if (line.startsWith('COIL')) {
      const m = line.match(/^COIL\s+(\w+)\s*=\s*(.+)$/i);
      if (!m) throw new Error('COIL inválido: ' + line);
      checkTarget(m[1]);
      coils.push({ name: m[1], ast: parseExpr(tokenize(m[2])) });
      continue;
    }
    if (line.startsWith('LATCH')) {
      const m = line.match(/^LATCH\s+(\w+)\s*=\s*SET\s*\((.+)\)\s*RESET\s*\((.+)\)$/i);
      if (!m) throw new Error('LATCH: LATCH nombre = SET(expr) RESET(expr)');
      checkTarget(m[1]);
      latches.push({
        name: m[1],
        setAst: parseExpr(tokenize(m[2])),
        resetAst: parseExpr(tokenize(m[3])),
      });
      continue;
    }
    if (line.startsWith('IMPULSE')) {
      // telerruptor: cada flanco de subida de la entrada conmuta el
      // estado (pulso 1 enciende, pulso 2 apaga, y así alternando) — a
      // diferencia de SET/RESET, que necesita dos condiciones distintas.
      const m = line.match(/^IMPULSE\s+(\w+)\s*=\s*(.+)$/i);
      if (!m) throw new Error('IMPULSE: IMPULSE nombre = expr');
      checkTarget(m[1]);
      impulses.push({ name: m[1], ast: parseExpr(tokenize(m[2])) });
      continue;
    }
    if (line.startsWith('SET ') || line.startsWith('SET\t')) {
      const m = line.match(/^SET\s+(\w+)\s*=\s*(.+)$/i);
      if (!m) throw new Error('SET inválido: ' + line);
      checkSetResetTarget(m[1]);
      setResets.push({ name: m[1], kind: 'set', ast: parseExpr(tokenize(m[2])) });
      continue;
    }
    if (line.startsWith('RESET ') || line.startsWith('RESET\t')) {
      const m = line.match(/^RESET\s+(\w+)\s*=\s*(.+)$/i);
      if (!m) throw new Error('RESET inválido: ' + line);
      checkSetResetTarget(m[1]);
      setResets.push({ name: m[1], kind: 'reset', ast: parseExpr(tokenize(m[2])) });
      continue;
    }
    if (line.startsWith('TIMER')) {
      const m = line.match(/^TIMER\s+(\w+)\s*=\s*(ONDELAY|OFFDELAY|PULSE|FLASH)\s*\((.+)\)$/i);
      if (!m) throw new Error('TIMER: TIMER n = ONDELAY|OFFDELAY|PULSE(expr, pasos) o FLASH(enable, segON, segOFF)');
      checkTarget(m[1]);
      const kindWord = m[2].toUpperCase();
      const args = splitArgs(m[3]);
      if (kindWord === 'FLASH') {
        if (args.length !== 3) throw new Error('FLASH necesita 3 argumentos: enable, segundos ON, segundos OFF');
        if (!/^\d+$/.test(args[1]) || !/^\d+$/.test(args[2])) throw new Error('FLASH: los segundos deben ser enteros');
        timers.push({
          name: m[1], kind: 'flash',
          inAst: parseExpr(tokenize(args[0])),
          presetOn: parseInt(args[1], 10),
          presetOff: parseInt(args[2], 10),
        });
      } else {
        if (args.length < 2) throw new Error('TIMER necesita expresión y pasos');
        if (!/^\d+$/.test(args[1])) throw new Error('Pasos deben ser entero');
        timers.push({
          name: m[1],
          kind: kindWord === 'OFFDELAY' ? 'off' : kindWord === 'PULSE' ? 'pulse' : 'on',
          inAst: parseExpr(tokenize(args[0])),
          preset: parseInt(args[1], 10),
        });
      }
      continue;
    }
    if (line.startsWith('SELECTOR')) {
      const m = line.match(/^SELECTOR\s+(\w+)\s*=\s*(.+)$/i);
      if (!m) throw new Error('SELECTOR: SELECTOR nombre = POS1, POS2[, POS3[, POS4]]');
      const selName = m[1];
      const positions = splitArgs(m[2]);
      if (positions.length < 2 || positions.length > 4) {
        throw new Error(`SELECTOR ${selName}: debe tener entre 2 y 4 posiciones, tiene ${positions.length}`);
      }
      if (!positions.every(p => /^\w+$/.test(p))) {
        throw new Error(`SELECTOR ${selName}: cada posición debe ser un nombre válido (letras/números)`);
      }
      if (new Set(positions).size !== positions.length) {
        throw new Error(`SELECTOR ${selName}: hay posiciones repetidas`);
      }
      if (inputs.includes(selName) || declared.has(selName) || srNames.has(selName) || selBaseNames.has(selName)) {
        throw new Error(`"${selName}" ya está definido; no puede reutilizarse como SELECTOR`);
      }
      selBaseNames.add(selName);
      positions.forEach(p => {
        const derived = selName + '_' + p;
        if (selDerived.has(derived) || declared.has(derived) || srNames.has(derived) || inputs.includes(derived)) {
          throw new Error(`"${derived}" (derivado de SELECTOR ${selName}) ya está en uso`);
        }
        selDerived.add(derived);
      });
      selectors.push({ name: selName, positions });
      continue;
    }
    if (line.startsWith('COUNTER')) {
      const m = line.match(/^COUNTER\s+(\w+)\s*=\s*(CTU|CTD)\s*\((.+)\)$/i);
      if (!m) throw new Error('COUNTER: COUNTER n = CTU|CTD(expr, RESET(expr), preset)');
      checkTarget(m[1]);
      const args = splitArgs(m[3]);
      if (args.length !== 3) throw new Error('CTU/CTD necesita 3 argumentos: disparo, RESET(expr), preset');
      if (!/^\d+$/.test(args[2])) throw new Error('CTU/CTD: el preset debe ser entero');
      counters.push({
        name: m[1],
        kind: m[2].toUpperCase() === 'CTD' ? 'ctd' : 'ctu',
        triggerAst: parseExpr(tokenize(args[0])),
        resetAst: parseExpr(tokenize(stripWrapper(args[1], 'RESET'))),
        preset: parseInt(args[2], 10),
      });
      continue;
    }
    throw new Error('Línea no reconocida: ' + line);
  }

  if (!coils.length && !latches.length && !timers.length && !counters.length && !setResets.length && !impulses.length) {
    throw new Error('Define al menos un COIL, LATCH, TIMER, COUNTER, SET, RESET o IMPULSE');
  }

  const known = new Set([...inputs, ...declared, ...srNames, ...selDerived]);
  const used = new Set();
  coils.forEach(c => refsOf(c.ast, used));
  latches.forEach(l => { refsOf(l.setAst, used); refsOf(l.resetAst, used); });
  timers.forEach(t => refsOf(t.inAst, used));
  counters.forEach(c => { refsOf(c.triggerAst, used); refsOf(c.resetAst, used); });
  setResets.forEach(op => refsOf(op.ast, used));
  impulses.forEach(imp => refsOf(imp.ast, used));
  const unknown = [...used].filter(r => !known.has(r));
  if (unknown.length) {
    const withHints = unknown.map(r => {
      const sel = selectors.find(s => r === s.name);
      return sel ? `"${r}" es un SELECTOR de varias posiciones; usa ${sel.positions.map(p => r + '_' + p).join(' / ')}` : r;
    });
    throw new Error('No declarado: ' + withHints.join('; '));
  }

  const program = { inputs, coils, latches, timers, counters, setResets, selectors, impulses };
  program.edgeNodes = collectEdgeNodes(program);
  return program;
}

/* ─── Evaluación booleana ─── */
export function evalAst(node, st) {
  if (node.type === 'contact') return node.no ? !!st[node.ref] : !st[node.ref];
  if (node.type === 'not') return !evalAst(node.child, st);
  if (node.type === 'and') return node.children.every(c => evalAst(c, st));
  if (node.type === 'or') return node.children.some(c => evalAst(c, st));
  if (node.type === 'pedge') {
    const now = evalAst(node.child, st);
    const prev = !!st['__edge' + node.edgeId];
    return now && !prev;
  }
  if (node.type === 'nedge') {
    const now = evalAst(node.child, st);
    const prev = !!st['__edge' + node.edgeId];
    return !now && prev;
  }
  return false;
}

// Punto fijo para bobinas (COIL), biestables (LATCH) y asignaciones (SET/RESET).
// TIMER y COUNTER se resuelven aparte, en tiempo real, en app.js.
export function settle(prog, st, max = 48) {
  for (let n = 0; n < max; n++) {
    let ch = false;
    for (const c of prog.coils) {
      const v = evalAst(c.ast, st);
      if (st[c.name] !== v) { st[c.name] = v; ch = true; }
    }
    for (const l of prog.latches) {
      const set = evalAst(l.setAst, st);
      const rst = evalAst(l.resetAst, st);
      let v = st[l.name];
      if (rst) v = false;
      else if (set) v = true;
      if (st[l.name] !== v) { st[l.name] = v; ch = true; }
    }
    // SET/RESET: se procesan en el orden en que aparecen en el programa —
    // si dos líneas afectan al mismo nombre en el mismo ciclo, la última
    // cuya condición sea verdadera es la que manda (como en un PLC real,
    // donde el escaneo va de arriba a abajo).
    for (const op of prog.setResets) {
      if (evalAst(op.ast, st)) {
        const v = op.kind === 'set';
        if (st[op.name] !== v) { st[op.name] = v; ch = true; }
      }
    }
    if (!ch) return true;
  }
  return false;
}

// Debe llamarse una vez por ciclo real, DESPUÉS de que settle() converja:
// guarda el valor de este ciclo como "anterior" para la detección de
// flancos del próximo ciclo.
export function commitEdgeMemory(prog, st) {
  (prog.edgeNodes || []).forEach(n => {
    st['__edge' + n.edgeId] = evalAst(n.child, st);
  });
}

// Pulsadores momentáneos: por convención, todo INPUT que empieza por "SB"
// solo se mantiene activo mientras se pulsa.
export function isMom(name) {
  return /^SB/i.test(name);
}
// Setas de emergencia: por convención, todo INPUT que empieza por "ES".
// Se comportan como un selector normal (clic = conmutar, se queda fijo)
// pero se dibujan y destacan como una seta de emergencia.
export function isEStop(name) {
  return /^ES/i.test(name);
}
// Convenciones de nombre para dispositivos de protección/maniobra —
// controlan qué símbolo se dibuja en el diagrama de campo, no cambian la
// simulación (siguen siendo entradas booleanas normales).
export function isThermal(name) { return /^FT/i.test(name); }      // relé térmico
export function isBreaker(name) { return /^QM/i.test(name); }      // magnetotérmico/guardamotor
export function isFuse(name) { return /^FU/i.test(name); }         // fusible
export function isDisconnect(name) { return /^QS/i.test(name); }   // seccionador
export function isRCD(name) { return /^(DIF|RCD)/i.test(name); }   // diferencial

export function blankState(prog) {
  const st = {};
  prog.inputs.forEach(i => st[i] = false);
  prog.coils.forEach(c => st[c.name] = false);
  prog.latches.forEach(l => st[l.name] = false);
  prog.timers.forEach(t => st[t.name] = false);
  prog.counters.forEach(c => st[c.name] = false);
  new Set(prog.setResets.map(op => op.name)).forEach(name => st[name] = false);
  prog.impulses.forEach(imp => st[imp.name] = false);
  (prog.edgeNodes || []).forEach(n => st['__edge' + n.edgeId] = false);
  (prog.selectors || []).forEach(sel => {
    st['__selpos_' + sel.name] = 0;
    sel.positions.forEach((p, i) => { st[sel.name + '_' + p] = i === 0; });
  });
  return st;
}

// Pone un SELECTOR en la posición `index` (0-based, cíclico) y actualiza
// las señales booleanas derivadas (exactamente una a true).
export function setSelectorPosition(prog, st, selName, index) {
  const sel = (prog.selectors || []).find(s => s.name === selName);
  if (!sel) return;
  const i = ((index % sel.positions.length) + sel.positions.length) % sel.positions.length;
  st['__selpos_' + selName] = i;
  sel.positions.forEach((p, j) => { st[selName + '_' + p] = j === i; });
}

export function nextSelectorPosition(prog, st, selName) {
  const sel = (prog.selectors || []).find(s => s.name === selName);
  if (!sel) return;
  const cur = st['__selpos_' + selName] || 0;
  setSelectorPosition(prog, st, selName, cur + 1);
}

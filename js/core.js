// core.js — parser y motor de simulación de relaysim.
// Lógica pura, sin DOM: se puede importar tanto en index.html/mobile.html
// como en pruebas automatizadas (Node con ESM).

/* ─── Tokenizado y parser de expresiones ─── */
export function tokenize(s) {
  return s.replace(/([()!,])/g, ' $1 ').trim().split(/\s+/).filter(Boolean);
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
    if (peek() === '!') {
      next();
      // permite !(expr) o !REF
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

export function refsOf(node, set) {
  if (node.type === 'contact') { set.add(node.ref); return; }
  if (node.type === 'not') { refsOf(node.child, set); return; }
  node.children.forEach(c => refsOf(c, set));
}

/* ─── Parser del programa completo (INPUT / COIL / LATCH / TIMER) ─── */
export function parseProgram(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const inputs = [];
  const coils = [];
  const latches = [];
  const timers = [];
  const declared = new Set();

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
      if (declared.has(m[1])) throw new Error(`"${m[1]}" ya definido`);
      declared.add(m[1]);
      coils.push({ name: m[1], ast: parseExpr(tokenize(m[2])) });
      continue;
    }
    if (line.startsWith('LATCH')) {
      const m = line.match(/^LATCH\s+(\w+)\s*=\s*SET\s*\((.+)\)\s*RESET\s*\((.+)\)$/i);
      if (!m) throw new Error('LATCH: LATCH nombre = SET(expr) RESET(expr)');
      if (declared.has(m[1])) throw new Error(`"${m[1]}" ya definido`);
      declared.add(m[1]);
      latches.push({
        name: m[1],
        setAst: parseExpr(tokenize(m[2])),
        resetAst: parseExpr(tokenize(m[3])),
      });
      continue;
    }
    if (line.startsWith('TIMER')) {
      const m = line.match(/^TIMER\s+(\w+)\s*=\s*(ONDELAY|OFFDELAY|PULSE)\s*\((.+)\)$/i);
      if (!m) throw new Error('TIMER: TIMER n = ONDELAY|OFFDELAY|PULSE(expr, pasos)');
      if (declared.has(m[1])) throw new Error(`"${m[1]}" ya definido`);
      declared.add(m[1]);
      const kind = m[2].toUpperCase();
      const args = splitArgs(m[3]);
      if (args.length < 2) throw new Error('TIMER necesita expresión y pasos');
      if (!/^\d+$/.test(args[1])) throw new Error('Pasos deben ser entero');
      timers.push({
        name: m[1],
        kind: kind === 'OFFDELAY' ? 'off' : kind === 'PULSE' ? 'pulse' : 'on',
        inAst: parseExpr(tokenize(args[0])),
        preset: parseInt(args[1], 10),
      });
      continue;
    }
    throw new Error('Línea no reconocida: ' + line);
  }

  if (!coils.length && !latches.length && !timers.length) {
    throw new Error('Define al menos un COIL, LATCH o TIMER');
  }

  const known = new Set([...inputs, ...declared]);
  const used = new Set();
  coils.forEach(c => refsOf(c.ast, used));
  latches.forEach(l => { refsOf(l.setAst, used); refsOf(l.resetAst, used); });
  timers.forEach(t => refsOf(t.inAst, used));
  const unknown = [...used].filter(r => !known.has(r));
  if (unknown.length) throw new Error('No declarado: ' + unknown.join(', '));

  return { inputs, coils, latches, timers };
}

/* ─── Evaluación booleana ─── */
export function evalAst(node, st) {
  if (node.type === 'contact') return node.no ? !!st[node.ref] : !st[node.ref];
  if (node.type === 'not') return !evalAst(node.child, st);
  if (node.type === 'and') return node.children.every(c => evalAst(c, st));
  if (node.type === 'or') return node.children.some(c => evalAst(c, st));
  return false;
}

// Punto fijo para bobinas (COIL) y biestables (LATCH). Los TIMER se resuelven
// aparte, en tiempo real, mediante updateTimersRealtime() en app.js.
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
    if (!ch) return true;
  }
  return false;
}

// Pulsadores momentáneos: por convención, todo INPUT que empieza por "SB"
// solo se mantiene activo mientras se pulsa (como un pulsador real, no un selector).
export function isMom(name) {
  return /^SB/i.test(name);
}

export function blankState(prog) {
  const st = {};
  prog.inputs.forEach(i => st[i] = false);
  prog.coils.forEach(c => st[c.name] = false);
  prog.latches.forEach(l => st[l.name] = false);
  prog.timers.forEach(t => st[t.name] = false);
  return st;
}

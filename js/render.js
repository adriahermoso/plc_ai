// render.js — construcción del SVG (escalera de contactos + módulo LOGO!).
// Extraído del index.html original; el comportamiento de dibujo es idéntico,
// solo se ha parametrizado (antes leía `states`/`tCnt` como variables
// globales del script; ahora se le pasan explícitamente) para poder vivir
// en su propio módulo sin depender de app.js.

import { evalAst, isMom, isEStop, isThermal, isBreaker, isFuse, isDisconnect, isRCD, computePowerNetwork } from './core.js';

const CW = 54, CH = 38, GAPX = 12, GAPY = 8;

export function layout(node) {
  if (node.type === 'contact') return { w: CW, h: CH, node };
  if (node.type === 'not') {
    if (node.child.type !== 'contact') {
      const c = layout(node.child);
      return { w: c.w + 16, h: c.h, node, children: [c] };
    }
    return { w: CW, h: CH, node };
  }
  if (node.type === 'pedge' || node.type === 'nedge') {
    if (node.child.type === 'contact') return { w: CW, h: CH, node };
    const c = layout(node.child);
    return { w: c.w, h: c.h, node, children: [c] };
  }
  const kids = node.children.map(layout);
  if (node.type === 'and') {
    return {
      w: kids.reduce((s, c) => s + c.w, 0) + GAPX * (kids.length - 1),
      h: Math.max(...kids.map(c => c.h)),
      node, children: kids,
    };
  }
  return {
    w: Math.max(...kids.map(c => c.w)) + 22,
    h: kids.reduce((s, c) => s + c.h, 0) + GAPY * (kids.length - 1),
    node, children: kids,
  };
}

function wire(x1, y1, x2, y2, on) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${on ? 'var(--live)' : 'var(--ink)'}" stroke-width="${on ? 2.3 : 1.35}"/>`;
}

// Numeración de bornes por convención IEC 60947-5-1: cada bloque de
// contactos de un mismo dispositivo se numera 13/14, 23/24, 33/34, 43/44
// (NA) o 11/12, 21/22, 31/32, 41/42 (NC) — el dígito de las decenas es el
// número de polo/bloque. poleMap lleva la cuenta de cuántas veces se ha
// dibujado cada referencia en todo el esquema (una Map compartida por
// todo el drawAll(), reiniciada en cada redibujado).
function nextPole(ref, poleMap) {
  const idx = poleMap.get(ref) || 0;
  poleMap.set(ref, idx + 1);
  return (idx % 4) + 1; // los bloques reales de un contactor no pasan de 4
}

function drawContact(x, midY, ref, no, closed, parts, poleMap) {
  const col = closed ? 'var(--live)' : 'var(--ink)';
  const cx = x + CW / 2, L = cx - 6, R = cx + 6;
  parts.push(wire(x, midY, L, midY, closed));
  parts.push(wire(R, midY, x + CW, midY, closed));
  parts.push(`<line x1="${L}" y1="${midY - 8}" x2="${L}" y2="${midY + 8}" stroke="${col}" stroke-width="2.2"/>`);
  parts.push(`<line x1="${R}" y1="${midY - 8}" x2="${R}" y2="${midY + 8}" stroke="${col}" stroke-width="2.2"/>`);
  if (!no) {
    parts.push(`<line x1="${L - 2}" y1="${midY + 9}" x2="${R + 2}" y2="${midY - 9}" stroke="${col}" stroke-width="1.7"/>`);
  }
  parts.push(`<text x="${cx}" y="${midY - 14}" text-anchor="middle" font-family="var(--mono)" font-size="10" fill="var(--muted)">${ref}</text>`);
  const pole = nextPole(ref, poleMap);
  parts.push(`<text x="${L}" y="${midY + 20}" text-anchor="middle" font-family="var(--mono)" font-size="7" fill="var(--muted)">${pole}${no ? '3' : '1'}</text>`);
  parts.push(`<text x="${R}" y="${midY + 20}" text-anchor="middle" font-family="var(--mono)" font-size="7" fill="var(--muted)">${pole}${no ? '4' : '2'}</text>`);
}

// Contacto de flanco P()/N(): mismos trazos que un contacto normal, pero
// con la letra P/N en vez de la diagonal NC, y sin numeración de bornes
// (no representa un borne físico real, es un bloque de programa).
function drawEdgeContact(x, midY, ref, label, closed, parts) {
  const col = closed ? 'var(--live)' : 'var(--ink)';
  const cx = x + CW / 2, L = cx - 6, R = cx + 6;
  parts.push(wire(x, midY, L, midY, closed));
  parts.push(wire(R, midY, x + CW, midY, closed));
  parts.push(`<line x1="${L}" y1="${midY - 8}" x2="${L}" y2="${midY + 8}" stroke="${col}" stroke-width="2.2"/>`);
  parts.push(`<line x1="${R}" y1="${midY - 8}" x2="${R}" y2="${midY + 8}" stroke="${col}" stroke-width="2.2"/>`);
  parts.push(`<text x="${cx}" y="${midY + 3}" text-anchor="middle" font-family="var(--mono)" font-size="8" font-weight="700" fill="${col}">${label}</text>`);
  parts.push(`<text x="${cx}" y="${midY - 14}" text-anchor="middle" font-family="var(--mono)" font-size="10" fill="var(--muted)">${ref}</text>`);
}

function drawExpr(lay, x, y, st, parts, poleMap) {
  const midY = y + lay.h / 2;
  const n = lay.node;
  if (n.type === 'contact') {
    const closed = n.no ? !!st[n.ref] : !st[n.ref];
    drawContact(x, midY, n.ref, n.no, closed, parts, poleMap);
    return;
  }
  if (n.type === 'not' && n.child.type === 'contact') {
    const ref = n.child.ref;
    const closed = !st[ref];
    drawContact(x, midY, ref, false, closed, parts, poleMap);
    return;
  }
  if (n.type === 'not') {
    const cl = lay.children[0];
    drawExpr(cl, x + 8, y + (lay.h - cl.h) / 2, st, parts, poleMap);
    return;
  }
  if (n.type === 'pedge' || n.type === 'nedge') {
    const label = n.type === 'pedge' ? 'P' : 'N';
    if (n.child.type === 'contact') {
      drawEdgeContact(x, midY, n.child.ref, label, evalAst(n, st), parts);
      return;
    }
    // caso compuesto (poco habitual): dibuja la red normal y añade la
    // etiqueta P/N flotando encima, ya que el flanco no tiene un único borne
    const cl = lay.children[0];
    drawExpr(cl, x, y, st, parts, poleMap);
    parts.push(`<text x="${x + 4}" y="${y - 2}" font-family="var(--mono)" font-size="9" font-weight="700" fill="var(--warn)">${label}</text>`);
    return;
  }
  if (n.type === 'and') {
    let cx = x;
    lay.children.forEach((cl, i) => {
      drawExpr(cl, cx, y + (lay.h - cl.h) / 2, st, parts, poleMap);
      if (i < lay.children.length - 1) {
        const on = n.children.slice(0, i + 1).every(c => evalAst(c, st));
        parts.push(wire(cx + cl.w, midY, cx + cl.w + GAPX, midY, on));
        cx += cl.w + GAPX;
      } else cx += cl.w;
    });
    return;
  }
  // or
  const stub = 10;
  let cy = y;
  const ys = [];
  lay.children.forEach(cl => {
    ys.push(cy + cl.h / 2);
    drawExpr(cl, x + stub, cy, st, parts, poleMap);
    cy += cl.h + GAPY;
  });
  const top = ys[0], bot = ys[ys.length - 1];
  const any = n.children.some(c => evalAst(c, st));
  const rx = x + lay.w - stub;
  parts.push(wire(x, midY, x + stub, midY, any));
  parts.push(wire(x + stub, top, x + stub, bot, any));
  parts.push(wire(rx, top, rx, bot, any));
  parts.push(wire(rx, midY, x + lay.w, midY, any));
  lay.children.forEach((cl, i) => {
    const on = evalAst(n.children[i], st);
    parts.push(wire(x + stub + cl.w, ys[i], rx, ys[i], on));
  });
}

// Iconos distintivos para los dispositivos de protección/maniobra
// reconocidos por convención de nombre (ver isThermal/isBreaker/... en
// core.js). Son simplificaciones geométricas, no símbolos IEC exactos,
// pensadas para distinguirse de un vistazo sin sobrecargar el esquema.
function drawDeviceGlyph(kind, cx, yy, parts) {
  const col = 'var(--warn)';
  const gy = yy - 20;
  if (kind === 'thermal') {
    parts.push(`<rect x="${cx - 9}" y="${gy - 6}" width="18" height="12" rx="1.5" fill="none" stroke="${col}" stroke-width="1.6"/>`);
    parts.push(`<polyline points="${cx - 6},${gy} ${cx - 3},${gy - 4} ${cx},${gy} ${cx + 3},${gy - 4} ${cx + 6},${gy}" fill="none" stroke="${col}" stroke-width="1.3"/>`);
  } else if (kind === 'breaker') {
    parts.push(`<circle cx="${cx}" cy="${gy + 5}" r="1.8" fill="${col}"/>`);
    parts.push(`<line x1="${cx}" y1="${gy + 5}" x2="${cx + 8}" y2="${gy - 6}" stroke="${col}" stroke-width="2"/>`);
  } else if (kind === 'fuse') {
    parts.push(`<rect x="${cx - 4}" y="${gy - 7}" width="8" height="14" rx="4" fill="none" stroke="${col}" stroke-width="1.6"/>`);
    parts.push(`<line x1="${cx}" y1="${gy - 9}" x2="${cx}" y2="${gy + 9}" stroke="${col}" stroke-width="1.2"/>`);
  } else if (kind === 'disconnect') {
    parts.push(`<line x1="${cx - 6}" y1="${gy + 5}" x2="${cx + 6}" y2="${gy - 6}" stroke="${col}" stroke-width="2.2"/>`);
    parts.push(`<circle cx="${cx - 6}" cy="${gy + 5}" r="1.6" fill="${col}"/>`);
    parts.push(`<circle cx="${cx + 6}" cy="${gy - 6}" r="1.6" fill="${col}"/>`);
  } else if (kind === 'rcd') {
    parts.push(`<circle cx="${cx}" cy="${gy}" r="7" fill="none" stroke="${col}" stroke-width="1.6"/>`);
    parts.push(`<text x="${cx}" y="${gy + 3}" text-anchor="middle" font-family="var(--mono)" font-size="8" font-weight="700" fill="${col}">Δ</text>`);
  }
}

function drawField(prog, st) {
  const parts = [];
  const Lx = 36, Nx = 640;
  const logoX = 310, logoY = 56, logoW = 200, logoH = 268;
  const inputs = prog.inputs.slice(0, 8);
  const isS7 = prog.plcType === 's71200';
  const brand = isS7 ? 'SIEMENS S7-1200' : 'SIEMENS LOGO!';
  const inAddr = i => isS7 ? `I0.${i}` : `I${i + 1}`;
  const outAddr = i => isS7 ? `Q0.${i}` : `Q${i + 1}`;

  parts.push(`<line x1="${Lx}" y1="48" x2="${Lx}" y2="480" stroke="var(--phase)" stroke-width="3"/>`);
  parts.push(`<text x="${Lx}" y="44" text-anchor="middle" font-family="var(--mono)" font-size="11" fill="var(--phase)" font-weight="600">L+</text>`);
  parts.push(`<line x1="${Nx}" y1="48" x2="${Nx}" y2="480" stroke="var(--neutral)" stroke-width="3"/>`);
  parts.push(`<text x="${Nx}" y="44" text-anchor="middle" font-family="var(--mono)" font-size="11" fill="var(--neutral)" font-weight="600">M</text>`);

  parts.push(`<rect x="${logoX}" y="${logoY}" width="${logoW}" height="${logoH}" rx="7" fill="var(--logo)"/>`);
  parts.push(`<text x="${logoX + logoW / 2}" y="${logoY + 20}" text-anchor="middle" fill="#eef1f3" font-family="var(--sans)" font-size="${isS7 ? 11 : 12}" font-weight="700">${brand}</text>`);
  parts.push(`<rect x="${logoX + 16}" y="${logoY + 32}" width="${logoW - 32}" height="32" rx="3" fill="#151c22"/>`);
  const active = [
    ...prog.latches.map(l => l.name),
    ...prog.coils.map(c => c.name),
    ...new Set(prog.setResets.map(op => op.name)),
    ...prog.timers.map(t => t.name),
    ...prog.counters.map(c => c.name),
    ...prog.impulses.map(imp => imp.name),
  ].filter(n => st[n]);
  parts.push(`<text x="${logoX + logoW / 2}" y="${logoY + 52}" text-anchor="middle" fill="#8fdbb0" font-family="var(--mono)" font-size="11">${active.length ? active.slice(0, 4).join(' ') : 'IDLE'}</text>`);

  parts.push(`<text x="${logoX + 14}" y="${logoY + 84}" fill="#9aa7b2" font-family="var(--mono)" font-size="8">ENTRADAS</text>`);
  inputs.forEach((name, i) => {
    const on = !!st[name];
    const tx = logoX + 12 + (i % 4) * 46;
    const ty = logoY + 92 + Math.floor(i / 4) * 26;
    parts.push(`<rect x="${tx}" y="${ty}" width="40" height="18" rx="2" fill="${on ? 'var(--live-soft)' : '#2a333c'}" stroke="${on ? 'var(--live)' : '#1a2228'}"/>`);
    parts.push(`<text x="${tx + 20}" y="${ty + 13}" text-anchor="middle" font-family="var(--mono)" font-size="${isS7 ? 7.5 : 9}" fill="${on ? 'var(--live)' : '#a8b4c0'}">${inAddr(i)}</text>`);
  });

  const outs = [
    ...prog.latches.map(l => l.name),
    ...prog.coils.map(c => c.name),
    ...new Set(prog.setResets.map(op => op.name)),
    ...prog.timers.map(t => t.name),
    ...prog.counters.map(c => c.name),
    ...prog.impulses.map(imp => imp.name),
  ].slice(0, 4);
  parts.push(`<text x="${logoX + 14}" y="${logoY + 160}" fill="#9aa7b2" font-family="var(--mono)" font-size="8">SALIDAS</text>`);
  outs.forEach((name, i) => {
    const on = !!st[name];
    const tx = logoX + 12 + i * 46;
    const ty = logoY + 168;
    parts.push(`<rect x="${tx}" y="${ty}" width="40" height="18" rx="2" fill="${on ? 'var(--live-soft)' : '#2a333c'}" stroke="${on ? 'var(--live)' : '#1a2228'}"/>`);
    parts.push(`<text x="${tx + 20}" y="${ty + 13}" text-anchor="middle" font-family="var(--mono)" font-size="${isS7 ? 7.5 : 9}" fill="${on ? 'var(--live)' : '#a8b4c0'}">${outAddr(i)}</text>`);
  });
  parts.push(`<text x="${logoX + logoW / 2}" y="${logoY + logoH - 14}" text-anchor="middle" fill="#8fdbb0" font-family="var(--mono)" font-size="9">RUN</text>`);

  parts.push(`<line x1="${Lx}" y1="${logoY + 18}" x2="${logoX}" y2="${logoY + 18}" stroke="var(--phase)" stroke-width="2"/>`);
  parts.push(`<line x1="${Nx}" y1="${logoY + 36}" x2="${logoX + logoW}" y2="${logoY + 36}" stroke="var(--neutral)" stroke-width="2"/>`);

  inputs.forEach((name, i) => {
    const yy = 78 + i * 34;
    const on = !!st[name];
    const es = isEStop(name);
    const kind = isThermal(name) ? 'thermal' : isBreaker(name) ? 'breaker' : isFuse(name) ? 'fuse'
      : isDisconnect(name) ? 'disconnect' : isRCD(name) ? 'rcd' : null;
    const hasIcon = es || !!kind;
    const col = es ? 'var(--phase)' : (on ? 'var(--live)' : 'var(--ink)');
    const cx = 140;
    parts.push(`<g data-in="${name}">`);
    parts.push(wire(Lx, yy, cx - 20, yy, on));
    parts.push(`<line x1="${cx - 20}" y1="${yy - 9}" x2="${cx - 20}" y2="${yy + 9}" stroke="${col}" stroke-width="2.1"/>`);
    parts.push(`<line x1="${cx + 4}" y1="${yy - 9}" x2="${cx + 4}" y2="${yy + 9}" stroke="${col}" stroke-width="2.1"/>`);
    parts.push(`<line x1="${cx - 20}" y1="${yy}" x2="${cx + 4}" y2="${on ? yy : yy - 10}" stroke="${col}" stroke-width="1.7"/>`);
    if (es) {
      // cabeza de seta de emergencia: círculo rojo sobre el símbolo del contacto
      parts.push(`<circle cx="${cx - 8}" cy="${yy - 20}" r="7" fill="${on ? 'var(--phase)' : 'none'}" stroke="var(--phase)" stroke-width="2"/>`);
    } else if (kind) {
      drawDeviceGlyph(kind, cx - 8, yy, parts);
    }
    parts.push(`<text x="${cx - 8}" y="${yy - (hasIcon ? 30 : 14)}" text-anchor="middle" font-family="var(--mono)" font-size="10" fill="${es ? 'var(--phase)' : (kind ? 'var(--warn)' : 'var(--muted)')}">${name}</text>`);
    parts.push(wire(cx + 4, yy, logoX, yy, on));
    parts.push(`<text x="${logoX - 4}" y="${yy - 4}" text-anchor="end" font-family="var(--mono)" font-size="8" fill="var(--muted)">I${i + 1}</text>`);
    parts.push(`<rect x="${cx - 28}" y="${yy - 18}" width="48" height="32" fill="transparent"/>`);
    parts.push(`</g>`);
  });

  outs.forEach((name, i) => {
    const yy = logoY + logoH + 40 + i * 48;
    const on = !!st[name];
    const col = on ? 'var(--live)' : 'var(--ink)';
    const qx = logoX + 24 + i * 46;
    const lx = 480;
    parts.push(wire(qx, logoY + logoH, qx, yy, on));
    parts.push(wire(qx, yy, lx - 14, yy, on));
    parts.push(`<circle cx="${lx}" cy="${yy}" r="13" fill="${on ? 'var(--live-soft)' : 'none'}" stroke="${col}" stroke-width="2"/>`);
    parts.push(`<line x1="${lx - 9}" y1="${yy - 9}" x2="${lx + 9}" y2="${yy + 9}" stroke="${col}" stroke-width="1.5"/>`);
    parts.push(`<line x1="${lx + 9}" y1="${yy - 9}" x2="${lx - 9}" y2="${yy + 9}" stroke="${col}" stroke-width="1.5"/>`);
    parts.push(`<text x="${lx}" y="${yy - 18}" text-anchor="middle" font-family="var(--mono)" font-size="10" fill="var(--muted)">${name}</text>`);
    parts.push(wire(lx + 14, yy, Nx, yy, on));
    parts.push(`<text x="${qx}" y="${logoY + logoH + 12}" text-anchor="middle" font-family="var(--mono)" font-size="7.5" fill="var(--muted)">${outAddr(i)}</text>`);
  });

  // módulos de expansión (solo informativos: nuestro modelo de E/S no
  // reserva bornes físicos reales, así que aquí no añaden entradas/salidas
  // utilizables — son una referencia visual de que "ahí irían")
  (prog.expansions || []).forEach((name, i) => {
    const ex = Nx + 44 + i * 96;
    const exY = logoY;
    parts.push(`<rect x="${ex}" y="${exY}" width="84" height="120" rx="6" fill="var(--logo)" opacity="0.85"/>`);
    parts.push(`<text x="${ex + 42}" y="${exY + 18}" text-anchor="middle" fill="#eef1f3" font-family="var(--sans)" font-size="9" font-weight="700">${name}</text>`);
    parts.push(`<text x="${ex + 42}" y="${exY + 34}" text-anchor="middle" fill="#9aa7b2" font-family="var(--mono)" font-size="7">expansión</text>`);
    for (let k = 0; k < 6; k++) {
      parts.push(`<rect x="${ex + 10}" y="${exY + 44 + k * 12}" width="64" height="9" rx="1.5" fill="#2a333c" stroke="#1a2228"/>`);
    }
  });

  const h = logoY + logoH + 40 + Math.max(outs.length, 1) * 48 + 20;
  return { svg: parts.join(''), h };
}

/**
 * Dibuja el esquema completo (campo + LOGO! + escalera) dentro de `svgEl`.
 * `onToggleInput(name)` / `onPressStart(name)` / `onPressEnd(name)` son
 * los callbacks que app.js usa para reaccionar a los clics sobre los
 * símbolos de entrada dibujados en el propio diagrama.
 */
// ─── Circuito de potencia (Grupo 2): busbars L1/L2/L3, con los
// dispositivos organizados por "generación" topológica (cuántos pasos les
// separan de la fuente), así que las ramas (p. ej. un inversor de giro
// KM1/KM2 compartiendo el mismo bus de QM1) se dibujan una al lado de la
// otra en vez de una encima de otra.
function computeLinkDepths(prog) {
  const nodeDepth = { L1: 0, L2: 0, L3: 0 };
  const linkDepth = {};
  for (let pass = 0; pass < 50; pass++) {
    let changed = false;
    prog.powerLinks.forEach(link => {
      const srcDepths = link.mapping.map(([s]) => nodeDepth[s]);
      if (srcDepths.some(d => d === undefined)) return;
      const d = Math.max(...srcDepths) + 1;
      if (linkDepth[link.name] === undefined || d < linkDepth[link.name]) { linkDepth[link.name] = d; changed = true; }
      link.mapping.forEach(([, dst]) => {
        if (nodeDepth[dst] === undefined || d < nodeDepth[dst]) { nodeDepth[dst] = d; changed = true; }
      });
    });
    if (!changed) break;
  }
  return { nodeDepth, linkDepth };
}

function drawPowerDevice(link, st, net, x, y, parts) {
  const lineGap = 22;
  const lines = [0, 1, 2].map(i => x + i * lineGap);
  const raw = !!st[link.name];
  const blocked = net.mechBlocked.has(link.name);
  const on = !blocked && (link.kind === 'protective' ? !raw : raw);
  const tripped = link.kind === 'protective' && raw;
  const rowH = 46;
  const midY = y + rowH / 2;
  const col = tripped ? 'var(--phase)' : blocked ? 'var(--warn)' : (on ? 'var(--live)' : 'var(--ink)');
  if (link.kind === 'protective') parts.push(`<g data-in="${link.name}" style="cursor:pointer">`);
  lines.forEach(lx => {
    parts.push(`<line x1="${lx}" y1="${midY - 8}" x2="${lx}" y2="${midY - 3}" stroke="${col}" stroke-width="2.4"/>`);
    if (on) {
      parts.push(`<line x1="${lx}" y1="${midY - 3}" x2="${lx}" y2="${midY + 3}" stroke="${col}" stroke-width="2.4"/>`);
    } else {
      parts.push(`<line x1="${lx}" y1="${midY - 3}" x2="${lx + 6}" y2="${midY + 4}" stroke="${col}" stroke-width="2"/>`);
    }
    parts.push(`<line x1="${lx}" y1="${midY + 3}" x2="${lx}" y2="${midY + 8}" stroke="${col}" stroke-width="2.4"/>`);
  });
  const labelX = lines[2] + 14;
  parts.push(`<text x="${labelX}" y="${midY + 3}" font-family="var(--mono)" font-size="10.5" font-weight="600" fill="${col}">${link.name}</text>`);
  if (tripped) parts.push(`<text x="${labelX}" y="${midY + 15}" font-family="var(--mono)" font-size="8" font-weight="700" fill="var(--phase)">⚠ DISPARADO</text>`);
  else if (blocked) parts.push(`<text x="${labelX}" y="${midY + 15}" font-family="var(--mono)" font-size="8" font-weight="700" fill="var(--warn)">🔒 interbloqueado</text>`);
  if (link.kind === 'protective') parts.push(`</g>`);
  return { on, x, bottomY: y + rowH };
}

function drawPower(prog, st) {
  if (!prog.powerLinks.length) return { svg: '', height: 0 };
  const net = computePowerNetwork(prog, st);
  const { linkDepth } = computeLinkDepths(prog);
  const maxDepth = Math.max(0, ...Object.values(linkDepth));
  const byDepth = {};
  prog.powerLinks.forEach(link => {
    const d = linkDepth[link.name] || 1;
    (byDepth[d] = byDepth[d] || []).push(link);
  });

  const parts = ['<text x="20" y="16" font-family="var(--mono)" font-size="10" fill="var(--muted)" letter-spacing="0.04em">CIRCUITO DE POTENCIA</text>'];
  const colWidth = 130, rowH = 60, x0 = 50;
  const linkX = {};
  let y = 34, maxW = x0;
  for (let d = 1; d <= maxDepth; d++) {
    const row = byDepth[d] || [];
    if (!row.length) continue;
    if (d === 1) {
      ['L1', 'L2', 'L3'].forEach((lbl, k) => parts.push(`<text x="${x0 + k * 22}" y="${y - 8}" text-anchor="middle" font-family="var(--mono)" font-size="9" font-weight="700" fill="var(--phase)">${lbl}</text>`));
    }
    // bus horizontal de entrada compartido, si más de un dispositivo arranca en esta fila
    if (row.length > 1) {
      const xs = row.map((l, i) => x0 + i * colWidth);
      [0, 1, 2].forEach(ph => {
        parts.push(`<line x1="${xs[0] + ph * 22}" y1="${y}" x2="${xs[xs.length - 1] + ph * 22}" y2="${y}" stroke="var(--live)" stroke-width="1.6"/>`);
      });
    }
    row.forEach((link, i) => {
      const x = x0 + i * colWidth;
      [0, 1, 2].forEach(ph => parts.push(`<line x1="${x + ph * 22}" y1="${y}" x2="${x + ph * 22}" y2="${y + 15}" stroke="var(--live)" stroke-width="2"/>`));
      const res = drawPowerDevice(link, st, net, x, y + 15, parts);
      linkX[link.name] = x;
      maxW = Math.max(maxW, x + 2 * 22 + 90);
    });
    y += rowH;
  }

  // motores: cada uno debajo del último dispositivo que le alimenta
  prog.motors.forEach(motor => {
    const feeders = prog.powerLinks.filter(l => l.mapping.some(([, dst]) => motor.terminals.includes(dst)));
    const x = feeders.length ? (linkX[feeders[feeders.length - 1].name] ?? x0) : x0;
    const lines = [0, 1, 2].map(i => x + i * 22);
    const r = net.motorResults[motor.name] || { energized: false, rotation: null, shorted: false };
    lines.forEach(lx => parts.push(`<line x1="${lx}" y1="${y}" x2="${lx}" y2="${y + 28}" stroke="${r.energized ? 'var(--live)' : 'var(--ink)'}" stroke-width="2"/>`));
    const mcx = lines[1], mcy = y + 28 + 22;
    const mcol = r.shorted ? 'var(--phase)' : (r.energized ? 'var(--live)' : 'var(--ink)');
    parts.push(`<circle data-coil="${motor.name}" cx="${mcx}" cy="${mcy}" r="20" fill="${r.energized ? 'var(--live-soft)' : 'none'}" stroke="${mcol}" stroke-width="2.4"/>`);
    parts.push(`<text x="${mcx}" y="${mcy - 2}" text-anchor="middle" font-family="var(--mono)" font-size="13" font-weight="700" fill="${mcol}">M</text>`);
    parts.push(`<text x="${mcx}" y="${mcy + 10}" text-anchor="middle" font-family="var(--mono)" font-size="8" fill="${mcol}">3~</text>`);
    parts.push(`<text x="${mcx}" y="${mcy + 36}" text-anchor="middle" font-family="var(--mono)" font-size="10" fill="var(--muted)">${motor.name}</text>`);
    if (r.shorted) parts.push(`<text x="${mcx}" y="${mcy + 48}" text-anchor="middle" font-family="var(--mono)" font-size="8" font-weight="700" fill="var(--phase)">⚡ CORTOCIRCUITO</text>`);
    else if (r.energized) parts.push(`<text x="${mcx + 30}" y="${mcy + 6}" text-anchor="middle" font-size="17" fill="${mcol}">${r.rotation === 'ccw' ? '↺' : '↻'}</text>`);
    maxW = Math.max(maxW, mcx + 90);
    y = mcy + 60;
  });

  return { svg: parts.join(''), height: y };
}

export function drawAll(svgEl, program, states, counts, { onToggleInput, onPressStart, onPressEnd }) {
  if (!program) { svgEl.innerHTML = ''; return; }
  const parts = [];
  const ladderX = 720;
  let y = 48;
  const rail = 28;

  const rows = [];
  program.latches.forEach(l => rows.push({ label: l.name, ast: l.setAst, on: !!states[l.name], tag: 'SR' }));
  program.coils.forEach(c => rows.push({ label: c.name, ast: c.ast, on: !!states[c.name], tag: null }));
  program.setResets.forEach(op => rows.push({
    label: op.name, ast: op.ast, on: !!states[op.name],
    tag: null, box: op.kind === 'set' ? 'S' : 'R',
  }));
  program.timers.forEach(t => {
    const tag = t.kind === 'flash'
      ? 'FLASH ' + (counts[t.name] || 0) + '/' + (states[t.name] ? t.presetOn : t.presetOff)
      : (t.kind === 'off' ? 'TOF ' : t.kind === 'pulse' ? 'TP ' : 'TON ') + (counts[t.name] || 0) + '/' + t.preset;
    rows.push({ label: t.name, ast: t.inAst, on: !!states[t.name], tag });
  });
  program.counters.forEach(c => {
    const tag = (c.kind === 'ctd' ? 'CTD ' : 'CTU ') + (counts[c.name] || 0) + '/' + c.preset;
    rows.push({ label: c.name, ast: c.triggerAst, on: !!states[c.name], tag });
  });
  program.impulses.forEach(imp => rows.push({ label: imp.name, ast: imp.ast, on: !!states[imp.name], tag: 'IMP' }));

  let maxW = 0;
  const poleMap = new Map(); // numeración de bornes por referencia, para todo el esquema
  rows.forEach((row, idx) => {
    const lay = layout(row.ast);
    const rowH = Math.max(lay.h, CH) + 30;
    const midY = y + rowH / 2;
    const ox = ladderX + rail;
    parts.push(`<line x1="${ox}" y1="${y}" x2="${ox}" y2="${y + rowH}" stroke="var(--ink)" stroke-width="2.5"/>`);
    parts.push(`<text x="${ox - 12}" y="${midY + 3}" text-anchor="end" font-family="var(--mono)" font-size="10" fill="var(--muted)">${idx + 1}</text>`);
    drawExpr(lay, ox, y + (rowH - lay.h) / 2, states, parts, poleMap);
    const coilX = ox + lay.w + 34;
    parts.push(wire(ox + lay.w, midY, coilX - 16, midY, row.on));
    const col = row.on ? 'var(--live)' : 'var(--ink)';
    // data-coil identifica el símbolo exacto de esta fila (círculo o caja
    // S/R) para que la interfaz o las pruebas puedan localizarlo sin
    // ambigüedad — el mismo nombre puede aparecer también como referencia
    // de contacto en otra fila, o en el resumen de activos del LOGO!.
    if (row.box) {
      // símbolo IEC de bobina SET/RESET: cuadrado con la letra, no círculo
      parts.push(`<rect data-coil="${row.label}" data-kind="${row.box}" x="${coilX - 14}" y="${midY - 14}" width="28" height="28" rx="3" fill="${row.on ? 'var(--live-soft)' : 'none'}" stroke="${col}" stroke-width="2.1"/>`);
      parts.push(`<text x="${coilX}" y="${midY + 5}" text-anchor="middle" font-family="var(--mono)" font-size="13" font-weight="700" fill="${col}">${row.box}</text>`);
    } else {
      parts.push(`<circle data-coil="${row.label}" cx="${coilX}" cy="${midY}" r="15" fill="${row.on ? 'var(--live-soft)' : 'none'}" stroke="${col}" stroke-width="2.1"/>`);
    }
    parts.push(`<text x="${coilX}" y="${y + 13}" text-anchor="middle" font-family="var(--mono)" font-size="11" fill="var(--ink)">${row.label}</text>`);
    if (row.tag) parts.push(`<text x="${coilX}" y="${midY + 4}" text-anchor="middle" font-family="var(--mono)" font-size="8" fill="var(--muted)">${row.tag}</text>`);
    if (!row.box) {
      // bornas reales de la bobina de un contactor/relé: A1 (entrada), A2 (retorno)
      parts.push(`<text x="${coilX - 15}" y="${midY + 25}" text-anchor="middle" font-family="var(--mono)" font-size="7" fill="var(--muted)">A1</text>`);
      parts.push(`<text x="${coilX + 15}" y="${midY + 25}" text-anchor="middle" font-family="var(--mono)" font-size="7" fill="var(--muted)">A2</text>`);
    }
    parts.push(`<line x1="${coilX + 16}" y1="${y}" x2="${coilX + 16}" y2="${y + rowH}" stroke="var(--ink)" stroke-width="2.5"/>`);
    maxW = Math.max(maxW, coilX + 40);
    y += rowH;
  });

  const field = drawField(program, states);
  const power = drawPower(program, states);
  const offsetY = power.height;
  const totalH = Math.max(y + 40, field.h + 20, 520) + offsetY;
  const totalW = Math.max(maxW + 20, 1180);
  const bg = `
    <defs>
      <pattern id="g" width="16" height="16" patternUnits="userSpaceOnUse">
        <circle cx="1" cy="1" r="1.05" fill="var(--grid)"/>
      </pattern>
    </defs>
    <rect width="${totalW}" height="${totalH}" fill="url(#g)"/>
    <text x="36" y="${26 + offsetY}" font-family="var(--mono)" font-size="10" fill="var(--muted)" letter-spacing="0.04em">CABLEADO · LOGO!</text>
    <text x="${ladderX + rail}" y="${26 + offsetY}" font-family="var(--mono)" font-size="10" fill="var(--muted)" letter-spacing="0.04em">KOP / ESCALERA</text>
    <text x="${ladderX + rail}" y="${42 + offsetY}" text-anchor="middle" font-family="var(--mono)" font-size="11" font-weight="600" fill="var(--ink)">L+</text>
  `;

  svgEl.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);
  svgEl.setAttribute('width', totalW);
  svgEl.setAttribute('height', totalH);
  svgEl.innerHTML = bg + power.svg + `<g transform="translate(0, ${offsetY})">` + field.svg + parts.join('') + `</g>`;

  svgEl.querySelectorAll('[data-in]').forEach(el => {
    const name = el.getAttribute('data-in');
    el.style.cursor = 'pointer';
    if (isMom(name)) {
      el.onpointerdown = e => { e.preventDefault(); onPressStart(name); };
      el.onpointerup = () => onPressEnd(name);
      el.onpointerleave = () => onPressEnd(name);
    } else {
      el.onclick = () => onToggleInput(name);
    }
  });
}

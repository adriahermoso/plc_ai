// render.js — construcción del SVG (escalera de contactos + módulo LOGO!).
// Extraído del index.html original; el comportamiento de dibujo es idéntico,
// solo se ha parametrizado (antes leía `states`/`tCnt` como variables
// globales del script; ahora se le pasan explícitamente) para poder vivir
// en su propio módulo sin depender de app.js.

import { evalAst, isMom } from './core.js';

const CW = 54, CH = 38, GAPX = 12, GAPY = 8;

export function layout(node) {
  if (node.type === 'contact' || node.type === 'not') {
    if (node.type === 'not' && node.child.type !== 'contact') {
      const c = layout(node.child);
      return { w: c.w + 16, h: c.h, node, children: [c] };
    }
    return { w: CW, h: CH, node };
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

function drawContact(x, midY, ref, no, closed, parts) {
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
}

function drawExpr(lay, x, y, st, parts) {
  const midY = y + lay.h / 2;
  const n = lay.node;
  if (n.type === 'contact') {
    const closed = n.no ? !!st[n.ref] : !st[n.ref];
    drawContact(x, midY, n.ref, n.no, closed, parts);
    return;
  }
  if (n.type === 'not' && n.child.type === 'contact') {
    const ref = n.child.ref;
    const closed = !st[ref];
    drawContact(x, midY, ref, false, closed, parts);
    return;
  }
  if (n.type === 'not') {
    const cl = lay.children[0];
    drawExpr(cl, x + 8, y + (lay.h - cl.h) / 2, st, parts);
    return;
  }
  if (n.type === 'and') {
    let cx = x;
    lay.children.forEach((cl, i) => {
      drawExpr(cl, cx, y + (lay.h - cl.h) / 2, st, parts);
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
    drawExpr(cl, x + stub, cy, st, parts);
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

function drawField(prog, st) {
  const parts = [];
  const Lx = 36, Nx = 640;
  const logoX = 310, logoY = 56, logoW = 200, logoH = 268;
  const inputs = prog.inputs.slice(0, 8);

  parts.push(`<line x1="${Lx}" y1="48" x2="${Lx}" y2="480" stroke="var(--phase)" stroke-width="3"/>`);
  parts.push(`<text x="${Lx}" y="44" text-anchor="middle" font-family="var(--mono)" font-size="11" fill="var(--phase)" font-weight="600">L+</text>`);
  parts.push(`<line x1="${Nx}" y1="48" x2="${Nx}" y2="480" stroke="var(--neutral)" stroke-width="3"/>`);
  parts.push(`<text x="${Nx}" y="44" text-anchor="middle" font-family="var(--mono)" font-size="11" fill="var(--neutral)" font-weight="600">M</text>`);

  parts.push(`<rect x="${logoX}" y="${logoY}" width="${logoW}" height="${logoH}" rx="7" fill="var(--logo)"/>`);
  parts.push(`<text x="${logoX + logoW / 2}" y="${logoY + 20}" text-anchor="middle" fill="#eef1f3" font-family="var(--sans)" font-size="12" font-weight="700">SIEMENS LOGO!</text>`);
  parts.push(`<rect x="${logoX + 16}" y="${logoY + 32}" width="${logoW - 32}" height="32" rx="3" fill="#151c22"/>`);
  const active = [
    ...prog.latches.map(l => l.name),
    ...prog.coils.map(c => c.name),
    ...prog.timers.map(t => t.name),
  ].filter(n => st[n]);
  parts.push(`<text x="${logoX + logoW / 2}" y="${logoY + 52}" text-anchor="middle" fill="#8fdbb0" font-family="var(--mono)" font-size="11">${active.length ? active.slice(0, 4).join(' ') : 'IDLE'}</text>`);

  parts.push(`<text x="${logoX + 14}" y="${logoY + 84}" fill="#9aa7b2" font-family="var(--mono)" font-size="8">ENTRADAS</text>`);
  inputs.forEach((name, i) => {
    const on = !!st[name];
    const tx = logoX + 12 + (i % 4) * 46;
    const ty = logoY + 92 + Math.floor(i / 4) * 26;
    parts.push(`<rect x="${tx}" y="${ty}" width="40" height="18" rx="2" fill="${on ? 'var(--live-soft)' : '#2a333c'}" stroke="${on ? 'var(--live)' : '#1a2228'}"/>`);
    parts.push(`<text x="${tx + 20}" y="${ty + 13}" text-anchor="middle" font-family="var(--mono)" font-size="9" fill="${on ? 'var(--live)' : '#a8b4c0'}">I${i + 1}</text>`);
  });

  const outs = [
    ...prog.latches.map(l => l.name),
    ...prog.coils.map(c => c.name),
    ...prog.timers.map(t => t.name),
  ].slice(0, 4);
  parts.push(`<text x="${logoX + 14}" y="${logoY + 160}" fill="#9aa7b2" font-family="var(--mono)" font-size="8">SALIDAS</text>`);
  outs.forEach((name, i) => {
    const on = !!st[name];
    const tx = logoX + 12 + i * 46;
    const ty = logoY + 168;
    parts.push(`<rect x="${tx}" y="${ty}" width="40" height="18" rx="2" fill="${on ? 'var(--live-soft)' : '#2a333c'}" stroke="${on ? 'var(--live)' : '#1a2228'}"/>`);
    parts.push(`<text x="${tx + 20}" y="${ty + 13}" text-anchor="middle" font-family="var(--mono)" font-size="9" fill="${on ? 'var(--live)' : '#a8b4c0'}">Q${i + 1}</text>`);
  });
  parts.push(`<text x="${logoX + logoW / 2}" y="${logoY + logoH - 14}" text-anchor="middle" fill="#8fdbb0" font-family="var(--mono)" font-size="9">RUN</text>`);

  parts.push(`<line x1="${Lx}" y1="${logoY + 18}" x2="${logoX}" y2="${logoY + 18}" stroke="var(--phase)" stroke-width="2"/>`);
  parts.push(`<line x1="${Nx}" y1="${logoY + 36}" x2="${logoX + logoW}" y2="${logoY + 36}" stroke="var(--neutral)" stroke-width="2"/>`);

  inputs.forEach((name, i) => {
    const yy = 78 + i * 34;
    const on = !!st[name];
    const col = on ? 'var(--live)' : 'var(--ink)';
    const cx = 140;
    parts.push(`<g data-in="${name}">`);
    parts.push(wire(Lx, yy, cx - 20, yy, on));
    parts.push(`<line x1="${cx - 20}" y1="${yy - 9}" x2="${cx - 20}" y2="${yy + 9}" stroke="${col}" stroke-width="2.1"/>`);
    parts.push(`<line x1="${cx + 4}" y1="${yy - 9}" x2="${cx + 4}" y2="${yy + 9}" stroke="${col}" stroke-width="2.1"/>`);
    parts.push(`<line x1="${cx - 20}" y1="${yy}" x2="${cx + 4}" y2="${on ? yy : yy - 10}" stroke="${col}" stroke-width="1.7"/>`);
    parts.push(`<text x="${cx - 8}" y="${yy - 14}" text-anchor="middle" font-family="var(--mono)" font-size="10" fill="var(--muted)">${name}</text>`);
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
    parts.push(`<text x="${qx}" y="${logoY + logoH + 12}" text-anchor="middle" font-family="var(--mono)" font-size="8" fill="var(--muted)">Q${i + 1}</text>`);
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
export function drawAll(svgEl, program, states, tCnt, { onToggleInput, onPressStart, onPressEnd }) {
  if (!program) { svgEl.innerHTML = ''; return; }
  const parts = [];
  const ladderX = 720;
  let y = 48;
  const rail = 28;

  const rows = [];
  program.latches.forEach(l => rows.push({ label: l.name, ast: l.setAst, on: !!states[l.name], tag: 'SR' }));
  program.coils.forEach(c => rows.push({ label: c.name, ast: c.ast, on: !!states[c.name], tag: null }));
  program.timers.forEach(t => {
    const tag = (t.kind === 'off' ? 'TOF ' : t.kind === 'pulse' ? 'TP ' : 'TON ') + (tCnt[t.name] || 0) + '/' + t.preset;
    rows.push({ label: t.name, ast: t.inAst, on: !!states[t.name], tag });
  });

  let maxW = 0;
  rows.forEach((row, idx) => {
    const lay = layout(row.ast);
    const rowH = Math.max(lay.h, CH) + 30;
    const midY = y + rowH / 2;
    const ox = ladderX + rail;
    parts.push(`<line x1="${ox}" y1="${y}" x2="${ox}" y2="${y + rowH}" stroke="var(--ink)" stroke-width="2.5"/>`);
    parts.push(`<text x="${ox - 12}" y="${midY + 3}" text-anchor="end" font-family="var(--mono)" font-size="10" fill="var(--muted)">${idx + 1}</text>`);
    drawExpr(lay, ox, y + (rowH - lay.h) / 2, states, parts);
    const coilX = ox + lay.w + 34;
    parts.push(wire(ox + lay.w, midY, coilX - 16, midY, row.on));
    const col = row.on ? 'var(--live)' : 'var(--ink)';
    parts.push(`<circle cx="${coilX}" cy="${midY}" r="15" fill="${row.on ? 'var(--live-soft)' : 'none'}" stroke="${col}" stroke-width="2.1"/>`);
    parts.push(`<text x="${coilX}" y="${y + 13}" text-anchor="middle" font-family="var(--mono)" font-size="11" fill="var(--ink)">${row.label}</text>`);
    if (row.tag) parts.push(`<text x="${coilX}" y="${midY + 4}" text-anchor="middle" font-family="var(--mono)" font-size="8" fill="var(--muted)">${row.tag}</text>`);
    parts.push(`<line x1="${coilX + 16}" y1="${y}" x2="${coilX + 16}" y2="${y + rowH}" stroke="var(--ink)" stroke-width="2.5"/>`);
    maxW = Math.max(maxW, coilX + 40);
    y += rowH;
  });

  const field = drawField(program, states);
  const totalH = Math.max(y + 40, field.h + 20, 520);
  const totalW = Math.max(maxW + 20, 1180);
  const bg = `
    <defs>
      <pattern id="g" width="16" height="16" patternUnits="userSpaceOnUse">
        <circle cx="1" cy="1" r="1.05" fill="var(--grid)"/>
      </pattern>
    </defs>
    <rect width="${totalW}" height="${totalH}" fill="url(#g)"/>
    <text x="36" y="26" font-family="var(--mono)" font-size="10" fill="var(--muted)" letter-spacing="0.04em">CABLEADO · LOGO!</text>
    <text x="${ladderX + rail}" y="26" font-family="var(--mono)" font-size="10" fill="var(--muted)" letter-spacing="0.04em">KOP / ESCALERA</text>
    <text x="${ladderX + rail}" y="42" text-anchor="middle" font-family="var(--mono)" font-size="11" font-weight="600" fill="var(--ink)">L+</text>
  `;

  svgEl.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);
  svgEl.setAttribute('width', totalW);
  svgEl.setAttribute('height', totalH);
  svgEl.innerHTML = bg + field.svg + parts.join('');

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

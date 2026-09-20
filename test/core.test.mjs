import { tokenize, parseExpr, parseProgram, evalAst, settle, commitEdgeMemory, isMom, isEStop, isThermal, isBreaker, isFuse, isDisconnect, isRCD, blankState, setSelectorPosition, nextSelectorPosition, computePowerNetwork } from '../js/core.js';

let pass = 0, fail = 0;
function ok(desc, cond) { if (cond) { pass++; console.log('OK   ', desc); } else { fail++; console.log('FALLO', desc); } }
function throws(desc, fn) {
  try { fn(); fail++; console.log('FALLO', desc, '(no lanzó error)'); }
  catch (e) { pass++; console.log('OK   ', desc, '->', e.message); }
}

// Los 5 ejemplos originales siguen parseando con el core v2
const EXAMPLES_SRC = {
  lights: `INPUT SB1 SB2
LATCH RUN = SET(SB1) RESET(SB2 OR DONE)
TIMER T1 = ONDELAY(RUN, 2)
TIMER T2 = ONDELAY(T1, 2)
TIMER T3 = ONDELAY(T2, 2)
COIL LB1 = RUN AND !T3
COIL LB2 = T1 AND !T3
COIL LB3 = T2 AND !T3
COIL DONE = T3`,
  motor: `INPUT SB1 SB2 SA3 SQ1
LATCH KM1 = SET(SB1 AND SA3) RESET(SB2 OR !SQ1)
COIL EL1 = KM1
COIL EL2 = !SA3
TIMER TON1 = ONDELAY(KM1, 3)
COIL EL3 = TON1`,
  xor: `INPUT SA1 SA2
COIL M1 = SA1 AND !SA2
COIL M2 = !SA1 AND SA2
COIL EL1 = M1
COIL EL2 = M2`,
  latch: `INPUT SB1 SB2
LATCH EL1 = SET(SB1) RESET(SB2)`,
  seq: `INPUT SB1 SB2
LATCH RUN = SET(SB1) RESET(SB2)
TIMER T1 = ONDELAY(RUN, 2)
COIL A = RUN AND !T1
COIL B = T1
TIMER T2 = OFFDELAY(RUN, 3)
COIL C = T2 AND !RUN`,
};
for (const [name, src] of Object.entries(EXAMPLES_SRC)) {
  try { parseProgram(src); ok(`ejemplo "${name}" sigue parseando con core v2`, true); }
  catch (e) { ok(`ejemplo "${name}" sigue parseando con core v2 (error: ${e.message})`, false); }
}

ok('isMom("SB1")', isMom('SB1') === true);
ok('isEStop("ES1")', isEStop('ES1') === true);
ok('isEStop("SA1") = false', isEStop('SA1') === false);

/* ── SET / RESET: orden de escaneo, la última línea que aplica manda ── */
{
  const prog = parseProgram(`INPUT SA1 SA2\nSET M1 = SA1\nRESET M1 = SA2`);
  const st = blankState(prog);
  st.SA1 = true; st.SA2 = false;
  settle(prog, st);
  ok('SET activa M1', st.M1 === true);
  st.SA1 = false; st.SA2 = false;
  settle(prog, st);
  ok('M1 se mantiene sin SET ni RESET', st.M1 === true);
  st.SA2 = true;
  settle(prog, st);
  ok('RESET desactiva M1', st.M1 === false);
  // si ambas condiciones son verdaderas a la vez, gana la que está más
  // abajo en el programa (RESET, en este caso) — como el escaneo de un PLC real
  st.SA1 = true; st.SA2 = true;
  settle(prog, st);
  ok('con SET y RESET simultáneos, gana la última línea del programa (RESET)', st.M1 === false);
}
{
  // orden invertido: si RESET va primero y SET después, con ambos true debe ganar SET
  const prog = parseProgram(`INPUT SA1 SA2\nRESET M1 = SA2\nSET M1 = SA1`);
  const st = blankState(prog);
  st.SA1 = true; st.SA2 = true;
  settle(prog, st);
  ok('orden invertido: con ambos true gana SET (va después en el texto)', st.M1 === true);
}
throws('COIL y SET sobre el mismo nombre es un conflicto',
  () => parseProgram(`INPUT SA1\nCOIL M1 = SA1\nSET M1 = SA1`));
throws('SET y luego COIL sobre el mismo nombre también es conflicto',
  () => parseProgram(`INPUT SA1\nSET M1 = SA1\nCOIL M1 = SA1`));

/* ── P()/N(): flancos ── */
{
  const prog = parseProgram(`INPUT SA1\nCOIL M1 = P(SA1)`);
  const st = blankState(prog);
  settle(prog, st);
  ok('P(SA1) en reposo (SA1 ya vale false) no dispara', st.M1 === false);
  commitEdgeMemory(prog, st);
  st.SA1 = true;
  settle(prog, st);
  ok('P(SA1) se activa en el ciclo en que SA1 pasa a true', st.M1 === true);
  commitEdgeMemory(prog, st);
  settle(prog, st); // "siguiente ciclo", SA1 sigue true pero ya no es un flanco nuevo
  ok('P(SA1) se desactiva el ciclo siguiente aunque SA1 siga true', st.M1 === false);
}
{
  const prog = parseProgram(`INPUT SA1\nCOIL M1 = N(SA1)`);
  const st = blankState(prog);
  st.SA1 = true;
  settle(prog, st);
  commitEdgeMemory(prog, st);
  ok('N(SA1) no dispara mientras SA1 sigue true', st.M1 === false);
  st.SA1 = false;
  settle(prog, st);
  ok('N(SA1) se activa en el ciclo en que SA1 pasa a false', st.M1 === true);
}
{
  // dos P() sobre la misma señal en dos sitios distintos no se pisan (edgeId por nodo)
  const prog = parseProgram(`INPUT SA1\nCOIL M1 = P(SA1)\nCOIL M2 = P(SA1) AND M1`);
  ok('dos P(SA1) en el mismo programa reciben edgeId distintos',
     prog.edgeNodes.length === 2 && prog.edgeNodes[0].edgeId !== prog.edgeNodes[1].edgeId);
}

/* ── CTU / CTD: solo se comprueba el parseo y los campos aquí —
   el conteo real por flanco en tiempo real se prueba en app.dom.test.mjs ── */
{
  const prog = parseProgram(`INPUT SA1 SA2\nCOUNTER C1 = CTU(SA1, RESET(SA2), 3)`);
  ok('COUNTER CTU parsea con kind=ctu y preset=3', prog.counters[0].kind === 'ctu' && prog.counters[0].preset === 3);
}
{
  const prog = parseProgram(`INPUT SA1 SA2\nCOUNTER C1 = CTD(SA1, RESET(SA2), 5)`);
  ok('COUNTER CTD parsea con kind=ctd', prog.counters[0].kind === 'ctd');
}
throws('CTU sin RESET(...) da error claro', () => parseProgram(`INPUT SA1\nCOUNTER C1 = CTU(SA1, SA1, 3)`));

/* ── TIMER FLASH: solo parseo aquí ── */
{
  const prog = parseProgram(`INPUT SA1\nTIMER F1 = FLASH(SA1, 1, 2)`);
  ok('TIMER FLASH parsea con presetOn/presetOff', prog.timers[0].kind === 'flash' && prog.timers[0].presetOn === 1 && prog.timers[0].presetOff === 2);
}

/* ── Referencia no declarada / duplicados (regresión de la v1) ── */
throws('referencia no declarada detectada', () => parseProgram(`INPUT SA1\nCOIL M1 = SA1 AND SA2`));
throws('nombre duplicado detectado', () => parseProgram(`INPUT SA1\nCOIL M1 = SA1\nCOIL M1 = !SA1`));

/* ── Oscilación real ── */
{
  const prog = parseProgram(`COIL M2 = !M2`);
  const st = blankState(prog);
  ok('oscilación detectada (settle devuelve false)', settle(prog, st) === false);
}

/* ── SELECTOR: 2/3/4 posiciones, exactamente una activa ── */
{
  const prog = parseProgram(`SELECTOR SW1 = HAND, OFF, AUTO\nCOIL M1 = SW1_HAND\nCOIL M2 = SW1_AUTO`);
  const st = blankState(prog);
  ok('SELECTOR: posición inicial (índice 0) es la primera declarada', st.SW1_HAND === true);
  ok('SELECTOR: las demás posiciones empiezan a false', st.SW1_OFF === false && st.SW1_AUTO === false);
  settle(prog, st);
  ok('SELECTOR: en posición HAND, M1 se activa y M2 no', st.M1 === true && st.M2 === false);

  setSelectorPosition(prog, st, 'SW1', 2); // AUTO
  ok('SELECTOR: al cambiar a AUTO, solo esa posición es true',
     st.SW1_HAND === false && st.SW1_OFF === false && st.SW1_AUTO === true);
  settle(prog, st);
  ok('SELECTOR: en posición AUTO, M2 se activa y M1 no', st.M1 === false && st.M2 === true);

  nextSelectorPosition(prog, st, 'SW1'); // AUTO(2) -> cíclico -> HAND(0)
  ok('SELECTOR: nextSelectorPosition es cíclico (de la última vuelve a la primera)', st.SW1_HAND === true);
}
throws('SELECTOR con 1 sola posición da error', () => parseProgram(`SELECTOR SW1 = SOLO`));
throws('SELECTOR con 5 posiciones da error (máximo 4)', () => parseProgram(`SELECTOR SW1 = A,B,C,D,E`));
throws('SELECTOR con posiciones repetidas da error', () => parseProgram(`SELECTOR SW1 = A,A`));
throws('usar el nombre base del SELECTOR como contacto da un error con pista',
  () => parseProgram(`SELECTOR SW1 = A,B\nCOIL M1 = SW1`));
throws('SELECTOR y COIL no pueden compartir nombre',
  () => parseProgram(`SELECTOR SW1 = A,B\nCOIL SW1 = SW1_A`));

/* ── IMPULSE (telerruptor): solo parseo aquí — el comportamiento de
   conmutación por flanco vive en app.js (updateImpulsesRealtime), como
   los COUNTER; se prueba en app.dom.test.mjs ── */
{
  const prog = parseProgram(`INPUT SB1\nIMPULSE LB1 = SB1`);
  ok('IMPULSE parsea correctamente', prog.impulses.length === 1 && prog.impulses[0].name === 'LB1');
}
throws('IMPULSE con nombre repetido de COIL da error',
  () => parseProgram(`INPUT SB1\nCOIL LB1 = SB1\nIMPULSE LB1 = SB1`));

/* ── convenciones de nombre para dispositivos de protección ── */
ok('isThermal("FT1")', isThermal('FT1') === true);
ok('isBreaker("QM2")', isBreaker('QM2') === true);
ok('isFuse("FU3")', isFuse('FU3') === true);
ok('isDisconnect("QS1")', isDisconnect('QS1') === true);
ok('isRCD("DIF1") y isRCD("RCD1")', isRCD('DIF1') === true && isRCD('RCD1') === true);
ok('un nombre normal no activa ninguna convención de dispositivo',
   !isThermal('SA1') && !isBreaker('SA1') && !isFuse('SA1') && !isDisconnect('SA1') && !isRCD('SA1'));

/* ── POWERCHAIN (desazucarado sobre LINK+MOTOR): camino de potencia lineal ── */
{
  const prog = parseProgram(`INPUT SB1 SB2 QM1 FT1
LATCH KM1 = SET(SB1) RESET(SB2)
POWERCHAIN P1 = QM1 -> KM1 -> FT1 -> MOTOR M1`);
  ok('POWERCHAIN se desazucariza en 3 LINK y 1 MOTOR',
     prog.powerLinks.length === 3 && prog.motors.length === 1 && prog.motors[0].name === 'M1');
  ok('QM1/FT1 se resuelven como protección, KM1 como contactor',
     prog.powerLinks[0].kind === 'protective' &&
     prog.powerLinks[1].kind === 'contactor' &&
     prog.powerLinks[2].kind === 'protective');
  const st = blankState(prog);
  ok('M1 (motor) empieza a false', st.M1 === false);
}
throws('POWERCHAIN sin "MOTOR" al final da error',
  () => parseProgram(`INPUT QM1\nPOWERCHAIN P1 = QM1 -> QM1`));
throws('POWERCHAIN con una entrada sin prefijo de protección reconocido da error',
  () => parseProgram(`INPUT SA1\nPOWERCHAIN P1 = SA1 -> MOTOR M1`));
throws('POWERCHAIN con un nombre no declarado da error',
  () => parseProgram(`POWERCHAIN P1 = KM1 -> MOTOR M1`));
throws('dos POWERCHAIN no pueden compartir nombre de motor',
  () => parseProgram(`INPUT QM1 QM2\nPOWERCHAIN P1 = QM1 -> MOTOR M1\nPOWERCHAIN P2 = QM2 -> MOTOR M1`));

/* ── LINK/MOTOR/INTERLOCK: inversor de giro con interbloqueo real ── */
{
  const prog = parseProgram(`INPUT SB1 SB2 QM1
LATCH KM1 = SET(SB1) RESET(SB2)
LATCH KM2 = SET(SB2) RESET(SB1)
LINK QM1 = L1,L2,L3 -> a,b,c
LINK KM1 = a,b,c -> U1,V1,W1
LINK KM2 = a,b,c -> V1,U1,W1
MOTOR M1 = U1,V1,W1
INTERLOCK KM1, KM2`);
  ok('LINK/MOTOR/INTERLOCK parsean bien', prog.powerLinks.length === 3 && prog.interlocks.length === 1);

  // KM1 solo (marcha adelante): motor energizado, sentido horario
  let st = blankState(prog);
  st.SB1 = true; settle(prog, st);
  let net = computePowerNetwork(prog, st);
  ok('con KM1 cerrado, el motor queda energizado en sentido horario',
     net.motorResults.M1.energized && net.motorResults.M1.rotation === 'cw');

  // KM2 solo (marcha atrás, fases cruzadas): sentido antihorario
  st = blankState(prog);
  st.SB2 = true; settle(prog, st);
  net = computePowerNetwork(prog, st);
  ok('con KM2 cerrado (fases cruzadas), el sentido es antihorario',
     net.motorResults.M1.energized && net.motorResults.M1.rotation === 'ccw');

  // los dos a la vez (forzando el estado, sin pasar por el control):
  // el interbloqueo bloquea mecánicamente el segundo — sigue sin haber corto
  st = blankState(prog);
  st.KM1 = true; st.KM2 = true;
  net = computePowerNetwork(prog, st);
  ok('con el interbloqueo puesto, el segundo contactor queda mecánicamente bloqueado',
     net.mechBlocked.has('KM2') && !net.mechBlocked.has('KM1'));
  ok('gracias al interbloqueo, NO hay cortocircuito aunque ambas bobinas estén activas',
     net.shortedNodes.length === 0);
}
{
  // el mismo circuito pero SIN interbloqueo: forzando ambos contactores,
  // el motor detecta un cortocircuito de verdad en V1 y dispara QM1
  const prog = parseProgram(`INPUT QM1 X
COIL KM1 = X
COIL KM2 = X
LINK QM1 = L1,L2,L3 -> a,b,c
LINK KM1 = a,b,c -> U1,V1,W1
LINK KM2 = a,b,c -> V1,U1,W1
MOTOR M1 = U1,V1,W1`);
  const st = blankState(prog);
  st.KM1 = true; st.KM2 = true; // forzado, como si el control tuviera un fallo de diseño
  const net = computePowerNetwork(prog, st);
  ok('sin interbloqueo, forzar ambos contactores produce un cortocircuito real',
     net.shortedNodes.includes('V1'));
  ok('el cortocircuito identifica QM1 como la protección a disparar',
     net.toTrip.has('QM1'));
  ok('el motor NO queda energizado con un cortocircuito en uno de sus terminales',
     net.motorResults.M1.energized === false);
}
throws('INTERLOCK con un nombre no declarado da error',
  () => parseProgram(`INPUT QM1\nLINK QM1 = L1,L2,L3 -> U1,V1,W1\nMOTOR M1 = U1,V1,W1\nINTERLOCK QM1, KMX`));
throws('INTERLOCK sobre una protección (no un contactor) da error',
  () => parseProgram(`INPUT QM1 QM2\nLINK QM1 = L1,L2,L3 -> U1,V1,W1\nMOTOR M1 = U1,V1,W1\nINTERLOCK QM1, QM2`));

/* ── PLC (tipo de autómata) / EXPANSION: solo metadatos visuales ── */
{
  const prog = parseProgram(`INPUT SA1\nCOIL M1 = SA1`);
  ok('sin declarar PLC, por defecto es "logo"', prog.plcType === 'logo');
}
{
  const prog = parseProgram(`PLC S71200\nEXPANSION EM1\nEXPANSION EM2\nINPUT SA1\nCOIL M1 = SA1`);
  ok('PLC S71200 se reconoce', prog.plcType === 's71200');
  ok('EXPANSION añade módulos en orden', prog.expansions.length === 2 && prog.expansions[0] === 'EM1');
}
throws('PLC con un modelo no reconocido da error', () => parseProgram(`PLC ARDUINO\nINPUT SA1\nCOIL M1 = SA1`));

/* ── N (neutro) y PE (tierra): cargas monofásicas y fuga a tierra real ── */
{
  const prog = parseProgram(`INPUT QM1
LINK QM1 = L1,N -> a,b
LOAD EL1 = a,b`);
  ok('LOAD parsea con kind="load"', prog.motors[0].kind === 'load');
  const st = blankState(prog);
  const net = computePowerNetwork(prog, st);
  ok('carga monofásica L-N queda energizada sin necesitar 3 fases', net.motorResults.EL1.energized === true);
}
{
  // fuga a tierra real: una fase toca PE directamente (aislamiento dañado,
  // simulado como un LINK explícito) -> debe detectarse igual que un
  // cortocircuito entre fases, y aparecer en groundFaultNodes
  const prog = parseProgram(`INPUT QM1 X
COIL KFUGA = X
LINK QM1 = L1,L2,L3 -> a,b,c
LINK KFUGA = PE -> b
LOAD EL1 = b,c`);
  const st = blankState(prog);
  st.KFUGA = true; // simula el fallo de aislamiento
  const net = computePowerNetwork(prog, st);
  ok('fuga a tierra: el nodo en conflicto aparece en groundFaultNodes',
     net.groundFaultNodes.includes('b'));
  ok('fuga a tierra: también cuenta como shortedNodes (mismo mecanismo)',
     net.shortedNodes.includes('b'));
}
throws('LOAD con nombre repetido de MOTOR da error',
  () => parseProgram(`LINK QM1 = L1,N -> a,b\nMOTOR M1 = a,b\nLOAD M1 = a,b`));

console.log(`\n${pass} OK, ${fail} FALLOS`);
process.exit(fail ? 1 : 0);

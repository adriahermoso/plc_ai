// examples.js — circuitos de ejemplo, con metadatos para mostrarlos en la UI
// (antes solo tenían el texto del <option>; ahora llevan también una
// descripción corta que se muestra al elegir el ejemplo).

export const EXAMPLES = {
  lights: {
    label: 'Secuencia LB1 → LB2 → LB3',
    description: 'SB1 arranca una secuencia de 3 lámparas con 2 s entre cada una; SB2 la cancela.',
    code: `# Secuencia automática: SB1 arranca, SB2 cancela
# LB1 → (2 s) → LB2 → (2 s) → LB3 → (2 s) → apagar todo
# 1 paso de TIMER = 1 segundo real (reloj automático)
INPUT SB1 SB2

LATCH RUN = SET(SB1) RESET(SB2 OR DONE)
TIMER T1 = ONDELAY(RUN, 2)
TIMER T2 = ONDELAY(T1, 2)
TIMER T3 = ONDELAY(T2, 2)

COIL LB1 = RUN AND !T3
COIL LB2 = T1 AND !T3
COIL LB3 = T2 AND !T3
COIL DONE = T3
`,
  },
  motor: {
    label: 'Motor + auto-retención + retardo',
    description: 'Arranque/paro con enclavamiento, permiso e interbloqueo por fin de carrera, más una señal retardada 3 s.',
    code: `# Motor trifásico con LOGO! — auto-retención, interbloqueo y retardo
# SB1 marcha, SB2 paro, SA3 permiso, SQ1 fin de carrera (NC simulado)
INPUT SB1 SB2 SA3 SQ1

# Contactor KM1 con auto-retención; paro y fin de carrera cortan
LATCH KM1 = SET(SB1 AND SA3) RESET(SB2 OR !SQ1)

# Señalización: marcha y fallo de permiso
COIL EL1 = KM1
COIL EL2 = !SA3

# Tras 3 s con KM1 activo → listo
TIMER TON1 = ONDELAY(KM1, 3)
COIL EL3 = TON1
`,
  },
  xor: {
    label: 'Cargas exclusivas SA1/SA2',
    description: 'Dos salidas mutuamente excluyentes según qué selector esté activo.',
    code: `# Dos cargas mutuamente excluyentes
INPUT SA1 SA2

COIL M1 = SA1 AND !SA2
COIL M2 = !SA1 AND SA2
COIL EL1 = M1
COIL EL2 = M2
`,
  },
  latch: {
    label: 'Arranque / paro simple',
    description: 'El circuito más básico: un LATCH con set y reset, sin temporizadores.',
    code: `# Arranque / paro clásico
INPUT SB1 SB2

LATCH EL1 = SET(SB1) RESET(SB2)
`,
  },
  protections: {
    label: 'Telerruptor + símbolos de protección',
    description: 'Un telerruptor (pulso enciende/apaga) protegido por térmico, magnetotérmico, fusible, seccionador y diferencial — solo cambian el icono, la lógica es booleana normal.',
    code: `# Telerruptor con protecciones (los iconos son solo por el nombre)
INPUT SB1 FT1 QM1 FU1 QS1 DIF1

# el telerruptor conmuta con cada pulso de SB1
IMPULSE LB1 = SB1

# la lámpara solo enciende si el telerruptor está activo Y todas
# las protecciones están en buen estado (aquí, simuladas como "cerradas")
COIL EL1 = LB1 AND FT1 AND QM1 AND FU1 AND QS1 AND DIF1
`,
  },
  selector: {
    label: 'Selector Manual/Paro/Automático',
    description: 'Selector de 3 posiciones: en MANUAL, SB1 mueve el motor directamente; en AUTOMÁTICO, un temporizador lo hace solo; en PARO, nada se mueve.',
    code: `# Selector de 3 posiciones (Hand-Off-Auto)
INPUT SB1 ES1

# el selector crea las señales SW1_MANUAL, SW1_PARO, SW1_AUTO
# (exactamente una está activa a la vez)
SELECTOR SW1 = MANUAL, PARO, AUTO

# en automático, un TIMER FLASH hace de "marcha/paro" solo
TIMER AUTO_PULSO = FLASH(SW1_AUTO, 2, 2)

SET KM1 = (SW1_MANUAL AND SB1) OR (SW1_AUTO AND AUTO_PULSO)
RESET KM1 = SW1_PARO OR ES1

COIL EL1 = KM1
`,
  },
  advanced: {
    label: 'SET/RESET + flanco + contador + intermitente',
    description: 'Repaso de las construcciones nuevas: KM1 con SET/RESET, un contador de piezas por flanco, y un piloto intermitente mientras la máquina está en marcha.',
    code: `# Repaso de las construcciones "Grupo 1"
INPUT SB1 SB2 SB3 ES1

# SET/RESET: dos líneas independientes en vez de un único LATCH.
# Si ambas condiciones coincidieran en el mismo ciclo, gana la que
# está más abajo en el programa — aquí, RESET (por la seta de
# emergencia) manda siempre sobre el SET.
SET KM1 = SB1
RESET KM1 = SB2 OR ES1

# Contador de piezas: cada pulso de SB3 (flanco de subida) suma 1;
# ES1 lo pone a cero. Al llegar a 3 se enciende C1.
COUNTER C1 = CTU(SB3, RESET(ES1), 3)

# P(SB3): se activa un único ciclo justo cuando se pulsa SB3
# (no mientras se mantiene pulsado, como haría un contacto normal)
COIL PULSO = P(SB3)

# piloto intermitente mientras la máquina está en marcha
TIMER LB1 = FLASH(KM1, 1, 1)

COIL LB2 = C1
`,
  },
  seq: {
    label: 'Secuencia A/B/C',
    description: 'A se activa al arrancar, B tras 2 s; C se mantiene 3 s tras soltar el arranque.',
    code: `# Secuencia: A → espera → B → apaga
INPUT SB1 SB2

LATCH RUN = SET(SB1) RESET(SB2)
TIMER T1 = ONDELAY(RUN, 2)
COIL A = RUN AND !T1
COIL B = T1

TIMER T2 = OFFDELAY(RUN, 3)
COIL C = T2 AND !RUN
`,
  },
};

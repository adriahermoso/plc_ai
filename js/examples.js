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

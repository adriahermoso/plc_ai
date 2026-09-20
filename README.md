# relaysim

Simulador de esquemas de relés/contactores con automatismo programable (tipo
Siemens LOGO!), en el navegador, en tiempo real.

## Estructura

```
index.html          escritorio (barra + panel lateral + lienzo)
mobile.html          versión para teléfono (cajón deslizante + barra inferior)
css/
  base.css            tokens compartidos (colores/tipografía) + componentes comunes
  desktop.css          layout exclusivo de index.html
  mobile.css           layout exclusivo de mobile.html
components/
  components.json   metadatos de los 25 símbolos
  contacts/ … logic/  SVG de cada símbolo
js/
  components.js       biblioteca embebida + placeSymbol()
  core.js             parser + motor de simulación (sin DOM, reutilizable)
  render.js            generación del SVG (escalera + módulo LOGO!)
  examples.js          los 5 circuitos de ejemplo, con descripción
  app.js               estado, reloj en tiempo real y eventos de interfaz
                        (idéntico para index.html y mobile.html: ambas
                        páginas exponen los mismos IDs de elemento)
test/
  core.test.mjs         pruebas del parser/simulador (sin DOM)
  app.dom.test.mjs       pruebas de extremo a extremo con jsdom (simula
                          pulsaciones reales y espera tiempo real para
                          comprobar los temporizadores en cascada)
.nojekyll             evita que GitHub Pages intente procesar esto con Jekyll
```

No hay paso de build: son archivos estáticos tal cual, con módulos ES
(`<script type="module">`) que se cargan por ruta relativa.

## Configuración de GitHub Pages

En el repositorio (`adriahermoso/plc_ai`):

1. **Settings → Pages**
2. **Source:** `Deploy from a branch`
3. **Branch:** `main`, carpeta **`/ (root)`**
4. Guardar.

No hace falta ninguna otra configuración ni build step: GitHub Pages sirve
`index.html` como página por defecto en
`https://adriahermoso.github.io/plc_ai/`, y la versión de teléfono queda en
`https://adriahermoso.github.io/plc_ai/mobile.html`.

El `.nojekyll` está para que Pages no intente pasar el sitio por Jekyll (no
lo necesita, pero evita sorpresas si algún nombre de carpeta empezara por
guion bajo en el futuro).

## Pruebas (opcional)

Si quieres poder ejecutar las pruebas localmente al seguir tocando el
código:

```bash
npm install
npm test
```

Esto instala `jsdom` como dependencia de desarrollo (no se usa en producción,
solo para las pruebas) y ejecuta las dos baterías de pruebas.

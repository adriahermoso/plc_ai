import { JSDOM } from 'jsdom';

let pass = 0, fail = 0;
function ok(desc, cond) { if (cond) { pass++; console.log('OK   ', desc); } else { fail++; console.log('FALLO', desc); } }

const dom = new JSDOM(`<!doctype html><html><body>
  <div id="c" style="width:300px;height:300px;">
    <div id="t"></div>
    <button id="b" data-in="X">X</button>
  </div>
</body></html>`, { url: 'http://localhost/' });
global.window = dom.window;
global.document = dom.window.document;

const { initPanning } = await import('../js/pan.js');

function fireP(el, type, props) {
  const e = new dom.window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { pointerId: 1, pointerType: 'touch', button: 0 }, props);
  el.dispatchEvent(e);
  return e;
}

const container = document.getElementById('c');
const target = document.getElementById('t');
const btn = document.getElementById('b');
const pan = initPanning(container, target);

// 1. arrastre normal sobre el lienzo (no sobre un elemento interactivo)
ok('transform inicial vacío', target.style.transform === '');
fireP(container, 'pointerdown', { clientX: 100, clientY: 100 });
fireP(container, 'pointermove', { clientX: 130, clientY: 90 }); // se mueve 30px, por encima del umbral
ok('tras mover más del umbral, el transform refleja el desplazamiento',
   target.style.transform === 'translate(30px, -10px) scale(1)');
fireP(container, 'pointermove', { clientX: 150, clientY: 80 });
ok('sigue actualizando mientras se arrastra', target.style.transform === 'translate(50px, -20px) scale(1)');
fireP(container, 'pointerup', { clientX: 150, clientY: 80 });
ok('el lienzo queda "agarrado" (grabbing) durante el arrastre y se suelta al terminar',
   !container.classList.contains('grabbing'));

// 2. tras un arrastre real, el click que sigue debe suprimirse
let clicked = false;
target.addEventListener('click', () => { clicked = true; });
fireP(target, 'click', {});
ok('el click posterior a un arrastre real se suprime (no llega al contenido)', clicked === false);

// 3. un segundo click normal (sin arrastre de por medio) si debe pasar
fireP(target, 'click', {});
ok('un click normal (sin arrastre previo) sí que pasa', clicked === true);

// 4. reset() vuelve a (0,0)
ok('reset() vuelve el transform a translate(0px, 0px)', (pan.reset(), target.style.transform === 'translate(0px, 0px) scale(1)'));

// 5. un gesto que empieza sobre un elemento data-in NO debe arrastrar el lienzo
pan.reset();
fireP(btn, 'pointerdown', { clientX: 10, clientY: 10 });
fireP(container, 'pointermove', { clientX: 60, clientY: 60 }); // mismo pointerId, pero pointerdown no se registró para el lienzo
ok('un gesto iniciado sobre [data-in] no mueve el lienzo', target.style.transform === 'translate(0px, 0px) scale(1)');

// 6. un movimiento por debajo del umbral no cuenta como arrastre (no suprime el click)
pan.reset();
let clicked2 = false;
target.addEventListener('click', () => { clicked2 = true; });
fireP(container, 'pointerdown', { clientX: 200, clientY: 200 });
fireP(container, 'pointermove', { clientX: 202, clientY: 201 }); // 2px, por debajo del umbral de 6
fireP(container, 'pointerup', { clientX: 202, clientY: 201 });
fireP(target, 'click', {});
ok('un movimiento pequeño (por debajo del umbral) no suprime el click siguiente', clicked2 === true);
ok('y tampoco produce ningún desplazamiento visible', target.style.transform === 'translate(0px, 0px) scale(1)');

// 7. zoom con la rueda: acerca (deltaY negativo) y se mantiene dentro de límites
pan.reset();
function fireWheel(el, deltaY, clientX, clientY) {
  const e = new dom.window.Event('wheel', { bubbles: true, cancelable: true });
  Object.assign(e, { deltaY, clientX, clientY });
  el.dispatchEvent(e);
}
fireWheel(container, -100, 150, 150); // deltaY negativo = acercar (zoom in)
const scaleAfterZoomIn = pan.getScale();
ok('la rueda hacia arriba (deltaY negativo) hace zoom in (scale > 1)', scaleAfterZoomIn > 1);
fireWheel(container, 100, 150, 150); // deltaY positivo = alejar (zoom out) — vuelve cerca de 1
const scaleAfterZoomOut = pan.getScale();
ok('la rueda hacia abajo (deltaY positivo) reduce el zoom de nuevo', scaleAfterZoomOut < scaleAfterZoomIn);

// 8. el zoom no se sale de los límites por mucho que se insista
pan.reset();
for (let i = 0; i < 100; i++) fireWheel(container, -500, 0, 0);
ok('el zoom in no pasa del máximo (4x)', pan.getScale() <= 4);
pan.reset();
for (let i = 0; i < 100; i++) fireWheel(container, 500, 0, 0);
ok('el zoom out no baja del mínimo (0.25x)', pan.getScale() >= 0.25);

// 9. el zoom mantiene fijo el punto del diagrama bajo el cursor
// (el punto de contenido bajo (mx,my) debe corresponder al mismo punto
// de pantalla antes y después de la rueda)
pan.reset();
fireP(container, 'pointerdown', { clientX: 0, clientY: 0 });
fireP(container, 'pointermove', { clientX: 20, clientY: 10 }); // desplaza un poco primero
fireP(container, 'pointerup', { clientX: 20, clientY: 10 });
{
  const before = pan.getScale();
  // parsea el transform actual para sacar panX/panY antes del zoom
  const m1 = target.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/);
  const [px1, py1, s1] = [parseFloat(m1[1]), parseFloat(m1[2]), parseFloat(m1[3])];
  const mx = 60, my = 40;
  const contentX = (mx - px1) / s1, contentY = (my - py1) / s1; // punto de contenido bajo el cursor
  fireWheel(container, -200, mx, my);
  const m2 = target.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/);
  const [px2, py2, s2] = [parseFloat(m2[1]), parseFloat(m2[2]), parseFloat(m2[3])];
  const screenXafter = px2 + contentX * s2, screenYafter = py2 + contentY * s2;
  ok('el punto bajo el cursor se queda fijo en pantalla tras el zoom (eje X)',
     Math.abs(screenXafter - mx) < 0.01);
  ok('el punto bajo el cursor se queda fijo en pantalla tras el zoom (eje Y)',
     Math.abs(screenYafter - my) < 0.01);
}

console.log(`\n${pass} OK, ${fail} FALLOS`);
process.exit(fail ? 1 : 0);

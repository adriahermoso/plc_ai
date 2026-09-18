// pan.js — navegación del lienzo tipo CAD: arrastrar para mover (dedo o
// ratón, vía Pointer Events) y rueda/trackpad para hacer zoom hacia donde
// está el cursor. Lo usan tanto index.html como mobile.html.
//
// Reglas:
//  - Si el gesto empieza sobre un elemento interactivo del esquema
//    (data-in: pulsadores, selectores...), no se activa el arrastre — ese
//    elemento gestiona su propio toque/clic con normalidad.
//  - Si el gesto se mueve más de un pequeño umbral, se considera arrastre
//    y se suprime el "click" que llegaría al soltar (para no disparar por
//    accidente un contacto al pasar el dedo/ratón por encima al arrastrar).
//  - El zoom con la rueda mantiene fijo el punto del diagrama que hay bajo
//    el cursor (como cualquier editor tipo CAD), no hace zoom al centro.
export function initPanning(container, target, opts = {}) {
  const { minScale = 0.25, maxScale = 4, onChange = null } = opts;
  let panX = 0, panY = 0, scale = 1;
  let startX = 0, startY = 0, startPanX = 0, startPanY = 0;
  let pointerId = null;
  let dragging = false;
  let justDragged = false;
  const THRESHOLD = 6;

  function apply() {
    target.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    if (onChange) onChange({ panX, panY, scale });
  }

  container.addEventListener('pointerdown', (e) => {
    if (e.target.closest('[data-in]')) return; // deja el control interactivo intacto
    if (e.pointerType === 'mouse' && e.button !== 0) return; // solo botón izquierdo
    pointerId = e.pointerId;
    startX = e.clientX; startY = e.clientY;
    startPanX = panX; startPanY = panY;
    dragging = false;
  });

  container.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (!dragging && Math.hypot(dx, dy) > THRESHOLD) {
      dragging = true;
      container.classList.add('grabbing');
      try { container.setPointerCapture(pointerId); } catch (_) { /* ignorar */ }
    }
    if (dragging) {
      panX = startPanX + dx;
      panY = startPanY + dy;
      apply();
      e.preventDefault();
    }
  });

  function endDrag(e) {
    if (e.pointerId !== pointerId) return;
    if (dragging) justDragged = true;
    pointerId = null;
    dragging = false;
    container.classList.remove('grabbing');
  }
  container.addEventListener('pointerup', endDrag);
  container.addEventListener('pointercancel', endDrag);

  // si el gesto fue un arrastre real, que no dispare además un "click"
  // sobre lo que hubiera debajo del dedo/ratón al soltar
  container.addEventListener('click', (e) => {
    if (justDragged) { e.stopPropagation(); e.preventDefault(); justDragged = false; }
  }, true);

  // zoom con rueda/trackpad, manteniendo fijo el punto bajo el cursor
  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0012);
    const newScale = Math.min(maxScale, Math.max(minScale, scale * factor));
    const actual = newScale / scale;
    panX = mx - (mx - panX) * actual;
    panY = my - (my - panY) * actual;
    scale = newScale;
    apply();
  }, { passive: false });

  return {
    reset() { panX = 0; panY = 0; scale = 1; apply(); },
    getScale() { return scale; },
  };
}

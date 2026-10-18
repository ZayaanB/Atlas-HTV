import type { Map } from 'mapbox-gl';

export const IDLE_SPIN_DELAY = 3000;
export const IDLE_SPIN_EVENT = 'atlasIdleSpin';
type SpinMap = Pick<Map, 'getCenter' | 'getZoom' | 'isMoving' | 'jumpTo'>;

/** Decorative camera motion stays local; publish only at spin start/pause. */
export function startIdleGlobeSpin(map: SpinMap, canSpin: () => boolean, publishViewport: () => void): () => void {
  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let timer: number | undefined, frame: number | undefined;
  let stopped = false, held = false, spinning = false;
  let lastInput = performance.now(), lastPaint: number | undefined;
  const paused = () => stopped || document.hidden || motion?.matches;
  const cancel = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    if (frame !== undefined) window.cancelAnimationFrame(frame);
    timer = frame = undefined;
    lastPaint = undefined;
    if (spinning) { spinning = false; if (!stopped) publishViewport(); }
  };
  const schedule = (delay: number) => {
    if (!paused()) timer = window.setTimeout(() => {timer = undefined; frame = window.requestAnimationFrame(tick);}, delay);
  };
  const tick = (time: number) => {
    frame = undefined;
    if (paused()) { cancel(); return; }
    const editing = document.activeElement?.matches('input,textarea,select,[contenteditable="true"]');
    const wait = IDLE_SPIN_DELAY - (performance.now() - lastInput);
    if (held || editing || !canSpin() || map.isMoving() || map.getZoom() >= 3 || wait > 0) {
      cancel();
      schedule(Math.max(1000, wait));
      return;
    }
    if (lastPaint === undefined) lastPaint = time;
    const elapsed = time - lastPaint;
    if (elapsed >= 1000 / 30) {
      lastPaint = time;
      const center = map.getCenter();
      // Two degrees per second at globe scale, slowing to zero between zoom 2–3.
      const speed = 2 * Math.min(1, Math.max(0, 3 - map.getZoom()));
      const longitude = ((center.lng - speed * Math.min(elapsed, 100) / 1000 + 180) % 360 + 360) % 360 - 180;
      map.jumpTo({center: [longitude, center.lat]}, {[IDLE_SPIN_EVENT]: true});
      if (!spinning) { spinning = true; publishViewport(); }
    }
    frame = window.requestAnimationFrame(tick);
  };
  const input = () => {lastInput = performance.now(); cancel(); schedule(IDLE_SPIN_DELAY);};
  const down = () => {held = true; input();};
  const up = () => {held = false; input();};
  const visibility = () => {held = false; input();};
  // An embedded browser loses focus when the user clicks the adjacent chat.
  // Release a held pointer, but keep visible idle animation eligible to resume.
  const blur = () => {held = false; input();};
  const focus = () => input();
  document.addEventListener('pointerdown', down, {capture:true, passive:true});
  document.addEventListener('pointerup', up, {capture:true, passive:true});
  document.addEventListener('pointercancel', up, {capture:true, passive:true});
  document.addEventListener('wheel', input, {capture:true, passive:true});
  document.addEventListener('keydown', input, true);
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('blur', blur);
  window.addEventListener('focus', focus);
  motion?.addEventListener('change', input);
  schedule(IDLE_SPIN_DELAY);
  return () => {
    stopped = true;
    cancel();
    document.removeEventListener('pointerdown', down, true);
    document.removeEventListener('pointerup', up, true);
    document.removeEventListener('pointercancel', up, true);
    document.removeEventListener('wheel', input, true);
    document.removeEventListener('keydown', input, true);
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('blur', blur);
    window.removeEventListener('focus', focus);
    motion?.removeEventListener('change', input);
  };
}

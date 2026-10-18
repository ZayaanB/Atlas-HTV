import {afterEach, expect, it, vi} from 'vitest';
import {IDLE_SPIN_DELAY, IDLE_SPIN_EVENT, startIdleGlobeSpin} from './idle-spin';

afterEach(() => {vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();});
function setup() {
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout','performance']});
  let frameId = 0, lng = -100, zoom = 1.5, moving = false, hidden = false, ready = true;
  const frames = new Map<number,FrameRequestCallback>();
  const motion = Object.assign(new EventTarget(),{matches:false});
  vi.stubGlobal('matchMedia',() => motion);
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback) => {frames.set(++frameId,callback); return frameId;});
  vi.stubGlobal('cancelAnimationFrame',(id:number) => frames.delete(id));
  vi.spyOn(document,'hidden','get').mockImplementation(() => hidden);
  const jump = vi.fn((options:{center:[number,number]}) => {lng = options.center[0];});
  const map = {getCenter:() => ({lng,lat:32}),getZoom:() => zoom,isMoving:() => moving,jumpTo:jump} as unknown as Parameters<typeof startIdleGlobeSpin>[0];
  const publish = vi.fn();
  const stop = startIdleGlobeSpin(map,() => ready,publish);
  const tick = (delta=40) => {
    vi.advanceTimersByTime(delta);
    const next = [...frames][0];
    if (!next) return;
    frames.delete(next[0]); next[1](performance.now());
  };
  const begin = () => {vi.advanceTimersByTime(IDLE_SPIN_DELAY); tick(); tick();};
  return {frames,motion,jump,publish,stop,tick,begin,get longitude(){return lng;},
    setZoom:(value:number) => {zoom=value;},setMoving:(value:boolean) => {moving=value;},setHidden:(value:boolean) => {hidden=value;},setReady:(value:boolean) => {ready=value;}};
}

it('waits for idle, rotates longitude without changing latitude, slows at higher zoom and publishes only at start/pause',()=>{
  const spin = setup();
  vi.advanceTimersByTime(IDLE_SPIN_DELAY-1);
  expect(spin.frames.size).toBe(0);
  expect(spin.jump).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1); spin.tick(); spin.tick();
  expect(spin.longitude).toBeCloseTo(-100.08);
  expect(spin.jump).toHaveBeenLastCalledWith({center:[expect.any(Number),32]},{[IDLE_SPIN_EVENT]:true});
  spin.tick(); expect(spin.publish).toHaveBeenCalledTimes(1);
  spin.setZoom(2.5);
  const before = spin.longitude;
  spin.tick(); expect(before-spin.longitude).toBeCloseTo(0.04);
  document.dispatchEvent(new Event('wheel'));
  expect(spin.frames.size).toBe(0);
  expect(spin.publish).toHaveBeenCalledTimes(2);
  spin.stop();
});

it('pauses for held pointers and keyboard input, then waits three seconds after interaction',()=>{
  const spin = setup(); spin.begin();
  document.dispatchEvent(new Event('pointerdown'));
  const calls = spin.jump.mock.calls.length;
  spin.begin(); spin.tick();
  expect(spin.jump).toHaveBeenCalledTimes(calls);
  document.dispatchEvent(new Event('pointerup'));
  vi.advanceTimersByTime(IDLE_SPIN_DELAY-1);
  expect(spin.frames.size).toBe(0);
  vi.advanceTimersByTime(1); spin.tick(); spin.tick();
  expect(spin.jump.mock.calls.length).toBeGreaterThan(calls);
  document.dispatchEvent(new Event('keydown'));
  expect(spin.frames.size).toBe(0);
  spin.stop();
});

it('stays still at local zoom, during other camera motion, loading/inspection, and text editing',()=>{
  const spin = setup(); spin.setZoom(3); spin.begin();
  expect(spin.jump).not.toHaveBeenCalled();
  spin.setZoom(1.5); spin.setMoving(true); vi.advanceTimersByTime(1000); spin.tick();
  expect(spin.jump).not.toHaveBeenCalled();
  spin.setMoving(false); spin.setReady(false); vi.advanceTimersByTime(1000); spin.tick();
  expect(spin.jump).not.toHaveBeenCalled();
  spin.setReady(true);
  const input = document.createElement('input'); document.body.append(input); input.focus();
  vi.advanceTimersByTime(1000); spin.tick();
  expect(spin.jump).not.toHaveBeenCalled();
  input.remove();
  vi.advanceTimersByTime(1000); spin.tick(); spin.tick();
  expect(spin.jump).toHaveBeenCalled();
  spin.stop();
});

it('pauses hidden tabs/reduced motion, resumes a visible browser after blur, and cleans up every listener',()=>{
  const spin = setup(); spin.begin();
  spin.motion.matches = true; spin.motion.dispatchEvent(new Event('change'));
  expect(spin.frames.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  spin.motion.matches = false; spin.motion.dispatchEvent(new Event('change')); spin.begin();
  expect(spin.frames.size).toBe(1);
  spin.setHidden(true); document.dispatchEvent(new Event('visibilitychange'));
  expect(spin.frames.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  spin.setHidden(false); document.dispatchEvent(new Event('visibilitychange')); spin.begin();
  window.dispatchEvent(new Event('blur'));
  expect(spin.frames.size).toBe(0); expect(vi.getTimerCount()).toBe(1);
  const callsBeforeBlurResume = spin.jump.mock.calls.length;
  spin.begin();
  expect(spin.jump.mock.calls.length).toBeGreaterThan(callsBeforeBlurResume);
  window.dispatchEvent(new Event('focus')); spin.begin();
  spin.stop();
  expect(spin.frames.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  const calls = spin.publish.mock.calls.length;
  for (const event of ['pointerdown','pointerup','wheel','keydown','visibilitychange']) document.dispatchEvent(new Event(event));
  spin.motion.dispatchEvent(new Event('change')); window.dispatchEvent(new Event('focus'));
  expect(vi.getTimerCount()).toBe(0); expect(spin.publish).toHaveBeenCalledTimes(calls);
});

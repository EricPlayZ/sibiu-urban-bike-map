import { describe, expect, it, vi } from "vitest";
import { enableChasingWheelZoom } from "./chasingWheelZoom";

function mockMap() {
  let enabled = true;
  let zoom = 12;
  const h = {
    isEnabled: () => enabled,
    enable: () => {
      enabled = true;
    },
    disable: () => {
      enabled = false;
    },
    isActive: () => false,
    isZooming: () => false,
    wheel: vi.fn(),
    renderFrame: vi.fn(),
    reset: vi.fn(),
    _triggerRenderFrame: vi.fn(),
    _active: false,
    _zooming: false,
  };
  const map = {
    scrollZoom: h,
    getZoom: () => zoom,
    setZoom: (z: number) => {
      zoom = z;
    },
    getMinZoom: () => 0,
    getMaxZoom: () => 20,
    getContainer: () => ({ clientHeight: 800 }),
    on: vi.fn(),
    off: vi.fn(),
  };
  return { map, h };
}

function wheelEvent(deltaY = -80): WheelEvent {
  return {
    preventDefault: vi.fn(),
    deltaMode: 0,
    deltaY,
    shiftKey: false,
    ctrlKey: false,
  } as unknown as WheelEvent;
}

describe("enableChasingWheelZoom", () => {
  it("stays active during the chase, then abort clears isActive immediately", () => {
    const { map, h } = mockMap();
    const resetSpy = h.reset;
    const chase = enableChasingWheelZoom(map as never);

    h.wheel(wheelEvent(), { x: 40, y: 80 });
    expect(chase.isRunning()).toBe(true);
    expect(h.isActive()).toBe(true);
    expect(h.isZooming()).toBe(true);

    const frame = h.renderFrame({ timeStamp: 16 });
    expect(frame?.needsRenderFrame).toBe(true);

    chase.abort();
    expect(chase.isRunning()).toBe(false);
    expect(h.isActive()).toBe(false);
    expect(h.isZooming()).toBe(false);
    expect(resetSpy).toHaveBeenCalled();
    expect(h.renderFrame({ timeStamp: 32 })).toBeUndefined();

    chase.stop();
  });

  it("ignores wheel after scrollZoom is disabled", () => {
    const { map, h } = mockMap();
    const chase = enableChasingWheelZoom(map as never);
    map.scrollZoom.disable();
    h.wheel(wheelEvent(), { x: 10, y: 10 });
    expect(chase.isRunning()).toBe(false);
    chase.stop();
  });
});

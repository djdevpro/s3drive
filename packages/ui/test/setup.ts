// Préparation des tests jsdom : nettoyage du DOM et API du navigateur dont Radix a besoin.
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const g = globalThis as Record<string, unknown>;
if (!g['ResizeObserver']) g['ResizeObserver'] = ResizeObserverStub;
if (typeof window !== 'undefined') {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto['hasPointerCapture'] ??= () => false;
  proto['setPointerCapture'] ??= () => {};
  proto['releasePointerCapture'] ??= () => {};
  proto['scrollIntoView'] ??= () => {};
  if (!g['PointerEvent']) g['PointerEvent'] = window.MouseEvent;
  g['IS_REACT_ACT_ENVIRONMENT'] = true;
}

/** The complete interface needs these host capabilities, never a browser global in a mini game. */
export interface ResizeHandle { observe(element: Element): void; disconnect(): void; }
export interface UiEnvironment {
  manualScene?: boolean;
  window: Pick<Window, 'devicePixelRatio' | 'addEventListener'>;
  history: Pick<History, 'pushState' | 'replaceState'>;
  location: Pick<Location, 'href' | 'reload'>;
  query(name: string): string | null;
  observeResize(callback: () => void): ResizeHandle;
}

export function browserEnvironment(): UiEnvironment {
  return { window, history, location, query: (name) => new URLSearchParams(location.search).get(name),
    observeResize: (callback) => new ResizeObserver(callback) };
}

export function isUiElement(value: unknown): value is HTMLElement {
  return value !== null && typeof value === 'object' && typeof (value as Element).closest === 'function';
}
export function isInputElement(value: unknown): value is HTMLInputElement {
  return isUiElement(value) && value.tagName === 'INPUT';
}

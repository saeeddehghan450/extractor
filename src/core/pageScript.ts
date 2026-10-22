/**
 * pageScript.ts
 *
 * Script injected into every frame before any page script runs.
 *  - records the context type of each <canvas> (used by the WebGL collector)
 *  - reports clicks (with a unique CSS selector and XPath) to the extractor
 *
 * This function is serialized by Playwright, so it must not reference anything outside itself.
 */

export function extractorPageScript() {
  const w = window as any;
  if (w.__extractorInstalled) return;
  Object.defineProperty(w, '__extractorInstalled', { value: true, enumerable: false });

  // --- canvas context tracking -------------------------------------------
  const canvasTypes = new WeakMap<HTMLCanvasElement, string>();
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: any[]) {
    const ctx = (originalGetContext as any).call(this, type, ...rest);
    if (ctx && !canvasTypes.has(this)) canvasTypes.set(this, type);
    return ctx;
  } as any;
  Object.defineProperty(w, '__extractorCanvasType', {
    value: (c: HTMLCanvasElement) => canvasTypes.get(c) || null,
    enumerable: false
  });

  // --- click tracking -----------------------------------------------------
  const esc = (s: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/([^a-zA-Z0-9_-])/g, '\\$1'));

  const uniqueSelector = (el: Element): string => {
    if (el.id && document.querySelectorAll('#' + esc(el.id)).length === 1) return '#' + esc(el.id);
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      if (node.id && document.querySelectorAll('#' + esc(node.id)).length === 1) {
        parts.unshift('#' + esc(node.id));
        break;
      }
      const tag = node.tagName.toLowerCase();
      const parent: Element | null = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter(c => c.tagName === node!.tagName);
        parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(node) + 1})` : tag);
      } else {
        parts.unshift(tag);
      }
      node = parent;
    }
    if (!parts.length || !parts[0].startsWith('#')) parts.unshift('html');
    return parts.join(' > ');
  };

  const xpathOf = (el: Element): string => {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node.nodeType === 1) {
      const parent: Element | null = node.parentElement;
      const tag = node.tagName.toLowerCase();
      if (parent) {
        const same = Array.from(parent.children).filter(c => c.tagName === node!.tagName);
        parts.unshift(same.length > 1 ? `${tag}[${same.indexOf(node) + 1}]` : tag);
      } else {
        parts.unshift(tag);
      }
      node = parent;
    }
    return '/' + parts.join('/');
  };

  document.addEventListener('click', ev => {
    try {
      const target = ev.target as Element | null;
      const el = target && target.nodeType === 1 ? target : (target as any)?.parentElement;
      if (!el) return;
      const attributes: Record<string, string> = {};
      for (let i = 0; i < el.attributes.length; i++) attributes[el.attributes[i].name] = el.attributes[i].value.slice(0, 2000);
      const rect = el.getBoundingClientRect();
      const data = {
        clickedAt: new Date().toISOString(),
        frameUrl: location.href,
        tagName: el.tagName,
        id: el.id || null,
        className: typeof el.className === 'string' ? el.className || null : el.getAttribute('class'),
        innerText: ((el as HTMLElement).innerText || el.textContent || '').slice(0, 1000),
        attributes,
        cssSelector: uniqueSelector(el),
        xpath: xpathOf(el),
        boundingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        pointer: { x: (ev as MouseEvent).clientX, y: (ev as MouseEvent).clientY, button: (ev as MouseEvent).button }
      };
      if (typeof w.__extractorClick === 'function') w.__extractorClick(data);
    } catch {
      // never break the page
    }
  }, true);
}

/**
 * pickerScript.ts
 *
 * Installs window.__extractorPicker in the page: element inspection under the cursor, stable CSS
 * selectors, detection of repeating lists (products, rows, cards) and data extraction.
 *
 * Serialized by Playwright and evaluated in the page: it must not reference anything outside itself.
 */

export interface PickedBox { x: number; y: number; width: number; height: number }

export interface ListCandidate {
  /** selector matching every item of the list */
  itemSelector: string;
  count: number;
  /** selector of the picked element inside one item ("" = the item itself) */
  fieldSelector: string;
}

export interface PickInfo {
  tag: string;
  selector: string;
  box: PickedBox;
  text: string;
  href: string | null;
  src: string | null;
  attributes: Record<string, string>;
  suggestedName: string;
  suggestedExtract: 'text' | 'href' | 'src';
  /** set when the element is inside the active list (itemSelector given) */
  inItem: { fieldSelector: string; matches: number } | null;
  /** possible repeating lists around the element, nearest first */
  listCandidates: ListCandidate[];
}

export type ExtractKind = 'text' | 'href' | 'src' | 'html' | 'attr' | 'value';

export interface ScrapeField {
  name: string;
  /** relative to the item when the recipe has an itemSelector; "" = the item itself */
  selector: string;
  extract: ExtractKind;
  attribute?: string;
}

export interface ScrapeSpec {
  itemSelector?: string;
  fields: ScrapeField[];
  limit?: number;
}

export function installPicker() {
  const w = window as any;
  if (w.__extractorPicker) return;

  const esc = (s: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/([^a-zA-Z0-9_-])/g, '\\$1'));

  /** Class names that look generated (css-in-js hashes, utility soup) make poor selectors. */
  const stableClasses = (el: Element): string[] =>
    Array.from(el.classList)
      .filter(c => c.length <= 30 && !/\d{3,}/.test(c) && !/^(css|sc|jsx|emotion|styled)-/.test(c) && !/[:[\]/]/.test(c) && !/^(active|selected|hover|focus|open|is-|has-)/.test(c))
      .slice(0, 2);

  const signature = (el: Element): string => {
    const cls = stableClasses(el);
    return el.tagName.toLowerCase() + cls.map(c => '.' + esc(c)).join('');
  };

  const isUnique = (sel: string, el: Element, root: ParentNode = document): boolean => {
    try {
      const found = root.querySelectorAll(sel);
      return found.length === 1 && found[0] === el;
    } catch { return false; }
  };

  /** Unique selector of an element in the document. */
  const uniqueSelector = (el: Element): string => {
    if (el.id && !/\d{4,}/.test(el.id) && isUnique('#' + esc(el.id), el)) return '#' + esc(el.id);
    for (const attr of ['data-testid', 'data-test', 'data-qa', 'name', 'aria-label']) {
      const v = el.getAttribute(attr);
      if (v && v.length < 60) {
        const sel = `${el.tagName.toLowerCase()}[${attr}="${v.replace(/"/g, '\\"')}"]`;
        if (isUnique(sel, el)) return sel;
      }
    }
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node !== document.documentElement) {
      if (node.id && !/\d{4,}/.test(node.id) && isUnique('#' + esc(node.id), node)) {
        parts.unshift('#' + esc(node.id));
        break;
      }
      let part = signature(node);
      const parent: Element | null = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter(c => c.matches(part));
        if (same.length > 1) part += `:nth-of-type(${Array.from(parent.children).filter(c => c.tagName === node!.tagName).indexOf(node) + 1})`;
      }
      parts.unshift(part);
      const candidate = parts.join(' > ');
      if (isUnique(candidate, el)) return candidate;
      node = parent;
    }
    return parts.join(' > ');
  };

  /** Selector of `el` relative to `item` ("" when el is the item). */
  const relativeSelector = (item: Element, el: Element): string => {
    if (item === el) return '';
    // shortest descendant selector that finds el first inside the item
    const sig = signature(el);
    if (item.querySelector(sig) === el) return sig;
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node !== item) {
      let part = signature(node);
      const parent: Element | null = node.parentElement;
      if (parent && Array.from(parent.children).filter(c => c.matches(part)).length > 1) {
        part = `${node.tagName.toLowerCase()}:nth-of-type(${Array.from(parent.children).filter(c => c.tagName === node!.tagName).indexOf(node) + 1})`;
      }
      parts.unshift(part);
      const sel = parts.join(' > ');
      if (item.querySelector(sel) === el) return sel;
      node = parent;
    }
    return ':scope > ' + parts.join(' > ');
  };

  /** Repeating structures around the element: nearest first, at most 4. */
  const listCandidates = (el: Element): ListCandidate[] => {
    const out: ListCandidate[] = [];
    let node: Element | null = el;
    let depth = 0;
    while (node && node.parentElement && node !== document.body && depth < 10 && out.length < 4) {
      const parent: Element = node.parentElement;
      const sig = signature(node);
      const siblings = Array.from(parent.children).filter(c => signature(c) === sig);
      if (siblings.length >= 2) {
        const itemSelector = `${uniqueSelector(parent)} > ${sig}`;
        let count = 0;
        try { count = document.querySelectorAll(itemSelector).length; } catch { count = 0; }
        if (count >= 2 && !out.some(c => c.itemSelector === itemSelector)) {
          out.push({ itemSelector, count, fieldSelector: relativeSelector(node, el) });
        }
      }
      node = parent;
      depth++;
    }
    return out;
  };

  const boxOf = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  };

  const cleanText = (el: Element) => ((el as HTMLElement).innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();

  const hrefOf = (el: Element): string | null =>
    (el as HTMLAnchorElement).href || el.closest('a')?.href || (el.querySelector('a') as HTMLAnchorElement | null)?.href || null;

  const srcOf = (el: Element): string | null => {
    const img = el.tagName === 'IMG' ? el as HTMLImageElement : el.querySelector('img');
    if (img) return img.currentSrc || img.src || null;
    const media = el.tagName === 'VIDEO' || el.tagName === 'SOURCE' || el.tagName === 'IFRAME' ? (el as HTMLMediaElement).src : null;
    if (media) return media;
    const bg = getComputedStyle(el).backgroundImage.match(/url\(["']?(.*?)["']?\)/);
    return bg ? bg[1] : null;
  };

  /** Element under a viewport point, ignoring zero-size wrappers. */
  const elementAt = (x: number, y: number): Element | null => {
    let el = document.elementFromPoint(x, y);
    // descend into open shadow roots
    while (el && (el as HTMLElement).shadowRoot) {
      const inner: Element | null = (el as HTMLElement).shadowRoot!.elementFromPoint(x, y);
      if (!inner || inner === el) break;
      el = inner;
    }
    return el && el !== document.documentElement ? el : null;
  };

  const suggestName = (el: Element, text: string): string => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'img') return 'image';
    // a meaningful class ("title", "price") names the field better than the tag
    const cls = stableClasses(el)[0];
    if (cls) return cls.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase().slice(0, 30) || tag;
    if (tag === 'a') return 'link';
    if (/^h[1-6]$/.test(tag)) return 'title';
    if (/^[\d\s.,$€£¥₽﷼%+-]+$/.test(text) && text) return 'number';
    return tag;
  };

  const valueOf = (el: Element | null, f: ScrapeField): string | null => {
    if (!el) return null;
    switch (f.extract) {
      case 'href': return hrefOf(el);
      case 'src': return srcOf(el);
      case 'html': return el.outerHTML.slice(0, 20000);
      case 'attr': return f.attribute ? el.getAttribute(f.attribute) : null;
      case 'value': return (el as HTMLInputElement).value ?? null;
      default: return cleanText(el);
    }
  };

  const findField = (root: ParentNode, sel: string): Element | null => {
    try { return root.querySelector(sel); } catch { return null; }
  };

  const api = {
    hover(x: number, y: number) {
      const el = elementAt(x, y);
      if (!el) return null;
      const cls = stableClasses(el);
      return { box: boxOf(el), label: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls.map(c => '.' + c).join('') };
    },

    pick(x: number, y: number, itemSelector?: string): PickInfo | null {
      const el = elementAt(x, y);
      if (!el) return null;
      const text = cleanText(el).slice(0, 300);
      const href = hrefOf(el);
      const src = srcOf(el);
      const attributes: Record<string, string> = {};
      for (const a of Array.from(el.attributes).slice(0, 20)) attributes[a.name] = a.value.slice(0, 300);

      let inItem: PickInfo['inItem'] = null;
      if (itemSelector) {
        let item: Element | null = null;
        try { item = el.closest(itemSelector); } catch { item = null; }
        if (item) {
          const fieldSelector = relativeSelector(item, el);
          let matches = 0;
          document.querySelectorAll(itemSelector).forEach(it => {
            if (!fieldSelector ? true : findField(it, fieldSelector)) matches++;
          });
          inItem = { fieldSelector, matches };
        }
      }
      const tag = el.tagName.toLowerCase();
      return {
        tag,
        selector: uniqueSelector(el),
        box: boxOf(el),
        text,
        href,
        src,
        attributes,
        suggestedName: suggestName(el, text),
        suggestedExtract: tag === 'img' ? 'src' : tag === 'a' && !text ? 'href' : 'text',
        inItem,
        listCandidates: listCandidates(el)
      };
    },

    /** Viewport boxes of the elements a selector matches (visible ones only, at most `limit`). */
    boxes(selector: string, itemSelector?: string, limit = 300) {
      const out: PickedBox[] = [];
      const push = (el: Element | null) => {
        if (!el || out.length >= limit) return;
        const b = boxOf(el);
        if (b.width > 0 && b.height > 0 && b.y + b.height > 0 && b.y < innerHeight && b.x + b.width > 0 && b.x < innerWidth) out.push(b);
      };
      try {
        if (itemSelector) {
          document.querySelectorAll(itemSelector).forEach(it => push(selector ? findField(it, selector) : it));
        } else {
          document.querySelectorAll(selector).forEach(push);
        }
      } catch { /* invalid selector */ }
      return out;
    },

    count(selector: string, itemSelector?: string): number {
      try {
        if (itemSelector) {
          let n = 0;
          document.querySelectorAll(itemSelector).forEach(it => { if (!selector || findField(it, selector)) n++; });
          return n;
        }
        return document.querySelectorAll(selector).length;
      } catch { return -1; }
    },

    extract(spec: ScrapeSpec): Record<string, string | null>[] {
      const limit = spec.limit ?? 10000;
      if (spec.itemSelector) {
        let items: Element[] = [];
        try { items = Array.from(document.querySelectorAll(spec.itemSelector)); } catch { items = []; }
        return items.slice(0, limit).map(item => {
          const row: Record<string, string | null> = {};
          for (const f of spec.fields) row[f.name] = valueOf(f.selector ? findField(item, f.selector) : item, f);
          return row;
        });
      }
      const row: Record<string, string | null> = {};
      for (const f of spec.fields) row[f.name] = valueOf(findField(document, f.selector), f);
      return [row];
    }
  };

  Object.defineProperty(w, '__extractorPicker', { value: api, enumerable: false });
}

// Lazy, collapsible JSON tree viewer (handles very large documents)
import { esc } from './util.js';
import { t } from './i18n.js';

const PAGE = 200;

type Json = unknown;
type JsonContainer = Record<string, unknown> | unknown[];

/** A tree row that can be expanded / collapsed programmatically. */
interface TreeRow extends HTMLDivElement {
  toggleOpen?: (force?: boolean) => void;
}

function isContainer(v: Json): v is JsonContainer {
  return v !== null && typeof v === 'object';
}

function primitive(v: Json): string {
  if (v === null) return '<span class="null">null</span>';
  switch (typeof v) {
    case 'string': {
      const s = v.length > 3000 ? v.slice(0, 3000) + '…' : v;
      return `<span class="str">"${esc(s)}"</span>`;
    }
    case 'number': return `<span class="num">${v}</span>`;
    case 'boolean': return `<span class="bool">${v}</span>`;
    default: return `<span class="null">${esc(String(v))}</span>`;
  }
}

function summary(v: JsonContainer): string {
  if (Array.isArray(v)) return `[…] <span class="meta">${esc(t('common.items', { n: v.length }))}</span>`;
  return `{…} <span class="meta">${esc(t('common.keys', { n: Object.keys(v).length }))}</span>`;
}

function renderChildren(container: HTMLElement, value: JsonContainer, start = 0): void {
  const entries: [string | number, Json][] = Array.isArray(value) ? value.map((v, i) => [i, v]) : Object.entries(value);
  const slice = entries.slice(start, start + PAGE);
  const frag = document.createDocumentFragment();
  for (const [k, v] of slice) frag.appendChild(renderEntry(k, v, Array.isArray(value)));
  container.appendChild(frag);
  if (entries.length > start + PAGE) {
    const more = document.createElement('div');
    more.className = 'more';
    more.textContent = t('common.showMore', { n: entries.length - start - PAGE });
    more.onclick = () => { more.remove(); renderChildren(container, value, start + PAGE); };
    container.appendChild(more);
  }
}

function renderEntry(key: string | number | null, value: Json, isIndex: boolean, open = false): TreeRow {
  const row: TreeRow = document.createElement('div');
  const label = key === null ? '' : isIndex ? `<span class="meta">${key}</span>: ` : `<span class="key">"${esc(key)}"</span>: `;
  if (isContainer(value)) {
    const empty = Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0;
    if (empty) {
      row.innerHTML = `${label}<span class="meta">${Array.isArray(value) ? '[]' : '{}'}</span>`;
      return row;
    }
    const head = document.createElement('span');
    head.className = 'toggle';
    head.innerHTML = `${label}${summary(value)}`;
    const kids = document.createElement('div');
    kids.className = 'node';
    kids.hidden = true;
    let rendered = false;
    const toggle = (force?: boolean) => {
      const show = force ?? kids.hidden === true;
      if (show && !rendered) { renderChildren(kids, value); rendered = true; }
      kids.hidden = !show;
      row.classList.toggle('open', show);
    };
    head.onclick = () => toggle();
    row.toggleOpen = toggle;
    row.appendChild(head);
    row.appendChild(kids);
    if (open) toggle(true);
  } else {
    row.innerHTML = `${label}${primitive(value)}`;
  }
  return row;
}

function childRows(el: Element): TreeRow[] {
  return Array.from(el.querySelectorAll<TreeRow>(':scope > .node > div'));
}

/** Render `data` into `container`; the first `depth` levels are expanded. */
export function renderJson(container: HTMLElement, data: Json, depth = 1): void {
  container.innerHTML = '';
  container.classList.add('json');
  const root = renderEntry(null, data, false, true);
  container.appendChild(root);
  const expand = (el: Element, level: number) => {
    if (level >= depth) return;
    childRows(el).forEach(child => {
      if (child.toggleOpen) { child.toggleOpen(true); expand(child, level + 1); }
    });
  };
  expand(root, 1);
}

export function expandAll(container: HTMLElement, maxNodes = 3000): void {
  let count = 0;
  const walk = (el: Element) => {
    childRows(el).forEach(child => {
      if (count > maxNodes) return;
      if (child.toggleOpen) { child.toggleOpen(true); count++; walk(child); }
    });
  };
  const root = container.firstElementChild;
  if (root) walk(root);
}

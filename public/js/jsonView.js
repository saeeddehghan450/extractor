// Lazy, collapsible JSON tree viewer (handles very large documents)
import { esc } from './util.js';
import { t } from './i18n.js';

const PAGE = 200;

function primitive(v) {
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

function summary(v) {
  if (Array.isArray(v)) return `[…] <span class="meta">${esc(t('common.items', { n: v.length }))}</span>`;
  return `{…} <span class="meta">${esc(t('common.keys', { n: Object.keys(v).length }))}</span>`;
}

function renderChildren(container, value, start = 0) {
  const entries = Array.isArray(value) ? value.map((v, i) => [i, v]) : Object.entries(value);
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

function renderEntry(key, value, isIndex, open = false) {
  const row = document.createElement('div');
  const label = key === null ? '' : isIndex ? `<span class="meta">${key}</span>: ` : `<span class="key">"${esc(key)}"</span>: `;
  if (value !== null && typeof value === 'object') {
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
    const toggle = force => {
      const show = force ?? kids.hidden;
      if (show && !rendered) { renderChildren(kids, value); rendered = true; }
      kids.hidden = !show;
      row.classList.toggle('open', show);
    };
    head.onclick = () => toggle();
    row._toggle = toggle;
    row.appendChild(head);
    row.appendChild(kids);
    if (open) toggle(true);
  } else {
    row.innerHTML = `${label}${primitive(value)}`;
  }
  return row;
}

/** Render `data` into `container`; the first `depth` levels are expanded. */
export function renderJson(container, data, depth = 1) {
  container.innerHTML = '';
  container.classList.add('json');
  const root = renderEntry(null, data, false, true);
  container.appendChild(root);
  const expand = (el, level) => {
    if (level >= depth) return;
    el.querySelectorAll(':scope > .node > div').forEach(child => {
      if (child._toggle) { child._toggle(true); expand(child, level + 1); }
    });
  };
  expand(root, 1);
}

export function expandAll(container, maxNodes = 3000) {
  let count = 0;
  const walk = el => {
    el.querySelectorAll(':scope > .node > div').forEach(child => {
      if (count > maxNodes) return;
      if (child._toggle) { child._toggle(true); count++; walk(child); }
    });
  };
  const root = container.firstElementChild;
  if (root) walk(root);
}

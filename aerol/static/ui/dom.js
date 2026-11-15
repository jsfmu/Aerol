// Tiny DOM helpers shared by the views.
import { esc } from '../core/util.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export { esc };

export function toast(message, ms = 3800) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, ms);
}

export function openDialog(title, html) {
  const d = $('#dialog');
  $('#dialog-body').innerHTML = `<div class="row" style="justify-content:space-between;margin-bottom:10px"><h2 id="dialog-title" style="font-size:17px">${esc(title)}</h2><button class="btn small" data-close-dialog>Close</button></div>${html}`;
  if (!d.open) d.showModal();
  d.querySelector('[data-close-dialog]').onclick = () => d.close();
}

export function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function throttle(fn, ms) {
  let last = 0;
  let timer = null;
  return (...args) => {
    const now = performance.now();
    const wait = ms - (now - last);
    if (wait <= 0) { last = now; fn(...args); }
    else if (!timer) timer = setTimeout(() => { timer = null; last = performance.now(); fn(...args); }, wait);
  };
}

export function debounce(fn, ms) {
  let timer = null;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

import { esc } from './dom.js';

let closeCurrent = null;

/** Close an open dialog (as if cancelled), e.g. when the screen behind it goes away. */
export function closeModal() {
  if (closeCurrent) closeCurrent(null);
}

/**
 * Dialog with big buttons. Resolves to the chosen value, or null when dismissed
 * (Escape, tap outside, or closeModal()).
 * @param {{title:string, text?:string, choices:{value:any, label:string, kind?:'primary'|'danger'}[]}} o
 */
export function choiceDialog({ title, text = '', choices }) {
  const root = document.getElementById('modal-root');
  closeModal();
  return new Promise((resolve) => {
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <h2 id="modal-title">${esc(title)}</h2>
          ${text ? `<p>${esc(text)}</p>` : ''}
          <div class="modal-actions${choices.length > 2 ? ' modal-actions-col' : ''}">
            ${choices
              .map(
                (c, i) =>
                  `<button class="btn btn-xl${c.kind === 'primary' ? ' btn-primary' : c.kind === 'danger' ? ' btn-danger' : ''}" data-i="${i}">${esc(c.label)}</button>`,
              )
              .join('')}
          </div>
        </div>
      </div>`;
    const onKey = (e) => {
      if (e.key === 'Escape') close(null);
    };
    const close = (v) => {
      document.removeEventListener('keydown', onKey);
      closeCurrent = null;
      root.innerHTML = '';
      resolve(v);
    };
    closeCurrent = close;
    document.addEventListener('keydown', onKey);
    root.querySelector('.modal-backdrop').addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (b) close(choices[Number(b.dataset.i)].value);
      else if (e.target.classList.contains('modal-backdrop')) close(null);
    });
    const safe = choices.findIndex((c) => c.kind !== 'danger' && c.kind !== 'primary');
    const focus = root.querySelector(`[data-i="${safe >= 0 ? safe : 0}"]`);
    if (focus) focus.focus();
  });
}

/** Two-button confirm. Resolves to true/false. */
export async function confirmDialog({ title, text = '', yes, no, danger = false }) {
  const v = await choiceDialog({
    title,
    text,
    choices: [
      { value: false, label: no },
      { value: true, label: yes, kind: danger ? 'danger' : 'primary' },
    ],
  });
  return v === true;
}

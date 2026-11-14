import { esc } from './dom.js';

let closeCurrent = null;

/** Close an open dialog (as if cancelled), e.g. when the screen behind it goes away. */
export function closeModal() {
  if (closeCurrent) closeCurrent(false);
}

/** Big-button confirm dialog. Resolves to true/false. */
export function confirmDialog({ title, text = '', yes, no, danger = false }) {
  const root = document.getElementById('modal-root');
  closeModal();
  return new Promise((resolve) => {
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <h2 id="modal-title">${esc(title)}</h2>
          ${text ? `<p>${esc(text)}</p>` : ''}
          <div class="modal-actions">
            <button class="btn btn-xl" data-r="0">${esc(no)}</button>
            <button class="btn btn-xl ${danger ? 'btn-danger' : 'btn-primary'}" data-r="1">${esc(yes)}</button>
          </div>
        </div>
      </div>`;
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
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
      const b = e.target.closest('[data-r]');
      if (b) close(b.dataset.r === '1');
      else if (e.target.classList.contains('modal-backdrop')) close(false);
    });
    root.querySelector('[data-r="0"]').focus();
  });
}

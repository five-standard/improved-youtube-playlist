const MENU_ID = 'miller-context-menu';

/**
 * Show a context menu at the given position.
 *
 * @param {Array<{label:string, icon?:string, action:function, danger?:boolean}|'separator'>} items
 * @param {{ x: number, y: number }} position
 */
export function showContextMenu(items, { x, y }) {
  closeContextMenu();

  const menu = document.createElement('div');
  menu.id = MENU_ID;
  menu.className = 'miller-context-menu';

  items.forEach(item => {
    if (item === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'miller-cm-sep';
      menu.appendChild(sep);
      return;
    }

    const btn = document.createElement('button');
    btn.className = 'miller-cm-item' + (item.danger ? ' danger' : '');
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" style="flex-shrink:0;opacity:0.75">${item.icon ?? ''}</svg>
      <span>${item.label}</span>
    `;

    btn.addEventListener('mousedown', (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeContextMenu();
      item.action();
    });

    menu.appendChild(btn);
  });

  // Append off-screen first to measure size
  menu.style.visibility = 'hidden';
  document.body.appendChild(menu);

  const { width, height } = menu.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const left = (x + width  > vw) ? Math.max(4, vw - width  - 4) : x;
  const top  = (y + height > vh) ? Math.max(4, vh - height - 4) : y;

  menu.style.left = left + 'px';
  menu.style.top  = top  + 'px';
  menu.style.visibility = '';

  // Close on outside interaction
  const onClose = () => closeContextMenu();
  setTimeout(() => {
    document.addEventListener('click',       onClose, { once: true });
    document.addEventListener('contextmenu', onClose, { once: true });
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') { closeContextMenu(); document.removeEventListener('keydown', onKey); }
    });
  }, 0);
}

export function closeContextMenu() {
  document.getElementById(MENU_ID)?.remove();
}

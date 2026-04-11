import { esc } from '../utils/format.js';
import { attachThumbFallback } from '../utils/thumbnail.js';

export function renderPlaylistPanel(wrap, session, { isOpen, onNavigate }) {
  document.getElementById('yt-playlist-panel')?.remove();
  if (!isOpen) return;

  const { videos, currentIndex } = session;
  const thumbOf = (v) => v.thumbnail || `https://img.youtube.com/vi/${v.videoId}/mqdefault.jpg`;

  const panel = document.createElement('div');
  panel.id = 'yt-playlist-panel';
  panel.innerHTML = videos.map((v, i) => `
    <button class="yt-pp-item${i === currentIndex ? ' current' : ''}" data-idx="${i}">
      <span class="yt-pp-idx">${i + 1}</span>
      <img class="yt-pp-thumb" src="${esc(thumbOf(v))}" alt="" loading="lazy">
      <div class="yt-pp-info">
        <span class="yt-pp-title">${esc(v.title || v.videoId)}</span>
        ${v.channelName ? `<span class="yt-pp-channel">${esc(v.channelName)}</span>` : ''}
      </div>
    </button>
  `).join('');

  panel.querySelectorAll('.yt-pp-thumb').forEach((img, i) => {
    attachThumbFallback(img, videos[i].videoId);
  });

  panel.querySelectorAll('.yt-pp-item').forEach((item) => {
    item.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopImmediatePropagation(); });
    item.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      onNavigate(parseInt(item.dataset.idx));
    });
  });

  const PANEL_W     = 380;
  const PANEL_MAX_H = 280;
  const ARROW_H     = 10;
  const GAP         = 6;
  const listBtn = wrap.querySelector('#yt-pb-list');
  if (listBtn) {
    const btn         = listBtn.getBoundingClientRect();
    const rawLeft     = btn.left + btn.width / 2 - PANEL_W / 2;
    const clampedLeft = Math.max(8, Math.min(window.innerWidth - PANEL_W - 8, rawLeft));
    const showBelow   = btn.top - ARROW_H - GAP < PANEL_MAX_H;

    panel.style.position = 'fixed';
    panel.style.left     = clampedLeft + 'px';
    panel.style.setProperty('--arrow-left', (btn.left + btn.width / 2 - clampedLeft) + 'px');

    if (showBelow) {
      panel.classList.add('yt-panel-below');
      panel.style.top    = (btn.bottom + ARROW_H + GAP) + 'px';
      panel.style.bottom = 'auto';
    } else {
      panel.style.bottom = (window.innerHeight - btn.top + ARROW_H + GAP) + 'px';
      panel.style.top    = 'auto';
    }
  }

  document.body.appendChild(panel);
  setTimeout(() => panel.querySelector('.yt-pp-item.current')?.scrollIntoView({ block: 'nearest' }), 0);
}

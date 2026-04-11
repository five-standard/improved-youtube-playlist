import { esc } from '../utils/format.js';
import { isContextValid } from '../utils/context.js';
import { renderPlaylistPanel } from './playlistPanel.js';

function getVolIcon(pct) {
  if (pct === 0) {
    return `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;
}

export function showPlaylistBar(session, {
  savedBarPos,
  playlistPanelOpen,
  navigate,
  startTimeUpdate,
  onStop,
  onRepeat,
  onResetPos,
  onDragStart,
  onPanelToggle,
  onPanelNavigate,
}) {
  const { groupName, videos, currentIndex, repeatMode = 0 } = session;
  const total = videos.length;
  const currentVideo = videos[currentIndex];

  let wrap = document.getElementById('yt-playlist-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'yt-playlist-wrap';
    document.body.appendChild(wrap);
  }

  if (savedBarPos) {
    wrap.style.bottom    = 'auto';
    wrap.style.transform = 'none';
    wrap.style.left      = savedBarPos.left + 'px';
    wrap.style.top       = savedBarPos.top  + 'px';
  } else {
    wrap.style.bottom    = '';
    wrap.style.transform = '';
    wrap.style.left      = '';
    wrap.style.top       = '';
  }

  let row = wrap.querySelector('.yt-pb-row');
  if (!row) {
    row = document.createElement('div');
    row.className = 'yt-pb-row';
    wrap.appendChild(row);
  }

  const prevDisabled    = currentIndex === 0 && repeatMode !== 1 ? ' disabled' : '';
  const nextDisabled    = currentIndex >= total - 1 && repeatMode !== 1 ? ' disabled' : '';
  const repeatActiveClass = repeatMode > 0 ? ' active' : '';
  const repeatTitle     = repeatMode === 0 ? '반복 없음' : repeatMode === 1 ? '플리 반복' : '한 곡 반복';
  const initVolPct      = Math.round((document.querySelector('video')?.volume ?? 1) * 100);
  const repeatIcon      = repeatMode === 2
    ? `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/><text x="12" y="14.5" text-anchor="middle" font-size="6" font-weight="bold" fill="currentColor" font-family="Arial,sans-serif">1</text></svg>`
    : `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>`;

  row.innerHTML = `
    <div class="yt-pb-group">
      <button class="yt-pb-btn yt-pb-stop" id="yt-pb-stop">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
          <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
      </button>
    </div>
    <div class="yt-pb-group">
      <button class="yt-pb-btn yt-pb-list${playlistPanelOpen ? ' active' : ''}" id="yt-pb-list">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
          <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/>
        </svg>
      </button>
      <span class="yt-pb-name">${esc(groupName)}</span>
      <span class="yt-pb-pos">${currentIndex + 1} / ${total}</span>
      <button class="yt-pb-btn yt-pb-repeat${repeatActiveClass}" id="yt-pb-repeat" title="${repeatTitle}">
        ${repeatIcon}
      </button>
    </div>
    <div class="yt-pb-group">
      <button class="yt-pb-btn" id="yt-pb-prev"${prevDisabled} title="이전 영상">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
          <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/>
        </svg>
      </button>
      <button class="yt-pb-btn" id="yt-pb-rewind" title="10초 되감기">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
          <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
          <text x="12" y="14.5" font-size="5.5" text-anchor="middle" font-family="Roboto,Arial,sans-serif" font-weight="700" fill="currentColor">10</text>
        </svg>
      </button>
      <button class="yt-pb-btn" id="yt-pb-playpause" title="재생/일시정지">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
          <path d="M8 5v14l11-7z"/>
        </svg>
      </button>
      <button class="yt-pb-btn" id="yt-pb-forward" title="10초 넘기기">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
          <path d="M18 13c0 3.31-2.69 6-6 6s-6-2.69-6-6 2.69-6 6-6v4l5-5-5-5v4c-4.42 0-8 3.58-8 8s3.58 8 8 8 8-3.58 8-8h-2z"/>
          <text x="12" y="14.5" font-size="5.5" text-anchor="middle" font-family="Roboto,Arial,sans-serif" font-weight="700" fill="currentColor">10</text>
        </svg>
      </button>
      <button class="yt-pb-btn" id="yt-pb-next"${nextDisabled} title="다음 영상">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
          <path d="M6 18 14.5 12 6 6v12zm8.5-6v6h2V6h-2v6z"/>
        </svg>
      </button>
    </div>
    <div class="yt-pb-group yt-pb-vol-bar" id="yt-pb-vol" title="볼륨">
      <span class="yt-pb-vol-icon" id="yt-pb-vol-icon">${getVolIcon(initVolPct)}</span>
      <span class="yt-pb-vol-pct" id="yt-pb-vol-pct">${initVolPct}%</span>
    </div>
    <div class="yt-pb-group yt-pb-info-group">
      ${currentVideo?.channelAvatar ? `<img class="yt-pb-ch-avatar" src="${esc(currentVideo.channelAvatar)}" alt="">` : ''}
      ${currentVideo?.channelName ? `<span class="yt-pb-ch-name">${esc(currentVideo.channelName)}</span><span class="yt-pb-sep">·</span>` : ''}
      <span class="yt-pb-video-title">${esc(currentVideo?.title || '')}</span>
      <span class="yt-pb-sep">·</span>
      <span class="yt-pb-time" id="yt-pb-time">0:00 / 0:00</span>
    </div>
    <div class="yt-pb-group yt-pb-util-group">
      <button class="yt-pb-btn yt-pb-reset-pos" id="yt-pb-reset-pos" title="위치 초기화">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
          <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
        </svg>
      </button>
      <button class="yt-pb-btn yt-pb-drag-handle" id="yt-pb-drag" title="드래그로 이동">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
          <circle cx="9" cy="5"  r="1.5"/><circle cx="15" cy="5"  r="1.5"/>
          <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
          <circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/>
        </svg>
      </button>
    </div>
  `;

  row.querySelector('#yt-pb-stop').addEventListener('click', () => onStop());

  row.querySelector('#yt-pb-list').addEventListener('click', () => {
    const newIsOpen = onPanelToggle();
    row.querySelector('#yt-pb-list').classList.toggle('active', newIsOpen);
    renderPlaylistPanel(wrap, session, { isOpen: newIsOpen, onNavigate: onPanelNavigate });
  });

  row.querySelector('#yt-pb-prev').addEventListener('click', () => navigate(-1));
  row.querySelector('#yt-pb-next').addEventListener('click', () => navigate(1));

  row.querySelector('#yt-pb-rewind').addEventListener('click', () => {
    const player = document.querySelector('#movie_player');
    const video  = document.querySelector('video');
    if (player && typeof player.seekTo === 'function') {
      player.seekTo(Math.max(0, (player.getCurrentTime?.() ?? 0) - 10), true);
    } else if (video) {
      video.currentTime = Math.max(0, video.currentTime - 10);
    }
  });

  row.querySelector('#yt-pb-forward').addEventListener('click', () => {
    const player = document.querySelector('#movie_player');
    const video  = document.querySelector('video');
    if (player && typeof player.seekTo === 'function') {
      player.seekTo((player.getCurrentTime?.() ?? 0) + 10, true);
    } else if (video) {
      video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10);
    }
  });

  row.querySelector('#yt-pb-playpause').addEventListener('click', () => {
    const player = document.querySelector('#movie_player');
    const video  = document.querySelector('video');
    if (player && typeof player.pauseVideo === 'function') {
      const state = player.getPlayerState?.() ?? -1;
      if (state === 1) player.pauseVideo();
      else player.playVideo();
    } else if (video) {
      if (video.paused) video.play().catch(() => {});
      else video.pause();
    }
  });

  row.querySelector('#yt-pb-repeat').addEventListener('click', async () => {
    if (!isContextValid()) return;
    try {
      const newSession = { ...session, repeatMode: (repeatMode + 1) % 3 };
      await chrome.storage.local.set({ playlistSession: newSession });
      onRepeat(newSession);
    } catch {}
  });

  row.querySelector('#yt-pb-reset-pos').addEventListener('click', () => {
    wrap.style.bottom    = '';
    wrap.style.transform = '';
    wrap.style.left      = '';
    wrap.style.top       = '';
    onResetPos();
  });

  row.querySelector('#yt-pb-drag').addEventListener('mousedown', (e) => {
    e.preventDefault();
    document.getElementById('yt-playlist-panel')?.remove();
    row.querySelector('#yt-pb-list')?.classList.remove('active');
    const rect = wrap.getBoundingClientRect();
    wrap.style.bottom    = 'auto';
    wrap.style.transform = 'none';
    wrap.style.left      = rect.left + 'px';
    wrap.style.top       = rect.top  + 'px';
    onDragStart({ startX: e.clientX, startY: e.clientY, wrapX: rect.left, wrapY: rect.top });
    document.getElementById('yt-pb-drag')?.classList.add('dragging');
  });

  const volBar = row.querySelector('#yt-pb-vol');
  volBar.style.setProperty('--volume', initVolPct);
  volBar.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const rect = volBar.getBoundingClientRect();
    const vol = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const video = document.querySelector('video');
    if (video) video.volume = vol;
    const pct = Math.round(vol * 100);
    volBar.style.setProperty('--volume', pct);
    volBar.querySelector('#yt-pb-vol-pct').textContent = pct + '%';
    volBar.querySelector('#yt-pb-vol-icon').innerHTML = getVolIcon(pct);
  });

  startTimeUpdate();
  renderPlaylistPanel(wrap, session, { isOpen: playlistPanelOpen, onNavigate: onPanelNavigate });
}

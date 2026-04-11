function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function getVolIcon(pct) {
  if (pct === 0) {
    return `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;
}

const THUMB_QUALITIES = ['maxresdefault', 'sddefault', 'hqdefault', 'mqdefault', 'default'];
const THUMB_PLACEHOLDER = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='90'><rect fill='%23333'/><text x='50%25' y='50%25' fill='%23666' font-size='12' text-anchor='middle' dy='.3em'>No Thumbnail</text></svg>`;

function attachThumbFallback(img, videoId) {
  img.onerror = function () {
    const failed = this.src;
    const currentQuality = THUMB_QUALITIES.find((q) => failed.includes(q));
    const currentIdx = currentQuality ? THUMB_QUALITIES.indexOf(currentQuality) : THUMB_QUALITIES.length - 1;
    const nextIdx = currentIdx + 1;
    if (nextIdx < THUMB_QUALITIES.length) {
      this.src = `https://img.youtube.com/vi/${videoId}/${THUMB_QUALITIES[nextIdx]}.jpg`;
    } else {
      this.onerror = null;
      this.src = THUMB_PLACEHOLDER;
    }
  };
}

function formatTime(seconds) {
  const s = Math.floor(seconds || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${pad(m)}:${pad(sec)}`
    : `${m}:${pad(sec)}`;
}


function isContextValid() {
  return !!chrome.runtime?.id;
}

 async function openSaveModal(btn, info, { createGroup, saveVideoToGroup, onSaved }) {
  document.getElementById('yt-save-modal')?.remove();

  let groups;
  try {
    ({ groups = [] } = await chrome.storage.local.get('groups'));
  } catch { return; }
  let currentGroups = [...groups];
  let selectedGroupId = null;

  const overlay = document.createElement('div');
  overlay.id = 'yt-save-modal';
  overlay.innerHTML = `
    <div class="yt-sm-dialog">
      <div class="yt-sm-header">
        <span>재생목록 선택</span>
        <button class="yt-sm-close-btn" aria-label="닫기">✕</button>
      </div>
      <div class="yt-sm-body">
        <div class="yt-sm-groups" id="yt-sm-group-list"></div>
        <button class="yt-sm-toggle-create-btn" id="yt-sm-toggle-create">재생목록 생성</button>
        <div class="yt-sm-create-form yt-sm-hidden" id="yt-sm-create-form">
          <input class="yt-sm-input" id="yt-sm-new-input" placeholder="재생목록 이름...">
          <button class="yt-sm-create-confirm-btn" id="yt-sm-create-confirm">만들기</button>
        </div>
      </div>
      <div class="yt-sm-footer">
        <button class="yt-sm-save-btn" id="yt-sm-save-btn">저장</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  function renderGroups() {
    const list = overlay.querySelector('#yt-sm-group-list');
    const toggleBtn = overlay.querySelector('#yt-sm-toggle-create');

    if (currentGroups.length === 0) {
      list.innerHTML = `
        <p class="yt-sm-empty">
          저장된 재생목록이 없습니다.
          <button class="yt-sm-inline-link" id="yt-sm-inline-link">재생목록 만들기</button>
        </p>
      `;
      toggleBtn.style.display = 'none';
      list.querySelector('#yt-sm-inline-link').addEventListener('click', toggleCreate);
    } else {
      const selectableGroups = currentGroups.filter((g) => g.type !== 'separator');
      list.innerHTML = currentGroups.map((g) => g.type === 'separator'
        ? `<div class="yt-sm-separator">━━━━━━━━━━━━━━</div>`
        : `<button class="yt-sm-group-item${selectedGroupId === g.id ? ' selected' : ''}" data-group-id="${esc(g.id)}">
            <span class="yt-sm-check-icon">${selectedGroupId === g.id ? '✓' : ''}</span>
            <span class="yt-sm-group-name">${esc(g.name)}</span>
          </button>`
      ).join('');
      toggleBtn.style.display = selectableGroups.length > 0 ? '' : 'none';
      list.querySelectorAll('.yt-sm-group-item').forEach((item) => {
        item.addEventListener('click', () => {
          const gid = item.dataset.groupId;
          selectedGroupId = selectedGroupId === gid ? null : gid;
          list.querySelectorAll('.yt-sm-group-item').forEach((el) => {
            const selected = el.dataset.groupId === selectedGroupId;
            el.classList.toggle('selected', selected);
            el.querySelector('.yt-sm-check-icon').textContent = selected ? '✓' : '';
          });
        });
      });
    }
  }

  let createFormVisible = false;
  function toggleCreate() {
    createFormVisible = !createFormVisible;
    overlay.querySelector('#yt-sm-create-form').classList.toggle('yt-sm-hidden', !createFormVisible);
    if (createFormVisible) overlay.querySelector('#yt-sm-new-input').focus();
  }

  const close = () => overlay.remove();
  overlay.querySelector('.yt-sm-close-btn').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#yt-sm-toggle-create').addEventListener('click', toggleCreate);

  overlay.querySelector('#yt-sm-create-confirm').addEventListener('click', async () => {
    const input = overlay.querySelector('#yt-sm-new-input');
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    const groupId = await createGroup(name);
    const { groups: updated = [] } = await chrome.storage.local.get('groups');
    currentGroups = updated;
    selectedGroupId = groupId;
    input.value = '';
    createFormVisible = false;
    overlay.querySelector('#yt-sm-create-form').classList.add('yt-sm-hidden');
    renderGroups();
  });

  overlay.querySelector('#yt-sm-new-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') overlay.querySelector('#yt-sm-create-confirm').click();
  });

  overlay.querySelector('#yt-sm-save-btn').addEventListener('click', async () => {
    await saveVideoToGroup(info, selectedGroupId);
    close();
    onSaved(btn);
  });

  renderGroups();
}

 function renderPlaylistPanel(wrap, session, { isOpen, onNavigate }) {
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

  const PANEL_W    = 380;
  const PANEL_MAX_H = 280;
  const ARROW_H    = 10;
  const GAP        = 6;
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

 function showPlaylistBar(session, {
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
  const initVolPct      = Math.round(savedVolume * 100);
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
      <button class="yt-pb-btn yt-pb-hide-ui${nativeControlsHidden ? ' active' : ''}" id="yt-pb-hide-ui" title="${nativeControlsHidden ? 'YouTube UI 표시' : 'YouTube UI 숨기기'}">
        ${nativeControlsHidden
          ? `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78 3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>`
          : `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>`}
      </button>
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

  row.querySelector('#yt-pb-hide-ui').addEventListener('click', () => {
    nativeControlsHidden = !nativeControlsHidden;
    document.body.classList.toggle('yt-ext-pl-active', nativeControlsHidden);
    const btn = row.querySelector('#yt-pb-hide-ui');
    btn.classList.toggle('active', nativeControlsHidden);
    btn.title = nativeControlsHidden ? 'YouTube UI 표시' : 'YouTube UI 숨기기';
    btn.innerHTML = nativeControlsHidden
      ? `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78 3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>`
      : `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>`;
    updateFsOverlay();
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
    volDrag = true;
    const rect = volBar.getBoundingClientRect();
    applyVolume(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
  });

  startTimeUpdate();
  renderPlaylistPanel(wrap, session, { isOpen: playlistPanelOpen, onNavigate: onPanelNavigate });
}


window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.message?.includes('Extension context invalidated')) e.preventDefault();
});

const BTN_ID = 'yt-direct-save-btn';
let checkInterval = null;
let lastVideoId = null;

function getVideoId() {
  return new URLSearchParams(window.location.search).get('v');
}

function getVideoInfo() {
  const videoId = getVideoId();
  if (!videoId) return null;

  const titleEl =
    document.querySelector('ytd-watch-metadata h1 yt-formatted-string') ||
    document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
    document.querySelector('#title h1');

  const title =
    titleEl?.textContent?.trim() ||
    document.title.replace(' - YouTube', '').trim();

  const channelLink =
    document.querySelector('#owner ytd-channel-name a') ||
    document.querySelector('ytd-video-owner-renderer ytd-channel-name a') ||
    document.querySelector('ytd-channel-name a');

  const channelName = channelLink?.textContent?.trim() || null;
  const channelUrl  = channelLink?.href || null;

  const avatarEl =
    document.querySelector('#owner ytd-video-owner-renderer #avatar img') ||
    document.querySelector('#owner #avatar img');
  const channelAvatar = avatarEl?.src || null;

  let uploadDate = null;
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent);
      if (data.uploadDate) { uploadDate = data.uploadDate; break; }
    } catch {}
  }

  return {
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title,
    thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    channelName,
    channelUrl,
    channelAvatar,
    uploadDate,
  };
}

function findContainer() {
  return (
    document.querySelector('#top-level-buttons-computed') ||
    document.querySelector('ytd-menu-renderer #top-level-buttons-computed') ||
    document.querySelector('#actions ytd-menu-renderer') ||
    document.querySelector('ytd-watch-metadata #actions')
  );
}

const ICON_FILLED  = 'M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z';
const ICON_OUTLINE = 'M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2zm0 15l-5-2.18L7 18V5h10v13z';

async function updateButtonState(btn) {
  if (!isContextValid()) return;
  const videoId = getVideoId();
  if (!videoId) return;
  try {
    const { savedVideos = [] } = await chrome.storage.local.get('savedVideos');
    const isSaved = savedVideos.some((v) => v.videoId === videoId);
    btn.classList.toggle('saved', isSaved);
    btn.querySelector('.btn-text').textContent = isSaved ? '저장됨' : '저장';
    btn.querySelector('svg path').setAttribute('d', isSaved ? ICON_FILLED : ICON_OUTLINE);
  } catch {}
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

async function createGroup(name) {
  if (!isContextValid()) return null;
  try {
    const { groups = [] } = await chrome.storage.local.get('groups');
    const newGroup = { id: generateId(), name, createdAt: Date.now() };
    groups.push(newGroup);
    await chrome.storage.local.set({ groups });
    return newGroup.id;
  } catch { return null; }
}

async function saveVideoToGroup(info, groupId) {
  if (!isContextValid()) return;
  try {
    const { savedVideos = [] } = await chrome.storage.local.get('savedVideos');
    if (savedVideos.some((v) => v.videoId === info.videoId)) return;
    savedVideos.push({ ...info, tags: [], groupId: groupId || null, savedAt: Date.now() });
    await chrome.storage.local.set({ savedVideos });
  } catch {}
}

async function handleSave(btn) {
  if (!isContextValid()) return;
  const info = getVideoInfo();
  if (!info) return;
  try {
    const { savedVideos = [] } = await chrome.storage.local.get('savedVideos');
    if (savedVideos.some((v) => v.videoId === info.videoId)) {
      const updated = savedVideos.filter((v) => v.videoId !== info.videoId);
      await chrome.storage.local.set({ savedVideos: updated });
      await updateButtonState(btn);
      return;
    }
    openSaveModal(btn, info, { createGroup, saveVideoToGroup, onSaved: updateButtonState });
  } catch {}
}

let videoEndedHandler = null;
let playlistPanelOpen = false;
let timeUpdateInterval = null;
let pendingPlaylistSession = null;
let savedBarPos = null;
let dragState = null;
let volDrag = false;
let savedVolume = 1.0;
let nativeControlsHidden = true;

function removePlaylistBar() {
  document.getElementById('yt-playlist-wrap')?.remove();
  document.getElementById('yt-playlist-panel')?.remove();
  document.getElementById('yt-ext-fs-overlay')?.remove();
  document.body.classList.remove('yt-ext-pl-active');
  playlistPanelOpen = false;
  if (timeUpdateInterval) { clearInterval(timeUpdateInterval); timeUpdateInterval = null; }
  sessionStorage.removeItem('yt-ext-vol');
  sessionStorage.removeItem('yt-ext-pl');
  try {
    navigator.mediaSession.setActionHandler('previoustrack', null);
    navigator.mediaSession.setActionHandler('nexttrack', null);
  } catch {}
}

function updateFsOverlay() {
  const isFs      = !!document.fullscreenElement;
  const barActive = !!document.getElementById('yt-playlist-wrap');
  const shouldShow = isFs && nativeControlsHidden && barActive;

  const existing = document.getElementById('yt-ext-fs-overlay');
  if (shouldShow && !existing) {
    const overlay = document.createElement('div');
    overlay.id = 'yt-ext-fs-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9997;cursor:default;';
    const block = (e) => { e.stopPropagation(); e.preventDefault(); };
    overlay.addEventListener('click',       block);
    overlay.addEventListener('mousedown',   block);
    overlay.addEventListener('mouseup',     block);
    overlay.addEventListener('contextmenu', block);
    overlay.addEventListener('wheel',       block, { passive: false });
    overlay.addEventListener('touchstart',  block, { passive: false });
    overlay.addEventListener('touchmove',   block, { passive: false });
    document.body.appendChild(overlay);
  } else if (!shouldShow && existing) {
    existing.remove();
  }
}

document.addEventListener('fullscreenchange', updateFsOverlay);

function applyVolume(vol) {
  savedVolume  = Math.max(0, Math.min(1, vol));
  const pct    = Math.round(savedVolume * 100);
  sessionStorage.setItem('yt-ext-vol', savedVolume);
  const video  = document.querySelector('video');
  if (video) video.volume = savedVolume;
  try { if (isContextValid()) chrome.storage.local.set({ extVolume: savedVolume }); } catch {}
  const volBar = document.getElementById('yt-pb-vol');
  if (!volBar) return;
  volBar.style.setProperty('--volume', pct);
  const pctEl  = volBar.querySelector('#yt-pb-vol-pct');
  const iconEl = volBar.querySelector('#yt-pb-vol-icon');
  if (pctEl)  pctEl.textContent  = pct + '%';
  if (iconEl) iconEl.innerHTML   = getVolIcon(pct);
}

function startTimeUpdate() {
  if (timeUpdateInterval) clearInterval(timeUpdateInterval);
  function tick() {
    const video  = document.querySelector('video');
    const timeEl = document.getElementById('yt-pb-time');
    const ppBtn  = document.getElementById('yt-pb-playpause');
    if (!timeEl && !ppBtn) return;

    if (video && timeEl) {
      const cur = isFinite(video.currentTime) ? video.currentTime : 0;
      const dur = isFinite(video.duration)    ? video.duration    : 0;
      timeEl.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
      const pct = dur > 0 ? (cur / dur) * 100 : 0;
      document.querySelector('.yt-pb-info-group')?.style.setProperty('--progress', pct.toFixed(3));

      if (Math.abs(video.volume - savedVolume) > 0.005) {
        video.volume = savedVolume;
      }
    }

    if (video && ppBtn) {
      const playing = !video.paused && !video.ended;
      if (ppBtn.dataset.state !== String(playing)) {
        ppBtn.dataset.state = String(playing);
        ppBtn.innerHTML = playing
          ? `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`
          : `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
      }
    }
  }
  tick();
  timeUpdateInterval = setInterval(tick, 500);
}

function ytNavigate(url) {
  const videoId = new URL(url).searchParams.get('v');
  if (!videoId) { window.location.href = url; return; }
  lastVideoId = videoId;
  document.dispatchEvent(new CustomEvent('yt-ext-navigate', { detail: { videoId } }));
}

async function navigateInPlaylist(delta) {
  if (!isContextValid()) return;
  try {
    const { playlistSession } = await chrome.storage.local.get('playlistSession');
    if (!playlistSession) return;

    const { videos, currentIndex, repeatMode = 0 } = playlistSession;
    let nextIndex = currentIndex + delta;

    if (nextIndex < 0) {
      if (repeatMode === 1) nextIndex = videos.length - 1;
      else return;
    }

    if (nextIndex >= videos.length) {
      if (repeatMode === 1) {
        nextIndex = 0;
      } else {
        await chrome.storage.local.remove('playlistSession');
        removePlaylistBar();
        return;
      }
    }

    const nextSession = { ...playlistSession, currentIndex: nextIndex };
    await chrome.storage.local.set({ playlistSession: nextSession });
    pendingPlaylistSession = nextSession;
    ytNavigate(videos[nextIndex].url);
  } catch {}
}

function attachVideoEndListener() {
  setTimeout(() => {
    const video = document.querySelector('video');
    if (!video) return;
    if (videoEndedHandler) video.removeEventListener('ended', videoEndedHandler);
    videoEndedHandler = async () => {
      if (!isContextValid()) return;
      try {
        const { playlistSession } = await chrome.storage.local.get('playlistSession');
        if (!playlistSession) return;
        if ((playlistSession.repeatMode ?? 0) === 2) {
          const player = document.querySelector('#movie_player');
          if (player && typeof player.seekTo === 'function') {
            player.seekTo(0, true);
            player.playVideo();
          } else {
            const v = document.querySelector('video');
            if (v) { v.currentTime = 0; v.play().catch(() => {}); }
          }
        } else {
          navigateInPlaylist(1);
        }
      } catch {}
    };
    video.addEventListener('ended', videoEndedHandler);
  }, 300);
}

function renderBar(session) {
  document.body.classList.toggle('yt-ext-pl-active', nativeControlsHidden);
  sessionStorage.setItem('yt-ext-pl', '1');
  try {
    navigator.mediaSession.setActionHandler('previoustrack', () => navigateInPlaylist(-1));
    navigator.mediaSession.setActionHandler('nexttrack',     () => navigateInPlaylist(1));
  } catch {}
  showPlaylistBar(session, {
    savedBarPos,
    playlistPanelOpen,
    navigate: navigateInPlaylist,
    startTimeUpdate,
    onStop: async () => {
      if (!isContextValid()) return;
      try { await chrome.storage.local.remove('playlistSession'); removePlaylistBar(); } catch {}
    },
    onRepeat: (newSession) => { renderBar(newSession); attachVideoEndListener(); },
    onResetPos: () => { savedBarPos = null; },
    onDragStart: ({ startX, startY, wrapX, wrapY }) => {
      playlistPanelOpen = false;
      dragState = { startX, startY, wrapX, wrapY };
    },
    onPanelToggle: () => {
      playlistPanelOpen = !playlistPanelOpen;
      return playlistPanelOpen;
    },
    onPanelNavigate: async (idx) => {
      if (!isContextValid()) return;
      try {
        const { playlistSession } = await chrome.storage.local.get('playlistSession');
        if (!playlistSession) return;
        const newSession = { ...playlistSession, currentIndex: idx };
        await chrome.storage.local.set({ playlistSession: newSession });
        pendingPlaylistSession = newSession;
        ytNavigate(session.videos[idx].url);
      } catch {}
    },
  });
  updateFsOverlay();
}

async function checkPlaylistSession() {
  if (!isContextValid()) return;
  try {
    const { playlistSession, savedVideos = [] } = await chrome.storage.local.get(['playlistSession', 'savedVideos']);
    if (!playlistSession) { removePlaylistBar(); return; }

    const videoMap = new Map(savedVideos.map((v) => [v.videoId, v]));
    const needsEnrich = playlistSession.videos.some((v) => {
      if (v.channelName === undefined || v.thumbnail === undefined) return true;
      if (!v.channelAvatar && videoMap.get(v.videoId)?.channelAvatar) return true;
      return false;
    });

    let activeSession = playlistSession;
    if (needsEnrich) {
      activeSession = {
        ...playlistSession,
        videos: playlistSession.videos.map((v) => {
          const stored = videoMap.get(v.videoId);
          return {
            ...v,
            channelName:   v.channelName   !== undefined ? v.channelName   : (stored?.channelName   ?? null),
            thumbnail:     v.thumbnail     !== undefined ? v.thumbnail     : (stored?.thumbnail     ?? null),
            channelAvatar: v.channelAvatar || (stored?.channelAvatar ?? null),
          };
        }),
      };
      await chrome.storage.local.set({ playlistSession: activeSession });
    }

    const videoId = getVideoId();
    const { videos, currentIndex } = activeSession;
    const idxInSession = videos.findIndex((v) => v.videoId === videoId);

    if (idxInSession === -1) {
      removePlaylistBar();
      await chrome.storage.local.remove('playlistSession');
      return;
    }

    if (idxInSession !== currentIndex) {
      activeSession = { ...activeSession, currentIndex: idxInSession };
      await chrome.storage.local.set({ playlistSession: activeSession });
    }

    renderBar(activeSession);
    attachVideoEndListener();
  } catch {}
}

function injectButton() {
  if (!window.location.pathname.startsWith('/watch')) return;
  if (document.getElementById(BTN_ID)) return;
  const container = findContainer();
  if (!container) return;
  const btn = document.createElement('button');
  btn.id = BTN_ID;
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" width="27" height="27" fill="currentColor" aria-hidden="true">
      <path d="${ICON_OUTLINE}"/>
    </svg>
    <span class="btn-text">저장</span>
  `;
  btn.addEventListener('click', () => handleSave(btn));
  container.appendChild(btn);
  updateButtonState(btn);
}

function removeButton() {
  document.getElementById(BTN_ID)?.remove();
}

function startChecking() {
  if (checkInterval) clearInterval(checkInterval);
  removeButton();
  let attempts = 0;
  checkInterval = setInterval(() => {
    if (!isContextValid()) { clearInterval(checkInterval); checkInterval = null; return; }
    attempts++;
    injectButton();
    if (document.getElementById(BTN_ID) || attempts > 40) { clearInterval(checkInterval); checkInterval = null; }
  }, 500);
}

// Fallback for environments where media keys fire as keydown events
// instead of going through the Media Session API.
document.addEventListener('keydown', (e) => {
  if (!document.getElementById('yt-playlist-wrap')) return;
  if (e.key === 'MediaTrackNext')     { e.preventDefault(); e.stopImmediatePropagation(); navigateInPlaylist(1);  }
  else if (e.key === 'MediaTrackPrevious') { e.preventDefault(); e.stopImmediatePropagation(); navigateInPlaylist(-1); }
}, { capture: true });

document.addEventListener('mousemove', (e) => {
  if (volDrag) {
    const volBarEl = document.getElementById('yt-pb-vol');
    if (!volBarEl) { volDrag = false; }
    else {
      const rect = volBarEl.getBoundingClientRect();
      applyVolume(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
    }
  }
  if (!dragState) return;
  const wrap = document.getElementById('yt-playlist-wrap');
  if (!wrap) { dragState = null; return; }
  const left = Math.max(0, Math.min(window.innerWidth  - wrap.offsetWidth,  dragState.wrapX + e.clientX - dragState.startX));
  const top  = Math.max(0, Math.min(window.innerHeight - wrap.offsetHeight, dragState.wrapY + e.clientY - dragState.startY));
  wrap.style.left = left + 'px';
  wrap.style.top  = top  + 'px';
  savedBarPos = { left, top };
});

document.addEventListener('mouseup', () => {
  volDrag = false;
  if (!dragState) return;
  dragState = null;
  document.getElementById('yt-pb-drag')?.classList.remove('dragging');
});

document.addEventListener('mousedown', (e) => {
  const wrap = document.getElementById('yt-playlist-wrap');

  if (playlistPanelOpen) {
    const panel = document.getElementById('yt-playlist-panel');
    if (!wrap?.contains(e.target) && !panel?.contains(e.target)) {
      playlistPanelOpen = false;
      panel?.remove();
      wrap?.querySelector('#yt-pb-list')?.classList.remove('active');
    }
  }

});



chrome.storage.onChanged.addListener((changes) => {
  if (!isContextValid()) return;
  if (changes.savedVideos && document.getElementById('yt-playlist-wrap')) checkPlaylistSession();
});

window.addEventListener('yt-navigate-finish', () => {
  if (!window.location.pathname.startsWith('/watch')) {
    lastVideoId = null;
    removeButton();
    removePlaylistBar();
    if (checkInterval) { clearInterval(checkInterval); checkInterval = null; }
    return;
  }

  const videoId = getVideoId();
  startChecking();

  if (videoId !== lastVideoId) {
    lastVideoId = videoId;
    checkPlaylistSession();
  } else {
    if (pendingPlaylistSession) {
      renderBar(pendingPlaylistSession);
      pendingPlaylistSession = null;
    }
    attachVideoEndListener();
  }
});

lastVideoId = getVideoId();
(async () => {
  try {
    if (isContextValid()) {
      const { extVolume, playlistSession } = await chrome.storage.local.get(['extVolume', 'playlistSession']);
      if (typeof extVolume === 'number') savedVolume = extVolume;
      // Pre-arm the volume intercept if a playlist session is already active,
      // so the override in content-main.js can block YouTube's volume reset
      // before our tick first runs.
      if (playlistSession) sessionStorage.setItem('yt-ext-vol', savedVolume);
    }
  } catch {}
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { startChecking(); checkPlaylistSession(); });
  } else {
    startChecking();
    checkPlaylistSession();
  }
})();

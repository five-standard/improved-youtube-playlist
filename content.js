(function () {
  'use strict';

  // Suppress "Extension context invalidated" unhandled rejections
  window.addEventListener('unhandledrejection', (e) => {
    if (e.reason?.message?.includes('Extension context invalidated')) {
      e.preventDefault();
    }
  });

  function isContextValid() {
    return !!chrome.runtime?.id;
  }

  const BTN_ID = 'yt-direct-save-btn';
  let checkInterval = null;
  let lastVideoId = null;

  // ─── Video Info ────────────────────────────────────────────────────────────

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
      } catch (e) {}
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

  // ─── Container ─────────────────────────────────────────────────────────────

  function findContainer() {
    return (
      document.querySelector('#top-level-buttons-computed') ||
      document.querySelector('ytd-menu-renderer #top-level-buttons-computed') ||
      document.querySelector('#actions ytd-menu-renderer') ||
      document.querySelector('ytd-watch-metadata #actions')
    );
  }

  // ─── Button State ──────────────────────────────────────────────────────────

  function escHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const ICON_FILLED   = 'M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z';
  const ICON_OUTLINE  = 'M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2zm0 15l-5-2.18L7 18V5h10v13z';

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
    } catch { /* context invalidated */ }
  }

  // ─── Group & Save Logic ────────────────────────────────────────────────────

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
    } catch { /* context invalidated */ }
  }

  async function openSaveModal(btn, info) {
    if (!isContextValid()) return;
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
        list.innerHTML = currentGroups.map((g) => `
          <button class="yt-sm-group-item${selectedGroupId === g.id ? ' selected' : ''}" data-group-id="${escHtml(g.id)}">
            <span class="yt-sm-check-icon">${selectedGroupId === g.id ? '✓' : ''}</span>
            <span class="yt-sm-group-name">${escHtml(g.name)}</span>
          </button>
        `).join('');
        toggleBtn.style.display = '';

        list.querySelectorAll('.yt-sm-group-item').forEach((item) => {
          item.addEventListener('click', () => {
            const gid = item.dataset.groupId;
            selectedGroupId = selectedGroupId === gid ? null : gid;
            list.querySelectorAll('.yt-sm-group-item').forEach((el) => {
              const isSelected = el.dataset.groupId === selectedGroupId;
              el.classList.toggle('selected', isSelected);
              el.querySelector('.yt-sm-check-icon').textContent = isSelected ? '✓' : '';
            });
          });
        });
      }
    }

    let createFormVisible = false;
    function toggleCreate() {
      createFormVisible = !createFormVisible;
      const form = overlay.querySelector('#yt-sm-create-form');
      form.classList.toggle('yt-sm-hidden', !createFormVisible);
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
      updateButtonState(btn);
    });

    renderGroups();
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

      openSaveModal(btn, info);
    } catch { /* context invalidated */ }
  }

  // ─── Playlist Session ──────────────────────────────────────────────────────

  let videoEndedHandler = null;
  let playlistPanelOpen = false;
  let timeUpdateInterval = null;
  let pendingPlaylistSession = null; // set before SPA nav, consumed in yt-navigate-finish
  let savedBarPos = null;           // { left, top } when user dragged the bar
  let dragState   = null;           // active drag tracking

  function removePlaylistBar() {
    document.getElementById('yt-playlist-wrap')?.remove();
    document.getElementById('yt-playlist-panel')?.remove();
    playlistPanelOpen = false;
    if (timeUpdateInterval) { clearInterval(timeUpdateInterval); timeUpdateInterval = null; }
  }

  function formatTime(s) {
    s = Math.floor(s || 0);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  function startTimeUpdate() {
    if (timeUpdateInterval) clearInterval(timeUpdateInterval);
    function tick() {
      // Use the native <video> element — its properties (currentTime, duration,
      // paused) are always accessible from the content script isolated world,
      // unlike YouTube player API methods which live in the page's main world.
      const video   = document.querySelector('video');
      const timeEl  = document.getElementById('yt-pb-time');
      const ppBtn   = document.getElementById('yt-pb-playpause');
      if (!timeEl && !ppBtn) return; // bar gone, will be cleared on next removePlaylistBar

      if (video && timeEl) {
        const cur = isFinite(video.currentTime) ? video.currentTime : 0;
        const dur = isFinite(video.duration)    ? video.duration    : 0;
        timeEl.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;

        // Update progress bar on the info group via CSS custom property
        const pct = dur > 0 ? (cur / dur) * 100 : 0;
        document.querySelector('.yt-pb-info-group')
          ?.style.setProperty('--progress', pct.toFixed(3));
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

    // Set lastVideoId FIRST so yt-navigate-finish skips checkPlaylistSession
    // (the playlist session is already updated by the caller).
    lastVideoId = videoId;

    // Ask content-main.js (MAIN world) to fire YouTube's internal 'yt-navigate'
    // event on ytd-app. Direct anchor clicks from the isolated world are
    // untrusted (isTrusted:false) and ignored by YouTube's router.
    document.dispatchEvent(
      new CustomEvent('yt-ext-navigate', { detail: { videoId } }),
    );
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
      // Defer UI update until yt-navigate-finish so the bar reflects the video
      // that is actually playing, not the one that is still loading.
      pendingPlaylistSession = nextSession;
      ytNavigate(videos[nextIndex].url);
    } catch { /* context invalidated */ }
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
        } catch { /* context invalidated */ }
      };
      video.addEventListener('ended', videoEndedHandler);
    }, 300);
  }

  function renderPlaylistPanel(wrap, session) {
    document.getElementById('yt-playlist-panel')?.remove();
    if (!playlistPanelOpen) return;

    const { videos, currentIndex } = session;
    const panel = document.createElement('div');
    panel.id = 'yt-playlist-panel';

    const thumbOf = (v) => v.thumbnail
      || `https://img.youtube.com/vi/${v.videoId}/mqdefault.jpg`;

    panel.innerHTML = videos.map((v, i) => `
      <button class="yt-pp-item${i === currentIndex ? ' current' : ''}" data-idx="${i}">
        <span class="yt-pp-idx">${i + 1}</span>
        <img class="yt-pp-thumb" src="${escHtml(thumbOf(v))}" alt="" loading="lazy">
        <div class="yt-pp-info">
          <span class="yt-pp-title">${escHtml(v.title || v.videoId)}</span>
          ${v.channelName ? `<span class="yt-pp-channel">${escHtml(v.channelName)}</span>` : ''}
        </div>
      </button>
    `).join('');

    panel.querySelectorAll('.yt-pp-item').forEach((item) => {
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
      });
      item.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        const idx = parseInt(item.dataset.idx);
        if (!isContextValid()) return;
        try {
          const { playlistSession } = await chrome.storage.local.get('playlistSession');
          if (!playlistSession) return;
          const newSession = { ...playlistSession, currentIndex: idx };
          await chrome.storage.local.set({ playlistSession: newSession });
          pendingPlaylistSession = newSession;
          ytNavigate(videos[idx].url);
        } catch { /* context invalidated */ }
      });
    });

    // Position the panel as fixed in document.body — independent of wrap's layout.
    // This prevents the panel from shifting the control bar when it opens.
    const PANEL_W = 380;
    const ARROW_H = 10; // arrow height
    const GAP     = 6;  // gap between arrow tip and button top

    const listBtn = wrap.querySelector('#yt-pb-list');
    if (listBtn) {
      const btn = listBtn.getBoundingClientRect();
      // Center panel horizontally on the button, clamped to viewport edges
      const rawLeft    = btn.left + btn.width / 2 - PANEL_W / 2;
      const clampedLeft = Math.max(8, Math.min(window.innerWidth - PANEL_W - 8, rawLeft));
      // Arrow points to the button's horizontal center
      const arrowLeft  = btn.left + btn.width / 2 - clampedLeft;

      panel.style.position = 'fixed';
      panel.style.bottom   = (window.innerHeight - btn.top + ARROW_H + GAP) + 'px';
      panel.style.left     = clampedLeft + 'px';
      panel.style.setProperty('--arrow-left', arrowLeft + 'px');
    }

    document.body.appendChild(panel);

    // Scroll current item into view
    setTimeout(() => {
      panel.querySelector('.yt-pp-item.current')?.scrollIntoView({ block: 'nearest' });
    }, 0);
  }

  function showPlaylistBar(session) {
    const { groupName, videos, currentIndex, repeatMode = 0 } = session;
    const total = videos.length;
    const currentVideo = videos[currentIndex];

    let wrap = document.getElementById('yt-playlist-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'yt-playlist-wrap';
      document.body.appendChild(wrap);
    }

    // Restore saved drag position (overrides CSS default bottom/left)
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

    const prevDisabled = currentIndex === 0 && repeatMode !== 1 ? ' disabled' : '';
    const nextDisabled = currentIndex >= total - 1 && repeatMode !== 1 ? ' disabled' : '';
    const repeatActiveClass = repeatMode > 0 ? ' active' : '';
    const repeatTitle = repeatMode === 0 ? '반복 없음' : repeatMode === 1 ? '플리 반복' : '한 곡 반복';
    const repeatIcon = repeatMode === 2
      ? `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/><text x="12" y="14.5" text-anchor="middle" font-size="6" font-weight="bold" fill="currentColor" font-family="Arial,sans-serif">1</text></svg>`
      : `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>`;

    // ── 4-group layout ──────────────────────────────────────────────
    // Group 1: Close  |  Group 2: Playlist  |  Group 3: Transport  |  Group 4: Video info
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
        <span class="yt-pb-name">${escHtml(groupName)}</span>
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
      <div class="yt-pb-group yt-pb-info-group">
        ${currentVideo?.channelAvatar ? `<img class="yt-pb-ch-avatar" src="${escHtml(currentVideo.channelAvatar)}" alt="">` : ''}
        ${currentVideo?.channelName ? `<span class="yt-pb-ch-name">${escHtml(currentVideo.channelName)}</span><span class="yt-pb-sep">·</span>` : ''}
        <span class="yt-pb-video-title">${escHtml(currentVideo?.title || '')}</span>
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

    // ── Event listeners ─────────────────────────────────────────────
    row.querySelector('#yt-pb-stop').addEventListener('click', async () => {
      if (!isContextValid()) return;
      try { await chrome.storage.local.remove('playlistSession'); removePlaylistBar(); }
      catch { /* context invalidated */ }
    });

    row.querySelector('#yt-pb-list').addEventListener('click', () => {
      playlistPanelOpen = !playlistPanelOpen;
      row.querySelector('#yt-pb-list').classList.toggle('active', playlistPanelOpen);
      renderPlaylistPanel(wrap, session);
    });

    row.querySelector('#yt-pb-prev').addEventListener('click', () => navigateInPlaylist(-1));
    row.querySelector('#yt-pb-next').addEventListener('click', () => navigateInPlaylist(1));

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
      // Prefer the YouTube player API (loadVideoById works in practice),
      // fall back to the native <video> element if the API isn't reachable.
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
        showPlaylistBar(newSession);
        attachVideoEndListener();
      } catch { /* context invalidated */ }
    });

    // Reset bar to default position
    row.querySelector('#yt-pb-reset-pos').addEventListener('click', () => {
      savedBarPos = null;
      wrap.style.bottom    = '';
      wrap.style.transform = '';
      wrap.style.left      = '';
      wrap.style.top       = '';
    });

    // Drag handle — mousedown starts tracking; mousemove/mouseup are on document
    row.querySelector('#yt-pb-drag').addEventListener('mousedown', (e) => {
      e.preventDefault();
      // Close panel while dragging to avoid positional mismatch
      if (playlistPanelOpen) {
        playlistPanelOpen = false;
        document.getElementById('yt-playlist-panel')?.remove();
        row.querySelector('.yt-pb-list')?.classList.remove('active');
      }
      const rect = wrap.getBoundingClientRect();
      // Switch from CSS bottom/transform to explicit top/left so we can move freely
      wrap.style.bottom    = 'auto';
      wrap.style.transform = 'none';
      wrap.style.left      = rect.left + 'px';
      wrap.style.top       = rect.top  + 'px';
      dragState = { startX: e.clientX, startY: e.clientY, wrapX: rect.left, wrapY: rect.top };
      document.getElementById('yt-pb-drag')?.classList.add('dragging');
    });

    startTimeUpdate();
    renderPlaylistPanel(wrap, session);
  }

  async function checkPlaylistSession() {
    if (!isContextValid()) return;
    try {
      const { playlistSession, savedVideos = [] } = await chrome.storage.local.get(['playlistSession', 'savedVideos']);

      if (!playlistSession) { removePlaylistBar(); return; }

      // Enrich session videos that are missing fields or have stale null values.
      // Build the map first so we can check whether stored data has richer info.
      const videoMap = new Map(savedVideos.map((v) => [v.videoId, v]));
      const needsEnrich = playlistSession.videos.some((v) => {
        if (v.channelName === undefined || v.thumbnail === undefined) return true;
        // Re-enrich channelAvatar if it's absent/null AND stored data now has it
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

      showPlaylistBar(activeSession);
      attachVideoEndListener();
    } catch { /* context invalidated */ }
  }

  // ─── Inject / Remove ───────────────────────────────────────────────────────

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

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  function startChecking() {
    if (checkInterval) clearInterval(checkInterval);
    removeButton();

    let attempts = 0;
    checkInterval = setInterval(() => {
      if (!isContextValid()) {
        clearInterval(checkInterval);
        checkInterval = null;
        return;
      }
      attempts++;
      injectButton();
      if (document.getElementById(BTN_ID) || attempts > 40) {
        clearInterval(checkInterval);
        checkInterval = null;
      }
    }, 500);
  }

  // ── Global drag handlers (added once at module level) ──────────────────────

  document.addEventListener('mousemove', (e) => {
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
    if (!dragState) return;
    dragState = null;
    document.getElementById('yt-pb-drag')?.classList.remove('dragging');
  });

  // Close the playlist panel when clicking outside the control bar or panel
  document.addEventListener('mousedown', (e) => {
    if (!playlistPanelOpen) return;
    const wrap  = document.getElementById('yt-playlist-wrap');
    const panel = document.getElementById('yt-playlist-panel');
    const insideWrap  = wrap  && wrap.contains(e.target);
    const insidePanel = panel && panel.contains(e.target);
    if (!insideWrap && !insidePanel) {
      playlistPanelOpen = false;
      panel?.remove();
      wrap?.querySelector('.yt-pb-list')?.classList.remove('active');
    }
  });

  // Refresh the control bar when savedVideos is updated from the popup
  // (e.g. after "저장된 데이터 업데이트" button fills in missing channelAvatar)
  chrome.storage.onChanged.addListener((changes) => {
    if (!isContextValid()) return;
    if (changes.savedVideos && document.getElementById('yt-playlist-wrap')) {
      checkPlaylistSession();
    }
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

    // Always reinject the save button — the DOM is rebuilt after SPA navigation.
    startChecking();

    if (videoId !== lastVideoId) {
      // Normal user navigation (not triggered by our playlist code).
      lastVideoId = videoId;
      checkPlaylistSession();
    } else {
      // Playlist navigation complete — new page DOM is ready.
      // Now update the bar and panel to reflect the video that is actually playing.
      if (pendingPlaylistSession) {
        showPlaylistBar(pendingPlaylistSession);
        pendingPlaylistSession = null;
      }
      attachVideoEndListener();
    }
  });

  lastVideoId = getVideoId();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { startChecking(); checkPlaylistSession(); });
  } else {
    startChecking();
    checkPlaylistSession();
  }
})();

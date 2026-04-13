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

// Storage compression helpers
const YT_AVATAR_PFX = 'https://yt3.ggpht.com/';
// Thumbnail quality enum: hq=1, mq=2, sd=3, max=4
const YT_THUMB_CODES        = { hqdefault: 1, mqdefault: 2, sddefault: 3, maxresdefault: 4 };
const YT_THUMB_FILES        = { 1: 'hqdefault', 2: 'mqdefault', 3: 'sddefault', 4: 'maxresdefault' };
const YT_THUMB_LEGACY_CODES = { hq: 1, mq: 2, sd: 3, max: 4 };  // backward compat: old string → new number
const YT_THUMB_LEGACY_FILES = { hq: 'hqdefault', mq: 'mqdefault', sd: 'sddefault', max: 'maxresdefault' };

function compressAvatar(url) {
  return (url || '').startsWith(YT_AVATAR_PFX) ? url.slice(YT_AVATAR_PFX.length) : (url || '');
}
function expandAvatar(stored) {
  if (!stored) return '';
  return stored.startsWith('http') ? stored : YT_AVATAR_PFX + stored;
}
function compressThumb(url, videoId) {
  if (url == null || url === '') return null;
  if (typeof url === 'number') return url;                           // already a numeric code
  if (YT_THUMB_LEGACY_CODES[url] != null) return YT_THUMB_LEGACY_CODES[url]; // old string code → number
  const pfx = `https://img.youtube.com/vi/${videoId}/`;
  if (url.startsWith(pfx)) {
    const q = url.slice(pfx.length).replace('.jpg', '');
    const code = YT_THUMB_CODES[q];
    return code ?? url;
  }
  return url;
}
function expandThumb(stored, videoId) {
  if (stored == null || stored === '') return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
  const file = YT_THUMB_FILES[stored] || YT_THUMB_LEGACY_FILES[stored];
  return file ? `https://img.youtube.com/vi/${videoId}/${file}.jpg` : stored;
}

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

async function openSaveModal(btn, info, { saveToFolders, onSaved }) {
  document.getElementById('yt-save-modal')?.remove();

  const SVG_FOLDER        = '<path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>';
  const SVG_CHECK         = '<path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>';
  const SVG_CHEVRON_RIGHT = '<path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>';
  const SVG_CHEVRON_DOWN  = '<path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/>';

  function mkSvg(path, size) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor">${path}</svg>`;
  }

  let groups, savedVideos, channels;
  try {
    ({ groups = [], savedVideos = [], channels = [] } = await chrome.storage.local.get(['groups', 'savedVideos', 'channels']));
  } catch { return; }

  const activeFolders = groups.filter(g => !g.deleted && g.type !== 'separator');
  const activeVideos  = savedVideos.filter(v => !v.deleted);
  const existingEntry = activeVideos.find(v => v.videoId === info.videoId);
  const alreadySavedIn = (() => {
    if (!existingEntry) return new Set();
    const raw = Array.isArray(existingEntry.groupId) ? existingEntry.groupId : [existingEntry.groupId ?? null];
    return new Set(raw.length === 0 ? [null] : raw);
  })();

  const selectedIds = new Set(alreadySavedIn); // pre-select already-saved folders

  // Auto-expand the path to each already-saved folder so they're visible on open
  const expandedIds = new Set();
  for (const savedId of alreadySavedIn) {
    if (savedId === null) {
      expandedIds.add(null); // saved in root → expand root
      continue;
    }
    let cur = savedId;
    const seen = new Set();
    while (cur !== null) {
      if (seen.has(cur)) break;
      seen.add(cur);
      const folder = activeFolders.find(function(f) { return f.id === cur; });
      if (!folder) break;
      const parentId = folder.parentId ?? null;
      expandedIds.add(parentId); // expand parent to make this folder visible
      cur = parentId;
    }
  }

  const durationHtml = info.duration
    ? '<span class="yt-sm-preview-duration">' + esc(formatTime(info.duration)) + '</span>'
    : '';
  const metaHtml = [info.channelName ? esc(info.channelName) : '', durationHtml]
    .filter(Boolean).join('<span class="yt-sm-preview-sep">·</span>');

  const overlay = document.createElement('div');
  overlay.id = 'yt-save-modal';
  overlay.innerHTML = `
    <div class="yt-sm-dialog">
      <div class="yt-sm-header">
        <span>폴더 선택</span>
        <button class="yt-sm-close-btn" aria-label="닫기">✕</button>
      </div>
      <div class="yt-sm-preview">
        <div class="yt-sm-preview-thumb-wrap">
          <img class="yt-sm-preview-thumb" src="${esc(info.thumbnail)}" alt="">
        </div>
        <div class="yt-sm-preview-info">
          <span class="yt-sm-preview-title">${esc(info.title)}</span>
          ${metaHtml ? '<div class="yt-sm-preview-meta">' + metaHtml + '</div>' : ''}
        </div>
      </div>
      <div class="yt-sm-body" id="yt-sm-tree"></div>
      <div class="yt-sm-new-folder-wrap yt-sm-hidden" id="yt-sm-new-folder-wrap">
        <input class="yt-sm-input" id="yt-sm-folder-input" placeholder="새 폴더 이름...">
        <button class="yt-sm-create-confirm-btn" id="yt-sm-folder-confirm">만들기</button>
      </div>
      <div class="yt-sm-footer">
        <button class="yt-sm-toggle-create-btn" id="yt-sm-new-folder-btn">+ 새 폴더</button>
        <button class="yt-sm-save-btn" id="yt-sm-save-btn">저장</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  attachThumbFallback(overlay.querySelector('.yt-sm-preview-thumb'), info.videoId);

  const tree          = overlay.querySelector('#yt-sm-tree');
  const newFolderWrap = overlay.querySelector('#yt-sm-new-folder-wrap');
  const folderInput   = overlay.querySelector('#yt-sm-folder-input');

  const childFolders = (parentId) =>
    activeFolders.filter(f => (f.parentId || null) === parentId);
  const videosIn = (folderId) =>
    activeVideos.filter(v => {
      const raw  = Array.isArray(v.groupId) ? v.groupId : [v.groupId ?? null];
      const gids = raw.length === 0 ? [null] : raw;
      return gids.includes(folderId) && v.videoId !== info.videoId;
    });
  const hasContent = (folderId) =>
    childFolders(folderId).length > 0 || videosIn(folderId).length > 0;

  function renderTree() {
    tree.innerHTML = '';
    appendFolderRow(null, '루트', 0);
    if (expandedIds.has(null)) appendChildren(null, 1);
  }

  function appendFolderRow(folderId, name, depth) {
    const isSelected     = selectedIds.has(folderId);
    const isExpanded     = expandedIds.has(folderId);
    const isAlreadySaved = alreadySavedIn.has(folderId);
    const canExpand      = hasContent(folderId);

    const row = document.createElement('div');
    row.className = 'yt-sm-folder-row' + (isSelected ? ' selected' : '');
    row.style.paddingLeft = (depth * 20 + 10) + 'px';

    const chevron = document.createElement('span');
    chevron.className = 'yt-sm-chevron';
    if (canExpand) {
      chevron.innerHTML = mkSvg(isExpanded ? SVG_CHEVRON_DOWN : SVG_CHEVRON_RIGHT, 14);
      chevron.addEventListener('click', function(e) {
        e.stopPropagation();
        if (expandedIds.has(folderId)) expandedIds.delete(folderId);
        else expandedIds.add(folderId);
        renderTree();
      });
    }

    const folderIcon = document.createElement('span');
    folderIcon.className = 'yt-sm-folder-icon';
    folderIcon.innerHTML = mkSvg(SVG_FOLDER, 15);

    const nameEl = document.createElement('span');
    nameEl.className = 'yt-sm-folder-name';
    nameEl.textContent = name;

    const checkEl = document.createElement('span');
    checkEl.className = 'yt-sm-check';
    if (isSelected) checkEl.innerHTML = mkSvg(SVG_CHECK, 14);

    row.appendChild(chevron);
    row.appendChild(folderIcon);
    row.appendChild(nameEl);

    if (isAlreadySaved) {
      const badge = document.createElement('span');
      badge.className = 'yt-sm-saved-badge';
      badge.textContent = '저장됨';
      row.appendChild(badge);
    }

    row.appendChild(checkEl);

    row.addEventListener('click', function() {
      if (selectedIds.has(folderId)) selectedIds.delete(folderId);
      else selectedIds.add(folderId);
      renderTree();
    });

    tree.appendChild(row);
  }

  function appendChildren(parentId, depth) {
    childFolders(parentId).forEach(function(folder) {
      appendFolderRow(folder.id, folder.name, depth);
      if (expandedIds.has(folder.id)) appendChildren(folder.id, depth + 1);
    });
    videosIn(parentId).forEach(function(video) {
      const thumb = expandThumb(video.thumbnail, video.videoId);
      const ch = video.channelId != null ? channels.find(function(c) { return c.id === video.channelId; }) : null;
      const channelName = ch ? ch.name : (video.channelName || '');
      const metaParts = [
        channelName ? esc(channelName) : '',
        video.duration ? esc(formatTime(video.duration)) : '',
      ].filter(Boolean);
      const row = document.createElement('div');
      row.className = 'yt-sm-video-row';
      row.style.paddingLeft = (depth * 20 + 10) + 'px';
      row.innerHTML =
        '<img class="yt-sm-video-thumb" src="' + esc(thumb) + '" alt="">' +
        '<div class="yt-sm-video-info">' +
          '<span class="yt-sm-video-title">' + esc(video.title) + '</span>' +
          (metaParts.length ? '<span class="yt-sm-video-meta">' + metaParts.join(' · ') + '</span>' : '') +
        '</div>';
      attachThumbFallback(row.querySelector('.yt-sm-video-thumb'), video.videoId);
      tree.appendChild(row);
    });
  }

  const close = () => overlay.remove();
  overlay.querySelector('.yt-sm-close-btn').addEventListener('click', close);
  overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });

  overlay.querySelector('#yt-sm-save-btn').addEventListener('click', async function() {
    await saveToFolders(info, [...selectedIds]);
    close();
    onSaved(btn);
  });

  overlay.querySelector('#yt-sm-new-folder-btn').addEventListener('click', function() {
    const hidden = newFolderWrap.classList.toggle('yt-sm-hidden');
    if (!hidden) folderInput.focus();
  });

  async function confirmNewFolder() {
    const name = folderInput.value.trim();
    if (!name) { folderInput.focus(); return; }
    const { groups: current = [] } = await chrome.storage.local.get('groups');
    const newFolder = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      name: name,
      parentId: null,
      createdAt: Date.now(),
    };
    current.push(newFolder);
    await chrome.storage.local.set({ groups: current });
    activeFolders.push(newFolder);
    selectedIds.add(newFolder.id);
    folderInput.value = '';
    newFolderWrap.classList.add('yt-sm-hidden');
    renderTree();
  }

  overlay.querySelector('#yt-sm-folder-confirm').addEventListener('click', confirmNewFolder);
  folderInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter')  confirmNewFolder();
    if (e.key === 'Escape') newFolderWrap.classList.add('yt-sm-hidden');
  });

  renderTree();
}

 function renderPlaylistPanel(wrap, session, { isOpen, onNavigate }) {
  document.getElementById('yt-playlist-panel')?.remove();
  if (!isOpen) return;

  const { videos, currentIndex } = session;
  const thumbOf = (v) => v.thumbnail || `https://img.youtube.com/vi/${v.videoId}/mqdefault.jpg`;

  const panel = document.createElement('div');
  panel.id = 'yt-playlist-panel';

  const hasFolderNames = videos.some(v => v.folderName);
  let html = '';
  let lastFolder = undefined;
  videos.forEach((v, i) => {
    if (hasFolderNames && v.folderName !== lastFolder) {
      html += `<div class="yt-pp-folder-sep">${esc(v.folderName || '루트')}</div>`;
      lastFolder = v.folderName;
    }
    html += `
      <button class="yt-pp-item${i === currentIndex ? ' current' : ''}" data-idx="${i}">
        <span class="yt-pp-idx">${i + 1}</span>
        <img class="yt-pp-thumb" src="${esc(thumbOf(v))}" alt="" loading="lazy">
        <div class="yt-pp-info">
          <span class="yt-pp-title">${esc(v.title || v.videoId)}</span>
          ${v.channelName ? `<span class="yt-pp-channel">${esc(v.channelName)}</span>` : ''}
        </div>
      </button>
    `;
  });
  panel.innerHTML = html;

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

  const infoGroup = row.querySelector('.yt-pb-info-group');
  infoGroup.addEventListener('mousedown', (e) => {
    e.preventDefault();
    seekDrag = true;
    infoGroup.classList.add('seeking');
    const rect = infoGroup.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    applySeek(ratio);
  });

  startTimeUpdate();
  renderPlaylistPanel(wrap, session, { isOpen: playlistPanelOpen, onNavigate: onPanelNavigate });
}


chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'yt-navigate' && msg.url) {
    // Prime pendingPlaylistSession before navigating.
    // storage.onChanged only calls checkPlaylistSession when yt-playlist-wrap already
    // exists, so on first start the bar would never appear via that path.
    // Reading the session here and setting pendingPlaylistSession ensures
    // yt-navigate-finish (which takes the `else` branch because ytNavigate pre-sets
    // lastVideoId) can render the bar correctly.
    chrome.storage.local.get('playlistSession')
      .then(({ playlistSession }) => {
        if (playlistSession) pendingPlaylistSession = playlistSession;
        ytNavigate(msg.url);
      })
      .catch(() => ytNavigate(msg.url));
    return;
  }

  // ── Popup controller actions ────────────────────────────────────────────
  if (msg.action === 'popup-get-state') {
    const video  = document.querySelector('video');
    const player = document.querySelector('#movie_player');
    const paused = !video || video.paused || video.ended;
    const state  = player?.getPlayerState?.() ?? (paused ? 2 : 1);
    sendResponse({
      currentTime: video ? (isFinite(video.currentTime) ? video.currentTime : 0) : 0,
      duration:    video ? (isFinite(video.duration)    ? video.duration    : 0) : 0,
      paused,
      playerState: state,
      volume: savedVolume,
    });
    return true; // keep channel open for async sendResponse
  }

  if (msg.action === 'popup-play-pause') {
    const player = document.querySelector('#movie_player');
    const video  = document.querySelector('video');
    if (player && typeof player.pauseVideo === 'function') {
      const s = player.getPlayerState?.() ?? -1;
      if (s === 1) player.pauseVideo(); else player.playVideo();
    } else if (video) {
      if (video.paused) video.play(); else video.pause();
    }
    return;
  }

  if (msg.action === 'popup-prev') { navigateInPlaylist(-1); return; }
  if (msg.action === 'popup-next') { navigateInPlaylist(1);  return; }

  if (msg.action === 'popup-rewind') {
    const player = document.querySelector('#movie_player');
    const video  = document.querySelector('video');
    if (player && typeof player.seekTo === 'function')
      player.seekTo(Math.max(0, (player.getCurrentTime?.() ?? 0) - 10), true);
    else if (video)
      video.currentTime = Math.max(0, video.currentTime - 10);
    return;
  }

  if (msg.action === 'popup-forward') {
    const player = document.querySelector('#movie_player');
    const video  = document.querySelector('video');
    if (player && typeof player.seekTo === 'function')
      player.seekTo((player.getCurrentTime?.() ?? 0) + 10, true);
    else if (video)
      video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10);
    return;
  }

  if (msg.action === 'popup-seek' && msg.ratio != null) {
    applySeek(msg.ratio);
    return;
  }

  if (msg.action === 'popup-stop') {
    chrome.storage.local.remove('playlistSession').catch(() => {});
    removePlaylistBar();
    return;
  }

  if (msg.action === 'popup-repeat') {
    chrome.storage.local.get('playlistSession').then(({ playlistSession }) => {
      if (!playlistSession) return;
      const newMode    = ((playlistSession.repeatMode ?? 0) + 1) % 3;
      const newSession = { ...playlistSession, repeatMode: newMode };
      chrome.storage.local.set({ playlistSession: newSession });
    }).catch(() => {});
    return;
  }

  if (msg.action === 'popup-volume' && msg.volume != null) {
    applyVolume(msg.volume);
    return;
  }

  if (msg.action === 'popup-navigate-to' && msg.index != null) {
    chrome.storage.local.get('playlistSession').then(async ({ playlistSession }) => {
      if (!playlistSession) return;
      const idx = msg.index;
      if (idx < 0 || idx >= playlistSession.videos.length) return;
      const newSession = { ...playlistSession, currentIndex: idx };
      await chrome.storage.local.set({ playlistSession: newSession });
      pendingPlaylistSession = newSession;
      ytNavigate(playlistSession.videos[idx].url);
    }).catch(() => {});
    return;
  }
});

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

  const videoEl = document.querySelector('video.html5-main-video');
  const duration = (videoEl && isFinite(videoEl.duration) && videoEl.duration > 0)
    ? Math.round(videoEl.duration)
    : null;

  return {
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title,
    thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    channelName,
    channelUrl,
    channelAvatar,
    uploadDate,
    duration,
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

/**
 * Saves the video to each folder in groupIds.
 * If groupIds is empty, saves to root (groupId: null).
 * Skips any folder where this videoId is already saved.
 */
/**
 * Replaces a video's folder membership with the given groupIds.
 * - groupIds empty: removes the video entirely (if it exists).
 * - groupIds non-empty: creates or updates the video entry with exactly these folders.
 */
async function setVideoFolders(info, groupIds) {
  if (!isContextValid()) return;
  try {
    const { savedVideos = [], channels = [] } = await chrome.storage.local.get(['savedVideos', 'channels']);
    const normalized = groupIds.map((gid) => gid ?? null);

    // Find or create channel entry
    let channelId = null;
    if (info.channelName) {
      const av = compressAvatar(info.channelAvatar);
      let ch = channels.find((c) => c.name === info.channelName);
      if (ch) {
        if (av && !ch.avatar) ch.avatar = av;
        channelId = ch.id;
      } else {
        channelId = channels.length ? Math.max(...channels.map((c) => c.id)) + 1 : 0;
        channels.push({ id: channelId, name: info.channelName, avatar: av });
      }
    }

    const existing = savedVideos.find((v) => v.videoId === info.videoId);

    if (normalized.length === 0) {
      // No folders selected → remove video entirely
      if (existing) {
        await chrome.storage.local.set({ savedVideos: savedVideos.filter((v) => v.videoId !== info.videoId) });
      }
      return;
    }

    if (existing) {
      // Replace folder membership
      existing.groupId = normalized;
      if (channelId != null && existing.channelId == null) existing.channelId = channelId;
    } else {
      const thumb = compressThumb(info.thumbnail, info.videoId);
      const entry = {
        videoId: info.videoId,
        title:   info.title,
        groupId: normalized,
        savedAt: Date.now(),
      };
      if (thumb)             entry.thumbnail = thumb;
      if (info.duration)     entry.duration  = info.duration;
      if (channelId != null) entry.channelId = channelId;
      savedVideos.push(entry);
    }
    await chrome.storage.local.set({ savedVideos, channels });
  } catch {}
}

async function handleSave(btn) {
  if (!isContextValid()) return;
  const info = getVideoInfo();
  if (!info) return;
  try {
    openSaveModal(btn, info, { saveToFolders: setVideoFolders, onSaved: updateButtonState });
  } catch {}
}

let videoEndedHandler = null;
let playlistPanelOpen = false;
let timeUpdateInterval = null;
let pendingPlaylistSession = null;
let savedBarPos = null;
let dragState = null;
let volDrag = false;
let seekDrag = false;
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

function applySeek(ratio) {
  const video = document.querySelector('video');
  if (!video || !isFinite(video.duration) || video.duration <= 0) return;
  const targetTime = ratio * video.duration;
  const player = document.querySelector('#movie_player');
  if (player && typeof player.seekTo === 'function') {
    player.seekTo(targetTime, true);
  } else {
    video.currentTime = targetTime;
  }
  const infoGroup = document.querySelector('.yt-pb-info-group');
  infoGroup?.style.setProperty('--progress', (ratio * 100).toFixed(3));
  const timeEl = document.getElementById('yt-pb-time');
  if (timeEl) timeEl.textContent = `${formatTime(targetTime)} / ${formatTime(video.duration)}`;
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

// storageTriggered=true: called from storage.onChanged (page hasn't changed yet).
// In this case we must NOT reconcile currentIndex against the current page — doing so
// lets the old video's ended-handler navigate the new session to the wrong track while
// popup's yt-navigate is already in flight, causing the rapid-cycling conflict.
async function checkPlaylistSession(storageTriggered = false) {
  if (!isContextValid()) return;
  try {
    const { playlistSession, savedVideos = [], channels = [] } = await chrome.storage.local.get(['playlistSession', 'savedVideos', 'channels']);
    if (!playlistSession) { removePlaylistBar(); return; }

    const videoMap = new Map(savedVideos.map((v) => [v.videoId, v]));
    const needsEnrich = playlistSession.videos.some((v) => {
      if (v.channelName === undefined || v.thumbnail === undefined) return true;
      if (!v.channelAvatar && videoMap.has(v.videoId)) return true;
      return false;
    });

    let activeSession = playlistSession;
    if (needsEnrich) {
      activeSession = {
        ...playlistSession,
        videos: playlistSession.videos.map((v) => {
          const stored = videoMap.get(v.videoId);
          let channelName   = v.channelName   !== undefined ? v.channelName   : null;
          let channelAvatar = v.channelAvatar || null;
          let thumbnail     = v.thumbnail     !== undefined ? v.thumbnail     : null;

          if (stored) {
            // Resolve channel from compressed format
            if (stored.channelId != null) {
              const ch = channels.find((c) => c.id === stored.channelId);
              if (ch) {
                if (channelName   == null) channelName   = ch.name;
                if (!channelAvatar)        channelAvatar = expandAvatar(ch.avatar);
              }
            } else {
              // Legacy uncompressed format fallback
              if (channelName   == null) channelName   = stored.channelName   ?? null;
              if (!channelAvatar)        channelAvatar = stored.channelAvatar ?? null;
            }
            // Expand compressed thumbnail
            if (thumbnail == null) thumbnail = expandThumb(stored.thumbnail, v.videoId);
          }

          return { ...v, channelName, thumbnail, channelAvatar };
        }),
      };
      await chrome.storage.local.set({ playlistSession: activeSession });
    }

    // When triggered by a storage change (not a page navigation), skip the
    // currentIndex reconciliation entirely.  The old ended-handler must also be
    // torn down immediately so it can't fire against the incoming session.
    if (storageTriggered) {
      const videoEl = document.querySelector('video');
      if (videoEl && videoEndedHandler) {
        videoEl.removeEventListener('ended', videoEndedHandler);
        videoEndedHandler = null;
      }
      if (document.getElementById('yt-playlist-wrap')) {
        // Bar already visible — just refresh it in-place (handles repeat-mode changes etc.)
        renderBar(activeSession);
        attachVideoEndListener();
      }
      // If bar doesn't exist yet, pendingPlaylistSession is set by the yt-navigate
      // message handler before ytNavigate() is called, so yt-navigate-finish handles
      // first-render there. Nothing to do here.
      return;
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
  if (seekDrag) {
    const infoGroupEl = document.querySelector('.yt-pb-info-group');
    if (!infoGroupEl) { seekDrag = false; }
    else {
      const rect = infoGroupEl.getBoundingClientRect();
      applySeek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
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
  if (seekDrag) {
    seekDrag = false;
    document.querySelector('.yt-pb-info-group')?.classList.remove('seeking');
  }
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
  if ((changes.savedVideos || changes.playlistSession) && document.getElementById('yt-playlist-wrap'))
    checkPlaylistSession(true);
});

window.addEventListener('yt-navigate-finish', () => {
  if (!window.location.pathname.startsWith('/watch')) {
    lastVideoId = null;
    removeButton();
    // If the playlist bar was shown on this tab, this is the active playlist tab.
    // Clear the session from storage so the popup controller also disappears.
    if (document.getElementById('yt-playlist-wrap')) {
      videoEndedHandler = null;   // stale handler — video element is being replaced
      pendingPlaylistSession = null;
      chrome.storage.local.remove('playlistSession').catch(() => {});
    }
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

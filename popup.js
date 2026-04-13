import { pad, formatSyncDate, esc } from './utils/format.js';
import { videoSortFn } from './utils/sort.js';
import { debounce } from './utils/debounce.js';
import { isContextValid } from './utils/context.js';
import { fetchGistData, findExistingGist, createGist, updateGist } from './utils/gist.js';
import { fetchVideoInfo } from './utils/youtube.js';
import { findWorkingThumbnail } from './utils/thumbnail.js';
import { createFolderColumn, createDetailColumn } from './views/folderColumn.js';

window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.message?.includes('Extension context invalidated')) e.preventDefault();
});

const DEFAULT_TOMBSTONE_TTL_DAYS = 30;

let allVideos = [];
let allGroups = [];
let currentSearch = '';
let hasGithubToken = false;
let currentPlaylistSession = null;

// Miller columns navigation state: array of folder IDs being drilled into.
// columnPath[0] is always null (root). Each additional element is a selected folder ID.
let columnPath = [null];

// When set, a detail panel column is shown as the rightmost column.
let detailVideoId = null;
// The folder from which the detail panel was opened (used for folder-scoped delete).
let detailSourceFolderId = undefined;

// Multi-select state for Miller columns
let selectedItems = new Set(); // "folder:id" | "video:videoId"
let anchorItemKey = null;      // anchor for shift-range selection

// ── Channel dedup table ──────────────────────────────────────────────────────
// Stored as { id, name, avatar } where avatar has 'https://yt3.ggpht.com/' stripped.
let allChannels = [];

// Tracks how many storage writes we initiated ourselves so onChanged can skip
// the redundant re-render (each write fires onChanged which would cause scroll reset).
let ownStorageWrite = 0;

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
function findOrCreateChannel(name, avatarUrl) {
  if (!name) return null;
  const av = compressAvatar(avatarUrl);
  let ch = allChannels.find((c) => c.name === name);
  if (ch) { if (av && !ch.avatar) ch.avatar = av; return ch.id; }
  const id = allChannels.length ? Math.max(...allChannels.map((c) => c.id)) + 1 : 0;
  allChannels.push({ id, name, avatar: av });
  return id;
}
// Like hydrateVideo but uses an explicit channels table (for remote/imported data)
function hydrateVideoWith(v, channels) {
  const ch = v.channelId != null ? channels.find((c) => c.id === v.channelId) : null;
  return {
    ...v,
    channelName:   ch?.name   ?? v.channelName   ?? '',
    channelAvatar: ch         ? expandAvatar(ch.avatar) : (v.channelAvatar ?? ''),
  };
}
/**
 * Normalises any groupId shape into a clean string/null array.
 * Handles: Set, array, single value, empty, corrupt objects ({}), nested Sets.
 */
function normalizeGids(raw) {
  let arr;
  if (raw instanceof Set)       arr = [...raw];
  else if (Array.isArray(raw))  arr = raw;
  else                          arr = [raw];

  // Replace anything that isn't a non-empty string or null with null
  const cleaned = arr.map((g) => (g == null || typeof g === 'string') ? g : null);
  // Deduplicate
  const deduped = [...new Set(cleaned)];
  return deduped.length === 0 ? [null] : deduped;
}

function hydrateVideo(v) {
  const ch = v.channelId != null ? allChannels.find((c) => c.id === v.channelId) : null;
  return {
    ...v,
    groupId:       new Set(normalizeGids(v.groupId)),
    url:           `https://www.youtube.com/watch?v=${v.videoId}`,
    thumbnail:     expandThumb(v.thumbnail, v.videoId),
    channelName:   ch?.name   ?? v.channelName   ?? '',
    channelAvatar: ch         ? expandAvatar(ch.avatar) : (v.channelAvatar ?? ''),
  };
}
function stripVideo(v) {
  const groupId = normalizeGids(v.groupId);
  const result = { videoId: v.videoId, title: v.title, groupId };
  if (v.sortOrder  != null) result.sortOrder  = v.sortOrder;
  if (v.duration)           result.duration   = v.duration;
  if (v.deleted)            { result.deleted = true; result.deletedAt = v.deletedAt; }
  const thumb = compressThumb(v.thumbnail, v.videoId);
  if (thumb) result.thumbnail = thumb;
  let chId = v.channelId;
  if (chId == null && v.channelName) chId = findOrCreateChannel(v.channelName, v.channelAvatar);
  if (chId != null) result.channelId = chId;
  return result;
}

async function saveVideos() {
  ownStorageWrite++;
  await chrome.storage.local.set({ savedVideos: allVideos.map(stripVideo), channels: allChannels });
}

async function saveGroups() {
  ownStorageWrite++;
  await chrome.storage.local.set({ groups: allGroups });
}

async function loadVideos() {
  if (!isContextValid()) return;
  const result = await chrome.storage.local.get([
    'savedVideos', 'channels', 'groups', 'githubToken', 'gistId', 'gistHtmlUrl',
    'lastSyncAt', 'autoSync', 'autoSyncInterval', 'tombstoneTtlDays', 'playlistSession',
  ]);
  allChannels = result.channels || [];
  allVideos   = (result.savedVideos || []).map(hydrateVideo);
  allGroups   = result.groups || [];

  if (result.githubToken) document.getElementById('github-token').value = result.githubToken;

  const autoSync = result.autoSync || false;
  const autoSyncInterval = result.autoSyncInterval || 1;
  document.getElementById('auto-sync-toggle').checked = autoSync;
  document.getElementById('auto-sync-interval').value = String(autoSyncInterval);
  document.getElementById('auto-sync-interval-row').classList.toggle('hidden', !autoSync);
  document.getElementById('tombstone-ttl').value = String(result.tombstoneTtlDays || DEFAULT_TOMBSTONE_TTL_DAYS);

  hasGithubToken = !!result.githubToken;
  currentPlaylistSession = result.playlistSession || null;
  updateGistUrlDisplay(result.gistHtmlUrl || null);
  renderSyncLabel(result.lastSyncAt ?? null);
  render();

  if (autoSync && result.githubToken) {
    const intervalMs = autoSyncInterval * 24 * 60 * 60 * 1000;
    const lastSync = result.lastSyncAt ? new Date(result.lastSyncAt).getTime() : 0;
    if (Date.now() - lastSync >= intervalMs) syncData();
  }
}

// ── Playlist Controller ──────────────────────────────────────────────────────

let playerPollTimer    = null;
let cachedPlayerState  = { currentTime: 0, duration: 0, paused: true, volume: 1 };
let seekDragging       = false;
let volDragging        = false;
let premuteVol         = 1;   // volume saved before muting
let plctrlListOpen     = false;
let plctrlOutsideListenerAdded = false;

function fmtTime(secs) {
  const s = Math.floor(secs || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
    : `${m}:${String(sec).padStart(2,'0')}`;
}

/**
 * Send a message to the YouTube tab that owns the current playlist session.
 * Works even when that tab is in the background.
 *
 * Priority:
 *   1. The tabId stored in currentPlaylistSession (set when play started).
 *   2. Any youtube.com/watch* tab with an active content script (fallback for
 *      sessions that pre-date the tabId field, or if the original tab changed).
 */
async function sendToYouTubeTab(msg) {
  // 1. Prefer the tab that started the session
  const storedTabId = currentPlaylistSession?.tabId;
  if (storedTabId) {
    try {
      return await chrome.tabs.sendMessage(storedTabId, msg);
    } catch { /* tab closed or navigated away — fall through */ }
  }

  // 2. Fallback: try every open YouTube watch tab (most recently accessed last)
  try {
    const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/watch*' });
    // Try in reverse order so the most recently opened tab is tried first
    for (const tab of [...tabs].reverse()) {
      if (tab.id === storedTabId) continue; // already failed above
      try { return await chrome.tabs.sendMessage(tab.id, msg); } catch { }
    }
  } catch { }
  return null;
}

function startPlayerPoll() {
  if (playerPollTimer) return;
  async function poll() {
    const state = await sendToYouTubeTab({ action: 'popup-get-state' });
    if (state) {
      cachedPlayerState = state;
      updatePlayerState();
    }
  }
  poll();
  playerPollTimer = setInterval(poll, 500);
}

function stopPlayerPoll() {
  clearInterval(playerPollTimer);
  playerPollTimer = null;
}

function updateVolIcon(vol) {
  const btn = document.getElementById('plctrl-vol-icon');
  if (!btn) return;
  if (vol <= 0) {
    btn.title = '음소거 해제';
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>`;
  } else if (vol < 0.5) {
    btn.title = '음소거';
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/></svg>`;
  } else {
    btn.title = '음소거';
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;
  }
}

function updatePlayerState() {
  const { currentTime, duration, paused, volume = 1 } = cachedPlayerState;
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  const seekEl = document.getElementById('plctrl-seek');
  if (seekEl && !seekDragging) {
    seekEl.value = duration > 0 ? currentTime / duration : 0;
    seekEl.style.setProperty('--pct', pct.toFixed(3));
  }

  const timeEl = document.getElementById('plctrl-time');
  if (timeEl) timeEl.textContent = `${fmtTime(currentTime)} / ${fmtTime(duration)}`;

  const ppBtn = document.getElementById('plctrl-pp');
  if (ppBtn) {
    const isPlaying = !paused;
    ppBtn.title = isPlaying ? '일시정지' : '재생';
    ppBtn.innerHTML = isPlaying
      ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`
      : `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
  }

  const volEl = document.getElementById('plctrl-vol');
  if (volEl && !volDragging) {
    const pct = Math.round(volume * 100);
    volEl.value = volume;
    volEl.style.setProperty('--pct', pct);
    updateVolIcon(volume);
    const pctEl = document.getElementById('plctrl-vol-pct');
    if (pctEl) pctEl.textContent = pct + '%';
  }
}

function renderPlctrlTooltip() {
  const ctrl = document.getElementById('playlist-ctrl');
  if (!ctrl) return;

  ctrl.querySelector('.plctrl-pl-tooltip')?.remove();
  if (!plctrlListOpen || !currentPlaylistSession) return;

  const { videos, currentIndex } = currentPlaylistSession;
  const hasFolderNames = videos.some((v) => v.folderName);

  let html = '';
  let lastFolder;
  videos.forEach((v, i) => {
    if (hasFolderNames && v.folderName !== lastFolder) {
      html += `<div class="plctrl-pl-sep">${esc(v.folderName || '루트')}</div>`;
      lastFolder = v.folderName;
    }
    const thumb = v.thumbnail || `https://img.youtube.com/vi/${v.videoId}/mqdefault.jpg`;
    html += `
      <button class="plctrl-pl-item${i === currentIndex ? ' current' : ''}" data-idx="${i}">
        <span class="plctrl-pl-idx">${i + 1}</span>
        <img class="plctrl-pl-thumb" src="${esc(thumb)}" alt="">
        <div class="plctrl-pl-info">
          <span class="plctrl-pl-title">${esc(v.title || v.videoId)}</span>
          ${v.channelName ? `<span class="plctrl-pl-channel">${esc(v.channelName)}</span>` : ''}
        </div>
      </button>`;
  });

  const tooltip = document.createElement('div');
  tooltip.className = 'plctrl-pl-tooltip';
  tooltip.innerHTML = html;

  tooltip.querySelectorAll('.plctrl-pl-thumb').forEach((img, i) => {
    img.onerror = () => { img.src = `https://img.youtube.com/vi/${videos[i].videoId}/mqdefault.jpg`; img.onerror = null; };
  });

  tooltip.querySelectorAll('.plctrl-pl-item').forEach((item) => {
    item.addEventListener('click', () => {
      sendToYouTubeTab({ action: 'popup-navigate-to', index: parseInt(item.dataset.idx) });
      plctrlListOpen = false;
      renderPlctrlTooltip();
    });
  });

  ctrl.appendChild(tooltip);
  setTimeout(() => tooltip.querySelector('.plctrl-pl-item.current')?.scrollIntoView({ block: 'nearest' }), 0);
}

function renderPlaylistController() {
  const ctrl = document.getElementById('playlist-ctrl');
  if (!ctrl) return;

  if (!currentPlaylistSession) {
    plctrlListOpen = false;
    ctrl.innerHTML = '';
    document.documentElement.classList.remove('has-ctrl');
    document.body.classList.remove('has-ctrl');
    stopPlayerPoll();
    return;
  }

  document.documentElement.classList.add('has-ctrl');
  document.body.classList.add('has-ctrl');

  const { groupName, videos, currentIndex, repeatMode = 0 } = currentPlaylistSession;
  const video = videos[currentIndex];
  if (!video) return;

  const total = videos.length;
  const thumb = video.thumbnail || `https://img.youtube.com/vi/${video.videoId}/mqdefault.jpg`;
  const meta  = [video.folderName, video.channelName].filter(Boolean).join(' · ');

  const REPEAT_ICONS = [
    // 0 = off
    `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" opacity="0.4"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>`,
    // 1 = loop all
    `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>`,
    // 2 = loop one
    `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z"/></svg>`,
  ];
  const REPEAT_TITLES = ['반복 없음', '전체 반복', '한 곡 반복'];
  const prevDisabled = currentIndex === 0 && repeatMode !== 1 ? ' disabled' : '';
  const nextDisabled = currentIndex >= total - 1 && repeatMode !== 1 ? ' disabled' : '';

  ctrl.innerHTML = `
    <div class="plctrl">
      <div class="plctrl-info">
        <img class="plctrl-thumb" src="${esc(thumb)}" alt="" id="plctrl-thumb">
        <div class="plctrl-text">
          <span class="plctrl-title" title="${esc(video.title)}">${esc(video.title)}</span>
          ${meta ? `<span class="plctrl-meta">${esc(meta)}</span>` : ''}
        </div>
        <span class="plctrl-pos">${currentIndex + 1} / ${total}</span>
        <button class="plctrl-icon-btn${plctrlListOpen ? ' active' : ''}" id="plctrl-list" title="재생 목록">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></svg>
        </button>
        <button class="plctrl-icon-btn${repeatMode > 0 ? ' active' : ''}" id="plctrl-repeat"
                title="${REPEAT_TITLES[repeatMode]}">${REPEAT_ICONS[repeatMode]}</button>
        <button class="plctrl-icon-btn" id="plctrl-stop" title="정지">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M6 6h12v12H6z"/></svg>
        </button>
      </div>
      <div class="plctrl-progress-row">
        <input type="range" class="plctrl-seek" id="plctrl-seek" min="0" max="1" step="0.001" value="0" style="--pct:0">
        <span class="plctrl-time" id="plctrl-time">0:00 / 0:00</span>
      </div>
      <div class="plctrl-controls">
        <div class="plctrl-vol">
          <button class="plctrl-icon-btn" id="plctrl-vol-icon" title="음소거">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
          </button>
          <input type="range" class="plctrl-vol-slider" id="plctrl-vol" min="0" max="1" step="0.01" value="1" style="--pct:100">
          <span class="plctrl-vol-pct" id="plctrl-vol-pct">100%</span>
        </div>
        <div class="plctrl-playback">
          <button class="plctrl-icon-btn" id="plctrl-prev" title="이전 곡"${prevDisabled}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
          </button>
          <button class="plctrl-icon-btn" id="plctrl-rew" title="10초 뒤로">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6 8.5 6V6l-8.5 6z"/></svg>
          </button>
          <button class="plctrl-icon-btn plctrl-pp" id="plctrl-pp" title="재생">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <button class="plctrl-icon-btn" id="plctrl-fwd" title="10초 앞으로">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/></svg>
          </button>
          <button class="plctrl-icon-btn" id="plctrl-next" title="다음 곡"${nextDisabled}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zm2.5-6zM16 6h2v12h-2z"/></svg>
          </button>
        </div>
        <div class="plctrl-vol-spacer"></div>
      </div>
    </div>
  `;

  // Thumb fallback
  const thumbEl = ctrl.querySelector('#plctrl-thumb');
  if (thumbEl) {
    thumbEl.onerror = () => {
      thumbEl.src = `https://img.youtube.com/vi/${video.videoId}/mqdefault.jpg`;
      thumbEl.onerror = null;
    };
  }

  // Seek bar: update gradient on input, send seek on change/pointerup
  const seekEl = ctrl.querySelector('#plctrl-seek');
  seekEl.addEventListener('pointerdown', () => { seekDragging = true; });
  seekEl.addEventListener('input', () => {
    seekEl.style.setProperty('--pct', (parseFloat(seekEl.value) * 100).toFixed(3));
  });
  seekEl.addEventListener('pointerup', () => {
    seekDragging = false;
    sendToYouTubeTab({ action: 'popup-seek', ratio: parseFloat(seekEl.value) });
  });

  ctrl.querySelector('#plctrl-pp').addEventListener('click',
    () => sendToYouTubeTab({ action: 'popup-play-pause' }));
  ctrl.querySelector('#plctrl-prev').addEventListener('click',
    () => sendToYouTubeTab({ action: 'popup-prev' }));
  ctrl.querySelector('#plctrl-next').addEventListener('click',
    () => sendToYouTubeTab({ action: 'popup-next' }));
  ctrl.querySelector('#plctrl-rew').addEventListener('click',
    () => sendToYouTubeTab({ action: 'popup-rewind' }));
  ctrl.querySelector('#plctrl-fwd').addEventListener('click',
    () => sendToYouTubeTab({ action: 'popup-forward' }));
  ctrl.querySelector('#plctrl-stop').addEventListener('click',
    () => sendToYouTubeTab({ action: 'popup-stop' }));
  ctrl.querySelector('#plctrl-repeat').addEventListener('click',
    () => sendToYouTubeTab({ action: 'popup-repeat' }));

  // Volume slider
  const volEl = ctrl.querySelector('#plctrl-vol');
  volEl.addEventListener('pointerdown', () => { volDragging = true; });
  volEl.addEventListener('input', () => {
    const v = parseFloat(volEl.value);
    const pct = Math.round(v * 100);
    volEl.style.setProperty('--pct', pct);
    updateVolIcon(v);
    const pctEl = document.getElementById('plctrl-vol-pct');
    if (pctEl) pctEl.textContent = pct + '%';
  });
  volEl.addEventListener('pointerup', () => {
    volDragging = false;
    const v = parseFloat(volEl.value);
    if (v > 0) premuteVol = v;
    sendToYouTubeTab({ action: 'popup-volume', volume: v });
  });

  // Volume icon — toggle mute
  ctrl.querySelector('#plctrl-vol-icon').addEventListener('click', () => {
    const cur = parseFloat(document.getElementById('plctrl-vol')?.value ?? 1);
    const next = cur > 0 ? 0 : (premuteVol > 0 ? premuteVol : 1);
    if (cur > 0) premuteVol = cur;
    sendToYouTubeTab({ action: 'popup-volume', volume: next });
    // Optimistic UI update (includes pct label via updatePlayerState)
    cachedPlayerState = { ...cachedPlayerState, volume: next };
    updatePlayerState();
  });

  // Playlist list button — toggle tooltip
  ctrl.querySelector('#plctrl-list').addEventListener('click', () => {
    plctrlListOpen = !plctrlListOpen;
    // Reflect active state without full re-render
    ctrl.querySelector('#plctrl-list').classList.toggle('active', plctrlListOpen);
    renderPlctrlTooltip();
  });

  // Close tooltip when clicking outside #playlist-ctrl (registered once)
  if (!plctrlOutsideListenerAdded) {
    plctrlOutsideListenerAdded = true;
    document.addEventListener('click', (e) => {
      if (!plctrlListOpen) return;
      const ctrlEl = document.getElementById('playlist-ctrl');
      if (ctrlEl && !ctrlEl.contains(e.target)) {
        plctrlListOpen = false;
        renderPlctrlTooltip();
      }
    }, true);
  }

  // Restore last known player state into the freshly built DOM
  renderPlctrlTooltip();
  updatePlayerState();
  startPlayerPoll();
}

// ── render ────────────────────────────────────────────────────────────────────

function render() {
  updateSyncFooter(hasGithubToken);
  renderPlaylistController();
  if (currentSearch) {
    document.getElementById('miller-wrap').classList.add('hidden');
    document.getElementById('search-results').classList.remove('hidden');
    renderSearchResults();
  } else {
    document.getElementById('search-results').classList.add('hidden');
    document.getElementById('miller-wrap').classList.remove('hidden');
    renderMillerColumns();
  }
}

function renderSyncLabel(isoString) {
  const el = document.getElementById('sync-label');
  if (el) el.textContent = `마지막 동기화 : ${formatSyncDate(isoString)}`;
}

function fmtTotalDuration(secs) {
  const s = Math.floor(secs);
  if (s <= 0) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function updateTotalCount() {
  const el = document.getElementById('total-count');
  if (!el) return;

  const currentFolderId = columnPath.length > 1 ? columnPath[columnPath.length - 1] : null;

  let folderCount, videoCount, recursiveVideos;
  if (currentFolderId === null) {
    // 루트: 전체 depth 합산
    folderCount      = allGroups.filter((g) => !g.deleted && g.type !== 'separator').length;
    videoCount       = allVideos.filter((v) => !v.deleted).length;
    recursiveVideos  = allVideos.filter((v) => !v.deleted);
  } else {
    // 특정 폴더: 직접 하위 항목만 (count), 재귀 전체 (duration)
    folderCount      = allGroups.filter((g) => !g.deleted && g.type !== 'separator' && (g.parentId ?? null) === currentFolderId).length;
    videoCount       = allVideos.filter((v) => !v.deleted && v.groupId.has(currentFolderId)).length;
    recursiveVideos  = collectSessionVideos(currentFolderId);
  }

  // Deduplicate recursive list (a video may appear in both parent and child folder)
  const seen = new Set();
  const uniqueVideos = recursiveVideos.filter((v) => !seen.has(v.videoId) && seen.add(v.videoId));

  const withDuration  = uniqueVideos.filter((v) => v.duration > 0);
  const totalSecs     = withDuration.reduce((acc, v) => acc + v.duration, 0);
  const durationStr   = fmtTotalDuration(totalSecs);
  const hasUnknown    = uniqueVideos.length > withDuration.length;

  const total = folderCount + videoCount;
  let text = `총 ${total}개`;
  const countParts = [];
  if (folderCount > 0) countParts.push(`폴더 ${folderCount}개`);
  if (videoCount  > 0) countParts.push(`영상 ${videoCount}개`);
  if (countParts.length > 0) text += `  ·  ${countParts.join(', ')}`;
  if (durationStr) text += `  ·  ${hasUnknown ? '약 ' : ''}${durationStr}`;
  el.textContent = text;
}

// ── Search Results ────────────────────────────────────────────────────────────

function renderSearchResults() {
  updateTotalCount();
  const container = document.getElementById('search-results');
  container.innerHTML = '';

  const q = currentSearch.toLowerCase();
  const matched = allVideos
    .filter((v) => !v.deleted && v.title.toLowerCase().includes(q))
    .sort(videoSortFn);

  if (matched.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor" opacity="0.3">
          <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
        </svg>
        <p>검색 결과가 없습니다</p>
      </div>`;
    return;
  }

  const activeFolders = allGroups.filter((g) => !g.deleted && g.type !== 'separator');

  matched.forEach((video) => {
    const item = document.createElement('div');
    item.className = 'search-result-item video-item';
    item.dataset.id = video.videoId;

    // Build folder path for this video
    const path = buildFolderPath(video.groupId, activeFolders);

    item.innerHTML = `
      <a class="thumb-link" href="${esc(video.url)}">
        <img class="thumb" src="${esc(video.thumbnail || `https://img.youtube.com/vi/${video.videoId}/mqdefault.jpg`)}" alt="" loading="lazy">
      </a>
      <div class="video-info">
        <a class="video-title" href="${esc(video.url)}">${esc(video.title)}</a>
        <div class="video-meta">
          ${video.channelName ? `<span>${esc(video.channelName)}</span>` : ''}
          ${path ? `<span class="search-result-path" title="${esc(path)}">📁 ${esc(path)}</span>` : ''}
        </div>
      </div>
      <button class="delete-btn" data-id="${esc(video.videoId)}" title="삭제">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
          <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
      </button>
    `;
    container.appendChild(item);
  });
}

/**
 * Returns a human-readable folder path string like "음악 / 아티스트 / 넥트워크"
 */
function buildFolderPath(folderId, folders) {
  const id = folderId instanceof Set ? ([...folderId][0] ?? null) : folderId;
  if (!id) return '';
  const parts = [];
  let current = id;
  const visited = new Set();
  while (current) {
    if (visited.has(current)) break;
    visited.add(current);
    const folder = folders.find((f) => f.id === current);
    if (!folder) break;
    parts.unshift(folder.name);
    current = folder.parentId ?? null;
  }
  return parts.join(' / ');
}

// ── Miller Columns ────────────────────────────────────────────────────────────

function renderMillerColumns() {
  updateTotalCount();
  const container = document.getElementById('miller-columns');
  const breadcrumb = document.getElementById('miller-breadcrumb');

  // Save scroll positions before wiping the DOM
  const prevCols = container.querySelectorAll('.miller-col');
  const savedColScrolls = [...prevCols].map((c) => c.scrollTop);
  const savedHScroll = container.scrollLeft;
  const prevColCount = prevCols.length;

  container.innerHTML = '';

  const activeVideos = allVideos.filter((v) => !v.deleted);
  const activeFolders = allGroups.filter((g) => !g.deleted && g.type !== 'separator');

  if (activeVideos.length === 0 && activeFolders.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="flex:1">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor" opacity="0.3">
          <path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z"/>
        </svg>
        <p>저장된 영상이 없습니다</p>
        <small>YouTube에서 '직접 저장' 버튼을 눌러보세요</small>
      </div>`;
    updateBreadcrumb(breadcrumb, activeFolders);
    return;
  }

  // Prune columnPath (remove folders that no longer exist)
  columnPath = pruneColumnPath(columnPath, activeFolders);

  updateBreadcrumb(breadcrumb, activeFolders);

  // Render one column per entry in columnPath; the container scrolls horizontally
  columnPath.forEach((folderId, idx) => {
    const selectedFolderId = columnPath[idx + 1] ?? null;

    const col = createFolderColumn(
      { folderId, folders: activeFolders, videos: activeVideos, selectedFolderId, playingFolderId: currentPlaylistSession?.groupId ?? null, selectedItems, anchorItemKey },
      {
        onSelectFolder: (id) => {
          selectedItems = new Set();
          anchorItemKey = null;
          detailVideoId = null;
          detailSourceFolderId = undefined;
          columnPath = [...columnPath.slice(0, idx + 1), id];
          renderMillerColumns();
        },
        onSelectItems: (newSelected, newAnchor) => {
          selectedItems = newSelected;
          anchorItemKey = newAnchor;
          // Auto-show detail for the last-interacted video
          if (newAnchor?.startsWith('video:')) {
            detailVideoId = newAnchor.slice(6);
            detailSourceFolderId = folderId;
          } else if (![...newSelected].some(k => k.startsWith('video:'))) {
            detailVideoId = null;
            detailSourceFolderId = undefined;
          }
          renderMillerColumns();
        },
        onOpenVideo: async (url) => {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab) { chrome.tabs.create({ url }); window.close(); return; }
          if (tab.url && tab.url.includes('youtube.com/watch')) {
            // YouTube SPA navigation via content script
            chrome.tabs.sendMessage(tab.id, { action: 'yt-navigate', url });
          } else {
            chrome.tabs.update(tab.id, { url });
          }
          window.close();
        },
        onCreateFolder: (parentId) => showNewFolderInput(parentId),
        onRenameFolder: async (id, newName) => {
          if (newName) {
            const folder = allGroups.find((g) => g.id === id);
            if (folder) folder.name = newName;
            await saveGroups();
          }
          renderMillerColumns();
        },
        onDeleteFolder: (id) => deleteFolderById(id),
        onDeleteVideo: (videoId) => deleteVideo(videoId, folderId),
        onPlayFolder: (id) => playFolder(id),
        onAddVideo: (folderId) => showAddVideoDialog(folderId),
        onMoveVideo: async (videoId, sourceFolderId, targetFolderId) => {
          const video = allVideos.find((v) => v.videoId === videoId);
          if (!video || sourceFolderId === targetFolderId) return;
          video.groupId.delete(sourceFolderId);
          video.groupId.add(targetFolderId);
          if (video.groupId.size === 0) video.groupId.add(null);
          await saveVideos();
          await syncPlaylistSession();
          render();
        },
        onReorderVideo: async (draggedId, targetId, insertBefore) => {
          const dragged = allVideos.find((v) => v.videoId === draggedId);
          const target  = allVideos.find((v) => v.videoId === targetId);
          if (!dragged || !target) return;
          const fid = folderId;
          const group = allVideos.filter((v) => !v.deleted && v.groupId.has(fid)).sort(videoSortFn);
          const without = group.filter((v) => v.videoId !== draggedId);
          const ti = without.findIndex((v) => v.videoId === targetId);
          if (ti === -1) return;
          without.splice(insertBefore ? ti : ti + 1, 0, dragged);
          without.forEach((v, i) => { v.sortOrder = i; });
          await saveVideos();
          await syncPlaylistSession();
          render();
        },
        onReorderFolder: async (draggedId, targetId, insertBefore) => {
          const di = allGroups.findIndex((g) => g.id === draggedId);
          const ti = allGroups.findIndex((g) => g.id === targetId);
          if (di === -1 || ti === -1) return;
          const dragged = allGroups[di];
          const target  = allGroups[ti];
          // Keep same parent (reorder within same level)
          dragged.parentId = target.parentId ?? null;
          const [item] = allGroups.splice(di, 1);
          const newTi = allGroups.findIndex((g) => g.id === targetId);
          allGroups.splice(insertBefore ? newTi : newTi + 1, 0, item);
          await saveGroups();
          render();
        },
        onMoveFolder: async (draggedId, newParentId) => {
          if (draggedId === newParentId) return;
          if (newParentId && isFolderDescendant(draggedId, newParentId)) return;
          const folder = allGroups.find((g) => g.id === draggedId);
          if (!folder || (folder.parentId ?? null) === newParentId) return;
          folder.parentId = newParentId;
          await saveGroups();
          render();
        },
        onBatchMoveFolders: async (folderIds, targetFolderId) => {
          let changed = false;
          for (const fid of folderIds) {
            if (fid === targetFolderId) continue;
            if (targetFolderId && isFolderDescendant(fid, targetFolderId)) continue;
            const folder = allGroups.find((g) => g.id === fid);
            if (folder && (folder.parentId ?? null) !== targetFolderId) {
              folder.parentId = targetFolderId;
              changed = true;
            }
          }
          if (!changed) return;
          await saveGroups();
          selectedItems = new Set(); anchorItemKey = null;
          render();
        },
        onBatchMoveVideos: async (videoIds, sourceFolderId, targetFolderId) => {
          let changed = false;
          for (const vid of videoIds) {
            const video = allVideos.find((v) => v.videoId === vid);
            if (video && sourceFolderId !== targetFolderId) {
              video.groupId.delete(sourceFolderId);
              video.groupId.add(targetFolderId);
              if (video.groupId.size === 0) video.groupId.add(null);
              changed = true;
            }
          }
          if (!changed) return;
          await saveVideos();
          await syncPlaylistSession();
          selectedItems = new Set(); anchorItemKey = null;
          render();
        },
        onBatchReorderFolders: async (draggedIds, targetId, insertBefore) => {
          const target = allGroups.find((g) => g.id === targetId);
          if (!target) return;
          const targetParentId = target.parentId ?? null;
          const draggedSet = new Set(draggedIds);
          draggedIds.forEach((id) => {
            const f = allGroups.find((g) => g.id === id);
            if (f) f.parentId = targetParentId;
          });
          // Remove all dragged items preserving their relative order
          const dragged = [];
          for (let i = allGroups.length - 1; i >= 0; i--) {
            if (draggedSet.has(allGroups[i].id)) dragged.unshift(allGroups.splice(i, 1)[0]);
          }
          dragged.sort((a, b) => draggedIds.indexOf(a.id) - draggedIds.indexOf(b.id));
          const ti = allGroups.findIndex((g) => g.id === targetId);
          allGroups.splice(ti === -1 ? allGroups.length : (insertBefore ? ti : ti + 1), 0, ...dragged);
          await saveGroups();
          selectedItems = new Set(); anchorItemKey = null;
          render();
        },
        onBatchReorderVideos: async (draggedIds, targetId, insertBefore) => {
          const target = allVideos.find((v) => v.videoId === targetId);
          if (!target) return;
          const fid = folderId;
          const draggedSet = new Set(draggedIds);
          const group = allVideos.filter((v) => !v.deleted && v.groupId.has(fid)).sort(videoSortFn);
          const dragged = group.filter((v) => draggedSet.has(v.videoId));
          const without = group.filter((v) => !draggedSet.has(v.videoId));
          const ti = without.findIndex((v) => v.videoId === targetId);
          if (ti === -1) return;
          without.splice(insertBefore ? ti : ti + 1, 0, ...dragged);
          without.forEach((v, i) => { v.sortOrder = i; });
          await saveVideos();
          await syncPlaylistSession();
          selectedItems = new Set(); anchorItemKey = null;
          render();
        },
        onFocusColumn: () => {
          // Close all columns/detail deeper than this column
          const needsTrim = columnPath.length > idx + 1;
          const needsCloseDetail = !!detailVideoId;
          if (needsTrim || needsCloseDetail) {
            if (needsTrim) columnPath = columnPath.slice(0, idx + 1);
            detailVideoId = null;
            selectedItems = new Set();
            anchorItemKey = null;
            renderMillerColumns();
          }
        },
      },
    );

    container.appendChild(col);
  });

  // Detail column — shown when a video's "상세 정보 보기" is active
  if (detailVideoId) {
    const video = allVideos.find((v) => v.videoId === detailVideoId && !v.deleted);
    if (video) {
      const detailCol = createDetailColumn(video, activeFolders, {
        onClose: () => { detailVideoId = null; detailSourceFolderId = undefined; renderMillerColumns(); },
      });
      container.appendChild(detailCol);
    } else {
      detailVideoId = null;
    }
  }

  // Restore per-column vertical scroll; horizontal scroll only expands when a new column appears
  requestAnimationFrame(() => {
    container.querySelectorAll('.miller-col').forEach((col, i) => {
      if (savedColScrolls[i] !== undefined) col.scrollTop = savedColScrolls[i];
    });
    const newColCount = container.querySelectorAll('.miller-col').length;
    container.scrollLeft = newColCount > prevColCount ? container.scrollWidth : savedHScroll;
  });
}

function pruneColumnPath(path, activeFolders) {
  const validIds = new Set(activeFolders.map((f) => f.id));
  const result = [null];
  for (let i = 1; i < path.length; i++) {
    if (validIds.has(path[i])) result.push(path[i]);
    else break;
  }
  return result;
}

function updateBreadcrumb(el, activeFolders) {
  el.innerHTML = '';

  const rootSpan = document.createElement('span');
  rootSpan.className = 'miller-breadcrumb-item' + (columnPath.length === 1 ? ' active' : '');
  rootSpan.textContent = '루트';
  rootSpan.addEventListener('click', () => { columnPath = [null]; renderMillerColumns(); });
  el.appendChild(rootSpan);

  for (let i = 1; i < columnPath.length; i++) {
    const sep = document.createElement('span');
    sep.className = 'miller-breadcrumb-sep';
    sep.textContent = '›';
    el.appendChild(sep);

    const folder = activeFolders.find((f) => f.id === columnPath[i]);
    const crumb = document.createElement('span');
    crumb.className = 'miller-breadcrumb-item' + (i === columnPath.length - 1 ? ' active' : '');
    crumb.textContent = folder ? folder.name : '(삭제됨)';
    const idx = i;
    crumb.addEventListener('click', () => { columnPath = columnPath.slice(0, idx + 1); renderMillerColumns(); });
    el.appendChild(crumb);
  }
}

/**
 * Shows a custom confirmation dialog.
 * @param {string} message - Body text
 * @param {function} onConfirm - Called when user clicks confirm
 * @param {{ confirmLabel?: string, danger?: boolean }} [opts]
 */
function showConfirmDialog(message, onConfirm, { confirmLabel = '확인', danger = false } = {}) {
  document.getElementById('confirm-dialog')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'confirm-dialog';
  overlay.className = 'add-video-overlay';
  overlay.innerHTML = `
    <div class="add-video-modal">
      <div class="add-video-header">확인</div>
      <div class="add-video-body">
        <p class="confirm-dialog-msg">${esc(message)}</p>
      </div>
      <div class="add-video-footer">
        <button class="add-video-btn cancel">취소</button>
        <button class="add-video-btn confirm${danger ? ' danger' : ''}">${esc(confirmLabel)}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  function close() { overlay.remove(); }

  overlay.querySelector('.cancel').addEventListener('click', close);
  overlay.querySelector('.confirm').addEventListener('click', () => { close(); onConfirm(); });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter') { close(); onConfirm(); }
  });
  overlay.querySelector('.confirm').focus();
}

/**
 * Shows a modal dialog for creating a new folder inside parentId.
 */
function showNewFolderInput(parentId) {
  document.getElementById('new-folder-dialog')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'new-folder-dialog';
  overlay.className = 'add-video-overlay';
  overlay.innerHTML = `
    <div class="add-video-modal">
      <div class="add-video-header">새 폴더 만들기</div>
      <div class="add-video-body">
        <input class="add-video-input" id="new-folder-name" placeholder="폴더 이름" autocomplete="off">
      </div>
      <div class="add-video-footer">
        <button class="add-video-btn cancel">취소</button>
        <button class="add-video-btn confirm">만들기</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  const nameInput = overlay.querySelector('#new-folder-name');
  nameInput.focus();

  function close() { overlay.remove(); }

  overlay.querySelector('.cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  async function doCreate() {
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    const { groups = [] } = await chrome.storage.local.get('groups');
    groups.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      name,
      parentId,
      createdAt: Date.now(),
    });
    ownStorageWrite++;
    await chrome.storage.local.set({ groups });
    allGroups = groups;
    close();
    render();
  }

  overlay.querySelector('.confirm').addEventListener('click', doCreate);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  doCreate();
    if (e.key === 'Escape') close();
  });
}

// ── Add Video Dialog ──────────────────────────────────────────────────────────

function isFolderDescendant(ancestorId, checkId) {
  let cur = checkId;
  const seen = new Set();
  while (cur) {
    if (seen.has(cur)) break;
    seen.add(cur);
    if (cur === ancestorId) return true;
    const f = allGroups.find((g) => g.id === cur);
    cur = f ? (f.parentId ?? null) : null;
  }
  return false;
}

function extractVideoId(url) {
  if (!url) return null;
  url = url.trim();
  // ?v= or &v=
  let m = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  // youtu.be/ID
  m = url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  // /shorts/ or /embed/ or /live/
  m = url.match(/youtube\.com\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  // bare 11-char ID
  m = url.match(/^([A-Za-z0-9_-]{11})$/);
  if (m) return m[1];
  return null;
}

function showAddVideoDialog(folderId) {
  document.getElementById('add-video-dialog')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'add-video-dialog';
  overlay.className = 'add-video-overlay';
  overlay.innerHTML = `
    <div class="add-video-modal">
      <div class="add-video-header">영상 추가</div>
      <div class="add-video-body">
        <input class="add-video-input" id="add-video-url"   placeholder="YouTube URL 또는 영상 ID" autocomplete="off">
        <input class="add-video-input" id="add-video-title" placeholder="제목 (비워두면 ID로 저장)">
      </div>
      <div class="add-video-footer">
        <button class="add-video-btn cancel">취소</button>
        <button class="add-video-btn confirm">추가</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.querySelector('#add-video-url').focus();

  const urlInput   = overlay.querySelector('#add-video-url');
  const titleInput = overlay.querySelector('#add-video-title');

  function close() { overlay.remove(); }

  overlay.querySelector('.cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  async function doAdd() {
    const rawUrl = urlInput.value.trim();
    const videoId = extractVideoId(rawUrl);

    if (!videoId) {
      urlInput.classList.add('input-error');
      urlInput.focus();
      return;
    }

    // Normalise URL
    const url = `https://www.youtube.com/watch?v=${videoId}`;

    // Deduplicate
    if (allVideos.find((v) => v.videoId === videoId && !v.deleted)) {
      urlInput.classList.add('input-error');
      urlInput.title = '이미 저장된 영상입니다';
      urlInput.focus();
      return;
    }

    const title = titleInput.value.trim() || `YouTube 영상 (${videoId})`;

    allVideos.push({
      videoId,
      url,
      title,
      thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
      channelName: '',
      channelAvatar: '',
      groupId: new Set([folderId ?? null]),
    });

    await saveVideos();
    await syncPlaylistSession();
    close();
    render();
  }

  overlay.querySelector('.confirm').addEventListener('click', doAdd);
  urlInput.addEventListener('input', () => urlInput.classList.remove('input-error'));
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  doAdd();
    if (e.key === 'Escape') close();
  });
  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  doAdd();
    if (e.key === 'Escape') close();
  });
}

async function deleteFolderById(id) {
  if (!allGroups.find((g) => g.id === id)) return;

  // ── 1. Collect every folder ID to delete (target + all descendants) ──────
  const toDelete = new Set();
  function collectAll(fid) {
    toDelete.add(fid);
    allGroups
      .filter((g) => !g.deleted && (g.parentId ?? null) === fid)
      .forEach((child) => collectAll(child.id));
  }
  collectAll(id);

  // ── 2. Mark all collected folders as deleted ──────────────────────────────
  const now = new Date().toISOString();
  allGroups.forEach((g) => {
    if (toDelete.has(g.id)) { g.deleted = true; g.deletedAt = now; }
  });

  // ── 3. Remove all deleted folder IDs from every video's groupId ───────────
  allVideos.forEach((v) => {
    if (v.deleted) return;
    let changed = false;
    toDelete.forEach((fid) => {
      if (v.groupId.has(fid)) { v.groupId.delete(fid); changed = true; }
    });
    if (changed && v.groupId.size === 0) {
      // Video belonged only to deleted folders → fully delete it
      v.deleted = true;
      v.deletedAt = now;
    }
  });

  // ── 4. Trim columnPath if the deleted folder (or a descendant) was open ───
  const trimIdx = columnPath.findIndex((fid) => toDelete.has(fid));
  if (trimIdx !== -1) columnPath = columnPath.slice(0, trimIdx);

  ownStorageWrite++;
  await chrome.storage.local.set({ groups: allGroups, savedVideos: allVideos.map(stripVideo) });
  render();
}

// Depth-first video collector for a folder tree — used by playFolder and syncPlaylistSession
function collectSessionVideos(fid) {
  const f = allGroups.find((g) => g.id === fid);
  const fname = f ? f.name : '';
  const direct = allVideos.filter((v) => !v.deleted && v.groupId.has(fid)).sort(videoSortFn);
  const result = direct.map((v) => ({ ...v, folderName: fname }));
  const children = allGroups.filter((g) => !g.deleted && g.type !== 'separator' && (g.parentId ?? null) === fid);
  children.forEach((child) => result.push(...collectSessionVideos(child.id)));
  return result;
}

function sessionVideoEntry(v) {
  return { videoId: v.videoId, url: v.url, title: v.title,
           thumbnail: v.thumbnail, channelName: v.channelName,
           channelAvatar: v.channelAvatar, folderName: v.folderName };
}

async function syncPlaylistSession() {
  if (!currentPlaylistSession?.groupId) return;
  const folderId = currentPlaylistSession.groupId;
  if (!allGroups.find((g) => g.id === folderId && !g.deleted)) return;

  // Re-read from storage to get the latest currentIndex (content script may have advanced it)
  let latestSession;
  try {
    ({ playlistSession: latestSession } = await chrome.storage.local.get('playlistSession'));
  } catch { return; }
  if (!latestSession || latestSession.groupId !== folderId) return;

  const collected = collectSessionVideos(folderId);
  if (collected.length === 0) {
    currentPlaylistSession = null;
    await chrome.storage.local.remove('playlistSession');
    return;
  }

  // Find the currently-playing video in the new list; fall back to nearest valid index
  const currentVideoId = latestSession.videos[latestSession.currentIndex]?.videoId;
  let newIndex = collected.findIndex((v) => v.videoId === currentVideoId);
  if (newIndex === -1) newIndex = Math.min(latestSession.currentIndex, collected.length - 1);

  const newSession = { ...latestSession, videos: collected.map(sessionVideoEntry), currentIndex: Math.max(0, newIndex) };
  currentPlaylistSession = newSession;
  await chrome.storage.local.set({ playlistSession: newSession });
}

async function playFolder(folderId) {
  const folder = allGroups.find((g) => g.id === folderId);
  if (!folder) return;

  const collected = collectSessionVideos(folderId);
  if (collected.length === 0) return;

  // 1. If a playlist is already running, reuse its tab so we don't open a new
  //    page or clobber an unrelated tab with YouTube.
  let targetTab = null;
  const existingTabId = currentPlaylistSession?.tabId ?? null;
  if (existingTabId) {
    try { targetTab = await chrome.tabs.get(existingTabId); } catch { /* tab closed */ }
  }

  // 2. Fall back to the popup's active tab.
  if (!targetTab) {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    targetTab = activeTab ?? null;
  }

  const session = {
    groupId: folderId,
    groupName: folder.name,
    tabId: targetTab?.id ?? null,
    videos: collected.map(sessionVideoEntry),
    currentIndex: 0,
  };
  await chrome.storage.local.set({ playlistSession: session });
  currentPlaylistSession = session;

  if (!targetTab) { chrome.tabs.create({ url: collected[0].url }); window.close(); return; }

  if (targetTab.url?.includes('youtube.com/watch')) {
    chrome.tabs.sendMessage(targetTab.id, { action: 'yt-navigate', url: collected[0].url });
  } else {
    chrome.tabs.update(targetTab.id, { url: collected[0].url });
  }

  // If the playlist tab was in the background, bring it into view.
  if (existingTabId && targetTab.id === existingTabId) {
    chrome.tabs.update(targetTab.id, { active: true });
  }

  window.close();
}

async function deleteVideo(videoId, fromFolderId) {
  const video = allVideos.find((v) => v.videoId === videoId);
  if (!video) return;
  if (fromFolderId !== undefined) {
    // Folder-scoped: only remove this folder from the video's groupId.
    // Fully delete only when no folders remain.
    video.groupId.delete(fromFolderId);
    if (video.groupId.size === 0) {
      video.deleted = true;
      video.deletedAt = new Date().toISOString();
    }
  } else {
    // No folder context (e.g. search results) → full delete.
    video.deleted = true;
    video.deletedAt = new Date().toISOString();
  }
  await saveVideos();
  await syncPlaylistSession();
  render();
}

function buildExportPayload(videos, groups, channels) {
  return { savedVideos: videos.map(stripVideo), groups, channels: channels || [] };
}

function exportJSON() {
  const data = JSON.stringify(buildExportPayload(allVideos, allGroups, allChannels), null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const d = new Date();
  a.download = `yt-saved-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importJSON(file) {
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    let importedVideos, importedGroups, importedChannels;
    if (Array.isArray(parsed)) {
      importedVideos = parsed; importedGroups = []; importedChannels = [];
    } else if (parsed && Array.isArray(parsed.savedVideos)) {
      importedVideos  = parsed.savedVideos;
      importedGroups  = Array.isArray(parsed.groups)   ? parsed.groups   : [];
      importedChannels = Array.isArray(parsed.channels) ? parsed.channels : [];
    } else {
      throw new Error('지원하지 않는 파일 형식입니다.');
    }

    // Merge imported channels into allChannels (dedup by name) and build id remap
    const importIdToLocal = new Map();
    for (const ch of importedChannels) {
      if (!ch.name) continue;
      const localId = findOrCreateChannel(ch.name, ch.avatar ? expandAvatar(ch.avatar) : '');
      importIdToLocal.set(ch.id, localId);
    }

    // Remap imported video channelIds to local ids, then hydrate+strip to normalise
    const remapped = importedVideos.map((v) => ({
      ...v,
      channelId: importIdToLocal.has(v.channelId) ? importIdToLocal.get(v.channelId) : v.channelId,
    }));

    const existingVideoIds = new Set(allVideos.map((v) => v.videoId));
    const newRaw = remapped.filter((v) => v.videoId && !existingVideoIds.has(v.videoId));
    const newVideos = newRaw.map(hydrateVideo);

    allVideos = [...allVideos, ...newVideos];
    const existingGroupIds = new Set(allGroups.map((g) => g.id));
    const newGroups = importedGroups.filter((g) => g.id && !existingGroupIds.has(g.id));
    allGroups = [...allGroups, ...newGroups];

    await chrome.storage.local.set({
      savedVideos: allVideos.map(stripVideo),
      channels:    allChannels,
      groups:      allGroups,
    });
    render();
    const skipped = importedVideos.length - newVideos.length;
    alert(`완료! 영상 ${newVideos.length}개, 재생목록 ${newGroups.length}개 추가됨` +
      (skipped > 0 ? ` (중복 영상 ${skipped}개 건너뜀)` : ''));
  } catch (e) {
    alert('가져오기 실패: ' + e.message);
  }
}

function updateSyncFooter(hasKeys) {
  document.getElementById('refresh-btn').classList.toggle('hidden', !hasKeys);
  document.getElementById('force-sync-btn').classList.toggle('hidden', !hasKeys);
  document.getElementById('sync-label').classList.toggle('hidden', !hasKeys);
}

function updateGistUrlDisplay(htmlUrl) {
  const row = document.getElementById('gist-url-row');
  if (!row) return;
  if (htmlUrl) {
    const link = document.getElementById('gist-url-link');
    link.href = htmlUrl;
    link.textContent = htmlUrl.replace('https://', '');
    row.classList.remove('hidden');
  } else {
    row.classList.add('hidden');
  }
}

async function syncData() {
  if (!isContextValid()) return;
  const { githubToken, gistId, gistHtmlUrl, tombstoneTtlDays } = await chrome.storage.local.get(['githubToken', 'gistId', 'gistHtmlUrl', 'tombstoneTtlDays']);

  if (!githubToken) {
    const result = await chrome.storage.local.get(['savedVideos', 'groups']);
    allVideos = result.savedVideos || [];
    allGroups = result.groups || [];
    render();
    return;
  }

  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;
  document.getElementById('sync-indicator').classList.remove('hidden');

  try {
    let remoteVideos = [];
    let remoteGroups = [];
    let remoteChannels = [];
    let currentGistId = gistId || null;

    if (currentGistId) {
      try {
        const remote = await fetchGistData(githubToken, currentGistId);
        remoteVideos   = remote.savedVideos || [];
        remoteGroups   = remote.groups      || [];
        remoteChannels = remote.channels    || [];
      } catch {
        currentGistId = null;
      }
    }

    if (!currentGistId) {
      try {
        const existing = await findExistingGist(githubToken);
        if (existing) {
          currentGistId = existing.id;
          await chrome.storage.local.set({ gistId: currentGistId, gistHtmlUrl: existing.htmlUrl });
          const remote = await fetchGistData(githubToken, currentGistId);
          remoteVideos   = remote.savedVideos || [];
          remoteGroups   = remote.groups      || [];
          remoteChannels = remote.channels    || [];
        }
      } catch {
        // 기존 gist 탐색 실패 시 새로 생성
      }
    }

    // Merge remote channels into allChannels (dedup by name) and build id remap
    const remoteIdToLocal = new Map();
    for (const ch of remoteChannels) {
      if (!ch.name) continue;
      const localId = findOrCreateChannel(ch.name, ch.avatar ? expandAvatar(ch.avatar) : '');
      remoteIdToLocal.set(ch.id, localId);
    }
    // Remap remote video channelIds to local ids
    remoteVideos = remoteVideos.map((v) => ({
      ...v,
      channelId: remoteIdToLocal.has(v.channelId) ? remoteIdToLocal.get(v.channelId) : v.channelId,
    }));

    const isoNow = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const now = Date.now();
    const tombstoneTtlMs = (tombstoneTtlDays || DEFAULT_TOMBSTONE_TTL_DAYS) * 24 * 60 * 60 * 1000;

    const videoMap = new Map();
    for (const v of allVideos) videoMap.set(v.videoId, { ...v });
    for (const v of remoteVideos) {
      if (videoMap.has(v.videoId)) {
        const loc = videoMap.get(v.videoId);
        if (loc.deleted || v.deleted) {
          videoMap.set(v.videoId, {
            ...loc,
            deleted: true,
            deletedAt: loc.deletedAt || v.deletedAt || isoNow,
          });
        }
      } else {
        videoMap.set(v.videoId, { ...v });
      }
    }

    const groupMap = new Map();
    for (const g of allGroups) groupMap.set(g.id, { ...g });
    for (const g of remoteGroups) {
      if (groupMap.has(g.id)) {
        const loc = groupMap.get(g.id);
        if (loc.deleted || g.deleted) {
          groupMap.set(g.id, {
            ...loc,
            deleted: true,
            deletedAt: loc.deletedAt || g.deletedAt || isoNow,
          });
        }
      } else {
        groupMap.set(g.id, { ...g });
      }
    }

    const deletedGroupIds = new Set([...groupMap.values()].filter((g) => g.deleted).map((g) => g.id));
    const allMergedVideos = [...videoMap.values()]
      .map((v) => {
        const groupArr = v.groupId instanceof Set
          ? [...v.groupId]
          : (Array.isArray(v.groupId) ? v.groupId : [v.groupId ?? null]);
        const cleaned = [...new Set(groupArr.map((gid) => deletedGroupIds.has(gid) ? null : gid))];
        return { ...v, groupId: cleaned };
      });

    const finalVideos = allMergedVideos.filter((v) => !v.deleted).map(stripVideo);
    const finalGroups = [...groupMap.values()].filter((g) => !g.deleted);

    // gist에는 30일 이내 tombstone을 포함해 다른 기기가 삭제 사실을 알 수 있게 함
    const videoTombstones = allMergedVideos
      .filter((v) => v.deleted && v.deletedAt && (now - new Date(v.deletedAt).getTime()) < tombstoneTtlMs)
      .map(stripVideo);
    const groupTombstones = [...groupMap.values()]
      .filter((g) => g.deleted && g.deletedAt && (now - new Date(g.deletedAt).getTime()) < tombstoneTtlMs);

    allGroups = finalGroups;
    allVideos = finalVideos.map(hydrateVideo);
    await chrome.storage.local.set({ savedVideos: finalVideos, channels: allChannels, groups: finalGroups, lastSyncAt: isoNow });

    const gistPayload = buildExportPayload([...finalVideos, ...videoTombstones], [...finalGroups, ...groupTombstones], allChannels);
    let newHtmlUrl = gistHtmlUrl || null;
    if (currentGistId) {
      newHtmlUrl = await updateGist(githubToken, currentGistId, gistPayload);
      await chrome.storage.local.set({ gistHtmlUrl: newHtmlUrl });
    } else {
      const created = await createGist(githubToken, gistPayload);
      currentGistId = created.id;
      newHtmlUrl = created.htmlUrl;
      await chrome.storage.local.set({ gistId: currentGistId, gistHtmlUrl: newHtmlUrl });
    }

    updateGistUrlDisplay(newHtmlUrl);
    renderSyncLabel(isoNow);

    render();
  } catch (e) {
    alert('동기화 실패: ' + e.message);
  } finally {
    btn.disabled = false;
    document.getElementById('sync-indicator').classList.add('hidden');
  }
}

async function forceSyncData() {
  if (!isContextValid()) return;
  const { githubToken, gistId, gistHtmlUrl } = await chrome.storage.local.get(['githubToken', 'gistId', 'gistHtmlUrl']);
  if (!githubToken) return;

  const btn = document.getElementById('force-sync-btn');
  btn.disabled = true;
  document.getElementById('sync-indicator').classList.remove('hidden');

  try {
    const isoNow = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const payload = buildExportPayload(allVideos, allGroups, allChannels);
    let currentGistId = gistId || null;
    let newHtmlUrl = gistHtmlUrl || null;

    if (currentGistId) {
      newHtmlUrl = await updateGist(githubToken, currentGistId, payload);
      await chrome.storage.local.set({ gistHtmlUrl: newHtmlUrl });
    } else {
      const created = await createGist(githubToken, payload);
      currentGistId = created.id;
      newHtmlUrl = created.htmlUrl;
      await chrome.storage.local.set({ gistId: currentGistId, gistHtmlUrl: newHtmlUrl });
    }

    await chrome.storage.local.set({ lastSyncAt: isoNow });
    updateGistUrlDisplay(newHtmlUrl);
    renderSyncLabel(isoNow);
  } catch (e) {
    alert('강제 동기화 실패: ' + e.message);
  } finally {
    btn.disabled = false;
    document.getElementById('sync-indicator').classList.add('hidden');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadVideos();

  const searchEl = document.getElementById('search');
  const clearSearch = document.getElementById('clear-search');
  const debouncedRender = debounce(() => render(), 100);

  searchEl.addEventListener('input', (e) => {
    currentSearch = e.target.value;
    clearSearch.classList.toggle('hidden', !currentSearch);
    debouncedRender();
  });

  clearSearch.addEventListener('click', () => {
    searchEl.value = '';
    currentSearch = '';
    clearSearch.classList.add('hidden');
    render();
    searchEl.focus();
  });

  // Unified click handler for both Miller columns and search results
  document.getElementById('content-area').addEventListener('click', (e) => {
    const delBtn = e.target.closest('.delete-btn');
    if (delBtn) { deleteVideo(delBtn.dataset.id); return; }

    const link = e.target.closest('.video-title, .thumb-link, .miller-video-title');
    if (link) {
      e.preventDefault();
      const url = link.href;
      chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (tab) chrome.tabs.update(tab.id, { url });
        else chrome.tabs.create({ url });
      });
    }
  });

  document.getElementById('refresh-btn').addEventListener('click', () => {
    showConfirmDialog('원격 데이터와 병합 동기화하시겠습니까?', syncData);
  });

  document.getElementById('force-sync-btn').addEventListener('click', () => {
    showConfirmDialog(
      '현재 로컬 데이터로 원격을 덮어씌웁니다.\n원격의 변경 사항은 사라집니다.',
      forceSyncData,
      { confirmLabel: '덮어쓰기', danger: true },
    );
  });

  document.getElementById('settings-btn').addEventListener('click', () => {
    document.getElementById('settings-panel').classList.remove('hidden');
  });

  const closeSettings = () => document.getElementById('settings-panel').classList.add('hidden');

  document.getElementById('settings-close').addEventListener('click', closeSettings);

  document.getElementById('settings-panel').addEventListener('click', (e) => {
    if (e.target === document.getElementById('settings-panel')) closeSettings();
  });

  document.getElementById('export-btn').addEventListener('click', exportJSON);

  document.getElementById('import-btn').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });

  document.getElementById('import-file').addEventListener('change', (e) => {
    if (e.target.files[0]) importJSON(e.target.files[0]);
    e.target.value = '';
  });

  document.getElementById('github-token-save').addEventListener('click', async () => {
    const token = document.getElementById('github-token').value.trim();
    if (!token) {
      await chrome.storage.local.set({ githubToken: '', gistId: '', gistHtmlUrl: '' });
      hasGithubToken = false;
      updateGistUrlDisplay(null);
      render();
      alert('GitHub 설정이 초기화되었습니다.');
      return;
    }
    await chrome.storage.local.set({ githubToken: token });
    hasGithubToken = true;
    const { gistHtmlUrl } = await chrome.storage.local.get('gistHtmlUrl');
    updateGistUrlDisplay(gistHtmlUrl || null);
    render();
    alert('저장되었습니다.');
  });

  document.getElementById('auto-sync-toggle').addEventListener('change', async (e) => {
    await chrome.storage.local.set({ autoSync: e.target.checked });
    document.getElementById('auto-sync-interval-row').classList.toggle('hidden', !e.target.checked);
  });

  document.getElementById('auto-sync-interval').addEventListener('change', async (e) => {
    await chrome.storage.local.set({ autoSyncInterval: parseInt(e.target.value) });
  });

  document.getElementById('tombstone-ttl').addEventListener('change', async (e) => {
    await chrome.storage.local.set({ tombstoneTtlDays: parseInt(e.target.value) });
  });

  /**
   * Quick-checks whether a stored thumbnail URL is valid (not a 120×90 placeholder, not broken).
   * Only loads image dimensions — fast, no full download needed.
   */
  function checkThumbValid(url) {
    return new Promise((resolve) => {
      if (!url) return resolve(false);
      const img = new Image();
      img.onload  = () => resolve(img.naturalWidth > 120 || img.naturalHeight > 90);
      img.onerror = () => resolve(false);
      img.src = url;
    });
  }

  document.getElementById('update-data-btn').addEventListener('click', async () => {
    const btn = document.getElementById('update-data-btn');
    btn.disabled = true;
    try {
      const active = allVideos.filter((v) => !v.deleted);
      let updatedCount = 0;

      for (let i = 0; i < active.length; i++) {
        const video = active[i];
        btn.textContent = `확인 중... (${i + 1} / ${active.length})`;

        const needsInfo  = !video.channelName || !video.channelAvatar || !video.duration;
        const thumbValid = await checkThumbValid(video.thumbnail);
        const needsThumb = !thumbValid;

        if (!needsInfo && !needsThumb) continue;

        btn.textContent = `업데이트 중... (${i + 1} / ${active.length})`;

        const [info, bestThumb] = await Promise.all([
          needsInfo  ? fetchVideoInfo(video.videoId)       : Promise.resolve(null),
          needsThumb ? findWorkingThumbnail(video.videoId) : Promise.resolve(null),
        ]);

        let changed = false;
        if (info) {
          if (info.title    && info.title    !== video.title)    { video.title    = info.title;    changed = true; }
          if (info.duration && info.duration !== video.duration) { video.duration = info.duration; changed = true; }
          if (info.channelName || info.channelAvatar) {
            const newId = findOrCreateChannel(info.channelName || video.channelName, info.channelAvatar || video.channelAvatar);
            if (newId !== video.channelId) { video.channelId = newId; changed = true; }
            video.channelName   = info.channelName   || video.channelName;
            video.channelAvatar = info.channelAvatar || video.channelAvatar;
          }
        }
        if (bestThumb && bestThumb !== video.thumbnail) { video.thumbnail = bestThumb; changed = true; }
        if (changed) updatedCount++;

        await new Promise((r) => setTimeout(r, 400));
      }

      await saveVideos();
      render();

      btn.textContent = updatedCount > 0 ? `완료 (${updatedCount}개 업데이트)` : '이미 최신 상태';
      setTimeout(() => { btn.disabled = false; btn.textContent = '저장된 데이터 업데이트'; }, 3000);
    } catch {
      btn.textContent = '오류 발생';
      setTimeout(() => { btn.disabled = false; btn.textContent = '저장된 데이터 업데이트'; }, 2000);
    }
  });

  document.getElementById('migrate-data-btn').addEventListener('click', async () => {
    const btn = document.getElementById('migrate-data-btn');
    btn.disabled = true;
    try {
      const { savedVideos: raw = [], channels: existingChannels = [], groups: rawGroups = [] }
        = await chrome.storage.local.get(['savedVideos', 'channels', 'groups']);

      // ── 1. Remove separators from groups ────────────────────────────────────
      const cleanedGroups = rawGroups.filter((g) => g.type !== 'separator');
      const separatorCount = rawGroups.length - cleanedGroups.length;

      // ── 2. Cascade-delete folders whose parent is deleted or missing ─────────
      // Repeat until no more changes so multi-level orphans are handled correctly.
      const migNow = new Date().toISOString();
      const validFolderIds = new Set(cleanedGroups.filter((g) => !g.deleted).map((g) => g.id));
      let cascadeChanged = true;
      let orphanedFolders = 0;
      while (cascadeChanged) {
        cascadeChanged = false;
        for (const g of cleanedGroups) {
          if (g.deleted) continue;
          if (g.parentId != null && !validFolderIds.has(g.parentId)) {
            g.deleted    = true;
            g.deletedAt  = migNow;
            validFolderIds.delete(g.id);
            cascadeChanged = true;
            orphanedFolders++;
          }
        }
      }

      // ── 3. Build channels table ─────────────────────────────────────────────
      const channels = existingChannels.map((c) => ({ ...c }));
      function findOrCreate(name, avatarUrl) {
        if (!name) return null;
        const av = (avatarUrl || '').startsWith(YT_AVATAR_PFX) ? avatarUrl.slice(YT_AVATAR_PFX.length) : (avatarUrl || '');
        let ch = channels.find((c) => c.name === name);
        if (ch) { if (av && !ch.avatar) ch.avatar = av; return ch.id; }
        const id = channels.length ? Math.max(...channels.map((c) => c.id)) + 1 : 0;
        channels.push({ id, name, avatar: av });
        return id;
      }

      // ── 4. Merge duplicate videoId entries + compress fields ─────────────────
      // First pass: merge groupIds of duplicate entries (old format had 1 entry per folder)
      const videoById = new Map();
      for (const v of raw) {
        if (videoById.has(v.videoId)) {
          const existing = videoById.get(v.videoId);
          const existGids = normalizeGids(existing.groupId);
          const newGids   = normalizeGids(v.groupId);
          existing.groupId = [...new Set([...existGids, ...newGids])];
        } else {
          videoById.set(v.videoId, { ...v });
        }
      }
      const merged = [...videoById.values()];
      const duplicatesRemoved = raw.length - merged.length;

      // Second pass: compress / normalise every entry
      // (Always run — handles legacy string thumbnail codes, duplicate groupId arrays, corrupt {}, etc.)
      let compressedCount = 0;
      const migrated = merged.map((v) => {
        const gidArr  = normalizeGids(v.groupId);
        const thumb   = compressThumb(v.thumbnail, v.videoId);
        const chId    = v.channelId ?? findOrCreate(v.channelName, v.channelAvatar);

        const result = { videoId: v.videoId, title: v.title, groupId: gidArr, savedAt: v.savedAt };
        if (v.sortOrder  != null) result.sortOrder  = v.sortOrder;
        if (v.duration)           result.duration   = v.duration;
        if (v.deleted)            { result.deleted = true; result.deletedAt = v.deletedAt; }
        if (thumb != null)        result.thumbnail  = thumb;
        if (chId  != null)        result.channelId  = chId;

        const changed = v.channelName != null || v.url != null || v.uploadDate != null
          || thumb !== v.thumbnail || !Array.isArray(v.groupId);
        if (changed) compressedCount++;
        return result;
      });

      // ── 5. Strip deleted folder IDs from video groupIds ──────────────────────
      const deletedFolderIds = new Set(cleanedGroups.filter((g) => g.deleted).map((g) => g.id));
      let strippedVideos = 0;
      if (deletedFolderIds.size > 0) {
        for (const v of migrated) {
          if (v.deleted) continue;
          const before = v.groupId.length;
          v.groupId = v.groupId.filter((gid) => gid === null || !deletedFolderIds.has(gid));
          if (v.groupId.length === 0) v.groupId = [null]; // fall back to root
          if (v.groupId.length !== before) strippedVideos++;
        }
      }

      // ── 6. Save ─────────────────────────────────────────────────────────────
      await chrome.storage.local.set({ savedVideos: migrated, channels, groups: cleanedGroups });
      allChannels = channels;
      allVideos   = migrated.map(hydrateVideo);
      allGroups   = cleanedGroups;
      render();

      const parts = [];
      if (compressedCount > 0)   parts.push(`영상 ${compressedCount}개 압축`);
      if (duplicatesRemoved > 0) parts.push(`중복 ${duplicatesRemoved}개 제거`);
      if (separatorCount > 0)    parts.push(`구분선 ${separatorCount}개 제거`);
      if (orphanedFolders > 0)   parts.push(`고아 폴더 ${orphanedFolders}개 제거`);
      if (strippedVideos > 0)    parts.push(`영상 groupId ${strippedVideos}개 정리`);
      btn.textContent = parts.length > 0 ? `완료 (${parts.join(', ')})` : '이미 최신 구조';
      setTimeout(() => { btn.disabled = false; btn.textContent = '데이터 구조 마이그레이션'; }, 3000);
    } catch {
      btn.textContent = '오류 발생';
      setTimeout(() => { btn.disabled = false; btn.textContent = '데이터 구조 마이그레이션'; }, 2000);
    }
  });

  document.getElementById('purge-deleted-btn').addEventListener('click', () => {
    showConfirmDialog(
      'soft-delete 상태인 폴더와 영상을 스토리지에서 영구 제거합니다.\n이 작업은 되돌릴 수 없습니다.',
      async () => {
        const btn = document.getElementById('purge-deleted-btn');
        btn.disabled = true;
        try {
          const beforeGroups = allGroups.length;
          const beforeVideos = allVideos.length;

          allGroups = allGroups.filter((g) => !g.deleted);
          allVideos = allVideos.filter((v) => !v.deleted);

          const removedGroups = beforeGroups - allGroups.length;
          const removedVideos = beforeVideos - allVideos.length;

          ownStorageWrite++;
          await chrome.storage.local.set({
            groups:      allGroups,
            savedVideos: allVideos.map(stripVideo),
            channels:    allChannels,
          });
          columnPath = [null];
          detailVideoId = null;
          detailSourceFolderId = undefined;
          selectedItems = new Set();
          anchorItemKey = null;
          render();

          const parts = [];
          if (removedGroups > 0) parts.push(`폴더 ${removedGroups}개`);
          if (removedVideos > 0) parts.push(`영상 ${removedVideos}개`);
          btn.textContent = parts.length > 0 ? `완료 (${parts.join(', ')} 제거)` : '제거할 데이터 없음';
        } catch {
          btn.textContent = '오류 발생';
        }
        setTimeout(() => { btn.disabled = false; btn.textContent = 'soft-delete 데이터 영구 제거'; }, 3000);
      },
      { confirmLabel: '영구 제거', danger: true },
    );
  });

  document.getElementById('clear-local-btn').addEventListener('click', () => {
    showConfirmDialog(
      '저장된 모든 데이터를 삭제합니다.\n이 작업은 되돌릴 수 없습니다.',
      async () => {
        await chrome.storage.local.remove(['savedVideos', 'groups', 'channels', 'lastSyncAt']);
        allVideos = [];
        allGroups = [];
        allChannels = [];
        columnPath = [null];
        renderSyncLabel(null);
        updateGistUrlDisplay(null);
        render();
      },
      { confirmLabel: '삭제', danger: true },
    );
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (!isContextValid()) return;
    // channels must be updated before savedVideos so hydrateVideo resolves channelIds correctly
    if (changes.channels)      allChannels = changes.channels.newValue || [];
    if (changes.savedVideos)   allVideos   = (changes.savedVideos.newValue || []).map(hydrateVideo);
    if (changes.groups)        allGroups   = changes.groups.newValue || [];
    if (changes.playlistSession !== undefined) currentPlaylistSession = changes.playlistSession.newValue || null;
    if (changes.savedVideos || changes.groups || changes.playlistSession) {
      // Suppress re-render for our own writes — we already call render() after saveVideos/saveGroups.
      // This prevents the double-render that resets column scroll positions after DnD.
      if (ownStorageWrite > 0) { ownStorageWrite--; return; }
      render();
    }
  });
});

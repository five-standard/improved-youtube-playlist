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

let allVideos = [];
let allGroups = [];
let currentSearch = '';
const collapsedSections = new Set();
let hasGithubToken = false;
let currentPlaylistSession = null;

// ─── Storage ───────────────────────────────────────────────────────────────

function formatSyncDate(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} · ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function renderSyncLabel(isoString) {
  const el = document.getElementById('sync-label');
  if (el) el.textContent = `마지막 동기화 : ${formatSyncDate(isoString)}`;
}

async function loadVideos() {
  if (!isContextValid()) return;
  const result = await chrome.storage.local.get(['savedVideos', 'groups', 'githubToken', 'gistId', 'gistHtmlUrl', 'lastSyncAt', 'autoSync', 'autoSyncInterval', 'collapsedSections', 'playlistSession']);
  allVideos = result.savedVideos || [];
  allGroups = result.groups || [];
  if (result.collapsedSections) {
    collapsedSections.clear();
    result.collapsedSections.forEach((k) => collapsedSections.add(k));
  }

  if (result.githubToken) document.getElementById('github-token').value = result.githubToken;

  const autoSync = result.autoSync || false;
  const autoSyncInterval = result.autoSyncInterval || 1;
  document.getElementById('auto-sync-toggle').checked = autoSync;
  document.getElementById('auto-sync-interval').value = String(autoSyncInterval);
  document.getElementById('auto-sync-interval-row').classList.toggle('hidden', !autoSync);

  hasGithubToken = !!result.githubToken;
  currentPlaylistSession = result.playlistSession || null;
  updateGistUrlDisplay(result.gistHtmlUrl || null);
  renderSyncLabel(result.lastSyncAt ?? null);
  render();

  // Auto-sync check
  if (autoSync && result.githubToken) {
    const intervalMs = autoSyncInterval * 24 * 60 * 60 * 1000;
    const lastSync = result.lastSyncAt ? new Date(result.lastSyncAt).getTime() : 0;
    if (Date.now() - lastSync >= intervalMs) syncData();
  }
}

async function saveVideos() {
  await chrome.storage.local.set({ savedVideos: allVideos });
}

// ─── Render ────────────────────────────────────────────────────────────────

function getFilteredVideos() {
  const active = allVideos.filter((v) => !v.deleted);
  if (!currentSearch) return active;
  const q = currentSearch.toLowerCase();
  return active.filter((v) => v.title.toLowerCase().includes(q));
}

function render() {
  updateSyncFooter(hasGithubToken);
  renderVideos();
}

function updateTotalCount() {
  const el = document.getElementById('total-count');
  if (el) el.textContent = `총 ${allVideos.filter((v) => !v.deleted).length}개`;
}

function renderVideos() {
  updateTotalCount();
  const container = document.getElementById('video-list');
  container.innerHTML = '';

  const filtered = getFilteredVideos();
  const activeGroups = allGroups.filter((g) => !g.deleted);
  const validGroupIds = new Set(activeGroups.map((g) => g.id));

  // True empty: no active videos and no active groups defined
  if (allVideos.filter((v) => !v.deleted).length === 0 && activeGroups.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor" opacity="0.3">
          <path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z"/>
        </svg>
        <p>저장된 영상이 없습니다</p>
        <small>YouTube에서 '직접 저장' 버튼을 눌러보세요</small>
      </div>`;
    return;
  }

  // Build sections
  const sections = [];

  // Ungrouped: show if any active video is ungrouped
  const hasUngroupedTotal = allVideos.some((v) => !v.deleted && (!v.groupId || !validGroupIds.has(v.groupId)));
  if (hasUngroupedTotal) {
    const ungroupedFiltered = filtered.filter((v) => !v.groupId || !validGroupIds.has(v.groupId));
    sections.push({ label: '재생목록 없음', groupId: null, videos: ungroupedFiltered });
  }

  // All defined playlists — when searching, skip playlists with no results
  activeGroups.forEach((group) => {
    const gv = filtered.filter((v) => v.groupId === group.id);
    if (!currentSearch || gv.length > 0) {
      sections.push({ label: group.name, groupId: group.id, videos: gv });
    }
  });

  // If searching and nothing matched at all, show no-results state
  if (currentSearch && sections.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor" opacity="0.3">
          <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
        </svg>
        <p>검색 결과가 없습니다</p>
      </div>`;
    return;
  }

  sections.forEach(({ label, groupId, videos }) => {
    const sectionKey = groupId ?? 'null';
    const isCollapsed = collapsedSections.has(sectionKey);

    const section = document.createElement('div');
    section.className = 'playlist-section';
    section.dataset.groupId = groupId ?? '';

    // Header
    const isPlaying = !!(groupId && currentPlaylistSession?.groupId === groupId);
    const header = document.createElement('div');
    header.className = 'playlist-header';
    header.innerHTML = `
      ${groupId ? `<span class="playlist-drag-handle" title="드래그로 순서 변경">
        <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor">
          <circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/>
          <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
          <circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
        </svg>
      </span>` : ''}
      <svg class="playlist-chevron${isCollapsed ? '' : ' open'}" viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
        <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
      </svg>
      <span class="playlist-label">${esc(label)}</span>
      <span class="playlist-count">${videos.length}개</span>
      ${isPlaying ? '<span class="playlist-now-playing">재생 중</span>' : ''}
      ${groupId ? `
      <div class="playlist-btn-group">
        ${isPlaying
          ? `<button class="playlist-stop-btn" title="재생 종료">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
              </svg>
            </button>`
          : `<button class="playlist-play-btn" title="재생">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </button>`}
        <button class="playlist-rename-btn" title="이름 변경">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
          </svg>
        </button>
        <button class="playlist-delete-btn" title="재생목록 삭제">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
        </button>
      </div>` : ''}
    `;
    header.addEventListener('click', () => {
      collapsedSections.has(sectionKey)
        ? collapsedSections.delete(sectionKey)
        : collapsedSections.add(sectionKey);
      chrome.storage.local.set({ collapsedSections: [...collapsedSections] });
      renderVideos();
    });
    if (groupId) {
      if (isPlaying) {
        header.querySelector('.playlist-stop-btn').addEventListener('click', async (e) => {
          e.stopPropagation();
          await chrome.storage.local.remove('playlistSession');
          currentPlaylistSession = null;
          render();
        });
      } else {
        header.querySelector('.playlist-play-btn').addEventListener('click', async (e) => {
          e.stopPropagation();
          const grp = allGroups.find((g) => g.id === groupId);
          if (!grp) return;

          const groupVideos = allVideos
            .filter((v) => !v.deleted && v.groupId === groupId)
            .sort(videoSortFn);
          if (groupVideos.length === 0) return;

          const session = {
            groupId,
            groupName: grp.name,
            videos: groupVideos.map((v) => ({ videoId: v.videoId, url: v.url, title: v.title, thumbnail: v.thumbnail, channelName: v.channelName, channelAvatar: v.channelAvatar })),
            currentIndex: 0,
          };
          await chrome.storage.local.set({ playlistSession: session });
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab) chrome.tabs.update(tab.id, { url: groupVideos[0].url });
          else chrome.tabs.create({ url: groupVideos[0].url });
        });
      }

      header.querySelector('.playlist-rename-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const labelEl = header.querySelector('.playlist-label');
        const grp = allGroups.find((g) => g.id === groupId);
        if (!grp) return;

        const input = document.createElement('input');
        input.className = 'playlist-rename-input';
        input.value = grp.name;
        labelEl.replaceWith(input);
        input.focus();
        input.select();

        async function confirm() {
          const newName = input.value.trim();
          if (newName && newName !== grp.name) {
            grp.name = newName;
            await chrome.storage.local.set({ groups: allGroups });
          }
          render();
        }

        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter')  { e.stopPropagation(); input.blur(); }
          if (e.key === 'Escape') { e.stopPropagation(); render(); }
        });
        input.addEventListener('blur', confirm);
        input.addEventListener('click', (e) => e.stopPropagation());
      });

      header.querySelector('.playlist-delete-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        const grp = allGroups.find((g) => g.id === groupId);
        if (grp) grp.deleted = true;
        allVideos.forEach((v) => { if (v.groupId === groupId) v.groupId = null; });
        collapsedSections.delete(sectionKey);
        await chrome.storage.local.set({ groups: allGroups, savedVideos: allVideos, collapsedSections: [...collapsedSections] });
        render();
      });

      // Group drag — only the handle initiates the drag
      const dragHandle = header.querySelector('.playlist-drag-handle');
      dragHandle.addEventListener('mousedown', () => { header.draggable = true; });
      header.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/group-id', groupId);
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => section.classList.add('group-dragging'), 0);
      });
      header.addEventListener('dragend', () => {
        header.draggable = false;
        section.classList.remove('group-dragging');
        document.querySelectorAll('.playlist-section.drag-group-above, .playlist-section.drag-group-below')
          .forEach((el) => el.classList.remove('drag-group-above', 'drag-group-below'));
      });
    }
    section.appendChild(header);

    // Drag and drop (works even when collapsed)
    section.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer.types.includes('text/group-id')) {
        if (!groupId) return; // 미분류 섹션은 그룹 정렬 대상 아님
        const headerRect = header.getBoundingClientRect();
        const isAbove = e.clientY < headerRect.top + headerRect.height / 2;
        document.querySelectorAll('.playlist-section.drag-group-above, .playlist-section.drag-group-below')
          .forEach((el) => el.classList.remove('drag-group-above', 'drag-group-below'));
        section.classList.add(isAbove ? 'drag-group-above' : 'drag-group-below');
        e.dataTransfer.dropEffect = 'move';
      } else {
        e.dataTransfer.dropEffect = 'move';
        section.classList.add('drag-over');
      }
    });
    section.addEventListener('dragleave', (e) => {
      if (!section.contains(e.relatedTarget)) {
        section.classList.remove('drag-over', 'drag-group-above', 'drag-group-below');
      }
    });
    section.addEventListener('drop', async (e) => {
      e.preventDefault();
      section.classList.remove('drag-over', 'drag-group-above', 'drag-group-below');

      const draggedGroupId = e.dataTransfer.getData('text/group-id');
      if (draggedGroupId) {
        if (!groupId || draggedGroupId === groupId) return;
        const headerRect = header.getBoundingClientRect();
        const insertBefore = e.clientY < headerRect.top + headerRect.height / 2;
        const active = allGroups.filter((g) => !g.deleted);
        const dragged = active.find((g) => g.id === draggedGroupId);
        if (!dragged) return;
        const without = active.filter((g) => g.id !== draggedGroupId);
        const targetIdx = without.findIndex((g) => g.id === groupId);
        if (targetIdx === -1) return;
        without.splice(insertBefore ? targetIdx : targetIdx + 1, 0, dragged);
        allGroups = [...without, ...allGroups.filter((g) => g.deleted)];
        await chrome.storage.local.set({ groups: allGroups });
        render();
        return;
      }

      const videoId = e.dataTransfer.getData('text/plain');
      const video = allVideos.find((v) => v.videoId === videoId);
      if (!video || video.groupId === (groupId ?? null)) return;
      video.groupId = groupId ?? null;
      await saveVideos();
      render();
    });

    // Body (only when expanded)
    if (!isCollapsed) {
      if (videos.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'section-empty';
        empty.textContent = currentSearch ? '검색 결과 없음' : '저장된 영상이 없습니다';
        section.appendChild(empty);
      } else {
        const sorted = [...videos].sort(videoSortFn);
        sorted.forEach((video, idx) => {
          const item = createVideoItem(video, idx + 1);

          // Item-level dragover: show above/below indicator
          item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            const rect = item.getBoundingClientRect();
            const isAbove = e.clientY < rect.top + rect.height / 2;
            document.querySelectorAll('.video-item.drag-above, .video-item.drag-below')
              .forEach((el) => el.classList.remove('drag-above', 'drag-below'));
            item.classList.add(isAbove ? 'drag-above' : 'drag-below');
          });

          // Item-level drop: reorder within same group, or move to group
          item.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            document.querySelectorAll('.video-item.drag-above, .video-item.drag-below')
              .forEach((el) => el.classList.remove('drag-above', 'drag-below'));

            const videoId = e.dataTransfer.getData('text/plain');
            if (videoId === video.videoId) return;
            const draggedVideo = allVideos.find((v) => v.videoId === videoId);
            if (!draggedVideo) return;

            const targetGroupId = groupId ?? null;
            const isSameGroup = (draggedVideo.groupId ?? null) === targetGroupId;

            if (isSameGroup) {
              // Reorder within group
              const rect = item.getBoundingClientRect();
              const insertBefore = e.clientY < rect.top + rect.height / 2;

              const groupVideos = allVideos
                .filter((v) => !v.deleted && (v.groupId ?? null) === targetGroupId)
                .sort(videoSortFn);

              const without = groupVideos.filter((v) => v.videoId !== videoId);
              const targetIdx = without.findIndex((v) => v.videoId === video.videoId);
              const insertIdx = insertBefore ? targetIdx : targetIdx + 1;
              without.splice(insertIdx, 0, draggedVideo);
              without.forEach((v, i) => { v.sortOrder = i; });
            } else {
              // Move to this group
              draggedVideo.groupId = targetGroupId;
            }

            await saveVideos();
            render();
          });

          section.appendChild(item);
        });
      }
    }

    container.appendChild(section);
  });

  // ── "재생목록 만들기" footer ──
  const createWrap = document.createElement('div');
  createWrap.className = 'playlist-create-wrap';

  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'playlist-create-toggle';
  toggleBtn.textContent = '재생목록 만들기';

  const form = document.createElement('div');
  form.className = 'playlist-create-form hidden';

  const input = document.createElement('input');
  input.className = 'playlist-create-input';
  input.placeholder = '재생목록 이름...';

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'playlist-create-confirm';
  confirmBtn.textContent = '만들기';

  form.appendChild(input);
  form.appendChild(confirmBtn);
  createWrap.appendChild(toggleBtn);
  createWrap.appendChild(form);
  container.appendChild(createWrap);

  toggleBtn.addEventListener('click', () => {
    const isHidden = form.classList.toggle('hidden');
    if (!isHidden) input.focus();
  });

  async function doCreate() {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    const { groups = [] } = await chrome.storage.local.get('groups');
    const newGroup = { id: Date.now().toString(36) + Math.random().toString(36).slice(2), name, createdAt: Date.now() };
    groups.push(newGroup);
    await chrome.storage.local.set({ groups });
    allGroups = groups;
    render();
  }

  confirmBtn.addEventListener('click', doCreate);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doCreate(); });
}

function videoSortFn(a, b) {
  if (a.sortOrder != null && b.sortOrder != null) return a.sortOrder - b.sortOrder;
  if (a.sortOrder != null) return -1;
  if (b.sortOrder != null) return 1;
  return b.savedAt - a.savedAt;
}

function createVideoItem(video, idx) {
  const item = document.createElement('div');
  item.className = 'video-item';
  item.dataset.id = video.videoId;
  item.draggable = true;

  const channelHtml = video.channelName
    ? `<a class="channel-link" href="${esc(video.channelUrl || '#')}" target="_blank">${esc(video.channelName)}</a>`
    : '';

  const uploadDateStr = (() => {
    if (video.uploadDate) {
      const d = new Date(video.uploadDate);
      if (!isNaN(d.getTime())) return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
    }
    const d = new Date(video.savedAt);
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
  })();

  const metaHtml = channelHtml ? `${channelHtml} · ${uploadDateStr}` : uploadDateStr;

  item.innerHTML = `
    <span class="video-index">${idx}</span>
    <a class="thumb-link" href="${video.url}" target="_blank">
      <img class="thumb" src="${video.thumbnail}" alt="" loading="lazy"
        onerror="this.src='data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'160\\' height=\\'90\\'><rect fill=\\'%23333\\'/><text x=\\'50%25\\' y=\\'50%25\\' fill=\\'%23666\\' font-size=\\'12\\' text-anchor=\\'middle\\' dy=\\'.3em\\'>No Thumbnail</text></svg>'">
    </a>
    <div class="video-info">
      <a class="video-title" href="${video.url}" target="_blank">${esc(video.title)}</a>
      <div class="video-meta">${metaHtml}</div>
    </div>
    <button class="delete-btn" data-id="${video.videoId}" title="삭제">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
      </svg>
    </button>
  `;

  item.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', video.videoId);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => item.classList.add('dragging'), 0);
  });
  item.addEventListener('dragend', () => {
    item.classList.remove('dragging');
    document.querySelectorAll('.video-item.drag-above, .video-item.drag-below')
      .forEach((el) => el.classList.remove('drag-above', 'drag-below'));
  });

  return item;
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function esc(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function deleteVideo(videoId) {
  const video = allVideos.find((v) => v.videoId === videoId);
  if (video) video.deleted = true;
  await saveVideos();
  render();
}

// ─── Export / Import ───────────────────────────────────────────────────────

function exportJSON() {
  const data = JSON.stringify({ savedVideos: allVideos, groups: allGroups }, null, 2);
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

    // Support both { savedVideos, groups } object and legacy plain array
    let importedVideos, importedGroups;
    if (Array.isArray(parsed)) {
      importedVideos = parsed;
      importedGroups = [];
    } else if (parsed && Array.isArray(parsed.savedVideos)) {
      importedVideos = parsed.savedVideos;
      importedGroups = Array.isArray(parsed.groups) ? parsed.groups : [];
    } else {
      throw new Error('지원하지 않는 파일 형식입니다.');
    }

    // Merge videos
    const existingVideoIds = new Set(allVideos.map((v) => v.videoId));
    const newVideos = importedVideos.filter((v) => v.videoId && !existingVideoIds.has(v.videoId));
    allVideos = [...allVideos, ...newVideos];

    // Merge groups
    const existingGroupIds = new Set(allGroups.map((g) => g.id));
    const newGroups = importedGroups.filter((g) => g.id && !existingGroupIds.has(g.id));
    allGroups = [...allGroups, ...newGroups];

    await chrome.storage.local.set({ savedVideos: allVideos, groups: allGroups });
    render();

    const skippedVideos = importedVideos.length - newVideos.length;
    alert(`완료! 영상 ${newVideos.length}개, 재생목록 ${newGroups.length}개 추가됨` +
      (skippedVideos > 0 ? ` (중복 영상 ${skippedVideos}개 건너뜀)` : ''));
  } catch (e) {
    alert('가져오기 실패: ' + e.message);
  }
}

// ─── GitHub Gist / Sync ────────────────────────────────────────────────────

const GIST_FILENAME = 'ytls_data.json';

function updateSyncFooter(hasKeys) {
  document.getElementById('refresh-btn').classList.toggle('hidden', !hasKeys);
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

async function fetchGistData(token, gistId) {
  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const gist = await res.json();
  const file = gist.files[GIST_FILENAME];
  if (!file) throw new Error('Gist 파일을 찾을 수 없습니다');
  if (file.truncated) {
    const rawRes = await fetch(file.raw_url, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!rawRes.ok) throw new Error(`HTTP ${rawRes.status}`);
    return JSON.parse(await rawRes.text());
  }
  return JSON.parse(file.content);
}

async function createGist(token, data) {
  const res = await fetch('https://api.github.com/gists', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      description: 'YTLS_DATA',
      public: false,
      files: { [GIST_FILENAME]: { content: JSON.stringify(data) } },
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
  return { id: json.id, htmlUrl: json.html_url };
}

async function updateGist(token, gistId, data) {
  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      files: { [GIST_FILENAME]: { content: JSON.stringify(data) } },
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
  return json.html_url;
}

async function syncData() {
  if (!isContextValid()) return;
  const { githubToken, gistId, gistHtmlUrl } = await chrome.storage.local.get(['githubToken', 'gistId', 'gistHtmlUrl']);

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
    // 1. Fetch remote data
    let remoteVideos = [];
    let remoteGroups = [];
    let currentGistId = gistId || null;

    if (currentGistId) {
      try {
        const remote = await fetchGistData(githubToken, currentGistId);
        remoteVideos = remote.savedVideos || [];
        remoteGroups = remote.groups || [];
      } catch {
        currentGistId = null; // gist gone — treat remote as empty
      }
    }

    // 2. Merge videos: union by videoId, deleted flag wins
    const videoMap = new Map();
    for (const v of allVideos) videoMap.set(v.videoId, { ...v });
    for (const v of remoteVideos) {
      if (videoMap.has(v.videoId)) {
        const loc = videoMap.get(v.videoId);
        if (loc.deleted || v.deleted) videoMap.set(v.videoId, { ...loc, deleted: true });
      } else {
        videoMap.set(v.videoId, { ...v });
      }
    }

    // 3. Merge groups: union by id, deleted flag wins
    const groupMap = new Map();
    for (const g of allGroups) groupMap.set(g.id, { ...g });
    for (const g of remoteGroups) {
      if (groupMap.has(g.id)) {
        const loc = groupMap.get(g.id);
        if (loc.deleted || g.deleted) groupMap.set(g.id, { ...loc, deleted: true });
      } else {
        groupMap.set(g.id, { ...g });
      }
    }

    // 4. Hard-delete: strip deleted groups & videos, ungroup orphans
    const deletedGroupIds = new Set([...groupMap.values()].filter((g) => g.deleted).map((g) => g.id));
    const finalVideos = [...videoMap.values()]
      .map((v) => (deletedGroupIds.has(v.groupId) ? { ...v, groupId: null } : v))
      .filter((v) => !v.deleted);
    const finalGroups = [...groupMap.values()].filter((g) => !g.deleted);

    // 5. Persist clean data locally
    allVideos = finalVideos;
    allGroups = finalGroups;
    const isoNow = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    await chrome.storage.local.set({ savedVideos: finalVideos, groups: finalGroups, lastSyncAt: isoNow });

    // 6. Create or update gist
    let newHtmlUrl = gistHtmlUrl || null;
    if (currentGistId) {
      newHtmlUrl = await updateGist(githubToken, currentGistId, { savedVideos: finalVideos, groups: finalGroups });
      await chrome.storage.local.set({ gistHtmlUrl: newHtmlUrl });
    } else {
      const created = await createGist(githubToken, { savedVideos: finalVideos, groups: finalGroups });
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

// ─── Event Listeners ───────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadVideos();

  // Search
  const searchEl = document.getElementById('search');
  const clearSearch = document.getElementById('clear-search');

  const debouncedRender = debounce(() => renderVideos(), 100);

  searchEl.addEventListener('input', (e) => {
    currentSearch = e.target.value;
    clearSearch.classList.toggle('hidden', !currentSearch);
    debouncedRender();
  });

  clearSearch.addEventListener('click', () => {
    searchEl.value = '';
    currentSearch = '';
    clearSearch.classList.add('hidden');
    renderVideos();
    searchEl.focus();
  });

  // Video list delegation
  document.getElementById('video-list').addEventListener('click', (e) => {
    const delBtn = e.target.closest('.delete-btn');
    if (delBtn) { deleteVideo(delBtn.dataset.id); return; }

    const link = e.target.closest('.video-title, .thumb-link');
    if (link) {
      e.preventDefault();
      const url = link.href;

      if (e.shiftKey) {
        // Shift+click: start playlist from this video's group position
        const item = link.closest('.video-item');
        const videoId = item?.dataset.id;
        const video = videoId ? allVideos.find((v) => v.videoId === videoId) : null;
        if (video?.groupId) {
          const grp = allGroups.find((g) => g.id === video.groupId);
          if (grp) {
            const groupVideos = allVideos
              .filter((v) => !v.deleted && v.groupId === video.groupId)
              .sort(videoSortFn);
            const currentIndex = groupVideos.findIndex((v) => v.videoId === videoId);
            if (currentIndex !== -1) {
              chrome.storage.local.set({
                playlistSession: {
                  groupId: video.groupId,
                  groupName: grp.name,
                  videos: groupVideos.map((v) => ({ videoId: v.videoId, url: v.url, title: v.title, thumbnail: v.thumbnail, channelName: v.channelName, channelAvatar: v.channelAvatar })),
                  currentIndex,
                },
              });
            }
          }
        }
      }

      chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (tab) chrome.tabs.update(tab.id, { url });
        else chrome.tabs.create({ url });
      });
    }
  });

  // Refresh
  document.getElementById('refresh-btn').addEventListener('click', syncData);

  // Settings panel
  document.getElementById('settings-btn').addEventListener('click', () => {
    document.getElementById('settings-panel').classList.remove('hidden');
    document.getElementById('video-list').style.overflow = 'hidden';
  });

  document.getElementById('settings-close').addEventListener('click', () => {
    document.getElementById('settings-panel').classList.add('hidden');
    document.getElementById('video-list').style.overflow = '';
  });

  // Export / Import
  document.getElementById('export-btn').addEventListener('click', exportJSON);

  document.getElementById('import-btn').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });

  document.getElementById('import-file').addEventListener('change', (e) => {
    if (e.target.files[0]) importJSON(e.target.files[0]);
    e.target.value = '';
  });

  // GitHub token
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

  // Auto-sync settings
  document.getElementById('auto-sync-toggle').addEventListener('change', async (e) => {
    const checked = e.target.checked;
    await chrome.storage.local.set({ autoSync: checked });
    document.getElementById('auto-sync-interval-row').classList.toggle('hidden', !checked);
  });

  document.getElementById('auto-sync-interval').addEventListener('change', async (e) => {
    await chrome.storage.local.set({ autoSyncInterval: parseInt(e.target.value) });
  });

  // Update missing data (channelAvatar, etc.) by fetching YouTube pages
  async function fetchChannelAvatar(videoId) {
    try {
      const resp = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
      if (!resp.ok) return null;
      const html = await resp.text();

      // YouTube escapes "/" as "\/" inside JSON embedded in <script> tags,
      // so yt3.ggpht.com URLs appear as "https:\/\/yt3.ggpht.com\/..."
      // Match both escaped and unescaped variants.
      const SEP = '(?:\\\\/|/)'; // matches \/ or /
      const avatarRe = new RegExp(
        `"url":"(https:${SEP}${SEP}yt3\\.ggpht\\.com${SEP}[^"]+)"`,
      );

      // Prefer the URL closest to "videoOwnerRenderer" (= video uploader's avatar)
      const ownerIdx = html.indexOf('"videoOwnerRenderer"');
      if (ownerIdx !== -1) {
        const slice = html.slice(ownerIdx, ownerIdx + 3000);
        const m = slice.match(avatarRe);
        if (m) return m[1].replace(/\\\//g, '/');
      }

      // Fallback: first yt3.ggpht.com URL anywhere in the page
      const m2 = html.match(avatarRe);
      return m2 ? m2[1].replace(/\\\//g, '/') : null;
    } catch {
      return null;
    }
  }

  document.getElementById('update-data-btn').addEventListener('click', async () => {
    const btn = document.getElementById('update-data-btn');
    btn.disabled = true;

    try {
      const { savedVideos = [] } = await chrome.storage.local.get('savedVideos');
      const missing = savedVideos.filter((v) => !v.channelAvatar);

      if (missing.length === 0) {
        btn.textContent = '이미 최신 상태';
        setTimeout(() => { btn.disabled = false; btn.textContent = '저장된 데이터 업데이트'; }, 2000);
        return;
      }

      let updated = 0;
      for (let i = 0; i < missing.length; i++) {
        btn.textContent = `업데이트 중... (${i + 1} / ${missing.length})`;
        const avatar = await fetchChannelAvatar(missing[i].videoId);
        if (avatar) {
          const idx = savedVideos.findIndex((v) => v.videoId === missing[i].videoId);
          if (idx !== -1) { savedVideos[idx].channelAvatar = avatar; updated++; }
        }
        // Small delay between requests
        if (i < missing.length - 1) await new Promise((r) => setTimeout(r, 300));
      }

      await chrome.storage.local.set({ savedVideos });
      allVideos = savedVideos;
      btn.textContent = `완료 (${updated} / ${missing.length}개 업데이트)`;
      setTimeout(() => { btn.disabled = false; btn.textContent = '저장된 데이터 업데이트'; }, 3000);
    } catch {
      btn.textContent = '오류 발생';
      setTimeout(() => { btn.disabled = false; btn.textContent = '저장된 데이터 업데이트'; }, 2000);
    }
  });

  // Clear local data (hard-delete, for debugging)
  document.getElementById('clear-local-btn').addEventListener('click', async () => {
    await chrome.storage.local.remove(['savedVideos', 'groups', 'collapsedSections', 'lastSyncAt']);
    allVideos = [];
    allGroups = [];
    collapsedSections.clear();
    renderSyncLabel(null);
    updateGistUrlDisplay(null);
    render();
  });

  // Storage change listener (e.g., saved from content script)
  chrome.storage.onChanged.addListener((changes) => {
    if (!isContextValid()) return;
    if (changes.savedVideos) allVideos = changes.savedVideos.newValue || [];
    if (changes.groups) allGroups = changes.groups.newValue || [];
    if (changes.playlistSession !== undefined) currentPlaylistSession = changes.playlistSession.newValue || null;
    if (changes.savedVideos || changes.groups || changes.playlistSession) render();
  });
});

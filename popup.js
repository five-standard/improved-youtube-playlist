import { pad, formatSyncDate } from './utils/format.js';
import { videoSortFn } from './utils/sort.js';
import { debounce } from './utils/debounce.js';
import { isContextValid } from './utils/context.js';
import { fetchGistData, createGist, updateGist } from './utils/gist.js';
import { fetchChannelAvatar } from './utils/youtube.js';
import { findWorkingThumbnail } from './utils/thumbnail.js';
import { createPlaylistSection, createGroupSeparator } from './views/playlistSection.js';

window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.message?.includes('Extension context invalidated')) e.preventDefault();
});

let allVideos = [];
let allGroups = [];
let currentSearch = '';
const collapsedSections = new Set();
let hasGithubToken = false;
let currentPlaylistSession = null;

function stripVideo({ savedAt, tags, ...rest }) { return rest; }

async function saveVideos() {
  await chrome.storage.local.set({ savedVideos: allVideos.map(stripVideo) });
}

async function loadVideos() {
  if (!isContextValid()) return;
  const result = await chrome.storage.local.get([
    'savedVideos', 'groups', 'githubToken', 'gistId', 'gistHtmlUrl',
    'lastSyncAt', 'autoSync', 'autoSyncInterval', 'collapsedSections', 'playlistSession',
  ]);
  allVideos = (result.savedVideos || []).map(stripVideo);
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

  if (autoSync && result.githubToken) {
    const intervalMs = autoSyncInterval * 24 * 60 * 60 * 1000;
    const lastSync = result.lastSyncAt ? new Date(result.lastSyncAt).getTime() : 0;
    if (Date.now() - lastSync >= intervalMs) syncData();
  }
}

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

function renderSyncLabel(isoString) {
  const el = document.getElementById('sync-label');
  if (el) el.textContent = `마지막 동기화 : ${formatSyncDate(isoString)}`;
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
  const validGroupIds = new Set(activeGroups.filter((g) => g.type !== 'separator').map((g) => g.id));

  if (allVideos.filter((v) => !v.deleted).length === 0 && activeGroups.filter((g) => g.type !== 'separator').length === 0) {
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

  const hasUngrouped = allVideos.some((v) => !v.deleted && (!v.groupId || !validGroupIds.has(v.groupId)));

  // Check if search yields any results before rendering
  if (currentSearch) {
    const hasResults = (hasUngrouped && filtered.some((v) => !v.groupId || !validGroupIds.has(v.groupId)))
      || activeGroups.some((g) => g.type !== 'separator' && filtered.some((v) => v.groupId === g.id));
    if (!hasResults) {
      container.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor" opacity="0.3">
            <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
          </svg>
          <p>검색 결과가 없습니다</p>
        </div>`;
      return;
    }
  }

  // Shared drop handler for both sections and separators
  async function handleDropGroup(draggedGroupId, targetGroupId, insertBefore) {
    const active = allGroups.filter((g) => !g.deleted);
    const dragged = active.find((g) => g.id === draggedGroupId);
    if (!dragged) return;
    const without = active.filter((g) => g.id !== draggedGroupId);
    const targetIdx = without.findIndex((g) => g.id === targetGroupId);
    if (targetIdx === -1) return;
    without.splice(insertBefore ? targetIdx : targetIdx + 1, 0, dragged);
    allGroups = [...without, ...allGroups.filter((g) => g.deleted)];
    await chrome.storage.local.set({ groups: allGroups });
    render();
  }

  // Render ungrouped section first (always appears at top, above any groups)
  if (hasUngrouped) {
    const ugVideos = filtered.filter((v) => !v.groupId || !validGroupIds.has(v.groupId));
    if (!currentSearch || ugVideos.length > 0) {
      const ugSection = createPlaylistSection(
        { label: '재생목록 없음', groupId: null, videos: ugVideos, sectionKey: 'null' },
        { isCollapsed: collapsedSections.has('null'), isPlaying: false, currentSearch },
        {
          onToggleCollapse: () => {
            collapsedSections.has('null') ? collapsedSections.delete('null') : collapsedSections.add('null');
            chrome.storage.local.set({ collapsedSections: [...collapsedSections] });
            renderVideos();
          },
          onStop: async () => {},
          onPlay: async () => {},
          onRename: async () => {},
          onDelete: async () => {},
          onReverse: async () => {
            const gv = allVideos.filter((v) => !v.deleted && (v.groupId ?? null) === null).sort(videoSortFn);
            gv.reverse().forEach((v, i) => { v.sortOrder = i; });
            await saveVideos();
            render();
          },
          onDropGroup: async () => {},
          onDropVideo: async (draggedVideoId) => {
            const video = allVideos.find((v) => v.videoId === draggedVideoId);
            if (!video || video.groupId == null) return;
            video.groupId = null;
            await saveVideos();
            render();
          },
          onVideoDrop: async (draggedVideoId, targetVideoId, insertBefore) => {
            const draggedVideo = allVideos.find((v) => v.videoId === draggedVideoId);
            if (!draggedVideo) return;
            if ((draggedVideo.groupId ?? null) === null) {
              const groupVideos = allVideos.filter((v) => !v.deleted && (v.groupId ?? null) === null).sort(videoSortFn);
              const without = groupVideos.filter((v) => v.videoId !== draggedVideoId);
              const targetIdx = without.findIndex((v) => v.videoId === targetVideoId);
              without.splice(insertBefore ? targetIdx : targetIdx + 1, 0, draggedVideo);
              without.forEach((v, i) => { v.sortOrder = i; });
            } else {
              draggedVideo.groupId = null;
            }
            await saveVideos();
            render();
          },
        },
      );
      container.appendChild(ugSection);
    }
  }

  activeGroups.forEach((group) => {
    if (group.type === 'separator') {
      if (currentSearch) return; // hide separators during search
      const sep = createGroupSeparator(group.id, {
        onDropGroup: (draggedId, insertBefore) => handleDropGroup(draggedId, group.id, insertBefore),
        onDelete: async () => {
          const grp = allGroups.find((g) => g.id === group.id);
          if (grp) grp.deleted = true;
          await chrome.storage.local.set({ groups: allGroups });
          render();
        },
      });
      container.appendChild(sep);
      return;
    }

    const { id: groupId, name: label } = group;
    const gv = filtered.filter((v) => v.groupId === groupId);
    if (currentSearch && gv.length === 0) return;

    const sectionKey = groupId;
    const isCollapsed = collapsedSections.has(sectionKey);
    const isPlaying = !!(currentPlaylistSession?.groupId === groupId);

    const section = createPlaylistSection(
      { label, groupId, videos: gv, sectionKey },
      { isCollapsed, isPlaying, currentSearch },
      {
        onToggleCollapse: () => {
          collapsedSections.has(sectionKey)
            ? collapsedSections.delete(sectionKey)
            : collapsedSections.add(sectionKey);
          chrome.storage.local.set({ collapsedSections: [...collapsedSections] });
          renderVideos();
        },
        onStop: async () => {
          await chrome.storage.local.remove('playlistSession');
          currentPlaylistSession = null;
          render();
        },
        onPlay: async () => {
          const grp = allGroups.find((g) => g.id === groupId);
          if (!grp) return;
          const groupVideos = allVideos.filter((v) => !v.deleted && v.groupId === groupId).sort(videoSortFn);
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
        },
        onRename: async (newName) => {
          if (newName) {
            const grp = allGroups.find((g) => g.id === groupId);
            if (grp && newName !== grp.name) {
              grp.name = newName;
              await chrome.storage.local.set({ groups: allGroups });
            }
          }
          render();
        },
        onDelete: async () => {
          const grp = allGroups.find((g) => g.id === groupId);
          if (grp) grp.deleted = true;
          allVideos.forEach((v) => { if (v.groupId === groupId) v.groupId = null; });
          collapsedSections.delete(sectionKey);
          await chrome.storage.local.set({ groups: allGroups, savedVideos: allVideos, collapsedSections: [...collapsedSections] });
          render();
        },
        onReverse: async () => {
          const gv = allVideos.filter((v) => !v.deleted && v.groupId === groupId).sort(videoSortFn);
          gv.reverse().forEach((v, i) => { v.sortOrder = i; });
          await saveVideos();
          render();
        },
        onDropGroup: (draggedId, insertBefore) => handleDropGroup(draggedId, groupId, insertBefore),
        onDropVideo: async (draggedVideoId) => {
          const video = allVideos.find((v) => v.videoId === draggedVideoId);
          if (!video || video.groupId === (groupId ?? null)) return;
          video.groupId = groupId ?? null;
          await saveVideos();
          render();
        },
        onVideoDrop: async (draggedVideoId, targetVideoId, insertBefore) => {
          const draggedVideo = allVideos.find((v) => v.videoId === draggedVideoId);
          if (!draggedVideo) return;
          const targetGroupId = groupId ?? null;
          const isSameGroup = (draggedVideo.groupId ?? null) === targetGroupId;
          if (isSameGroup) {
            const groupVideos = allVideos
              .filter((v) => !v.deleted && (v.groupId ?? null) === targetGroupId)
              .sort(videoSortFn);
            const without = groupVideos.filter((v) => v.videoId !== draggedVideoId);
            const targetIdx = without.findIndex((v) => v.videoId === targetVideoId);
            without.splice(insertBefore ? targetIdx : targetIdx + 1, 0, draggedVideo);
            without.forEach((v, i) => { v.sortOrder = i; });
          } else {
            draggedVideo.groupId = targetGroupId;
          }
          await saveVideos();
          render();
        },
      },
    );

    container.appendChild(section);
  });

  const createWrap = document.createElement('div');
  createWrap.className = 'playlist-create-wrap';

  const createRow = document.createElement('div');
  createRow.className = 'playlist-create-action-row';

  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'playlist-create-toggle';
  toggleBtn.textContent = '재생목록 만들기';

  const addSepBtn = document.createElement('button');
  addSepBtn.className = 'playlist-create-toggle';
  addSepBtn.textContent = '구분자 추가';

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

  createRow.appendChild(toggleBtn);
  createRow.appendChild(addSepBtn);
  createWrap.appendChild(createRow);
  createWrap.appendChild(form);
  container.appendChild(createWrap);

  toggleBtn.addEventListener('click', () => {
    const isHidden = form.classList.toggle('hidden');
    if (!isHidden) input.focus();
  });

  addSepBtn.addEventListener('click', async () => {
    const { groups = [] } = await chrome.storage.local.get('groups');
    const newSep = { id: 'sep_' + Date.now().toString(36), type: 'separator' };
    groups.push(newSep);
    await chrome.storage.local.set({ groups });
    allGroups = groups;
    render();
  });

  async function doCreate() {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    const { groups = [] } = await chrome.storage.local.get('groups');
    const newGroup = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      name,
      createdAt: Date.now(),
    };
    groups.push(newGroup);
    await chrome.storage.local.set({ groups });
    allGroups = groups;
    render();
  }

  confirmBtn.addEventListener('click', doCreate);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doCreate(); });
}

async function deleteVideo(videoId) {
  const video = allVideos.find((v) => v.videoId === videoId);
  if (video) video.deleted = true;
  await saveVideos();
  render();
}

function buildExportPayload(videos, groups) {
  return { savedVideos: videos.map(stripVideo), groups };
}

function exportJSON() {
  const data = JSON.stringify(buildExportPayload(allVideos, allGroups), null, 2);
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
    const existingVideoIds = new Set(allVideos.map((v) => v.videoId));
    const newVideos = importedVideos.filter((v) => v.videoId && !existingVideoIds.has(v.videoId));
    allVideos = [...allVideos, ...newVideos];
    const existingGroupIds = new Set(allGroups.map((g) => g.id));
    const newGroups = importedGroups.filter((g) => g.id && !existingGroupIds.has(g.id));
    allGroups = [...allGroups, ...newGroups];
    await chrome.storage.local.set({ savedVideos: allVideos, groups: allGroups });
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
    let remoteVideos = [];
    let remoteGroups = [];
    let currentGistId = gistId || null;

    if (currentGistId) {
      try {
        const remote = await fetchGistData(githubToken, currentGistId);
        remoteVideos = remote.savedVideos || [];
        remoteGroups = remote.groups || [];
      } catch {
        currentGistId = null;
      }
    }

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

    const deletedGroupIds = new Set([...groupMap.values()].filter((g) => g.deleted).map((g) => g.id));
    const finalVideos = [...videoMap.values()]
      .map((v) => (deletedGroupIds.has(v.groupId) ? { ...v, groupId: null } : v))
      .filter((v) => !v.deleted)
      .map(stripVideo);
    const finalGroups = [...groupMap.values()].filter((g) => !g.deleted);

    allVideos = finalVideos;
    allGroups = finalGroups;
    const isoNow = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    await chrome.storage.local.set({ savedVideos: finalVideos, groups: finalGroups, lastSyncAt: isoNow });

    const gistPayload = buildExportPayload(finalVideos, finalGroups);
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

document.addEventListener('DOMContentLoaded', () => {
  loadVideos();

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

  document.getElementById('video-list').addEventListener('click', (e) => {
    const delBtn = e.target.closest('.delete-btn');
    if (delBtn) { deleteVideo(delBtn.dataset.id); return; }

    const link = e.target.closest('.video-title, .thumb-link');
    if (link) {
      e.preventDefault();
      const url = link.href;

      if (e.shiftKey) {
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

  document.getElementById('refresh-btn').addEventListener('click', syncData);

  document.getElementById('settings-btn').addEventListener('click', () => {
    document.getElementById('settings-panel').classList.remove('hidden');
    document.getElementById('video-list').style.overflow = 'hidden';
  });

  document.getElementById('settings-close').addEventListener('click', () => {
    document.getElementById('settings-panel').classList.add('hidden');
    document.getElementById('video-list').style.overflow = '';
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

  document.getElementById('update-data-btn').addEventListener('click', async () => {
    const btn = document.getElementById('update-data-btn');
    btn.disabled = true;
    try {
      const { savedVideos = [] } = await chrome.storage.local.get('savedVideos');

      // Phase 1: Fix thumbnails for all videos (detect 120×90 placeholders and upgrade)
      let thumbUpdated = 0;
      for (let i = 0; i < savedVideos.length; i++) {
        btn.textContent = `썸네일 확인 중... (${i + 1} / ${savedVideos.length})`;
        const best = await findWorkingThumbnail(savedVideos[i].videoId);
        if (best && best !== savedVideos[i].thumbnail) {
          savedVideos[i].thumbnail = best;
          thumbUpdated++;
        }
      }

      // Phase 2: Fetch missing channel avatars
      const missingAvatar = savedVideos.filter((v) => !v.channelAvatar);
      let avatarUpdated = 0;
      for (let i = 0; i < missingAvatar.length; i++) {
        btn.textContent = `채널 아바타 업데이트 중... (${i + 1} / ${missingAvatar.length})`;
        const avatar = await fetchChannelAvatar(missingAvatar[i].videoId);
        if (avatar) {
          const idx = savedVideos.findIndex((v) => v.videoId === missingAvatar[i].videoId);
          if (idx !== -1) { savedVideos[idx].channelAvatar = avatar; avatarUpdated++; }
        }
        if (i < missingAvatar.length - 1) await new Promise((r) => setTimeout(r, 300));
      }

      await chrome.storage.local.set({ savedVideos });
      allVideos = savedVideos;

      const parts = [];
      if (thumbUpdated > 0) parts.push(`썸네일 ${thumbUpdated}개`);
      if (avatarUpdated > 0) parts.push(`아바타 ${avatarUpdated}개`);
      btn.textContent = parts.length > 0 ? `완료 (${parts.join(', ')} 업데이트)` : '이미 최신 상태';
      setTimeout(() => { btn.disabled = false; btn.textContent = '저장된 데이터 업데이트'; }, 3000);
    } catch {
      btn.textContent = '오류 발생';
      setTimeout(() => { btn.disabled = false; btn.textContent = '저장된 데이터 업데이트'; }, 2000);
    }
  });

  document.getElementById('clear-local-btn').addEventListener('click', async () => {
    await chrome.storage.local.remove(['savedVideos', 'groups', 'collapsedSections', 'lastSyncAt']);
    allVideos = [];
    allGroups = [];
    collapsedSections.clear();
    renderSyncLabel(null);
    updateGistUrlDisplay(null);
    render();
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (!isContextValid()) return;
    if (changes.savedVideos) allVideos = changes.savedVideos.newValue || [];
    if (changes.groups) allGroups = changes.groups.newValue || [];
    if (changes.playlistSession !== undefined) currentPlaylistSession = changes.playlistSession.newValue || null;
    if (changes.savedVideos || changes.groups || changes.playlistSession) render();
  });
});

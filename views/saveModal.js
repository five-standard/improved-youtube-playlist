import { esc } from '../utils/format.js';

const SVG = {
  folder:       '<path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>',
  check:        '<path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>',
  chevronRight: '<path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>',
  chevronDown:  '<path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/>',
};

function mkSvg(path, size = 16) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor">${path}</svg>`;
}

export async function openSaveModal(btn, info, { saveToFolders, onSaved }) {
  document.getElementById('yt-save-modal')?.remove();

  let groups, savedVideos;
  try {
    ({ groups = [], savedVideos = [] } = await chrome.storage.local.get(['groups', 'savedVideos']));
  } catch { return; }

  const activeFolders = groups.filter(g => !g.deleted && g.type !== 'separator');
  const activeVideos  = savedVideos.filter(v => !v.deleted);

  // Folders where this video is already stored (badge display)
  const alreadySavedIn = new Set(
    activeVideos.filter(v => v.videoId === info.videoId).map(v => v.groupId ?? null)
  );

  const selectedIds = new Set(); // user's multi-selection
  const expandedIds = new Set(); // expanded folder IDs

  const overlay = document.createElement('div');
  overlay.id = 'yt-save-modal';
  overlay.innerHTML = `
    <div class="yt-sm-dialog">
      <div class="yt-sm-header">
        <span>폴더 선택</span>
        <button class="yt-sm-close-btn" aria-label="닫기">✕</button>
      </div>
      <div class="yt-sm-body" id="yt-sm-tree"></div>
      <div class="yt-sm-new-folder-wrap" id="yt-sm-new-folder-wrap">
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

  const tree          = overlay.querySelector('#yt-sm-tree');
  const newFolderWrap = overlay.querySelector('#yt-sm-new-folder-wrap');
  const folderInput   = overlay.querySelector('#yt-sm-folder-input');

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const childFolders = (parentId) =>
    activeFolders.filter(f => (f.parentId ?? null) === parentId);

  const videosIn = (folderId) =>
    activeVideos.filter(v => (v.groupId ?? null) === folderId && v.videoId !== info.videoId);

  const hasContent = (folderId) =>
    childFolders(folderId).length > 0 || videosIn(folderId).length > 0;

  // ── Render ────────────────────────────────────────────────────────────────────

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
    row.className = `yt-sm-folder-row${isSelected ? ' selected' : ''}`;
    row.style.paddingLeft = `${depth * 20 + 10}px`;

    // Chevron
    const chevron = document.createElement('span');
    chevron.className = 'yt-sm-chevron';
    if (canExpand) {
      chevron.innerHTML = mkSvg(isExpanded ? SVG.chevronDown : SVG.chevronRight, 14);
      chevron.addEventListener('click', e => {
        e.stopPropagation();
        if (expandedIds.has(folderId)) expandedIds.delete(folderId);
        else expandedIds.add(folderId);
        renderTree();
      });
    }

    const folderIcon = document.createElement('span');
    folderIcon.className = 'yt-sm-folder-icon';
    folderIcon.innerHTML = mkSvg(SVG.folder, 15);

    const nameEl = document.createElement('span');
    nameEl.className = 'yt-sm-folder-name';
    nameEl.textContent = name;

    const checkEl = document.createElement('span');
    checkEl.className = 'yt-sm-check';
    if (isSelected) checkEl.innerHTML = mkSvg(SVG.check, 14);

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

    row.addEventListener('click', () => {
      if (selectedIds.has(folderId)) selectedIds.delete(folderId);
      else selectedIds.add(folderId);
      renderTree();
    });

    tree.appendChild(row);
  }

  function appendChildren(parentId, depth) {
    childFolders(parentId).forEach(folder => {
      appendFolderRow(folder.id, folder.name, depth);
      if (expandedIds.has(folder.id)) appendChildren(folder.id, depth + 1);
    });
    videosIn(parentId).forEach(video => appendVideoRow(video, depth));
  }

  function appendVideoRow(video, depth) {
    const thumb = video.thumbnail || `https://img.youtube.com/vi/${video.videoId}/mqdefault.jpg`;
    const row = document.createElement('div');
    row.className = 'yt-sm-video-row';
    row.style.paddingLeft = `${depth * 20 + 10}px`;
    row.innerHTML = `
      <img class="yt-sm-video-thumb" src="${esc(thumb)}" alt="">
      <span class="yt-sm-video-title">${esc(video.title)}</span>
    `;
    tree.appendChild(row);
  }

  // ── Event handlers ────────────────────────────────────────────────────────────

  const close = () => overlay.remove();
  overlay.querySelector('.yt-sm-close-btn').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  // Save button
  overlay.querySelector('#yt-sm-save-btn').addEventListener('click', async () => {
    await saveToFolders(info, [...selectedIds]);
    close();
    onSaved(btn);
  });

  // New folder toggle
  overlay.querySelector('#yt-sm-new-folder-btn').addEventListener('click', () => {
    const hidden = newFolderWrap.classList.toggle('yt-sm-hidden');
    if (!hidden) folderInput.focus();
  });

  async function confirmNewFolder() {
    const name = folderInput.value.trim();
    if (!name) { folderInput.focus(); return; }
    const { groups: current = [] } = await chrome.storage.local.get('groups');
    const newFolder = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      name,
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
  folderInput.addEventListener('keydown', e => {
    if (e.key === 'Enter')  confirmNewFolder();
    if (e.key === 'Escape') newFolderWrap.classList.add('yt-sm-hidden');
  });

  renderTree();
}

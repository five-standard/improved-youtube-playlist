import { esc } from '../utils/format.js';
import { videoSortFn } from '../utils/sort.js';
import { showContextMenu } from './contextMenu.js';
import { attachThumbFallback } from '../utils/thumbnail.js';

const ICON = {
  folder:    '<path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>',
  subfolder: '<path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-1 8h-3v3h-2v-3h-3v-2h3V9h2v3h3v2z"/>',
  rename:    '<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>',
  play:      '<path d="M8 5v14l11-7z"/>',
  delete:    '<path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>',
  info:      '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>',
  add:       '<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>',
  close:     '<path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>',
};

// Module-level drag state — shared across all column instances on the same page
let dragVideoId        = null;
let dragFolderId       = null;
let dragSourceFolderId = null; // folderId of the column where a video drag originated

// Auto-scroll state during drag
let autoScrollTimer = null;
let autoScrollEl    = null;
let autoScrollSpeed = 0;

const AUTO_SCROLL_ZONE = 50;  // px trigger zone near top/bottom edge of column
const AUTO_SCROLL_MAX  = 12;  // max scroll px per 16ms frame

function startAutoScroll(el, speed) {
  if (autoScrollEl === el && autoScrollSpeed === speed) return;
  stopAutoScroll();
  if (speed === 0) return;
  autoScrollEl    = el;
  autoScrollSpeed = speed;
  autoScrollTimer = setInterval(() => {
    if (autoScrollEl) autoScrollEl.scrollTop += autoScrollSpeed;
  }, 16);
}

function stopAutoScroll() {
  clearInterval(autoScrollTimer);
  autoScrollTimer = null;
  autoScrollEl    = null;
  autoScrollSpeed = 0;
}

function fmtDuration(secs) {
  if (!secs) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

// ── Main Column ────────────────────────────────────────────────────────────────

export function createFolderColumn(
  { folderId, folders, videos, selectedFolderId, playingFolderId, selectedItems = new Set(), anchorItemKey = null },
  callbacks,
) {
  const {
    onSelectFolder,
    onSelectItems,
    onCreateFolder,
    onRenameFolder,
    onDeleteFolder,
    onDeleteVideo,
    onPlayFolder,
    onAddVideo,
    onMoveVideo,
    onMoveFolder,
    onReorderVideo,
    onReorderFolder,
    onFocusColumn,
    onBatchMoveFolders,
    onBatchMoveVideos,
    onBatchReorderFolders,
    onBatchReorderVideos,
    onOpenVideo,
  } = callbacks;

  const col = document.createElement('div');
  col.className = 'miller-col';

  // Preserve allGroups array order (user-defined via drag) — no alphabetical sort
  const subFolders = folders.filter(f => (f.parentId ?? null) === folderId);
  const colVideos  = videos.filter(v => v.groupId.has(folderId)).sort(videoSortFn);

  // Flat ordered list for range selection (folders first, then videos)
  const orderedKeys = [
    ...subFolders.map(f => `folder:${f.id}`),
    ...colVideos.map(v => `video:${v.videoId}`),
  ];

  const selCtx = {
    selectedItems, anchorItemKey, orderedKeys, selectedFolderId, onSelectItems,
    onBatchMoveFolders, onBatchMoveVideos, onBatchReorderFolders, onBatchReorderVideos,
  };

  subFolders.forEach(folder => {
    col.appendChild(makeFolderItem(folder, folder.id === selectedFolderId, folder.id === playingFolderId, {
      onSelect:        () => onSelectFolder(folder.id),
      onRename:        (name) => onRenameFolder(folder.id, name),
      onDelete:        () => onDeleteFolder(folder.id),
      onPlay:          () => onPlayFolder(folder.id),
      onCreateSub:     () => onCreateFolder(folder.id),
      onAddVideo:      () => onAddVideo(folder.id),
      onReorderFolder: (dragId, targetId, before) => onReorderFolder(dragId, targetId, before),
      onMoveFolder:    (dragId, parentId) => onMoveFolder(dragId, parentId),
      onMoveVideo:     (vid, src, fid) => onMoveVideo(vid, src, fid),
      onFocus:         onFocusColumn,
    }, selCtx));
  });

  if (subFolders.length > 0 && colVideos.length > 0) {
    const div = document.createElement('div');
    div.className = 'miller-section-divider';
    col.appendChild(div);
  }

  colVideos.forEach(video => {
    col.appendChild(makeVideoItem(video, {
      onDelete:        () => onDeleteVideo(video.videoId, folderId),
      onReorderVideo:  (dragId, targetId, before) => onReorderVideo(dragId, targetId, before),
      onMoveToFolder:  (vid, fid) => onMoveVideo(vid, fid),
      onOpen:          () => onOpenVideo(video.url),
    }, selCtx));
  });

  if (subFolders.length === 0 && colVideos.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'miller-empty';
    empty.textContent = '비어 있음 (우클릭으로 추가)';
    col.appendChild(empty);
  }

  col.appendChild(Object.assign(document.createElement('div'), { className: 'miller-col-spacer' }));

  // ── Column: record source folder when a video drag starts from this column ──
  col.addEventListener('dragstart', (e) => {
    if (e.target.closest('.miller-video-item')) dragSourceFolderId = folderId;
  }, { capture: true });

  // ── Column: capturing dragover — auto-scroll near top/bottom edge ──
  col.addEventListener('dragover', (e) => {
    if (!dragVideoId && !dragFolderId) return;
    const rect = col.getBoundingClientRect();
    const relY = e.clientY - rect.top;
    const colH = rect.height;
    if (relY < AUTO_SCROLL_ZONE) {
      startAutoScroll(col, -Math.ceil(AUTO_SCROLL_MAX * (1 - relY / AUTO_SCROLL_ZONE)));
    } else if (relY > colH - AUTO_SCROLL_ZONE) {
      startAutoScroll(col, Math.ceil(AUTO_SCROLL_MAX * (1 - (colH - relY) / AUTO_SCROLL_ZONE)));
    } else {
      stopAutoScroll();
    }
  }, { capture: true });

  // ── Column: drag-over for videos/folders (drop into this folder at end) ──
  col.addEventListener('dragover', (e) => {
    if (!dragVideoId && !dragFolderId) return;
    if (e.target.closest('.miller-video-item') || e.target.closest('.miller-folder-item')) return;
    e.preventDefault();
    col.classList.add('miller-col-drag-over');
    e.dataTransfer.dropEffect = 'move';
  });
  col.addEventListener('dragleave', (e) => {
    if (!col.contains(e.relatedTarget)) {
      col.classList.remove('miller-col-drag-over');
      stopAutoScroll();
    }
  });
  col.addEventListener('drop', (e) => {
    col.classList.remove('miller-col-drag-over');
    if (e.target.closest('.miller-video-item') || e.target.closest('.miller-folder-item')) return;
    e.preventDefault();
    if (dragVideoId) {
      const multi = getMultiDragItems(`video:${dragVideoId}`, selCtx);
      if (multi) {
        if (multi.videoIds.length)  onBatchMoveVideos(multi.videoIds, dragSourceFolderId, folderId);
        if (multi.folderIds.length) onBatchMoveFolders(multi.folderIds, folderId);
      } else {
        onMoveVideo(dragVideoId, dragSourceFolderId, folderId);
      }
    } else if (dragFolderId) {
      const multi = getMultiDragItems(`folder:${dragFolderId}`, selCtx);
      if (multi) {
        if (multi.folderIds.length) onBatchMoveFolders(multi.folderIds, folderId);
        if (multi.videoIds.length)  onBatchMoveVideos(multi.videoIds, dragSourceFolderId, folderId);
      } else {
        onMoveFolder(dragFolderId, folderId);
      }
    }
  });

  // ── Column: click on empty area — close deeper columns ──
  col.addEventListener('click', (e) => {
    if (e.target.closest('.miller-folder-item') || e.target.closest('.miller-video-item')) return;
    onFocusColumn();
  });

  // ── Column: right-click on empty area ──
  col.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation(); // prevent stale document { once } listener from closing the new menu
    if (e.target.closest('.miller-folder-item') || e.target.closest('.miller-video-item')) return;
    showContextMenu([
      { label: '새 폴더 만들기', icon: ICON.subfolder, action: () => onCreateFolder(folderId) },
      { label: '영상 추가',       icon: ICON.add,       action: () => onAddVideo(folderId) },
    ], { x: e.clientX, y: e.clientY });
  });

  return col;
}

// ── Detail Column ──────────────────────────────────────────────────────────────

export function createDetailColumn(video, folders, { onClose }) {
  const col = document.createElement('div');
  col.className = 'miller-col miller-detail-col';

  const thumb = video.thumbnail || `https://img.youtube.com/vi/${video.videoId}/mqdefault.jpg`;

  const pathParts = [];
  let cur = video.groupId instanceof Set ? ([...video.groupId][0] ?? null) : (video.groupId ?? null);
  const seen = new Set();
  while (cur) {
    if (seen.has(cur)) break;
    seen.add(cur);
    const f = folders.find(x => x.id === cur);
    if (!f) break;
    pathParts.unshift(f.name);
    cur = f.parentId ?? null;
  }
  const folderPath = pathParts.join(' / ') || '루트';

  col.innerHTML = `
    <div class="miller-detail-header">
      <span class="miller-detail-header-label">상세 정보</span>
      <button class="miller-detail-close" title="닫기">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">${ICON.close}</svg>
      </button>
    </div>
    <img class="miller-detail-thumb" src="${esc(thumb)}" alt="">
    <div class="miller-detail-body">
      <div class="miller-detail-title">${esc(video.title)}</div>
      <div class="miller-detail-meta">
        ${video.channelName ? `
          <div class="miller-detail-meta-row">
            <span class="miller-detail-meta-label">채널</span>
            <span class="miller-detail-meta-value miller-detail-meta-channel">
              ${video.channelAvatar ? `<img class="miller-detail-avatar" src="${esc(video.channelAvatar)}" alt="">` : ''}
              ${esc(video.channelName)}
            </span>
          </div>` : ''}
        <div class="miller-detail-meta-row">
          <span class="miller-detail-meta-label">폴더</span>
          <span class="miller-detail-meta-value">${esc(folderPath)}</span>
        </div>
        <div class="miller-detail-meta-row">
          <span class="miller-detail-meta-label">ID</span>
          <a class="miller-detail-url video-title" href="${esc(video.url)}">${esc(video.videoId)}</a>
        </div>
      </div>
    </div>
    <div class="miller-col-spacer"></div>
  `;

  attachThumbFallback(col.querySelector('.miller-detail-thumb'), video.videoId);
  col.querySelector('.miller-detail-close').addEventListener('click', onClose);

  return col;
}

// ── Folder item ────────────────────────────────────────────────────────────────

function makeFolderItem(folder, isSelected, isPlaying, {
  onSelect, onRename, onDelete, onPlay, onCreateSub, onAddVideo, onReorderFolder, onMoveFolder, onMoveVideo, onFocus,
}, selCtx) {
  const key = `folder:${folder.id}`;
  const isMultiSelected = selCtx?.selectedItems.has(key) ?? false;

  const item = document.createElement('div');
  item.className = 'miller-folder-item'
    + (isSelected ? ' selected' : '')
    + (isMultiSelected ? ' multi-selected' : '');
  item.draggable = true;

  item.innerHTML = `
    <svg class="miller-item-icon" viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
      ${ICON.folder}
    </svg>
    <span class="miller-item-name">${esc(folder.name)}</span>
    ${isPlaying ? '<span class="miller-playing-badge">재생중</span>' : ''}
  `;

  item.addEventListener('click', (e) => {
    if (e.target.closest('.miller-rename-input')) return;
    if (selCtx && (e.ctrlKey || e.metaKey)) {
      const next = new Set(selCtx.selectedItems);
      if (next.has(key)) next.delete(key); else next.add(key);
      selCtx.onSelectItems(next, key);
    } else if (selCtx && e.shiftKey) {
      const anchor = selCtx.anchorItemKey
        ?? (selCtx.selectedFolderId ? `folder:${selCtx.selectedFolderId}` : null);
      selCtx.onSelectItems(rangeSelect(selCtx.orderedKeys, anchor, key), anchor ?? key);
    } else {
      onSelect();
    }
  });

  item.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu([
      { label: '새 하위 폴더 만들기', icon: ICON.subfolder, action: () => onCreateSub() },
      { label: '영상 추가',    icon: ICON.add,       action: () => onAddVideo() },
      'separator',
      { label: '이름 변경', icon: ICON.rename, action: () => startInlineRename(item, folder.name, onRename) },
      { label: '재생',       icon: ICON.play,   action: () => onPlay() },
      'separator',
      { label: '삭제', icon: ICON.delete, danger: true, action: () => onDelete() },
    ], { x: e.clientX, y: e.clientY });
  });

  // Drag this folder
  item.addEventListener('dragstart', (e) => {
    dragFolderId = folder.id;
    dragVideoId  = null;
    e.dataTransfer.setData('text/folder-id', folder.id);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => item.classList.add('dragging'), 0);
  });
  item.addEventListener('dragend', () => {
    dragFolderId = null;
    item.classList.remove('dragging');
    stopAutoScroll();
    clearAllDragIndicators();
  });

  // Drop onto this folder item
  item.addEventListener('dragover', (e) => {
    if (dragVideoId) {
      // Drop video → move into this folder
      e.preventDefault();
      e.stopPropagation();
      clearAllDragIndicators();
      item.classList.add('miller-folder-drop-target');
      e.dataTransfer.dropEffect = 'move';
    } else if (dragFolderId && dragFolderId !== folder.id) {
      // Top/bottom 30%: reorder; middle 40%: move into folder
      e.preventDefault();
      e.stopPropagation();
      const rect = item.getBoundingClientRect();
      const rel  = e.clientY - rect.top;
      const zone = rel < rect.height * 0.3 ? 'above'
                 : rel > rect.height * 0.7 ? 'below'
                 : 'into';
      clearAllDragIndicators();
      if (zone === 'above')      item.classList.add('drag-above');
      else if (zone === 'below') item.classList.add('drag-below');
      else                       item.classList.add('miller-folder-drop-target');
      e.dataTransfer.dropEffect = 'move';
    }
  });
  item.addEventListener('dragleave', (e) => {
    if (!item.contains(e.relatedTarget))
      item.classList.remove('miller-folder-drop-target', 'drag-above', 'drag-below');
  });
  item.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const wasVideo  = !!dragVideoId;
    const wasFolder = !!dragFolderId && dragFolderId !== folder.id;
    const rect = item.getBoundingClientRect();
    const rel  = e.clientY - rect.top;
    const zone = rel < rect.height * 0.3 ? 'above'
               : rel > rect.height * 0.7 ? 'below'
               : 'into';
    item.classList.remove('miller-folder-drop-target', 'drag-above', 'drag-below');
    if (wasVideo) {
      const multi = getMultiDragItems(`video:${dragVideoId}`, selCtx);
      if (multi) {
        if (multi.videoIds.length)  selCtx.onBatchMoveVideos(multi.videoIds, dragSourceFolderId, folder.id);
        if (multi.folderIds.length) selCtx.onBatchMoveFolders(multi.folderIds, folder.id);
      } else {
        onMoveVideo(dragVideoId, dragSourceFolderId, folder.id);
      }
    } else if (wasFolder) {
      const multi = getMultiDragItems(`folder:${dragFolderId}`, selCtx);
      if (zone === 'into') {
        if (multi) {
          if (multi.folderIds.length) selCtx.onBatchMoveFolders(multi.folderIds, folder.id);
          if (multi.videoIds.length)  selCtx.onBatchMoveVideos(multi.videoIds, folder.id);
        } else {
          onMoveFolder(dragFolderId, folder.id);
        }
      } else {
        if (multi) {
          selCtx.onBatchReorderFolders(multi.folderIds, folder.id, zone === 'above');
        } else {
          onReorderFolder(dragFolderId, folder.id, zone === 'above');
        }
      }
    }
  });

  return item;
}

function startInlineRename(item, currentName, onRename) {
  const nameEl = item.querySelector('.miller-item-name');
  if (!nameEl) return;
  const input = document.createElement('input');
  input.className = 'miller-rename-input';
  input.value = currentName;
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  let committed = false;
  const commit = () => { if (committed) return; committed = true; onRename(input.value.trim() || null); };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.stopPropagation(); input.blur(); }
    if (e.key === 'Escape') { committed = true; onRename(null); }
  });
  input.addEventListener('click', (e) => e.stopPropagation());
}

// ── Video item ─────────────────────────────────────────────────────────────────

function makeVideoItem(video, { onDelete, onReorderVideo, onMoveToFolder, onOpen }, selCtx) {
  const key = `video:${video.videoId}`;
  const isMultiSelected = selCtx?.selectedItems.has(key) ?? false;

  const item = document.createElement('div');
  item.className = 'miller-video-item' + (isMultiSelected ? ' multi-selected' : '');
  item.dataset.id = video.videoId;
  item.draggable = true;

  const thumb = video.thumbnail || `https://img.youtube.com/vi/${video.videoId}/mqdefault.jpg`;

  const duration = fmtDuration(video.duration);
  const meta = [video.channelName, duration].filter(Boolean).join(' · ');

  item.innerHTML = `
    <img class="miller-video-thumb" src="${esc(thumb)}" alt="" loading="lazy">
    <div class="miller-video-info">
      <span class="miller-video-title" title="${esc(video.title)}">${esc(video.title)}</span>
      ${meta ? `<span class="miller-video-meta">${esc(meta)}</span>` : ''}
    </div>
  `;
  attachThumbFallback(item.querySelector('.miller-video-thumb'), video.videoId);

  // Single click: selection only
  item.addEventListener('click', (e) => {
    if (selCtx && (e.ctrlKey || e.metaKey)) {
      const next = new Set(selCtx.selectedItems);
      if (next.has(key)) next.delete(key); else next.add(key);
      selCtx.onSelectItems(next, key);
    } else if (selCtx && e.shiftKey) {
      const anchor = selCtx.anchorItemKey
        ?? (selCtx.selectedFolderId ? `folder:${selCtx.selectedFolderId}` : null);
      selCtx.onSelectItems(rangeSelect(selCtx.orderedKeys, anchor, key), anchor ?? key);
    } else if (selCtx) {
      selCtx.onSelectItems(new Set([key]), key);
    }
  });

  // Double click: navigate to video
  item.addEventListener('dblclick', (e) => {
    e.preventDefault();
    onOpen();
  });

  item.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu([
      { label: '삭제', icon: ICON.delete, danger: true, action: () => onDelete() },
    ], { x: e.clientX, y: e.clientY });
  });

  // Drag this video
  item.addEventListener('dragstart', (e) => {
    dragVideoId  = video.videoId;
    dragFolderId = null;
    e.dataTransfer.setData('text/video-id', video.videoId);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => item.classList.add('dragging'), 0);
  });
  item.addEventListener('dragend', () => {
    dragVideoId = null;
    item.classList.remove('dragging');
    stopAutoScroll();
    clearAllDragIndicators();
  });

  // Drop onto this video → reorder
  item.addEventListener('dragover', (e) => {
    if (!dragVideoId || dragVideoId === video.videoId) return;
    e.preventDefault();
    e.stopPropagation();
    const mid = item.getBoundingClientRect().top + item.getBoundingClientRect().height / 2;
    document.querySelectorAll('.miller-video-item.drag-above, .miller-video-item.drag-below')
      .forEach(el => el.classList.remove('drag-above', 'drag-below'));
    item.classList.add(e.clientY < mid ? 'drag-above' : 'drag-below');
    e.dataTransfer.dropEffect = 'move';
  });
  item.addEventListener('dragleave', (e) => {
    if (!item.contains(e.relatedTarget)) item.classList.remove('drag-above', 'drag-below');
  });
  item.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    item.classList.remove('drag-above', 'drag-below');
    if (!dragVideoId || dragVideoId === video.videoId) return;
    const mid = item.getBoundingClientRect().top + item.getBoundingClientRect().height / 2;
    const multi = getMultiDragItems(`video:${dragVideoId}`, selCtx);
    if (multi && multi.videoIds.length > 1 && !multi.videoIds.includes(video.videoId)) {
      selCtx.onBatchReorderVideos(multi.videoIds, video.videoId, e.clientY < mid);
    } else {
      onReorderVideo(dragVideoId, video.videoId, e.clientY < mid);
    }
  });

  return item;
}

// ── Utility ────────────────────────────────────────────────────────────────────

/**
 * If the dragKey is part of the effective selection (selectedItems + open selectedFolderId),
 * returns { folderIds[], videoIds[] } for all selected items.
 * Returns null if this is a single-item drag (not in selection, or only one item selected).
 */
function getMultiDragItems(dragKey, selCtx) {
  if (!selCtx) return null;
  const eff = new Set(selCtx.selectedItems);
  if (selCtx.selectedFolderId) eff.add(`folder:${selCtx.selectedFolderId}`);
  if (!eff.has(dragKey) || eff.size <= 1) return null;
  return {
    folderIds: [...eff].filter(k => k.startsWith('folder:')).map(k => k.slice(7)),
    videoIds:  [...eff].filter(k => k.startsWith('video:')).map(k => k.slice(6)),
  };
}

/**
 * Returns a new Set of selected keys covering the range from anchorKey to targetKey
 * within orderedKeys. If anchorKey is not in this column, selects only targetKey.
 */
function rangeSelect(orderedKeys, anchorKey, targetKey) {
  const ai = orderedKeys.indexOf(anchorKey);
  const ti = orderedKeys.indexOf(targetKey);
  if (ai === -1) return new Set([targetKey]);
  const from = Math.min(ai, ti);
  const to   = Math.max(ai, ti);
  return new Set(orderedKeys.slice(from, to + 1));
}

function clearAllDragIndicators() {
  stopAutoScroll();
  document.querySelectorAll(
    '.drag-above, .drag-below, .miller-folder-drop-target, .miller-col-drag-over, .dragging'
  ).forEach(el =>
    el.classList.remove('drag-above', 'drag-below', 'miller-folder-drop-target', 'miller-col-drag-over', 'dragging')
  );
}

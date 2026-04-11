import { esc } from '../utils/format.js';
import { videoSortFn } from '../utils/sort.js';
import { createVideoItem } from './videoItem.js';

export function createGroupSeparator(groupId, { onDropGroup, onDelete }) {
  const sep = document.createElement('div');
  sep.className = 'group-separator';
  sep.dataset.groupId = groupId;
  sep.draggable = false;
  sep.innerHTML = `
    <span class="group-separator-handle" title="드래그로 순서 변경">
      <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor">
        <circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/>
        <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
        <circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
      </svg>
    </span>
    <span class="group-separator-line">━━━━━━━━━━━━━━</span>
    <button class="group-separator-delete" title="구분자 삭제">
      <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor">
        <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
      </svg>
    </button>
  `;

  sep.querySelector('.group-separator-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    onDelete();
  });

  sep.querySelector('.group-separator-handle').addEventListener('mousedown', () => {
    sep.draggable = true;
  });
  sep.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/group-id', groupId);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => sep.classList.add('group-dragging'), 0);
  });
  sep.addEventListener('dragend', () => {
    sep.draggable = false;
    sep.classList.remove('group-dragging');
    document.querySelectorAll('.group-separator.drag-group-above, .group-separator.drag-group-below, .playlist-section.drag-group-above, .playlist-section.drag-group-below')
      .forEach((el) => el.classList.remove('drag-group-above', 'drag-group-below'));
  });

  sep.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('text/group-id')) return;
    e.preventDefault();
    const isAbove = e.clientY < sep.getBoundingClientRect().top + sep.getBoundingClientRect().height / 2;
    document.querySelectorAll('.group-separator.drag-group-above, .group-separator.drag-group-below, .playlist-section.drag-group-above, .playlist-section.drag-group-below')
      .forEach((el) => el.classList.remove('drag-group-above', 'drag-group-below'));
    sep.classList.add(isAbove ? 'drag-group-above' : 'drag-group-below');
    e.dataTransfer.dropEffect = 'move';
  });
  sep.addEventListener('dragleave', (e) => {
    if (!sep.contains(e.relatedTarget)) sep.classList.remove('drag-group-above', 'drag-group-below');
  });
  sep.addEventListener('drop', async (e) => {
    e.preventDefault();
    sep.classList.remove('drag-group-above', 'drag-group-below');
    const draggedGroupId = e.dataTransfer.getData('text/group-id');
    if (!draggedGroupId || draggedGroupId === groupId) return;
    const isAbove = e.clientY < sep.getBoundingClientRect().top + sep.getBoundingClientRect().height / 2;
    await onDropGroup(draggedGroupId, isAbove);
  });

  return sep;
}

export function createPlaylistSection(
  { label, groupId, videos, sectionKey },
  { isCollapsed, isPlaying, currentSearch },
  {
    onToggleCollapse,
    onStop,
    onPlay,
    onRename,
    onDelete,
    onReverse,
    onDropGroup,
    onDropVideo,
    onVideoDrop,
  },
) {
  const section = document.createElement('div');
  section.className = 'playlist-section';
  section.dataset.groupId = groupId ?? '';

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
      <button class="playlist-reverse-btn" title="순서 뒤집기">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
          <path d="M16 17.01V10h-2v7.01h-3L15 21l4-3.99h-3zM9 3 5 6.99h3V14h2V6.99h3L9 3z"/>
        </svg>
      </button>
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

  header.addEventListener('click', () => onToggleCollapse());

  if (groupId) {
    if (isPlaying) {
      header.querySelector('.playlist-stop-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        onStop();
      });
    } else {
      header.querySelector('.playlist-play-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        onPlay();
      });
    }

    header.querySelector('.playlist-reverse-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      onReverse();
    });

    header.querySelector('.playlist-rename-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const labelEl = header.querySelector('.playlist-label');
      const input = document.createElement('input');
      input.className = 'playlist-rename-input';
      input.value = label;
      labelEl.replaceWith(input);
      input.focus();
      input.select();

      let committed = false;
      async function commitRename() {
        if (committed) return;
        committed = true;
        await onRename(input.value.trim() || null);
      }

      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter')  { ev.stopPropagation(); input.blur(); }
        if (ev.key === 'Escape') { ev.stopPropagation(); committed = true; onRename(null); }
      });
      input.addEventListener('blur', commitRename);
      input.addEventListener('click', (ev) => ev.stopPropagation());
    });

    header.querySelector('.playlist-delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      onDelete();
    });

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

  section.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('text/group-id')) {
      if (!groupId) return;
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
      await onDropGroup(draggedGroupId, insertBefore);
      return;
    }

    const draggedVideoId = e.dataTransfer.getData('text/plain');
    if (draggedVideoId) await onDropVideo(draggedVideoId);
  });

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

        item.addEventListener('drop', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          document.querySelectorAll('.video-item.drag-above, .video-item.drag-below')
            .forEach((el) => el.classList.remove('drag-above', 'drag-below'));
          const draggedVideoId = e.dataTransfer.getData('text/plain');
          if (!draggedVideoId || draggedVideoId === video.videoId) return;
          const rect = item.getBoundingClientRect();
          const insertBefore = e.clientY < rect.top + rect.height / 2;
          await onVideoDrop(draggedVideoId, video.videoId, insertBefore);
        });

        section.appendChild(item);
      });
    }
  }

  return section;
}

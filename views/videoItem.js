import { esc, formatUploadDate } from '../utils/format.js';
import { attachThumbFallback } from '../utils/thumbnail.js';

export function createVideoItem(video, idx) {
  const item = document.createElement('div');
  item.className = 'video-item';
  item.dataset.id = video.videoId;
  item.draggable = true;

  const channelHtml = video.channelName
    ? `<a class="channel-link" href="${esc(video.channelUrl || '#')}" target="_blank">${esc(video.channelName)}</a>`
    : '';
  const metaHtml = channelHtml
    ? `${channelHtml} · ${formatUploadDate(video)}`
    : formatUploadDate(video);

  item.innerHTML = `
    <span class="video-index">${idx}</span>
    <a class="thumb-link" href="${video.url}" target="_blank">
      <img class="thumb" src="${video.thumbnail}" alt="" loading="lazy">
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

  attachThumbFallback(item.querySelector('.thumb'), video.videoId);

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

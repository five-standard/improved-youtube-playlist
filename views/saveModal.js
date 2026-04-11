import { esc } from '../utils/format.js';

export async function openSaveModal(btn, info, { createGroup, saveVideoToGroup, onSaved }) {
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

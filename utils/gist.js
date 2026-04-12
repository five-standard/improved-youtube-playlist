export const GIST_FILENAME = 'ytls_data.json';

export async function fetchGistData(token, gistId) {
  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const gist = await res.json();
  const file = gist.files[GIST_FILENAME];
  if (!file) throw new Error('Gist 파일을 찾을 수 없습니다');
  if (file.truncated) {
    const rawRes = await fetch(file.raw_url, { headers: { Authorization: `Bearer ${token}` } });
    if (!rawRes.ok) throw new Error(`HTTP ${rawRes.status}`);
    return JSON.parse(await rawRes.text());
  }
  return JSON.parse(file.content);
}

export async function findExistingGist(token) {
  let page = 1;
  while (true) {
    const res = await fetch(`https://api.github.com/gists?per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const gists = await res.json();
    if (gists.length === 0) break;
    const found = gists.find((g) => Object.prototype.hasOwnProperty.call(g.files, GIST_FILENAME));
    if (found) return { id: found.id, htmlUrl: found.html_url };
    if (gists.length < 100) break;
    page++;
  }
  return null;
}

export async function createGist(token, data) {
  const res = await fetch('https://api.github.com/gists', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
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

export async function updateGist(token, gistId, data) {
  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
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

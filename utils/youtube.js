export async function fetchChannelAvatar(videoId) {
  try {
    const resp = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
    if (!resp.ok) return null;
    const html = await resp.text();
    const SEP = '(?:\\\\/|/)';
    const avatarRe = new RegExp(`"url":"(https:${SEP}${SEP}yt3\\.ggpht\\.com${SEP}[^"]+)"`);
    const ownerIdx = html.indexOf('"videoOwnerRenderer"');
    if (ownerIdx !== -1) {
      const slice = html.slice(ownerIdx, ownerIdx + 3000);
      const m = slice.match(avatarRe);
      if (m) return m[1].replace(/\\\//g, '/');
    }
    const m2 = html.match(avatarRe);
    return m2 ? m2[1].replace(/\\\//g, '/') : null;
  } catch {
    return null;
  }
}

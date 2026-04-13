/**
 * Fetches a YouTube watch page and extracts all available video metadata.
 * @param {string} videoId
 * @returns {Promise<{title, channelName, channelAvatar, duration}|null>}
 */
export async function fetchVideoInfo(videoId) {
  try {
    const resp = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
    if (!resp.ok) return null;
    const html = await resp.text();

    // Title — strip " - YouTube" suffix
    let title = null;
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    if (titleMatch) title = titleMatch[1].replace(/ - YouTube$/, '').trim() || null;

    // Duration (seconds) — from ytInitialData / ytPlayerConfig
    let duration = null;
    const durMatch = html.match(/"lengthSeconds":"(\d+)"/);
    if (durMatch) duration = parseInt(durMatch[1], 10) || null;

    // Narrow search window to videoOwnerRenderer for channel info
    const ownerIdx = html.indexOf('"videoOwnerRenderer"');
    const ownerSlice = ownerIdx !== -1 ? html.slice(ownerIdx, ownerIdx + 4000) : html;

    // Channel name — first text run inside the owner title
    let channelName = null;
    const nameMatch = ownerSlice.match(/"title":\{"runs":\[\{"text":"([^"]+)"/);
    if (nameMatch) channelName = nameMatch[1];

    // Channel avatar — yt3.ggpht.com URL
    let channelAvatar = null;
    const SEP = '(?:\\\\/|/)';
    const avatarRe = new RegExp(`"url":"(https:${SEP}${SEP}yt3\\.ggpht\\.com${SEP}[^"]+)"`);
    const avatarMatch = ownerSlice.match(avatarRe);
    if (avatarMatch) channelAvatar = avatarMatch[1].replace(/\\\//g, '/');

    return { title, channelName, channelAvatar, duration };
  } catch {
    return null;
  }
}

/** @deprecated Use fetchVideoInfo instead */
export async function fetchChannelAvatar(videoId) {
  const info = await fetchVideoInfo(videoId);
  return info?.channelAvatar ?? null;
}

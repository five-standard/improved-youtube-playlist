const THUMB_QUALITIES = ['maxresdefault', 'sddefault', 'hqdefault', 'mqdefault', 'default'];
const THUMB_PLACEHOLDER = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='90'><rect fill='%23333'/><text x='50%25' y='50%25' fill='%23666' font-size='12' text-anchor='middle' dy='.3em'>No Thumbnail</text></svg>`;

// YouTube returns a 120×90 black placeholder instead of 404 when a quality doesn't exist.
const PLACEHOLDER_W = 120;
const PLACEHOLDER_H = 90;

/**
 * Attaches a fallback chain to an <img> element.
 * On load failure, tries the next YouTube thumbnail quality in descending order,
 * then falls back to a placeholder SVG.
 * @param {HTMLImageElement} img
 * @param {string} videoId
 */
export function attachThumbFallback(img, videoId) {
  img.onerror = function () {
    const failed = this.src;
    const currentQuality = THUMB_QUALITIES.find((q) => failed.includes(q));
    const currentIdx = currentQuality ? THUMB_QUALITIES.indexOf(currentQuality) : THUMB_QUALITIES.length - 1;
    const nextIdx = currentIdx + 1;

    if (nextIdx < THUMB_QUALITIES.length) {
      this.src = `https://img.youtube.com/vi/${videoId}/${THUMB_QUALITIES[nextIdx]}.jpg`;
    } else {
      this.onerror = null;
      this.src = THUMB_PLACEHOLDER;
    }
  };
}

/**
 * Probes YouTube thumbnail CDN to find the highest-quality working URL for a videoId.
 * Detects 120×90 placeholder images (returned instead of 404 by YouTube) and skips them.
 * @param {string} videoId
 * @returns {Promise<string>} Resolves with the best working thumbnail URL, or null if none found.
 */
export function findWorkingThumbnail(videoId) {
  return new Promise((resolve) => {
    let idx = 0;

    function tryNext() {
      if (idx >= THUMB_QUALITIES.length) {
        resolve(null);
        return;
      }
      const quality = THUMB_QUALITIES[idx++];
      const url = `https://img.youtube.com/vi/${videoId}/${quality}.jpg`;
      const img = new Image();

      img.onload = () => {
        // YouTube serves a 120×90 black image as a "not found" placeholder.
        // Skip it and try the next quality.
        if (img.naturalWidth <= PLACEHOLDER_W && img.naturalHeight <= PLACEHOLDER_H) {
          tryNext();
        } else {
          resolve(url);
        }
      };
      img.onerror = tryNext;
      img.src = url;
    }

    tryNext();
  });
}

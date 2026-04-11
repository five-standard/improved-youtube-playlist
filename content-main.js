(function () {
  'use strict';

  // ── Media key intercept ───────────────────────────────────────────────────
  // While a playlist is active (yt-ext-pl in sessionStorage), prevent YouTube
  // from re-registering previoustrack / nexttrack handlers and overriding the
  // ones set by content.js (isolated world).
  const _origSetAction = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
  navigator.mediaSession.setActionHandler = function (type, handler) {
    if ((type === 'previoustrack' || type === 'nexttrack')
        && sessionStorage.getItem('yt-ext-pl') !== null) {
      return; // playlist active — keep content.js handlers intact
    }
    _origSetAction(type, handler);
  };
  // ──────────────────────────────────────────────────────────────────────────

  // ── Volume spike prevention ────────────────────────────────────────────────
  // When the extension has a playlist active it writes the desired volume to
  // sessionStorage['yt-ext-vol'].  We intercept every HTMLMediaElement.volume
  // set so YouTube's own volume resets (on SPA navigation, player init, etc.)
  // are silently replaced with our value before any audio is produced.
  // Running at document_start guarantees the override is in place before any
  // YouTube script executes.
  const _volDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume');
  if (_volDesc && _volDesc.set) {
    Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
      get: _volDesc.get,
      set(v) {
        const raw = sessionStorage.getItem('yt-ext-vol');
        if (raw !== null) {
          const desired = parseFloat(raw);
          if (!isNaN(desired)) { _volDesc.set.call(this, desired); return; }
        }
        _volDesc.set.call(this, v);
      },
      configurable: true,
    });
  }
  // ──────────────────────────────────────────────────────────────────────────

  document.addEventListener('yt-ext-navigate', (e) => {
    const videoId = e.detail?.videoId;
    if (!videoId) return;

    const app = document.querySelector('ytd-app');
    if (!app) {
      location.href = `/watch?v=${videoId}`;
      return;
    }

    const endpoint = {
      commandMetadata: {
        webCommandMetadata: {
          url: `/watch?v=${videoId}`,
          webPageType: 'WEB_PAGE_TYPE_WATCH',
          rootVe: 3832,
        },
      },
      watchEndpoint: { videoId },
    };

    // Polymer 1/2 fire() — used in older YouTube builds
    if (typeof app.fire === 'function') {
      app.fire('yt-navigate', { endpoint });
    } else {
      // Lit / Polymer 3
      app.dispatchEvent(
        new CustomEvent('yt-navigate', {
          bubbles: true,
          composed: true,
          detail: { endpoint },
        }),
      );
    }

    // After SPA navigation YouTube may suppress autoplay (programmatic nav has
    // no user-gesture token). Poll until the player has loaded the correct video,
    // then call playVideo() from the main world where player methods are fully
    // accessible (getVideoData, getPlayerState, etc.).
    let attempts = 0;
    const tryPlay = () => {
      const player = document.querySelector('#movie_player');
      if (!player || typeof player.playVideo !== 'function') {
        if (++attempts < 25) setTimeout(tryPlay, 200);
        return;
      }
      // Confirm the player has switched to the target video before playing
      const loaded = typeof player.getVideoData === 'function'
        ? player.getVideoData().video_id === videoId
        : true; // can't verify — try anyway
      if (loaded) {
        player.playVideo();
      } else if (++attempts < 25) {
        setTimeout(tryPlay, 200);
      }
    };
    setTimeout(tryPlay, 400);
  });
})();

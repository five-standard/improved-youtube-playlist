(function () {
  'use strict';

  // Runs in the page's MAIN world — has full access to YouTube's JavaScript
  // context (Polymer/Lit app element, internal event system, etc.).
  //
  // content.js (isolated world) cannot trigger YouTube's SPA router directly
  // because programmatic events are untrusted (isTrusted: false) and Chrome's
  // isolated world prevents access to page-level JS objects.
  //
  // Communication: content.js → CustomEvent('yt-ext-navigate') → this file
  // triggers YouTube's own 'yt-navigate' event on ytd-app.

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

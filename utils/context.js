export function isContextValid() {
  return !!chrome.runtime?.id;
}

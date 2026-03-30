// PUFF background service worker - handles tab lifecycle for page sync
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") {
    // Page finished loading - content script will auto refresh cached legs on load.
    // Popup will fetch fresh data when user opens it via refreshCapturedLegsFromPage.
    // No action needed - content script handles re-scan on its own load.
  }
});

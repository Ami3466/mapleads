// MapLeads service worker - required for Playwright extension ID detection
chrome.runtime.onInstalled.addListener(() => {
  console.log('MapLeads installed, id:', chrome.runtime.id);
});

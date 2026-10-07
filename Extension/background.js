chrome.runtime.onInstalled.addListener(() => {
  console.log('Handshake Job Tracker Extension Installed');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'getAuthToken') {
    chrome.identity.getAuthToken({ interactive: !!message.interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        sendResponse({ token: null, error: chrome.runtime.lastError ? chrome.runtime.lastError.message : 'No token returned' });
        return;
      }
      sendResponse({ token, error: null });
    });
    return true;
  }
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === 'oldSheetPicked') {
    chrome.storage.local.set({
      pendingOldSheetPick: { fileId: message.fileId, fileName: message.fileName, ts: Date.now() }
    }, () => sendResponse({ received: true }));
    return true;
  }

  if (message.type === 'oldSheetPickCancelled') {
    chrome.storage.local.remove('pendingOldSheetPick', () => sendResponse({ received: true }));
    return true;
  }
});
// Sets the toolbar button's tooltip to the current Shark{anty} profile name
// (the profile name itself is shown in the browser's own profile button, next
// to the address bar). Shark{anty} sets the name through the DevTools protocol
// when the profile starts; it is kept in chrome.storage so it survives the
// service worker going idle.

async function restore() {
  try {
    const { sharkProfileName } = await chrome.storage.local.get('sharkProfileName');
    if (sharkProfileName) applyLabel(sharkProfileName);
  } catch (e) {}
}

function applyLabel(name) {
  try {
    const initials = String(name).trim().split(/[\s_\-.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
    chrome.action.setTitle({ title: `Profile: ${name}` });
    chrome.action.setBadgeText({ text: initials.slice(0, 4) });
    chrome.action.setBadgeBackgroundColor({ color: '#1f6feb' });
    if (chrome.action.setBadgeTextColor) chrome.action.setBadgeTextColor({ color: '#ffffff' });
  } catch (e) {}
}

// Called from Shark{anty} via the DevTools protocol.
globalThis.__sharkSetProfile = (name) => {
  chrome.storage.local.set({ sharkProfileName: name });
  applyLabel(name);
};

chrome.runtime.onInstalled.addListener(restore);
chrome.runtime.onStartup.addListener(restore);
restore();

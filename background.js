// Captured selections waiting to be picked up by a print tab, keyed by job id.
const jobs = new Map();

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'print-selection',
    title: 'Print selection',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'print-selection') printSelection(tab, info.frameId);
});

// Toolbar button and the Alt+Shift+P shortcut (_execute_action) both land here.
chrome.action.onClicked.addListener((tab) => printSelection(tab));

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'getJob') {
    sendResponse(jobs.get(msg.id) || null);
    jobs.delete(msg.id);
  }
});

async function printSelection(tab, frameId) {
  let job;
  try {
    job = await capture(tab, frameId != null ? { frameIds: [frameId] } : { allFrames: true });
  } catch (err) {
    // allFrames can fail on pages with inaccessible frames; retry the main frame alone.
    try {
      job = await capture(tab, { frameIds: [0] });
    } catch (err2) {
      console.warn('Highlight & Print: cannot access this page', err2);
      flashBadge(tab.id, "Can't print from this page (browser-protected page).");
      return;
    }
  }

  if (!job) {
    await chrome.scripting
      .executeScript({
        target: { tabId: tab.id },
        func: () => alert('Highlight & Print: select some content on the page first.'),
      })
      .catch(() => {});
    return;
  }

  const id = crypto.randomUUID();
  jobs.set(id, job);
  // Don't hold large captures forever if the print tab never asks for them.
  setTimeout(() => jobs.delete(id), 5 * 60 * 1000);
  await chrome.tabs.create({
    url: chrome.runtime.getURL(`print.html#${id}`),
    index: tab.index + 1,
    openerTabId: tab.id,
  });
}

async function capture(tab, frames) {
  const target = { tabId: tab.id, ...frames };
  await chrome.scripting.executeScript({ target, files: ['capture.js'] });
  const results = await chrome.scripting.executeScript({
    target,
    func: () => window.__highlightPrintCapture(),
  });
  return results.map((r) => r.result).find((r) => r && r.html) || null;
}

function flashBadge(tabId, title) {
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#c62828' });
  chrome.action.setBadgeText({ tabId, text: '!' });
  chrome.action.setTitle({ tabId, title });
  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: '' });
    chrome.action.setTitle({ tabId, title: 'Print highlighted selection (Alt+Shift+P)' });
  }, 4000);
}

// background.js
if (typeof browser === "undefined") {
  // eslint-disable-next-line no-undef
  globalThis.browser = chrome;
}

// Create context menus once (toolbar button menu + page-wide menu)
browser.runtime.onInstalled.addListener(() => {
  try {
    // Context menu on the extension's toolbar button
    browser.contextMenus.create({
      id: "open-sidebar-action",
      title: "Open Pokémon Sidebar",
      contexts: ["action"]
    });

    // Context menu on ANY webpage (right-click page, selection, link, etc.)
    browser.contextMenus.create({
      id: "open-sidebar-page",
      title: "Open Pokémon Sidebar",
      contexts: ["all"] // works across page, link, selection, media, etc.
    });
  } catch (e) {
    console.warn("contextMenus create failed:", e);
  }
});

// Message bridge (used by sidebar for CORS-safe fetches, etc.)
browser.runtime.onMessage.addListener(async (msg) => {
  try {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case "FETCH_JSON": {
        const res = await fetch(msg.url, msg.opts || {});
        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch {}
        return { ok: res.ok, status: res.status, json, text };
      }
      case "PING":
        return { ok: true, pong: Date.now() };
      default:
        return { ok: false, error: "Unknown message type: " + msg.type };
    }
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// Open from toolbar click (user gesture)
browser.action.onClicked.addListener(() => {
  browser.sidebarAction.setPanel({ panel: browser.runtime.getURL("index.html") });
  browser.sidebarAction.open().catch(() => {});

  // First-run note (async)
  browser.storage.local.get("hasOpenedBefore").then(({ hasOpenedBefore }) => {
    if (!hasOpenedBefore) {
      browser.storage.local.set({ hasOpenedBefore: true });
      browser.notifications.create({
        type: "basic",
        iconUrl: browser.runtime.getURL("icon-128.png"),
        title: "Pokémon Sidebar",
        message: "Welcome! Click the toolbar button or right-click any page to open the sidebar."
      }).catch(() => {});
    }
  }).catch(() => {});
});

// Open from ANY page’s context menu (also a user gesture)
browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "open-sidebar-page" &&
      info.menuItemId !== "open-sidebar-action") return;

  // Open immediately inside the click handler (gesture-safe)
  browser.sidebarAction.setPanel({ panel: browser.runtime.getURL("index.html") });
  browser.sidebarAction.open().catch(() => {});

  // First-run note (async)
  browser.storage.local.get("hasOpenedBefore").then(({ hasOpenedBefore }) => {
    if (!hasOpenedBefore) {
      browser.storage.local.set({ hasOpenedBefore: true });
      browser.notifications.create({
        type: "basic",
        iconUrl: browser.runtime.getURL("icon-128.png"),
        title: "Pokémon Sidebar",
        message: "Welcome! Click the toolbar button or right-click any page to open the sidebar."
      }).catch(() => {});
    }
  }).catch(() => {});
});

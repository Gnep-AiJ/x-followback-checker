(function () {
  "use strict";

  const Core = globalThis.XFollowbackCore;
  const STORAGE_KEY = "xFollowbackWhitelist";
  const PANEL_POSITION_KEY = "xFollowbackPanelPosition";
  const PANEL_ID = "xfb-panel";
  const BADGE_ATTRIBUTE = "data-xfb-badge";
  const MAX_SCAN_ACCOUNTS = 5000;
  const SCAN_INTERVAL_MS = 900;
  const SCAN_STABLE_ROUNDS = 8;

  const state = {
    accounts: new Map(),
    whitelist: new Set(),
    filter: "not-following-back",
    query: "",
    scanning: false,
    hasStarted: false,
    scanCompleted: false,
    scanToken: 0,
    scanTimer: null,
    scanStableRounds: 0,
    previousScanCount: 0,
    status: "已就绪，点击开始扫描",
    panelPosition: null
  };

  let scanDebounceTimer = null;
  let currentPath = location.pathname;

  function isFollowingPage() {
    return /^\/[A-Za-z0-9_]{1,15}\/following\/?$/.test(location.pathname);
  }

  function storageGet(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => resolve(result[key]));
    });
  }

  function storageSet(value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: value }, resolve);
    });
  }

  function storageSetValue(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, resolve);
    });
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function parseCell(cell) {
    const handleLink = [...cell.querySelectorAll("a[href]")].find((link) => {
      const text = (link.textContent || "").trim();
      return /^@[A-Za-z0-9_]{1,15}$/.test(text);
    });
    if (!handleLink) return null;

    const handle = Core.normalizeHandle(handleLink.textContent);
    if (!handle) return null;

    const profilePath = `/${handle}`;
    const nameLink = [...cell.querySelectorAll("a[href]")].find((link) => {
      const href = (link.getAttribute("href") || "").toLowerCase();
      const text = (link.textContent || "").trim();
      return href === profilePath && text && !text.startsWith("@");
    });

    return {
      handle,
      displayHandle: `@${(handleLink.textContent || "").trim().replace(/^@/, "")}`,
      displayName: (nameLink && nameLink.textContent || handle).trim(),
      followsYou: Core.textShowsFollowsYou(cell.innerText || ""),
      profileHref: handleLink.getAttribute("href") || `/${handle}`,
      cell
    };
  }

  function getStatus(account) {
    return Core.classifyAccount(account, state.whitelist);
  }

  function getFollowingTimeline() {
    const main = document.querySelector('main[role="main"]') || document.querySelector("main");
    if (!main) return null;

    const labelledTimeline = main.querySelector('[aria-label="Timeline: Following"]');
    if (labelledTimeline) return labelledTimeline;

    return [...main.querySelectorAll('section[role="region"]')].find((region) =>
      region.querySelector('[data-testid="UserCell"] button[data-testid$="-unfollow"]')
    ) || null;
  }

  function getFollowingListCells() {
    const timeline = getFollowingTimeline();
    if (!timeline) return [];

    return [...timeline.querySelectorAll('[data-testid="UserCell"]')].filter((cell) =>
      Core.shouldIncludeCell({
        insideFollowingTimeline: true,
        hasUnfollowButton: Boolean(cell.querySelector('button[data-testid$="-unfollow"]'))
      })
    );
  }

  function statusLabel(status) {
    if (status === "mutual") return "互关";
    if (status === "whitelist") return "白名单";
    return "未回关";
  }

  function decorateCell(account) {
    const { cell } = account;
    const status = getStatus(account);
    cell.dataset.xfbStatus = status;

    let controls = cell.querySelector("[data-xfb-controls]");
    if (!controls) {
      controls = document.createElement("div");
      controls.setAttribute("data-xfb-controls", "true");
      controls.innerHTML = `
        <span ${BADGE_ATTRIBUTE}="true"></span>
        <button type="button" data-xfb-inline-whitelist></button>`;
      controls.querySelector("[data-xfb-inline-whitelist]").addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleWhitelist(account.handle);
      });

      const followButton = cell.querySelector('button[data-testid$="-unfollow"]');
      const target = followButton && followButton.parentElement;
      if (target) target.insertBefore(controls, followButton);
      else cell.prepend(controls);
    }

    const badge = controls.querySelector(`[${BADGE_ATTRIBUTE}]`);
    const whitelistButton = controls.querySelector("[data-xfb-inline-whitelist]");
    const inWhitelist = state.whitelist.has(account.handle);
    controls.dataset.status = status;
    badge.dataset.status = status;
    badge.textContent = statusLabel(status);
    whitelistButton.dataset.active = String(inWhitelist);
    whitelistButton.textContent = inWhitelist ? "★ 已加入" : "＋ 白名单";
    whitelistButton.title = inWhitelist ? "点击移出白名单" : "点击加入白名单：允许对方不回关";
    whitelistButton.setAttribute("aria-label", whitelistButton.title);
  }

  async function toggleWhitelist(handle) {
    const normalized = Core.normalizeHandle(handle);
    if (!normalized) return;

    if (state.whitelist.has(normalized)) state.whitelist.delete(normalized);
    else state.whitelist.add(normalized);

    await storageSet([...state.whitelist].sort());
    refreshAllDecorations();
  }

  function refreshAllDecorations() {
    for (const account of state.accounts.values()) {
      if (account.cell && account.cell.isConnected) decorateCell(account);
    }
    renderPanel();
  }

  function scanVisibleCells() {
    if (!isFollowingPage() || !state.hasStarted) return;

    const cells = getFollowingListCells();
    for (const cell of cells) {
      const account = parseCell(cell);
      if (!account) continue;

      const existing = state.accounts.get(account.handle);
      state.accounts.set(account.handle, {
        ...existing,
        ...account,
        firstSeen: existing ? existing.firstSeen : Date.now(),
        lastSeen: Date.now()
      });
      decorateCell(state.accounts.get(account.handle));
    }

    state.status = cells.length
      ? `已识别 ${state.accounts.size} 个账号（滚动会继续收集）`
      : "等待 X 加载关注列表";
    renderPanel();
  }

  function scheduleScan() {
    clearTimeout(scanDebounceTimer);
    scanDebounceTimer = setTimeout(scanVisibleCells, 180);
  }

  function stopAutoScan(message, completed = false) {
    state.scanning = false;
    state.scanCompleted = completed;
    state.scanToken += 1;
    clearTimeout(state.scanTimer);
    state.scanTimer = null;
    window.scrollTo(window.scrollX, window.scrollY);
    if (message) state.status = message;
    renderPanel();
  }

  function pageShowsInterruption() {
    const text = (document.body && document.body.innerText || "").toLowerCase();
    return [
      "rate limit exceeded",
      "something went wrong",
      "verify you are human",
      "超过速率限制",
      "出错了",
      "验证您是真人"
    ].some((marker) => text.includes(marker));
  }

  function autoScanStep(token) {
    if (!Core.isScanStepActive(state.scanning, state.scanToken, token)) return;
    if (!isFollowingPage()) {
      stopAutoScan("已停止：当前不在关注列表");
      return;
    }
    if (pageShowsInterruption()) {
      stopAutoScan("已停止：X 显示限流、错误或验证提示");
      return;
    }
    if (state.accounts.size >= MAX_SCAN_ACCOUNTS) {
      stopAutoScan(`已停止：达到安全上限 ${MAX_SCAN_ACCOUNTS}`);
      return;
    }

    scanVisibleCells();
    if (state.accounts.size === state.previousScanCount) state.scanStableRounds += 1;
    else state.scanStableRounds = 0;
    state.previousScanCount = state.accounts.size;

    if (state.scanStableRounds >= SCAN_STABLE_ROUNDS) {
      stopAutoScan(`扫描完成：共识别 ${state.accounts.size} 个账号`, true);
      return;
    }

    state.status = `自动扫描中：已识别 ${state.accounts.size} 个；可随时停止`;
    window.scrollBy(0, Math.max(600, Math.floor(window.innerHeight * 0.78)));
    renderPanel();
    state.scanTimer = setTimeout(() => autoScanStep(token), SCAN_INTERVAL_MS);
  }

  function startAutoScan() {
    if (state.scanning) return;
    state.accounts.clear();
    document.querySelectorAll("[data-xfb-controls]").forEach((controls) => controls.remove());
    state.hasStarted = true;
    state.scanCompleted = false;
    state.scanning = true;
    state.scanStableRounds = 0;
    state.previousScanCount = -1;
    state.scanToken += 1;
    const token = state.scanToken;
    window.scrollTo(0, 0);
    state.status = "准备扫描…";
    renderPanel();
    state.scanTimer = setTimeout(() => autoScanStep(token), 350);
  }

  function clampPanelPosition(panel, left, top) {
    const margin = 8;
    return {
      left: Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - panel.offsetWidth - margin)),
      top: Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - 48))
    };
  }

  function applyPanelPosition(panel, position) {
    if (!position || !Number.isFinite(position.left) || !Number.isFinite(position.top)) return;
    const next = clampPanelPosition(panel, position.left, position.top);
    panel.style.left = `${next.left}px`;
    panel.style.top = `${next.top}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  }

  function enablePanelDragging(panel) {
    const handle = panel.querySelector(".xfb-header");
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest("button")) return;
      const rect = panel.getBoundingClientRect();
      dragging = true;
      offsetX = event.clientX - rect.left;
      offsetY = event.clientY - rect.top;
      panel.classList.add("xfb-dragging");
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    handle.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const next = clampPanelPosition(panel, event.clientX - offsetX, event.clientY - offsetY);
      panel.style.left = `${next.left}px`;
      panel.style.top = `${next.top}px`;
    });

    const finishDrag = (event) => {
      if (!dragging) return;
      dragging = false;
      panel.classList.remove("xfb-dragging");
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      state.panelPosition = {
        left: parseFloat(panel.style.left),
        top: parseFloat(panel.style.top)
      };
      storageSetValue(PANEL_POSITION_KEY, state.panelPosition);
    };

    handle.addEventListener("pointerup", finishDrag);
    handle.addEventListener("pointercancel", finishDrag);
  }

  function setFilter(filter) {
    state.filter = filter;
    refreshAllDecorations();
  }

  function createPanel() {
    if (document.getElementById(PANEL_ID) || !isFollowingPage()) return;

    const panel = document.createElement("aside");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="xfb-header">
        <div class="xfb-brand">
          <span class="xfb-bot" aria-hidden="true">
            <i class="xfb-bot-antenna"></i>
            <span class="xfb-bot-face"><i></i><i></i><b></b></span>
          </span>
          <div>
            <strong>回关助手</strong>
            <span>本地识别 · 不上传数据</span>
          </div>
        </div>
        <button type="button" data-xfb-action="collapse" aria-label="收起面板">−</button>
      </div>
      <div class="xfb-body">
        <div class="xfb-meta">
          <div class="xfb-status"><i aria-hidden="true"></i><span data-xfb-status></span></div>
          <button type="button" class="xfb-all" data-xfb-filter="all">全部 <strong data-xfb-total>0</strong></button>
        </div>
        <div class="xfb-stats" data-xfb-stats></div>
        <label class="xfb-search-wrap">
          <span aria-hidden="true">⌕</span>
          <input class="xfb-search" data-xfb-search type="search" placeholder="搜索账号" autocomplete="off">
        </label>
        <div class="xfb-list" data-xfb-list></div>
        <div class="xfb-actions">
          <button type="button" class="xfb-primary" data-xfb-action="scan">▶ 开始扫描</button>
        </div>
        <p class="xfb-note">扫描结束后完全停止页面滚动</p>
      </div>`;
    document.body.appendChild(panel);
    applyPanelPosition(panel, state.panelPosition);
    enablePanelDragging(panel);

    panel.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;

      const action = button.dataset.xfbAction;
      if (action === "collapse") {
        panel.classList.toggle("xfb-collapsed");
        button.textContent = panel.classList.contains("xfb-collapsed") ? "+" : "−";
        button.setAttribute("aria-label", panel.classList.contains("xfb-collapsed") ? "展开面板" : "收起面板");
      } else if (action === "scan") {
        if (state.scanning) stopAutoScan(`已停止：共识别 ${state.accounts.size} 个账号`);
        else startAutoScan();
      } else if (button.dataset.xfbFilter) {
        setFilter(button.dataset.xfbFilter);
      } else if (button.dataset.xfbWhitelist) {
        toggleWhitelist(button.dataset.xfbWhitelist);
      }
    });

    panel.querySelector("[data-xfb-search]").addEventListener("input", (event) => {
      state.query = event.target.value;
      refreshAllDecorations();
    });
  }

  function renderPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    const accounts = [...state.accounts.values()];
    const counts = { all: accounts.length, "not-following-back": 0, mutual: 0, whitelist: 0 };
    for (const account of accounts) counts[getStatus(account)] += 1;

    panel.querySelector("[data-xfb-status]").textContent = state.status;
    panel.dataset.scanning = String(state.scanning);
    panel.querySelector("[data-xfb-total]").textContent = counts.all;
    panel.querySelector(".xfb-all").dataset.active = String(state.filter === "all");
    panel.querySelector("[data-xfb-stats]").innerHTML = [
      ["not-following-back", "未回关", counts["not-following-back"]],
      ["mutual", "互关", counts.mutual],
      ["whitelist", "白名单", counts.whitelist]
    ].map(([filter, label, count]) => `
      <button type="button" data-xfb-filter="${filter}" data-active="${state.filter === filter}">
        <span>${label}</span><strong>${count}</strong>
      </button>`).join("");

    const visible = accounts
      .filter((account) => (state.filter === "all" || getStatus(account) === state.filter))
      .filter((account) => Core.matchesQuery(account, state.query))
      .sort((a, b) => a.handle.localeCompare(b.handle));

    panel.querySelector("[data-xfb-list]").innerHTML = visible.length
      ? visible.map((account) => {
          const status = getStatus(account);
          const inWhitelist = state.whitelist.has(account.handle);
          const initial = (account.displayName || account.handle || "@").trim().charAt(0).toUpperCase();
          return `
            <div class="xfb-account" data-status="${status}">
              <span class="xfb-avatar" aria-hidden="true">${escapeHtml(initial)}</span>
              <a href="/${encodeURIComponent(account.handle)}">
                <strong>${escapeHtml(account.displayName)}</strong>
                <span>${escapeHtml(account.displayHandle)}</span>
              </a>
              <span class="xfb-account-state" title="${statusLabel(status)}">${statusLabel(status)}</span>
              <button type="button" class="xfb-list-whitelist" data-active="${inWhitelist}" data-xfb-whitelist="${escapeHtml(account.handle)}" title="${inWhitelist ? "点击移出白名单" : "加入白名单：允许对方不回关"}" aria-label="${inWhitelist ? "移出白名单" : "加入白名单"}">
                ${inWhitelist ? "✓ 已加入" : "＋ 白名单"}
              </button>
            </div>`;
        }).join("")
      : '<div class="xfb-empty">当前筛选下没有账号</div>';

    const scanButton = panel.querySelector('[data-xfb-action="scan"]');
    scanButton.textContent = state.scanning
      ? "■ 停止扫描"
      : state.scanCompleted || state.hasStarted
        ? "↻ 重新扫描"
        : "▶ 开始扫描";
    scanButton.classList.toggle("xfb-danger", state.scanning);

  }

  function handleRouteChange() {
    if (location.pathname === currentPath) return;
    currentPath = location.pathname;
    stopAutoScan();

    const panel = document.getElementById(PANEL_ID);
    if (!isFollowingPage()) {
      if (panel) panel.remove();
      return;
    }

    state.accounts.clear();
    state.hasStarted = false;
    state.scanCompleted = false;
    state.status = "已就绪，点击开始扫描";
    createPanel();
  }

  async function initialize() {
    const storedWhitelist = await storageGet(STORAGE_KEY);
    state.panelPosition = await storageGet(PANEL_POSITION_KEY) || null;
    state.whitelist = new Set(
      (Array.isArray(storedWhitelist) ? storedWhitelist : [])
        .map(Core.normalizeHandle)
        .filter(Boolean)
    );

    if (isFollowingPage()) {
      state.status = "已就绪，点击开始扫描";
      createPanel();
    }

    const observer = new MutationObserver((mutations) => {
      handleRouteChange();
      const pageChanged = mutations.some((mutation) => {
        const target = mutation.target.nodeType === Node.ELEMENT_NODE
          ? mutation.target
          : mutation.target.parentElement;
        return target && !target.closest(`#${PANEL_ID}`) && !target.closest(`[${BADGE_ATTRIBUTE}]`);
      });
      if (isFollowingPage() && pageChanged) scheduleScan();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("popstate", handleRouteChange);
    setInterval(handleRouteChange, 1000);

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message && message.type === "xfb:get-state") {
        sendResponse({
          active: isFollowingPage(),
          count: state.accounts.size,
          path: location.pathname
        });
      }
    });
  }

  initialize();
})();

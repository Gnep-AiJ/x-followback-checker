(function (root) {
  "use strict";

  const HANDLE_PATTERN = /^@?([A-Za-z0-9_]{1,15})$/;
  const FOLLOWS_YOU_MARKERS = [
    /(?:^|\n)Follows you(?:\n|$)/i,
    /(?:^|\n)关注了你(?:\n|$)/,
    /(?:^|\n)關注了你(?:\n|$)/
  ];

  function normalizeHandle(value) {
    const match = String(value || "").trim().match(HANDLE_PATTERN);
    return match ? match[1].toLowerCase() : "";
  }

  function displayHandle(value) {
    const normalized = normalizeHandle(value);
    return normalized ? `@${String(value).trim().replace(/^@/, "")}` : "";
  }

  function textShowsFollowsYou(text) {
    const normalizedText = String(text || "").replace(/\r/g, "");
    return FOLLOWS_YOU_MARKERS.some((pattern) => pattern.test(normalizedText));
  }

  function classifyAccount(account, whitelist) {
    const handle = normalizeHandle(account && account.handle);
    const allowed = whitelist instanceof Set
      ? whitelist.has(handle)
      : Array.isArray(whitelist) && whitelist.map(normalizeHandle).includes(handle);

    if (allowed) return "whitelist";
    return account && account.followsYou ? "mutual" : "not-following-back";
  }

  function matchesQuery(account, query) {
    const needle = String(query || "").trim().toLowerCase();
    if (!needle) return true;
    return `${account.displayName || ""} ${account.handle || ""}`.toLowerCase().includes(needle);
  }

  function shouldIncludeCell(candidate) {
    return Boolean(
      candidate &&
      candidate.insideFollowingTimeline &&
      candidate.hasUnfollowButton
    );
  }

  function isScanStepActive(scanning, currentToken, stepToken) {
    return Boolean(scanning) && currentToken === stepToken;
  }

  const api = {
    normalizeHandle,
    displayHandle,
    textShowsFollowsYou,
    classifyAccount,
    matchesQuery,
    shouldIncludeCell,
    isScanStepActive
  };

  root.XFollowbackCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

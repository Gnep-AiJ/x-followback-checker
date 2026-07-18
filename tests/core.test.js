"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../core.js");

test("normalizeHandle accepts X-compatible handles", () => {
  assert.equal(Core.normalizeHandle("@W1nterDawn"), "w1nterdawn");
  assert.equal(Core.normalizeHandle(" ClaudeDevs "), "claudedevs");
  assert.equal(Core.normalizeHandle("not-valid!"), "");
});

test("textShowsFollowsYou recognizes supported page labels", () => {
  assert.equal(Core.textShowsFollowsYou("Name\n@name\nFollows you\nFollowing"), true);
  assert.equal(Core.textShowsFollowsYou("昵称\n@name\n关注了你\n正在关注"), true);
  assert.equal(Core.textShowsFollowsYou("Name\n@name\nFollowing"), false);
});

test("classifyAccount gives whitelist priority", () => {
  const whitelist = new Set(["special"]);
  assert.equal(Core.classifyAccount({ handle: "@special", followsYou: false }, whitelist), "whitelist");
  assert.equal(Core.classifyAccount({ handle: "@mutual", followsYou: true }, whitelist), "mutual");
  assert.equal(Core.classifyAccount({ handle: "@missing", followsYou: false }, whitelist), "not-following-back");
});

test("matchesQuery searches handle and display name case-insensitively", () => {
  const account = { handle: "claudedevs", displayName: "Claude Developers" };
  assert.equal(Core.matchesQuery(account, "CLAUDE"), true);
  assert.equal(Core.matchesQuery(account, "missing"), false);
});

test("shouldIncludeCell rejects sidebar recommendations and non-followed users", () => {
  assert.equal(Core.shouldIncludeCell({ insideFollowingTimeline: true, hasUnfollowButton: true }), true);
  assert.equal(Core.shouldIncludeCell({ insideFollowingTimeline: false, hasUnfollowButton: true }), false);
  assert.equal(Core.shouldIncludeCell({ insideFollowingTimeline: true, hasUnfollowButton: false }), false);
});

test("isScanStepActive rejects stopped and stale scan callbacks", () => {
  assert.equal(Core.isScanStepActive(true, 4, 4), true);
  assert.equal(Core.isScanStepActive(false, 4, 4), false);
  assert.equal(Core.isScanStepActive(true, 5, 4), false);
});

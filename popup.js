"use strict";

const statusElement = document.getElementById("status");

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (!tab || !tab.id || !String(tab.url || "").startsWith("https://x.com/")) {
    statusElement.textContent = "当前不是 X 页面";
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: "xfb:get-state" }, (response) => {
    if (chrome.runtime.lastError || !response) {
      statusElement.textContent = "请刷新 X 页面后再试";
      return;
    }
    statusElement.textContent = response.active
      ? `运行中：本次已识别 ${response.count} 个账号`
      : "请打开你的“正在关注”列表";
  });
});

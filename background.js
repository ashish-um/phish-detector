chrome.runtime.onInstalled.addListener(() => {
  console.log("Phishing Detector Extension Installed");
});

chrome.webNavigation.onCompleted.addListener(
  async (details) => {
    if (details.frameId === 0) {
      console.log("Checking page for phishing attempts: ", details.url);
      setTimeout(() => {
        chrome.tabs.sendMessage(details.tabId, {
          action: "extractPageContent",
        });
      }, 1000);
    }
  },
  { url: [{ schemes: ["http", "https"] }] }
);

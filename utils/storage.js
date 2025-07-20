export function getBlockedKeywords() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['blocked'], (res) => {
        resolve(res.blocked || []);
      });
    });
  }
  
  export function saveBlockedKeywords(keywords) {
    return new Promise((resolve) => {
      chrome.storage.sync.set({ blocked: keywords }, resolve);
    });
  }
  
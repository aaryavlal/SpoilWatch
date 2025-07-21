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

  export function removeKeyword(keywordToRemove) {
    return new Promise((resolve) => {
      getBlockedKeywords().then(existingKeywords => {
        const updatedKeywords = existingKeywords.filter(keyword => keyword !== keywordToRemove);
        chrome.storage.sync.set({ blocked: updatedKeywords }, () => {
          resolve(updatedKeywords);
        });
      });
    });
  }

  export function getKeywordHistory() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['keywordHistory'], (res) => {
        resolve(res.keywordHistory || []);
      });
    });
  }

  export function saveKeywordHistory(history) {
    return new Promise((resolve) => {
      chrome.storage.sync.set({ keywordHistory: history }, resolve);
    });
  }
  
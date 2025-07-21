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
  
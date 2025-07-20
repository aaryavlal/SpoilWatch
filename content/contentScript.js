import { getBlockedKeywords } from '../utils/storage.js';
import { shouldBlock } from '../utils/filterEngine.js';

function extractHashtags(text) {
  return (text.match(/#\w+/g) || []).map(tag => tag.toLowerCase());
}

function checkPageForSpoilers() {
  const elements = document.querySelectorAll('p, span, div'); // Adjust for platform
  getBlockedKeywords().then(blocked => {
    elements.forEach(el => {
      const tags = extractHashtags(el.innerText);
      if (shouldBlock(tags, blocked)) {
        el.style.filter = 'blur(6px)';
        el.title = 'Spoiler blocked by SpoilWatch';
      }
    });
  });
}

window.addEventListener('load', checkPageForSpoilers);

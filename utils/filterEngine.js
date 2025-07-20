export function shouldBlock(tagsOnPage, blockedKeywords) {
    return tagsOnPage.some(tag => blockedKeywords.includes(tag.replace('#', '').toLowerCase()));
  }
  
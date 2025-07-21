export function shouldBlock(tagsOnPage, blockedKeywords) {
  if (!tagsOnPage || !blockedKeywords || tagsOnPage.length === 0 || blockedKeywords.length === 0) {
    return false;
  }
  
  console.log('SpoilWipe: Checking tags:', tagsOnPage, 'against blocked keywords:', blockedKeywords);
  
  return tagsOnPage.some(tag => {
    // Remove # symbol and convert to lowercase for comparison
    const cleanTag = tag.replace('#', '').toLowerCase().trim();
    
    return blockedKeywords.some(keyword => {
      const cleanKeyword = keyword.toLowerCase().trim();
      
      // Exact match
      if (cleanTag === cleanKeyword) {
        console.log('SpoilWipe: Exact match found:', cleanTag, '=', cleanKeyword);
        return true;
      }
      
      // Partial match (keyword is contained within tag)
      if (cleanTag.includes(cleanKeyword)) {
        console.log('SpoilWipe: Partial match found (keyword in tag):', cleanKeyword, 'in', cleanTag);
        return true;
      }
      
      // Tag is contained within keyword (for broader matching)
      if (cleanKeyword.includes(cleanTag)) {
        console.log('SpoilWipe: Partial match found (tag in keyword):', cleanTag, 'in', cleanKeyword);
        return true;
      }
      
      // Word boundary matching (for hashtags like #marvelrivals matching "marvel")
      const tagWords = cleanTag.split(/[\s\-_]+/);
      const keywordWords = cleanKeyword.split(/[\s\-_]+/);
      
      for (const tagWord of tagWords) {
        for (const keywordWord of keywordWords) {
          if (tagWord === keywordWord || 
              tagWord.includes(keywordWord) || 
              keywordWord.includes(tagWord)) {
            console.log('SpoilWipe: Word match found:', tagWord, 'matches', keywordWord);
            return true;
          }
        }
      }
      
      return false;
    });
  });
}
  
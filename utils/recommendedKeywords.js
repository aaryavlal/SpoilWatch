function debounce(func, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => func.apply(this, args), delay);
  };
}

export async function fetchRecommendedKeywords(userInput) {
  if (!userInput || userInput.length < 3) return [];

  try {
    const res = await fetch(`https://api.datamuse.com/words?ml=${encodeURIComponent(userInput)}&max=12`);
    const data = await res.json();

    const COMMON_WORDS = ['the', 'and', 'of', 'in', 'on', 'to', 'a', 'is', 'as', 'by'];

    const keywords = data
      .map(entry => entry.word.toLowerCase())
      .filter(word => word.length >= 4 && !COMMON_WORDS.includes(word))
      .map(word => `#${word}`);

    return keywords;
  } catch (err) {
    console.error('Error fetching general recommended keywords:', err);
    return [];
  }
}

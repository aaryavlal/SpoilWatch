const OMDB_API_KEY = '797f9541';


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
    const res = await fetch(`https://www.omdbapi.com/?apikey=${OMDB_API_KEY}&t=${encodeURIComponent(userInput)}`);
    const data = await res.json();

    if (data?.Response === 'False') return [];

    const keywordSet = new Set();

    
    if (data.Title) data.Title.split(' ').forEach(w => keywordSet.add(w.trim().toLowerCase()));
    if (data.Genre) data.Genre.split(',').forEach(w => keywordSet.add(w.trim().toLowerCase()));
    if (data.Actors) data.Actors.split(',').forEach(w => keywordSet.add(w.trim().toLowerCase()));
    if (data.Director) data.Director.split(',').forEach(w => keywordSet.add(w.trim().toLowerCase()));
    if (data.Writer) data.Writer.split(',').forEach(w => keywordSet.add(w.trim().toLowerCase()));

    
    const COMMON_WORDS = ['the', 'and', 'of', 'in', 'on', 'to', 'a', 'is', 'as', 'by'];
    const finalKeywords = [...keywordSet].filter(word => word.length >= 4 && !COMMON_WORDS.includes(word));

    return finalKeywords.map(word => `#${word}`);
  } catch (err) {
    console.error('Error fetching recommended keywords:', err);
    return [];
  }
}

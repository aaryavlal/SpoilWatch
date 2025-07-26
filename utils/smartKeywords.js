const OMDB_API_KEY = '797f9541';

function toHashtag(str) {
  return '#' + str.toLowerCase().replace(/\s+/g, '');
}

export async function getSmartSpoilerKeywords(limit = 5) {
  const movieTitles = [
    'Oppenheimer',
    'Inside Out 2',
    'Despicable Me 4',
    'Dune: Part Two',
    'Deadpool & Wolverine'
  ];

  const results = {};

  for (const title of movieTitles.slice(0, limit)) {
    try {
      console.log(`🔍 Searching OMDb for "${title}"`);
      const url = `https://www.omdbapi.com/?apikey=${OMDB_API_KEY}&t=${encodeURIComponent(title)}`;
      const res = await fetch(url);
      const data = await res.json();

      console.log(`📦 Response for "${title}":`, data);

      if (data.Response === 'False') {
        console.warn(`❌ OMDb could not find "${title}": ${data.Error}`);
        continue;
      }

      const keywords = new Set();

      if (data.Title) keywords.add(toHashtag(data.Title));
      if (data.Genre) data.Genre.split(',').forEach(g => keywords.add(toHashtag(g)));
      if (data.Actors) data.Actors.split(',').forEach(a => keywords.add(toHashtag(a)));
      if (data.Director) data.Director.split(',').forEach(d => keywords.add(toHashtag(d)));
      if (data.Year) keywords.add(`#${data.Year}`);

      const hashtagList = [...keywords].slice(0, 10);
      results[data.Title] = hashtagList;

      console.log(`✅ Hashtags for "${data.Title}":`, hashtagList);

    } catch (err) {
      console.error(`💥 Error fetching "${title}":`, err);
    }
  }

  return results;
}

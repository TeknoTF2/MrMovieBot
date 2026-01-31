/**
 * Cine2Nerdle Helper - Background Service Worker
 * Handles TMDB API calls and caching
 */

// TMDB Genre ID mapping
const GENRES = {
  28: 'Action',
  12: 'Adventure', 
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Sci-Fi',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western'
};

// Rate limiting: TMDB allows 40 requests per 10 seconds
const REQUEST_DELAY_MS = 250; // ~4 per second to be safe
let lastRequestTime = 0;

async function waitForRateLimit() {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < REQUEST_DELAY_MS) {
    await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS - timeSinceLastRequest));
  }
  lastRequestTime = Date.now();
}

async function getApiToken() {
  const result = await chrome.storage.local.get(['tmdb_api_key']);
  if (!result.tmdb_api_key) {
    throw new Error('TMDB API key not configured. Please add it in the extension popup.');
  }
  return result.tmdb_api_key;
}

/**
 * Search for a movie by title and year
 */
async function searchMovie(title, year) {
  const token = await getApiToken();
  await waitForRateLimit();
  
  const url = new URL('https://api.themoviedb.org/3/search/movie');
  url.searchParams.set('query', title);
  url.searchParams.set('year', year);
  url.searchParams.set('include_adult', 'false');
  url.searchParams.set('language', 'en-US');
  
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  });
  
  if (!response.ok) {
    throw new Error(`TMDB search failed: ${response.status}`);
  }
  
  return response.json();
}

/**
 * Get full credits (cast + crew) for a movie
 */
async function getMovieCredits(movieId) {
  const token = await getApiToken();
  await waitForRateLimit();
  
  const url = `https://api.themoviedb.org/3/movie/${movieId}/credits?language=en-US`;
  
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  });
  
  if (!response.ok) {
    throw new Error(`TMDB credits fetch failed: ${response.status}`);
  }
  
  return response.json();
}

/**
 * Get a person's full filmography
 */
async function getPersonCredits(personId) {
  const token = await getApiToken();
  await waitForRateLimit();
  
  const url = `https://api.themoviedb.org/3/person/${personId}/movie_credits?language=en-US`;
  
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  });
  
  if (!response.ok) {
    throw new Error(`TMDB person credits fetch failed: ${response.status}`);
  }
  
  return response.json();
}

/**
 * Get movie details (for genre info)
 */
async function getMovieDetails(movieId) {
  const token = await getApiToken();
  await waitForRateLimit();
  
  const url = `https://api.themoviedb.org/3/movie/${movieId}?language=en-US`;
  
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  });
  
  if (!response.ok) {
    throw new Error(`TMDB movie details fetch failed: ${response.status}`);
  }
  
  return response.json();
}

/**
 * Process a movie request - get all cast/crew and their filmographies
 */
async function processMovieRequest(title, year, localId) {
  console.log(`[Helper] Processing movie: ${title} (${year})`);
  
  // Check cache first
  const cached = await chrome.storage.local.get([localId]);
  if (cached[localId] && cached[localId].complete) {
    console.log(`[Helper] Cache hit for ${localId}`);
    return cached[localId];
  }
  
  // Search for the movie
  const searchResult = await searchMovie(title, year);
  if (!searchResult.results || searchResult.results.length === 0) {
    throw new Error(`Movie not found: ${title} (${year})`);
  }
  
  const movie = searchResult.results[0];
  const movieId = movie.id;
  
  // Get credits (cast + crew)
  const credits = await getMovieCredits(movieId);
  
  // Get full cast - no arbitrary limit
  const cast = credits.cast || [];
  
  // Get relevant crew (directors, writers, cinematographers, composers)
  const relevantJobs = ['Director', 'Writer', 'Screenplay', 'Director of Photography', 'Original Music Composer', 'Music'];
  const crew = (credits.crew || []).filter(person => relevantJobs.includes(person.job));
  
  // Combine and dedupe people
  const peopleMap = new Map();
  
  for (const person of cast) {
    if (!peopleMap.has(person.id)) {
      peopleMap.set(person.id, {
        id: person.id,
        name: person.name,
        type: 'cast',
        popularity: person.popularity || 0
      });
    }
  }
  
  for (const person of crew) {
    if (!peopleMap.has(person.id)) {
      peopleMap.set(person.id, {
        id: person.id,
        name: person.name,
        type: 'crew',
        job: person.job,
        popularity: person.popularity || 0
      });
    } else {
      // Person is both cast and crew, note that
      const existing = peopleMap.get(person.id);
      existing.type = 'both';
      existing.job = person.job;
    }
  }
  
  const people = Array.from(peopleMap.values());
  
  // Fetch filmographies for all people
  // Sort by filmography potential (we'll fetch more popular ones first as they're more likely useful)
  people.sort((a, b) => b.popularity - a.popularity);
  
  // Limit to reasonable number to avoid rate limiting hell
  // But much more than the original's 5
  const maxPeople = 30;
  const peopleToProcess = people.slice(0, maxPeople);
  
  const filmographies = {};
  
  for (const person of peopleToProcess) {
    // Check if we have this person cached
    const personCacheKey = `person_${person.id}`;
    const personCached = await chrome.storage.local.get([personCacheKey]);
    
    if (personCached[personCacheKey]) {
      filmographies[person.id] = personCached[personCacheKey];
      continue;
    }
    
    try {
      const personCredits = await getPersonCredits(person.id);
      
      // Combine cast and crew credits
      const allCredits = [];
      
      if (personCredits.cast) {
        for (const credit of personCredits.cast) {
          if (credit.release_date) { // Must have a release date
            allCredits.push({
              id: credit.id,
              title: credit.title || credit.original_title,
              year: parseInt(credit.release_date.substring(0, 4)),
              genres: credit.genre_ids || [],
              popularity: credit.popularity || 0,
              role: 'cast'
            });
          }
        }
      }
      
      if (personCredits.crew) {
        for (const credit of personCredits.crew) {
          if (credit.release_date && relevantJobs.includes(credit.job)) {
            // Check if we already have this movie from cast
            const existing = allCredits.find(c => c.id === credit.id);
            if (!existing) {
              allCredits.push({
                id: credit.id,
                title: credit.title || credit.original_title,
                year: parseInt(credit.release_date.substring(0, 4)),
                genres: credit.genre_ids || [],
                popularity: credit.popularity || 0,
                role: credit.job
              });
            }
          }
        }
      }
      
      const filmography = {
        id: person.id,
        name: person.name,
        creditCount: allCredits.length,
        credits: allCredits
      };
      
      filmographies[person.id] = filmography;
      
      // Cache this person
      await chrome.storage.local.set({ [personCacheKey]: filmography });
      
    } catch (err) {
      console.error(`[Helper] Failed to get credits for ${person.name}:`, err);
    }
  }
  
  // Build the final movie data object
  const movieData = {
    id: movieId,
    title: movie.title,
    year: year,
    localId: localId,
    genres: movie.genre_ids || [],
    people: peopleToProcess.map(p => ({
      ...p,
      creditCount: filmographies[p.id]?.creditCount || 0
    })),
    filmographies: filmographies,
    complete: true,
    cachedAt: Date.now()
  };
  
  // Cache the complete movie data
  await chrome.storage.local.set({ [localId]: movieData });
  
  console.log(`[Helper] Processed ${title}: ${peopleToProcess.length} people, ${Object.keys(filmographies).length} filmographies`);
  
  return movieData;
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getMovieData') {
    processMovieRequest(message.title, message.year, message.localId)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Will respond asynchronously
  }
  
  if (message.type === 'clearCache') {
    chrome.storage.local.clear()
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  
  if (message.type === 'getGenres') {
    sendResponse({ success: true, genres: GENRES });
    return false;
  }
});

console.log('[Helper] Background service worker loaded');

/**
 * Cine2Nerdle Helper - Content Script
 * Scrapes game state and displays connection options
 */

// State
let currentMovieId = null;
let movieData = null;
let linkUsage = {}; // Track how many times each person has been used as a link
let playedMovies = new Set();
let priorityFilters = { genres: [], decade: null };
let helperVisible = true;
let isSetupPhase = true;

// Top 5000 threshold - TMDB popularity score
// Based on research: popularity ~10+ is generally well-known films
// Being conservative here; adjust based on testing
const TOP_5000_POPULARITY_THRESHOLD = 8;

// Genre ID mapping (same as background)
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

const GENRE_IDS = Object.fromEntries(
  Object.entries(GENRES).map(([id, name]) => [name, parseInt(id)])
);

/**
 * Parse movie title and year from the game board
 */
function parseMovieTitle(text) {
  // Format: "Movie Title (YYYY)"
  const match = text.match(/^(.+?)\s*\((\d{4})\)$/);
  if (match) {
    return { title: match[1].trim(), year: parseInt(match[2]) };
  }
  return null;
}

/**
 * Get the current movie from the game board
 */
function getCurrentMovie() {
  const movieBoxes = document.querySelectorAll('.battle-board-movie');
  
  for (const box of movieBoxes) {
    if (box.classList.contains('battle-board-game-over')) continue;
    
    // Extract just the movie title (exclude child element text)
    let fullText = box.textContent;
    let childText = '';
    for (const child of box.children) {
      childText += child.textContent;
    }
    const movieText = fullText.substring(childText.length).trim();
    
    if (movieText) {
      return parseMovieTitle(movieText);
    }
  }
  return null;
}

/**
 * Get all connection names that have been used
 */
function getUsedConnections() {
  const connections = document.querySelectorAll('.connection-name');
  const used = {};
  
  for (const conn of connections) {
    const name = conn.textContent.trim().toLowerCase();
    if (name && !name.includes('more link')) {
      used[name] = (used[name] || 0) + 1;
    }
  }
  
  return used;
}

/**
 * Get all movies that have been played and count them
 */
function getPlayedMovies() {
  const played = new Set();
  const movieBoxes = document.querySelectorAll('.battle-board-movie');
  let count = 0;
  
  for (const box of movieBoxes) {
    if (box.classList.contains('battle-board-game-over')) continue;
    
    let fullText = box.textContent;
    let childText = '';
    for (const child of box.children) {
      childText += child.textContent;
    }
    const movieText = fullText.substring(childText.length).trim();
    
    if (movieText) {
      played.add(movieText.toLowerCase());
      count++;
    }
  }
  
  return { played, count };
}

/**
 * Check if it's currently the player's turn
 */
function isPlayerTurn() {
  return document.querySelector('.battle-input') !== null;
}

/**
 * Check if the game is over
 */
function isGameOver() {
  return document.querySelector('.battle-over') !== null ||
         document.querySelector('.battle-board-game-over') !== null;
}

/**
 * Check if a movie matches the priority filters
 */
function matchesPriorityFilter(movie) {
  if (priorityFilters.genres.length === 0 && !priorityFilters.decade) {
    return false; // No filter active
  }
  
  // Check all genre filters (must match ALL selected)
  for (const genreName of priorityFilters.genres) {
    const genreId = GENRE_IDS[genreName];
    if (!movie.genres.includes(genreId)) {
      return false;
    }
  }
  
  // Check decade filter
  if (priorityFilters.decade) {
    const movieDecade = Math.floor(movie.year / 10) * 10;
    if (movieDecade !== priorityFilters.decade) {
      return false;
    }
  }
  
  return true;
}

/**
 * Generate ranked connection options
 */
function generateOptions() {
  if (!movieData || !movieData.filmographies) return [];
  
  const options = [];
  const currentYear = new Date().getFullYear();
  const { played, count } = getPlayedMovies();
  const usedLinks = getUsedConnections();
  
  // Setup phase is first 3 turns (≤3 movies on board including starter)
  isSetupPhase = count <= 3;
  
  // Update our link tracking
  linkUsage = usedLinks;
  
  for (const person of movieData.people) {
    const filmography = movieData.filmographies[person.id];
    if (!filmography) continue;
    
    const personNameLower = person.name.toLowerCase();
    const timesUsed = linkUsage[personNameLower] || 0;
    
    // Skip if used 3 times
    if (timesUsed >= 3) continue;
    
    for (const credit of filmography.credits) {
      // Skip if already played
      const creditKey = `${credit.title} (${credit.year})`.toLowerCase();
      if (played.has(creditKey)) continue;
      
      // Skip unreleased movies
      if (credit.year >= currentYear) continue;
      
      // Skip the current movie
      if (credit.id === movieData.id) continue;
      
      // During setup phase, only show Top 5000 (high popularity)
      const isTop5000 = credit.popularity >= TOP_5000_POPULARITY_THRESHOLD;
      if (isSetupPhase && !isTop5000) continue;
      
      const isPriority = matchesPriorityFilter(credit);
      
      options.push({
        movie: {
          id: credit.id,
          title: credit.title,
          year: credit.year,
          genres: credit.genres,
          popularity: credit.popularity
        },
        via: {
          id: person.id,
          name: person.name,
          creditCount: filmography.creditCount,
          timesUsed: timesUsed
        },
        isPriority: isPriority,
        isTop5000: isTop5000,
        // Score: prioritize by filmography depth (more connections = more valuable)
        score: filmography.creditCount
      });
    }
  }
  
  // Sort: priority matches first, then by score (filmography depth)
  options.sort((a, b) => {
    if (a.isPriority && !b.isPriority) return -1;
    if (!a.isPriority && b.isPriority) return 1;
    return b.score - a.score;
  });
  
  // Dedupe movies (keep highest scoring connection for each)
  const seen = new Set();
  const deduped = [];
  for (const opt of options) {
    if (!seen.has(opt.movie.id)) {
      seen.add(opt.movie.id);
      deduped.push(opt);
    }
  }
  
  return deduped;
}

/**
 * Format genres for display
 */
function formatGenres(genreIds) {
  return genreIds
    .map(id => GENRES[id])
    .filter(Boolean)
    .slice(0, 3)
    .join(', ');
}

/**
 * Create the helper UI
 */
function createHelperUI() {
  // Remove existing helper
  const existing = document.getElementById('cine-helper');
  if (existing) existing.remove();
  
  const helper = document.createElement('div');
  helper.id = 'cine-helper';
  helper.innerHTML = `
    <div class="cine-helper-header">
      <span class="cine-helper-title">🎬 Cine2Nerdle Helper</span>
      <button class="cine-helper-toggle" title="Toggle helper">−</button>
    </div>
    <div class="cine-helper-content">
      <div class="cine-helper-phase-indicator" style="display: none;">
        ⚡ SETUP PHASE — Top 5000 films only
      </div>
      <div class="cine-helper-filters">
        <div class="cine-helper-filter-label">Priority Filter:</div>
        <div class="cine-helper-genres">
          ${Object.values(GENRES).map(g => `
            <label class="cine-helper-genre">
              <input type="checkbox" data-genre="${g}"> ${g}
            </label>
          `).join('')}
        </div>
        <div class="cine-helper-decade-row">
          <label>Decade: 
            <select class="cine-helper-decade">
              <option value="">Any</option>
              <option value="1950">1950s</option>
              <option value="1960">1960s</option>
              <option value="1970">1970s</option>
              <option value="1980">1980s</option>
              <option value="1990">1990s</option>
              <option value="2000">2000s</option>
              <option value="2010">2010s</option>
              <option value="2020">2020s</option>
            </select>
          </label>
          <button class="cine-helper-clear">Clear Filters</button>
        </div>
        <div class="cine-helper-active-filter"></div>
      </div>
      <div class="cine-helper-status">Waiting for game...</div>
      <div class="cine-helper-options"></div>
    </div>
  `;
  
  document.body.appendChild(helper);
  
  // Event listeners
  helper.querySelector('.cine-helper-toggle').addEventListener('click', () => {
    const content = helper.querySelector('.cine-helper-content');
    const btn = helper.querySelector('.cine-helper-toggle');
    if (content.style.display === 'none') {
      content.style.display = 'block';
      btn.textContent = '−';
    } else {
      content.style.display = 'none';
      btn.textContent = '+';
    }
  });
  
  helper.querySelectorAll('[data-genre]').forEach(checkbox => {
    checkbox.addEventListener('change', updateFilters);
  });
  
  helper.querySelector('.cine-helper-decade').addEventListener('change', updateFilters);
  helper.querySelector('.cine-helper-clear').addEventListener('click', clearFilters);
  
  loadSavedFilters();
}

/**
 * Load saved filters from storage
 */
async function loadSavedFilters() {
  try {
    const result = await chrome.storage.local.get(['priorityFilters']);
    if (result.priorityFilters) {
      priorityFilters = result.priorityFilters;
      
      // Update UI
      const helper = document.getElementById('cine-helper');
      if (helper) {
        for (const genre of priorityFilters.genres) {
          const checkbox = helper.querySelector(`[data-genre="${genre}"]`);
          if (checkbox) checkbox.checked = true;
        }
        if (priorityFilters.decade) {
          helper.querySelector('.cine-helper-decade').value = priorityFilters.decade;
        }
        updateActiveFilterDisplay();
      }
    }
  } catch (e) {
    console.error('[Helper] Failed to load filters:', e);
  }
}

/**
 * Update filters from UI
 */
function updateFilters() {
  const helper = document.getElementById('cine-helper');
  if (!helper) return;
  
  const genres = [];
  helper.querySelectorAll('[data-genre]:checked').forEach(cb => {
    genres.push(cb.dataset.genre);
  });
  
  const decadeSelect = helper.querySelector('.cine-helper-decade');
  const decade = decadeSelect.value ? parseInt(decadeSelect.value) : null;
  
  priorityFilters = { genres, decade };
  
  // Save to storage
  chrome.storage.local.set({ priorityFilters });
  
  updateActiveFilterDisplay();
  updateOptionsDisplay();
}

/**
 * Clear all filters
 */
function clearFilters() {
  const helper = document.getElementById('cine-helper');
  if (!helper) return;
  
  helper.querySelectorAll('[data-genre]').forEach(cb => cb.checked = false);
  helper.querySelector('.cine-helper-decade').value = '';
  
  priorityFilters = { genres: [], decade: null };
  chrome.storage.local.set({ priorityFilters });
  
  updateActiveFilterDisplay();
  updateOptionsDisplay();
}

/**
 * Update the active filter display
 */
function updateActiveFilterDisplay() {
  const helper = document.getElementById('cine-helper');
  if (!helper) return;
  
  const display = helper.querySelector('.cine-helper-active-filter');
  const parts = [];
  
  if (priorityFilters.genres.length > 0) {
    parts.push(priorityFilters.genres.join(' + '));
  }
  if (priorityFilters.decade) {
    parts.push(`${priorityFilters.decade}s`);
  }
  
  if (parts.length > 0) {
    display.textContent = `Active: ${parts.join(' • ')}`;
    display.style.display = 'block';
  } else {
    display.style.display = 'none';
  }
}

/**
 * Update the status display
 */
function updateStatus(message, isError = false) {
  const helper = document.getElementById('cine-helper');
  if (!helper) return;
  
  const status = helper.querySelector('.cine-helper-status');
  status.textContent = message;
  status.className = 'cine-helper-status' + (isError ? ' error' : '');
}

/**
 * Update the options display
 */
function updateOptionsDisplay() {
  const helper = document.getElementById('cine-helper');
  if (!helper) return;
  
  const container = helper.querySelector('.cine-helper-options');
  const phaseIndicator = helper.querySelector('.cine-helper-phase-indicator');
  const options = generateOptions();
  
  // Show/hide setup phase indicator
  if (phaseIndicator) {
    phaseIndicator.style.display = isSetupPhase ? 'block' : 'none';
  }
  
  if (options.length === 0) {
    container.innerHTML = '<div class="cine-helper-empty">No connections found</div>';
    return;
  }
  
  // Split into priority and other
  const priority = options.filter(o => o.isPriority);
  const other = options.filter(o => !o.isPriority);
  
  let html = '';
  
  if (priority.length > 0) {
    html += `<div class="cine-helper-section-header">🎯 Priority Matches (${priority.length})</div>`;
    html += priority.slice(0, 20).map(opt => renderOption(opt, true)).join('');
  }
  
  if (other.length > 0) {
    html += `<div class="cine-helper-section-header">Other Connections (${other.length})</div>`;
    html += other.slice(0, 30).map(opt => renderOption(opt, false)).join('');
  }
  
  container.innerHTML = html;
}

/**
 * Render a single option
 */
function renderOption(opt, isPriority) {
  const linkWarning = opt.via.timesUsed === 2 ? ' ⚠️ 2/3' : '';
  const genres = formatGenres(opt.movie.genres);
  const popScore = opt.movie.popularity.toFixed(1);
  
  return `
    <div class="cine-helper-option ${isPriority ? 'priority' : ''}">
      <div class="cine-helper-option-movie">
        ${opt.movie.title} (${opt.movie.year})
      </div>
      <div class="cine-helper-option-via">
        via <strong>${opt.via.name}</strong> (${opt.via.creditCount} credits)${linkWarning}
      </div>
      <div class="cine-helper-option-meta">
        <span class="cine-helper-option-genres">${genres}</span>
        <span class="cine-helper-option-pop" title="TMDB Popularity">📊 ${popScore}</span>
      </div>
    </div>
  `;
}

/**
 * Request movie data from background script
 */
async function requestMovieData(title, year) {
  const localId = `${title} (${year})`;
  
  updateStatus(`Loading: ${title} (${year})...`);
  
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'getMovieData',
      title,
      year,
      localId
    });
    
    if (response.success) {
      movieData = response.data;
      currentMovieId = localId;
      updateStatus(`Loaded: ${movieData.people.length} cast/crew`);
      updateOptionsDisplay();
    } else {
      updateStatus(`Error: ${response.error}`, true);
    }
  } catch (err) {
    updateStatus(`Error: ${err.message}`, true);
  }
}

/**
 * Main update loop
 */
async function update() {
  // Create UI if not exists
  if (!document.getElementById('cine-helper')) {
    createHelperUI();
  }
  
  // Check game state
  if (isGameOver()) {
    updateStatus('Game over');
    // Reset for next game
    currentMovieId = null;
    movieData = null;
    linkUsage = {};
    isSetupPhase = true;
    return;
  }
  
  if (!isPlayerTurn()) {
    updateStatus("Opponent's turn...");
    return;
  }
  
  // Get current movie
  const movie = getCurrentMovie();
  if (!movie) {
    updateStatus('Waiting for movie...');
    return;
  }
  
  const localId = `${movie.title} (${movie.year})`;
  
  // Only fetch if movie changed
  if (localId !== currentMovieId) {
    await requestMovieData(movie.title, movie.year);
  }
}

// Initialize
console.log('[Cine2Nerdle Helper] Content script loaded');
createHelperUI();
setInterval(update, 500);

/**
 * Cine2Nerdle Helper - Popup Script
 * Handles settings and configuration
 */

const apiKeyInput = document.getElementById('api-key');
const saveBtn = document.getElementById('save-btn');
const clearCacheBtn = document.getElementById('clear-cache-btn');
const statusDiv = document.getElementById('status');

function showStatus(message, type = 'info') {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  statusDiv.style.display = 'block';
  
  if (type === 'success') {
    setTimeout(() => {
      statusDiv.style.display = 'none';
    }, 3000);
  }
}

// Load saved API key
chrome.storage.local.get(['tmdb_api_key']).then(result => {
  if (result.tmdb_api_key) {
    // Show masked version
    apiKeyInput.value = result.tmdb_api_key.substring(0, 20) + '...';
    apiKeyInput.dataset.hasKey = 'true';
  }
});

// Clear input on focus if showing masked key
apiKeyInput.addEventListener('focus', () => {
  if (apiKeyInput.dataset.hasKey === 'true') {
    apiKeyInput.value = '';
    apiKeyInput.type = 'text';
  }
});

// Save API key
saveBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  
  if (!key || key.endsWith('...')) {
    showStatus('Please enter a valid API key', 'error');
    return;
  }
  
  // Basic validation - TMDB read tokens start with 'eyJ'
  if (!key.startsWith('eyJ')) {
    showStatus('This doesn\'t look like a TMDB Read Access Token. Make sure you\'re using the token, not the API key.', 'error');
    return;
  }
  
  try {
    await chrome.storage.local.set({ tmdb_api_key: key });
    showStatus('API key saved!', 'success');
    apiKeyInput.value = key.substring(0, 20) + '...';
    apiKeyInput.dataset.hasKey = 'true';
    apiKeyInput.type = 'password';
  } catch (err) {
    showStatus('Failed to save: ' + err.message, 'error');
  }
});

// Clear cache
clearCacheBtn.addEventListener('click', async () => {
  if (!confirm('This will clear all cached movie data. Continue?')) {
    return;
  }
  
  try {
    // Get the API key first so we can preserve it
    const result = await chrome.storage.local.get(['tmdb_api_key', 'priorityFilters']);
    
    // Clear everything
    await chrome.storage.local.clear();
    
    // Restore API key and filters
    if (result.tmdb_api_key) {
      await chrome.storage.local.set({ tmdb_api_key: result.tmdb_api_key });
    }
    if (result.priorityFilters) {
      await chrome.storage.local.set({ priorityFilters: result.priorityFilters });
    }
    
    showStatus('Cache cleared!', 'success');
  } catch (err) {
    showStatus('Failed to clear cache: ' + err.message, 'error');
  }
});

import { saveBlockedKeywords, getBlockedKeywords, removeKeyword, getKeywordHistory, saveKeywordHistory } from '../utils/storage.js';

// Theme management functions
function applyTheme(theme) {
  console.log('[SpoilWipe][Popup][Theme] Applying theme:', theme);
  
  // Remove existing theme stylesheets
  const existingLightTheme = document.getElementById('spoilwatch-popup-light-theme');
  if (existingLightTheme) {
    existingLightTheme.remove();
  }
  
  if (theme === 'light') {
    // Add light theme stylesheet
    const lightThemeLink = document.createElement('link');
    lightThemeLink.id = 'spoilwatch-popup-light-theme';
    lightThemeLink.rel = 'stylesheet';
    lightThemeLink.type = 'text/css';
    lightThemeLink.href = chrome.runtime.getURL('popup/popup-light-theme.css');
    document.head.appendChild(lightThemeLink);
    console.log('[SpoilWipe][Popup][Theme] Light theme applied');
  } else if (theme === 'auto') {
    // Check system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (!prefersDark) {
      // Apply light theme if system prefers light
      const lightThemeLink = document.createElement('link');
      lightThemeLink.id = 'spoilwatch-popup-light-theme';
      lightThemeLink.rel = 'stylesheet';
      lightThemeLink.type = 'text/css';
      lightThemeLink.href = chrome.runtime.getURL('popup/popup-light-theme.css');
      document.head.appendChild(lightThemeLink);
      console.log('[SpoilWipe][Popup][Theme] Auto theme: system prefers light, applied light theme');
    } else {
      console.log('[SpoilWipe][Popup][Theme] Auto theme: system prefers dark, using default dark theme');
    }
  } else {
    // Dark theme (default) - no additional stylesheet needed
    console.log('[SpoilWipe][Popup][Theme] Dark theme applied (default)');
  }
}

// Load and apply theme settings
async function loadThemeSettings() {
  try {
    const settings = await new Promise((resolve) => {
      chrome.storage.sync.get(['spoilwatchSettings'], (res) => {
        resolve(res.spoilwatchSettings || getDefaultSettings());
      });
    });
    
    applyTheme(settings.theme);
    console.log('[SpoilWipe][Popup][Theme] Theme settings loaded:', settings.theme);
  } catch (error) {
    console.error('[SpoilWipe][Popup][Theme] Error loading theme settings:', error);
  }
}

function getDefaultSettings() {
  return {
    autoBlockEnabled: true,
    partialMatchEnabled: true,
    blockSensitivity: 'normal',
    theme: 'auto',
    animationsEnabled: true,
    warningStyle: 'compact',
    youtubeEnabled: true,
    trendingKeywordsEnabled: true,
    trendingUpdateFrequency: 'weekly',
    analyticsEnabled: true
  };
}

// DOM elements
const keywordInput = document.getElementById('keyword');
const saveBtn = document.getElementById('saveBtn');
const statusDiv = document.getElementById('status');
const btnText = document.querySelector('.btn-text');
const btnLoader = document.querySelector('.btn-loader');
const keywordsChips = document.getElementById('keywordsChips');
const noKeywordsMsg = document.getElementById('noKeywordsMsg');

// Load existing keywords when popup opens
async function loadExistingKeywords() {
  try {
    const existingKeywords = await getBlockedKeywords();
    if (existingKeywords.length > 0) {
      displayKeywords(existingKeywords);
    }
  } catch (error) {
    console.error('Error loading keywords:', error);
  }
}

// Display keywords in a nice format with trash can buttons
function displayKeywords(keywords) {
  keywordsChips.innerHTML = '';
  if (!keywords || keywords.length === 0) {
    noKeywordsMsg.classList.remove('hidden');
    return;
  }
  noKeywordsMsg.classList.add('hidden');
  keywords.forEach(keyword => {
    const chip = document.createElement('span');
    chip.className = 'keyword-chip';
    chip.textContent = keyword;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'chip-remove-btn';
    removeBtn.title = 'Remove keyword';
    removeBtn.innerHTML = '&times;';
    removeBtn.addEventListener('click', () => handleRemoveKeyword({ currentTarget: removeBtn, keyword }));
    chip.appendChild(removeBtn);
    keywordsChips.appendChild(chip);
  });
}

// Handle keyword removal
async function handleRemoveKeyword(event) {
  const keywordToRemove = event.keyword || event.currentTarget.getAttribute('data-keyword');
  const button = event.currentTarget;
  
  // Show loading state on the button
  button.disabled = true;
  button.innerHTML = '<span class="loading-dots">...</span>';
  
  try {
    const updatedKeywords = await removeKeyword(keywordToRemove);
    displayKeywords(updatedKeywords);
    
    // Show success message
    showSuccess(`Removed "${keywordToRemove}"`);
  } catch (error) {
    console.error('Error removing keyword:', error);
    showError('Failed to remove keyword. Please try again.');
    
    // Reset button state
    button.disabled = false;
    button.innerHTML = '&times;';
  }
}

// Mini popup logic
function showMiniPopup(keyword) {
  // Prevent duplicate mini popups
  if (document.getElementById('spoilwatch-mini-popup')) return;

  // Create mini popup element
  const mini = document.createElement('div');
  mini.id = 'spoilwatch-mini-popup';
  mini.innerHTML = `<div class="mini-popup-content">Keyword "<b>${keyword}</b>" added!</div>`;
  document.body.appendChild(mini);

  // Position to the left of the main popup
  mini.style.position = 'fixed';
  mini.style.top = '50%';
  mini.style.right = '340px'; // adjust as needed for your popup width
  mini.style.transform = 'translateY(-50%)';
  mini.style.background = 'var(--midnight-card, #fff)';
  mini.style.color = 'var(--midnight-text, #1a202c)';
  mini.style.border = '1.5px solid var(--midnight-border, #e2e8f0)';
  mini.style.borderRadius = '12px';
  mini.style.boxShadow = '0 4px 16px rgba(0,0,0,0.10)';
  mini.style.padding = '14px 22px';
  mini.style.zIndex = '99999';
  mini.style.fontSize = '15px';
  mini.style.fontWeight = '600';
  mini.style.opacity = '0.98';
  mini.style.pointerEvents = 'auto';
  mini.style.transition = 'opacity 0.2s';

  // Auto-hide after 3 seconds
  setTimeout(() => {
    mini.style.opacity = '0';
    setTimeout(() => mini.remove(), 300);
  }, 3000);
}

// Listen for popup unload to set flag
window.addEventListener('unload', () => {
  chrome.storage.local.set({ spoilwatchMiniPopupDismissed: true });
});

// Save keywords and update display
async function saveKeywords() {
  const input = keywordInput.value.trim();
  
  if (!input) {
    showError('Please enter at least one keyword');
    return;
  }

  // Show loading state
  setLoadingState(true);
  
  try {
    // Get existing keywords
    const existingKeywords = await getBlockedKeywords();
    // Get keyword history
    const keywordHistory = await getKeywordHistory();
    
    // Parse new keywords
    const newKeywords = input.split(',')
      .map(w => w.trim().toLowerCase())
      .filter(w => w.length > 0);
    
    // Combine existing and new keywords, remove duplicates
    const allKeywords = [...new Set([...existingKeywords, ...newKeywords])];
    
    // Update keyword history (append new ones if not present)
    const updatedHistory = [...keywordHistory];
    newKeywords.forEach(kw => {
      if (!updatedHistory.includes(kw)) updatedHistory.push(kw);
    });
    await saveKeywordHistory(updatedHistory);
    
    // Save to storage
    await saveBlockedKeywords(allKeywords);
    
    // Reset input
    keywordInput.value = '';
    
    // Show success with updated keywords
    displayKeywords(allKeywords);
    
    // Show success message briefly
    showSuccess(`Added ${newKeywords.length} new keyword${newKeywords.length > 1 ? 's' : ''}!`);

    // Mini popup logic: only show if not dismissed
    if (newKeywords.length > 0) {
      chrome.storage.local.get('spoilwatchMiniPopupDismissed', (res) => {
        if (!res.spoilwatchMiniPopupDismissed) {
          showMiniPopup(newKeywords[0]);
        }
        // Reset flag so next time user enters a keyword, mini popup can show again
        chrome.storage.local.set({ spoilwatchMiniPopupDismissed: false });
      });
    }
    
  } catch (error) {
    console.error('Error saving keywords:', error);
    showError('Failed to save keywords. Please try again.');
  } finally {
    setLoadingState(false);
  }
}

// Show success message
function showSuccess(message) {
  const successMsg = document.createElement('div');
  successMsg.className = 'success-message';
  successMsg.textContent = message;
  statusDiv.appendChild(successMsg);
  
  // Remove success message after 3 seconds
  setTimeout(() => {
    if (successMsg.parentNode) {
      successMsg.remove();
    }
  }, 3000);
}

// Show error message
function showError(message) {
  statusDiv.innerHTML = `<span class="error-text">${message}</span>`;
  statusDiv.className = 'status error';
  statusDiv.classList.remove('hidden');
}

// Set loading state
function setLoadingState(loading) {
  if (loading) {
    btnText.textContent = 'Saving...';
    btnLoader.classList.remove('hidden');
    saveBtn.disabled = true;
  } else {
    btnText.textContent = 'Save Keywords';
    btnLoader.classList.add('hidden');
    saveBtn.disabled = false;
  }
}

// Event listeners
saveBtn.addEventListener('click', saveKeywords);

// Load existing keywords when popup opens
document.addEventListener('DOMContentLoaded', loadExistingKeywords);

// Load theme settings when popup opens
document.addEventListener('DOMContentLoaded', loadThemeSettings);

// Set up system theme change listener for auto theme
const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
mediaQuery.addEventListener('change', async () => {
  // Get current settings to check if theme is set to auto
  const settings = await new Promise((resolve) => {
    chrome.storage.sync.get(['spoilwatchSettings'], (res) => {
      resolve(res.spoilwatchSettings || getDefaultSettings());
    });
  });
  
  if (settings.theme === 'auto') {
    applyTheme('auto');
    console.log('[SpoilWipe][Popup][Theme] System theme changed, auto theme updated');
  }
});

document.addEventListener('DOMContentLoaded', function() {
  const fullscreenBtn = document.getElementById('spoilwatch-fullscreen-btn');
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', function() {
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        chrome.tabs.sendMessage(tabs[0].id, {action: 'show_fullscreen_overlay'});
      });
    });
  }
});

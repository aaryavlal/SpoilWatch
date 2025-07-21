import { saveBlockedKeywords, getBlockedKeywords, removeKeyword, getKeywordHistory, saveKeywordHistory } from '../utils/storage.js';

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

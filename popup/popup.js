import { saveBlockedKeywords, getBlockedKeywords, removeKeyword } from '../utils/storage.js';

// DOM elements
const keywordInput = document.getElementById('keyword');
const saveBtn = document.getElementById('saveBtn');
const statusDiv = document.getElementById('status');
const btnText = document.querySelector('.btn-text');
const btnLoader = document.querySelector('.btn-loader');

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
  if (keywords.length === 0) {
    statusDiv.innerHTML = '<span class="no-keywords">No keywords stored yet</span>';
    statusDiv.className = 'status info';
    statusDiv.classList.remove('hidden');
    return;
  }

  const keywordsList = keywords.map(keyword => 
    `<div class="keyword-item">
      <span class="keyword-tag">${keyword}</span>
      <button class="remove-btn" data-keyword="${keyword}" title="Remove keyword">
        <span class="trash-icon">🗑️</span>
      </button>
    </div>`
  ).join('');

  statusDiv.innerHTML = `
    <div class="keywords-display">
      <div class="keywords-header">Stored Keywords (${keywords.length}):</div>
      <div class="keywords-list">${keywordsList}</div>
    </div>
  `;
  statusDiv.className = 'status success';
  statusDiv.classList.remove('hidden');

  // Add event listeners to remove buttons
  statusDiv.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', handleRemoveKeyword);
  });
}

// Handle keyword removal
async function handleRemoveKeyword(event) {
  const keywordToRemove = event.currentTarget.getAttribute('data-keyword');
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
    button.innerHTML = '<span class="trash-icon">🗑️</span>';
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
    
    // Parse new keywords
    const newKeywords = input.split(',')
      .map(w => w.trim().toLowerCase())
      .filter(w => w.length > 0);
    
    // Combine existing and new keywords, remove duplicates
    const allKeywords = [...new Set([...existingKeywords, ...newKeywords])];
    
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

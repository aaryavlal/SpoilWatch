// SpoilWipe content script loaded successfully

// Storage functions for getting blocked keywords
function getBlockedKeywords() {
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.get(['blocked'], (res) => {
        if (chrome.runtime.lastError) {
          console.error('SpoilWipe: Storage error:', chrome.runtime.lastError);
          resolve([]);
          return;
        }
        resolve(res.blocked || []);
      });
    } catch (error) {
      console.error('SpoilWipe: Error in getBlockedKeywords:', error);
      resolve([]);
    }
  });
}

// Checks if any tags match the blocked keywords
function shouldBlock(tagsOnPage, blockedKeywords) {
  if (!tagsOnPage || !blockedKeywords || tagsOnPage.length === 0 || blockedKeywords.length === 0) {
    console.log('SpoilWipe: shouldBlock returning false - missing data:', {
      tagsOnPage,
      blockedKeywords,
      tagsLength: tagsOnPage?.length || 0,
      keywordsLength: blockedKeywords?.length || 0
    });
    return false;
  }

  const COMMON_WORDS = ['i', 'am', 'the', 'and', 'of', 'in', 'it', 'on', 'to'];

  const result = tagsOnPage.some(tag => {
    const cleanTag = tag.replace('#', '').toLowerCase().trim();
    if (!cleanTag || COMMON_WORDS.includes(cleanTag)) return false;

    return blockedKeywords.some(keyword => {
      const cleanKeyword = keyword.toLowerCase().trim();
      if (!cleanKeyword || COMMON_WORDS.includes(cleanKeyword)) return false;

      // Check for exact match
      if (cleanTag === cleanKeyword) return true;

      // Check for partial match if both are at least 4 characters
      if (
        cleanTag.length >= 4 && cleanKeyword.length >= 4 &&
        (cleanTag.includes(cleanKeyword) || cleanKeyword.includes(cleanTag))
      ) {
        console.log('SpoilWipe: Safe partial match:', cleanTag, '<=>', cleanKeyword);
        return true;
      }

      // Check for word-level matches
      const tagWords = cleanTag.split(/[\s\-_]+/);
      const keywordWords = cleanKeyword.split(/[\s\-_]+/);

      for (const tagWord of tagWords) {
        for (const keywordWord of keywordWords) {
          if (
            COMMON_WORDS.includes(tagWord) ||
            COMMON_WORDS.includes(keywordWord)
          ) continue;

          // Exact word match
          if (tagWord === keywordWord) return true;

          // Partial word match (at least 4 characters)
          if (
            tagWord.length >= 4 &&
            keywordWord.length >= 4 &&
            (tagWord.includes(keywordWord) || keywordWord.includes(tagWord))
          ) {
            console.log('SpoilWipe: Word match found:', tagWord, 'matches', keywordWord);
            return true;
          }
        }
      }

      return false;
    });
  });

  console.log('SpoilWipe: shouldBlock final result:', result);
  return result;
}

// Selectors for YouTube Shorts elements
const YOUTUBE_SELECTORS = {
  video: 'video, .html5-video-container, ytd-player, .ytd-player, .video-stream, .html5-main-video, #movie_player, .ytp-video',
  title: 'h1.ytd-video-primary-info-renderer, .ytd-video-primary-info-renderer h1, .ytd-shorts h1, ytd-video-primary-info-renderer h1, ytd-shorts h1, #title h1, #title, .title, ytd-video-primary-info-renderer, .ytd-video-primary-info-renderer',
  description: '#description-text, .ytd-video-secondary-info-renderer #description, .ytd-shorts #description, ytd-video-secondary-info-renderer #description, #description, .description, ytd-video-secondary-info-renderer, .ytd-video-secondary-info-renderer, ytd-video-secondary-info-renderer',
  hashtags: '.ytd-video-secondary-info-renderer a[href*="/hashtag/"], .ytd-shorts a[href*="/hashtag/"], a[href*="/hashtag/"], .ytd-video-secondary-info-renderer a, .ytd-shorts a',
  shortsTitle: '.ytd-shorts h1, .ytd-shorts .title, ytd-shorts h1, ytd-shorts #title',
  shortsDescription: '.ytd-shorts #description, .ytd-shorts .description, ytd-shorts #description, ytd-shorts .description-text',
  comments: '#content-text, .ytd-comment-thread-renderer #content-text, ytd-comment-thread-renderer #content-text',
  textContainers: 'p, span, div, h1, h2, h3, h4, h5, h6, a, ytd-video-secondary-info-renderer, .ytd-video-secondary-info-renderer'
};

// Scans for hashtags in the title, description, and hashtag links
function debugScanForHashtags() {
  console.log('SpoilWipe: Starting hashtag scan...');
  let foundHashtags = [];

  // Only scan title, description, and hashtag elements
  const selectors = [
    YOUTUBE_SELECTORS.title,
    YOUTUBE_SELECTORS.description,
    YOUTUBE_SELECTORS.hashtags
  ];
  selectors.forEach(selector => {
    document.querySelectorAll(selector).forEach(element => {
      if (element && element.textContent) {
        const text = element.textContent;
        const hashtags = text.match(/#[\w]+/g);
        if (hashtags && hashtags.length > 0) {
          foundHashtags.push({
            element,
            text: text.substring(0, 100),
            hashtags,
            tagName: element.tagName,
            className: element.className,
            id: element.id
          });
          console.log('SpoilWipe: Found hashtags in', selector, ':', hashtags);
        }
      }
    });
  });

  // No need to scan all elements, just the relevant ones above
  console.log('SpoilWipe: Total elements with hashtags found:', foundHashtags.length);
  return foundHashtags;
}

// Extracts hashtags and keyword-like words from text
function extractHashtags(text) {
  if (!text) {
    console.log('SpoilWipe: extractHashtags - no text provided');
    return [];
  }
  // Remove emojis from the text
  const emojiRegex = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;
  text = text.replace(emojiRegex, '');

  // Find hashtags
  const hashtagRegex = /#[\w\u0590-\u05ff\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\u1100-\u11ff\u3130-\u318f\uac00-\ud7af\u4e00-\u9fff]+/g;
  const matches = text.match(hashtagRegex) || [];
  const hashtags = matches.map(tag => tag.toLowerCase());

  // Also check for keyword-like words (no emoji)
  const words = text.toLowerCase().split(/\s+/);
  const keywordMatches = words.filter(word => {
    const cleanWord = word.replace(/[^\w]/g, '');
    return cleanWord.length > 0;
  });

  const result = [...hashtags, ...keywordMatches];
  console.log('SpoilWipe: extractHashtags result:', {
    originalText: text.substring(0, 100) + '...',
    hashtags: hashtags,
    keywordMatches: keywordMatches,
    finalResult: result
  });

  return result;
}

// Gets all text from an element
function extractTextFromElement(element) {
  if (!element) return '';
  let text = '';
  if (element.childNodes.length === 1 && element.childNodes[0].nodeType === Node.TEXT_NODE) {
    text = element.textContent || element.innerText || '';
  } else {
    text = element.textContent || element.innerText || '';
  }
  return text.trim();
}

// Checks if an element should be blocked based on hashtags/keywords
function shouldBlockElement(element, blockedKeywords) {
  if (!element || !blockedKeywords || blockedKeywords.length === 0) return false;
  const text = extractTextFromElement(element);
  const hashtags = extractHashtags(text);
  if (hashtags.length > 0) {
    console.log('SpoilWipe: Found hashtags/keywords:', hashtags, 'in element:', element);
    console.log('SpoilWipe: Element text:', text.substring(0, 100) + '...');
  }
  return shouldBlock(hashtags, blockedKeywords);
}

function applyBlocking(element, blockedKeywords) {
  if (shouldBlockElement(element, blockedKeywords)) {
    console.log('SpoilWipe: Blocking element with hashtags:', element);
    
    // Check if we already have a video blocked on this page
    const existingVideoBlock = document.querySelector('[data-spoilwatch-video-blocked]');
    if (existingVideoBlock) {
      console.log('SpoilWipe: Video already blocked, skipping');
      return;
    }
    
    // Find the actual video element to blur
    const videoElement = findVideoElement();
    if (!videoElement) {
      console.log('SpoilWipe: No video element found to block');
      return;
    }
    
    console.log('SpoilWipe: Found video element to block:', videoElement);
    
currentBlockedVideoElement = videoElement;


    // Apply blur to the video element
    videoElement.style.filter = 'blur(12px)';
    videoElement.style.pointerEvents = 'auto';
    videoElement.style.userSelect = 'auto';
    videoElement.style.position = 'relative';
    
    // Mark this as the main video block
    videoElement.setAttribute('data-spoilwatch-video-blocked', 'true');
    
    // Add a warning overlay to the video element
    const overlay = document.createElement('div');
    overlay.className = 'spoilwatch-overlay';
    overlay.innerHTML = `
      <div class="spoilwatch-warning">
        <div class="spoilwatch-icon">⚠️</div>
        <div class="spoilwatch-title">SPOILER WARNING</div>
        <div class="spoilwatch-text">This video contains spoiler content</div>
        <button class="spoilwatch-watch-btn">
          Watch Anyway
        </button>
      </div>
    `;
    overlay.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 0, 0, 0.9);
      border: 3px solid #ff6b6b;
      border-radius: 16px;
      padding: 24px;
      color: white;
      text-align: center;
      z-index: 9999;
      min-width: 280px;
      max-width: 320px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(10px);
      pointer-events: auto;
    `;
    
    // Add event listener to the Watch Anyway button
    const watchBtn = overlay.querySelector('.spoilwatch-watch-btn');
    watchBtn.addEventListener('click', function() {
      console.log('SpoilWipe: User clicked Watch Anyway button');
      
      // Remove the overlay
      overlay.remove();
      
      // Remove blur from video
      videoElement.style.filter = 'none';
      
      // Remove the blocked attribute
      videoElement.removeAttribute('data-spoilwatch-video-blocked');
      
      // Mark as checked so it doesn't re-block
      hasCheckedCurrentVideo = true;
      
      console.log('SpoilWipe: Video unblocked by user');
    });
    
    videoElement.appendChild(overlay);
    
    // Force the overlay to be visible by ensuring the video element has proper positioning
    if (videoElement.style.position === 'static' || !videoElement.style.position) {
      videoElement.style.position = 'relative';
    }
    
    console.log('SpoilWipe: Overlay added to video element:', videoElement);
    console.log('SpoilWipe: Overlay element:', overlay);
    
    // Fallback: If overlay is not visible after a short delay, append to body instead
    setTimeout(() => {
      if (!overlay.isConnected || overlay.offsetParent === null) {
        console.log('SpoilWipe: Overlay not visible, trying fallback to body');
        
        // Remove from video element
        if (overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
        
        // Update positioning for body placement
        overlay.style.position = 'fixed';
        overlay.style.top = '50%';
        overlay.style.left = '50%';
        overlay.style.transform = 'translate(-50%, -50%)';
        overlay.style.zIndex = '99999';
        
        // Append to body
        document.body.appendChild(overlay);
        console.log('SpoilWipe: Overlay added to body as fallback');
      }
    }, 100);
    
    // Add styles for the warning elements (only once)
    if (!document.querySelector('style[data-spoilwatch-styles]')) {
      const style = document.createElement('style');
      style.setAttribute('data-spoilwatch-styles', 'true');
      style.textContent = `
        .spoilwatch-warning {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }
        .spoilwatch-icon {
          font-size: 32px;
          margin-bottom: 8px;
        }
        .spoilwatch-title {
          font-size: 18px;
          font-weight: bold;
          color: #ff6b6b;
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        .spoilwatch-text {
          font-size: 14px;
          color: #e0e0e0;
          margin-bottom: 8px;
        }
        .spoilwatch-watch-btn {
          background: linear-gradient(135deg, #667eea, #9f7aea);
          border: none;
          border-radius: 8px;
          padding: 10px 20px;
          color: white;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
        }
        .spoilwatch-watch-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
          background: linear-gradient(135deg, #5a67d8, #8b5cf6);
        }
        .spoilwatch-watch-btn:active {
          transform: translateY(0);
        }
      `;
      document.head.appendChild(style);
    }
  }
}

let currentBlockedVideoElement = null;



function isElementInViewport(el) {
  const rect = el.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}


// Helper function to find the actual video element
function findVideoElement() {
  // Try multiple selectors to find the video element
  const selectors = [
    'video',
    '.html5-video-container',
    'ytd-player',
    '.ytd-player',
    '.video-stream',
    '.html5-main-video',
    '#movie_player',
    '.ytp-video',
    'ytd-shorts video',
    '.ytd-shorts video',
    'ytd-video-primary-info-renderer video',
    '.ytd-video-primary-info-renderer video'
  ];
  
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      console.log('SpoilWipe: Found video element with selector:', selector, element);
      return element;
    }
  }
  
  // If no video element found with selectors, try to find it by looking for the main video container
  const videoContainers = document.querySelectorAll('*');
  for (const container of videoContainers) {
    if (container.tagName === 'VIDEO' || 
        container.classList.contains('html5-video-container') ||
        container.classList.contains('video-stream') ||
        container.id === 'movie_player') {
      console.log('SpoilWipe: Found video element by scanning:', container);
      return container;
    }
  }
  
  console.log('SpoilWipe: No video element found');
  return null;
}

// Track current video to prevent duplicate detection
let currentVideoId = null;
let hasCheckedCurrentVideo = false;
let videoCheckInterval = null;
let lastLoggedVideoId = null;

function getCurrentVideoId() {
  // Extract video ID from URL
  const url = window.location.href;
  const match = url.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

function clearAllBlocks() {
  console.log('SpoilWipe: Clearing all previous blocks');

  // Remove all blocking styles and overlays from any video element
  document.querySelectorAll('video, .html5-video-container, .video-stream, .html5-main-video, #movie_player, .ytp-video').forEach(el => {
    console.log('SpoilWipe: Clearing video element:', el);
    el.style.filter = '';
    el.style.pointerEvents = '';
    el.style.userSelect = '';
    el.style.position = '';
    el.removeAttribute('data-spoilwatch-video-blocked');
    // Remove overlays inside video containers
    el.querySelectorAll('.spoilwatch-overlay').forEach(overlay => overlay.remove());
  });

  // Remove overlays attached directly to the body (fallback overlays)
  document.querySelectorAll('.spoilwatch-overlay').forEach(overlay => overlay.remove());

  // Remove all debug outlines and attributes
  document.querySelectorAll('[data-spoilwatch-debug]').forEach(el => {
    el.style.outline = '';
    el.removeAttribute('data-spoilwatch-debug');
  });

  // Remove added styles
  const existingStyle = document.querySelector('style[data-spoilwatch-styles]');
  if (existingStyle) existingStyle.remove();

  // Reset the check flag and blocked element
  hasCheckedCurrentVideo = false;
  currentBlockedVideoElement = null;

  console.log('SpoilWipe: All blocks cleared and state reset');
}

// Continuous video monitoring function
function monitorVideoChanges() {
  const newVideoId = getCurrentVideoId();

  if (!newVideoId) return;

  if (newVideoId !== currentVideoId) {
    // Cleanup when video changes
    document.querySelectorAll('video, .html5-video-container, .video-stream, .html5-main-video, #movie_player, .ytp-video').forEach(el => {
      el.style.filter = '';
      el.style.pointerEvents = '';
      el.style.userSelect = '';
      el.style.position = '';
      el.removeAttribute('data-spoilwatch-video-blocked');
      el.querySelectorAll('.spoilwatch-overlay').forEach(overlay => overlay.remove());
    });
    document.querySelectorAll('.spoilwatch-overlay').forEach(overlay => overlay.remove());

    console.log('SpoilWipe: New video detected! Old ID:', currentVideoId, 'New ID:', newVideoId);
    currentVideoId = newVideoId;
    hasCheckedCurrentVideo = false;
    lastLoggedVideoId = null;
    // Add a short delay to allow DOM to update before scanning
    setTimeout(() => {
      checkYouTubeShorts();
      lastVideoId = newVideoId;
    }, 225);
  } else {
    if (lastLoggedVideoId !== currentVideoId) {
      lastLoggedVideoId = currentVideoId;
    }
  }
}


function checkYouTubeShorts() {
  // Cleanup at the start to catch any new video element
  document.querySelectorAll('video, .html5-video-container, .video-stream, .html5-main-video, #movie_player, .ytp-video').forEach(el => {
    el.style.filter = '';
    el.style.pointerEvents = '';
    el.style.userSelect = '';
    el.style.position = '';
    el.removeAttribute('data-spoilwatch-video-blocked');
    el.querySelectorAll('.spoilwatch-overlay').forEach(overlay => overlay.remove());
  });
  document.querySelectorAll('.spoilwatch-overlay').forEach(overlay => overlay.remove());

  console.log('checkYouTubeShorts:', { currentVideoId, hasCheckedCurrentVideo });
  // If no video ID, skip
  if (!currentVideoId) {
    console.log('SpoilWipe: No current video ID, skipping check');
    return;
  }
  // If already checked this video, skip
  if (hasCheckedCurrentVideo) {
    console.log('SpoilWipe: Video already checked, skipping');
    return;
  }
  
  console.log('SpoilWipe: Starting YouTube Shorts check for video:', currentVideoId);
  
  getBlockedKeywords().then(blockedKeywords => {
    console.log('SpoilWipe: Loaded blocked keywords:', blockedKeywords);
    
    if (!blockedKeywords || blockedKeywords.length === 0) {
      console.log('SpoilWipe: No blocked keywords found - nothing to block');
      hasCheckedCurrentVideo = true;
      return;
    }
    
    console.log('SpoilWipe: Found', blockedKeywords.length, 'blocked keywords:', blockedKeywords);
    
    // Run debug scan first - but stop after first match
    const foundElements = debugScanForHashtags();
    
    if (foundElements.length === 0) {
      console.log('SpoilWipe: No elements with hashtags found on page');
      hasCheckedCurrentVideo = true;
      return;
    }
    
    console.log('SpoilWipe: Found', foundElements.length, 'elements with hashtags');
    
    // Check the first element that matches - then stop
    let foundMatch = false;
    for (let i = 0; i < foundElements.length && !foundMatch; i++) {
      const item = foundElements[i];
      // Add visual marker
      item.element.style.outline = '2px solid orange';
      item.element.setAttribute('data-spoilwatch-debug', `debug-${i+1}`);
      console.log(`SpoilWipe: Testing element ${i + 1}:`, item.element);
      
      // Test the shouldBlock function directly
      const shouldBlockResult = shouldBlock(item.hashtags, blockedKeywords);
      console.log(`SpoilWipe: shouldBlock result for element ${i + 1}:`, shouldBlockResult);
      
      if (shouldBlockResult) {
        console.log(`SpoilWipe: Element ${i + 1} should be blocked! Stopping further checks.`);
        applyBlocking(item.element, blockedKeywords);
        foundMatch = true;
        break; // Stop checking after first match
      } else {
        console.log(`SpoilWipe: Element ${i + 1} should NOT be blocked`);
      }
    }
    
    // If we found a match in debug scan, skip the normal detection logic
    if (foundMatch) {
      console.log('SpoilWipe: Match found in debug scan, skipping normal detection logic');
      hasCheckedCurrentVideo = true;
      return;
    }
    
    // Only run normal detection logic if no match was found in debug scan
    console.log('SpoilWipe: Running normal detection logic...');
    
    // Check video title first - stop if match found
    const titleElements = document.querySelectorAll(YOUTUBE_SELECTORS.title);
    console.log('SpoilWipe: Found title elements:', titleElements.length);

    const videoElement = findVideoElement();
    if (!videoElement || !isElementInViewport(videoElement)) {
    console.log("SpoilWipe: Skipping check — video not fully loaded or visible");
    return;
    }

    
    for (const element of titleElements) {
      const text = extractTextFromElement(element);
      const hashtags = extractHashtags(text);
      console.log('🔍 SpoilWipe: Title element hashtags:', hashtags);
      
      if (shouldBlock(hashtags, blockedKeywords)) {
        console.log('SpoilWipe: Title contains blocked hashtags, blocking video:', hashtags);
        blockVideo(hashtags);
        hasCheckedCurrentVideo = true;
        return; // Stop processing
      }
    }
    
    // Check description - stop if match found
    const descriptionElements = document.querySelectorAll(YOUTUBE_SELECTORS.description);
    console.log('SpoilWipe: Found description elements:', descriptionElements.length);
    
    for (const element of descriptionElements) {
      const text = extractTextFromElement(element);
      const hashtags = extractHashtags(text);
      console.log('SpoilWipe: Description element hashtags:', hashtags);
      
      if (shouldBlock(hashtags, blockedKeywords)) {
        console.log('SpoilWipe: Description contains blocked hashtags, blocking video:', hashtags);
        blockVideo(hashtags);
        hasCheckedCurrentVideo = true;
        return; // Stop processing
      }
    }
    
    // Check hashtag links specifically - stop if match found
    const hashtagElements = document.querySelectorAll(YOUTUBE_SELECTORS.hashtags);
    console.log('🔍 SpoilWipe: Found hashtag elements:', hashtagElements.length);
    
    for (const element of hashtagElements) {
      const hashtagText = element.textContent || element.innerText || '';
      const hashtags = extractHashtags(hashtagText);
      console.log('🔍 SpoilWipe: Hashtag link element hashtags:', hashtags);
      
      if (shouldBlock(hashtags, blockedKeywords)) {
        console.log('SpoilWipe: Hashtag links contain blocked hashtags, blocking video:', hashtags);
        blockVideo(hashtags);
        hasCheckedCurrentVideo = true;
        return; // Stop processing
      }
    }
    
    // If we get here, no matches were found
    console.log('SpoilWipe: No blocked hashtags found, video is safe - NO BLUR APPLIED');
    hasCheckedCurrentVideo = true;

    
  }).catch(error => {
    console.error('SpoilWipe: Error checking for hashtags:', error);
    hasCheckedCurrentVideo = true;
  });
}

// Helper function to block the video
function blockVideo(blockingHashtags) {
  console.log('SpoilWipe: Blocking video due to hashtags:', blockingHashtags);
  
  // Find the main video element using our helper function
  const videoElement = findVideoElement();
  if (!videoElement) {
    console.log('❌ SpoilWipe: No video element found to block');
    return;
  }
  
  console.log('SpoilWipe: Blocking video element:', videoElement);

  currentBlockedVideoElement = videoElement;
  
  // Apply blur to video
  videoElement.style.filter = 'blur(12px)';
  videoElement.style.pointerEvents = 'auto';
  videoElement.style.userSelect = 'auto';
  videoElement.style.position = 'relative';
  
  // Mark this as the main video block
  videoElement.setAttribute('data-spoilwatch-video-blocked', 'true');
  
  // Add a warning overlay
  const overlay = document.createElement('div');
  overlay.className = 'spoilwatch-overlay';
  overlay.innerHTML = `
    <div class="spoilwatch-warning">
      <div class="spoilwatch-icon">⚠️</div>
      <div class="spoilwatch-title">SPOILER WARNING</div>
      <div class="spoilwatch-text">This video contains spoiler content</div>
      <div class="spoilwatch-hashtags">Blocked: ${blockingHashtags.slice(0, 3).join(', ')}${blockingHashtags.length > 3 ? '...' : ''}</div>
      <button class="spoilwatch-watch-btn">
        Watch Anyway
      </button>
    </div>
  `;
  overlay.style.cssText = `
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0, 0, 0, 0.9);
    border: 3px solid #ff6b6b;
    border-radius: 16px;
    padding: 24px;
    color: white;
    text-align: center;
    z-index: 9999;
    min-width: 280px;
    max-width: 320px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.8);
    backdrop-filter: blur(10px);
    pointer-events: auto;
  `;
  
  // Add event listener to the Watch Anyway button
  const watchBtn = overlay.querySelector('.spoilwatch-watch-btn');
  watchBtn.addEventListener('click', function() {
    console.log('SpoilWipe: User clicked Watch Anyway button');
    
    // Remove the overlay
    overlay.remove();
    
    // Remove blur from video
    videoElement.style.filter = 'none';
    
    // Remove the blocked attribute
    videoElement.removeAttribute('data-spoilwatch-video-blocked');
    
    // Mark as checked so it doesn't re-block
    hasCheckedCurrentVideo = true;
    
    console.log('SpoilWipe: Video unblocked by user');
  });
  
  videoElement.appendChild(overlay);
  
  // Force the overlay to be visible by ensuring the video element has proper positioning
  if (videoElement.style.position === 'static' || !videoElement.style.position) {
    videoElement.style.position = 'relative';
  }
  
  console.log('SpoilWipe: Overlay added to video element:', videoElement);
  console.log('SpoilWipe: Overlay element:', overlay);
  
  // Fallback: If overlay is not visible after a short delay, append to body instead
  setTimeout(() => {
    if (!overlay.isConnected || overlay.offsetParent === null) {
      console.log('SpoilWipe: Overlay not visible, trying fallback to body');
      
      // Remove from video element
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
      
      // Update positioning for body placement
      overlay.style.position = 'fixed';
      overlay.style.top = '50%';
      overlay.style.left = '50%';
      overlay.style.transform = 'translate(-50%, -50%)';
      overlay.style.zIndex = '99999';
      
      // Append to body
      document.body.appendChild(overlay);
      console.log('SpoilWipe: Overlay added to body as fallback');
    }
  }, 100);
  
  // Add styles for the warning elements (only once)
  if (!document.querySelector('style[data-spoilwatch-styles]')) {
    const style = document.createElement('style');
    style.setAttribute('data-spoilwatch-styles', 'true');
    style.textContent = `
      .spoilwatch-warning {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
      }
      .spoilwatch-icon {
        font-size: 32px;
        margin-bottom: 8px;
      }
      .spoilwatch-title {
        font-size: 18px;
        font-weight: bold;
        color: #ff6b6b;
        text-transform: uppercase;
        letter-spacing: 1px;
      }
      .spoilwatch-text {
        font-size: 14px;
        color: #e0e0e0;
        margin-bottom: 8px;
      }
      .spoilwatch-hashtags {
        font-size: 12px;
        color: #ffa500;
        font-style: italic;
        margin-bottom: 8px;
      }
      .spoilwatch-watch-btn {
        background: linear-gradient(135deg, #667eea, #9f7aea);
        border: none;
        border-radius: 8px;
        padding: 10px 20px;
        color: white;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
      }
      .spoilwatch-watch-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
        background: linear-gradient(135deg, #5a67d8, #8b5cf6);
      }
      .spoilwatch-watch-btn:active {
        transform: translateY(0);
      }
    `;
    document.head.appendChild(style);
  }
}

// Initial check when page loads
function initializeSpoilWatch() {
  console.log('SpoilWipe: Initializing on YouTube');
  
  // Clear any existing interval
  if (videoCheckInterval) {
    clearInterval(videoCheckInterval);
  }
  
  // Start continuous video monitoring every 500ms
  videoCheckInterval = setInterval(monitorVideoChanges, 500);
  
  // Initial check after a short delay
  setTimeout(monitorVideoChanges, 2000);
  
  // Set up observer for dynamic content (YouTube is very dynamic)
  const observer = new MutationObserver((mutations) => {
    let shouldCheck = false;
    
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        // Check if new content was added that might contain hashtags
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const hasRelevantContent = node.querySelector && (
              node.querySelector(YOUTUBE_SELECTORS.title) ||
              node.querySelector(YOUTUBE_SELECTORS.description) ||
              node.querySelector(YOUTUBE_SELECTORS.hashtags) ||
              node.querySelector(YOUTUBE_SELECTORS.comments)
            );
            
            if (hasRelevantContent || 
                node.matches && (
                  node.matches(YOUTUBE_SELECTORS.title) ||
                  node.matches(YOUTUBE_SELECTORS.description) ||
                  node.matches(YOUTUBE_SELECTORS.hashtags) ||
                  node.matches(YOUTUBE_SELECTORS.comments)
                )) {
              shouldCheck = true;
            }
          }
        });
      }
    });
    
    if (shouldCheck) {
      // Debounce the check to avoid multiple rapid checks
      clearTimeout(window.spoilwatchCheckTimeout);
      window.spoilwatchCheckTimeout = setTimeout(monitorVideoChanges, 500);
    }
  });
  
  // Start observing
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  console.log('SpoilWipe: Continuous monitoring started (500ms intervals)');
}

// Check if we're on YouTube
if (window.location.hostname.includes('youtube.com') || window.location.hostname.includes('youtu.be')) {
  console.log('SpoilWipe: YouTube detected, starting monitoring');
  
  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeSpoilWatch);
  } else {
    initializeSpoilWatch();
  }
}

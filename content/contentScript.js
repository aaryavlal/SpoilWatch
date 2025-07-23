// SpoilWipe content script loaded successfully

var currentVideoId = null;
var lastLoggedVideoId = null;
var hasCheckedCurrentVideo = false;
var videoCheckInterval = null;
var currentBlockedVideoElement = null;
var observer = null;

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

function getKeywordHistory() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['keywordHistory'], (res) => {
      resolve(res.keywordHistory || []);
    });
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
  console.log('SpoilWipe: Starting scoped hashtag scan...');

  // 🧼 Clear outlines from any previous video
  document.querySelectorAll('[data-spoilwatch-debug]').forEach(el => {
    if (el && el.style) {
      el.style.outline = '';
      el.removeAttribute('data-spoilwatch-debug');
    }
  });

  const debugEntries = [];

  const selectors = [
    YOUTUBE_SELECTORS.title,
    YOUTUBE_SELECTORS.description,
    YOUTUBE_SELECTORS.hashtags
  ];

  const activeCard = getActiveShortsCard();
  if (!activeCard) {
    console.warn('SpoilWipe: No active Shorts card found');
    return [];
  }

  selectors.forEach(selector => {
    const elements = activeCard.querySelectorAll(selector);
    elements.forEach(element => {
      if (element && element.textContent) {
        const text = element.textContent;
        const hashtags = text.match(/#[\w]+/g) || [];
        if (hashtags.length > 0) {
          if (element && element.style) {
            element.setAttribute('data-spoilwatch-debug', 'true');
            element.style.outline = '2px dashed orange';
          }
          debugEntries.push({
            element,
            selector,
            text: text.substring(0, 100),
            hashtags: hashtags.map(tag => tag.toLowerCase()),
            tagName: element.tagName,
            className: element.className,
            id: element.id
          });
          console.log('SpoilWipe: Found hashtags in', selector, ':', hashtags);
        }
      }
    });
  });

  return debugEntries;
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
    
    // Add a compact, calm warning overlay to the video element
    const overlay = document.createElement('div');
    overlay.className = 'spoilwatch-overlay';
    overlay.innerHTML = `
      <div class="spoilwatch-warning" style="background: rgba(30,34,50,0.82); border-radius: 12px; box-shadow: 0 2px 12px rgba(16,22,36,0.10); padding: 16px 18px 12px 18px; display: flex; flex-direction: column; align-items: center; min-width: 120px; max-width: 220px;">
        <div style="font-size: 20px; margin-bottom: 2px;">⚠️</div>
        <div class="spoilwatch-title" style="font-size: 15px; font-weight: 700; color: #fff; text-shadow: 0 1px 4px #000, 0 0 6px #7f9cf5; letter-spacing: 0.5px; margin-bottom: 2px;">SPOILER WARNING</div>
        <div class="spoilwatch-text" style="font-size: 11px; color: #fff; font-weight: 500; opacity: 0.98; margin-bottom: 7px; text-shadow: 0 1px 4px #000, 0 0 6px #7f9cf5;">This video contains spoiler content</div>
        <button class="spoilwatch-watch-btn" style="background: none; border: 1.5px solid #f56565; border-radius: 6px; padding: 3px 14px; color: #f56565; font-size: 12px; font-weight: 700; cursor: pointer; transition: background 0.2s, color 0.2s; box-shadow: none;">Watch Anyway</button>
      </div>
    `;
    overlay.style.cssText = `
      position: absolute;
      top: 18%;
      left: 24px;
      background: none;
      border: none;
      border-radius: 0;
      padding: 0;
      color: white;
      text-align: left;
      z-index: 9999;
      min-width: 120px;
      max-width: 220px;
      box-shadow: none;
      pointer-events: auto;
    `;
    // Add event listener to the Watch Anyway button
    const watchBtn = overlay.querySelector('.spoilwatch-watch-btn');
    watchBtn.addEventListener('mouseenter', function() {
      watchBtn.style.background = 'rgba(245,101,101,0.12)';
      watchBtn.style.color = '#fff';
    });
    watchBtn.addEventListener('mouseleave', function() {
      watchBtn.style.background = 'none';
      watchBtn.style.color = '#f56565';
    });
    watchBtn.addEventListener('click', function() {
      overlay.remove();
      videoElement.style.filter = 'none';
      videoElement.removeAttribute('data-spoilwatch-video-blocked');
      hasCheckedCurrentVideo = true;
      if (typeof videoElement.play === 'function') {
        videoElement.play();
      }
    });
    videoElement.appendChild(overlay);
    // Pause the video when a spoiler is detected
    if (typeof videoElement.pause === 'function') {
      videoElement.pause();
    }
    if (videoElement.style.position === 'static' || !videoElement.style.position) {
      videoElement.style.position = 'relative';
    }
    
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




function isElementInViewport(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  // Only require that some part of the video is visible
  return (
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < (window.innerHeight || document.documentElement.clientHeight) &&
    rect.left < (window.innerWidth || document.documentElement.clientWidth)
  );
}


// Helper function to find the actual video element
function findVideoElement() {
  // Try Shorts-specific selectors first
  let el = document.querySelector('ytd-reel-video-renderer video, ytd-reel-player-overlay-renderer video');
  if (el) return el;
  // Fallback to generic selectors
  const selectors = [
    'video',
    '.html5-video-container video',
    '.video-stream',
    '.html5-main-video',
    '#movie_player video',
    '.ytp-video'
  ];
  for (const selector of selectors) {
    el = document.querySelector(selector);
    if (el) return el;
  }
  return null;
}

// Track current video to prevent duplicate detection
//let currentVideoId = null;
//let hasCheckedCurrentVideo = false;
//let videoCheckInterval = null;
//let lastLoggedVideoId = null;

function getCurrentVideoId() {
  try {
    const url = window.location.href;
    const match = url.match(/\/shorts\/([^?&#/]+)/);
    return match ? match[1] : null;
  } catch (err) {
    console.error('❌ Error getting current video ID:', err);
    return null;
  }
}

function clearAllBlocks() {
  console.log('SpoilWipe: Clearing all previous blocks');

  document.querySelectorAll('video').forEach(el => {
    if (el && el.style) {
      el.style.filter = '';
      el.style.pointerEvents = '';
      el.style.userSelect = '';
      el.style.position = '';
    }
    el.removeAttribute('data-spoilwatch-video-blocked');
    el.removeAttribute('data-spoilwatch-blocked-id');
    el.querySelectorAll('.spoilwatch-overlay').forEach(overlay => overlay.remove());
  });

  document.querySelectorAll('.spoilwatch-overlay').forEach(overlay => overlay.remove());

  document.querySelectorAll('[data-spoilwatch-debug]').forEach(el => {
    if (el && el.style) {
      el.style.outline = '';
      el.removeAttribute('data-spoilwatch-debug');
    }
  });

  const existingStyle = document.querySelector('style[data-spoilwatch-styles]');
  if (existingStyle) existingStyle.remove();

  hasCheckedCurrentVideo = false;
  currentBlockedVideoElement = null;
}
// Continuous video monitoring function
function monitorVideoChanges() {
  const newVideoId = getCurrentVideoId();
  if (newVideoId && newVideoId !== currentVideoId) {
    console.log('🎬 New video:', newVideoId);
    clearAllBlocks();
    currentVideoId = newVideoId;
    hasCheckedCurrentVideo = false;
    setTimeout(() => checkYouTubeShorts(), 500);
    currentBlockedVideoElement = null;
  }
}


function checkYouTubeShorts(retryCount = 0) {
  clearAllBlocks();

  const videoElement = findVideoElement();
  console.log('SpoilWipe: findVideoElement returned:', videoElement);

  if (!videoElement || !isElementInViewport(videoElement)) {
    console.log(`SpoilWipe: Skipping check — video not loaded or fully visible (retry ${retryCount})`);
    if (retryCount < 5) {
      setTimeout(() => checkYouTubeShorts(retryCount + 1), 300);
    }
    return;
  }

  const activeCard = getActiveShortsCard();
  if (!activeCard) {
    console.warn('SpoilWipe: No active Shorts card found — cannot scan hashtags.');
    hasCheckedCurrentVideo = true;
    return;
  }

  getBlockedKeywords().then(blockedKeywords => {
    console.log('SpoilWipe: Loaded blocked keywords:', blockedKeywords);

    if (!blockedKeywords || blockedKeywords.length === 0) {
      console.log('SpoilWipe: No blocked keywords found - nothing to block');
      hasCheckedCurrentVideo = true;
      return;
    }

    console.log(`SpoilWipe: Found ${blockedKeywords.length} blocked keywords:`, blockedKeywords);

    // Debug scan only within the active card
    const foundElements = [];
    const selectors = [
      YOUTUBE_SELECTORS.title,
      YOUTUBE_SELECTORS.description,
      YOUTUBE_SELECTORS.hashtags
    ];

    selectors.forEach(selector => {
      activeCard.querySelectorAll(selector).forEach(element => {
        if (element && element.textContent) {
          const hashtags = extractHashtags(element.textContent);
          if (hashtags.length > 0) {
            foundElements.push({ element, hashtags, selector });
          }
        }
      });
    });

    if (foundElements.length === 0) {
      console.log('SpoilWipe: No elements with hashtags found inside active Shorts card');
      hasCheckedCurrentVideo = true;
      return;
    }

    console.log(`SpoilWipe: Found ${foundElements.length} elements with hashtags in active card`);

    let foundMatch = false;
    for (let i = 0; i < foundElements.length && !foundMatch; i++) {
      const { element, hashtags } = foundElements[i];
      if (element && element.style) {
        element.style.outline = '2px solid orange';
        element.setAttribute('data-spoilwatch-debug', `debug-${i + 1}`);
      }
      console.log(`SpoilWipe: Testing element ${i + 1}:`, element);

      const shouldBlockResult = shouldBlock(hashtags, blockedKeywords);
      console.log(`SpoilWipe: Element ${i + 1} hashtags:`, hashtags);
      console.log(`SpoilWipe: shouldBlock result:`, shouldBlockResult);

      if (shouldBlockResult) {
        console.log(`SpoilWipe: Blocking due to element ${i + 1}`);
        applyBlocking(element, blockedKeywords);
        foundMatch = true;
        break;
      }
    }

    if (foundMatch) {
      console.log('SpoilWipe: Match found in scoped debug scan, skipping normal detection');
      hasCheckedCurrentVideo = true;
      return;
    }

    // Fallback: Run normal detection logic (also scoped to activeCard)
    console.log('SpoilWipe: Running fallback detection logic...');

    const titleElements = activeCard.querySelectorAll(YOUTUBE_SELECTORS.title);
    for (const element of titleElements) {
      const hashtags = extractHashtags(extractTextFromElement(element));
      if (shouldBlock(hashtags, blockedKeywords)) {
        console.log('SpoilWipe: Title contains blocked hashtags, blocking...');
        blockVideo(hashtags);
        hasCheckedCurrentVideo = true;
        return;
      }
    }

    const descriptionElements = activeCard.querySelectorAll(YOUTUBE_SELECTORS.description);
    for (const element of descriptionElements) {
      const hashtags = extractHashtags(extractTextFromElement(element));
      if (shouldBlock(hashtags, blockedKeywords)) {
        console.log('SpoilWipe: Description contains blocked hashtags, blocking...');
        blockVideo(hashtags);
        hasCheckedCurrentVideo = true;
        return;
      }
    }

    const hashtagElements = activeCard.querySelectorAll(YOUTUBE_SELECTORS.hashtags);
    for (const element of hashtagElements) {
      const hashtags = extractHashtags(element.textContent || '');
      if (shouldBlock(hashtags, blockedKeywords)) {
        console.log('SpoilWipe: Hashtag links contain blocked hashtags, blocking...');
        blockVideo(hashtags);
        hasCheckedCurrentVideo = true;
        return;
      }
    }

    console.log('SpoilWipe: No blocked hashtags found, video is safe');
    hasCheckedCurrentVideo = true;

  }).catch(error => {
    console.error('SpoilWipe: Error during hashtag scan:', error);
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
  
  // Only block if not already blocked for this video
  if (videoElement.getAttribute('data-spoilwatch-blocked-id') === currentVideoId) {
    console.log('SpoilWipe: Video already blocked for this ID, skipping');
    return;
  }

  // Set the unique attribute
  videoElement.setAttribute('data-spoilwatch-blocked-id', currentVideoId);

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
    videoElement.removeAttribute('data-spoilwatch-blocked-id'); // Clear unique attribute
    
    // Mark as checked so it doesn't re-block
    hasCheckedCurrentVideo = true;
    
    console.log('SpoilWipe: Video unblocked by user');
  });
  
  videoElement.appendChild(overlay);
  
  // Force the overlay to be visible by ensuring the video element has proper positioning
  if (videoElement.style.position === 'static' || !videoElement.style.position) {
    videoElement.style.position = 'relative';
  }
  
  // Pause the video when a spoiler is detected
  if (typeof videoElement.pause === 'function') {
    videoElement.pause();
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

// Listen for messages from the popup to show fullscreen overlay
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.action === 'show_fullscreen_overlay') {
    if (document.getElementById('spoilwatch-fullscreen-overlay')) return;
    // Inject fullscreen.css if not present
    if (!document.getElementById('sw-fullscreen-css')) {
      const styleEl = document.createElement('link');
      styleEl.rel = 'stylesheet';
      styleEl.href = chrome.runtime.getURL('popup/fullscreen.css');
      styleEl.id = 'sw-fullscreen-css';
      document.head.appendChild(styleEl);
    }
    // Blur and pause video
    let videoElement = null;
    let wasPlaying = false;
    function findVideoElement() {
      const selectors = [
        'video',
        '.html5-video-container video',
        '.video-stream',
        '.html5-main-video',
        '#movie_player video',
        '.ytp-video',
        'ytd-shorts video',
        '.ytd-shorts video',
        'ytd-video-primary-info-renderer video',
        '.ytd-video-primary-info-renderer video'
      ];
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el) return el;
      }
      return null;
    }
    videoElement = findVideoElement();
    if (videoElement) {
      // Save if it was playing
      wasPlaying = !videoElement.paused;
      videoElement.style.filter = 'blur(12px)';
      if (typeof videoElement.pause === 'function') videoElement.pause();
    }
    Promise.all([
      getKeywordHistory(),
      getBlockedKeywords()
    ]).then(([keywordHistory, blockedKeywords]) => {
      const overlay = document.createElement('div');
      overlay.id = 'spoilwatch-fullscreen-overlay';
      overlay.className = 'sw-fullscreen-overlay';
      overlay.innerHTML = `
        <div class="sw-col left">
          <div class="sw-col-title">Saved Keywords</div>
          <div id="spoilwatch-keyword-history-list" class="sw-keyword-list"></div>
        </div>
        <div class="sw-center">
          <div style="margin-bottom:40px;text-align:center;">
            <div class="sw-title">SpoilWipe Fullscreen</div>
            <div class="sw-bio">SpoilWipe blocks spoilers in YouTube Shorts and other videos by hiding content that matches your keywords. Add keywords to protect yourself from unwanted reveals!</div>
          </div>
          <div class="sw-features-row">
            <div class="sw-feature-card">Feature 2</div>
            <div class="sw-feature-card">Feature 3</div>
          </div>
        </div>
        <div class="sw-col right">
          <button id="spoilwatch-close-fullscreen-btn" class="sw-close-btn">Close ✕</button>
          <div class="sw-col-title">Feature 4</div>
          <div style="color:var(--midnight-text-secondary,#a0aec0);font-style:italic;">Coming soon</div>
        </div>
      `;
      document.body.appendChild(overlay);
      // Populate keyword history
      const historyList = overlay.querySelector('#spoilwatch-keyword-history-list');
      if (historyList && keywordHistory.length > 0) {
        keywordHistory.forEach(kw => {
          const item = document.createElement('div');
          item.className = 'sw-keyword-item';
          item.textContent = kw;
          historyList.appendChild(item);
        });
      } else if (historyList) {
        historyList.innerHTML = '<div style="color:var(--midnight-text-secondary,#a0aec0);font-style:italic;">No keywords yet.</div>';
      }
      // Close button logic
      const closeBtn = document.getElementById('spoilwatch-close-fullscreen-btn');
      closeBtn.addEventListener('click', () => {
        overlay.remove();
        // Unblur and resume video
        if (videoElement) {
          videoElement.style.filter = '';
          if (wasPlaying && typeof videoElement.play === 'function') videoElement.play();
        }
      });
      overlay.tabIndex = -1;
      overlay.focus();
      overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          overlay.remove();
          // Unblur and resume video
          if (videoElement) {
            videoElement.style.filter = '';
            if (wasPlaying && typeof videoElement.play === 'function') videoElement.play();
          }
        }
      });
    });
  }
});

// Check if on YouTube
if (window.location.hostname.includes('youtube.com') || window.location.hostname.includes('youtu.be')) {
  console.log('SpoilWipe: YouTube detected, starting monitoring');
  
  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeSpoilWatch);
  } else {
    initializeSpoilWatch();
  }
}

// Shorts video detection integration
// Only declare these variables ONCE at the top of the script
// let currentVideoId = null;
// let lastLoggedVideoId = null;
// let hasCheckedCurrentVideo = false;
// let videoCheckInterval = null;



// Called when a new video is detected
function handleNewShortsVideo(newVideoId) {
  console.log('🔄 SpoilWipe: New Shorts video detected! Old ID:', currentVideoId, 'New ID:', newVideoId);
  clearAllBlocks();
  hasCheckedCurrentVideo = false;
  currentVideoId = newVideoId;

  setTimeout(() => {
    checkYouTubeShorts();
  }, 500);
}

// Start observing the Shorts container for DOM changes
function startShortsObserver() {
  const container =
    document.querySelector('ytd-reel-video-renderer')?.parentNode ||
    document.querySelector('ytd-reel-player-overlay-renderer')?.parentNode ||
    document.querySelector('ytd-reel-player-overlay-renderer') ||
    document.querySelector('ytd-reel-video-renderer') ||
    document.querySelector('ytd-reel-player-renderer') ||
    document.querySelector('ytd-app');

  if (!container) {
    console.warn('⏳ SpoilWipe: Shorts container not found yet, retrying...');
    setTimeout(startShortsObserver, 1000);
    return;
  }

  if (observer) {
    observer.disconnect(); // In case it's already running
  }

  observer = new MutationObserver(() => {
    const newVideoId = getCurrentVideoId();
    if (newVideoId && newVideoId !== currentVideoId) {
      handleNewShortsVideo(newVideoId);
    }
  });

  observer.observe(container, {
    childList: true,
    subtree: true
  });

  console.log('👀 SpoilWipe: MutationObserver is now watching Shorts DOM');
}

// Fallback: interval-based checking
function startIntervalFallback() {
  if (videoCheckInterval) clearInterval(videoCheckInterval);
  videoCheckInterval = setInterval(() => {
    const newVideoId = getCurrentVideoId();
    if (newVideoId && newVideoId !== currentVideoId) {
      handleNewShortsVideo(newVideoId);
    }
  }, 1000);
}

// Call once on script load
startShortsObserver();
startIntervalFallback();

function getActiveShortsCard() {
  // Try to find the visible/active Shorts card
  // This selector may need to be adjusted for YouTube changes
  const cards = Array.from(document.querySelectorAll('ytd-reel-video-renderer'));
  if (!cards.length) return null;
  // Find the card most in the viewport (or with a special class)
  let maxVisible = 0;
  let activeCard = null;
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    const visible = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    if (visible > maxVisible) {
      maxVisible = visible;
      activeCard = card;
    }
  }
  return activeCard;
}


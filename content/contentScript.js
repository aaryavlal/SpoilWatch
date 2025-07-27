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
  
  // Add analytics tracking for blocked keywords (capped at 1 per video)
  const text = extractTextFromElement(element);
  const hashtags = extractHashtags(text);
  if (hashtags.length > 0) {
    console.log('[SpoilWipe][Analytics] Video blocked, tracking hashtags:', hashtags);
    
    // Find which specific blocked keyword matched
    const matchedKeywords = [];
    hashtags.forEach(tag => {
      const cleanTag = tag.replace('#', '').toLowerCase();
      if (!cleanTag) return;
      
      // Check if this hashtag matches any blocked keyword
      blockedKeywords.forEach(blockedKeyword => {
        const cleanBlockedKeyword = blockedKeyword.toLowerCase().trim();
        if (cleanTag === cleanBlockedKeyword || 
            (cleanTag.length >= 4 && cleanBlockedKeyword.length >= 4 && 
             (cleanTag.includes(cleanBlockedKeyword) || cleanBlockedKeyword.includes(cleanTag)))) {
          matchedKeywords.push(cleanBlockedKeyword);
        }
      });
    });
    
    if (matchedKeywords.length > 0) {
      console.log('[SpoilWipe][Analytics] Matched keywords that triggered block:', matchedKeywords);
      
      // Get the current video ID to track unique keywords per video
      const videoId = getCurrentVideoId();
      
      getKeywordBlockCounts().then(counts => {
        console.log('[SpoilWipe][Analytics] Counts before increment:', counts);
        
        // Check if we've already counted ANY keyword for this video
        const videoAlreadyCounted = Object.keys(counts).some(keyword => {
          const videoKeywordKey = `${videoId}_${keyword}`;
          return counts[videoKeywordKey] !== undefined;
        });
        
        if (videoAlreadyCounted) {
          console.log(`[SpoilWipe][Analytics] Video ${videoId} already counted, skipping additional keywords`);
          return;
        }
        
        // Only count the first matched keyword for this video
        const firstMatchedKeyword = matchedKeywords[0];
        const videoKeywordKey = `${videoId}_${firstMatchedKeyword}`;
        
        if (!counts[firstMatchedKeyword]) counts[firstMatchedKeyword] = 0;
        counts[firstMatchedKeyword]++;
        counts[videoKeywordKey] = 1; // Mark this video as counted for this keyword
        
        console.log(`[SpoilWipe][Analytics] 🔥 BLOCKED: "${firstMatchedKeyword}" = ${counts[firstMatchedKeyword]} times blocked (capped at 1 per video)`);
        
        console.log('[SpoilWipe][Analytics] Counts after increment:', counts);
        chrome.storage.sync.set({ keywordBlockCounts: counts }, () => {
          if (chrome.runtime.lastError) {
            console.error('[SpoilWipe][Analytics] Error saving keywordBlockCounts:', chrome.runtime.lastError);
          } else {
            console.log('[SpoilWipe][Analytics] Updated keywordBlockCounts:', counts);
          }
        });
      });
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

  
  console.log('[SpoilWipe][Analytics] blockVideo called with:', blockingHashtags);

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
  // Increment analytics for each keyword
  getKeywordBlockCounts().then(counts => {
    console.log('[SpoilWipe][Analytics] Counts before increment:', counts);
    let updated = false;
    blockingHashtags.forEach(tag => {
      const cleanTag = tag.replace('#', '').toLowerCase();
      if (!cleanTag) return;
      if (!counts[cleanTag]) counts[cleanTag] = 0;
      counts[cleanTag]++;
      console.log(`[SpoilWipe][Analytics] 🔥 BLOCKED: "${cleanTag}" = ${counts[cleanTag]} times blocked`);
      updated = true;
    });
    console.log('[SpoilWipe][Analytics] Counts after increment:', counts);
    if (updated) {
      chrome.storage.sync.set({ keywordBlockCounts: counts }, () => {
        if (chrome.runtime.lastError) {
          console.error('[SpoilWipe][Analytics] Error saving keywordBlockCounts:', chrome.runtime.lastError);
        } else {
          console.log('[SpoilWipe][Analytics] Updated keywordBlockCounts:', counts);
        }
      });
    }
  });
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
  console.log('[SpoilWipe] Received message:', message);
  if (message && message.action === 'show_fullscreen_overlay') {
    // Pause the current video if present
    const video = document.querySelector('video');
    if (video && typeof video.pause === 'function') {
      video.pause();
    }
    console.log('[SpoilWipe] Creating fullscreen overlay...');
    if (document.getElementById('spoilwatch-fullscreen-overlay')) return;
    // Fallback overlay if anything fails
    const overlay = document.createElement('div');
    overlay.id = 'spoilwatch-fullscreen-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.background = 'rgba(30,34,50,0.92)';
    overlay.style.zIndex = '999999';
    overlay.style.display = 'block';
    overlay.style.paddingTop = '48px';
    // Use only the ID for the close button, no class or inline style
    overlay.innerHTML = `
      <button id="spoilwatch-close-fullscreen-btn" title="Close">&times;</button>
      <div style="color:#fff;font-size:2.5rem;font-weight:800;margin:16px auto 0 auto;text-align:center;width:fit-content;background:linear-gradient(135deg,#667eea 0%,#9f7aea 50%,#7f9cf5 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;text-fill-color:transparent;letter-spacing:1.5px;text-shadow:0 2px 4px rgba(0,0,0,0.1);">SpoilWipe Features</div>
      <div style="color:#c3c8d4;font-size:1.1rem;text-align:center;margin:8px auto 0 auto;opacity:0.8;font-weight:500;">Choose a feature to get started</div>
      <div class="spoilwatch-card-grid" id="feature-selection-grid">
        <div class="spoilwatch-card feature-card" data-feature="trending-keywords">
          <div style="font-size:2.5rem;margin-bottom:16px;opacity:0.9;">🎬</div>
          <div class="feature-title" style="font-size:1.8rem;font-weight:900;background:linear-gradient(135deg,#667eea 0%,#9f7aea 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;text-fill-color:transparent;margin-bottom:0.8em;letter-spacing:1.5px;text-align:center;position:relative;line-height:1.1;">
            Trending Movie Keywords
          </div>
          <div class="feature-description" style="color:#c3c8d4;font-size:1rem;text-align:center;line-height:1.5;opacity:0.9;">
            Discover and block trending movie spoilers from the latest releases
          </div>
        </div>
        <div class="spoilwatch-card feature-card" data-feature="keyword-history">
          <div style="font-size:2.5rem;margin-bottom:16px;opacity:0.9;">📚</div>
          <div class="feature-title" style="font-size:1.8rem;font-weight:900;background:linear-gradient(135deg,#667eea 0%,#9f7aea 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;text-fill-color:transparent;margin-bottom:0.8em;letter-spacing:1.5px;text-align:center;position:relative;line-height:1.1;">
            Keyword History
          </div>
          <div class="feature-description" style="color:#c3c8d4;font-size:1rem;text-align:center;line-height:1.5;opacity:0.9;">
            View and manage your blocked keywords and spoiler protection
          </div>
        </div>
        <div class="spoilwatch-card feature-card" data-feature="settings">
          <div style="font-size:2.5rem;margin-bottom:16px;opacity:0.9;">⚙️</div>
          <div class="feature-title" style="font-size:1.8rem;font-weight:900;background:linear-gradient(135deg,#667eea 0%,#9f7aea 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;text-fill-color:transparent;margin-bottom:0.8em;letter-spacing:1.5px;text-align:center;position:relative;line-height:1.1;">
            Settings
          </div>
          <div class="feature-description" style="color:#c3c8d4;font-size:1rem;text-align:center;line-height:1.5;opacity:0.9;">
            Configure your spoiler protection preferences and behavior
          </div>
        </div>
        <div class="spoilwatch-card feature-card" data-feature="analytics">
          <div style="font-size:2.5rem;margin-bottom:16px;opacity:0.9;">📊</div>
          <div class="feature-title" style="font-size:1.8rem;font-weight:900;background:linear-gradient(135deg,#667eea 0%,#9f7aea 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;text-fill-color:transparent;margin-bottom:0.8em;letter-spacing:1.5px;text-align:center;position:relative;line-height:1.1;">
            Analytics
          </div>
          <div class="feature-description" style="color:#c3c8d4;font-size:1rem;text-align:center;line-height:1.5;opacity:0.9;">
            View your spoiler blocking statistics and insights
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    
    // Disable YouTube page scrolling
    document.body.classList.add('spoilwatch-overlay-open');
    document.documentElement.classList.add('spoilwatch-overlay-open');
    
    // Add click handlers for feature cards
    const featureCards = document.querySelectorAll('.feature-card');
    featureCards.forEach(card => {
      card.addEventListener('click', () => {
        const feature = card.getAttribute('data-feature');
        showFeatureView(feature, overlay);
      });
    });

    // Function to show individual feature views
    function showFeatureView(feature, mainOverlay) {
      const featureSelectionGrid = document.getElementById('feature-selection-grid');
      featureSelectionGrid.style.display = 'none';
      
      let featureContent = '';
      let featureTitle = '';
      
      switch(feature) {
        case 'trending-keywords':
          featureTitle = 'Trending Movie Keywords';
          featureContent = `
            <div class="loading-container" id="trending-loading">
              <div class="loading-spinner"></div>
            </div>
            <div id="trending-keywords-list" style="display: none; width: 100%; margin-top: 20px;"></div>
          `;
          break;
        case 'keyword-history':
          featureTitle = 'Keyword History';
          featureContent = `
            <div id="spoilwatch-history-list" style="display:flex;flex-wrap:wrap;gap:18px;justify-content:center;align-items:flex-start;width:100%;margin-top:20px;margin-bottom:0;"></div>
            <div id="spoilwatch-history-empty" class="empty-state" style="display:none;">
              <div style="font-size:3rem;margin-bottom:16px;opacity:0.6;">📝</div>
              <div style="font-size:1.2rem;font-weight:600;margin-bottom:8px;">No keywords saved yet</div>
              <div style="font-size:1rem;opacity:0.8;">Add some keywords to start protecting yourself from spoilers!</div>
            </div>
          `;
          break;
        case 'settings':
          featureTitle = 'Settings';
          featureContent = `
            <div class="empty-state">
              <div style="font-size:3rem;margin-bottom:16px;opacity:0.6;">⚙️</div>
              <div style="font-size:1.2rem;font-weight:600;margin-bottom:8px;">Settings Coming Soon</div>
              <div style="font-size:1rem;opacity:0.8;">Advanced configuration options will be available in a future update.</div>
            </div>
          `;
          break;
        case 'analytics':
          featureTitle = 'Analytics';
          featureContent = `
            <div id="analytics-bar-graph" style="width:100%;max-width:600px;margin:0 auto 32px auto;"></div>
            <div class="empty-state" id="analytics-empty-state" style="display:none;">
              <div style="font-size:3rem;margin-bottom:16px;opacity:0.6;">📊</div>
              <div style="font-size:1.2rem;font-weight:600;margin-bottom:8px;">No analytics data yet</div>
              <div style="font-size:1rem;opacity:0.8;">No keywords have been blocked yet. Block some spoilers to see stats!</div>
            </div>
            <div style="text-align:center;margin-top:40px;">
              <button id="clear-analytics-btn" style="background:linear-gradient(135deg,rgba(245,101,101,0.8) 0%,rgba(237,100,166,0.6) 100%);color:#fff;border:none;border-radius:20px;padding:12px 24px;font-size:1rem;font-weight:600;cursor:pointer;transition:all 0.3s cubic-bezier(0.4,0,0.2,1);box-shadow:0 4px 12px rgba(245,101,101,0.2),inset 0 1px 0 rgba(255,255,255,0.1);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);border:1px solid rgba(255,255,255,0.1);">
                Clear All Analytics Data
              </button>
            </div>
          `;
          break;
      }
      
      // Create feature view container
      const featureView = document.createElement('div');
      featureView.id = 'feature-view';
      featureView.style.cssText = `
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 100%;
        max-width: 800px;
        margin: 0 auto;
        padding: 20px;
      `;
      
      featureView.innerHTML = `
        <div style="font-size:2.5rem;font-weight:900;background:linear-gradient(90deg,#a084e8 0%,#7f5af0 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;text-fill-color:transparent;margin-bottom:30px;letter-spacing:1.5px;text-align:center;position:relative;line-height:1.1;">
          ${featureTitle}
        </div>
        <button id="back-to-features-btn" style="position:absolute;top:24px;left:32px;background:none;color:#c3c8d4;font-size:1.5rem;font-weight:700;border:none;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:color 0.18s,opacity 0.18s,background 0.12s;z-index:10001;outline:none;opacity:0.85;width:40px;height:40px;" title="Back to Features">
          ←
        </button>
        ${featureContent}
      `;
      
      // Add back button functionality
      const backBtn = featureView.querySelector('#back-to-features-btn');
      backBtn.addEventListener('click', () => {
        featureView.remove();
        featureSelectionGrid.style.display = 'grid';
      });
      
      // Add hover effects for back button
      backBtn.addEventListener('mouseenter', () => {
        backBtn.style.color = '#fff';
        backBtn.style.background = 'rgba(255,255,255,0.07)';
        backBtn.style.opacity = '1';
      });
      backBtn.addEventListener('mouseleave', () => {
        backBtn.style.color = '#c3c8d4';
        backBtn.style.background = 'none';
        backBtn.style.opacity = '0.85';
      });
      
      mainOverlay.appendChild(featureView);
      
      // Load feature-specific content
      if (feature === 'trending-keywords') {
        loadTrendingKeywords();
      } else if (feature === 'keyword-history') {
        loadKeywordHistory();
      } else if (feature === 'analytics') {
        renderAnalyticsBarGraph();
        
        // Add clear analytics button functionality
        const clearBtn = featureView.querySelector('#clear-analytics-btn');
        if (clearBtn) {
          clearBtn.addEventListener('click', async () => {
            if (confirm('Are you sure you want to clear all analytics data? This action cannot be undone.')) {
              await chrome.storage.sync.set({ keywordBlockCounts: {} });
              console.log('[SpoilWipe][Analytics] All analytics data cleared');
              renderAnalyticsBarGraph(); // Re-render to show empty state
            }
          });
          
          // Add hover effects for clear button
          clearBtn.addEventListener('mouseenter', () => {
            clearBtn.style.background = 'linear-gradient(135deg,rgba(220,80,80,0.9) 0%,rgba(200,70,140,0.7) 100%)';
            clearBtn.style.transform = 'translateY(-2px) scale(1.05)';
            clearBtn.style.boxShadow = '0 6px 16px rgba(245,101,101,0.3),inset 0 1px 0 rgba(255,255,255,0.2)';
          });
          clearBtn.addEventListener('mouseleave', () => {
            clearBtn.style.background = 'linear-gradient(135deg,rgba(245,101,101,0.8) 0%,rgba(237,100,166,0.6) 100%)';
            clearBtn.style.transform = 'translateY(0) scale(1)';
            clearBtn.style.boxShadow = '0 4px 12px rgba(245,101,101,0.2),inset 0 1px 0 rgba(255,255,255,0.1)';
          });
          clearBtn.addEventListener('active', () => {
            clearBtn.style.transform = 'translateY(0) scale(0.98)';
          });
        }
      }
    }

    // Function to load trending keywords
    function loadTrendingKeywords() {
      const loadingContainer = document.querySelector('#trending-loading');
      const card = document.querySelector('#trending-keywords-list');
      
      if (!card || !loadingContainer) return;
      
      // Show loading initially
      loadingContainer.style.display = 'flex';
      card.style.display = 'none';
      
      getSmartSpoilerKeywords().then(movieKeywords => {
        // Hide loading
        loadingContainer.style.display = 'none';
        card.style.display = 'block';
        
        if (!movieKeywords || Object.keys(movieKeywords).length === 0) {
          card.innerHTML = `
            <div class="error-message">
              <div style="font-size:1.2rem;font-weight:700;margin-bottom:8px;">Failed to load trending keywords</div>
              <div style="font-size:0.9rem;opacity:0.8;">Please check your internet connection and try again.</div>
            </div>
          `;
          return;
        }
        
        card.innerHTML = '';
        
        for (const [movie, keywords] of Object.entries(movieKeywords)) {
          const section = document.createElement('div');
          section.className = 'movie-section';
          
          const title = document.createElement('div');
          title.textContent = movie;
          title.className = 'movie-title';
        section.appendChild(title);

        // Create container for hashtags
        const hashtagContainer = document.createElement('div');
        hashtagContainer.className = 'movie-keywords';

        // Show first 3 hashtags
        const visibleKeywords = keywords.slice(0, 3);
        const hiddenKeywords = keywords.slice(3);

        visibleKeywords.forEach(tag => {
          const chip = document.createElement('span');
          chip.className = 'spoilwatch-history-chip';
          chip.textContent = tag;
          chip.style.cursor = 'pointer';
          chip.title = 'Click to add to blocked keywords';
          
          // Check if already blocked
          getBlockedKeywords().then(blockedKeywords => {
            if (blockedKeywords.includes(tag.replace('#', ''))) {
              chip.style.background = 'linear-gradient(135deg, #667eea 60%, #7f9cf5 100%)';
              chip.style.color = '#fff';
              chip.style.opacity = '0.85';
              chip.title = 'Already blocked';
              chip.style.cursor = 'not-allowed';
            }
          });
          
          // Add click handler
          chip.addEventListener('click', async () => {
            const blockedKeywords = await getBlockedKeywords();
            const cleanTag = tag.replace('#', '');
            
            if (blockedKeywords.includes(cleanTag)) {
              return; // Already blocked
            }
            
            // Add to blocked keywords
            const newBlockedKeywords = [...blockedKeywords, cleanTag];
            await new Promise(resolve => {
              chrome.storage.sync.set({blocked: newBlockedKeywords}, resolve);
            });

            // Also add to keywordHistory if not present
            const keywordHistory = await getKeywordHistory();
            if (!keywordHistory.includes(cleanTag)) {
              const newHistory = [...keywordHistory, cleanTag];
              await new Promise(resolve => {
                chrome.storage.sync.set({keywordHistory: newHistory}, resolve);
              });
            }
            
            // Update chip appearance
            chip.style.background = 'linear-gradient(135deg, #667eea 60%, #7f9cf5 100%)';
            chip.style.color = '#fff';
            chip.style.opacity = '0.85';
            chip.title = 'Already blocked';
            chip.style.cursor = 'not-allowed';
            
            console.log(`Added "${cleanTag}" to blocked keywords and keyword history`);
          });
          
          hashtagContainer.appendChild(chip);
        });

        section.appendChild(hashtagContainer);

        // Add "See More" button if there are hidden keywords
        if (hiddenKeywords.length > 0) {
          const seeMoreBtn = document.createElement('button');
          seeMoreBtn.textContent = `See More (${hiddenKeywords.length})`;
          seeMoreBtn.className = 'see-more-btn';

          // Hidden container for additional hashtags
          const hiddenContainer = document.createElement('div');
          hiddenContainer.className = 'hidden-keywords';

          hiddenKeywords.forEach(tag => {
            const chip = document.createElement('span');
            chip.className = 'spoilwatch-history-chip';
            chip.textContent = tag;
            chip.style.cursor = 'pointer';
            chip.title = 'Click to add to blocked keywords';
            
            // Check if already blocked
            getBlockedKeywords().then(blockedKeywords => {
              if (blockedKeywords.includes(tag.replace('#', ''))) {
                chip.style.background = 'linear-gradient(135deg, #667eea 60%, #7f9cf5 100%)';
                chip.style.color = '#fff';
                chip.style.opacity = '0.85';
                chip.title = 'Already blocked';
                chip.style.cursor = 'not-allowed';
              }
            });
            
            // Add click handler
            chip.addEventListener('click', async () => {
              const blockedKeywords = await getBlockedKeywords();
              const cleanTag = tag.replace('#', '');
              
              if (blockedKeywords.includes(cleanTag)) {
                return; // Already blocked
              }
              
              // Add to blocked keywords
              const newBlockedKeywords = [...blockedKeywords, cleanTag];
              await new Promise(resolve => {
                chrome.storage.sync.set({blocked: newBlockedKeywords}, resolve);
              });

              // Also add to keywordHistory if not present
              const keywordHistory = await getKeywordHistory();
              if (!keywordHistory.includes(cleanTag)) {
                const newHistory = [...keywordHistory, cleanTag];
                await new Promise(resolve => {
                  chrome.storage.sync.set({keywordHistory: newHistory}, resolve);
                });
              }
              
              // Update chip appearance
              chip.style.background = 'linear-gradient(135deg, #667eea 60%, #7f9cf5 100%)';
              chip.style.color = '#fff';
              chip.style.opacity = '0.85';
              chip.title = 'Already blocked';
              chip.style.cursor = 'not-allowed';
              
              console.log(`Added "${cleanTag}" to blocked keywords and keyword history`);
            });
            
            hiddenContainer.appendChild(chip);
          });

          section.appendChild(hiddenContainer);

          // Toggle functionality
          seeMoreBtn.addEventListener('click', () => {
            if (hiddenContainer.style.display === 'none') {
              hiddenContainer.style.display = 'flex';
              seeMoreBtn.textContent = 'See Less';
            } else {
              hiddenContainer.style.display = 'none';
              seeMoreBtn.textContent = `See More (${hiddenKeywords.length})`;
            }
          });

          section.appendChild(seeMoreBtn);
        }

        card.appendChild(section);
      }
    });
    }

    // Function to load keyword history
    function loadKeywordHistory() {
      // Helper: get blocked keywords
      function getBlockedKeywords() {
        return new Promise((resolve) => {
          try {
            chrome.storage.sync.get(['blocked'], (res) => {
              if (chrome.runtime.lastError) {
                resolve([]);
                return;
              }
              resolve(res.blocked || []);
            });
          } catch {
            resolve([]);
          }
        });
      }
      // Helper: set blocked keywords
      function setBlockedKeywords(keywords) {
        return new Promise((resolve) => {
          chrome.storage.sync.set({blocked: keywords}, resolve);
        });
      }
      // Helper: get keyword history
      function getKeywordHistory() {
        return new Promise((resolve) => {
          chrome.storage.sync.get(['keywordHistory'], (res) => {
            resolve(res.keywordHistory || []);
          });
        });
      }

      async function renderKeywordHistory() {
        const historyList = document.getElementById('spoilwatch-history-list');
        const emptyMsg = document.getElementById('spoilwatch-history-empty');
        if (!historyList || !emptyMsg) return;
        
        historyList.innerHTML = '';
        const [history, blocked] = await Promise.all([
          getKeywordHistory(),
          getBlockedKeywords()
        ]);
        
        if (!history || history.length === 0) {
          emptyMsg.style.display = 'block';
          return;
        }
        
        emptyMsg.style.display = 'none';
        history.forEach(keyword => {
          const chip = document.createElement('button');
          chip.className = 'spoilwatch-history-chip';
          chip.innerHTML = `<span class="hashtag">#</span>${keyword}<span class="chip-x" title="Remove">&times;</span>`;
          chip.disabled = blocked.includes(keyword);
          if (blocked.includes(keyword)) {
            chip.classList.add('added');
            chip.title = 'Already blocked';
          } else {
            chip.title = 'Click to add to blocked keywords';
          }
          // Remove keyword from history and blocked when X is clicked
          const xBtn = chip.querySelector('.chip-x');
          xBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            // Remove from blocked if present
            const newBlocked = (await getBlockedKeywords()).filter(k => k !== keyword);
            await new Promise(res => chrome.storage.sync.set({blocked: newBlocked}, res));
            // Do NOT remove from keywordHistory, only from blocked
            // Re-render
            renderKeywordHistory();
          });
          chip.addEventListener('click', async () => {
            if (blocked.includes(keyword)) return;
            const newBlocked = [...blocked, keyword];
            await setBlockedKeywords(newBlocked);
            chip.disabled = true;
            chip.classList.add('added');
            chip.title = 'Already blocked';
          });
          historyList.appendChild(chip);
        });
      }
      renderKeywordHistory();
    }


    // Inject fullscreen.css styles if not already present
    if (!document.getElementById('spoilwatch-fullscreen-css')) {
      const link = document.createElement('link');
      link.id = 'spoilwatch-fullscreen-css';
      link.rel = 'stylesheet';
      link.type = 'text/css';
      link.href = chrome.runtime.getURL('popup/fullscreen.css');
      document.head.appendChild(link);
    }
    // Close logic
    const closeBtn = document.getElementById('spoilwatch-close-fullscreen-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        // Check if a feature view is currently open
        const featureView = document.getElementById('feature-view');
        const featureSelectionGrid = document.getElementById('feature-selection-grid');
        
        if (featureView && featureSelectionGrid) {
          // If feature view is open, go back to feature selection grid
          featureView.remove();
          featureSelectionGrid.style.display = 'grid';
        } else {
          // If already on feature selection grid, close the entire overlay
          overlay.remove();
          // Re-enable YouTube page scrolling
          document.body.classList.remove('spoilwatch-overlay-open');
          document.documentElement.classList.remove('spoilwatch-overlay-open');
        }
      });
    }
    function handleEscClose(e) {
      if (e.key === 'Escape') {
        // Check if a feature view is currently open
        const featureView = document.getElementById('feature-view');
        const featureSelectionGrid = document.getElementById('feature-selection-grid');
        
        if (featureView && featureSelectionGrid) {
          // If feature view is open, go back to feature selection grid
          featureView.remove();
          featureSelectionGrid.style.display = 'grid';
        } else {
          // If already on feature selection grid, close the entire overlay
          overlay.remove();
          // Re-enable YouTube page scrolling
          document.body.classList.remove('spoilwatch-overlay-open');
          document.documentElement.classList.remove('spoilwatch-overlay-open');
          window.removeEventListener('keydown', handleEscClose, true);
        }
      }
    }
    window.addEventListener('keydown', handleEscClose, true);
    overlay.tabIndex = -1;
    overlay.focus();
    return;
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
    observer.disconnect(); 
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

  console.log('SpoilWipe: MutationObserver is now watching Shorts DOM');
}

function startIntervalFallback() {
  if (videoCheckInterval) clearInterval(videoCheckInterval);
  videoCheckInterval = setInterval(() => {
    const newVideoId = getCurrentVideoId();
    if (newVideoId && newVideoId !== currentVideoId) {
      handleNewShortsVideo(newVideoId);
    }
  }, 1000);
}

startShortsObserver();
startIntervalFallback();

function getActiveShortsCard() {
  const cards = Array.from(document.querySelectorAll('ytd-reel-video-renderer'));
  if (!cards.length) return null;
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

const OMDB_API_KEY = '797f9541';

function toHashtag(str) {
  return '#' + str.toLowerCase().replace(/\s+/g, '');
}

async function getSmartSpoilerKeywords(limit = 5) {
  const movieTitles = ['The Fantastic Four: First Steps', 'Happy Gilmore 2', 'Superman', 'Eddington', 'F1: The Movie']; // you can replace or fetch trending list
  const results = {};

  for (const title of movieTitles.slice(0, limit)) {
    try {
      const res = await fetch(`https://www.omdbapi.com/?apikey=${OMDB_API_KEY}&t=${encodeURIComponent(title)}`);
      const data = await res.json();
      const keywords = new Set();

      if (data.Title) keywords.add(toHashtag(data.Title));
      if (data.Genre) data.Genre.split(',').forEach(g => keywords.add(toHashtag(g)));
      if (data.Actors) data.Actors.split(',').forEach(a => keywords.add(toHashtag(a)));
      if (data.Director) data.Director.split(',').forEach(d => keywords.add(toHashtag(d)));
      if (data.Year) keywords.add(`#${data.Year}`);

      results[data.Title || title] = [...keywords].slice(0, 10); // max 10 hashtags
    } catch (err) {
      console.error(`OMDb fetch failed for "${title}":`, err);
    }
  }

  return results;
}

function getKeywordBlockCounts() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['keywordBlockCounts'], (res) => {
      resolve(res.keywordBlockCounts || {});
    });
  });
}
function setKeywordBlockCounts(counts) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ keywordBlockCounts: counts }, resolve);
  });
}

async function renderAnalyticsBarGraph() {
  console.log('[SpoilWipe][Analytics] renderAnalyticsBarGraph called');
  const graphContainer = document.getElementById('analytics-bar-graph');
  const emptyState = document.getElementById('analytics-empty-state');
  if (!graphContainer || !emptyState) {
    console.error('[SpoilWipe][Analytics] Missing graphContainer or emptyState elements');
    return;
  }
  
  console.log('[SpoilWipe][Analytics] Fetching keywordBlockCounts from storage...');
  const counts = await getKeywordBlockCounts();
  console.log('[SpoilWipe][Analytics] Counts loaded for bar graph:', counts);
  console.log('[SpoilWipe][Analytics] Counts type:', typeof counts);
  console.log('[SpoilWipe][Analytics] Counts keys:', Object.keys(counts));
  
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  console.log('[SpoilWipe][Analytics] Sorted entries:', entries);
  
  if (entries.length === 0) {
    console.log('[SpoilWipe][Analytics] No entries found, showing empty state');
    graphContainer.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }
  
  console.log('[SpoilWipe][Analytics] Rendering bar graph with entries:', entries);
  emptyState.style.display = 'none';
  // Find max count for scaling
  const maxCount = Math.max(...entries.map(e => e[1]));
  console.log('[SpoilWipe][Analytics] Max count for scaling:', maxCount);
  
  graphContainer.innerHTML = entries.map(([keyword, count]) => `
    <div style="display:flex;align-items:center;margin-bottom:14px;">
      <span style="min-width:110px;font-weight:700;font-size:1.1rem;color:#7f9cf5;letter-spacing:0.5px;">#${keyword}</span>
      <div style="flex:1;margin:0 12px;background:rgba(127,156,245,0.12);border-radius:8px;overflow:hidden;height:24px;position:relative;">
        <div style="height:100%;width:${(count/maxCount)*100}%;background:linear-gradient(90deg,#667eea,#9f7aea);border-radius:8px;transition:width 0.4s;"></div>
      </div>
      <span style="min-width:32px;text-align:right;font-size:1.1rem;font-weight:700;color:#c3c8d4;">${count}</span>
    </div>
  `).join('');
  
  console.log('[SpoilWipe][Analytics] Bar graph rendered successfully');
}


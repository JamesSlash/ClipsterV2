/**
 * @typedef {Object} TranscriptData
 * @property {number} startTime - Start time of the transcript in seconds
 * @property {number} endTime - End time of the transcript in seconds
 * @property {string} text - Transcribed text content
 */

/**
 * @typedef {Object} ProcessingState
 * @property {boolean} isDownloading - Whether a download is in progress
 * @property {boolean} isTranscribing - Whether transcription is in progress
 * @property {string|null} lastUrl - Last processed YouTube URL
 * @property {Map<number, TranscriptData>} lastTranscripts - Map of processed transcripts
 * @property {boolean} clipInProgress - Whether clip creation is in progress
 */

/**
 * @typedef {Object} ErrorState
 * @property {string|null} type - Type of error (from ErrorTypes)
 * @property {number} retryCount - Number of retry attempts
 * @property {Error|null} lastError - Last error that occurred
 * @property {boolean} isRecovering - Whether recovery is in progress
 */

// Import socket.io-client
let socket = null;

// DOM Elements
let status, youtubeUrl, startBtn, stopBtn, transcriptContainer, selectedRange, clipQuality, createClipBtn, clipPreview, clipVideo, downloadClipBtn, copyLinkBtn;

// Initialize DOM elements
function initializeElements() {
    status = document.getElementById('status');
    youtubeUrl = document.getElementById('youtubeUrl');
    startBtn = document.getElementById('startBtn');
    stopBtn = document.getElementById('stopBtn');
    transcriptContainer = document.getElementById('transcriptContainer');
    selectedRange = document.getElementById('selectedRange');
    clipQuality = document.getElementById('clipQuality');
    createClipBtn = document.getElementById('createClipBtn');
    clipPreview = document.getElementById('clipPreview');
    clipVideo = document.getElementById('clipVideo');
    downloadClipBtn = document.getElementById('downloadClipBtn');
    copyLinkBtn = document.getElementById('copyLinkBtn');
    clipStatusEl = document.getElementById('clipStatus');
    clipsContainerEl = document.getElementById('clipsContainer');

    // Initialize the floating clip button
    initFloatingClipButton();

    // Add click handler for the footer create clip button
    if (createClipBtn) {
        createClipBtn.addEventListener('click', onClipButtonClick);
    }

    // Initialize socket connection
    initializeSocket();

    // Initialize transcript block event listeners
    initializeTranscriptBlock();
}

function initializeTranscriptBlock() {
    const textBlock = document.getElementById('transcriptBlock');
    if (textBlock) {
        console.log('Adding mouseup listener to transcript block');
        // Remove any existing listeners
        textBlock.removeEventListener('mouseup', handleTextSelection);
        textBlock.removeEventListener('mousedown', clearWordSelection);
        
        // Add new listeners
        textBlock.addEventListener('mouseup', handleTextSelection);
        textBlock.addEventListener('mousedown', clearWordSelection);
    } else {
        console.warn('Transcript block not found');
    }
}

function initializeSocket() {
    socket = io();

    socket.on('connect', () => {
        updateStatus('Connected to server', 'success');
        
        // Request available models on connection
        socket.emit('getAvailableModels');
        });
        
        socket.on('disconnect', () => {
        updateStatus('Disconnected from server', 'error');
        setLoading(false);
    });

    socket.on('error', (error) => {
        console.error('Server error:', error);
        const errorMessage = error.message || error;
        updateStatus(`Error: ${errorMessage}`, 'error');
            setLoading(false);
        });

    socket.on('downloadStatus', (message) => {
        console.log('Download status:', message);
        updateStatus(message, 'info');
    });

    socket.on('transcriptionStatus', (message) => {
        console.log('Transcription status:', message);
        updateStatus(message, 'info');
    });

    socket.on('transcriptionUpdate', handleTranscriptionUpdate);

    socket.on('availableModels', (models) => {
        const modelSelect = document.getElementById('modelSelect');
        if (modelSelect) {
            modelSelect.innerHTML = ''; // Clear existing options
            models.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = `${model.charAt(0).toUpperCase() + model.slice(1)} ${getModelDescription(model)}`;
                modelSelect.appendChild(option);
            });
        }
    });

    socket.on('processingStarted', (data) => {
        console.log('Processing started:', data);
        if (data.model) {
            const modelSelect = document.getElementById('modelSelect');
            if (modelSelect) {
                modelSelect.value = data.model;
                updateModelDescription(data.model);
            }
        }
    });

    // Clip creation events
    socket.on('clipProgress', ({ id, progress }) => {
        console.log(`Clip progress: ${progress}%`);
        const clipItem = document.getElementById(`clip-${id}`);
        if (clipItem) {
            const progressBar = clipItem.querySelector('.clip-progress-bar');
            if (progressBar) {
                progressBar.style.width = `${progress}%`;
            }
        }
    });

    socket.on('clipReady', (clipData) => {
        console.log('Clip ready:', clipData);
        // Remove processing clip item if it exists
        const processingClip = document.getElementById(`clip-${clipData.id}`);
        if (processingClip) {
            processingClip.remove();
        }
        // Add the completed clip
        addClipToUI(clipData);
        updateStatus('Clip created successfully!', 'success');
    });

    socket.on('clipError', ({ id, error }) => {
        console.error('Clip error:', error);
        // Remove processing clip item if it exists
        const processingClip = document.getElementById(`clip-${id}`);
        if (processingClip) {
            processingClip.remove();
        }
        updateStatus(`Failed to create clip: ${error}`, 'error');
    });

    // Add event listeners for buttons
    const startBtn = document.getElementById('startBtn');
    if (startBtn) {
        startBtn.addEventListener('click', () => {
            const url = document.getElementById('youtubeUrl')?.value.trim();
            if (!validateYouTubeLiveUrl(url)) {
                updateStatus('Invalid YouTube live URL format', 'error');
                return;
            }
            
            const model = document.getElementById('modelSelect')?.value || 'base';
            const language = document.getElementById('languageSelect')?.value || 'auto';
            console.log('Starting download for URL:', url, 'with model:', model, 'and language:', language);
            
            document.getElementById('transcriptContainer').innerHTML = '';
            setLoading(true);
            socket.emit('startDownload', { url, model, language });
        });
    }
        
    const stopBtn = document.getElementById('stopBtn');
    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            console.log('Stopping all processes');
            socket.emit('stop');
            setLoading(false);
        });
    }
}

// Call initialization on load
if (typeof window !== 'undefined') {
    window.addEventListener('load', initializeElements);
}

// State variables
let selectedStart = null;
let selectedEnd = null;
let currentClipUrl = null;
let isProcessing = false;

// State variables for text selection
const MIN_WORDS_REQUIRED = 3;
let selectionStartSec = null;
let selectionEndSec = null;
let selectedTokens = [];
let floatingClipBtn = null;
let isProcessingClip = false;

// Add to your existing state variables
let clipsList = [];
let clipStatusEl, clipsContainerEl;

function validateYouTubeLiveUrl(url) {
    try {
        const urlObj = new URL(url);
        // Accept both YouTube live URLs and direct HLS/DASH URLs
        return url.includes('.m3u8') || url.includes('.mpd') || 
               /^https?:\/\/(www\.)?youtube\.com\/(live\/[a-zA-Z0-9_-]+|watch\?v=[a-zA-Z0-9_-]+)/.test(url);
    } catch {
        return false;
    }
}

function formatTime(seconds) {
    const date = new Date(seconds * 1000);
    const hours = date.getUTCHours();
    const minutes = date.getUTCMinutes();
    const secs = date.getUTCSeconds();
    const ms = date.getUTCMilliseconds();
    
    if (hours > 0) {
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

function createTranscriptLine(line) {
    const div = document.createElement('div');
    div.className = 'transcript-line';
    div.dataset.start = line.startTime;
    div.dataset.end = line.endTime;
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'transcript-time';
    timeSpan.textContent = formatTime(line.startTime);
    
    const textSpan = document.createElement('span');
    textSpan.className = 'transcript-text';
    textSpan.textContent = line.text;
    
    div.appendChild(timeSpan);
    div.appendChild(textSpan);
    div.addEventListener('click', () => handleTranscriptClick(div));
    
    return div;
}

function handleTranscriptClick(element) {
    const start = parseFloat(element.dataset.start);
    const end = parseFloat(element.dataset.end);
    
    if (!selectedStart) {
        selectedStart = start;
        selectedEnd = end;
        element.classList.add('selected');
    } else {
        if (start < selectedStart) {
            selectedStart = start;
        }
        if (end > selectedEnd) {
            selectedEnd = end;
        }
        element.classList.add('selected');
    }
    
    updateSelectedRange();
    createClipBtn.disabled = false;
}

function clearSelection() {
    selectedStart = null;
    selectedEnd = null;
    document.querySelectorAll('.transcript-line').forEach(el => {
        el.classList.remove('selected');
    });
    if (selectedRange) {
        selectedRange.textContent = '';
    }
    if (createClipBtn) {
        createClipBtn.disabled = true;
    }
}

function updateSelectedRange() {
    if (!selectedRange) return;
    
    if (selectedStart !== null && selectedEnd !== null) {
        const duration = selectedEnd - selectedStart;
        selectedRange.textContent = `Selected: ${formatTime(selectedStart)} - ${formatTime(selectedEnd)} (Duration: ${duration.toFixed(2)}s)`;
    } else {
        selectedRange.textContent = '';
    }
}

function setLoading(isLoading) {
    startBtn.disabled = isLoading;
    stopBtn.disabled = !isLoading;
    document.getElementById('modelSelect').disabled = isLoading;
    document.getElementById('languageSelect').disabled = isLoading;
    youtubeUrl.disabled = isLoading;
}

function updateModelDescription(model) {
    const descriptions = {
        tiny: 'Fastest, suitable for quick transcription',
        base: 'Good balance of speed and accuracy',
        small: 'Better accuracy, moderate speed',
        medium: 'High accuracy, slower processing',
        large: 'Most accurate, slowest processing'
    };
    
    const modelInfo = document.querySelector('.model-description');
    if (modelInfo) {
        modelInfo.innerHTML = `
            <strong>Selected Model: ${model}</strong><br>
            ${descriptions[model] || 'No description available'}
        `;
    }
}

function getModelDescription(model) {
    const descriptions = {
        tiny: '(Fast, less accurate)',
        base: '(Balanced)',
        small: '(More accurate)',
        medium: '(High accuracy)',
        large: '(Most accurate, slowest)'
    };
    return descriptions[model] || '';
}

/**
 * Handles text selection in the transcript block
 */
function handleTextSelection(event) {
    console.log('handleTextSelection called');
    const selection = window.getSelection();

    // Clear existing selection if clicking without dragging
    if (!selection || selection.isCollapsed) {
        console.log('No selection or collapsed selection');
        clearWordSelection();
        return;
    }

    // Get the selected range
    const range = selection.getRangeAt(0);
    console.log('Selection range:', {
        startOffset: range.startOffset,
        endOffset: range.endOffset,
        text: range.toString()
    });

    // Get all word tokens in the selection
    selectedTokens = getTokensInRange(range);
    console.log('Selected tokens:', selectedTokens.length);

    // Validate minimum word requirement
    if (selectedTokens.length < MIN_WORDS_REQUIRED) {
        console.log('Not enough words selected:', selectedTokens.length);
        updateStatus(`Please select at least ${MIN_WORDS_REQUIRED} words to create a clip`, 'error');
        clearWordSelection();
        return;
    }

    // Calculate selection times
    if (selectedTokens.length > 0) {
        selectionStartSec = parseFloat(selectedTokens[0].dataset.start);
        selectionEndSec = parseFloat(selectedTokens[selectedTokens.length - 1].dataset.end);

        // Validate time range
        if (isNaN(selectionStartSec) || isNaN(selectionEndSec) || selectionEndSec <= selectionStartSec) {
            console.error('Invalid time range:', { start: selectionStartSec, end: selectionEndSec });
            updateStatus('Invalid time range selected', 'error');
            clearWordSelection();
            return;
        }

        console.log('Selection times:', {
            start: selectionStartSec,
            end: selectionEndSec,
            duration: selectionEndSec - selectionStartSec
        });

        // Update UI with selection info
        if (selectedRange) {
            const duration = selectionEndSec - selectionStartSec;
            selectedRange.textContent = `Selected: ${formatTime(selectionStartSec)} to ${formatTime(selectionEndSec)} (${duration.toFixed(2)}s)`;
        }

        // Enable clip buttons and show floating button
        enableClipButtons();
        const lastToken = selectedTokens[selectedTokens.length - 1];
        if (lastToken) {
            showFloatingClipButton(lastToken);
        }
    } else {
        clearWordSelection();
    }
}

/**
 * Utility to find all .word-token elements contained (partially or fully) within the given range.
 */
function getTokensInRange(range) {
    console.log('Getting tokens in range');
    const textBlock = document.getElementById('transcriptBlock');
    if (!textBlock) {
        console.warn('No transcript block found');
        return [];
    }

    const tokens = Array.from(textBlock.querySelectorAll('.word-token'));
    console.log('Total tokens found:', tokens.length);
    
    if (tokens.length === 0) {
        return [];
    }

    // Find the closest token to the start and end of the selection
    let startToken = null;
    let endToken = null;
    let startNode = range.startContainer;
    let endNode = range.endContainer;

    // Helper function to find closest token
    const findClosestToken = (node) => {
        while (node && node !== textBlock) {
            if (node.classList && node.classList.contains('word-token')) {
                return node;
            }
            // If we're in a text node, check its parent
            if (node.nodeType === 3) {
                const parentToken = node.parentElement.closest('.word-token');
                if (parentToken) {
                    return parentToken;
                }
            }
            node = node.parentElement;
        }
        return null;
    };

    // If selection starts/ends in text node, find the containing word token
    if (startNode.nodeType === 3) {
        startToken = findClosestToken(startNode);
    } else {
        startToken = startNode.closest('.word-token');
    }

    if (endNode.nodeType === 3) {
        endToken = findClosestToken(endNode);
    } else {
        endToken = endNode.closest('.word-token');
    }

    // If we still don't have valid tokens, try to find the closest ones
    if (!startToken || !endToken) {
        console.log('Could not find direct tokens, searching for closest ones');
        const selection = window.getSelection();
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        // Find tokens by position if direct search failed
        if (!startToken) {
            startToken = tokens.find(token => {
                const tokenRect = token.getBoundingClientRect();
                return tokenRect.right >= rect.left;
            }) || tokens[0];
        }
        
        if (!endToken) {
            endToken = tokens.slice().reverse().find(token => {
                const tokenRect = token.getBoundingClientRect();
                return tokenRect.left <= rect.right;
            }) || tokens[tokens.length - 1];
        }
    }

    console.log('Start token:', startToken?.textContent);
    console.log('End token:', endToken?.textContent);

    if (!startToken || !endToken) {
        console.warn('Could not find start or end token');
        return [];
    }

    // Collect all tokens between start and end
    const selected = [];
    let inRange = false;
    
    tokens.forEach(token => {
        if (token === startToken) {
            inRange = true;
        }
        
        if (inRange) {
            selected.push(token);
            token.classList.add('word-selected');
        } else {
            token.classList.remove('word-selected');
        }
        
        if (token === endToken) {
            inRange = false;
        }
    });

    // If selection is backwards, reverse the order
    if (tokens.indexOf(startToken) > tokens.indexOf(endToken)) {
        selected.reverse();
    }

    console.log('Selected tokens:', selected.length);
    return selected;
}

/**
 * Reset any existing selection state and disable the clip button.
 */
function clearWordSelection() {
    selectionStartSec = null;
    selectionEndSec = null;
    selectedTokens = [];

    const textBlock = document.getElementById('transcriptBlock');
    if (textBlock) {
        const tokens = textBlock.querySelectorAll('.word-token');
        tokens.forEach(token => token.classList.remove('word-selected'));
    }

    // Disable both clip buttons
    disableClipButtons();

    if (selectedRange) {
        selectedRange.textContent = '';
    }
}

/**
 * Creates a clip from the current selection
 */
function onClipButtonClick() {
    if (isProcessingClip) {
        updateStatus('A clip is already being processed', 'info');
        return;
    }

    if (!selectionStartSec || !selectionEndSec || selectedTokens.length < MIN_WORDS_REQUIRED) {
        updateStatus('Please select text to create a clip', 'error');
        return;
    }

    const clipId = Date.now().toString();
    const quality = document.getElementById('clipQuality')?.value || 'high';

    // Add processing clip item to UI
    addClipToUI({
        id: clipId,
        status: 'processing',
        startTime: selectionStartSec,
        endTime: selectionEndSec,
        text: selectedTokens.map(token => token.textContent).join(' ')
    });

    isProcessingClip = true;

    // Request clip creation
    socket.emit('createClip', {
        id: clipId,
        startTime: selectionStartSec,
        endTime: selectionEndSec,
        quality
    });

    // Reset selection state
    hideFloatingClipButton();
    clearWordSelection();
}

function initFloatingClipButton() {
    // Remove any existing floating button first
    if (floatingClipBtn) {
        floatingClipBtn.remove();
    }

    // Create new button
    floatingClipBtn = document.createElement('button');
    floatingClipBtn.textContent = 'Create Clip';
    floatingClipBtn.className = 'clip-button-hidden';
    floatingClipBtn.id = 'floatingClipBtn';
    
    // Add click handler with stopPropagation
    floatingClipBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClipButtonClick();
    });
    
    // Add mousedown handler to prevent text deselection
    floatingClipBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    document.body.appendChild(floatingClipBtn);
    console.log('Floating clip button initialized with id:', floatingClipBtn.id);
}

function showFloatingClipButton(token) {
    console.log('showFloatingClipButton called with token:', token.textContent);
    
    if (!floatingClipBtn) {
        console.log('Creating new floating button');
        initFloatingClipButton();
    }

    // Get bounding box for the last token
    const rect = token.getBoundingClientRect();
    console.log('Token bounding rect:', rect);

    // Get scroll position and viewport dimensions
    const scrollY = window.pageYOffset || document.documentElement.scrollTop;
    const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Calculate position (10px to the right and slightly above the selection)
    const top = rect.top + scrollY - 30; // 30px above
    const left = rect.right + scrollX + 10;

    console.log('Computed position:', { top, left, scrollY, scrollX });

    // Apply position
    floatingClipBtn.style.position = 'absolute';
    floatingClipBtn.style.top = `${top}px`;
    floatingClipBtn.style.left = `${left}px`;

    // Ensure button stays within viewport
    const buttonRect = floatingClipBtn.getBoundingClientRect();
    if (buttonRect.right > viewportWidth) {
        const adjustedLeft = left - buttonRect.width - 20;
        floatingClipBtn.style.left = `${adjustedLeft}px`;
    }
    if (buttonRect.top < 0) {
        const adjustedTop = rect.bottom + scrollY + 10;
        floatingClipBtn.style.top = `${adjustedTop}px`;
    }

    // Show the button with animation
    floatingClipBtn.style.opacity = '0';
    floatingClipBtn.classList.remove('clip-button-hidden');
    floatingClipBtn.classList.add('clip-button-visible');
    
    // Force reflow and fade in
    floatingClipBtn.offsetHeight;
    floatingClipBtn.style.opacity = '1';
    
    console.log('Button shown with classes:', floatingClipBtn.className);
}

function hideFloatingClipButton() {
    if (floatingClipBtn) {
        floatingClipBtn.classList.remove('clip-button-visible');
        floatingClipBtn.classList.add('clip-button-hidden');
    }
}

function enableClipButtons() {
    console.log('Enabling clip buttons');
    // Enable the footer button
    if (createClipBtn) {
        createClipBtn.disabled = false;
        console.log('Footer clip button enabled');
    }
    // Show the floating button if we have one and we have selected tokens
    if (floatingClipBtn && selectedTokens.length > 0) {
        const lastToken = selectedTokens[selectedTokens.length - 1];
        if (lastToken) {
            showFloatingClipButton(lastToken);
            console.log('Floating clip button shown');
        }
    }
}

function disableClipButtons() {
    console.log('Disabling clip buttons');
    // Disable the footer button
    if (createClipBtn) {
        createClipBtn.disabled = true;
        console.log('Footer clip button disabled');
    }
    // Hide the floating button
    hideFloatingClipButton();
    console.log('Floating clip button hidden');
}

function addClipToUI(clipData) {
    const clipsContainer = document.getElementById('clipsContainer');
    if (!clipsContainer) {
        console.error('Clips container not found');
        return;
    }
    
    // Create clip item container
    const clipItem = document.createElement('div');
    clipItem.className = 'clip-item';
    clipItem.id = `clip-${clipData.id}`;

    if (clipData.status === 'processing') {
        // Show progress bar for processing clips
        clipItem.innerHTML = `
            <div class="clip-details">
                <h4>Creating clip...</h4>
                <div class="clip-progress">
                    <div class="clip-progress-bar" style="width: 0%"></div>
                </div>
            </div>
        `;
    } else {
        // Show completed clip with thumbnail and actions
        const clipPath = clipData.clipPath.startsWith('/clips/') ? clipData.clipPath : `/clips/${path.basename(clipData.clipPath)}`;
        const thumbPath = clipData.thumbPath.startsWith('/clips/') ? clipData.thumbPath : `/clips/${path.basename(clipData.thumbPath)}`;
        
        // Use a default thumbnail if none provided
        const thumbnailSrc = clipData.thumbPath === 'placeholder.jpg' ? 
            '/images/placeholder-thumbnail.png' : thumbPath;

        clipItem.innerHTML = `
            <img class="clip-thumbnail" src="${thumbnailSrc}" alt="Clip thumbnail" onerror="this.src='/images/placeholder-thumbnail.png'">
            <div class="clip-details">
                <h4>Clip [${formatTime(clipData.startTime)} - ${formatTime(clipData.endTime)}]</h4>
                <p>Duration: ${(clipData.endTime - clipData.startTime).toFixed(2)}s</p>
                <div class="clip-actions">
                    <a href="${clipPath}" class="download-link" download="clip_${clipData.id}.mp4">Download</a>
                    <a href="${clipPath}" class="preview-link" target="_blank">Preview</a>
                </div>
            </div>
        `;
    }
    
    // Add to container at the beginning
    if (clipsContainer.firstChild) {
        clipsContainer.insertBefore(clipItem, clipsContainer.firstChild);
    } else {
        clipsContainer.appendChild(clipItem);
    }
}

/**
 * Updates the UI for a clip's progress
 */
function updateClipProgress(clipId, progress) {
    const clipItem = document.getElementById(`clip-${clipId}`);
    if (clipItem) {
        const progressBar = clipItem.querySelector('.clip-progress-bar');
        const progressText = clipItem.querySelector('.progress-text');
        if (progressBar) {
            progressBar.style.width = `${progress}%`;
        }
        if (progressText) {
            progressText.textContent = `${Math.round(progress)}%`;
        }
    }
}

/**
 * Finalizes a clip in the UI once it's ready
 */
function finalizeClip(clipData) {
    isProcessingClip = false;
    const clipItem = document.getElementById(`clip-${clipData.id}`);
    if (clipItem) {
        clipItem.innerHTML = `
            <img class="clip-thumbnail" src="/clips/${path.basename(clipData.thumbPath)}" alt="Clip thumbnail">
            <div class="clip-details">
                <h4>Clip [${formatTime(clipData.startTime)} - ${formatTime(clipData.endTime)}]</h4>
                <p>Duration: ${(clipData.endTime - clipData.startTime).toFixed(2)}s</p>
                <div class="clip-actions">
                    <a href="/clips/${path.basename(clipData.clipPath)}" class="download-link" download="clip_${clipData.id}.mp4">Download</a>
                    <a href="/clips/${path.basename(clipData.clipPath)}" class="preview-link" target="_blank">Preview</a>
                </div>
            </div>
        `;

        updateStatus('Clip created successfully!', 'success');
    }
}

function updateStatus(message, type = 'info') {
    console.log(`Status update: ${message} (${type})`);
    const statusEl = document.getElementById('status');
    if (statusEl) {
        statusEl.textContent = message;
        statusEl.className = type;
    }
}

function handleTranscriptionUpdate(data) {
    console.log('Received transcription update:', data);
    if (data && data.segments && Array.isArray(data.segments)) {
        console.log(`Processing ${data.segments.length} segments`);

        // Find or create the single text block container
        let textBlock = document.getElementById('transcriptBlock');
        if (!textBlock) {
            textBlock = document.createElement('div');
            textBlock.id = 'transcriptBlock';
            textBlock.className = 'transcript-block';
            
            // Add event listeners for text selection
            textBlock.addEventListener('mouseup', handleTextSelection);
            textBlock.addEventListener('mousedown', clearWordSelection);
            
            transcriptContainer.appendChild(textBlock);
        }
        
        // Process each segment
        data.segments.forEach(segment => {
            console.log('Processing segment:', segment);
            
            // Create a document fragment to hold all word tokens
            const fragment = document.createDocumentFragment();
            
            // Handle word-level timestamps if available
            if (segment.words && segment.words.length > 0) {
                console.log(`Processing ${segment.words.length} words in segment`);
                segment.words.forEach((word, index) => {
                    const wordSpan = document.createElement('span');
                    wordSpan.className = 'word-token';
                    wordSpan.textContent = word.text;
                    wordSpan.dataset.start = word.start;
                    wordSpan.dataset.end = word.end;
                    fragment.appendChild(wordSpan);
                    
                    // Add a space after each word
                    if (index < segment.words.length - 1) {
                        const space = document.createTextNode(' ');
                        fragment.appendChild(space);
                    }
                });
            } else {
                // Fallback: Split the segment text into words
                console.log('No word timestamps, splitting segment text into words');
                const words = segment.text.split(/\s+/);
                const wordDuration = (segment.end - segment.start) / words.length;
                
                words.forEach((word, index) => {
                    if (word.trim()) { // Only create spans for non-empty words
                        const wordSpan = document.createElement('span');
                        wordSpan.className = 'word-token';
                        wordSpan.textContent = word;
                        wordSpan.dataset.start = (segment.start + (index * wordDuration)).toFixed(3);
                        wordSpan.dataset.end = (segment.start + ((index + 1) * wordDuration)).toFixed(3);
                        fragment.appendChild(wordSpan);
                        
                        // Add a space after each word except the last one
                        if (index < words.length - 1) {
                            const space = document.createTextNode(' ');
                            fragment.appendChild(space);
                        }
                    }
                });
            }
            
            // Add a space after each segment
            fragment.appendChild(document.createTextNode(' '));
            
            // Append all words to the text block
            textBlock.appendChild(fragment);
            
            // Auto-scroll to bottom
            textBlock.scrollTop = textBlock.scrollHeight;
        });
    } else {
        console.warn('Invalid transcription update data:', data);
    }
}

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        validateYouTubeLiveUrl,
        formatTime,
        createTranscriptLine,
        handleTranscriptClick,
        clearSelection,
        updateSelectedRange,
        setLoading,
        initializeElements
    };
}

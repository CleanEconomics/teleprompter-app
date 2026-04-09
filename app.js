// ─── State ───
const state = {
  stream: null,
  mediaRecorder: null,
  recordedChunks: [],
  isRecording: false,
  recognition: null,
  isListening: false,
  scriptWords: [],
  currentWordIndex: 0,
  fontSize: 28,
  scrollSpeed: 30,
  manualScrollInterval: null,
  timerInterval: null,
  recordStartTime: 0,
  facingMode: 'user',
  mirrored: true,
};

// ─── DOM ───
const $ = (id) => document.getElementById(id);

const els = {
  editorScreen: $('editor-screen'),
  recordingScreen: $('recording-screen'),
  previewScreen: $('preview-screen'),
  scriptInput: $('script-input'),
  fontSizeSlider: $('font-size-slider'),
  scrollSpeedSlider: $('scroll-speed-slider'),
  cameraSelect: $('camera-select'),
  mirrorToggle: $('mirror-toggle'),
  startBtn: $('start-btn'),
  cameraPreview: $('camera-preview'),
  prompterText: $('prompter-text'),
  prompterContainer: $('prompter-container'),
  recordBtn: $('record-btn'),
  backBtn: $('back-btn'),
  scrollToggleBtn: $('scroll-toggle-btn'),
  recordTimer: $('record-timer'),
  timerDisplay: $('timer-display'),
  voiceIndicator: $('voice-indicator'),
  previewVideo: $('preview-video'),
  saveBtn: $('save-btn'),
  shareBtn: $('share-btn'),
  retakeBtn: $('retake-btn'),
};

// ─── Screen Navigation ───

function showScreen(screen) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  screen.classList.add('active');
}

// ─── Camera ───

async function startCamera() {
  try {
    if (state.stream) {
      state.stream.getTracks().forEach((t) => t.stop());
    }

    const constraints = {
      video: {
        facingMode: state.facingMode,
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 },
      },
      audio: true,
    };

    state.stream = await navigator.mediaDevices.getUserMedia(constraints);
    els.cameraPreview.srcObject = state.stream;

    if (state.mirrored && state.facingMode === 'user') {
      els.cameraPreview.classList.add('mirrored');
    } else {
      els.cameraPreview.classList.remove('mirrored');
    }
  } catch (err) {
    alert('Camera access denied. Please allow camera and microphone permissions.');
    console.error('Camera error:', err);
  }
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
  els.cameraPreview.srcObject = null;
}

// ─── Teleprompter ───

function buildPrompter(text) {
  // Split into words, preserving line breaks
  const lines = text.split('\n');
  let wordIndex = 0;
  state.scriptWords = [];

  els.prompterText.innerHTML = '';

  lines.forEach((line, lineIdx) => {
    if (lineIdx > 0) {
      els.prompterText.appendChild(document.createElement('br'));
      els.prompterText.appendChild(document.createElement('br'));
    }

    const words = line.split(/\s+/).filter((w) => w.length > 0);
    words.forEach((word) => {
      const span = document.createElement('span');
      span.className = 'word upcoming';
      span.textContent = word + ' ';
      span.dataset.index = wordIndex;
      els.prompterText.appendChild(span);

      state.scriptWords.push({
        original: word,
        normalized: normalizeWord(word),
        element: span,
      });
      wordIndex++;
    });
  });

  state.currentWordIndex = 0;
  updateWordHighlights();
  els.prompterText.style.fontSize = state.fontSize + 'px';
}

function normalizeWord(word) {
  return word
    .toLowerCase()
    .replace(/[^a-z0-9']/g, '')
    .replace(/^'+|'+$/g, '');
}

function updateWordHighlights() {
  const windowSize = 8; // how many upcoming words to highlight bright

  state.scriptWords.forEach((w, i) => {
    if (i < state.currentWordIndex) {
      w.element.className = 'word spoken';
    } else if (i === state.currentWordIndex) {
      w.element.className = 'word current';
    } else if (i <= state.currentWordIndex + windowSize) {
      w.element.className = 'word upcoming';
    } else {
      w.element.className = 'word';
    }
  });
}

function scrollToCurrentWord() {
  if (state.currentWordIndex >= state.scriptWords.length) return;

  const wordEl = state.scriptWords[state.currentWordIndex].element;
  const containerRect = els.prompterContainer.getBoundingClientRect();
  const wordRect = wordEl.getBoundingClientRect();

  // Target: keep current word near the top focus line (60px from top of container)
  const targetOffset = 60;
  const currentOffset = wordRect.top - containerRect.top;
  const scrollDelta = currentOffset - targetOffset;

  if (Math.abs(scrollDelta) > 5) {
    els.prompterContainer.scrollBy({
      top: scrollDelta,
      behavior: 'smooth',
    });
  }
}

// ─── Speech Recognition ───

function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('Speech recognition not supported. Using manual scroll only.');
    return;
  }

  state.recognition = new SpeechRecognition();
  state.recognition.continuous = true;
  state.recognition.interimResults = true;
  state.recognition.lang = 'en-US';
  state.recognition.maxAlternatives = 3;

  state.recognition.onresult = (event) => {
    // Get the latest result
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];

      // Process all alternatives for better matching
      for (let alt = 0; alt < result.length; alt++) {
        const transcript = result[alt].transcript.trim();
        if (transcript) {
          matchSpokenWords(transcript);
        }
      }
    }
  };

  state.recognition.onend = () => {
    // Auto-restart if we're still supposed to be listening
    if (state.isListening) {
      try {
        state.recognition.start();
      } catch (e) {
        // Already started, ignore
      }
    }
  };

  state.recognition.onerror = (event) => {
    if (event.error === 'no-speech' || event.error === 'aborted') {
      // These are normal, just restart
      return;
    }
    console.error('Speech recognition error:', event.error);
  };
}

function startListening() {
  if (!state.recognition) return;

  state.isListening = true;
  try {
    state.recognition.start();
    els.voiceIndicator.classList.remove('hidden');
  } catch (e) {
    // Already started
  }
}

function stopListening() {
  state.isListening = false;
  if (state.recognition) {
    try {
      state.recognition.stop();
    } catch (e) {}
  }
  els.voiceIndicator.classList.add('hidden');
}

function matchSpokenWords(transcript) {
  const spokenWords = transcript
    .split(/\s+/)
    .map(normalizeWord)
    .filter((w) => w.length > 0);

  if (spokenWords.length === 0) return;

  // Look ahead window from current position
  const lookAhead = Math.min(30, state.scriptWords.length - state.currentWordIndex);
  let bestMatchEnd = state.currentWordIndex;

  // Try to find the furthest matching position
  for (let spoken of spokenWords) {
    if (spoken.length < 2) continue; // skip tiny words for reliability

    for (let j = state.currentWordIndex; j < state.currentWordIndex + lookAhead && j < state.scriptWords.length; j++) {
      const scriptWord = state.scriptWords[j].normalized;

      // Exact match or close enough
      if (scriptWord === spoken || (scriptWord.length > 3 && spoken.length > 3 && levenshteinClose(scriptWord, spoken))) {
        if (j >= bestMatchEnd) {
          bestMatchEnd = j + 1;
        }
      }
    }
  }

  if (bestMatchEnd > state.currentWordIndex) {
    state.currentWordIndex = bestMatchEnd;
    updateWordHighlights();
    scrollToCurrentWord();
  }
}

function levenshteinClose(a, b) {
  // Quick check: if words are close enough (edit distance <= 2)
  if (Math.abs(a.length - b.length) > 2) return false;

  // Check if one starts with the other (handles partial recognition)
  if (a.startsWith(b) || b.startsWith(a)) return true;

  // Simple character overlap check
  let matches = 0;
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;

  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter[i])) matches++;
  }

  return matches / longer.length > 0.7;
}

// ─── Recording ───

function startRecording() {
  state.recordedChunks = [];

  // Use the stream that includes both video and audio
  const mimeType = getSupportedMimeType();
  const options = mimeType ? { mimeType } : {};

  try {
    state.mediaRecorder = new MediaRecorder(state.stream, options);
  } catch (e) {
    // Fallback without specifying mime type
    state.mediaRecorder = new MediaRecorder(state.stream);
  }

  state.mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      state.recordedChunks.push(event.data);
    }
  };

  state.mediaRecorder.onstop = () => {
    const mimeType = state.mediaRecorder.mimeType || 'video/mp4';
    const blob = new Blob(state.recordedChunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    els.previewVideo.src = url;
    showScreen(els.previewScreen);
    stopCamera();
    stopListening();
    stopManualScroll();
    stopTimer();
  };

  state.mediaRecorder.start(1000); // collect data every second
  state.isRecording = true;

  els.recordBtn.classList.add('recording');
  els.recordTimer.classList.remove('hidden');
  startTimer();

  // Start voice tracking
  startListening();
}

function stopRecording() {
  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    state.mediaRecorder.stop();
  }
  state.isRecording = false;
  els.recordBtn.classList.remove('recording');
}

function getSupportedMimeType() {
  const types = [
    'video/mp4;codecs=h264,aac',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];

  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return null;
}

// ─── Timer ───

function startTimer() {
  state.recordStartTime = Date.now();
  state.timerInterval = setInterval(updateTimer, 1000);
}

function stopTimer() {
  clearInterval(state.timerInterval);
  state.timerInterval = null;
  els.recordTimer.classList.add('hidden');
  els.timerDisplay.textContent = '00:00';
}

function updateTimer() {
  const elapsed = Math.floor((Date.now() - state.recordStartTime) / 1000);
  const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const secs = String(elapsed % 60).padStart(2, '0');
  els.timerDisplay.textContent = `${mins}:${secs}`;
}

// ─── Manual Scroll ───

function startManualScroll() {
  if (state.manualScrollInterval) return;
  if (state.scrollSpeed === 0) return;

  state.manualScrollInterval = setInterval(() => {
    els.prompterContainer.scrollBy({
      top: state.scrollSpeed / 15,
      behavior: 'auto',
    });
  }, 50);

  els.scrollToggleBtn.classList.add('active');
}

function stopManualScroll() {
  clearInterval(state.manualScrollInterval);
  state.manualScrollInterval = null;
  els.scrollToggleBtn.classList.remove('active');
}

function toggleManualScroll() {
  if (state.manualScrollInterval) {
    stopManualScroll();
  } else {
    startManualScroll();
  }
}

// ─── Save / Share ───

function saveVideo() {
  const mimeType = state.mediaRecorder?.mimeType || 'video/mp4';
  const blob = new Blob(state.recordedChunks, { type: mimeType });
  const ext = mimeType.includes('webm') ? 'webm' : 'mp4';
  const filename = `teleprompter-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.${ext}`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function shareVideo() {
  const mimeType = state.mediaRecorder?.mimeType || 'video/mp4';
  const blob = new Blob(state.recordedChunks, { type: mimeType });
  const ext = mimeType.includes('webm') ? 'webm' : 'mp4';
  const filename = `teleprompter-recording.${ext}`;
  const file = new File([blob], filename, { type: mimeType });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: 'Teleprompter Recording',
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        // Fallback to download
        saveVideo();
      }
    }
  } else {
    // Fallback to download
    saveVideo();
  }
}

// ─── Event Listeners ───

els.startBtn.addEventListener('click', async () => {
  const script = els.scriptInput.value.trim();
  if (!script) {
    alert('Please enter a script first.');
    return;
  }

  state.fontSize = parseInt(els.fontSizeSlider.value);
  state.scrollSpeed = parseInt(els.scrollSpeedSlider.value);
  state.facingMode = els.cameraSelect.value;
  state.mirrored = els.mirrorToggle.checked;

  buildPrompter(script);
  showScreen(els.recordingScreen);
  await startCamera();
  initSpeechRecognition();
});

els.recordBtn.addEventListener('click', () => {
  if (state.isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
});

els.backBtn.addEventListener('click', () => {
  if (state.isRecording) {
    stopRecording();
  }
  stopCamera();
  stopListening();
  stopManualScroll();
  stopTimer();
  showScreen(els.editorScreen);
});

els.scrollToggleBtn.addEventListener('click', toggleManualScroll);

els.saveBtn.addEventListener('click', saveVideo);
els.shareBtn.addEventListener('click', shareVideo);

els.retakeBtn.addEventListener('click', () => {
  els.previewVideo.src = '';
  state.recordedChunks = [];
  showScreen(els.editorScreen);
});

// Font size live update
els.fontSizeSlider.addEventListener('input', (e) => {
  state.fontSize = parseInt(e.target.value);
});

els.scrollSpeedSlider.addEventListener('input', (e) => {
  state.scrollSpeed = parseInt(e.target.value);
  // If manual scroll is active, restart with new speed
  if (state.manualScrollInterval) {
    stopManualScroll();
    startManualScroll();
  }
});

// Allow manual touch scrolling on the prompter
let touchStartY = 0;
els.prompterContainer.addEventListener('touchstart', (e) => {
  touchStartY = e.touches[0].clientY;
}, { passive: true });

els.prompterContainer.addEventListener('touchmove', (e) => {
  const deltaY = touchStartY - e.touches[0].clientY;
  els.prompterContainer.scrollTop += deltaY;
  touchStartY = e.touches[0].clientY;
}, { passive: true });

// Prevent zoom on double-tap
document.addEventListener('touchend', (e) => {
  if (e.target.closest('#prompter-container')) return;
  const now = Date.now();
  if (now - (document.lastTouchEnd || 0) < 300) {
    e.preventDefault();
  }
  document.lastTouchEnd = now;
}, { passive: false });

// Keep screen awake during recording
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (e) {}
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
}

// Override start/stop recording to include wake lock
const originalStartRecording = startRecording;
const originalStopRecording = stopRecording;

// Hijack the record button to also manage wake lock
els.recordBtn.addEventListener('click', () => {
  if (state.isRecording) {
    releaseWakeLock();
  } else {
    requestWakeLock();
  }
}, { capture: true });

// Service Worker registration
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

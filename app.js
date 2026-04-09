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
  // Scroll
  scrollSpeed: 1.0,       // multiplier: 0 = paused, 0.5 = slow, 1.0 = normal, 2.0 = fast
  basePixelsPerFrame: 1.2, // base scroll rate at 1.0x
  isAutoScrolling: false,
  scrollRAF: null,
  lastScrollTime: 0,
  userTouching: false,     // pause auto-scroll while user is touching
  // Timer
  timerInterval: null,
  recordStartTime: 0,
  // Camera
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
  speedUpBtn: $('speed-up-btn'),
  speedDownBtn: $('speed-down-btn'),
  scrollToggleBtn: $('scroll-toggle-btn'),
  scrollIconPlay: $('scroll-icon-play'),
  scrollIconPause: $('scroll-icon-pause'),
  speedDisplay: $('speed-display'),
  speedValue: $('speed-value'),
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
  const lines = text.split('\n');
  let wordIndex = 0;
  state.scriptWords = [];

  els.prompterText.innerHTML = '';

  // Add top padding so text starts below focus line
  const spacer = document.createElement('div');
  spacer.style.height = '20px';
  els.prompterText.appendChild(spacer);

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

  // Add bottom padding so last words can scroll to top
  const bottomSpacer = document.createElement('div');
  bottomSpacer.style.height = '70vh';
  els.prompterText.appendChild(bottomSpacer);

  state.currentWordIndex = 0;
  updateWordHighlights();
  els.prompterText.style.fontSize = state.fontSize + 'px';

  // Reset scroll position
  els.prompterContainer.scrollTop = 0;
}

function normalizeWord(word) {
  return word
    .toLowerCase()
    .replace(/[^a-z0-9']/g, '')
    .replace(/^'+|'+$/g, '');
}

function updateWordHighlights() {
  const windowSize = 12;

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

  const targetOffset = 60;
  const currentOffset = wordRect.top - containerRect.top;
  const scrollDelta = currentOffset - targetOffset;

  if (Math.abs(scrollDelta) > 10) {
    els.prompterContainer.scrollBy({
      top: scrollDelta,
      behavior: 'smooth',
    });
  }
}

// ─── Auto Scroll (rAF-based) ───

function startAutoScroll() {
  if (state.isAutoScrolling) return;
  state.isAutoScrolling = true;
  state.lastScrollTime = performance.now();
  state.scrollRAF = requestAnimationFrame(autoScrollTick);
  updateScrollUI();
}

function stopAutoScroll() {
  state.isAutoScrolling = false;
  if (state.scrollRAF) {
    cancelAnimationFrame(state.scrollRAF);
    state.scrollRAF = null;
  }
  updateScrollUI();
}

function autoScrollTick(now) {
  if (!state.isAutoScrolling) return;

  const delta = now - state.lastScrollTime;
  state.lastScrollTime = now;

  // Don't scroll while user is manually touching the prompter
  if (!state.userTouching && state.scrollSpeed > 0) {
    // pixels per millisecond, scaled by speed multiplier
    const px = state.basePixelsPerFrame * state.scrollSpeed * (delta / 16.67);
    els.prompterContainer.scrollTop += px;
  }

  state.scrollRAF = requestAnimationFrame(autoScrollTick);
}

function toggleAutoScroll() {
  if (state.isAutoScrolling) {
    stopAutoScroll();
  } else {
    startAutoScroll();
  }
}

function adjustSpeed(delta) {
  state.scrollSpeed = Math.round(Math.max(0, Math.min(5, state.scrollSpeed + delta)) * 10) / 10;
  updateSpeedDisplay();

  // Show speed display briefly
  els.speedDisplay.classList.remove('hidden');
  clearTimeout(state.speedHideTimeout);
  state.speedHideTimeout = setTimeout(() => {
    els.speedDisplay.classList.add('hidden');
  }, 1500);
}

function updateSpeedDisplay() {
  els.speedValue.textContent = state.scrollSpeed.toFixed(1) + 'x';
}

function updateScrollUI() {
  if (state.isAutoScrolling) {
    els.scrollToggleBtn.classList.add('active');
    els.scrollIconPlay.classList.add('hidden');
    els.scrollIconPause.classList.remove('hidden');
  } else {
    els.scrollToggleBtn.classList.remove('active');
    els.scrollIconPlay.classList.remove('hidden');
    els.scrollIconPause.classList.add('hidden');
  }
}

// ─── Speech Recognition ───

function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('Speech recognition not supported.');
    return;
  }

  state.recognition = new SpeechRecognition();
  state.recognition.continuous = true;
  state.recognition.interimResults = true;
  state.recognition.lang = 'en-US';
  state.recognition.maxAlternatives = 3;

  state.recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      for (let alt = 0; alt < result.length; alt++) {
        const transcript = result[alt].transcript.trim();
        if (transcript) {
          matchSpokenWords(transcript);
        }
      }
    }
  };

  state.recognition.onend = () => {
    if (state.isListening) {
      try {
        state.recognition.start();
      } catch (e) {}
    }
  };

  state.recognition.onerror = (event) => {
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    console.error('Speech recognition error:', event.error);
  };
}

function startListening() {
  if (!state.recognition) return;

  state.isListening = true;
  try {
    state.recognition.start();
    els.voiceIndicator.classList.remove('hidden');
  } catch (e) {}
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

  const lookAhead = Math.min(30, state.scriptWords.length - state.currentWordIndex);
  let bestMatchEnd = state.currentWordIndex;

  for (let spoken of spokenWords) {
    if (spoken.length < 2) continue;

    for (let j = state.currentWordIndex; j < state.currentWordIndex + lookAhead && j < state.scriptWords.length; j++) {
      const scriptWord = state.scriptWords[j].normalized;

      if (scriptWord === spoken || (scriptWord.length > 3 && spoken.length > 3 && fuzzyMatch(scriptWord, spoken))) {
        if (j >= bestMatchEnd) {
          bestMatchEnd = j + 1;
        }
      }
    }
  }

  if (bestMatchEnd > state.currentWordIndex) {
    state.currentWordIndex = bestMatchEnd;
    updateWordHighlights();
    // Voice match nudges scroll to the current word position
    scrollToCurrentWord();
  }
}

function fuzzyMatch(a, b) {
  if (Math.abs(a.length - b.length) > 2) return false;
  if (a.startsWith(b) || b.startsWith(a)) return true;

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

  const mimeType = getSupportedMimeType();
  const options = mimeType ? { mimeType } : {};

  try {
    state.mediaRecorder = new MediaRecorder(state.stream, options);
  } catch (e) {
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
    stopAutoScroll();
    stopTimer();
    releaseWakeLock();
  };

  state.mediaRecorder.start(1000);
  state.isRecording = true;

  els.recordBtn.classList.add('recording');
  els.recordTimer.classList.remove('hidden');
  startTimer();

  // Start auto-scroll and voice tracking
  startAutoScroll();
  startListening();
  requestWakeLock();
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
        saveVideo();
      }
    }
  } else {
    saveVideo();
  }
}

// ─── Wake Lock ───

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

// ─── Event Listeners ───

els.startBtn.addEventListener('click', async () => {
  const script = els.scriptInput.value.trim();
  if (!script) {
    alert('Please enter a script first.');
    return;
  }

  state.fontSize = parseInt(els.fontSizeSlider.value);
  state.scrollSpeed = parseInt(els.scrollSpeedSlider.value) / 30; // convert 0-100 slider to ~0-3.3x
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
  stopAutoScroll();
  stopTimer();
  releaseWakeLock();
  showScreen(els.editorScreen);
});

els.scrollToggleBtn.addEventListener('click', toggleAutoScroll);
els.speedUpBtn.addEventListener('click', () => adjustSpeed(0.2));
els.speedDownBtn.addEventListener('click', () => adjustSpeed(-0.2));

els.saveBtn.addEventListener('click', saveVideo);
els.shareBtn.addEventListener('click', shareVideo);

els.retakeBtn.addEventListener('click', () => {
  els.previewVideo.src = '';
  state.recordedChunks = [];
  showScreen(els.editorScreen);
});

els.fontSizeSlider.addEventListener('input', (e) => {
  state.fontSize = parseInt(e.target.value);
});

els.scrollSpeedSlider.addEventListener('input', (e) => {
  state.scrollSpeed = parseInt(e.target.value) / 30;
});

// Touch handling: pause auto-scroll while user is manually scrolling the prompter
els.prompterContainer.addEventListener('touchstart', () => {
  state.userTouching = true;
}, { passive: true });

els.prompterContainer.addEventListener('touchend', () => {
  state.userTouching = false;
}, { passive: true });

els.prompterContainer.addEventListener('touchcancel', () => {
  state.userTouching = false;
}, { passive: true });

// Prevent zoom on double-tap (outside prompter)
document.addEventListener('touchend', (e) => {
  if (e.target.closest('#prompter-container')) return;
  const now = Date.now();
  if (now - (document.lastTouchEnd || 0) < 300) {
    e.preventDefault();
  }
  document.lastTouchEnd = now;
}, { passive: false });

// Service Worker registration
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

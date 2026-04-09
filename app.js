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
  timerInterval: null,
  recordStartTime: 0,
  facingMode: 'user',
  mirrored: true,
  // Smooth scroll animation
  scrollTarget: 0,
  scrollCurrent: 0,
  scrollRAF: null,
};

// ─── DOM ───
const $ = (id) => document.getElementById(id);

const els = {
  editorScreen: $('editor-screen'),
  recordingScreen: $('recording-screen'),
  previewScreen: $('preview-screen'),
  scriptInput: $('script-input'),
  fontSizeSlider: $('font-size-slider'),
  cameraSelect: $('camera-select'),
  mirrorToggle: $('mirror-toggle'),
  startBtn: $('start-btn'),
  cameraPreview: $('camera-preview'),
  prompterText: $('prompter-text'),
  prompterContainer: $('prompter-container'),
  recordBtn: $('record-btn'),
  backBtn: $('back-btn'),
  resetScrollBtn: $('reset-scroll-btn'),
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

    state.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: state.facingMode,
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 },
      },
      audio: true,
    });
    els.cameraPreview.srcObject = state.stream;

    els.cameraPreview.classList.toggle('mirrored', state.mirrored && state.facingMode === 'user');
  } catch (err) {
    alert('Camera access denied. Please allow camera and microphone permissions.');
  }
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
  els.cameraPreview.srcObject = null;
}

// ─── Teleprompter Build ───

function buildPrompter(text) {
  const lines = text.split('\n');
  let wordIndex = 0;
  state.scriptWords = [];
  els.prompterText.innerHTML = '';

  // Top spacer so first words sit at the focus line
  const topSpacer = document.createElement('div');
  topSpacer.style.height = '40px';
  els.prompterText.appendChild(topSpacer);

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

  // Bottom spacer so last words can scroll up to the focus line
  const bottomSpacer = document.createElement('div');
  bottomSpacer.style.height = '80vh';
  els.prompterText.appendChild(bottomSpacer);

  state.currentWordIndex = 0;
  updateWordHighlights();
  els.prompterText.style.fontSize = state.fontSize + 'px';
  els.prompterContainer.scrollTop = 0;
  state.scrollTarget = 0;
  state.scrollCurrent = 0;
}

function normalizeWord(word) {
  return word
    .toLowerCase()
    .replace(/[^a-z0-9']/g, '')
    .replace(/^'+|'+$/g, '');
}

// ─── Word Highlighting ───

function updateWordHighlights() {
  const ahead = 15;
  state.scriptWords.forEach((w, i) => {
    if (i < state.currentWordIndex) {
      w.element.className = 'word spoken';
    } else if (i === state.currentWordIndex) {
      w.element.className = 'word current';
    } else if (i <= state.currentWordIndex + ahead) {
      w.element.className = 'word upcoming';
    } else {
      w.element.className = 'word';
    }
  });
}

// ─── Smooth Scroll to Word ───
// Uses rAF to lerp scrollTop toward the target, so it glides instead of jumping.

function scrollToWord(index) {
  if (index >= state.scriptWords.length) return;

  const wordEl = state.scriptWords[index].element;
  // Calculate where we need scrollTop to be so the word sits at the focus line (60px from top)
  const containerTop = els.prompterContainer.getBoundingClientRect().top;
  const wordTop = wordEl.getBoundingClientRect().top;
  const offset = wordTop - containerTop;
  const targetScroll = els.prompterContainer.scrollTop + offset - 60;

  state.scrollTarget = Math.max(0, targetScroll);

  // Start the smooth scroll animation if not already running
  if (!state.scrollRAF) {
    state.scrollCurrent = els.prompterContainer.scrollTop;
    animateScroll();
  }
}

function animateScroll() {
  const diff = state.scrollTarget - state.scrollCurrent;

  if (Math.abs(diff) < 1) {
    els.prompterContainer.scrollTop = state.scrollTarget;
    state.scrollCurrent = state.scrollTarget;
    state.scrollRAF = null;
    return;
  }

  // Lerp: ease toward target (0.12 = smooth, not instant)
  state.scrollCurrent += diff * 0.12;
  els.prompterContainer.scrollTop = state.scrollCurrent;

  state.scrollRAF = requestAnimationFrame(animateScroll);
}

// ─── Speech Recognition ───

function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('Speech recognition not supported on this browser.');
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
          matchSpokenWords(transcript, result.isFinal);
        }
      }
    }
  };

  state.recognition.onend = () => {
    // Auto-restart -- recognition times out after silence
    if (state.isListening) {
      setTimeout(() => {
        if (state.isListening) {
          try { state.recognition.start(); } catch (e) {}
        }
      }, 100);
    }
  };

  state.recognition.onerror = (event) => {
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    console.error('Speech error:', event.error);
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
    try { state.recognition.stop(); } catch (e) {}
  }
  els.voiceIndicator.classList.add('hidden');
}

// ─── Word Matching ───
// Scans spoken transcript against the script from current position forward.
// Uses a sliding window to find the best consecutive match.

function matchSpokenWords(transcript, isFinal) {
  const spokenWords = transcript
    .split(/\s+/)
    .map(normalizeWord)
    .filter((w) => w.length > 0);

  if (spokenWords.length === 0) return;

  const maxLookAhead = 40;
  const searchEnd = Math.min(state.currentWordIndex + maxLookAhead, state.scriptWords.length);
  let bestMatchPos = state.currentWordIndex;

  // Try to find the furthest consecutive run of matches
  // Start from each spoken word and see how far into the script it matches
  for (let s = 0; s < spokenWords.length; s++) {
    const spoken = spokenWords[s];
    if (spoken.length < 2) continue;

    for (let j = state.currentWordIndex; j < searchEnd; j++) {
      const scriptWord = state.scriptWords[j].normalized;

      if (wordsMatch(spoken, scriptWord)) {
        // Found a match at position j. Now check if subsequent spoken words also match.
        let matchEnd = j + 1;
        for (let k = 1; s + k < spokenWords.length && j + k < state.scriptWords.length; k++) {
          const nextSpoken = spokenWords[s + k];
          const nextScript = state.scriptWords[j + k].normalized;
          if (nextSpoken.length >= 2 && wordsMatch(nextSpoken, nextScript)) {
            matchEnd = j + k + 1;
          } else {
            break;
          }
        }

        if (matchEnd > bestMatchPos) {
          bestMatchPos = matchEnd;
        }
        break; // Found first match for this spoken word, move to next
      }
    }
  }

  if (bestMatchPos > state.currentWordIndex) {
    state.currentWordIndex = bestMatchPos;
    updateWordHighlights();
    scrollToWord(state.currentWordIndex);
  }
}

function wordsMatch(a, b) {
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return a === b; // short words must be exact
  if (Math.abs(a.length - b.length) > 2) return false;

  // Prefix match (speech recognition often gives partial words)
  if (a.length >= 4 && b.length >= 4) {
    if (a.startsWith(b.substring(0, 4)) || b.startsWith(a.substring(0, 4))) return true;
  }

  // Character overlap ratio
  let hits = 0;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  const used = new Array(longer.length).fill(false);

  for (let i = 0; i < shorter.length; i++) {
    for (let j = 0; j < longer.length; j++) {
      if (!used[j] && shorter[i] === longer[j]) {
        hits++;
        used[j] = true;
        break;
      }
    }
  }

  return hits / longer.length >= 0.75;
}

// ─── Recording ───

function startRecording() {
  state.recordedChunks = [];

  const mimeType = getSupportedMimeType();
  try {
    state.mediaRecorder = new MediaRecorder(state.stream, mimeType ? { mimeType } : {});
  } catch (e) {
    state.mediaRecorder = new MediaRecorder(state.stream);
  }

  state.mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      state.recordedChunks.push(event.data);
    }
  };

  state.mediaRecorder.onstop = () => {
    const mime = state.mediaRecorder.mimeType || 'video/mp4';
    const blob = new Blob(state.recordedChunks, { type: mime });
    els.previewVideo.src = URL.createObjectURL(blob);
    showScreen(els.previewScreen);
    stopCamera();
    stopListening();
    stopTimer();
    releaseWakeLock();
    cancelAnimationFrame(state.scrollRAF);
    state.scrollRAF = null;
  };

  state.mediaRecorder.start(1000);
  state.isRecording = true;
  els.recordBtn.classList.add('recording');
  els.recordTimer.classList.remove('hidden');
  startTimer();
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
    if (MediaRecorder.isTypeSupported(type)) return type;
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
  const mime = state.mediaRecorder?.mimeType || 'video/mp4';
  const blob = new Blob(state.recordedChunks, { type: mime });
  const ext = mime.includes('webm') ? 'webm' : 'mp4';
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
  const mime = state.mediaRecorder?.mimeType || 'video/mp4';
  const blob = new Blob(state.recordedChunks, { type: mime });
  const ext = mime.includes('webm') ? 'webm' : 'mp4';
  const file = new File([blob], `teleprompter-recording.${ext}`, { type: mime });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Teleprompter Recording' });
    } catch (err) {
      if (err.name !== 'AbortError') saveVideo();
    }
  } else {
    saveVideo();
  }
}

// ─── Wake Lock ───

let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) {}
}
function releaseWakeLock() {
  if (wakeLock) { wakeLock.release(); wakeLock = null; }
}

// ─── Event Listeners ───

els.startBtn.addEventListener('click', async () => {
  const script = els.scriptInput.value.trim();
  if (!script) { alert('Please enter a script first.'); return; }

  state.fontSize = parseInt(els.fontSizeSlider.value);
  state.facingMode = els.cameraSelect.value;
  state.mirrored = els.mirrorToggle.checked;

  buildPrompter(script);
  showScreen(els.recordingScreen);
  await startCamera();
  initSpeechRecognition();
});

els.recordBtn.addEventListener('click', () => {
  state.isRecording ? stopRecording() : startRecording();
});

els.backBtn.addEventListener('click', () => {
  if (state.isRecording) stopRecording();
  stopCamera();
  stopListening();
  stopTimer();
  releaseWakeLock();
  cancelAnimationFrame(state.scrollRAF);
  state.scrollRAF = null;
  showScreen(els.editorScreen);
});

els.resetScrollBtn.addEventListener('click', () => {
  state.currentWordIndex = 0;
  updateWordHighlights();
  els.prompterContainer.scrollTop = 0;
  state.scrollTarget = 0;
  state.scrollCurrent = 0;
});

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

// Prevent zoom on double-tap outside prompter
document.addEventListener('touchend', (e) => {
  if (e.target.closest('#prompter-container')) return;
  const now = Date.now();
  if (now - (document.lastTouchEnd || 0) < 300) e.preventDefault();
  document.lastTouchEnd = now;
}, { passive: false });

// Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

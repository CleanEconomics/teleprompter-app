// ─── State ───
const state = {
  stream: null,
  mediaRecorder: null,
  recordedChunks: [],
  isRecording: false,
  fontSize: 28,
  timerInterval: null,
  recordStartTime: 0,
  facingMode: 'user',
  mirrored: true,
  // VAD scroll
  audioCtx: null,
  analyser: null,
  vadRAF: null,
  isSpeaking: false,
  scrollSpeed: 1.0,       // multiplier
  baseRate: 1.5,           // px per frame at 1x
  silenceFrames: 0,        // how many frames of silence
  speechFrames: 0,         // how many frames of speech
  userTouching: false,
  scrollAccum: 0,           // sub-pixel scroll accumulator
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
  speedUpBtn: $('speed-up-btn'),
  speedDownBtn: $('speed-down-btn'),
  resetScrollBtn: $('reset-scroll-btn'),
  vadDot: $('vad-dot'),
  vadLabel: $('vad-label'),
  speedDisplay: $('speed-display'),
  statusBar: $('status-bar'),
  recordTimer: $('record-timer'),
  timerDisplay: $('timer-display'),
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
    if (state.stream) state.stream.getTracks().forEach((t) => t.stop());

    // Try 4K first, then 1080p, then whatever the device gives us
    const resolutions = [
      { width: { ideal: 3840 }, height: { ideal: 2160 } },
      { width: { ideal: 1920 }, height: { ideal: 1080 } },
      { width: { ideal: 1280 }, height: { ideal: 720 } },
    ];

    let stream = null;
    for (const res of resolutions) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: state.facingMode,
            ...res,
            frameRate: { ideal: 30 },
          },
          audio: true,
        });
        break;
      } catch (e) {
        continue;
      }
    }

    if (!stream) {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: state.facingMode },
        audio: true,
      });
    }

    state.stream = stream;

    // Apply highest possible resolution to the track after acquisition
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      const caps = videoTrack.getCapabilities?.();
      if (caps?.width?.max && caps?.height?.max) {
        try {
          await videoTrack.applyConstraints({
            width: { ideal: caps.width.max },
            height: { ideal: caps.height.max },
            frameRate: { ideal: 30 },
          });
        } catch (e) {}
      }
    }

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

// ─── Teleprompter ───

function buildPrompter(text) {
  els.prompterText.innerHTML = '';

  const top = document.createElement('div');
  top.style.height = '60px';
  els.prompterText.appendChild(top);

  text.split('\n').forEach((para) => {
    if (para.trim() === '') {
      els.prompterText.appendChild(document.createElement('br'));
      return;
    }
    const p = document.createElement('p');
    p.className = 'prompter-line';
    p.textContent = para;
    els.prompterText.appendChild(p);
  });

  const bottom = document.createElement('div');
  bottom.style.height = '80vh';
  els.prompterText.appendChild(bottom);

  els.prompterText.style.fontSize = state.fontSize + 'px';
  els.prompterContainer.scrollTop = 0;
}

// ─── Voice Activity Detection ───
// Uses Web Audio AnalyserNode to detect speech energy.
// Speaking → scroll. Silent → pause.

function initVAD() {
  if (!state.stream) return;

  const audioTrack = state.stream.getAudioTracks()[0];
  if (!audioTrack) return;

  state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = state.audioCtx.createMediaStreamSource(state.stream);

  state.analyser = state.audioCtx.createAnalyser();
  state.analyser.fftSize = 512;
  state.analyser.smoothingTimeConstant = 0.3;
  source.connect(state.analyser);
  // Don't connect to destination — we don't want to play the mic back

  state.silenceFrames = 0;
  state.speechFrames = 0;
  state.isSpeaking = false;
}

function startVAD() {
  if (!state.analyser) return;
  state.vadRAF = requestAnimationFrame(vadTick);
}

function stopVAD() {
  if (state.vadRAF) {
    cancelAnimationFrame(state.vadRAF);
    state.vadRAF = null;
  }
  if (state.audioCtx) {
    state.audioCtx.close().catch(() => {});
    state.audioCtx = null;
    state.analyser = null;
  }
  setSpeaking(false);
}

function vadTick() {
  if (!state.analyser) return;

  const bufLen = state.analyser.frequencyBinCount;
  const data = new Uint8Array(bufLen);
  state.analyser.getByteFrequencyData(data);

  // Calculate RMS energy across speech-relevant frequency bins (~300Hz-3000Hz)
  // At 44100Hz sample rate with fftSize 512, each bin ≈ 86Hz
  // Bins 3-35 cover roughly 260Hz-3000Hz (human speech range)
  const startBin = 3;
  const endBin = Math.min(35, bufLen);
  let sum = 0;
  for (let i = startBin; i < endBin; i++) {
    sum += data[i];
  }
  const avg = sum / (endBin - startBin);

  // Threshold: typical speech is 40-80, silence/noise is 0-20
  // Adjustable based on environment; 25 is a reasonable default
  const threshold = 25;

  if (avg > threshold) {
    state.speechFrames++;
    state.silenceFrames = 0;
    // Require 3 consecutive frames (~50ms) of speech to trigger
    if (state.speechFrames >= 3 && !state.isSpeaking) {
      setSpeaking(true);
    }
  } else {
    state.silenceFrames++;
    state.speechFrames = 0;
    // Require 15 frames (~250ms) of silence before pausing
    // This prevents stopping on brief pauses between words
    if (state.silenceFrames >= 15 && state.isSpeaking) {
      setSpeaking(false);
    }
  }

  // Scroll if speaking and user isn't manually scrolling
  if (state.isSpeaking && !state.userTouching) {
    state.scrollAccum += state.baseRate * state.scrollSpeed;
    if (state.scrollAccum >= 1) {
      const whole = Math.floor(state.scrollAccum);
      els.prompterContainer.scrollTop += whole;
      state.scrollAccum -= whole;
    }
  }

  state.vadRAF = requestAnimationFrame(vadTick);
}

function setSpeaking(speaking) {
  state.isSpeaking = speaking;
  if (!speaking) state.scrollAccum = 0;
  els.vadDot.classList.toggle('speaking', speaking);
  els.vadLabel.classList.toggle('speaking', speaking);
  els.vadLabel.textContent = speaking ? 'Scrolling' : 'Paused';
}

// ─── Speed Controls ───

function adjustSpeed(delta) {
  state.scrollSpeed = Math.round(Math.max(0.2, Math.min(4.0, state.scrollSpeed + delta)) * 10) / 10;
  els.speedDisplay.textContent = state.scrollSpeed.toFixed(1) + 'x';
}

// ─── Recording ───

function startRecording() {
  state.recordedChunks = [];

  const mimeType = getSupportedMimeType();
  const recOpts = { videoBitsPerSecond: 8_000_000 };
  if (mimeType) recOpts.mimeType = mimeType;
  try {
    state.mediaRecorder = new MediaRecorder(state.stream, recOpts);
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
    stopVAD();
    stopTimer();
    releaseWakeLock();
  };

  state.mediaRecorder.start(1000);
  state.isRecording = true;
  els.recordBtn.classList.add('recording');
  els.recordTimer.classList.remove('hidden');
  startTimer();
  initVAD();
  startVAD();
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
});

els.recordBtn.addEventListener('click', () => {
  state.isRecording ? stopRecording() : startRecording();
});

els.backBtn.addEventListener('click', () => {
  if (state.isRecording) stopRecording();
  stopCamera();
  stopVAD();
  stopTimer();
  releaseWakeLock();
  showScreen(els.editorScreen);
});

els.speedUpBtn.addEventListener('click', () => adjustSpeed(0.2));
els.speedDownBtn.addEventListener('click', () => adjustSpeed(-0.2));

els.resetScrollBtn.addEventListener('click', () => {
  state.scrollAccum = 0;
  els.prompterContainer.scrollTo({ top: 0, behavior: 'smooth' });
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

// Pause VAD scroll while user is touching the prompter
els.prompterContainer.addEventListener('touchstart', () => { state.userTouching = true; }, { passive: true });
els.prompterContainer.addEventListener('touchend', () => { state.userTouching = false; }, { passive: true });
els.prompterContainer.addEventListener('touchcancel', () => { state.userTouching = false; }, { passive: true });

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

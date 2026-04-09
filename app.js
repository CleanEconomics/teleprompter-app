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

// ─── Teleprompter ───

function buildPrompter(text) {
  els.prompterText.innerHTML = '';

  // Top spacer
  const top = document.createElement('div');
  top.style.height = '60px';
  els.prompterText.appendChild(top);

  // Render the script as simple text paragraphs
  const paragraphs = text.split('\n');
  paragraphs.forEach((para) => {
    if (para.trim() === '') {
      els.prompterText.appendChild(document.createElement('br'));
      return;
    }
    const p = document.createElement('p');
    p.className = 'prompter-line';
    p.textContent = para;
    els.prompterText.appendChild(p);
  });

  // Bottom spacer so you can scroll the last line to the top
  const bottom = document.createElement('div');
  bottom.style.height = '80vh';
  els.prompterText.appendChild(bottom);

  els.prompterText.style.fontSize = state.fontSize + 'px';
  els.prompterContainer.scrollTop = 0;
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
    stopTimer();
    releaseWakeLock();
  };

  state.mediaRecorder.start(1000);
  state.isRecording = true;
  els.recordBtn.classList.add('recording');
  els.recordTimer.classList.remove('hidden');
  startTimer();
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
  stopTimer();
  releaseWakeLock();
  showScreen(els.editorScreen);
});

els.resetScrollBtn.addEventListener('click', () => {
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

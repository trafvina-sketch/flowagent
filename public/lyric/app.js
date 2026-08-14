/**
 * Core Application Logic for Lyrics Video Generator
 */

// Application State
const state = {
  apiKey: localStorage.getItem('gemini_api_key') || '',
  apiModel: localStorage.getItem('gemini_api_model') || 'gemini-2.5-flash',
  audioFile: null,
  audioUrl: '',
  audioElement: null,
  audioDuration: 0,
  bgImage: null,
  bgImageUrl: '',
  bgType: 'image', // 'image', 'video', 'gradient'
  bgVideoUrl: '',
  bgVideoMuted: true, // video nền mặc định tắt tiếng
  lyrics: [],
  activeLyricIndex: -1,
  wavesurfer: null,
  isPlaying: false,
  
  // Design Preferences
  selectedColor: 'neon-green', // neon-green, neon-cyan, neon-violet, neon-yellow, neon-red, neon-pink
  selectedEffect: 'karaoke', // karaoke, fade, zoom, slide, neon, blur
  preshowDelay: 1.0, // seconds
  selectedFont: 'Inter', // Inter, Montserrat, Bebas Neue, Oswald, Playfair Display, Dancing Script
  fontSize: 64, // pixels
  aspectRatio: '16-9', // 16-9, 9-16, 1-1
  bgMode: 'crop-fill', // fit-blur, crop-fill, fit-center, gradient
  lyricYPercent: 80, // 10% - 90%
  showSubtitle: true, // boolean
  lyricMode: 'single', // single, scrolling
  kenBurnsEnabled: true,
  particlesEnabled: true,
  bgOpacity: 0.15, // default 15% dark overlay
  textCase: 'normal', // normal, uppercase
  
  // Export Settings
  exportFps: 60,
  exportQuality: 'standard', // standard, fast, high
  isExporting: false,
  mediaRecorder: null,
  recordedChunks: [],
  exportAudioCtx: null,
  exportAudioSource: null,
  exportAudioDest: null,

  // Song Intro State
  introEnabled: true,
  introTitle: '',
  introSubtitle: '',
  introStart: 0.0,
  introEnd: 6.0,
  introFontSize: 72,
  introYPercent: 45,
  introXPercent: 50,
  isDraggingIntro: false,

  // New Video Effects State
  spectrumEnabled: localStorage.getItem('effect_spectrum') !== 'false',
  spectrumStyle: localStorage.getItem('effect_spectrum_style') || 'radial-bars',
  vinylEnabled: localStorage.getItem('effect_vinyl') !== 'false',
  bokehEnabled: localStorage.getItem('effect_bokeh') !== 'false',
  filmGrainEnabled: localStorage.getItem('effect_film_grain') !== 'false',
  kenBurnsEnabled: localStorage.getItem('effect_ken_burns') !== 'false',
  particlesEnabled: localStorage.getItem('effect_particles') !== 'false'
};

// Theme Color Palettes (Canvas rendering matches CSS styling)
const palettes = {
  'neon-green': { primary: '#22c55e', secondary: '#15803d', glow: 'rgba(34, 197, 94, 0.4)', text: '#ffffff', muted: 'rgba(255, 255, 255, 0.4)' },
  'neon-cyan': { primary: '#06b6d4', secondary: '#0369a1', glow: 'rgba(6, 182, 212, 0.4)', text: '#ffffff', muted: 'rgba(255, 255, 255, 0.4)' },
  'neon-violet': { primary: '#a855f7', secondary: '#6b21a8', glow: 'rgba(168, 85, 247, 0.4)', text: '#ffffff', muted: 'rgba(255, 255, 255, 0.4)' },
  'neon-yellow': { primary: '#eab308', secondary: '#a16207', glow: 'rgba(234, 179, 8, 0.4)', text: '#ffffff', muted: 'rgba(255, 255, 255, 0.4)' },
  'neon-red': { primary: '#ef4444', secondary: '#b91c1c', glow: 'rgba(239, 68, 68, 0.4)', text: '#ffffff', muted: 'rgba(255, 255, 255, 0.4)' },
  'neon-pink': { primary: '#ec4899', secondary: '#be185d', glow: 'rgba(236, 72, 153, 0.4)', text: '#ffffff', muted: 'rgba(255, 255, 255, 0.4)' },
  'neon-white': { primary: '#ffffff', secondary: '#e2e8f0', glow: 'rgba(255, 255, 255, 0.3)', text: '#ffffff', muted: 'rgba(255, 255, 255, 0.4)' },
};

// Hidden Private AI Prompt (Core processing engine)
const AI_PROMPT = `You are an audio transcription tool. Listen to this ENTIRE audio file from start to finish and output every lyric line with its precise timestamp.

Return ONLY a raw JSON array — no markdown, no code block, no explanation:
[{"text": "lyric line", "start": 12.3, "end": 14.8}, ...]

TIMESTAMPS:
• "start" = exact second the first syllable of this line begins
• "end" = exact second the last syllable of this line ends (NOT when the next line starts)
• 1 decimal place • end > start • lines never overlap • strictly chronological order

COMPLETENESS — process the full file, do not stop early:
• Include every sung phrase: verse, chorus, bridge, hook, ad-lib, backing vocals with distinct lyrics
• Each chorus/hook repetition = a separate JSON entry with its own timestamps
• Omit only purely instrumental sections (no vocals at all)
• A typical song has 30–80+ lines — output ALL of them

LINE FORMATTING:
• One line = one musical phrase / one breath
• If a phrase exceeds 8 seconds, split it at a natural pause
• For Vietnamese: write exact tone marks as you hear them (đúng dấu thanh điệu)
• Transcribe only what you hear — do not invent or add lyrics

Output the JSON array:`;

// DOM Elements
const elements = {
  appContainer: document.getElementById('appContainer'),
  apiKeyBtn: document.getElementById('apiKeyBtn'),
  apiKeyStatus: document.getElementById('apiKeyStatus'),
  apiKeyModal: document.getElementById('apiKeyModal'),
  btnCloseApiKeyModal: document.getElementById('btnCloseApiKeyModal'),
  apiKeyInput: document.getElementById('apiKeyInput'),
  apiModelSelect: document.getElementById('apiModelSelect'),
  btnTestApiKey: document.getElementById('btnTestApiKey'),
  btnSaveApiKey: document.getElementById('btnSaveApiKey'),
  
  audioUploader: document.getElementById('audioUploader'),
  audioFileInput: document.getElementById('audioFileInput'),
  audioFileName: document.getElementById('audioFileName'),
  
  btnAiRecognize: document.getElementById('btnAiRecognize'),
  btnImportSrt: document.getElementById('btnImportSrt'),
  btnExportSrt: document.getElementById('btnExportSrt'),
  srtFileInput: document.getElementById('srtFileInput'),
  btnImportSync: document.getElementById('btnImportSync'),
  btnClearLyrics: document.getElementById('btnClearLyrics'),
  lyricsList: document.getElementById('lyricsList'),
  btnAddLyricLine: document.getElementById('btnAddLyricLine'),
  

  
  previewCanvas: document.getElementById('previewCanvas'),
  canvasPlaceholder: document.getElementById('canvasPlaceholder'),
  processingOverlay: document.getElementById('processingOverlay'),
  processingText: document.getElementById('processingText'),
  
  btnPlayPause: document.getElementById('btnPlayPause'),
  btnPrevLine: document.getElementById('btnPrevLine'),
  btnNextLine: document.getElementById('btnNextLine'),
  btnSyncStart: document.getElementById('btnSyncStart'),
  btnSyncEnd: document.getElementById('btnSyncEnd'),
  songTitleDisplay: document.getElementById('songTitleDisplay'),
  timeDisplay: document.getElementById('timeDisplay'),
  
  preshowDelayInput: document.getElementById('preshowDelayInput'),
  preshowDelayVal: document.getElementById('preshowDelayVal'),
  fontSizeInput: document.getElementById('fontSizeInput'),
  fontSizeVal: document.getElementById('fontSizeVal'),
  lyricYInput: document.getElementById('lyricYInput'),
  lyricYVal: document.getElementById('lyricYVal'),
  
  bgImageUploader: document.getElementById('bgImageUploader'),
  bgImageFileInput: document.getElementById('bgImageFileInput'),
  bgImagePreview: document.getElementById('bgImagePreview'),
  bgImageName: document.getElementById('bgImageName'),
  btnRemoveBgImage: document.getElementById('btnRemoveBgImage'),
  btnMuteBgVideo: document.getElementById('btnMuteBgVideo'),
  bgVideo: document.getElementById('bgVideo'),
  
  bgOpacityInput: document.getElementById('bgOpacityInput'),
  bgOpacityVal: document.getElementById('bgOpacityVal'),
  
  btnExportWebM: document.getElementById('btnExportWebM'),
  btnExportMP4: document.getElementById('btnExportMP4'),
  
  // Import Lyrics Modal
  btnImportLyrics: document.getElementById('btnImportLyrics'),
  importLyricsModal: document.getElementById('importLyricsModal'),
  btnCloseImportModal: document.getElementById('btnCloseImportModal'),
  importLyricsTextarea: document.getElementById('importLyricsTextarea'),
  autoDistributeTimestamps: document.getElementById('autoDistributeTimestamps'),
  btnCancelImport: document.getElementById('btnCancelImport'),
  btnConfirmImport: document.getElementById('btnConfirmImport'),
  
  toast: document.getElementById('toast'),
  toastIcon: document.getElementById('toastIcon'),
  toastMessage: document.getElementById('toastMessage'),

  // Song Intro Card Elements
  introToggle: document.getElementById('introToggle'),
  introFieldsContainer: document.getElementById('introFieldsContainer'),
  introTitleInput: document.getElementById('introTitleInput'),
  introSubtitleInput: document.getElementById('introSubtitleInput'),
  introStartInput: document.getElementById('introStartInput'),
  introEndInput: document.getElementById('introEndInput'),
  introFontSizeInput: document.getElementById('introFontSizeInput'),
  introFontSizeVal: document.getElementById('introFontSizeVal'),
  introYInput: document.getElementById('introYInput'),
  introYVal: document.getElementById('introYVal'),
  introXInput: document.getElementById('introXInput'),
  introXVal: document.getElementById('introXVal'),
  
  // New Video Effects Elements
  spectrumToggle: document.getElementById('spectrumToggle'),
  spectrumStyleContainer: document.getElementById('spectrumStyleContainer'),
  spectrumStyleSelect: document.getElementById('spectrumStyleSelect'),
  vinylToggle: document.getElementById('vinylToggle'),
  bokehToggle: document.getElementById('bokehToggle'),
  grainToggle: document.getElementById('grainToggle')
};

// Canvas 2D Context
const ctx = elements.previewCanvas.getContext('2d');

// Initialize App
window.addEventListener('DOMContentLoaded', () => {
  initApp();
});

// Particle System
const canvasParticles = [];

function initParticles() {
  canvasParticles.length = 0;
  for (let i = 0; i < 45; i++) {
    canvasParticles.push({
      x: Math.random(),
      y: Math.random(),
      size: Math.random() * 3 + 1.5,
      speedX: Math.random() * 0.004 - 0.002,
      speedY: -(Math.random() * 0.008 + 0.003),
      opacity: Math.random() * 0.4 + 0.15,
      wiggleOffset: Math.random() * Math.PI * 2
    });
  }
}

function initApp() {
  // 1. Setup API key status on launch
  updateApiKeyStatusUI();
  
  // 2. Setup Event Listeners
  setupEventListeners();
  
  // 2.3. Initialize Particle System
  initParticles();
  
  // 2.4. Synchronize UI Controls from State
  syncUIFromState();
  
  // 2.5. Initialize Aspect Ratio
  updateAspectRatio('16-9');
  
  // 3. Init canvas loop
  requestAnimationFrame(canvasRenderLoop);
}

function syncUIFromState() {
  // Đồng bộ trạng thái checkbox từ state (load từ localStorage)
  const kbToggle = document.getElementById('kenBurnsToggle');
  const partToggle = document.getElementById('particlesToggle');
  
  if (kbToggle) kbToggle.checked = state.kenBurnsEnabled;
  if (partToggle) partToggle.checked = state.particlesEnabled;
  if (elements.spectrumToggle) elements.spectrumToggle.checked = state.spectrumEnabled;
  if (elements.vinylToggle) elements.vinylToggle.checked = state.vinylEnabled;
  if (elements.bokehToggle) elements.bokehToggle.checked = state.bokehEnabled;
  if (elements.grainToggle) elements.grainToggle.checked = state.filmGrainEnabled;
  
  if (elements.spectrumStyleSelect) elements.spectrumStyleSelect.value = state.spectrumStyle;
  if (elements.spectrumStyleContainer) {
    elements.spectrumStyleContainer.style.display = state.spectrumEnabled ? 'flex' : 'none';
  }
  
  // Nếu bokeh được kích hoạt mặc định, khởi tạo bokeh particles
  if (state.bokehEnabled) {
    initBokeh();
  }
  
  // Nếu spectrum được kích hoạt mặc định, khởi tạo analyser
  if (state.spectrumEnabled) {
    initAudioAnalyser();
  }
}

// ----------------------------------------------------
// UI TOASTS & NOTIFICATIONS
// ----------------------------------------------------
function showToast(message, type = 'success') {
  elements.toastMessage.innerText = message;
  elements.toast.className = 'toast show';
  
  if (type === 'success') {
    elements.toast.classList.add('toast-success');
    elements.toastIcon.innerHTML = '<i class="fa-solid fa-circle-check" style="color: var(--neon-green)"></i>';
  } else if (type === 'error') {
    elements.toast.classList.add('toast-error');
    elements.toastIcon.innerHTML = '<i class="fa-solid fa-circle-exclamation" style="color: var(--neon-red)"></i>';
  } else {
    elements.toastIcon.innerHTML = '<i class="fa-solid fa-info" style="color: var(--neon-cyan)"></i>';
  }
  
  setTimeout(() => {
    elements.toast.classList.remove('show');
  }, 3500);
}

// ----------------------------------------------------
// API KEY HANDLING
// ----------------------------------------------------
function updateApiKeyStatusUI() {
  if (state.apiKey) {
    elements.apiKeyBtn.classList.add('configured');
    elements.apiKeyStatus.innerText = 'Key Configured';
    elements.btnAiRecognize.removeAttribute('disabled');
  } else {
    elements.apiKeyBtn.classList.remove('configured');
    elements.apiKeyStatus.innerText = 'Gemini API Key';
    elements.btnAiRecognize.setAttribute('disabled', 'true');
  }
}

elements.apiKeyBtn.addEventListener('click', () => {
  elements.apiKeyInput.value = state.apiKey;
  elements.apiModelSelect.value = state.apiModel;
  elements.apiKeyModal.classList.add('active');
});

elements.btnCloseApiKeyModal.addEventListener('click', () => {
  elements.apiKeyModal.classList.remove('active');
});

elements.btnSaveApiKey.addEventListener('click', () => {
  const newKey = elements.apiKeyInput.value.trim();
  const selectedModel = elements.apiModelSelect.value;
  
  state.apiModel = selectedModel;
  localStorage.setItem('gemini_api_model', selectedModel);

  if (newKey) {
    state.apiKey = newKey;
    localStorage.setItem('gemini_api_key', newKey);
    showToast('Cấu hình API Key & Model đã được lưu!', 'success');
  } else {
    state.apiKey = '';
    localStorage.removeItem('gemini_api_key');
    showToast('Đã xóa API Key.', 'info');
  }
  updateApiKeyStatusUI();
  elements.apiKeyModal.classList.remove('active');
});

elements.btnTestApiKey.addEventListener('click', async () => {
  const testKey = elements.apiKeyInput.value.trim();
  const selectedModel = elements.apiModelSelect.value;
  if (!testKey) {
    showToast('Vui lòng nhập API Key để kiểm tra', 'error');
    return;
  }
  
  elements.btnTestApiKey.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang test...';
  elements.btnTestApiKey.setAttribute('disabled', 'true');
  
  try {
    // Call a lightweight model endpoint to test the key
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${testKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: "Hello" }] }] })
    });
    
    if (response.ok) {
      showToast(`API Key hoạt động chính xác với ${selectedModel}!`, 'success');
    } else {
      const errData = await response.json();
      const errMsg = errData.error?.message || 'Key không hợp lệ';
      showToast(`Lỗi: ${errMsg}`, 'error');
    }
  } catch (error) {
    showToast(`Kết nối thất bại: ${error.message}`, 'error');
  } finally {
    elements.btnTestApiKey.innerHTML = 'Kiểm tra Key';
    elements.btnTestApiKey.removeAttribute('disabled');
  }
});

// ----------------------------------------------------
// EVENT LISTENERS & UI ACTIONS
// ----------------------------------------------------
function setupEventListeners() {
  // Mobile Tab Navigation
  document.querySelectorAll('.mobile-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const activeTab = btn.getAttribute('data-mobile-tab');
      document.querySelectorAll('.mobile-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Clean previous views and add active view class
      elements.appContainer.classList.remove('show-lyrics', 'show-design', 'show-prompt');
      elements.appContainer.classList.add('show-' + activeTab);
      
      // Mirror to desktop tabs internally so correct DOM displays
      if (activeTab === 'prompt') {
        const dPrompt = document.querySelector('.tab-btn[data-tab="prompt"]');
        if (dPrompt) dPrompt.classList.add('active');
        const dLyrics = document.querySelector('.tab-btn[data-tab="lyrics"]');
        if (dLyrics) dLyrics.classList.remove('active');
        document.getElementById('tab-prompt').classList.add('active');
        document.getElementById('tab-lyrics').classList.remove('active');
      } else if (activeTab === 'lyrics') {
        const dLyrics = document.querySelector('.tab-btn[data-tab="lyrics"]');
        if (dLyrics) dLyrics.classList.add('active');
        const dPrompt = document.querySelector('.tab-btn[data-tab="prompt"]');
        if (dPrompt) dPrompt.classList.remove('active');
        document.getElementById('tab-lyrics').classList.add('active');
        document.getElementById('tab-prompt').classList.remove('active');
      }
    });
  });

  // Default mobile view class
  elements.appContainer.classList.add('show-lyrics');

  // Tabs switching (Desktop)
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.getAttribute('data-tab');
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
      
      btn.classList.add('active');
      document.getElementById(`tab-${tabName}`).classList.add('active');
      
      // Mirror to mobile tab bar
      const mTab = document.querySelector(`.mobile-tab-btn[data-mobile-tab="${tabName}"]`);
      if (mTab) {
        document.querySelectorAll('.mobile-tab-btn').forEach(b => b.classList.remove('active'));
        mTab.classList.add('active');
        elements.appContainer.classList.remove('show-lyrics', 'show-design', 'show-prompt');
        elements.appContainer.classList.add('show-' + tabName);
      }
    });
  });

  // Audio File Selection & Drag & Drop
  elements.audioUploader.addEventListener('click', () => elements.audioFileInput.click());
  elements.audioFileInput.addEventListener('change', handleAudioSelection);
  
  elements.audioUploader.addEventListener('dragover', (e) => {
    e.preventDefault();
    elements.audioUploader.classList.add('dragover');
  });
  
  elements.audioUploader.addEventListener('dragleave', () => {
    elements.audioUploader.classList.remove('dragover');
  });
  
  elements.audioUploader.addEventListener('drop', (e) => {
    e.preventDefault();
    elements.audioUploader.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      elements.audioFileInput.files = e.dataTransfer.files;
      handleAudioSelection();
    }
  });

  // Background Cover Art Selection
  elements.bgImageUploader.addEventListener('click', () => elements.bgImageFileInput.click());
  elements.bgImageFileInput.addEventListener('change', handleBgImageSelection);
  elements.btnRemoveBgImage.addEventListener('click', removeBgImage);

  // Mute/Unmute background video audio
  elements.btnMuteBgVideo.addEventListener('click', toggleBgVideoMute);

  // Playback Control Buttons
  elements.btnPlayPause.addEventListener('click', togglePlayPause);
  elements.btnPrevLine.addEventListener('click', selectPrevLine);
  elements.btnNextLine.addEventListener('click', selectNextLine);

  // Mobile Sync Buttons
  elements.btnSyncStart.addEventListener('click', () => {
    if (!state.wavesurfer) return;
    if (state.activeLyricIndex >= 0 && state.activeLyricIndex < state.lyrics.length) {
      const curTime = parseFloat(state.wavesurfer.getCurrentTime().toFixed(1));
      updateLyricStart(state.activeLyricIndex, curTime);
      showToast(`Ghi Start line ${state.activeLyricIndex + 1}: ${curTime}s`, 'info');
    }
  });

  elements.btnSyncEnd.addEventListener('click', () => {
    if (!state.wavesurfer) return;
    if (state.activeLyricIndex >= 0 && state.activeLyricIndex < state.lyrics.length) {
      const curTime = parseFloat(state.wavesurfer.getCurrentTime().toFixed(1));
      updateLyricEnd(state.activeLyricIndex, curTime);
      showToast(`Ghi End line ${state.activeLyricIndex + 1}: ${curTime}s`, 'info');
      
      setTimeout(() => {
        selectNextLine();
      }, 100);
    }
  });

  // Global Keyboard Shortcuts for syncing
  window.addEventListener('keydown', handleKeyPress);

  // Style Selector - Themes
  document.querySelectorAll('.palette-dot-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.palette-dot-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.selectedColor = btn.getAttribute('data-color');
      
      // Update css accent variables
      const root = document.documentElement;
      root.style.setProperty('--accent-color', `var(--${state.selectedColor})`);
      root.style.setProperty('--accent-glow', palettes[state.selectedColor].glow);
      
      if (state.wavesurfer) {
        state.wavesurfer.setOptions({
          progressColor: palettes[state.selectedColor].primary,
          cursorColor: palettes[state.selectedColor].primary
        });
      }
    });
  });

  // Style Selector - Aspect Ratio
  const ratioSelect = document.getElementById('ratioSelect');
  if (ratioSelect) {
    ratioSelect.addEventListener('change', (e) => {
      updateAspectRatio(e.target.value);
    });
  }

  // Style Selector - Background Mode
  document.querySelectorAll('.bgmode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.bgmode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.bgMode = btn.getAttribute('data-bgmode');
      showToast(`Đã đổi kiểu nền sang: ${btn.innerText.trim()}`, 'success');
    });
  });

  // Style Selector - Text Effects
  document.querySelectorAll('.effect-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.effect-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.selectedEffect = btn.getAttribute('data-effect');
    });
  });

  // Style Selector - Subtitle Next Line Show/Hide
  document.querySelectorAll('.sub-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sub-toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.showSubtitle = (btn.getAttribute('data-show-subtitle') === 'true');
    });
  });

  // Style Selector - Fonts
  const fontSelect = document.getElementById('fontSelect');
  if (fontSelect) {
    fontSelect.addEventListener('change', (e) => {
      state.selectedFont = e.target.value;
    });
  }

  // Style Selector - Size and Delay Sliders
  elements.preshowDelayInput.addEventListener('input', (e) => {
    state.preshowDelay = parseFloat(e.target.value);
    elements.preshowDelayVal.innerText = state.preshowDelay.toFixed(1) + 's';
  });

  elements.fontSizeInput.addEventListener('input', (e) => {
    state.fontSize = parseInt(e.target.value);
    elements.fontSizeVal.innerText = state.fontSize + 'px';
  });

  elements.lyricYInput.addEventListener('input', (e) => {
    state.lyricYPercent = parseInt(e.target.value);
    elements.lyricYVal.innerText = state.lyricYPercent + '%';
  });

  elements.bgOpacityInput.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    state.bgOpacity = val / 100;
    elements.bgOpacityVal.innerText = val + '%';
  });

  // FPS Quality Select Dropdown
  const fpsSelect = document.getElementById('fpsSelect');
  if (fpsSelect) {
    fpsSelect.addEventListener('change', (e) => {
      state.exportFps = parseInt(e.target.value);
      showToast(`Đã đổi tốc độ khung hình sang: ${state.exportFps} FPS`, 'info');
    });
  }

  // Export Quality Presets Dropdown
  const qualitySelect = document.getElementById('qualitySelect');
  if (qualitySelect) {
    qualitySelect.addEventListener('change', (e) => {
      state.exportQuality = e.target.value;
      const qualityNames = { standard: 'Chuẩn (720p)', fast: 'Nhanh (480p)', high: 'Cao (1080p)' };
      showToast(`Đã chọn cấu hình xuất: ${qualityNames[state.exportQuality] || state.exportQuality}`, 'info');
    });
  }

  // Action Bar Buttons
  elements.btnAiRecognize.addEventListener('click', handleAiTranscription);
  elements.btnImportLyrics.addEventListener('click', () => {
    elements.importLyricsTextarea.value = '';
    elements.importLyricsModal.classList.add('active');
  });
  elements.btnCloseImportModal.addEventListener('click', () => {
    elements.importLyricsModal.classList.remove('active');
  });
  elements.btnCancelImport.addEventListener('click', () => {
    elements.importLyricsModal.classList.remove('active');
  });
  elements.btnConfirmImport.addEventListener('click', importLyricsFromText);
  elements.btnImportSync.addEventListener('click', loadSampleLyrics);
  elements.btnImportSrt.addEventListener('click', () => elements.srtFileInput.click());
  elements.btnExportSrt.addEventListener('click', exportToSRT);
  elements.srtFileInput.addEventListener('change', handleSrtSelection);
  elements.btnClearLyrics.addEventListener('click', clearLyrics);
  elements.btnAddLyricLine.addEventListener('click', addNewLyricRow);


  // Right Sidebar Tab switching
  document.querySelectorAll('.right-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.getAttribute('data-right-tab');
      document.querySelectorAll('.right-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.right-tab-content').forEach(tc => tc.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`right-tab-${tabName}`).classList.add('active');
    });
  });

  // Lyric Display Mode Switching
  document.querySelectorAll('.lyric-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.lyric-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.lyricMode = btn.getAttribute('data-lyric-mode');
      
      // If scrolling mode, hide next-line-toggle-group for simplicity
      const nextLineGroup = document.getElementById('next-line-toggle-group');
      if (nextLineGroup) {
        if (state.lyricMode === 'scrolling') {
          nextLineGroup.style.display = 'none';
        } else {
          nextLineGroup.style.display = 'flex';
        }
      }
      showToast(`Đã đổi kiểu chữ sang: ${state.lyricMode === 'scrolling' ? 'Cuộn toàn bộ' : 'Một câu'}`, 'success');
    });
  });

  // Text Case Switching
  document.querySelectorAll('.text-case-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.text-case-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.textCase = btn.getAttribute('data-case');
      showToast(`Đã đổi định dạng chữ sang: ${state.textCase === 'uppercase' ? 'IN HOA' : 'Chữ thường'}`, 'success');
    });
  });

  // Ken Burns & Particles checkbox toggles
  const kbToggle = document.getElementById('kenBurnsToggle');
  if (kbToggle) {
    kbToggle.addEventListener('change', (e) => {
      state.kenBurnsEnabled = e.target.checked;
      localStorage.setItem('effect_ken_burns', state.kenBurnsEnabled);
      showToast(`Đã ${state.kenBurnsEnabled ? 'bật' : 'tắt'} chuyển động nền Ken Burns`, 'info');
    });
  }

  const partToggle = document.getElementById('particlesToggle');
  if (partToggle) {
    partToggle.addEventListener('change', (e) => {
      state.particlesEnabled = e.target.checked;
      localStorage.setItem('effect_particles', state.particlesEnabled);
      showToast(`Đã ${state.particlesEnabled ? 'bật' : 'tắt'} hiệu ứng hạt bay`, 'info');
    });
  }

  // Export Buttons — use fast export (VideoEncoder) with fallback to real-time
  elements.btnExportWebM.addEventListener('click', () => startFastExport('webm'));
  elements.btnExportMP4.addEventListener('click', () => startFastExport('mp4'));

  // Drag and Drop Lyric Position directly on the Canvas
  const canvas = elements.previewCanvas;
  
  function getCanvasMouseCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches && e.touches.length > 0 ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches && e.touches.length > 0 ? e.touches[0].clientY : e.clientY;
    return {
      x: ((clientX - rect.left) / rect.width) * canvas.width,
      y: ((clientY - rect.top) / rect.height) * canvas.height
    };
  }

  canvas.addEventListener('mousedown', startDrag);
  canvas.addEventListener('touchstart', startDrag, { passive: true });

  const isIntroVisible = () => {
    if (!state.introEnabled) return false;
    if (!state.wavesurfer) return false;
    const curTime = state.wavesurfer.getCurrentTime();
    return curTime >= state.introStart && curTime <= state.introEnd;
  };

  function startDrag(e) {
    const coords = getCanvasMouseCoords(e);
    
    // Nếu Intro đang hiện, kiểm tra xem có click trúng vùng chữ Intro không
    if (isIntroVisible()) {
      const introY = canvas.height * (state.introYPercent / 100);
      if (Math.abs(coords.y - introY) < 80) {
        state.isDraggingIntro = true;
        canvas.style.cursor = 'move';
        if (e.cancelable) e.preventDefault();
        return;
      }
    }

    // Nếu không trúng Intro, kiểm tra xem có click trúng vùng chữ Lyrics không
    if (state.lyrics && state.lyrics.length > 0) {
      const lyricY = canvas.height * (state.lyricYPercent / 100);
      if (Math.abs(coords.y - lyricY) < 60) {
        state.isDraggingLyric = true;
        canvas.style.cursor = 'ns-resize';
        if (e.cancelable) e.preventDefault();
      }
    }
  }

  window.addEventListener('mousemove', dragMove);
  window.addEventListener('touchmove', dragMove, { passive: false });

  function dragMove(e) {
    const coords = getCanvasMouseCoords(e);
    const lyricY = canvas.height * (state.lyricYPercent / 100);
    const introY = canvas.height * (state.introYPercent / 100);
    
    if (!state.isDraggingLyric && !state.isDraggingIntro) {
      // Thay đổi biểu tượng con trỏ chuột khi di chuyển qua vùng kéo thả
      if (isIntroVisible() && Math.abs(coords.y - introY) < 80) {
        canvas.style.cursor = 'move';
      } else if (state.lyrics && state.lyrics.length > 0 && Math.abs(coords.y - lyricY) < 55) {
        canvas.style.cursor = 'ns-resize';
      } else {
        canvas.style.cursor = 'default';
      }
      return;
    }
    
    if (state.isDraggingIntro) {
      // Kéo thả 2 chiều cho Intro (Trái/Phải và Lên/Xuống)
      let newXPercent = Math.round((coords.x / canvas.width) * 100);
      newXPercent = Math.min(Math.max(newXPercent, 5), 95);
      state.introXPercent = newXPercent;
      
      let newYPercent = Math.round((coords.y / canvas.height) * 100);
      newYPercent = Math.min(Math.max(newYPercent, 10), 90);
      state.introYPercent = newYPercent;
      
      if (elements.introXInput) {
        elements.introXInput.value = newXPercent;
      }
      if (elements.introXVal) {
        elements.introXVal.innerText = newXPercent + '%';
      }
      if (elements.introYInput) {
        elements.introYInput.value = newYPercent;
      }
      if (elements.introYVal) {
        elements.introYVal.innerText = newYPercent + '%';
      }
    } else if (state.isDraggingLyric) {
      let newPercent = Math.round((coords.y / canvas.height) * 100);
      newPercent = Math.min(Math.max(newPercent, 10), 90);
      state.lyricYPercent = newPercent;
      if (elements.lyricYInput) {
        elements.lyricYInput.value = newPercent;
      }
      if (elements.lyricYVal) {
        elements.lyricYVal.innerText = newPercent + '%';
      }
    }
    
    if (e.cancelable) e.preventDefault();
  }

  window.addEventListener('mouseup', endDrag);
  window.addEventListener('touchend', endDrag);

  function endDrag() {
    if (state.isDraggingLyric || state.isDraggingIntro) {
      state.isDraggingLyric = false;
      state.isDraggingIntro = false;
      canvas.style.cursor = 'default';
    }
  }

  // 10. Song Intro Card Event Listeners
  if (elements.introToggle) {
    elements.introToggle.addEventListener('change', (e) => {
      state.introEnabled = e.target.checked;
      if (elements.introFieldsContainer) {
        elements.introFieldsContainer.style.display = state.introEnabled ? 'flex' : 'none';
      }
      showToast(`${state.introEnabled ? 'Đã bật' : 'Đã tắt'} tiêu đề giới thiệu bài hát`, 'info');
    });
  }

  if (elements.introTitleInput) {
    elements.introTitleInput.addEventListener('input', (e) => {
      state.introTitle = e.target.value;
    });
  }

  if (elements.introSubtitleInput) {
    elements.introSubtitleInput.addEventListener('input', (e) => {
      state.introSubtitle = e.target.value;
    });
  }

  if (elements.introStartInput) {
    elements.introStartInput.addEventListener('input', (e) => {
      state.introStart = parseFloat(e.target.value) || 0;
    });
  }

  if (elements.introEndInput) {
    elements.introEndInput.addEventListener('input', (e) => {
      state.introEnd = parseFloat(e.target.value) || 0;
    });
  }

  if (elements.introFontSizeInput) {
    elements.introFontSizeInput.addEventListener('input', (e) => {
      state.introFontSize = parseInt(e.target.value) || 72;
      if (elements.introFontSizeVal) {
        elements.introFontSizeVal.innerText = state.introFontSize + 'px';
      }
    });
  }

  if (elements.introYInput) {
    elements.introYInput.addEventListener('input', (e) => {
      state.introYPercent = parseInt(e.target.value) || 45;
      if (elements.introYVal) {
        elements.introYVal.innerText = state.introYPercent + '%';
      }
    });
  }

  if (elements.introXInput) {
    elements.introXInput.addEventListener('input', (e) => {
      state.introXPercent = parseInt(e.target.value) || 50;
      if (elements.introXVal) {
        elements.introXVal.innerText = state.introXPercent + '%';
      }
    });
  }

  // 11. New Video Effects Listeners
  if (elements.spectrumToggle) {
    elements.spectrumToggle.addEventListener('change', (e) => {
      state.spectrumEnabled = e.target.checked;
      localStorage.setItem('effect_spectrum', state.spectrumEnabled);
      if (elements.spectrumStyleContainer) {
        elements.spectrumStyleContainer.style.display = state.spectrumEnabled ? 'flex' : 'none';
      }
      if (state.spectrumEnabled) {
        initAudioAnalyser();
      }
      showToast(`Đã ${state.spectrumEnabled ? 'bật' : 'tắt'} hiệu ứng sóng nhạc Neon`, 'info');
    });
  }

  if (elements.spectrumStyleSelect) {
    elements.spectrumStyleSelect.addEventListener('change', (e) => {
      state.spectrumStyle = e.target.value;
      localStorage.setItem('effect_spectrum_style', state.spectrumStyle);
      showToast(`Đã đổi kiểu sóng nhạc sang: ${e.target.options[e.target.selectedIndex].text}`, 'success');
    });
  }

  if (elements.vinylToggle) {
    elements.vinylToggle.addEventListener('change', (e) => {
      state.vinylEnabled = e.target.checked;
      localStorage.setItem('effect_vinyl', state.vinylEnabled);
      showToast(`Đã ${state.vinylEnabled ? 'bật' : 'tắt'} hiệu ứng đĩa nhạc quay Lofi`, 'info');
    });
  }

  if (elements.bokehToggle) {
    elements.bokehToggle.addEventListener('change', (e) => {
      state.bokehEnabled = e.target.checked;
      localStorage.setItem('effect_bokeh', state.bokehEnabled);
      if (state.bokehEnabled) {
        initBokeh();
      }
      showToast(`Đã ${state.bokehEnabled ? 'bật' : 'tắt'} hiệu ứng đốm sáng Bokeh Lofi`, 'info');
    });
  }

  if (elements.grainToggle) {
    elements.grainToggle.addEventListener('change', (e) => {
      state.filmGrainEnabled = e.target.checked;
      localStorage.setItem('effect_film_grain', state.filmGrainEnabled);
      showToast(`Đã ${state.filmGrainEnabled ? 'bật' : 'tắt'} hiệu ứng bụi phim cổ điển`, 'info');
    });
  }
}

// ----------------------------------------------------
// ASPECT RATIO MANAGER
// ----------------------------------------------------
function updateAspectRatio(ratio) {
  state.aspectRatio = ratio;
  
  // Update canvas wrapper CSS class to trigger fluid aspect-ratio scaling
  const wrapper = document.querySelector('.canvas-wrapper');
  if (wrapper) {
    wrapper.classList.remove('ratio-16-9', 'ratio-9-16', 'ratio-1-1');
    wrapper.classList.add('ratio-' + ratio);
  }
  
  // Set real physical canvas drawing resolution
  if (ratio === '16-9') {
    elements.previewCanvas.width = 1920;
    elements.previewCanvas.height = 1080;
  } else if (ratio === '9-16') {
    elements.previewCanvas.width = 1080;
    elements.previewCanvas.height = 1920;
  } else if (ratio === '1-1') {
    elements.previewCanvas.width = 1080;
    elements.previewCanvas.height = 1080;
  }
  
  showToast(`Đã chuyển sang tỷ lệ: ${ratio === '16-9' ? '16:9 Ngang' : ratio === '9-16' ? '9:16 Dọc' : '1:1 Vuông'}`, 'success');
}


// ----------------------------------------------------
// AUDIO FILE LOADING & WAVEFORM
// ----------------------------------------------------
function handleAudioSelection() {
  const file = elements.audioFileInput.files[0];
  if (!file) return;

  state.audioFile = file;
  elements.audioFileName.innerText = file.name;
  const songTitle = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
  elements.songTitleDisplay.innerText = songTitle;
  
  state.introTitle = songTitle;
  if (elements.introTitleInput) {
    elements.introTitleInput.value = songTitle;
  }
  
  if (state.audioUrl) {
    URL.revokeObjectURL(state.audioUrl);
  }
  
  state.audioUrl = URL.createObjectURL(file);
  loadWaveform(state.audioUrl);

  // If the loaded audio file is actually a video file, auto-set as background
  if (file.type.startsWith('video/')) {
    setTimeout(() => {
      if (window.location.protocol === 'file:' && !/Electron/i.test(navigator.userAgent)) {
        // Pure file:// in browser (not Electron) → extract frame as static image
        cleanupBgMedia();
        extractVideoFrameAsImage(file);
        showFileProtocolWarning();
      } else {
        // Electron or HTTP → auto-set video as background (no confirm dialog)
        cleanupBgMedia();
        state.bgType = 'video';
        const bgVideo = elements.bgVideo;
        bgVideo.muted = state.bgVideoMuted;
        state.bgVideoUrl = URL.createObjectURL(file);
        
        bgVideo.onloadeddata = () => {
          if (bgVideo.videoWidth > 0) {
            elements.bgImageName.innerText = file.name;
            elements.bgImagePreview.style.display = 'flex';
            elements.btnMuteBgVideo.style.display = 'inline-flex';
            updateMuteButtonIcon();
            const onSeeked = () => {
              bgVideo.removeEventListener('seeked', onSeeked);
              showToast('Đã tự động đặt tệp video làm nền Canvas!', 'success');
              if (state.wavesurfer) syncBgVideoWithAudio(true);
            };
            bgVideo.addEventListener('seeked', onSeeked);
            bgVideo.currentTime = 0.01;
          } else {
            showToast('Không thể decode video.', 'error');
            cleanupBgMedia();
          }
        };
        bgVideo.onerror = () => { showToast('Lỗi video nền!', 'error'); cleanupBgMedia(); };
        bgVideo.src = state.bgVideoUrl;
        bgVideo.load();
      }
    }, 300);
  }
}

function loadWaveform(url) {
  // Destroy previous wave if exists
  if (state.wavesurfer) {
    state.wavesurfer.destroy();
  }

  // Hide placeholder
  elements.canvasPlaceholder.style.display = 'none';

  // Initialize wavesurfer
  state.wavesurfer = WaveSurfer.create({
    container: '#waveform',
    waveColor: 'rgba(255, 255, 255, 0.1)',
    progressColor: palettes[state.selectedColor].primary,
    cursorColor: palettes[state.selectedColor].primary,
    cursorWidth: 2,
    barWidth: 2,
    barGap: 3,
    height: 80,
    responsive: true,
    normalize: true,
    url: url
  });

  // Connect wavesurfer events
  state.wavesurfer.on('ready', () => {
    state.audioDuration = state.wavesurfer.getDuration();
    updateTimeDisplay(0, state.audioDuration);
    elements.btnPlayPause.removeAttribute('disabled');
    showToast('Tải tệp âm thanh thành công!', 'success');
  });

  state.wavesurfer.on('audioprocess', () => {
    const curTime = state.wavesurfer.getCurrentTime();
    updateTimeDisplay(curTime, state.audioDuration);
    trackActiveLyric(curTime);
    if (state.bgType === 'video') {
      syncBgVideoWithAudio();
    }
  });
  
  state.wavesurfer.on('interaction', () => {
    setTimeout(() => {
      const curTime = state.wavesurfer.getCurrentTime();
      updateTimeDisplay(curTime, state.audioDuration);
      trackActiveLyric(curTime);
      if (state.bgType === 'video') {
        syncBgVideoWithAudio(true); // force seek on interaction
      }
    }, 50);
  });

  state.wavesurfer.on('play', () => {
    state.isPlaying = true;
    elements.btnPlayPause.innerHTML = '<i class="fa-solid fa-pause"></i>';
    if (state.bgType === 'video' && elements.bgVideo) {
      syncBgVideoWithAudio(true);
      elements.bgVideo.play().catch(err => console.log("Video play error on wavesurfer play:", err));
    }
  });

  state.wavesurfer.on('pause', () => {
    state.isPlaying = false;
    elements.btnPlayPause.innerHTML = '<i class="fa-solid fa-play"></i>';
    if (state.bgType === 'video' && elements.bgVideo) {
      elements.bgVideo.pause();
    }
  });
}

function togglePlayPause() {
  if (!state.wavesurfer) return;
  state.wavesurfer.playPause();
}

function updateTimeDisplay(current, duration) {
  const format = (t) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };
  elements.timeDisplay.innerText = `${format(current)} / ${format(duration)}`;
}

// ----------------------------------------------------
// BACKGROUND IMAGE (COVER) & VIDEO HANDLING
// ----------------------------------------------------

// Show warning when file:// protocol blocks video features
function showFileProtocolWarning() {
  // Create a modal overlay with instructions
  let modal = document.getElementById('fileProtocolModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'fileProtocolModal';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;z-index:10000;';
    modal.innerHTML = `
      <div style="background:rgba(15,17,21,0.95);border:1px solid rgba(6,182,212,0.3);border-radius:16px;padding:32px;max-width:520px;width:90%;box-shadow:0 25px 60px rgba(0,0,0,0.7);text-align:center;">
        <div style="font-size:2.5rem;margin-bottom:12px;">⚠️</div>
        <h3 style="color:#fff;margin:0 0 12px 0;font-size:1.1rem;">Video nền yêu cầu HTTP Server</h3>
        <p style="color:rgba(255,255,255,0.7);font-size:0.85rem;line-height:1.6;margin:0 0 16px 0;">
          Trình duyệt <strong>chặn decode video</strong> khi mở file trực tiếp (<code style="background:rgba(255,255,255,0.1);padding:2px 6px;border-radius:4px;">file://</code>).<br><br>
          Để sử dụng <strong>video nền</strong>, hãy mở trang qua HTTP server:
        </p>
        <div style="background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:12px;margin:0 0 16px 0;text-align:left;">
          <p style="color:rgba(255,255,255,0.5);font-size:0.72rem;margin:0 0 6px 0;">Bước 1: Mở Terminal/CMD tại thư mục dự án</p>
          <code style="color:#22d3ee;font-size:0.8rem;font-family:monospace;">python -m http.server 8080</code>
          <p style="color:rgba(255,255,255,0.5);font-size:0.72rem;margin:10px 0 6px 0;">Bước 2: Mở trình duyệt tại</p>
          <code style="color:#22d3ee;font-size:0.8rem;font-family:monospace;">http://localhost:8080</code>
        </div>
        <p style="color:rgba(255,255,255,0.5);font-size:0.75rem;margin:0 0 16px 0;">
          💡 Frame đầu tiên của video sẽ được dùng làm <strong>ảnh nền tĩnh</strong> thay thế.
        </p>
        <button onclick="this.closest('#fileProtocolModal').remove()" style="background:linear-gradient(135deg,#06b6d4,#0891b2);color:#000;border:none;padding:10px 32px;border-radius:8px;font-weight:700;cursor:pointer;font-size:0.85rem;">Đã hiểu</button>
      </div>
    `;
    document.body.appendChild(modal);
  }
}

// Extract first frame of video as a static image (fallback for file:// protocol)
function extractVideoFrameAsImage(file) {
  // Use a temporary video element to get 1 frame, then convert to image
  const tempVideo = document.createElement('video');
  tempVideo.muted = true;
  tempVideo.preload = 'auto';
  tempVideo.playsInline = true;
  
  const url = URL.createObjectURL(file);
  tempVideo.src = url;
  
  tempVideo.onloadeddata = () => {
    // Try to seek to get a frame
    tempVideo.currentTime = 0.1;
  };
  
  tempVideo.onseeked = () => {
    // Even if videoWidth is 0 on file://, try to draw
    const w = tempVideo.videoWidth || 1920;
    const h = tempVideo.videoHeight || 1080;
    
    if (tempVideo.videoWidth > 0) {
      // We got actual dimensions - extract the frame
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = w;
      tmpCanvas.height = h;
      const tmpCtx = tmpCanvas.getContext('2d');
      tmpCtx.drawImage(tempVideo, 0, 0, w, h);
      
      const img = new Image();
      img.onload = () => {
        state.bgType = 'image';
        state.bgImage = img;
        elements.bgImageName.innerText = file.name + ' (ảnh tĩnh)';
        elements.bgImagePreview.style.display = 'flex';
        showToast('Đã dùng frame đầu video làm ảnh nền tĩnh.', 'info');
      };
      img.src = tmpCanvas.toDataURL('image/jpeg', 0.9);
    } else {
      // Can't extract frame either, just show the name
      elements.bgImageName.innerText = file.name + ' (không hỗ trợ)';
      elements.bgImagePreview.style.display = 'flex';
    }
    
    // Cleanup temp
    URL.revokeObjectURL(url);
    tempVideo.remove();
  };
  
  tempVideo.onerror = () => {
    URL.revokeObjectURL(url);
    tempVideo.remove();
  };
}
function cleanupBgMedia() {
  const bgVideo = elements.bgVideo;
  if (bgVideo) {
    // MUST clear handlers FIRST to prevent infinite error loops
    bgVideo.onloadeddata = null;
    bgVideo.onloadedmetadata = null;
    bgVideo.oncanplay = null;
    bgVideo.onerror = null;
    bgVideo.onseeked = null;
    bgVideo.pause();
    bgVideo.removeAttribute('src');
    bgVideo.load(); // reset to empty state
  }
  
  if (state.bgVideoUrl) {
    URL.revokeObjectURL(state.bgVideoUrl);
    state.bgVideoUrl = '';
  }
  
  state.bgImage = null;
  state.bgType = 'image';
}

// Helper: finalize video setup after successful decode
function finishVideoSetup(file, bgVideo) {
  elements.bgImageName.innerText = file.name;
  elements.bgImagePreview.style.display = 'flex';
  elements.btnMuteBgVideo.style.display = 'inline-flex';
  bgVideo.muted = state.bgVideoMuted;
  updateMuteButtonIcon();
  
  const onSeeked = () => {
    bgVideo.removeEventListener('seeked', onSeeked);
    console.log('[BG Video] Ready! videoWidth:', bgVideo.videoWidth, 'videoHeight:', bgVideo.videoHeight);
    showToast('Đã tải video nền thành công!', 'success');
    if (state.wavesurfer) syncBgVideoWithAudio(true);
  };
  bgVideo.addEventListener('seeked', onSeeked);
  bgVideo.currentTime = 0.01;
}

function handleBgImageSelection() {
  const file = elements.bgImageFileInput.files[0];
  if (!file) return;

  // Clean up any previous media first
  cleanupBgMedia();

  if (file.type.startsWith('video/')) {
    // Check if running on file:// protocol (video won't work)
    if (window.location.protocol === 'file:' && !/Electron/i.test(navigator.userAgent)) {
      showFileProtocolWarning();
      extractVideoFrameAsImage(file);
      return;
    }
    
    state.bgType = 'video';
    
    const videoUrl = URL.createObjectURL(file);
    state.bgVideoUrl = videoUrl;
    
    // Create a FRESH video element to avoid issues with embedded one
    const testVideo = document.createElement('video');
    testVideo.muted = true;
    testVideo.playsInline = true;
    testVideo.preload = 'auto';
    testVideo.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(testVideo);
    
    testVideo.onloadedmetadata = () => {
      console.log('[BG Video TEST] metadata. videoWidth:', testVideo.videoWidth, 'videoHeight:', testVideo.videoHeight, 'readyState:', testVideo.readyState);
      console.log('[BG Video TEST] error:', testVideo.error ? `code=${testVideo.error.code} message=${testVideo.error.message}` : 'none');
      
      if (testVideo.videoWidth > 0) {
        // Success! Copy the src to the real bgVideo element
        console.log('[BG Video] Test element works! Setting up main element...');
        const bgVideo = elements.bgVideo;
        bgVideo.onloadeddata = null;
        bgVideo.onloadedmetadata = null;
        bgVideo.onerror = null;
        bgVideo.muted = true;
        bgVideo.src = videoUrl;
        bgVideo.load();
        
        // Remove test element
        testVideo.pause();
        testVideo.remove();
        
        // Wait briefly for main element to load
        setTimeout(() => {
          console.log('[BG Video Main] videoWidth:', bgVideo.videoWidth, 'readyState:', bgVideo.readyState);
          if (bgVideo.videoWidth > 0) {
            finishVideoSetup(file, bgVideo);
          } else {
            // Use test dimensions as fallback - the bgVideo might still decode later
            showToast('Đã tải video nền thành công!', 'success');
            elements.bgImageName.innerText = file.name;
            elements.bgImagePreview.style.display = 'flex';
            elements.btnMuteBgVideo.style.display = 'inline-flex';
            updateMuteButtonIcon();
          }
        }, 300);
      } else {
        // Test element also failed
        console.log('[BG Video TEST] Failed. Trying play()...');
        testVideo.play().then(() => {
          testVideo.pause();
          console.log('[BG Video TEST] After play: videoWidth:', testVideo.videoWidth, 'error:', testVideo.error);
          if (testVideo.videoWidth > 0) {
            elements.bgVideo.src = videoUrl;
            elements.bgVideo.muted = true;
            elements.bgVideo.load();
            testVideo.remove();
            setTimeout(() => finishVideoSetup(file, elements.bgVideo), 300);
          } else {
            // Truly can't decode this video
            const errCode = testVideo.error ? testVideo.error.code : 'unknown';
            console.error('[BG Video] Cannot decode. Error code:', errCode);
            showToast(`Video không thể decode (lỗi: ${errCode}). Thử file MP4 H.264 khác.`, 'error');
            testVideo.remove();
            cleanupBgMedia();
          }
        }).catch(err => {
          console.error('[BG Video TEST] play failed:', err);
          showToast('Không thể phát video. Thử file khác hoặc trình duyệt khác.', 'error');
          testVideo.remove();
          cleanupBgMedia();
        });
      }
    };
    
    testVideo.onerror = () => {
      const err = testVideo.error;
      console.error('[BG Video TEST] Error:', err ? `code=${err.code} msg=${err.message}` : 'unknown');
      showToast('Lỗi video: ' + (err ? err.message || `code ${err.code}` : 'không rõ'), 'error');
      testVideo.remove();
      cleanupBgMedia();
    };
    
    testVideo.src = videoUrl;
    testVideo.load();
  } else {
    state.bgType = 'image';
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        state.bgImage = img;
        elements.bgImageName.innerText = file.name;
        elements.bgImagePreview.style.display = 'flex';
        showToast('Đã tải ảnh nền thành công!', 'success');
      };
      img.onerror = () => {
        showToast('Lỗi khi tải hình ảnh nền!', 'error');
        cleanupBgMedia();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }
}

function removeBgImage() {
  cleanupBgMedia();
  elements.bgImageFileInput.value = '';
  elements.bgImagePreview.style.display = 'none';
  elements.btnMuteBgVideo.style.display = 'none';
  showToast('Đã gỡ hình ảnh/video nền.', 'info');
}

function toggleBgVideoMute() {
  state.bgVideoMuted = !state.bgVideoMuted;
  const bgVideo = elements.bgVideo;
  if (bgVideo) {
    bgVideo.muted = state.bgVideoMuted;
  }
  updateMuteButtonIcon();
  showToast(state.bgVideoMuted ? 'Đã tắt âm thanh video nền' : 'Đã bật âm thanh video nền', 'info');
}

function updateMuteButtonIcon() {
  const btn = elements.btnMuteBgVideo;
  if (!btn) return;
  if (state.bgVideoMuted) {
    btn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
    btn.title = 'Bật âm thanh video nền';
    btn.style.color = 'var(--text-secondary)';
  } else {
    btn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
    btn.title = 'Tắt âm thanh video nền';
    btn.style.color = 'var(--neon-cyan)';
  }
}

function syncBgVideoWithAudio(force = false) {
  if (state.bgType !== 'video' || !state.wavesurfer) return;
  const bgVideo = elements.bgVideo;
  if (!bgVideo || !bgVideo.duration) return;

  const audioTime = state.wavesurfer.getCurrentTime();
  const targetTime = audioTime % bgVideo.duration;

  // Prevent browser stuttering by syncing only if drift is > 0.3 seconds
  const drift = Math.abs(bgVideo.currentTime - targetTime);
  if (force || drift > 0.3) {
    bgVideo.currentTime = targetTime;
  }

  // Sync play/pause state
  const shouldBePlaying = state.wavesurfer.isPlaying();
  if (shouldBePlaying && bgVideo.paused) {
    bgVideo.play().catch(err => console.log("Video sync play error:", err));
  } else if (!shouldBePlaying && !bgVideo.paused) {
    bgVideo.pause();
  }
}

// ----------------------------------------------------
// INTERACTIVE KEYBOARD SHORTCUTS FOR SYNCING
// ----------------------------------------------------
function handleKeyPress(e) {
  // If user is focused on any input field, do not trigger global shortcuts
  if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
    return;
  }

  if (!state.wavesurfer) return;

  const key = e.key.toLowerCase();
  
  if (e.key === ' ') {
    e.preventDefault();
    togglePlayPause();
  } else if (key === 's') {
    // Record START time for active lyric line
    if (state.activeLyricIndex >= 0 && state.activeLyricIndex < state.lyrics.length) {
      const curTime = parseFloat(state.wavesurfer.getCurrentTime().toFixed(1));
      updateLyricStart(state.activeLyricIndex, curTime);
      showToast(`Ghi Start line ${state.activeLyricIndex + 1}: ${curTime}s`, 'info');
    }
  } else if (key === 'e') {
    // Record END time for active lyric line
    if (state.activeLyricIndex >= 0 && state.activeLyricIndex < state.lyrics.length) {
      const curTime = parseFloat(state.wavesurfer.getCurrentTime().toFixed(1));
      updateLyricEnd(state.activeLyricIndex, curTime);
      showToast(`Ghi End line ${state.activeLyricIndex + 1}: ${curTime}s`, 'info');
      
      // Auto advance to next line to make manual syncing blazing fast
      setTimeout(() => {
        selectNextLine();
      }, 100);
    }
  }
}

// ----------------------------------------------------
// LYRICS STATE & TIMELINE SYNC MANAGER
// ----------------------------------------------------
function renderLyricsList() {
  elements.lyricsList.innerHTML = '';
  
  if (state.lyrics.length === 0) {
    elements.lyricsList.innerHTML = `
      <div class="canvas-overlay-message" style="position: static; transform: none; padding: 40px 10px;">
        Chưa có lyrics. Vui lòng tải âm thanh lên và chọn "Nhận diện AI" hoặc "Tải mẫu" để bắt đầu!
      </div>
    `;
    return;
  }

  state.lyrics.forEach((lyric, idx) => {
    const item = document.createElement('div');
    item.className = `lyric-item ${idx === state.activeLyricIndex ? 'active' : ''}`;
    item.id = `lyric-row-${idx}`;
    item.setAttribute('data-index', idx);
    
    // Auto scroll the active row into view
    if (idx === state.activeLyricIndex) {
      setTimeout(() => {
        item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50);
    }

    item.innerHTML = `
      <div class="lyric-item-header">
        <span class="lyric-index">${idx + 1}</span>
        <div class="lyric-times">
          <input type="number" step="0.1" min="0" class="lyric-time-input start-input" value="${lyric.start}" title="Start (sec)" data-index="${idx}">
          <span style="color: var(--text-muted); font-size: 0.7rem;">to</span>
          <input type="number" step="0.1" min="0" class="lyric-time-input end-input" value="${lyric.end}" title="End (sec)" data-index="${idx}">
        </div>
        <div class="lyric-item-actions">
          <button class="lyric-item-btn btn-play-from" title="Phát từ điểm này" data-index="${idx}">
            <i class="fa-solid fa-play"></i>
          </button>
          <button class="lyric-item-btn btn-delete" style="color: var(--neon-red);" title="Xóa dòng" data-index="${idx}">
            <i class="fa-solid fa-circle-minus"></i>
          </button>
        </div>
      </div>
      <input type="text" class="lyric-text-input text-input" value="${lyric.text}" placeholder="Nhập câu hát..." data-index="${idx}">
    `;

    // Row Click to select row active
    item.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT' && !e.target.closest('.lyric-item-btn')) {
        setActiveLyricRow(idx);
      }
    });

    // Handle Input Edits
    const textInput = item.querySelector('.text-input');
    const startInput = item.querySelector('.start-input');
    const endInput = item.querySelector('.end-input');

    textInput.addEventListener('change', (e) => updateLyricText(idx, e.target.value));
    startInput.addEventListener('change', (e) => updateLyricStart(idx, parseFloat(e.target.value) || 0));
    endInput.addEventListener('change', (e) => updateLyricEnd(idx, parseFloat(e.target.value) || 0));

    // Button actions
    item.querySelector('.btn-play-from').addEventListener('click', () => {
      if (state.wavesurfer) {
        state.wavesurfer.setTime(lyric.start);
        state.wavesurfer.play();
        setActiveLyricRow(idx);
      }
    });

    item.querySelector('.btn-delete').addEventListener('click', () => deleteLyricLine(idx));

    elements.lyricsList.appendChild(item);
  });
}

function setActiveLyricRow(idx) {
  state.activeLyricIndex = idx;
  document.querySelectorAll('.lyric-item').forEach((item, i) => {
    if (i === idx) {
      item.classList.add('active');
      item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      item.classList.remove('active');
    }
  });
}

function trackActiveLyric(currentTime) {
  if (state.lyrics.length === 0) return;
  
  // Find which lyric encompasses the current time
  let foundIdx = -1;
  
  for (let i = 0; i < state.lyrics.length; i++) {
    const l = state.lyrics[i];
    // Check if within bounds
    if (currentTime >= l.start && currentTime <= l.end) {
      foundIdx = i;
      break;
    }
  }

  // If not exactly on a line, look at what is upcoming
  if (foundIdx === -1) {
    // Find next line to display pre-show
    for (let i = 0; i < state.lyrics.length; i++) {
      const l = state.lyrics[i];
      if (currentTime < l.start && (currentTime >= l.start - state.preshowDelay)) {
        foundIdx = i;
        break;
      }
    }
  }

  // If found and it is different from current active index, switch
  if (foundIdx !== -1 && foundIdx !== state.activeLyricIndex) {
    setActiveLyricRow(foundIdx);
  }
}

function selectPrevLine() {
  if (state.lyrics.length === 0) return;
  let newIdx = state.activeLyricIndex - 1;
  if (newIdx < 0) newIdx = state.lyrics.length - 1;
  setActiveLyricRow(newIdx);
  if (state.wavesurfer) {
    state.wavesurfer.setTime(state.lyrics[newIdx].start);
  }
}

function selectNextLine() {
  if (state.lyrics.length === 0) return;
  let newIdx = state.activeLyricIndex + 1;
  if (newIdx >= state.lyrics.length) newIdx = 0;
  setActiveLyricRow(newIdx);
  if (state.wavesurfer) {
    state.wavesurfer.setTime(state.lyrics[newIdx].start);
  }
}

function updateLyricText(idx, text) {
  if (state.lyrics[idx]) {
    state.lyrics[idx].text = text;
  }
}

function updateLyricStart(idx, val) {
  if (state.lyrics[idx]) {
    state.lyrics[idx].start = parseFloat(val.toFixed(1));
    // Sort chronological helper (optional, let's keep array order intact unless requested)
    const input = document.querySelector(`#lyric-row-${idx} .start-input`);
    if (input) input.value = state.lyrics[idx].start;
  }
}

function updateLyricEnd(idx, val) {
  if (state.lyrics[idx]) {
    state.lyrics[idx].end = parseFloat(val.toFixed(1));
    const input = document.querySelector(`#lyric-row-${idx} .end-input`);
    if (input) input.value = state.lyrics[idx].end;
  }
}

function deleteLyricLine(idx) {
  state.lyrics.splice(idx, 1);
  if (state.activeLyricIndex >= state.lyrics.length) {
    state.activeLyricIndex = state.lyrics.length - 1;
  }
  renderLyricsList();
  showToast('Đã xóa câu lyric!', 'info');
}

function addNewLyricRow() {
  let startVal = 0;
  let endVal = 5;

  if (state.lyrics.length > 0) {
    const lastLine = state.lyrics[state.lyrics.length - 1];
    startVal = lastLine.end + 0.5;
    endVal = startVal + 4.0;
  } else if (state.wavesurfer) {
    startVal = parseFloat(state.wavesurfer.getCurrentTime().toFixed(1));
    endVal = startVal + 4.0;
  }

  state.lyrics.push({
    text: '',
    start: startVal,
    end: endVal
  });

  renderLyricsList();
  setActiveLyricRow(state.lyrics.length - 1);
  showToast('Đã thêm dòng lyric mới!', 'success');
}

function clearLyrics() {
  if (confirm('Bạn có chắc chắn muốn xóa toàn bộ danh sách lyrics?')) {
    state.lyrics = [];
    state.activeLyricIndex = -1;
    renderLyricsList();
    showToast('Đã xóa toàn bộ lyrics!', 'info');
  }
}

function loadSampleLyrics() {
  state.lyrics = [
    { text: "Nắng xiên qua từng khung cửa nhỏ", start: 1.5, end: 4.8 },
    { text: "Đánh thức giấc mơ đêm qua dịu êm", start: 5.4, end: 9.2 },
    { text: "Gió khẽ lay nhành hoa quỳnh nở", start: 10.0, end: 13.5 },
    { text: "Hương hoa ngát bay dịu ngọt thềm êm", start: 14.0, end: 17.8 },
    { text: "Ta ngồi đây giữa chiều thơ mộng", start: 18.5, end: 22.0 },
    { text: "Nghe khúc ca ngân vang nhẹ say", start: 22.6, end: 26.5 },
    { text: "Đón lấy tia nắng hồng chan chứa", start: 27.0, end: 30.0 }
  ];
  state.activeLyricIndex = 0;
  renderLyricsList();
  showToast('Đã tải danh sách lyric mẫu thành công!', 'success');
  
  if (state.wavesurfer) {
    state.wavesurfer.setTime(state.lyrics[0].start);
  }
}

// ----------------------------------------------------
// IMPORT LYRICS FROM PASTED TEXT
// ----------------------------------------------------
function importLyricsFromText() {
  const rawText = elements.importLyricsTextarea.value.trim();
  if (!rawText) {
    showToast('Vui lòng dán lời bài hát vào ô văn bản!', 'error');
    return;
  }

  // Split by newlines, filter empty lines
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  
  if (lines.length === 0) {
    showToast('Không tìm thấy dòng lyric hợp lệ nào!', 'error');
    return;
  }

  const autoDistribute = elements.autoDistributeTimestamps.checked;
  const totalDuration = state.audioDuration || (lines.length * 4); // fallback: 4s per line
  const lineGap = 0.3; // small gap between lines
  const usableDuration = totalDuration - (lines.length * lineGap);
  const perLine = usableDuration / lines.length;

  const newLyrics = [];
  let cursor = 0.5; // start 0.5s into the song

  for (let i = 0; i < lines.length; i++) {
    const startTime = parseFloat(cursor.toFixed(1));
    const duration = autoDistribute ? perLine : 4.0;
    const endTime = parseFloat((cursor + duration).toFixed(1));

    newLyrics.push({
      text: lines[i],
      start: startTime,
      end: endTime
    });

    cursor = endTime + lineGap;
  }

  // Ask whether to replace or append
  if (state.lyrics.length > 0) {
    const shouldReplace = confirm(`Bạn đã có ${state.lyrics.length} dòng lyric. Bạn muốn:\n\n[OK] = Thay thế toàn bộ bằng lyrics mới\n[Cancel] = Thêm tiếp vào cuối danh sách`);
    if (shouldReplace) {
      state.lyrics = newLyrics;
    } else {
      // Append: adjust timestamps to continue after last existing line
      const lastEnd = state.lyrics[state.lyrics.length - 1].end;
      let appendCursor = lastEnd + 0.5;
      for (const item of newLyrics) {
        const dur = item.end - item.start;
        item.start = parseFloat(appendCursor.toFixed(1));
        item.end = parseFloat((appendCursor + dur).toFixed(1));
        appendCursor = item.end + lineGap;
        state.lyrics.push(item);
      }
    }
  } else {
    state.lyrics = newLyrics;
  }

  state.activeLyricIndex = 0;
  renderLyricsList();
  elements.importLyricsModal.classList.remove('active');
  showToast(`Đã nhập thành công ${lines.length} dòng lyric! Dùng phím [S] và [E] để đồng bộ thời gian.`, 'success');

  if (state.wavesurfer && state.lyrics.length > 0) {
    state.wavesurfer.setTime(state.lyrics[0].start);
  }
}

// ----------------------------------------------------
// SRT SUBTITLE FILE PARSER & LOADER
// ----------------------------------------------------
function timeToSeconds(timeStr) {
  if (!timeStr) return null;
  const match = timeStr.trim().match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
  if (!match) return null;
  const hrs = parseInt(match[1], 10);
  const mins = parseInt(match[2], 10);
  const secs = parseInt(match[3], 10);
  const ms = parseInt(match[4], 10);
  return parseFloat((hrs * 3600 + mins * 60 + secs + ms / 1000).toFixed(1));
}

function parseSRT(srtText) {
  // Normalize line endings and split by double newlines to isolate blocks
  const normalized = srtText.replace(/\r\n/g, '\n');
  const blocks = normalized.trim().split(/\n\s*\n/);
  const lyrics = [];
  
  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 2) continue;
    
    // Locate the time marker line containing "-->"
    let timeLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('-->')) {
        timeLineIdx = i;
        break;
      }
    }
    if (timeLineIdx === -1) continue;
    
    const timeLine = lines[timeLineIdx];
    const textLines = lines.slice(timeLineIdx + 1);
    const text = textLines.join(' ');
    
    const times = timeLine.split('-->').map(t => t.trim());
    if (times.length !== 2) continue;
    
    const startSec = timeToSeconds(times[0]);
    const endSec = timeToSeconds(times[1]);
    
    if (startSec !== null && endSec !== null) {
      lyrics.push({
        text: text,
        start: startSec,
        end: endSec
      });
    }
  }
  return lyrics;
}

function handleSrtSelection() {
  const file = elements.srtFileInput.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsedLyrics = parseSRT(e.target.result);
      if (parsedLyrics.length === 0) {
        showToast('Không thể bóc tách phụ đề nào! Vui lòng kiểm tra lại định dạng file .srt', 'error');
        return;
      }
      
      // Prompt whether to replace or append
      if (state.lyrics.length > 0) {
        const shouldReplace = confirm(`Bạn đã có ${state.lyrics.length} dòng lyric. Bạn muốn:\n\n[OK] = Thay thế toàn bộ bằng phụ đề SRT mới\n[Cancel] = Thêm phụ đề tiếp vào cuối danh sách`);
        if (shouldReplace) {
          state.lyrics = parsedLyrics;
        } else {
          // Append and sort
          state.lyrics = [...state.lyrics, ...parsedLyrics];
          state.lyrics.sort((a, b) => a.start - b.start);
        }
      } else {
        state.lyrics = parsedLyrics;
      }
      
      state.activeLyricIndex = 0;
      renderLyricsList();
      showToast(`Đã nhập thành công ${parsedLyrics.length} câu phụ đề SRT!`, 'success');
      
      if (state.wavesurfer && state.lyrics.length > 0) {
        state.wavesurfer.setTime(state.lyrics[0].start);
      }
      
      // Auto-set the lyric Y position slider to a standard bottom subtitle height (like 85%) for standard subtitling
      state.lyricYPercent = 85;
      if (elements.lyricYInput) elements.lyricYInput.value = 85;
      if (elements.lyricYVal) elements.lyricYVal.innerText = '85%';
      
      // Auto switch the lyric effect to 'subtitle' for static subtitle presentation
      const subtitleBtn = document.querySelector('.effect-btn[data-effect="subtitle"]');
      if (subtitleBtn) {
        document.querySelectorAll('.effect-btn').forEach(b => b.classList.remove('active'));
        subtitleBtn.classList.add('active');
        state.selectedEffect = 'subtitle';
      }
      
      // Reset input element value to allow re-uploading same file
      elements.srtFileInput.value = '';
      
    } catch (err) {
      showToast(`Lỗi phân tích file SRT: ${err.message}`, 'error');
    }
  };
  reader.onerror = () => showToast('Lỗi đọc file phụ đề!', 'error');
  reader.readAsText(file);
}

// ----------------------------------------------------
// SRT SUBTITLE FILE GENERATOR & EXPORTER
// ----------------------------------------------------
function formatSecondsToSRTTime(seconds) {
  const date = new Date(null);
  date.setSeconds(Math.floor(seconds));
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  const timeStr = date.toISOString().substr(11, 8); // "HH:MM:SS"
  const msStr = String(ms).padStart(3, '0');
  return `${timeStr},${msStr}`;
}

function exportToSRT() {
  if (state.lyrics.length === 0) {
    showToast('Chưa có lyrics để tải về phụ đề!', 'error');
    return;
  }

  let srtContent = '';
  state.lyrics.forEach((lyric, idx) => {
    const startStr = formatSecondsToSRTTime(lyric.start);
    const endStr = formatSecondsToSRTTime(lyric.end);
    
    srtContent += `${idx + 1}\n`;
    srtContent += `${startStr} --> ${endStr}\n`;
    srtContent += `${lyric.text}\n\n`;
  });

  const blob = new Blob([srtContent], { type: 'text/srt;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  
  const cleanTitle = (elements.songTitleDisplay.innerText || 'lyrics').replace(/\s+/g, '_');
  a.download = `${cleanTitle}.srt`;
  
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  
  URL.revokeObjectURL(url);
  showToast('Tải tệp phụ đề .srt thành công!', 'success');
}

// ----------------------------------------------------
// CLIENT-SIDE GEMINI API AI AUDIO TRANSCRIPTION
// ----------------------------------------------------
async function handleAiTranscription() {
  if (!state.audioFile) {
    showToast('Vui lòng chọn tệp âm thanh trước khi nhận diện!', 'error');
    return;
  }
  
  if (!state.apiKey) {
    showToast('Chưa cấu hình Gemini API Key! Vui lòng thêm trong Header.', 'error');
    elements.apiKeyModal.classList.add('active');
    return;
  }

  // UI state processing
  elements.processingOverlay.classList.add('active');
  elements.processingText.innerHTML = `
    <div style="font-size: 1.1rem; font-weight: bold; margin-bottom: 6px;">Đang tối ưu hóa âm thanh...</div>
    <div style="font-size: 0.8rem; opacity: 0.7;">Chuẩn bị trích xuất và nén nhạc từ tệp video/audio...</div>
  `;

  try {
    let base64Audio = '';
    let mimeType = 'audio/wav';
    
    try {
      const arrayBuffer = await state.audioFile.arrayBuffer();
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      
      elements.processingText.innerHTML = `
        <div style="font-size: 1.1rem; font-weight: bold; margin-bottom: 6px;">Đang giải mã âm thanh...</div>
        <div style="font-size: 0.8rem; opacity: 0.7;">Giải mã nhạc gốc từ tệp tải lên...</div>
      `;
      
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      
      elements.processingText.innerHTML = `
        <div style="font-size: 1.1rem; font-weight: bold; margin-bottom: 6px;">Đang nén & resample âm thanh...</div>
        <div style="font-size: 0.8rem; opacity: 0.7;">Trích xuất nhạc mono 16kHz siêu nhẹ để AI nhận diện siêu nhanh...</div>
      `;
      
      const wavBlob = await resampleAndEncodeWav(audioBuffer);
      console.log('[AI Audio Compressor] Optimized WAV size:', (wavBlob.size / 1024 / 1024).toFixed(2), 'MB');
      
      base64Audio = await blobToBase64(wavBlob);
      mimeType = 'audio/wav';
    } catch (decodeErr) {
      console.warn('[AI Audio Compressor] AudioContext decode failed. Falling back to direct upload...', decodeErr);
      
      if (state.audioFile.size > 22 * 1024 * 1024) {
        throw new Error('Không thể giải mã tệp âm thanh trong video này. Vui lòng nén nhỏ video hoặc tải lên file MP3 dưới 20MB!');
      }
      
      elements.processingText.innerHTML = `
        <div style="font-size: 1.1rem; font-weight: bold; margin-bottom: 6px;">Đang tải trực tiếp...</div>
        <div style="font-size: 0.8rem; opacity: 0.7;">Mã hóa trực tiếp tệp gốc (không nén)</div>
      `;
      base64Audio = await fileToBase64(state.audioFile);
      mimeType = state.audioFile.type;
    }
    
    // 2. Call Gemini API
    elements.processingText.innerHTML = `
      <div style="font-size: 1.1rem; font-weight: bold; margin-bottom: 6px;">AI Đang Lắng Nghe...</div>
      <div style="font-size: 0.8rem; opacity: 0.7;">Gemini đang phân tích âm thanh & tạo timestamps (có thể mất 15-40s)</div>
    `;

    // Tối ưu hóa prompt động bằng cách truyền trực tiếp tổng độ dài bài hát vào để tránh AI dừng sớm ở 1 phút
    const songDuration = state.audioDuration || 0;
    let promptText = AI_PROMPT;
    if (songDuration > 0) {
      promptText = `You are an audio transcription tool. The audio file is exactly ${songDuration.toFixed(1)} seconds long.
Listen to this ENTIRE ${songDuration.toFixed(1)}-second audio file from start to finish, and output every single lyric line with its precise timestamp from 0.0s to ${songDuration.toFixed(1)}s.
Do NOT stop early. You MUST transcribe the entire song all the way to the end at ${songDuration.toFixed(1)} seconds.

Return ONLY a raw JSON array — no markdown, no code block, no explanation:
[{"text": "lyric line", "start": 12.3, "end": 14.8}, ...]

TIMESTAMPS:
• "start" = exact second the first syllable of this line begins
• "end" = exact second the last syllable of this line ends (NOT when the next line starts)
• 1 decimal place • end > start • lines never overlap • strictly chronological order

COMPLETENESS — process the full file, do not stop early:
• Include every sung phrase: verse, chorus, bridge, hook, ad-lib, backing vocals with distinct lyrics
• Each chorus/hook repetition = a separate JSON entry with its own timestamps
• Omit only purely instrumental sections (no vocals at all)
• A typical song has 30–80+ lines — output ALL of them, transcribing up to the final second of the audio file.

LINE FORMATTING:
• One line = one musical phrase / one breath
• If a phrase exceeds 8 seconds, split it at a natural pause
• For Vietnamese: write exact tone marks as you hear them (đúng dấu thanh điệu)
• Transcribe only what you hear — do not invent or add lyrics

Output the JSON array:`;
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${state.apiModel}:generateContent?key=${state.apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              inlineData: {
                mimeType: mimeType,
                data: base64Audio
              }
            },
            {
              text: promptText
            }
          ]
        }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
          maxOutputTokens: 8192
        }
      })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'Có lỗi xảy ra khi gửi yêu cầu tới Gemini.');
    }

    const data = await response.json();
    const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!resultText) {
      throw new Error('Mô hình không trả về kết quả transcription.');
    }

    // 3. Parse JSON Array and Load into app state
    try {
      let cleanJson = resultText.trim();
      if (cleanJson.startsWith('```json')) {
        cleanJson = cleanJson.substring(7);
      }
      if (cleanJson.endsWith('```')) {
        cleanJson = cleanJson.substring(0, cleanJson.length - 3);
      }
      cleanJson = cleanJson.trim();

      const parsedLyrics = JSON.parse(cleanJson);
      
      if (!Array.isArray(parsedLyrics)) {
        throw new Error('Kết quả trả về không phải là mảng JSON hợp lệ.');
      }

      state.lyrics = parsedLyrics.map(item => ({
        text: item.text || '',
        start: parseFloat(item.start) || 0,
        end: parseFloat(item.end) || 0
      }));

      state.lyrics.sort((a, b) => a.start - b.start);

      state.activeLyricIndex = state.lyrics.length > 0 ? 0 : -1;
      renderLyricsList();
      
      showToast(`AI Nhận diện hoàn tất! Đã tạo thành công ${state.lyrics.length} dòng lyric.`, 'success');
      
      if (state.lyrics.length > 0 && state.wavesurfer) {
        state.wavesurfer.setTime(state.lyrics[0].start);
      }
    } catch (parseError) {
      console.error('Raw content:', resultText);
      throw new Error(`Lỗi parse JSON kết quả AI: ${parseError.message}`);
    }

  } catch (error) {
    console.error(error);
    showToast(`Thất bại: ${error.message}`, 'error');
  } finally {
    elements.processingOverlay.classList.remove('active');
  }
}

// Resampling and WAV encoding helpers
function resampleAndEncodeWav(buffer) {
  const numOfChan = 1;
  const sampleRate = 16000;

  return new Promise((resolve) => {
    const offlineCtx = new OfflineAudioContext(numOfChan, sampleRate * buffer.duration, sampleRate);
    const bufferSource = offlineCtx.createBufferSource();
    bufferSource.buffer = buffer;
    bufferSource.connect(offlineCtx.destination);
    bufferSource.start();
    
    offlineCtx.startRendering().then((resampledBuffer) => {
      const channelData = resampledBuffer.getChannelData(0);
      const sRate = resampledBuffer.sampleRate;
      const wavBuffer = new ArrayBuffer(44 + channelData.length * 2);
      const view = new DataView(wavBuffer);

      // RIFF identifier
      writeString(view, 0, 'RIFF');
      // file length
      view.setUint32(4, 36 + channelData.length * 2, true);
      // RIFF type
      writeString(view, 8, 'WAVE');
      // format chunk identifier
      writeString(view, 12, 'fmt ');
      // format chunk length
      view.setUint32(16, 16, true);
      // sample format (raw)
      view.setUint16(20, 1, true);
      // channel count
      view.setUint16(22, 1, true);
      // sample rate
      view.setUint32(24, sRate, true);
      // byte rate
      view.setUint32(28, sRate * 2, true);
      // block align
      view.setUint16(32, 2, true);
      // bits per sample
      view.setUint16(34, 16, true);
      // data chunk identifier
      writeString(view, 36, 'data');
      // data chunk length
      view.setUint32(40, channelData.length * 2, true);

      // Write PCM audio samples
      floatTo16BitPCM(view, 44, channelData);

      resolve(new Blob([view], { type: 'audio/wav' }));
    });
  });
}

function floatTo16BitPCM(output, offset, input) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, input[i]));
    output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

// Base64 helper
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const base64String = reader.result.split(',')[1];
      resolve(base64String);
    };
    reader.onerror = error => reject(error);
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onload = () => {
      const base64String = reader.result.split(',')[1];
      resolve(base64String);
    };
    reader.onerror = error => reject(error);
  });
}

// ----------------------------------------------------
// CANVAS GRAPHICS & RENDERING ENGINE
// ----------------------------------------------------
function canvasRenderLoop() {
  const width = elements.previewCanvas.width;
  const height = elements.previewCanvas.height;
  
  // Get active audio current time
  let currentTime = 0;
  if (state.wavesurfer) {
    currentTime = state.wavesurfer.getCurrentTime();
  }

  // Clear Canvas
  ctx.clearRect(0, 0, width, height);

  // 1. Draw Background
  try {
    drawBackground(ctx, width, height);
  } catch (err) {
    console.error("Error drawing background:", err);
  }

  // 1.2 Draw Lofi Bokeh bubbles
  try {
    drawBokeh(ctx, width, height);
  } catch (err) {
    console.error("Error drawing bokeh:", err);
  }

  // 1.5 Draw Floating Particles
  try {
    drawParticles(ctx, width, height);
  } catch (err) {
    console.error("Error drawing particles:", err);
  }

  // 2. Draw Album Artwork (if loaded)
  try {
    drawAlbumCover(ctx, width, height);
  } catch (err) {
    console.error("Error drawing album cover:", err);
  }

  // 2.5 Draw Neon Audio Spectrum
  try {
    drawAudioSpectrum(ctx, width, height);
  } catch (err) {
    console.error("Error drawing audio spectrum:", err);
  }

  // 3. Draw Lyrics overlay
  try {
    drawLyrics(ctx, width, height, currentTime);
  } catch (err) {
    console.error("Error drawing lyrics:", err);
  }

  // 4. Draw Song Intro Card (Tựa đề & Giới thiệu bài hát đầu video)
  try {
    drawIntroCard(ctx, width, height, currentTime);
  } catch (err) {
    console.error("Error drawing intro card:", err);
  }

  // 5. Draw Vintage Film Grain overlay on top of everything
  try {
    drawFilmGrain(ctx, width, height);
  } catch (err) {
    console.error("Error drawing film grain:", err);
  }

  // Export progress is shown via HTML overlay only (NOT on canvas, to avoid baking into recorded video)

  // Pause render loop during fast export
  if (state.exportPauseRaf) return;

  // Loop request
  requestAnimationFrame(canvasRenderLoop);
}

// Render a single canvas frame at a specific time (for fast export)
function renderCanvasAtTime(targetTime) {
  const canvas = elements.previewCanvas;
  const c = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  c.clearRect(0, 0, width, height);
  try { drawBackground(c, width, height); } catch(e) { console.warn('[FastExport] BG:', e.message); }
  try { drawBokeh(c, width, height); } catch(e) { /* optional */ }
  try { drawParticles(c, width, height); } catch(e) { /* optional */ }
  try { drawAlbumCover(c, width, height); } catch(e) { console.warn('[FastExport] Cover:', e.message); }
  // Skip spectrum in fast export (no real-time audio data)
  try { drawLyrics(c, width, height, targetTime); } catch(e) { console.warn('[FastExport] Lyrics:', e.message); }
  try { drawIntroCard(c, width, height, targetTime); } catch(e) { /* optional */ }
  try { drawFilmGrain(c, width, height); } catch(e) { /* optional */ }
}

function drawIntroCard(c, w, h, currentTime) {
  if (!state.introEnabled) return;
  if (currentTime < state.introStart || currentTime > state.introEnd) return;

  const duration = state.introEnd - state.introStart;
  const elapsed = currentTime - state.introStart;
  
  // Tính toán mượt mà hiệu ứng fade-in và fade-out bằng Opacity
  let opacity = 1.0;
  const fadeDur = 0.6; // 0.6 giây để chuyển đổi mượt
  if (elapsed < fadeDur) {
    opacity = elapsed / fadeDur;
  } else if (state.introEnd - currentTime < fadeDur) {
    opacity = (state.introEnd - currentTime) / fadeDur;
  }
  opacity = Math.min(Math.max(opacity, 0), 1);

  c.save();
  c.globalAlpha = opacity;

  // Xác định tọa độ tâm hiển thị
  const centerX = w * (state.introXPercent / 100);
  const centerY = h * (state.introYPercent / 100);

  const themeColors = palettes[state.selectedColor] || palettes['neon-green'];
  const fontName = state.selectedFont;

  // Tự động căn chỉnh căn lề (TextAlign) cực kỳ thông minh khi kéo thả
  // Nếu kéo sát lề trái (< 35%), chữ tự động left-align. Sát lề phải (> 65%), chữ right-align. Ở giữa là center.
  let align = 'center';
  if (state.introXPercent < 35) align = 'left';
  else if (state.introXPercent > 65) align = 'right';

  // Hàm tạo chuỗi font chữ chuẩn hóa
  function buildFont(fontName, size, weight = 'bold', style = '') {
    const parts = [];
    if (style) parts.push(style);
    parts.push(weight);
    parts.push(`${size}px`);
    parts.push(`'${fontName}', sans-serif`);
    return parts.join(' ');
  }

  // 1. Lấy thông tin văn bản
  const titleText = state.textCase === 'uppercase' ? state.introTitle.toUpperCase() : state.introTitle;
  const baseTitleSize = state.introFontSize;
  
  // Tự động căn chỉnh kích thước nếu tiêu đề quá dài
  c.font = buildFont(fontName, baseTitleSize);
  let measuredTitleW = c.measureText(titleText).width;
  let fittedTitleSize = baseTitleSize;
  while (measuredTitleW > w * 0.85 && fittedTitleSize > 24) {
    fittedTitleSize -= 2;
    c.font = buildFont(fontName, fittedTitleSize);
    measuredTitleW = c.measureText(titleText).width;
  }

  c.textAlign = align;
  c.textBaseline = 'middle';

  // 2. Tính toán khoảng cách tọa độ Y động để tiêu đề chính và phụ đề KHÔNG bao giờ bị chồng đè lên nhau khi cỡ chữ to
  const subSize = Math.max(16, fittedTitleSize * 0.45);
  let titleY = centerY;
  let subY = centerY;

  if (state.introSubtitle) {
    const gap = fittedTitleSize * 0.22; // Khoảng cách giữa tiêu đề chính và nghệ sĩ tỷ lệ theo kích cỡ chữ (22% cỡ chữ)
    const totalHeight = fittedTitleSize + subSize + gap;
    
    // Đặt tâm của cả cụm chữ đúng vào centerY
    const startY = centerY - totalHeight / 2;
    titleY = startY + fittedTitleSize / 2;
    subY = startY + fittedTitleSize + gap + subSize / 2;
  }

  // 3. Vẽ Tiêu đề chính
  c.save();
  c.font = buildFont(fontName, fittedTitleSize);
  c.shadowColor = themeColors.primary;
  c.shadowBlur = 25;
  c.fillStyle = '#ffffff';
  c.fillText(titleText, centerX, titleY);
  c.restore();
  
  // 4. Vẽ Phụ đề / Nghệ sĩ
  if (state.introSubtitle) {
    c.save();
    c.shadowBlur = 0; // Tắt phát sáng ở phụ đề để dễ đọc và tương phản tốt
    const subText = state.introSubtitle;
    
    // Tự động căn chỉnh kích thước phụ đề
    c.font = buildFont(fontName, subSize, '600', 'italic');
    let measuredSubW = c.measureText(subText).width;
    let fittedSubSize = subSize;
    while (measuredSubW > w * 0.85 && fittedSubSize > 12) {
      fittedSubSize -= 1;
      c.font = buildFont(fontName, fittedSubSize, '600', 'italic');
      measuredSubW = c.measureText(subText).width;
    }

    c.fillStyle = 'rgba(255, 255, 255, 0.78)';
    c.fillText(subText, centerX, subY);
    c.restore();
  }

  c.restore();
}

function drawParticles(c, w, h) {
  if (!state.particlesEnabled) return;
  
  c.save();
  const theme = palettes[state.selectedColor] || palettes['neon-green'];
  c.fillStyle = theme.primary;
  
  for (let i = 0; i < canvasParticles.length; i++) {
    const p = canvasParticles[i];
    
    // Draw glowing particle
    c.globalAlpha = p.opacity;
    c.shadowColor = theme.primary;
    c.shadowBlur = p.size * 2;
    
    // Calculate animated horizontal wiggle using sine
    const horizontalWiggle = Math.sin(p.wiggleOffset + p.y * 10) * 15;
    const px = p.x * w + horizontalWiggle;
    const py = p.y * h;
    
    c.beginPath();
    c.arc(px, py, p.size, 0, Math.PI * 2);
    c.fill();
    
    // Update particle position (float upwards)
    p.y += p.speedY;
    p.x += p.speedX;
    
    // Recirculate particle if it drifts off screen
    if (p.y < -0.05) {
      p.y = 1.05;
      p.x = Math.random();
    }
    if (p.x < -0.05 || p.x > 1.05) {
      p.x = p.x < -0.05 ? 1.05 : -0.05;
    }
  }
  
  c.restore();
}

// ---- CÁC HIỆU ỨNG DỰNG VIDEO MỚI NÂNG CAO ----
const bokehParticles = [];
let audioCtx = null;
let analyser = null;
let dataArray = null;
let sourceNode = null;

function initAudioAnalyser() {
  if (analyser) return; 
  if (!state.wavesurfer) return;
  
  const audioEl = state.wavesurfer.media;
  if (!audioEl) return;

  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64; // Thiết lập số thanh phổ sóng nhạc gọn đẹp
    
    const bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);
    
    // Kết nối nguồn âm thanh tới bộ phân tích
    sourceNode = audioCtx.createMediaElementSource(audioEl);
    sourceNode.connect(analyser);
    analyser.connect(audioCtx.destination);
  } catch (err) {
    console.warn("Could not initialize real-time audio analyzer:", err);
  }
}

function initBokeh() {
  bokehParticles.length = 0;
  for (let i = 0; i < 12; i++) {
    bokehParticles.push({
      x: Math.random(),
      y: Math.random(),
      size: Math.random() * 100 + 60, // Đốm Bokeh tròn mờ lofi lớn
      speedX: Math.random() * 0.0006 - 0.0003,
      speedY: -(Math.random() * 0.0012 + 0.0004),
      opacity: Math.random() * 0.07 + 0.02, // Cực kỳ dịu nhẹ mờ ảo
      wiggleOffset: Math.random() * Math.PI * 2
    });
  }
}

function drawBokeh(c, w, h) {
  if (!state.bokehEnabled) return;
  
  c.save();
  const theme = palettes[state.selectedColor] || palettes['neon-green'];
  c.fillStyle = theme.primary;
  
  for (let i = 0; i < bokehParticles.length; i++) {
    const p = bokehParticles[i];
    
    // Tạo đốm sáng Bokeh mờ mịn
    c.globalAlpha = p.opacity;
    c.beginPath();
    c.arc(p.x * w, p.y * h, p.size, 0, Math.PI * 2);
    c.fill();
    
    // Cập nhật vị trí trôi nổi
    p.y += p.speedY;
    p.x += p.speedX;
    
    // Tuần hoàn hạt khi bay ra khỏi màn hình
    if (p.y < -0.15) {
      p.y = 1.15;
      p.x = Math.random();
    }
    if (p.x < -0.15 || p.x > 1.15) {
      p.x = p.x < -0.15 ? 1.15 : -0.15;
    }
  }
  
  c.restore();
}

function drawAudioSpectrum(c, w, h) {
  if (!state.spectrumEnabled) return;

  try {
    const themeColors = palettes[state.selectedColor] || palettes['neon-green'];
    c.save();
    
    // Thiết lập hiệu ứng phát sáng Neon cho sóng nhạc
    c.shadowColor = themeColors.primary;
    c.shadowBlur = 20;
    c.strokeStyle = themeColors.primary;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    
    const bottomY = h * 0.90; // Đặt ở gần góc dưới màn hình cực kỳ cân đối
    
    if (state.spectrumStyle === 'circle') {
      // ---- 1. KIỂU VÒNG TRÒN SÓNG (CIRCULAR SPECTRUM) ----
      c.lineWidth = 4;
      
      // Vẽ ôm xung quanh đĩa nhạc quay lofi ở giữa màn hình
      const centerX = w / 2;
      const centerY = h / 2;
      
      let baseRadius = 190;
      if (state.vinylEnabled) {
        const maxW = w * 0.48;
        const maxH = h * 0.72;
        const size = Math.min(maxW, maxH) * 0.95;
        baseRadius = size / 2 + 34; // Ôm khít viền đĩa than đen
      }

      const numPoints = 80;
      c.beginPath();
      
      if (analyser && dataArray && state.isPlaying) {
        analyser.getByteFrequencyData(dataArray);
        for (let i = 0; i <= numPoints; i++) {
          const angle = (i / numPoints) * Math.PI * 2;
          const dataIdx = Math.floor((i % numPoints) / numPoints * dataArray.length);
          const val = dataArray[dataIdx];
          const bounce = (val / 255) * 55; // nảy tối đa 55px
          
          const r = baseRadius + bounce;
          const x = centerX + Math.cos(angle) * r;
          const y = centerY + Math.sin(angle) * r;
          
          if (i === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
      } else {
        // Sóng tròn thở nhẹ nhịp nhàng khi nhạc dừng
        const pulseTime = Date.now() * 0.003;
        for (let i = 0; i <= numPoints; i++) {
          const angle = (i / numPoints) * Math.PI * 2;
          const pulse = Math.sin(pulseTime + angle * 4) * 8 + Math.cos(pulseTime * 0.5) * 5;
          
          const r = baseRadius + 5 + pulse;
          const x = centerX + Math.cos(angle) * r;
          const y = centerY + Math.sin(angle) * r;
          
          if (i === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
      }
      c.closePath();
      c.stroke();
      
    } else if (state.spectrumStyle === 'radial-bars') {
      // ---- 2. KIỂU VÒNG TRÒN THANH PHỔ (RADIAL BARS SPECTRUM) ----
      c.lineWidth = 4;
      const centerX = w / 2;
      const centerY = h / 2;
      
      let baseRadius = 190;
      if (state.vinylEnabled) {
        const maxW = w * 0.48;
        const maxH = h * 0.72;
        const size = Math.min(maxW, maxH) * 0.95;
        baseRadius = size / 2 + 34; // Ôm khít viền đĩa than đen
      }

      const numBars = 80;
      c.beginPath();
      
      if (analyser && dataArray && state.isPlaying) {
        analyser.getByteFrequencyData(dataArray);
        for (let i = 0; i < numBars; i++) {
          const angle = (i / numBars) * Math.PI * 2;
          const dataIdx = Math.floor((i % numBars) / numBars * dataArray.length);
          const val = dataArray[dataIdx];
          const barHeight = (val / 255) * 55; // vươn ra ngoài tối đa 55px
          
          const xStart = centerX + Math.cos(angle) * baseRadius;
          const yStart = centerY + Math.sin(angle) * baseRadius;
          const xEnd = centerX + Math.cos(angle) * (baseRadius + barHeight);
          const yEnd = centerY + Math.sin(angle) * (baseRadius + barHeight);
          
          c.moveTo(xStart, yStart);
          c.lineTo(xEnd, yEnd);
        }
      } else {
        // Các tia thở nhẹ chớp nháy khi dừng nhạc
        const pulseTime = Date.now() * 0.0035;
        for (let i = 0; i < numBars; i++) {
          const angle = (i / numBars) * Math.PI * 2;
          const pulse = Math.sin(pulseTime + i * 0.3) * 6 + Math.cos(pulseTime * 0.6) * 4;
          const barHeight = Math.max(2, 8 + pulse);
          
          const xStart = centerX + Math.cos(angle) * baseRadius;
          const yStart = centerY + Math.sin(angle) * baseRadius;
          const xEnd = centerX + Math.cos(angle) * (baseRadius + barHeight);
          const yEnd = centerY + Math.sin(angle) * (baseRadius + barHeight);
          
          c.moveTo(xStart, yStart);
          c.lineTo(xEnd, yEnd);
        }
      }
      c.stroke();
      
    } else if (state.spectrumStyle === 'wave') {
      // ---- 3. KIỂU ĐƯỜNG CONG SÓNG MỊN (SMOOTH WAVE) ----
      c.lineWidth = 5;
      const totalW = w * 0.65; 
      const startX = (w - totalW) / 2;
      const numPoints = 32;
      const step = totalW / (numPoints - 1);
      
      c.beginPath();
      
      if (analyser && dataArray && state.isPlaying) {
        analyser.getByteFrequencyData(dataArray);
        for (let i = 0; i < numPoints; i++) {
          const dataIdx = Math.floor((i / numPoints) * dataArray.length);
          const val = dataArray[dataIdx];
          const centerFactor = Math.sin((i / (numPoints - 1)) * Math.PI);
          const barHeight = (val / 255) * 90 * centerFactor;
          
          const x = startX + i * step;
          const y = bottomY - barHeight;
          
          if (i === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
      } else {
        // Sóng lượn hình sin trôi ngang thư giãn khi nhạc dừng
        const pulseTime = Date.now() * 0.004;
        for (let i = 0; i < numPoints; i++) {
          const centerFactor = Math.sin((i / (numPoints - 1)) * Math.PI);
          const wave = Math.sin(pulseTime + i * 0.3) * 15 * centerFactor;
          
          const x = startX + i * step;
          const y = bottomY - wave;
          
          if (i === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
      }
      c.stroke();
      
    } else if (state.spectrumStyle === 'double-wave') {
      // ---- 4. KIỂU SÓNG KÉP ĐỐI XỨNG (DOUBLE NEON WAVE) ----
      c.lineWidth = 4;
      const totalW = w * 0.65; 
      const startX = (w - totalW) / 2;
      const numPoints = 40;
      const step = totalW / (numPoints - 1);
      
      if (analyser && dataArray && state.isPlaying) {
        analyser.getByteFrequencyData(dataArray);
        
        // Sóng trên (uốn lên)
        c.beginPath();
        for (let i = 0; i < numPoints; i++) {
          const dataIdx = Math.floor((i / numPoints) * dataArray.length);
          const val = dataArray[dataIdx];
          const centerFactor = Math.sin((i / (numPoints - 1)) * Math.PI);
          const barHeight = (val / 255) * 85 * centerFactor;
          
          const x = startX + i * step;
          const y = bottomY - barHeight - 4;
          
          if (i === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
        c.stroke();
        
        // Sóng dưới (uốn xuống)
        c.beginPath();
        for (let i = 0; i < numPoints; i++) {
          const dataIdx = Math.floor(((numPoints - 1 - i) / numPoints) * dataArray.length);
          const val = dataArray[dataIdx];
          const centerFactor = Math.sin((i / (numPoints - 1)) * Math.PI);
          const barHeight = (val / 255) * 85 * centerFactor;
          
          const x = startX + i * step;
          const y = bottomY + barHeight + 4;
          
          if (i === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
        c.stroke();
      } else {
        // Sóng đối xứng trôi ngược pha khi nhạc dừng
        const pulseTime = Date.now() * 0.004;
        
        c.beginPath();
        for (let i = 0; i < numPoints; i++) {
          const centerFactor = Math.sin((i / (numPoints - 1)) * Math.PI);
          const wave = Math.sin(pulseTime + i * 0.25) * 14 * centerFactor;
          const x = startX + i * step;
          const y = bottomY - wave - 3;
          
          if (i === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
        c.stroke();
        
        c.beginPath();
        for (let i = 0; i < numPoints; i++) {
          const centerFactor = Math.sin((i / (numPoints - 1)) * Math.PI);
          const wave = Math.sin(pulseTime + i * 0.25 + Math.PI) * 14 * centerFactor; // ngược pha PI
          const x = startX + i * step;
          const y = bottomY - wave + 3;
          
          if (i === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
        c.stroke();
      }
      
    } else if (state.spectrumStyle === 'mirrored-bars') {
      // ---- 5. KIỂU THANH ĐỐI XỨNG LÊN XUỐNG (MIRRORED BARS) ----
      c.lineWidth = 5;
      const barWidth = 6;
      const gap = 12;
      
      if (analyser && dataArray && state.isPlaying) {
        analyser.getByteFrequencyData(dataArray);
        const numBars = Math.min(dataArray.length, 36);
        const totalW = numBars * (barWidth + gap) - gap;
        let startX = (w - totalW) / 2;
        
        c.beginPath();
        for (let i = 0; i < numBars; i++) {
          const value = dataArray[i];
          const barHeight = (value / 255) * 95;
          
          const x = startX + i * (barWidth + gap);
          c.moveTo(x, bottomY - barHeight);
          c.lineTo(x, bottomY + barHeight);
        }
        c.stroke();
      } else {
        const numBars = 36;
        const totalW = numBars * (barWidth + gap) - gap;
        let startX = (w - totalW) / 2;
        const pulseTime = Date.now() * 0.0035;
        
        c.beginPath();
        for (let i = 0; i < numBars; i++) {
          const distanceToCenter = Math.abs(i - numBars / 2);
          const centerFactor = Math.max(0, 1 - distanceToCenter / (numBars / 2));
          const simulatedValue = (Math.sin(pulseTime + i * 0.22) * 0.38 + 0.62) * 24 * centerFactor;
          
          const x = startX + i * (barWidth + gap);
          c.moveTo(x, bottomY - simulatedValue);
          c.lineTo(x, bottomY + simulatedValue);
        }
        c.stroke();
      }
      
    } else {
      // ---- 6. KIỂU THANH ĐỨNG TRUYỀN THỐNG (NEON BARS) ----
      c.lineWidth = 6;
      const barWidth = 6;
      const gap = 12;
      
      if (analyser && dataArray && state.isPlaying) {
        analyser.getByteFrequencyData(dataArray);
        const numBars = Math.min(dataArray.length, 36);
        const totalW = numBars * (barWidth + gap) - gap;
        let startX = (w - totalW) / 2;
        
        c.beginPath();
        for (let i = 0; i < numBars; i++) {
          const value = dataArray[i];
          const barHeight = (value / 255) * 110;
          
          const x = startX + i * (barWidth + gap);
          c.moveTo(x, bottomY - barHeight / 2);
          c.lineTo(x, bottomY + barHeight / 2);
        }
        c.stroke();
      } else {
        const numBars = 36;
        const totalW = numBars * (barWidth + gap) - gap;
        let startX = (w - totalW) / 2;
        const pulseTime = Date.now() * 0.0035;
        
        c.beginPath();
        for (let i = 0; i < numBars; i++) {
          const distanceToCenter = Math.abs(i - numBars / 2);
          const centerFactor = Math.max(0, 1 - distanceToCenter / (numBars / 2));
          const simulatedValue = (Math.sin(pulseTime + i * 0.22) * 0.38 + 0.62) * 28 * centerFactor;
          
          const x = startX + i * (barWidth + gap);
          c.moveTo(x, bottomY - simulatedValue);
          c.lineTo(x, bottomY + simulatedValue);
        }
        c.stroke();
      }
    }

    c.restore();
  } catch (err) {
    console.error("Error drawing audio spectrum:", err);
    try { c.restore(); } catch(_) {}
  }
}

function drawFilmGrain(c, w, h) {
  if (!state.filmGrainEnabled) return;
  
  c.save();
  
  // 1. Vẽ các hạt phim nhiễu nhỏ li ti (Grain)
  const grainOpacity = 0.04;
  c.fillStyle = `rgba(255, 255, 255, ${grainOpacity})`;
  for (let i = 0; i < 20; i++) {
    const gx = Math.random() * w;
    const gy = Math.random() * h;
    const gs = Math.random() * 2 + 1;
    c.fillRect(gx, gy, gs, gs);
  }
  
  // 2. Vẽ các đường xước màn hình dọc ngẫu nhiên (Scratches)
  if (Math.random() < 0.12) {
    c.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    c.lineWidth = Math.random() * 1.5 + 0.5;
    const sx = Math.random() * w;
    c.beginPath();
    c.moveTo(sx, 0);
    c.lineTo(sx, h);
    c.stroke();
  }
  
  // 3. Vẽ các vết bụi bẩn / sợi tóc bám thấu kính lofi ngẫu nhiên
  if (Math.random() < 0.08) {
    c.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    c.lineWidth = 1;
    const dx = Math.random() * w;
    const dy = Math.random() * h;
    const dl = Math.random() * 18 + 6;
    c.beginPath();
    c.moveTo(dx, dy);
    c.quadraticCurveTo(
      dx + Math.random() * 12 - 6, 
      dy + dl / 2, 
      dx + Math.random() * 12 - 6, 
      dy + dl
    );
    c.stroke();
  }
  
  c.restore();
}

function drawBackground(c, w, h) {
  c.save();

  let bgElement = null;
  let bgW = 0;
  let bgH = 0;

  if (state.bgType === 'video') {
    // During export, prefer the ImageBitmap snapshot (avoids tainted canvas in file:// mode)
    if (state._exportBgSnapshot) {
      bgElement = state._exportBgSnapshot;
      bgW = state._exportBgSnapshot.width;
      bgH = state._exportBgSnapshot.height;
    } else {
      const bgVideo = elements.bgVideo;
      if (bgVideo && bgVideo.videoWidth > 0 && (bgVideo.readyState >= 2 || state._isExportingFrames)) {
        bgElement = bgVideo;
        bgW = bgVideo.videoWidth;
        bgH = bgVideo.videoHeight;
      } else if (bgVideo) {
        if (!state._bgDebugCounter) state._bgDebugCounter = 0;
        state._bgDebugCounter++;
        if (state._bgDebugCounter % 120 === 1) {
          console.log('[drawBackground] Video not ready. readyState:', bgVideo.readyState, 'videoWidth:', bgVideo.videoWidth, 'videoHeight:', bgVideo.videoHeight, 'src:', bgVideo.src ? 'set' : 'empty', 'bgType:', state.bgType);
        }
      }
    }
  } else if (state.bgType === 'image' && state.bgImage) {
    bgElement = state.bgImage;
    bgW = state.bgImage.width;
    bgH = state.bgImage.height;
  }

  // Apply Ken Burns slow continuous zoom and panning
  if (state.kenBurnsEnabled && bgElement && state.bgMode !== 'gradient') {
    let currentTime = 0;
    if (state.wavesurfer) currentTime = state.wavesurfer.getCurrentTime();
    
    const kbScale = 1.0 + 0.08 * Math.sin(currentTime * 0.08);
    const kbDx = Math.sin(currentTime * 0.04) * 20;
    const kbDy = Math.cos(currentTime * 0.04) * 15;
    
    c.translate(w / 2, h / 2);
    c.scale(kbScale, kbScale);
    c.translate(-w / 2 + kbDx, -h / 2 + kbDy);
  }

  if (bgElement && state.bgMode !== 'gradient') {
    if (state.bgMode === 'fit-blur') {
      // 1. Premium blurred cover art fill background
      c.save();
      c.filter = 'blur(40px) brightness(0.6)'; // Increased brightness from 0.3 to 0.6 for vibrant background
      
      const imgRatio = bgW / bgH;
      const canvasRatio = w / h;
      let drawWidth, drawHeight, xOffset, yOffset;

      if (imgRatio > canvasRatio) {
        drawHeight = h;
        drawWidth = h * imgRatio;
        xOffset = (w - drawWidth) / 2;
        yOffset = 0;
      } else {
        drawWidth = w;
        drawHeight = w / imgRatio;
        xOffset = 0;
        yOffset = (h - drawHeight) / 2;
      }

      c.drawImage(bgElement, xOffset, yOffset, drawWidth, drawHeight);
      c.restore();

      // Dark radial gradient overlay for premium styling - softened for beautiful contrast
      const overlayGrad = c.createRadialGradient(w/2, h/2, 100, w/2, h/2, w/2 * 1.5);
      overlayGrad.addColorStop(0, `rgba(10, 11, 14, ${state.bgOpacity})`);
      overlayGrad.addColorStop(1, `rgba(6, 7, 9, ${Math.min(1.0, state.bgOpacity * 4.3)})`); // scale vignette overlay proportionally
      c.fillStyle = overlayGrad;
      c.fillRect(0, 0, w, h);

    } else if (state.bgMode === 'crop-fill') {
      // 2. Sharp crop fill to cover the entire canvas
      c.save();
      
      const imgRatio = bgW / bgH;
      const canvasRatio = w / h;
      let drawWidth, drawHeight, xOffset, yOffset;

      if (imgRatio > canvasRatio) {
        drawHeight = h;
        drawWidth = h * imgRatio;
        xOffset = (w - drawWidth) / 2;
        yOffset = 0;
      } else {
        drawWidth = w;
        drawHeight = w / imgRatio;
        xOffset = 0;
        yOffset = (h - drawHeight) / 2;
      }

      c.drawImage(bgElement, xOffset, yOffset, drawWidth, drawHeight);
      c.restore();

      // Slightly darker screen overlay to ensure high lyric readability - user controlled opacity 0% to 50%
      c.fillStyle = `rgba(10, 11, 14, ${state.bgOpacity})`;
      c.fillRect(0, 0, w, h);

    } else if (state.bgMode === 'fit-center') {
      // 3. Just draw a clean dark base background
      c.fillStyle = '#07080a';
      c.fillRect(0, 0, w, h);
      
      // Soft glow center
      const themeColors = palettes[state.selectedColor];
      const glowGrad = c.createRadialGradient(w/2, h/2, 50, w/2, h/2, 400);
      glowGrad.addColorStop(0, themeColors.glow);
      glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = glowGrad;
      c.fillRect(0, 0, w, h);
    }

  } else {
    // 4. Beautiful abstract dynamic colors based on color theme (Gradient Only)
    c.fillStyle = '#0a0b0e';
    c.fillRect(0, 0, w, h);

    const themeColors = palettes[state.selectedColor];
    
    c.save();
    c.globalCompositeOperation = 'screen';
    
    const glowGrad = c.createRadialGradient(w * 0.8, h * 0.2, 50, w * 0.8, h * 0.2, 500);
    glowGrad.addColorStop(0, themeColors.glow);
    glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = glowGrad;
    c.fillRect(0, 0, w, h);

    const glowGrad2 = c.createRadialGradient(w * 0.2, h * 0.8, 50, w * 0.2, h * 0.8, 500);
    glowGrad2.addColorStop(0, palettes[state.selectedColor].glow); // matching color glow
    glowGrad2.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = glowGrad2;
    c.fillRect(0, 0, w, h);

    c.restore();
  }

  c.restore();
}

function drawAlbumCover(c, w, h) {
  try {
    // Get active media element and dimensions
    let mediaElement = null;
    let mediaW = 0;
    let mediaH = 0;

    if (state.bgType === 'video') {
      const bgVideo = elements.bgVideo;
      if (bgVideo && bgVideo.videoWidth > 0) {
        mediaElement = bgVideo;
        mediaW = bgVideo.videoWidth;
        mediaH = bgVideo.videoHeight;
      }
    } else if (state.bgType === 'image' && state.bgImage) {
      mediaElement = state.bgImage;
      mediaW = state.bgImage.width;
      mediaH = state.bgImage.height;
    }

    // Nếu không có ảnh nền/video nền và không bật đĩa than, thoát sớm
    if (!mediaElement && !state.vinylEnabled) return;
    
    // Nếu không bật đĩa than và không ở chế độ Mờ viền/Vừa vặn, thoát sớm
    if (!state.vinylEnabled && state.bgMode !== 'fit-blur' && state.bgMode !== 'fit-center') return;

    c.save();

    // Apply premium soft floating drift animation
    let currentTime = 0;
    if (state.wavesurfer) currentTime = state.wavesurfer.getCurrentTime();

    if (state.kenBurnsEnabled && !state.vinylEnabled) {
      const floatY = Math.sin(currentTime * 0.12) * 8;
      const floatX = Math.cos(currentTime * 0.1) * 5;
      c.translate(floatX, floatY);
    }

    // Tỷ lệ ảnh, fallback sang 1.0 (vuông) nếu không có cover
    const mediaRatio = (mediaW && mediaH) ? (mediaW / mediaH) : 1.0;

    // Calculate display size: fit image/video inside canvas with padding, preserving aspect ratio
    const maxW = w * 0.48;  // max 48% of canvas width
    const maxH = h * 0.72;  // max 72% of canvas height
    
    let drawW, drawH;
    if (mediaRatio > maxW / maxH) {
      drawW = maxW;
      drawH = maxW / mediaRatio;
    } else {
      drawH = maxH;
      drawW = maxH * mediaRatio;
    }

    // Center coordinates of the album art
    const centerX = w / 2;
    const centerY = h / 2;

    if (state.vinylEnabled) {
      // ---- ĐĨA NHẠC QUAY LO-FI ----
      const size = Math.min(drawW, drawH) * 0.95;
      const radius = size / 2;
      const vinylR = radius + 32; // black vinyl edge

      // Float drift
      const floatY = Math.sin(currentTime * 0.08) * 6;
      const floatX = Math.cos(currentTime * 0.07) * 4;
      c.translate(centerX + floatX, centerY + floatY);

      // Rotation angle
      const rpm = 18; // 18 rounds per minute (very relaxing)
      const angle = (currentTime * rpm * 360 / 60) * Math.PI / 180;
      c.rotate(angle);

      // Draw shadow
      c.shadowColor = 'rgba(0, 0, 0, 0.65)';
      c.shadowBlur = 35;
      c.shadowOffsetY = 15;
      
      // Draw black vinyl disc
      c.fillStyle = '#0f0f11';
      c.beginPath();
      c.arc(0, 0, vinylR, 0, Math.PI * 2);
      c.fill();

      // Turn off shadow for detailed vinyl grooves
      c.shadowBlur = 0;
      c.shadowOffsetY = 0;

      // Draw light reflections on the black disc (ambient vinyl grooves)
      c.strokeStyle = 'rgba(255, 255, 255, 0.035)';
      c.lineWidth = 1.2;
      for (let r = radius + 4; r < vinylR - 4; r += 6) {
        c.beginPath();
        c.arc(0, 0, r, 0, Math.PI * 2);
        c.stroke();
      }

      // Draw vinyl record paper label background
      c.fillStyle = '#000000';
      c.beginPath();
      c.arc(0, 0, radius, 0, Math.PI * 2);
      c.fill();

      // Draw clipped rotating album cover
      c.save();
      c.beginPath();
      c.arc(0, 0, radius, 0, Math.PI * 2);
      c.clip();
      if (mediaElement) {
        c.drawImage(mediaElement, -radius, -radius, size, size);
      } else {
        // Ảnh bìa mặc định nghệ thuật khi người dùng không chọn ảnh nền
        const themeColors = palettes[state.selectedColor] || palettes['neon-green'];
        const defaultGrad = c.createRadialGradient(0, 0, 5, 0, 0, radius);
        defaultGrad.addColorStop(0, '#ffffff');
        defaultGrad.addColorStop(0.3, themeColors.primary);
        defaultGrad.addColorStop(0.7, themeColors.secondary);
        defaultGrad.addColorStop(1, '#0b0c10');
        c.fillStyle = defaultGrad;
        c.fill();

        // Vẽ một biểu tượng âm nhạc phát sáng ở trung tâm
        c.shadowColor = themeColors.primary;
        c.shadowBlur = 20;
        c.fillStyle = '#ffffff';
        c.font = "900 80px 'Font Awesome 6 Free'";
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('\uf001', 0, 0); // Ký tự Music FontAwesome
      }
      c.restore();

      // Draw center spindle hole (metallic/plastic hub)
      c.fillStyle = '#1e1f22';
      c.beginPath();
      c.arc(0, 0, 16, 0, Math.PI * 2);
      c.fill();

      c.fillStyle = '#070809';
      c.beginPath();
      c.arc(0, 0, 6, 0, Math.PI * 2);
      c.fill();

    } else if (mediaElement) {
      // ---- ẢNH BÌA TĨNH GÓC BO TRÒN TRUYỀN THỐNG ----
      const x = centerX - drawW / 2;
      const y = centerY - drawH / 2;

      // Draw shadow
      c.shadowColor = 'rgba(0, 0, 0, 0.75)';
      c.shadowBlur = 40;
      c.shadowOffsetX = 0;
      c.shadowOffsetY = 12;

      // Draw rounded rectangle clipping path
      const radius = 16;
      c.beginPath();
      c.moveTo(x + radius, y);
      c.lineTo(x + drawW - radius, y);
      c.quadraticCurveTo(x + drawW, y, x + drawW, y + radius);
      c.lineTo(x + drawW, y + drawH - radius);
      c.quadraticCurveTo(x + drawW, y + drawH, x + drawW - radius, y + drawH);
      c.lineTo(x + radius, y + drawH);
      c.quadraticCurveTo(x, y + drawH, x, y + drawH - radius);
      c.lineTo(x, y + radius);
      c.quadraticCurveTo(x, y, x + radius, y);
      c.closePath();
      c.clip();

      // Draw the media at its natural aspect ratio
      c.drawImage(mediaElement, x, y, drawW, drawH);
    }

    c.restore();
  } catch (err) {
    console.error("Error drawing album cover card:", err);
    try { c.restore(); } catch(_) {}
  }
}

function drawLyrics(c, w, h, currentTime) {
  // Font weight/style mapping for each font family (optimized rendering)
  const fontConfigs = {
    'Inter':             { weight: '700',  style: '', fallback: 'sans-serif' },
    'Montserrat':        { weight: '800',  style: '', fallback: 'sans-serif' },
    'Bebas Neue':        { weight: '400',  style: '', fallback: 'sans-serif', letterSpacing: 3 },
    'Oswald':            { weight: '700',  style: '', fallback: 'sans-serif' },
    'Playfair Display':  { weight: '700',  style: 'italic', fallback: 'serif' },
    'Dancing Script':    { weight: '700',  style: '', fallback: 'cursive' }
  };

  // Helper: Build optimized font string
  function buildFont(fontName, size) {
    const cfg = fontConfigs[fontName] || { weight: '600', style: '', fallback: 'sans-serif' };
    const parts = [];
    if (cfg.style) parts.push(cfg.style);
    parts.push(cfg.weight);
    parts.push(`${size}px`);
    parts.push(`'${fontName}', ${cfg.fallback}`);
    return parts.join(' ');
  }

  // Helper: Auto-fit text size so it never overflows canvas width
  function autoFitSize(text, baseSize, maxWidth) {
    let size = baseSize;
    c.font = buildFont(state.selectedFont, size);
    let measured = c.measureText(text).width;
    while (measured > maxWidth && size > 16) {
      size -= 2;
      c.font = buildFont(state.selectedFont, size);
      measured = c.measureText(text).width;
    }
    return size;
  }

  // Helper: Draw text with outline stroke for readability
  function drawTextWithOutline(text, x, y, fillColor, strokeColor, strokeWidth) {
    if (strokeWidth > 0) {
      c.strokeStyle = strokeColor;
      c.lineWidth = strokeWidth;
      c.lineJoin = 'round';
      c.miterLimit = 2;
      c.strokeText(text, x, y);
    }
    c.fillStyle = fillColor;
    c.fillText(text, x, y);
  }

  function drawActiveLineText(c, line, progress, currentTime, theme, fontName, fittedSize, outlineWidth, maxTextWidth) {
    const textStr = state.textCase === 'uppercase' ? line.text.toUpperCase() : line.text;
    
    if (currentTime < line.start) {
      drawTextWithOutline(textStr, 0, 0, theme.muted, 'rgba(0, 0, 0, 0.5)', outlineWidth);
      return;
    }
    
    if (state.selectedEffect === 'karaoke') {
      const totalWidth = c.measureText(textStr).width;
      const xStart = -totalWidth / 2;
      drawTextWithOutline(textStr, 0, 0, theme.muted, 'rgba(0, 0, 0, 0.5)', outlineWidth);
      
      c.save();
      c.beginPath();
      const sweepWidth = totalWidth * progress;
      c.rect(xStart, -fittedSize * 1.5, sweepWidth, fittedSize * 3);
      c.clip();
      
      c.shadowColor = theme.primary;
      c.shadowBlur = 15;
      drawTextWithOutline(textStr, 0, 0, theme.primary, 'rgba(0, 0, 0, 0.3)', outlineWidth * 0.5);
      c.restore();
      
    } else if (state.selectedEffect === 'word') {
      // --- KINETIC TYPOGRAPHY (CHỮ CHẠY TỪNG TỪ) ---
      const words = textStr.split(' ');
      if (words.length === 0) return;
      
      const activeWordIdx = Math.floor(progress * words.length);
      const wordWidths = words.map(w => c.measureText(w).width);
      const spaceWidth = c.measureText(' ').width;
      const totalWidth = wordWidths.reduce((a, b) => a + b, 0) + spaceWidth * (words.length - 1);
      
      let currentX = -totalWidth / 2;
      
      words.forEach((word, idx) => {
        c.save();
        let scale = 1.0;
        let opacity = 1.0;
        let wordColor = '#ffffff';
        
        if (idx < activeWordIdx) {
          wordColor = theme.primary;
          opacity = 1.0;
        } else if (idx === activeWordIdx) {
          wordColor = '#ffffff';
          scale = 1.15; // Bounce active word
          opacity = 1.0;
          c.shadowColor = theme.primary;
          c.shadowBlur = 15;
        } else {
          wordColor = 'rgba(255, 255, 255, 0.15)';
          opacity = 0.25;
        }
        
        c.globalAlpha = opacity;
        c.translate(currentX + wordWidths[idx] / 2, 0);
        c.scale(scale, scale);
        
        drawTextWithOutline(word, 0, 0, wordColor, 'rgba(0, 0, 0, 0.6)', outlineWidth);
        c.restore();
        
        currentX += wordWidths[idx] + spaceWidth;
      });
      
    } else if (state.selectedEffect === 'typewriter') {
      // --- TYPEWRITER (GÕ MÁY CHỮ) ---
      const charsCount = Math.floor(progress * textStr.length);
      let visibleText = textStr.substring(0, charsCount);
      const cursor = (Math.floor(currentTime * 5) % 2 === 0 && progress < 0.98) ? '|' : '';
      const textWidth = c.measureText(visibleText).width;
      
      drawTextWithOutline(visibleText, 0, 0, '#ffffff', 'rgba(0, 0, 0, 0.6)', outlineWidth);
      
      if (cursor) {
        c.save();
        c.fillStyle = theme.primary;
        c.shadowColor = theme.primary;
        c.shadowBlur = 12;
        c.fillText(cursor, textWidth / 2 + 5, 0);
        c.restore();
      }
      
    } else if (state.selectedEffect === 'shake') {
      // --- RAP/EDM TEXT SHAKE (RUNG LẮC GLITCH) ---
      const beatProgress = (currentTime % 0.35) / 0.35;
      const kick = Math.max(0, Math.sin(beatProgress * Math.PI) * 0.15);
      const shakeX = (Math.random() - 0.5) * 8 * kick;
      const shakeY = (Math.random() - 0.5) * 8 * kick;
      
      // Glitch Layer 1 (Cyan shift)
      c.save();
      c.translate(shakeX - 3, shakeY - 2);
      drawTextWithOutline(textStr, 0, 0, '#00ffff', 'rgba(0, 0, 0, 0)', outlineWidth);
      c.restore();
      
      // Glitch Layer 2 (Magenta shift)
      c.save();
      c.translate(shakeX + 3, shakeY + 2);
      drawTextWithOutline(textStr, 0, 0, '#ff0055', 'rgba(0, 0, 0, 0)', outlineWidth);
      c.restore();
      
      // Main Layer
      c.save();
      c.translate(shakeX, shakeY);
      c.scale(1.0 + kick * 0.3, 1.0 + kick * 0.3);
      c.shadowColor = theme.primary;
      c.shadowBlur = 15;
      drawTextWithOutline(textStr, 0, 0, '#ffffff', 'rgba(0, 0, 0, 0.8)', outlineWidth);
      c.restore();
      
    } else if (state.selectedEffect === 'gradient') {
      // --- COLOR GRADIENT / GLOW (ĐỔI MÀU CHỮ) ---
      const totalWidth = c.measureText(textStr).width;
      const hue1 = (currentTime * 80) % 360;
      const hue2 = (hue1 + 120) % 360;
      const grad = c.createLinearGradient(-totalWidth / 2, 0, totalWidth / 2, 0);
      grad.addColorStop(0, `hsl(${hue1}, 100%, 65%)`);
      grad.addColorStop(0.5, `hsl(${(hue1 + 60) % 360}, 100%, 75%)`);
      grad.addColorStop(1, `hsl(${hue2}, 100%, 65%)`);
      
      c.save();
      c.shadowColor = `hsl(${hue1}, 100%, 60%)`;
      c.shadowBlur = 20 + 8 * Math.sin(currentTime * 4);
      drawTextWithOutline(textStr, 0, 0, grad, 'rgba(0, 0, 0, 0.65)', outlineWidth);
      c.restore();
      
    } else if (state.selectedEffect === 'fade') {
      // --- FADE IN/OUT BASE ---
      drawTextWithOutline(textStr, 0, 0, '#ffffff', 'rgba(0, 0, 0, 0.6)', outlineWidth);
    } else if (state.selectedEffect === 'subtitle') {
      // --- STATIC SUBTITLE (CRISP WHITE WITH HEAVY OUTLINE) ---
      drawTextWithOutline(textStr, 0, 0, '#ffffff', 'rgba(0, 0, 0, 0.95)', outlineWidth);
    } else {
      drawTextWithOutline(textStr, 0, 0, theme.primary, 'rgba(0, 0, 0, 0.6)', outlineWidth);
    }
  }

  if (state.lyrics.length === 0) {
    return;
  }

  // Active line detection
  let activeIdx = -1;
  for (let i = 0; i < state.lyrics.length; i++) {
    const l = state.lyrics[i];
    if (currentTime >= l.start && currentTime <= l.end) {
      activeIdx = i;
      break;
    }
  }

  // Pre-show check (skip if static subtitle effect is selected)
  if (activeIdx === -1 && state.selectedEffect !== 'subtitle') {
    for (let i = 0; i < state.lyrics.length; i++) {
      const l = state.lyrics[i];
      if (currentTime < l.start && (currentTime >= l.start - state.preshowDelay)) {
        activeIdx = i;
        break;
      }
    }
  }

  // Text positioning
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const textX = w / 2;
  const textY = h * (state.lyricYPercent / 100);
  const maxTextWidth = w * 0.88; // 88% of canvas width max

  // Apple Music/Spotify Style Full Scrolling Lyrics Mode
  if (state.lyricMode === 'scrolling') {
    let targetScrollY = activeIdx;
    
    // Find active or upcoming index
    if (activeIdx === -1) {
      let nextIdx = -1;
      for (let i = 0; i < state.lyrics.length; i++) {
        if (currentTime < state.lyrics[i].start) { nextIdx = i; break; }
      }
      targetScrollY = nextIdx !== -1 ? nextIdx : 0;
    }
    
    if (state.currentScrollY === undefined) {
      state.currentScrollY = targetScrollY;
    }
    
    // Smooth damp vertical scroll
    state.currentScrollY += (targetScrollY - state.currentScrollY) * 0.12;
    
    const theme = palettes[state.selectedColor] || palettes['neon-green'];
    const fontName = state.selectedFont;
    const lineSpacing = state.fontSize * 1.5;
    
    for (let i = 0; i < state.lyrics.length; i++) {
      const line = state.lyrics[i];
      const lineY = textY + (i - state.currentScrollY) * lineSpacing;
      
      // Out of bounds clip
      if (lineY < -50 || lineY > h + 50) continue;
      
      const distance = Math.abs(i - state.currentScrollY);
      c.save();
      
      let opacity = 1.0;
      let scale = 1.0;
      let isLineActive = (i === activeIdx);
      
      if (isLineActive) {
        opacity = 1.0;
        scale = 1.02;
        c.shadowColor = theme.primary;
        c.shadowBlur = 18;
      } else {
        opacity = Math.max(0.12, 1.0 - distance * 0.28);
        scale = Math.max(0.85, 1.0 - distance * 0.04);
        c.shadowColor = 'rgba(0, 0, 0, 0.7)';
        c.shadowBlur = 4;
      }
      
      c.globalAlpha = opacity;
      c.translate(textX, lineY);
      c.scale(scale, scale);
      
      const lineText = state.textCase === 'uppercase' ? line.text.toUpperCase() : line.text;
      const fittedSize = autoFitSize(lineText, state.fontSize * (isLineActive ? 1.0 : 0.85), maxTextWidth);
      c.font = buildFont(fontName, fittedSize);
      
      const outlineWidth = Math.max(2, fittedSize * 0.04);
      
      if (isLineActive && currentTime >= line.start) {
        const duration = line.end - line.start;
        const progress = Math.min(Math.max((currentTime - line.start) / duration, 0), 1);
        drawActiveLineText(c, line, progress, currentTime, theme, fontName, fittedSize, outlineWidth, maxTextWidth);
      } else {
        const fillColor = isLineActive ? theme.primary : 'rgba(255, 255, 255, 0.4)';
        drawTextWithOutline(lineText, 0, 0, fillColor, 'rgba(0, 0, 0, 0.6)', outlineWidth);
      }
      
      c.restore();
    }
    return;
  }

  if (activeIdx !== -1) {
    const activeLine = state.lyrics[activeIdx];
    const duration = activeLine.end - activeLine.start;
    const progress = Math.min(Math.max((currentTime - activeLine.start) / duration, 0), 1);
    const theme = palettes[state.selectedColor];
    const fontName = state.selectedFont;

    // Auto-fit the font size for this line
    const activeLineText = state.textCase === 'uppercase' ? activeLine.text.toUpperCase() : activeLine.text;
    const fittedSize = autoFitSize(activeLineText, state.fontSize, maxTextWidth);
    c.font = buildFont(fontName, fittedSize);

    // ---- ACTIVE LYRIC LINE ----
    c.save();

    // Effect calculations
    let opacity = 1.0;
    let scale = 1.0;
    let yOffset = 0;
    let blurAmount = 0;
    const fadeWindow = 0.4;

    if (state.selectedEffect === 'subtitle') {
      // Static subtitle: pop-in, pop-out, no fade, no scale
      opacity = (currentTime >= activeLine.start && currentTime <= activeLine.end) ? 1.0 : 0.0;
      scale = 1.0;
    } else {
      // Fade-in
      if (state.selectedEffect !== 'typewriter') {
        if (currentTime < activeLine.start) {
          const preProgress = (currentTime - (activeLine.start - state.preshowDelay)) / state.preshowDelay;
          opacity = Math.max(0.2, preProgress);
        } else if (currentTime < activeLine.start + fadeWindow) {
          opacity = (currentTime - activeLine.start) / fadeWindow;
        }
      } else {
        if (currentTime < activeLine.start) {
          opacity = 0.4;
        }
      }

      // Fade-out
      if (currentTime > activeLine.end - fadeWindow) {
        opacity = Math.max(0, (activeLine.end - currentTime) / fadeWindow);
      }
    }

    // Effect-specific overrides
    if (state.selectedEffect === 'subtitle') {
      scale = 1.0;
    } else if (state.selectedEffect === 'fade') {
      blurAmount = (1 - opacity) * 8;
      if (blurAmount > 0.3) {
        c.filter = `blur(${blurAmount}px)`;
      }
    } else if (state.selectedEffect === 'word') {
      scale = 1.0;
    } else if (state.selectedEffect === 'shake') {
      scale = 1.0;
    } else {
      scale = (currentTime >= activeLine.start && currentTime <= activeLine.end)
        ? 0.97 + (0.06 * progress) : 0.97;
    }

    c.globalAlpha = opacity;
    c.translate(textX, textY + yOffset);
    c.scale(scale, scale);

    const outlineWidth = Math.max(2, fittedSize * 0.05); // Dynamic outline thickness

    drawActiveLineText(c, activeLine, progress, currentTime, theme, fontName, fittedSize, outlineWidth, maxTextWidth);

    c.restore();

    // ---- NEXT LINE SUBTITLE ----
    if (state.showSubtitle && activeIdx + 1 < state.lyrics.length) {
      const nextLine = state.lyrics[activeIdx + 1];
      c.save();

      const nextText = state.textCase === 'uppercase' ? nextLine.text.toUpperCase() : nextLine.text;
      const subSize = autoFitSize(nextText, fittedSize * 0.6, maxTextWidth);
      c.font = buildFont(fontName, subSize);
      
      c.shadowColor = 'rgba(0, 0, 0, 0.7)';
      c.shadowBlur = 6;
      
      const nextY = textY + fittedSize * 1.2;
      drawTextWithOutline(nextText, textX, nextY, 'rgba(255, 255, 255, 0.3)', 'rgba(0, 0, 0, 0.4)', Math.max(1, subSize * 0.04));
      c.restore();
    }

  } else {
    // Instrumental break: show upcoming line faded
    let nextIdx = -1;
    for (let i = 0; i < state.lyrics.length; i++) {
      if (currentTime < state.lyrics[i].start) { nextIdx = i; break; }
    }

    if (nextIdx !== -1) {
      const upcomingLine = state.lyrics[nextIdx];
      c.save();
      const upcomingText = state.textCase === 'uppercase' ? upcomingLine.text.toUpperCase() : upcomingLine.text;
      const waitSize = autoFitSize(upcomingText, state.fontSize * 0.75, maxTextWidth);
      c.font = buildFont(state.selectedFont, waitSize);
      c.shadowColor = 'rgba(0, 0, 0, 0.6)';
      c.shadowBlur = 8;
      drawTextWithOutline(upcomingText, textX, textY, 'rgba(255, 255, 255, 0.18)', 'rgba(0, 0, 0, 0.3)', Math.max(1, waitSize * 0.04));
      c.restore();
    }
  }
}

function drawExportProgress(c, w, h, currentTime) {
  // Simple thin loading line at the very bottom
  const percent = currentTime / state.audioDuration;
  c.fillStyle = palettes[state.selectedColor].primary;
  c.fillRect(0, h - 8, w * percent, 8);
  
  // Export status text overlay top left
  c.save();
  c.font = "bold 20px 'Inter', sans-serif";
  c.fillStyle = "rgba(10, 11, 14, 0.85)";
  c.fillRect(10, 10, 320, 40);
  
  c.fillStyle = "#fff";
  c.textAlign = "left";
  c.textBaseline = "middle";
  c.fillText(`🔴 ĐANG XUẤT VIDEO: ${Math.round(percent * 100)}%`, 20, 30);
  c.restore();
}

// ============================================================
// FAST VIDEO EXPORTER (WebCodecs + webm-muxer — 5-20x faster)
// ============================================================
async function startFastExport(format = 'webm') {
  // Feature detection — fallback to real-time if WebCodecs not available
  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    showToast('WebCodecs không khả dụng. Dùng chế độ xuất chuẩn...', 'info');
    return startExport(format);
  }

  if (!state.audioFile || !state.wavesurfer) {
    showToast('Vui lòng chọn tệp âm thanh trước khi xuất video!', 'error');
    return;
  }
  if (state.lyrics.length === 0) {
    showToast('Chưa có lyrics để xuất video!', 'error');
    return;
  }
  if (state.isExporting) {
    showToast('Tiến trình xuất video đang diễn ra...', 'info');
    return;
  }

  // Resolution & bitrate
  const originalWidth = elements.previewCanvas.width;
  const originalHeight = elements.previewCanvas.height;
  let exportW = 1280, exportH = 720, bitrate = 5000000;

  if (state.exportQuality === 'fast') {
    bitrate = 2000000;
    if (state.aspectRatio === '16-9') { exportW = 854; exportH = 480; }
    else if (state.aspectRatio === '9-16') { exportW = 480; exportH = 854; }
    else { exportW = 480; exportH = 480; }
  } else if (state.exportQuality === 'high') {
    bitrate = 8000000;
    if (state.aspectRatio === '16-9') { exportW = 1920; exportH = 1080; }
    else if (state.aspectRatio === '9-16') { exportW = 1080; exportH = 1920; }
    else { exportW = 1080; exportH = 1080; }
  } else {
    bitrate = 5000000;
    if (state.aspectRatio === '16-9') { exportW = 1280; exportH = 720; }
    else if (state.aspectRatio === '9-16') { exportW = 720; exportH = 1280; }
    else { exportW = 720; exportH = 720; }
  }

  // Use 30fps for fast export (good balance of speed vs quality)
  const fps = Math.min(state.exportFps, 30);
  const duration = state.audioDuration;
  const totalFrames = Math.ceil(duration * fps);

  // UI setup
  state.isExporting = true;
  elements.btnPlayPause.setAttribute('disabled', 'true');
  elements.btnExportWebM.setAttribute('disabled', 'true');
  elements.btnExportMP4.setAttribute('disabled', 'true');
  state.wavesurfer.pause();
  state.wavesurfer.setTime(0);

  elements.processingOverlay.classList.add('active');
  elements.processingText.innerHTML = `
    <div style="font-size: 1.1rem; font-weight: bold; margin-bottom: 6px;">⚡ XUẤT NHANH (${exportW}x${exportH} @${fps}fps)</div>
    <div style="font-size: 0.8rem; opacity: 0.7; margin-bottom: 10px;">Đang dùng WebCodecs — nhanh hơn 5-20x so với chuẩn</div>
    <div style="font-size: 0.75rem; color: var(--accent-color);" id="exportProgressDisplay">Đang khởi tạo encoder...</div>
  `;

  // Set canvas to export resolution
  elements.previewCanvas.width = exportW;
  elements.previewCanvas.height = exportH;

  // Pause the normal rAF render loop so it doesn't interfere
  state.exportPauseRaf = true;

  const startTime = performance.now();

  try {
    // ═══ FORMAT-AWARE MUXER SETUP ═══
    const isMp4 = (format === 'mp4');
    let MuxerLib, target, muxer;

    if (isMp4) {
      // Load mp4-muxer for real MP4 (H.264 + AAC)
      try {
        MuxerLib = await import('https://cdn.jsdelivr.net/npm/mp4-muxer@5/+esm');
      } catch (e) {
        try {
          MuxerLib = await import('https://unpkg.com/mp4-muxer@5/dist/mp4-muxer.mjs');
        } catch (e2) {
          showToast('Không tải được mp4-muxer. Dùng WebM thay thế...', 'info');
          return startFastExport('webm'); // fallback to webm
        }
      }
      target = new MuxerLib.ArrayBufferTarget();
      muxer = new MuxerLib.Muxer({
        target,
        video: {
          codec: 'avc',
          width: exportW,
          height: exportH,
        },
        audio: {
          codec: 'aac',
          sampleRate: 48000,
          numberOfChannels: 2,
        },
        fastStart: 'in-memory',
        firstTimestampBehavior: 'offset',
      });
    } else {
      // Load webm-muxer for WebM (VP9 + Opus)
      try {
        MuxerLib = await import('https://cdn.jsdelivr.net/npm/webm-muxer@5/+esm');
      } catch (e) {
        try {
          MuxerLib = await import('https://unpkg.com/webm-muxer@5/dist/webm-muxer.mjs');
        } catch (e2) {
          showToast('Không tải được webm-muxer. Dùng chế độ chuẩn...', 'info');
          elements.previewCanvas.width = originalWidth;
          elements.previewCanvas.height = originalHeight;
          state.isExporting = false;
          state.exportPauseRaf = false;
          elements.btnPlayPause.removeAttribute('disabled');
          elements.btnExportWebM.removeAttribute('disabled');
          elements.btnExportMP4.removeAttribute('disabled');
          elements.processingOverlay.classList.remove('active');
          return startExport(format);
        }
      }
      target = new MuxerLib.ArrayBufferTarget();
      muxer = new MuxerLib.Muxer({
        target,
        video: {
          codec: 'V_VP9',
          width: exportW,
          height: exportH,
        },
        audio: {
          codec: 'A_OPUS',
          sampleRate: 48000,
          numberOfChannels: 2,
        },
        firstTimestampBehavior: 'offset',
      });
    }

    // ═══ VIDEO ENCODER ═══
    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => console.error('VideoEncoder error:', e),
    });

    let videoCodec;
    if (isMp4) {
      // H.264 for MP4
      videoCodec = 'avc1.640028'; // High Profile Level 4.0
      const h264Support = await VideoEncoder.isConfigSupported({
        codec: videoCodec, width: exportW, height: exportH, bitrate, framerate: fps,
      });
      if (!h264Support.supported) {
        videoCodec = 'avc1.42001f'; // Baseline fallback
      }
    } else {
      // VP9 for WebM
      videoCodec = 'vp09.00.10.08';
      const vp9Support = await VideoEncoder.isConfigSupported({
        codec: videoCodec, width: exportW, height: exportH, bitrate, framerate: fps,
      });
      if (!vp9Support.supported) {
        videoCodec = 'vp8';
      }
    }

    videoEncoder.configure({
      codec: videoCodec,
      width: exportW,
      height: exportH,
      bitrate: bitrate,
      framerate: fps,
    });

    // ═══ AUDIO ENCODER ═══
    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => console.error('AudioEncoder error:', e),
    });

    if (isMp4) {
      audioEncoder.configure({
        codec: 'mp4a.40.2', // AAC-LC
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 128000,
      });
    } else {
      audioEncoder.configure({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 128000,
      });
    }

    // 5. Decode and encode audio
    const progressEl = document.getElementById('exportProgressDisplay');
    if (progressEl) progressEl.innerText = 'Đang xử lý audio...';

    const audioCtx = new OfflineAudioContext(2, Math.ceil(48000 * duration), 48000);
    const audioArrayBuffer = await state.audioFile.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(audioArrayBuffer);

    // Encode audio in 1-second chunks
    const audioChunkFrames = 48000; // 1 second
    for (let offset = 0; offset < audioBuffer.length; offset += audioChunkFrames) {
      const length = Math.min(audioChunkFrames, audioBuffer.length - offset);
      const numChannels = Math.min(audioBuffer.numberOfChannels, 2);
      
      // Interleave audio data for f32-planar format
      const planarData = new Float32Array(length * numChannels);
      for (let ch = 0; ch < numChannels; ch++) {
        const channelData = audioBuffer.getChannelData(ch);
        planarData.set(channelData.subarray(offset, offset + length), ch * length);
      }

      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate: 48000,
        numberOfFrames: length,
        numberOfChannels: numChannels,
        timestamp: Math.round((offset / 48000) * 1_000_000),
        data: planarData,
      });
      audioEncoder.encode(audioData);
      audioData.close();
    }

    // 6. Override getCurrentTime for manual frame rendering
    const origGetTime = state.wavesurfer.getCurrentTime.bind(state.wavesurfer);
    let fakeTime = 0;
    state.wavesurfer.getCurrentTime = () => fakeTime;

    // 7. Render video frames — FAST (no real-time constraint!)
    const keyFrameEvery = Math.round(fps * 2); // Keyframe every 2 seconds
    
    if (progressEl) progressEl.innerText = 'Đang render video frames...';

    // Pre-warm video for export: ensure bgVideo is fully loaded and seekable
    if (state.bgType === 'video' && elements.bgVideo && elements.bgVideo.src) {
      const bv = elements.bgVideo;
      console.log('[FastExport] Pre-warm bgVideo:', 'readyState:', bv.readyState, 'videoWidth:', bv.videoWidth, 'duration:', bv.duration);
      bv.pause();
      if (bv.readyState < 2) {
        await new Promise(resolve => {
          const onReady = () => { bv.removeEventListener('canplay', onReady); resolve(); };
          bv.addEventListener('canplay', onReady);
          setTimeout(resolve, 3000);
        });
      }
      if (bv.readyState >= 2) {
        bv.currentTime = 0.01;
        await new Promise(resolve => {
          bv.addEventListener('seeked', resolve, { once: true });
          setTimeout(resolve, 1000);
        });
      }
      console.log('[FastExport] bgVideo ready:', 'readyState:', bv.readyState, 'videoWidth:', bv.videoWidth);
    }

    // ═══ SNAPSHOT APPROACH: capture bgVideo frames as ImageBitmap to avoid tainted canvas ═══
    // In file:// mode (EXE), drawing <video> directly to canvas can taint it.
    // By using createImageBitmap, we get a clean source that won't taint.
    let _bgVideoSnapshot = null;

    state._isExportingFrames = true;

    for (let i = 0; i < totalFrames; i++) {
      fakeTime = i / fps;

      // Seek bgVideo and capture snapshot
      if (state.bgType === 'video' && elements.bgVideo && elements.bgVideo.videoWidth > 0) {
        const targetTime = fakeTime % (elements.bgVideo.duration || 1);
        if (Math.abs(elements.bgVideo.currentTime - targetTime) > 0.01) {
          await new Promise(resolve => {
            const onSeeked = () => {
              elements.bgVideo.removeEventListener('seeked', onSeeked);
              resolve();
            };
            elements.bgVideo.addEventListener('seeked', onSeeked);
            elements.bgVideo.currentTime = targetTime;
            setTimeout(resolve, 200);
          });
        }
        // Capture video frame as ImageBitmap (avoids tainted canvas in file:// mode)
        try {
          if (_bgVideoSnapshot) _bgVideoSnapshot.close();
          _bgVideoSnapshot = await createImageBitmap(elements.bgVideo);
          // Temporarily replace bgImage for drawBackground to use
          state._exportBgSnapshot = _bgVideoSnapshot;
        } catch (e) {
          // createImageBitmap failed — video might not be decoded at this frame
          if (i === 0) console.warn('[FastExport] createImageBitmap failed:', e.message);
        }
      }

      // Render one frame at this time
      renderCanvasAtTime(fakeTime);

      // Encode the frame
      const frame = new VideoFrame(elements.previewCanvas, {
        timestamp: Math.round(fakeTime * 1_000_000),
      });
      const isKeyFrame = (i % keyFrameEvery === 0);
      videoEncoder.encode(frame, { keyFrame: isKeyFrame });
      frame.close();

      // Backpressure: wait if encoder queue is too full (prevents crash)
      while (videoEncoder.encodeQueueSize > 5) {
        await new Promise(r => setTimeout(r, 10));
      }

      // Update progress + yield to UI every 5 frames
      if (i % 5 === 0) {
        const pct = Math.round((i / totalFrames) * 100);
        const elapsedSec = ((performance.now() - startTime) / 1000).toFixed(1);
        const estimatedTotal = (performance.now() - startTime) / (i + 1) * totalFrames / 1000;
        const remaining = Math.max(0, estimatedTotal - (performance.now() - startTime) / 1000).toFixed(0);
        if (progressEl) {
          progressEl.innerText = `⚡ ${pct}% (${Math.round(fakeTime)}s/${Math.round(duration)}s) — ${elapsedSec}s đã qua, ~${remaining}s còn lại`;
        }
        // Yield to UI thread to keep browser responsive
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // Cleanup snapshot
    if (_bgVideoSnapshot) _bgVideoSnapshot.close();
    state._exportBgSnapshot = null;

    // 8. Restore getCurrentTime & export mode flag
    state._isExportingFrames = false;
    state.wavesurfer.getCurrentTime = origGetTime;

    // 9. Flush encoders
    if (progressEl) progressEl.innerText = 'Đang hoàn tất encoding...';
    await videoEncoder.flush();
    await audioEncoder.flush();
    videoEncoder.close();
    audioEncoder.close();

    // 10. Finalize muxer
    muxer.finalize();
    const buffer = target.buffer;

    // 11. Download — correct format
    const mimeType = isMp4 ? 'video/mp4' : 'video/webm';
    const fileExt = isMp4 ? 'mp4' : 'webm';
    const blob = new Blob([buffer], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const cleanTitle = (elements.songTitleDisplay.innerText || 'lyrics_video').replace(/\s+/g, '_');
    a.download = `${cleanTitle}_lyric.${fileExt}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);

    // 12. Restore UI
    const totalSec = ((performance.now() - startTime) / 1000).toFixed(1);
    const speedup = (duration / ((performance.now() - startTime) / 1000)).toFixed(1);

    elements.previewCanvas.width = originalWidth;
    elements.previewCanvas.height = originalHeight;
    state.isExporting = false;
    state.exportPauseRaf = false;
    requestAnimationFrame(canvasRenderLoop); // Restart render loop
    elements.btnPlayPause.removeAttribute('disabled');
    elements.btnExportWebM.removeAttribute('disabled');
    elements.btnExportMP4.removeAttribute('disabled');
    elements.processingOverlay.classList.remove('active');
    showToast(`⚡ Xuất nhanh hoàn tất! ${exportW}x${exportH} — ${totalSec}s (nhanh ${speedup}x)`, 'success');

  } catch (err) {
    console.error('Fast export error:', err);
    elements.previewCanvas.width = originalWidth;
    elements.previewCanvas.height = originalHeight;
    state.isExporting = false;
    state.exportPauseRaf = false;
    requestAnimationFrame(canvasRenderLoop); // Restart render loop
    elements.btnPlayPause.removeAttribute('disabled');
    elements.btnExportWebM.removeAttribute('disabled');
    elements.btnExportMP4.removeAttribute('disabled');
    elements.processingOverlay.classList.remove('active');
    showToast(`Lỗi xuất nhanh: ${err.message}. Thử lại...`, 'error');
  }
}

// ----------------------------------------------------
// BROWSER VIDEO EXPORTER (MediaRecorder API — Fallback)
// ----------------------------------------------------
async function startExport(format = 'webm') {
  if (!state.audioFile || !state.wavesurfer) {
    showToast('Vui lòng chọn tệp âm thanh trước khi xuất video!', 'error');
    return;
  }

  if (state.lyrics.length === 0) {
    showToast('Chưa có lyrics để xuất video!', 'error');
    return;
  }

  if (state.isExporting) {
    showToast('Tiến trình xuất video đang diễn ra...', 'info');
    return;
  }

  // Store original preview canvas resolution
  const originalWidth = elements.previewCanvas.width;
  const originalHeight = elements.previewCanvas.height;

  // Calculate physical resolution and bitrate based on settings
  let exportW = 1280;
  let exportH = 720;
  let bitrate = 5000000; // 5 Mbps

  if (state.exportQuality === 'fast') {
    bitrate = 2000000; // 2 Mbps
    if (state.aspectRatio === '16-9') { exportW = 854; exportH = 480; }
    else if (state.aspectRatio === '9-16') { exportW = 480; exportH = 854; }
    else { exportW = 480; exportH = 480; }
  } else if (state.exportQuality === 'high') {
    bitrate = 8000000; // 8 Mbps
    if (state.aspectRatio === '16-9') { exportW = 1920; exportH = 1080; }
    else if (state.aspectRatio === '9-16') { exportW = 1080; exportH = 1920; }
    else { exportW = 1080; exportH = 1080; }
  } else { // standard
    bitrate = 5000000; // 5 Mbps
    if (state.aspectRatio === '16-9') { exportW = 1280; exportH = 720; }
    else if (state.aspectRatio === '9-16') { exportW = 720; exportH = 1280; }
    else { exportW = 720; exportH = 720; }
  }

  // Set export size to physical canvas so captureStream records at high fidelity
  elements.previewCanvas.width = exportW;
  elements.previewCanvas.height = exportH;

  // Prepare UI for exporting
  state.isExporting = true;
  elements.btnPlayPause.setAttribute('disabled', 'true');
  elements.btnExportWebM.setAttribute('disabled', 'true');
  elements.btnExportMP4.setAttribute('disabled', 'true');
  
  elements.processingOverlay.classList.add('active');
  elements.processingText.innerHTML = `
    <div style="font-size: 1.1rem; font-weight: bold; margin-bottom: 6px;">BẮT ĐẦU XUẤT VIDEO (${exportW}x${exportH})</div>
    <div style="font-size: 0.8rem; opacity: 0.7; margin-bottom: 10px;">Vui lòng giữ tab trình duyệt đang mở để ghi video...</div>
    <div style="font-size: 0.75rem; color: var(--accent-color);" id="exportProgressDisplay">Đang chuẩn bị luồng ghi...</div>
  `;

  // Pause wavesurfer and seek to beginning
  state.wavesurfer.pause();
  state.wavesurfer.setTime(0);
  if (state.bgType === 'video' && elements.bgVideo) {
    elements.bgVideo.pause();
    elements.bgVideo.currentTime = 0;
  }

  // Wait a moment for rendering cycle to align
  await new Promise(resolve => setTimeout(resolve, 850));

  try {
    // 1. Capture Canvas Stream
    const canvasStream = elements.previewCanvas.captureStream(state.exportFps);

    // 2. Capture Audio Node Stream from wavesurfer media element
    // Reuse AudioContext & source to avoid "already connected" error on re-export
    const audioElement = state.wavesurfer.media;
    
    if (!state.exportAudioCtx || state.exportAudioCtx.state === 'closed') {
      state.exportAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      state.exportAudioSource = null; // force re-create source
    }
    
    const audioCtx = state.exportAudioCtx;
    
    // Resume AudioContext if suspended (browser autoplay policy)
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    
    // createMediaElementSource can only be called ONCE per audio element
    // Reuse the cached source, only create if not yet connected
    if (!state.exportAudioSource) {
      try {
        state.exportAudioSource = audioCtx.createMediaElementSource(audioElement);
      } catch (e) {
        // Already connected — reload audio to get fresh element
        console.warn('AudioSource already connected, reusing existing.');
      }
    }
    
    // Create new destination for this export
    const dest = audioCtx.createMediaStreamDestination();
    state.exportAudioDest = dest;
    
    // Disconnect previous routing and reconnect
    if (state.exportAudioSource) {
      try { state.exportAudioSource.disconnect(); } catch(_) {}
      state.exportAudioSource.connect(dest);
      state.exportAudioSource.connect(audioCtx.destination);
    }
    
    const audioStream = dest.stream;

    // 3. Combine Tracks into a unified MediaStream
    const combinedStream = new MediaStream();
    
    // Add canvas video track
    canvasStream.getVideoTracks().forEach(track => combinedStream.addTrack(track));
    // Add audio track
    audioStream.getAudioTracks().forEach(track => combinedStream.addTrack(track));

    // 4. Create MediaRecorder with codec checks and customized bitrates
    // Try codecs in order of quality: h264 > vp9 > vp8
    let options = null;
    const codecPriority = [
      'video/mp4;codecs=h264,aac',        // Native MP4 (some Chromium builds)
      'video/webm;codecs=h264,opus',       // WebM with H.264
      'video/webm;codecs=vp9,opus',        // WebM VP9 (better quality)
      'video/webm;codecs=vp8,opus',        // WebM VP8 (fallback)
      'video/webm',                         // Generic WebM
    ];
    
    for (const codec of codecPriority) {
      if (MediaRecorder.isTypeSupported(codec)) {
        options = { mimeType: codec, videoBitsPerSecond: bitrate };
        console.log(`[Export] Using codec: ${codec}`);
        break;
      }
    }
    
    if (!options) {
      options = { videoBitsPerSecond: bitrate }; // Let browser pick default
      console.warn('[Export] No preferred codec supported, using browser default.');
    }

    state.recordedChunks = [];
    state.mediaRecorder = new MediaRecorder(combinedStream, options);

    state.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        state.recordedChunks.push(event.data);
      }
    };

    state.mediaRecorder.onstop = () => {
      // Construct final video file
      const blob = new Blob(state.recordedChunks, { type: state.mediaRecorder.mimeType });
      const url = URL.createObjectURL(blob);
      
      // Trigger browser download
      const a = document.createElement('a');
      a.href = url;
      
      // Detect actual format from mimeType to avoid naming .mp4 when content is WebM
      const actualMime = state.mediaRecorder.mimeType || '';
      const isActualMp4 = actualMime.includes('mp4');
      const fileExt = isActualMp4 ? 'mp4' : 'webm';
      const cleanTitle = (elements.songTitleDisplay.innerText || 'lyrics_video').replace(/\s+/g, '_');
      a.download = `${cleanTitle}_lyric.${fileExt}`;
      
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // Clean up routing and restore preview dimensions
      setTimeout(() => {
        URL.revokeObjectURL(url);
        
        // Restore physical canvas sizes
        elements.previewCanvas.width = originalWidth;
        elements.previewCanvas.height = originalHeight;
        
        // Disconnect export routing, reconnect for normal playback
        if (state.exportAudioSource) {
          try { state.exportAudioSource.disconnect(); } catch(_) {}
          // Reconnect only to speakers for normal playback
          try { state.exportAudioSource.connect(state.exportAudioCtx.destination); } catch(_) {}
        }
        
        if (state.bgType === 'video' && elements.bgVideo) {
          elements.bgVideo.pause();
          syncBgVideoWithAudio(true);
        }
        state.isExporting = false;
        elements.btnPlayPause.removeAttribute('disabled');
        elements.btnExportWebM.removeAttribute('disabled');
        elements.btnExportMP4.removeAttribute('disabled');
        elements.processingOverlay.classList.remove('active');
        
        const formatLabel = fileExt === 'mp4' ? 'MP4' : 'WebM';
        showToast(`Xuất video ${formatLabel} (${exportW}x${exportH}) thành công!`, 'success');
      }, 600);
    };

    // 5. Run standard record execution
    state.mediaRecorder.start();
    
    // Play audio, which triggers the canvas visual animations
    state.wavesurfer.play();
    if (state.bgType === 'video' && elements.bgVideo) {
      elements.bgVideo.play().catch(err => console.log("Video play error on export start:", err));
    }

    // Start progress updater loop
    const progressInterval = setInterval(() => {
      if (!state.isExporting) {
        clearInterval(progressInterval);
        return;
      }
      
      const cur = state.wavesurfer.getCurrentTime();
      const dur = state.audioDuration || 1;
      const pct = Math.min(Math.round((cur / dur) * 100), 100);
      
      const progressEl = document.getElementById('exportProgressDisplay');
      if (progressEl) {
        progressEl.innerText = `Đang ghi hình: ${pct}% (${cur.toFixed(1)}s / ${dur.toFixed(1)}s)`;
      }

      // Check if finished
      if (cur >= dur - 0.2) {
        clearInterval(progressInterval);
        state.wavesurfer.pause();
        if (state.bgType === 'video' && elements.bgVideo) {
          elements.bgVideo.pause();
        }
        state.mediaRecorder.stop();
      }
    }, 250);

  } catch (err) {
    console.error('Lỗi khi xuất video:', err);
    showToast(`Lỗi xuất video: ${err.message}`, 'error');
    
    // Restore physical canvas sizes on error
    elements.previewCanvas.width = originalWidth;
    elements.previewCanvas.height = originalHeight;
    
    if (state.bgType === 'video' && elements.bgVideo) {
      elements.bgVideo.pause();
    }
    state.isExporting = false;
    elements.btnPlayPause.removeAttribute('disabled');
    elements.btnExportWebM.removeAttribute('disabled');
    elements.btnExportMP4.removeAttribute('disabled');
    elements.processingOverlay.classList.remove('active');
  }
}

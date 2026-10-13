(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const fileInput = $("audioFiles");
  const fallbackInput = $("filePickerFallback");
  const trackList = $("trackList");
  const emptyState = $("emptyState");
  const loading = $("loading");
  const playBtn = $("playBtn");
  const stopBtn = $("stopBtn");
  const restartBtn = $("restartBtn");
  const masterVolume = $("masterVolume");
  const masterValue = $("masterValue");
  const muteAllBtn = $("muteAllBtn");

  let audioContext = null;
  let masterGain = null;
  let tracks = [];
  let isPlaying = false;
  let playStartedAt = 0;
  let pausedAt = 0;
  let masterMuted = false;
  let rafId = null;
  let sessionDuration = 0;
  let generation = 0;

  const COLORS = ["#63b8ff", "#ffad5c", "#ff6d91", "#a78bfa", "#52d6d1", "#f7c65f", "#e879f9", "#9aaec8"];
  const ICONS = ["♫", "♬", "♪", "♩"];
  const formatTime = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
    const s = Math.floor(seconds);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  async function ensureAudio() {
    if (!audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("Este navegador não oferece suporte ao Web Audio API. Tente uma versão atualizada do Chrome ou Edge.");
      audioContext = new AudioContextClass();
      masterGain = audioContext.createGain();
      masterGain.gain.value = Number(masterVolume.value) / 100;
      masterGain.connect(audioContext.destination);
    }
    if (audioContext.state === "suspended") await audioContext.resume();
  }

  function currentTime() {
    if (isPlaying && audioContext) return Math.min(sessionDuration, pausedAt + (audioContext.currentTime - playStartedAt));
    return pausedAt;
  }

  function stopSources() {
    tracks.forEach(track => {
      if (track.source) {
        try { track.source.stop(); } catch (_) {}
        try { track.source.disconnect(); } catch (_) {}
        track.source = null;
      }
    });
  }

  function effectiveVolume(track) {
    if (track.muted || masterMuted) return 0;
    const hasSolo = tracks.some(t => t.solo);
    if (hasSolo && !track.solo) return 0;
    return track.volume;
  }

  function updateTrackGain(track) {
    if (track.gain && audioContext) {
      track.gain.gain.setTargetAtTime(effectiveVolume(track), audioContext.currentTime, 0.015);
    }
    if (track.row) {
      track.row.querySelector('[data-action="mute"]').classList.toggle("muted", track.muted);
      track.row.querySelector('[data-action="mute"]').textContent = track.muted ? "Ativar" : "Mudo";
      track.row.querySelector('[data-action="mute"]').setAttribute("aria-pressed", String(track.muted));
      track.row.querySelector('[data-action="solo"]').classList.toggle("active", track.solo);
      track.row.querySelector('[data-action="solo"]').setAttribute("aria-pressed", String(track.solo));
    }
  }

  function updateAllGains() { tracks.forEach(updateTrackGain); }

  function createTrackRow(track, index) {
    const row = document.createElement("div");
    row.className = "track-row";
    row.style.setProperty("--track-color", track.color);
    row.innerHTML = `
      <div class="track-name-wrap">
        <span class="track-number">${index + 1}</span>
        <span class="track-symbol" aria-hidden="true">${ICONS[index % ICONS.length]}</span>
        <input class="track-name" type="text" aria-label="Nome da track" value="">
      </div>
      <div class="volume-wrap">
        <input type="range" min="0" max="100" value="80" aria-label="Volume da track">
        <span class="volume-value">80%</span>
      </div>
      <div class="track-actions">
        <button class="track-action" data-action="mute" aria-pressed="false">Mudo</button>
        <button class="track-action" data-action="solo" aria-pressed="false">Solo</button>
        <button class="track-action" data-action="remove" title="Remover track" aria-label="Remover track">×</button>
      </div>
      <div class="track-duration">${formatTime(track.buffer.duration)}</div>
    `;
    const nameInput = row.querySelector(".track-name");
    nameInput.value = track.name.replace(/\.[^.]+$/, "");
    nameInput.title = "Clique para renomear esta track";
    row.querySelector('input[type="range"]').addEventListener("input", (event) => {
      track.volume = Number(event.target.value) / 100;
      row.querySelector(".volume-value").textContent = `${event.target.value}%`;
      updateTrackGain(track);
    });
    row.querySelector('[data-action="mute"]').addEventListener("click", () => {
      track.muted = !track.muted;
      updateTrackGain(track);
    });
    row.querySelector('[data-action="solo"]').addEventListener("click", () => {
      track.solo = !track.solo;
      updateAllGains();
    });
    row.querySelector('[data-action="remove"]').addEventListener("click", () => removeTrack(track.id));
    track.row = row;
    trackList.appendChild(row);
    updateTrackGain(track);
  }

  async function loadFiles(fileCollection) {
    const files = Array.from(fileCollection || []).filter(file => file.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|flac|aiff?)$/i.test(file.name));
    if (!files.length) return;
    const thisGeneration = ++generation;
    loading.classList.remove("hidden");
    emptyState.classList.add("hidden");
    try {
      await ensureAudio();
      // If a session is already playing, pause it before changing the set of tracks.
      if (isPlaying) pausePlayback();
      for (const file of files) {
        if (thisGeneration !== generation) return;
        try {
          const arrayBuffer = await file.arrayBuffer();
          const decoded = await audioContext.decodeAudioData(arrayBuffer);
          if (thisGeneration !== generation) return;
          const gain = audioContext.createGain();
          gain.connect(masterGain);
          const track = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            name: file.name,
            buffer: decoded,
            gain,
            source: null,
            volume: 0.8,
            muted: false,
            solo: false,
            color: COLORS[tracks.length % COLORS.length],
            row: null
          };
          tracks.push(track);
          createTrackRow(track, tracks.length - 1);
        } catch (error) {
          console.error("Falha ao carregar", file.name, error);
          alert(`Não foi possível abrir "${file.name}". Tente converter o arquivo para MP3 ou WAV.`);
        }
      }
      updateSessionInfo();
    } catch (error) {
      alert(error.message || "Não foi possível iniciar o áudio neste navegador.");
    } finally {
      if (thisGeneration === generation) loading.classList.add("hidden");
      fileInput.value = "";
      fallbackInput.value = "";
    }
  }

  function updateSessionInfo() {
    sessionDuration = tracks.reduce((max, track) => Math.max(max, track.buffer.duration), 0);
    $("trackCount").textContent = `${tracks.length} ${tracks.length === 1 ? "track" : "tracks"}`;
    $("statusTitle").textContent = tracks.length ? `${tracks.length} ${tracks.length === 1 ? "track carregada" : "tracks carregadas"}` : "Nenhuma track carregada";
    $("statusText").textContent = tracks.length ? "Tracks prontas para reprodução." : "Adicione os arquivos para começar.";
    emptyState.classList.toggle("hidden", tracks.length > 0);
    updateTimeReadout();
    updateAllGains();
  }

  function startSources(offset) {
    stopSources();
    tracks.forEach(track => {
      if (offset >= track.buffer.duration) return;
      const source = audioContext.createBufferSource();
      source.buffer = track.buffer;
      source.connect(track.gain);
      source.start(0, Math.max(0, offset));
      track.source = source;
    });
    playStartedAt = audioContext.currentTime;
    isPlaying = true;
    playBtn.textContent = "Ⅱ";
    playBtn.setAttribute("aria-label", "Pausar");
    playBtn.title = "Pausar";
    tick();
  }

  async function playPlayback() {
    if (!tracks.length) {
      alert("Adicione ao menos uma track de áudio antes de reproduzir.");
      return;
    }
    try {
      await ensureAudio();
      if (pausedAt >= sessionDuration) pausedAt = 0;
      startSources(pausedAt);
    } catch (error) {
      alert(error.message || "Não foi possível reproduzir o áudio.");
    }
  }

  function pausePlayback() {
    if (!isPlaying) return;
    pausedAt = currentTime();
    isPlaying = false;
    stopSources();
    cancelAnimationFrame(rafId);
    playBtn.textContent = "▶";
    playBtn.setAttribute("aria-label", "Reproduzir");
    playBtn.title = "Reproduzir";
    updateTimeReadout();
  }

  function stopPlayback() {
    isPlaying = false;
    stopSources();
    pausedAt = 0;
    cancelAnimationFrame(rafId);
    playBtn.textContent = "▶";
    playBtn.setAttribute("aria-label", "Reproduzir");
    playBtn.title = "Reproduzir";
    updateTimeReadout();
  }

  function tick() {
    updateTimeReadout();
    if (isPlaying && currentTime() >= sessionDuration) {
      stopPlayback();
      return;
    }
    if (isPlaying) rafId = requestAnimationFrame(tick);
  }

  function updateTimeReadout() {
    $("timeReadout").textContent = `${formatTime(currentTime())} / ${formatTime(sessionDuration)}`;
  }

  function removeTrack(id) {
    const track = tracks.find(t => t.id === id);
    if (!track) return;
    if (isPlaying) pausePlayback();
    if (track.source) { try { track.source.stop(); } catch (_) {} }
    if (track.gain) track.gain.disconnect();
    tracks = tracks.filter(t => t.id !== id);
    renderTracks();
    updateSessionInfo();
  }

  function renderTracks() {
    trackList.innerHTML = "";
    tracks.forEach((track, index) => createTrackRow(track, index));
  }

  function clearSession() {
    if (!tracks.length) return;
    if (!confirm("Remover todas as tracks desta sessão?")) return;
    generation++;
    stopPlayback();
    tracks.forEach(track => { if (track.gain) track.gain.disconnect(); });
    tracks = [];
    trackList.innerHTML = "";
    masterMuted = false;
    muteAllBtn.setAttribute("aria-pressed", "false");
    muteAllBtn.textContent = "◖ Mudo todos";
    updateSessionInfo();
  }

  fileInput.addEventListener("change", (event) => loadFiles(event.target.files));
  fallbackInput.addEventListener("change", (event) => loadFiles(event.target.files));
  $("addMoreBtn").addEventListener("click", () => fallbackInput.click());
  $("emptyUploadBtn").addEventListener("click", () => fallbackInput.click());
  playBtn.addEventListener("click", () => isPlaying ? pausePlayback() : playPlayback());
  stopBtn.addEventListener("click", stopPlayback);
  restartBtn.addEventListener("click", () => {
    const wasPlaying = isPlaying;
    stopPlayback();
    if (wasPlaying) playPlayback();
  });
  $("clearBtn").addEventListener("click", clearSession);

  masterVolume.addEventListener("input", () => {
    const value = Number(masterVolume.value) / 100;
    masterValue.textContent = `${masterVolume.value}%`;
    if (masterGain && audioContext) masterGain.gain.setTargetAtTime(value, audioContext.currentTime, 0.015);
  });

  muteAllBtn.addEventListener("click", () => {
    masterMuted = !masterMuted;
    muteAllBtn.setAttribute("aria-pressed", String(masterMuted));
    muteAllBtn.textContent = masterMuted ? "◉ Reativar todos" : "◖ Mudo todos";
    updateAllGains();
  });

  updateSessionInfo();
})();

(() => {
  const DATA = window.HABLA_DATA;
  const STORE_KEY = "habla-next-model-v1";
  const SETTINGS_KEY = "habla-next-settings-v1";

  const els = {
    heard: document.getElementById("heard"),
    status: document.getElementById("status"),
    count: document.getElementById("count"),
    listen: document.getElementById("listen"),
    pulse: document.getElementById("pulse"),
    dialect: document.getElementById("dialect"),
    words: document.getElementById("words"),
    sentences: document.getElementById("sentences"),
    help: document.getElementById("help"),
    helpBtn: document.getElementById("helpBtn"),
    settingsBtn: document.getElementById("settingsBtn"),
    settings: document.getElementById("settings"),
    exportBtn: document.getElementById("exportBtn"),
    importFile: document.getElementById("importFile"),
    resetBtn: document.getElementById("resetBtn"),
    warn: document.getElementById("warn"),
  };

  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  let recognition = null;
  let listening = false;
  let shouldListen = false;
  let wakeLock = null;
  let finalText = "";
  let interimText = "";
  let restartTimer = null;

  const model = loadModel();
  const settings = loadSettings();
  els.dialect.value = settings.dialect || "es-MX";
  renderStats();

  function loadModel() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          bigrams: parsed.bigrams || {},
          trigrams: parsed.trigrams || {},
          phrases: parsed.phrases || [],
          uttered: parsed.uttered || 0,
        };
      }
    } catch (_) {}
    return { bigrams: {}, trigrams: {}, phrases: [], uttered: 0 };
  }

  function saveModel() {
    localStorage.setItem(STORE_KEY, JSON.stringify(model));
    renderStats();
  }

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); }
    catch (_) { return {}; }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function renderStats() {
    els.count.textContent = model.uttered
      ? `${model.uttered} phrase${model.uttered === 1 ? "" : "s"} learned on this phone`
      : "No personal phrases stored yet";
  }

  function normalize(s) {
    return (s || "")
      .toLowerCase()
      .replace(/[¿?¡!.,;:…"“”«»]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokens(s) {
    return normalize(s).split(" ").filter(Boolean);
  }

  function gloss(word) {
    const w = normalize(word);
    if (DATA.gloss[w]) return DATA.gloss[w];
    const stripped = w.replace(/^(el|la|los|las|un|una|unos|unas)\s+/, "");
    if (DATA.gloss[stripped]) return DATA.gloss[stripped];
    return "—";
  }

  function bump(map, key, next, n = 1) {
    if (!key || !next) return;
    if (!map[key]) map[key] = {};
    map[key][next] = (map[key][next] || 0) + n;
  }

  function learnUtterance(text) {
    const toks = tokens(text);
    if (toks.length < 2) return;
    model.uttered += 1;
    model.phrases.push(normalize(text));
    if (model.phrases.length > 400) model.phrases = model.phrases.slice(-400);
    for (let i = 0; i < toks.length - 1; i++) {
      bump(model.bigrams, toks[i], toks[i + 1], 2);
      if (i < toks.length - 2) {
        bump(model.trigrams, toks[i] + " " + toks[i + 1], toks[i + 2], 3);
      }
    }
    saveModel();
  }

  function rankFromMap(map, key, weight) {
    const out = [];
    const row = map[key];
    if (!row) return out;
    if (Array.isArray(row)) {
      for (const [w, c] of row) out.push({ word: w, score: c * weight, source: "base" });
    } else {
      for (const [w, c] of Object.entries(row)) out.push({ word: w, score: c * weight, source: "you" });
    }
    return out;
  }

  function mergePreds(lists) {
    const bag = new Map();
    for (const list of lists) {
      for (const item of list) {
        const key = item.word;
        const prev = bag.get(key);
        if (prev) {
          prev.score += item.score;
          if (item.source === "you") prev.source = "you";
        } else {
          bag.set(key, { ...item });
        }
      }
    }
    return [...bag.values()].sort((a, b) => b.score - a.score);
  }

  function predictWords(text) {
    const toks = tokens(text);
    if (!toks.length) {
      return mergePreds([
        rankFromMap(DATA.unigrams, "yo", 1),
        rankFromMap(DATA.unigrams, "me", 0.8),
        rankFromMap(DATA.unigrams, "qué", 0.8),
        rankFromMap(DATA.unigrams, "hola", 0.7),
        rankFromMap(DATA.unigrams, "por", 0.6),
      ]).slice(0, 8);
    }
    const last = toks[toks.length - 1];
    const last2 = toks.slice(-2).join(" ");
    return mergePreds([
      rankFromMap(model.trigrams, last2, 5),
      rankFromMap(model.bigrams, last, 3.5),
      rankFromMap(DATA.bigrams, last2, 2.2),
      rankFromMap(DATA.unigrams, last, 1.4),
    ]).slice(0, 8);
  }

  function predictSentences(text) {
    const norm = normalize(text);
    const toks = tokens(text);
    const prefix2 = toks.slice(-2).join(" ");
    const prefix1 = toks.slice(-1).join(" ");
    const out = [];
    const seen = new Set();

    function add(es, en, source) {
      const key = normalize(es);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push({ es, en, source });
    }

    if (norm) {
      const mined = model.phrases.filter((p) => p.startsWith(norm) && p.length > norm.length + 2);
      mined.slice(-5).reverse().forEach((p) => add(capitalize(p), "From your past speech", "you"));
    }

    const keys = [norm, prefix2, prefix1];
    for (const key of keys) {
      const rows = DATA.sentences[key];
      if (rows) rows.forEach(([es, en]) => add(es, en, "base"));
    }

    const words = predictWords(text).slice(0, 4);
    if (norm && words.length) {
      for (const w of words) {
        const draft = capitalize((norm + " " + w.word).trim()) + "…";
        add(draft, "Possible continuation", w.source);
      }
    }

    if (!out.length) {
      add("Hola, ¿qué tal?", "Hi, how's it going?", "base");
      add("¿Me puedes ayudar, por favor?", "Can you help me, please?", "base");
      add("No entiendo. ¿Puedes repetir?", "I don't understand. Can you repeat?", "base");
    }
    return out.slice(0, 4);
  }

  function capitalize(s) {
    if (!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function renderHeard() {
    const final = finalText ? `<span class="final">${escapeHtml(finalText)}</span> ` : "";
    const interim = interimText ? `<span class="interim">${escapeHtml(interimText)}</span>` : "";
    const cursor = listening ? `<span class="cursor"></span>` : "";
    els.heard.innerHTML = final + interim + cursor || `<span class="interim">Tap Listen and start speaking Spanish.</span>`;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function renderPredictions() {
    const context = (finalText + " " + interimText).trim();
    const words = predictWords(context);
    if (!words.length) {
      els.words.innerHTML = `<div class="empty">Start a sentence to see next-word guesses.</div>`;
    } else {
      els.words.innerHTML = words.map((w) => `
        <button class="chip ${w.source === "you" ? "learned" : ""}" data-word="${escapeHtml(w.word)}">
          <div class="es">${escapeHtml(w.word)}</div>
          <div class="en">${escapeHtml(gloss(w.word))}</div>
          ${w.source === "you" ? `<div class="tag">from your speech</div>` : ""}
        </button>
      `).join("");
    }

    const sents = predictSentences(context);
    els.sentences.innerHTML = sents.map((s) => `
      <button class="sentence">
        <div class="es">${escapeHtml(s.es)}</div>
        <div class="en">${escapeHtml(s.en)}${s.source === "you" ? " · learned" : ""}</div>
      </button>
    `).join("");
  }

  function setListeningUI(on) {
    listening = on;
    els.listen.textContent = on ? "Listening… tap to pause" : "Listen";
    els.listen.classList.toggle("hot", on);
    els.pulse.classList.toggle("on", on);
    els.status.innerHTML = on
      ? `<span class="pulse on"></span>Using the phone or AirPods mic`
      : `<span class="pulse"></span>Mic idle`;
    renderHeard();
  }

  async function requestWakeLock() {
    try {
      if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request("screen");
    } catch (_) {}
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }

  function attachRecognition() {
    if (!SpeechRec) {
      els.warn.style.display = "block";
      els.warn.textContent = "This browser has no speech recognition. Use Safari on iPhone or Chrome on Android / desktop.";
      return null;
    }
    const rec = new SpeechRec();
    rec.lang = els.dialect.value;
    rec.interimResults = true;
    rec.continuous = !isIOS;
    rec.maxAlternatives = 1;

    rec.onstart = () => setListeningUI(true);

    rec.onresult = (event) => {
      let interim = "";
      let addedFinal = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = event.results[i][0].transcript;
        if (event.results[i].isFinal) addedFinal += piece + " ";
        else interim += piece;
      }
      if (addedFinal.trim()) {
        finalText = (finalText + " " + addedFinal).replace(/\s+/g, " ").trim();
        if (finalText.length > 280) finalText = finalText.slice(-280);
        learnUtterance(addedFinal);
      }
      interimText = interim;
      renderHeard();
      renderPredictions();
    };

    rec.onerror = (e) => {
      if (e.error === "not-allowed") {
        els.warn.style.display = "block";
        els.warn.textContent = "Microphone permission was blocked. Enable it for this page in Settings.";
        stopListening();
      }
    };

    rec.onend = () => {
      if (shouldListen) {
        clearTimeout(restartTimer);
        restartTimer = setTimeout(() => {
          try { rec.start(); } catch (_) {}
        }, isIOS ? 220 : 80);
      } else {
        setListeningUI(false);
        releaseWakeLock();
      }
    };

    return rec;
  }

  function startListening() {
    if (!recognition) recognition = attachRecognition();
    if (!recognition) return;
    recognition.lang = els.dialect.value;
    shouldListen = true;
    requestWakeLock();
    try { recognition.start(); }
    catch (_) { /* already started */ }
    setListeningUI(true);
  }

  function stopListening() {
    shouldListen = false;
    clearTimeout(restartTimer);
    try { recognition && recognition.stop(); } catch (_) {}
    setListeningUI(false);
    releaseWakeLock();
  }

  els.listen.addEventListener("click", () => {
    if (shouldListen) stopListening();
    else startListening();
  });

  els.dialect.addEventListener("change", () => {
    settings.dialect = els.dialect.value;
    saveSettings();
    if (shouldListen) {
      stopListening();
      startListening();
    }
  });

  els.words.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    const word = chip.dataset.word;
    finalText = (finalText + " " + interimText + " " + word).replace(/\s+/g, " ").trim();
    interimText = "";
    learnUtterance(finalText);
    renderHeard();
    renderPredictions();
  });

  els.sentences.addEventListener("click", (e) => {
    const card = e.target.closest(".sentence");
    if (!card) return;
    const line = card.querySelector(".es").textContent.replace(/…$/, "");
    finalText = line;
    interimText = "";
    learnUtterance(line);
    renderHeard();
    renderPredictions();
  });

  els.helpBtn.addEventListener("click", () => {
    els.help.classList.toggle("open");
    els.settings.classList.remove("open");
  });

  els.settingsBtn.addEventListener("click", () => {
    els.settings.classList.toggle("open");
    els.help.classList.remove("open");
  });

  els.exportBtn.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(model, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "habla-next-learning.json";
    a.click();
  });

  els.importFile.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      model.bigrams = parsed.bigrams || model.bigrams;
      model.trigrams = parsed.trigrams || model.trigrams;
      model.phrases = parsed.phrases || model.phrases;
      model.uttered = parsed.uttered || model.uttered;
      saveModel();
      renderPredictions();
    } catch (_) {
      els.warn.style.display = "block";
      els.warn.textContent = "Could not import that file.";
    }
  });

  els.resetBtn.addEventListener("click", () => {
    if (!confirm("Clear all learned speech patterns on this device?")) return;
    model.bigrams = {};
    model.trigrams = {};
    model.phrases = [];
    model.uttered = 0;
    saveModel();
    renderPredictions();
  });

  document.getElementById("clearHeard").addEventListener("click", () => {
    finalText = "";
    interimText = "";
    renderHeard();
    renderPredictions();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopListening();
  });

  renderHeard();
  renderPredictions();
})();

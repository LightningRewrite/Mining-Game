(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const canvas = $('#canvas');
  const frame = $('#gameFrame');
  const startOverlay = $('#startOverlay');
  const startButton = $('#startButton');
  const loadBar = $('#loadBar');
  const loadDetail = $('#loadDetail');
  const statusText = $('#statusText');
  const pauseOverlay = $('#pauseOverlay');
  const pauseButton = $('#pauseButton');
  const resumeButton = $('#resumeButton');
  const soundButton = $('#soundButton');
  const installButton = $('#installButton');

  let runtimeReady = false;
  let gameStarted = false;
  let paused = false;
  let muted = localStorage.getItem('mining-game-muted') === 'true';
  let dependencyPeak = 1;
  let installPrompt = null;

  const ccall = (name, returnType, argTypes, args) => {
    if (!runtimeReady || !gameStarted) return;
    Module.ccall(name, returnType, argTypes, args);
  };

  function updateSound() {
    soundButton.textContent = muted ? 'Muted' : 'Sound';
    soundButton.setAttribute('aria-pressed', String(muted));
    if (gameStarted) ccall('web_set_muted', null, ['number'], [muted ? 1 : 0]);
  }

  function setPaused(value) {
    if (!gameStarted) return;
    paused = value;
    ccall('web_set_paused', null, ['number'], [paused ? 1 : 0]);
    pauseOverlay.hidden = !paused;
    pauseButton.textContent = paused ? 'Resume' : 'Pause';
    if (!paused) canvas.focus({ preventScroll: true });
  }

  window.addEventListener('engine-status', event => {
    const message = event.detail || 'Preparing the mine…';
    loadDetail.textContent = message;
    statusText.textContent = runtimeReady ? 'Ready' : message;
  });

  window.addEventListener('engine-progress', event => {
    const left = Number(event.detail) || 0;
    dependencyPeak = Math.max(dependencyPeak, left);
    const progress = left === 0 ? 100 : Math.max(8, 100 * (1 - left / dependencyPeak));
    loadBar.style.width = `${progress}%`;
  });

  window.addEventListener('engine-ready', () => {
    runtimeReady = true;
    loadBar.style.width = '100%';
    loadDetail.textContent = 'The mine is ready.';
    statusText.textContent = 'Ready';
    startButton.disabled = false;
  });

  if (window.__miningGameRuntimeReady) {
    runtimeReady = true;
    loadBar.style.width = '100%';
    loadDetail.textContent = 'The mine is ready.';
    statusText.textContent = 'Ready';
    startButton.disabled = false;
  }

  startButton.addEventListener('click', () => {
    if (!runtimeReady || gameStarted) return;
    gameStarted = true;
    try {
      Module.callMain([]);
      startOverlay.hidden = true;
      document.body.classList.add('game-running');
      statusText.textContent = 'Shift active';
      updateSound();
      canvas.focus({ preventScroll: true });
    } catch (error) {
      console.error(error);
      gameStarted = false;
      loadDetail.textContent = 'The game could not start. Check the browser console for details.';
    }
  });

  pauseButton.addEventListener('click', () => setPaused(!paused));
  resumeButton.addEventListener('click', () => setPaused(false));
  soundButton.addEventListener('click', () => {
    muted = !muted;
    localStorage.setItem('mining-game-muted', String(muted));
    updateSound();
  });
  updateSound();

  $('#fullscreenButton').addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) {
        await frame.requestFullscreen({ navigationUI: 'hide' });
        if (screen.orientation?.lock) await screen.orientation.lock('landscape').catch(() => {});
      } else {
        await document.exitFullscreen();
      }
    } catch (error) {
      statusText.textContent = 'Fullscreen unavailable';
    }
  });

  function bindHold(button, down, up) {
    const release = event => {
      if (button.hasPointerCapture?.(event.pointerId)) button.releasePointerCapture(event.pointerId);
      button.classList.remove('pressed');
      up();
    };
    button.addEventListener('pointerdown', event => {
      event.preventDefault();
      button.setPointerCapture?.(event.pointerId);
      button.classList.add('pressed');
      down();
    });
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', () => {
      button.classList.remove('pressed');
      up();
    });
  }

  $$('.hold-button').forEach(button => {
    const primary = button.dataset.hold === 'primary';
    bindHold(
      button,
      () => ccall(primary ? 'web_set_primary' : 'web_set_secondary', null, ['number'], [1]),
      () => ccall(primary ? 'web_set_primary' : 'web_set_secondary', null, ['number'], [0])
    );
  });

  $$('.game-action').forEach(button => {
    const action = Number(button.dataset.action);
    bindHold(
      button,
      () => ccall('web_set_action', null, ['number', 'number'], [action, 1]),
      () => ccall('web_set_action', null, ['number', 'number'], [action, 0])
    );
  });

  function bindStick(root, knob, onValue, resetOnRelease) {
    let activePointer = null;
    let last = { x: 0, y: 0 };

    const update = event => {
      const rect = root.getBoundingClientRect();
      const radius = rect.width * 0.34;
      let x = (event.clientX - (rect.left + rect.width / 2)) / radius;
      let y = (event.clientY - (rect.top + rect.height / 2)) / radius;
      const magnitude = Math.hypot(x, y);
      if (magnitude > 1) { x /= magnitude; y /= magnitude; }
      last = { x, y };
      knob.style.transform = `translate(${x * radius}px, ${y * radius}px)`;
      onValue(x, y);
    };

    root.addEventListener('pointerdown', event => {
      event.preventDefault();
      activePointer = event.pointerId;
      root.setPointerCapture?.(event.pointerId);
      root.classList.add('active');
      update(event);
    });
    root.addEventListener('pointermove', event => {
      if (event.pointerId === activePointer) update(event);
    });
    const release = event => {
      if (event.pointerId !== activePointer) return;
      activePointer = null;
      root.classList.remove('active');
      if (resetOnRelease) {
        last = { x: 0, y: 0 };
        knob.style.transform = 'translate(0, 0)';
        onValue(0, 0);
      } else {
        onValue(last.x, last.y);
      }
    };
    root.addEventListener('pointerup', release);
    root.addEventListener('pointercancel', release);
  }

  bindStick($('#moveStick'), $('#moveKnob'), (x, y) => {
    ccall('web_set_movement', null, ['number', 'number'], [x, y]);
  }, true);

  bindStick($('#aimStick'), $('#aimKnob'), (x, y) => {
    ccall('web_set_aim', null, ['number', 'number'], [x, y]);
  }, false);

  canvas.addEventListener('contextmenu', event => event.preventDefault());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && gameStarted && !paused) setPaused(true);
  });

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    installButton.hidden = false;
  });
  installButton.addEventListener('click', async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    installPrompt = null;
    installButton.hidden = true;
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('service-worker.js').catch(console.error));
  }
})();

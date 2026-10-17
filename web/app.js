'use strict';

// The page renders the same default.glsl the desktop app uses. The Pages
// workflow copies it to shaders/; the second path works when serving the
// repository root locally (e.g. `python3 -m http.server` then open /web/).
const SHADER_URLS = [
  'shaders/default.glsl',
  '../src/main/resources/assets/shaders/default.glsl',
];

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const logEl = $('log');
const sourceEl = $('source');

const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: false });

const state = {
  camYaw: 0.6, camPitch: 0.35, camDist: 2.2,
  renderScale: 1,
  defaultVertex: '',
  defaultFragment: '',
  program: null,
  uniforms: {},
  usesTime: false,
  dirty: true,
};
const DEFAULT_CAMERA = { camYaw: 0.6, camPitch: 0.35, camDist: 2.2 };

// ---------------------------------------------------------------------------
// GLSL loading: split on '#type <stage>' exactly like Shader.java, then
// rewrite the desktop '#version 330 core' header for WebGL2 (GLSL ES 3.00).
// ---------------------------------------------------------------------------
function splitTypedSource(source) {
  const stages = {};
  const re = /#type[ \t]+([a-zA-Z]+)/g;
  const headers = [...source.matchAll(re)];
  headers.forEach((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < headers.length ? headers[i + 1].index : source.length;
    stages[m[1]] = source.slice(start, end).replace(/^\s*\n/, '');
  });
  if (!stages.vertex || !stages.fragment) {
    throw new Error("Expected '#type vertex' and '#type fragment' sections");
  }
  return stages;
}

function toGLSLES(src) {
  const header = '#version 300 es\nprecision highp float;\nprecision highp int;\n';
  const versionRe = /^[ \t]*#version[^\n]*\n?/m;
  // #version must be the first line, so strip it (and any leading blank lines)
  // wherever it is and prepend the ES header.
  return header + src.replace(versionRe, '').replace(/^\s+/, '');
}

function compileShader(type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(log || 'unknown compile error');
  }
  return sh;
}

function buildProgram(vertexSrc, fragmentSrc) {
  const vs = compileShader(gl.VERTEX_SHADER, toGLSLES(vertexSrc));
  let fs;
  try {
    fs = compileShader(gl.FRAGMENT_SHADER, toGLSLES(fragmentSrc));
  } catch (e) {
    gl.deleteShader(vs);
    throw e;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, 'aPos');
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(log || 'unknown link error');
  }
  return prog;
}

const UNIFORM_NAMES = ['iResolution', 'iTime', 'uCameraPos', 'uBaseColor', 'uRoughness',
  'uMetallic', 'uLightDir', 'uLightIntensity'];

function useFragment(fragmentSrc) {
  const t0 = performance.now();
  let prog;
  try {
    prog = buildProgram(state.defaultVertex, fragmentSrc);
    // Force the driver to finish so the reported time includes compilation.
    gl.finish();
  } catch (e) {
    setLog('error', String(e.message).trim());
    return false;
  }
  if (state.program) gl.deleteProgram(state.program);
  state.program = prog;
  state.uniforms = {};
  for (const name of UNIFORM_NAMES) state.uniforms[name] = gl.getUniformLocation(prog, name);
  state.usesTime = /\biTime\b/.test(fragmentSrc.replace(/uniform\s+float\s+iTime\s*;/, ''));
  state.dirty = true;
  setLog('ok', `Compiled in ${(performance.now() - t0).toFixed(0)} ms`);
  return true;
}

function setLog(kind, text) {
  logEl.className = 'log ' + kind;
  logEl.textContent = text;
}

// ---------------------------------------------------------------------------
// Geometry: the same full-screen quad as Scene.java
// ---------------------------------------------------------------------------
function createQuad() {
  const vertices = new Float32Array([
     1, -1, 0,  // Bottom right 0
    -1,  1, 0,  // Top left     1
     1,  1, 0,  // Top right    2
    -1, -1, 0,  // Bottom left  3
  ]);
  const indices = new Uint16Array([2, 1, 0, 0, 1, 3]);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);
  // aColor (location 1) is unused by the shader; give it a constant value.
  gl.vertexAttrib4f(1, 0.9, 0.9, 0.9, 0.0);
  return vao;
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
const controls = ['roughness', 'metallic', 'lightAz', 'lightEl', 'lightIntensity', 'renderScale'];
const formatters = {
  lightAz: (v) => `${v}°`,
  lightEl: (v) => `${v}°`,
  renderScale: (v) => `${Math.round(v * 100)}%`,
  baseColor: (v) => String(v).toUpperCase(),
};

function syncOutputs() {
  for (const id of [...controls, 'baseColor']) {
    const input = $(id);
    const out = document.querySelector(`output[for="${id}"]`);
    if (out) out.textContent = (formatters[id] || ((v) => Number(v).toFixed(2)))(input.value);
  }
}

function hexToLinear(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.pow(c / 255, 2.2));
}

function sphericalToVec(yaw, pitch) {
  return [Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw)];
}

for (const id of [...controls, 'baseColor']) {
  $(id).addEventListener('input', () => {
    syncOutputs();
    if (id === 'renderScale') state.renderScale = Number($(id).value);
    state.dirty = true;
  });
}
$('animateLight').addEventListener('change', () => { state.dirty = true; });

$('resetView').addEventListener('click', () => {
  Object.assign(state, DEFAULT_CAMERA);
  state.dirty = true;
});

$('compile').addEventListener('click', () => useFragment(sourceEl.value));
$('revert').addEventListener('click', () => {
  sourceEl.value = state.defaultFragment;
  useFragment(state.defaultFragment);
});
sourceEl.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    useFragment(sourceEl.value);
  } else if (e.key === 'Tab' && !e.shiftKey) {
    e.preventDefault();
    sourceEl.setRangeText('    ', sourceEl.selectionStart, sourceEl.selectionEnd, 'end');
  }
});

// ---------------------------------------------------------------------------
// Panel: floating card on desktop (Hide / Controls), bottom sheet on phones
// with Material / Light / Shader tabs and a collapsed "peek" state.
// ---------------------------------------------------------------------------
const panel = $('panel');
const showBtn = $('panel-toggle');
const phone = window.matchMedia('(max-width: 699px)');

function setPanelHidden(hidden) {
  panel.classList.toggle('hidden', hidden);
  document.body.classList.toggle('panel-hidden', hidden);
  showBtn.setAttribute('aria-expanded', String(!hidden));
  state.dirty = true;
}
showBtn.addEventListener('click', () => setPanelHidden(false));
$('panel-hide').addEventListener('click', () => setPanelHidden(true));

const tabs = [...panel.querySelectorAll('[role=tab]')];
function showTab(name) {
  tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  panel.querySelectorAll('.group, .panel-tools').forEach((g) => g.classList.toggle('is-active', g.dataset.tab === name));
}
tabs.forEach((t) => t.addEventListener('click', () => { showTab(t.dataset.tab); setPeek(false); }));
showTab('material');

function setPeek(peek) {
  panel.classList.toggle('peek', peek);
  $('sheet-handle').setAttribute('aria-expanded', String(!peek));
}
$('sheet-handle').addEventListener('click', () => setPeek(!panel.classList.contains('peek')));
// swipe on the handle or the tab row
let swipeY = null;
const swipeZone = [$('sheet-handle'), panel.querySelector('.sheet-tabs')];
swipeZone.forEach((z) => {
  z.addEventListener('pointerdown', (e) => { swipeY = e.clientY; });
  z.addEventListener('pointerup', (e) => {
    if (swipeY === null) return;
    const dy = e.clientY - swipeY;
    if (dy < -24) setPeek(false);
    else if (dy > 24) setPeek(true);
    swipeY = null;
  });
});
const applyPhone = () => { if (phone.matches) { setPanelHidden(false); setPeek(true); } else { setPeek(false); } };
phone.addEventListener('change', applyPhone);
applyPhone();

// Keyboard shortcut label matches the platform.
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
document.querySelectorAll('[data-shortcut]').forEach((k) => { k.textContent = isMac ? '⌘ Enter' : 'Ctrl+Enter'; });
document.querySelectorAll('[data-shortcut-short]').forEach((k) => { k.textContent = isMac ? '⌘↵' : 'Ctrl+↵'; });

// Orbit camera: drag to rotate, wheel or two-finger pinch to zoom.
const pointers = new Map();
let pinchDist = 0;

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  canvas.classList.add('dragging');
  if (pointers.size === 2) pinchDist = currentPinchDist();
});
canvas.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  const cur = { x: e.clientX, y: e.clientY };
  pointers.set(e.pointerId, cur);
  if (pointers.size === 1) {
    state.camYaw += (cur.x - prev.x) * 0.008;
    state.camPitch = clamp(state.camPitch + (cur.y - prev.y) * 0.008, -1.45, 1.45);
  } else if (pointers.size === 2) {
    const d = currentPinchDist();
    if (pinchDist > 0) zoom(pinchDist / d);
    pinchDist = d;
  }
  state.dirty = true;
});
const endPointer = (e) => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchDist = 0;
  if (pointers.size === 0) canvas.classList.remove('dragging');
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoom(Math.exp(e.deltaY * 0.001));
}, { passive: false });

function currentPinchDist() {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function zoom(factor) {
  state.camDist = clamp(state.camDist * factor, 0.6, 12);
  state.dirty = true;
}
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// ---------------------------------------------------------------------------
// Render loop: only redraws when something changed or the scene is animated.
// ---------------------------------------------------------------------------
function resize() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2) * state.renderScale;
  const w = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const h = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    state.dirty = true;
  }
}

const start = performance.now();
let frames = 0;
let fpsT0 = start;
const fpsEl = $('fps');

function frame(now) {
  requestAnimationFrame(frame);
  resize();
  const animateLight = $('animateLight').checked;
  if (!state.program || !(state.dirty || state.usesTime || animateLight)) {
    fpsEl.textContent = 'idle';
    fpsT0 = now;
    frames = 0;
    return;
  }
  state.dirty = false;

  if (animateLight) {
    const az = ((Number($("lightAz").value) + 180 + 0.5) % 360) - 180;
    $('lightAz').value = az;
    syncOutputs();
  }

  const u = state.uniforms;
  const cam = sphericalToVec(state.camYaw, state.camPitch).map((c) => c * state.camDist);
  const light = sphericalToVec(Number($('lightAz').value) * Math.PI / 180,
    Number($('lightEl').value) * Math.PI / 180);

  // Centre the scene in the part of the canvas the panel does not cover:
  // on desktop the floating panel takes the right 408 css px, on phones the
  // collapsed sheet takes the bottom 128 css px. Over-sized viewports keep
  // the whole canvas painted while shifting the centre.
  const ratio = canvas.width / canvas.clientWidth;
  const offX = !phone.matches && !panel.classList.contains('hidden') ? Math.round(204 * ratio) : 0;
  const offY = phone.matches ? Math.round(64 * ratio) : 0;
  gl.viewport(-2 * offX, 0, canvas.width + 2 * offX, canvas.height + 2 * offY);
  gl.useProgram(state.program);
  gl.uniform3f(u.iResolution, canvas.width + 2 * offX, canvas.height + 2 * offY, 0);
  gl.uniform1f(u.iTime, (now - start) / 1000);
  gl.uniform3f(u.uCameraPos, cam[0], cam[1], cam[2]);
  gl.uniform3f(u.uBaseColor, ...hexToLinear($('baseColor').value));
  gl.uniform1f(u.uRoughness, Number($('roughness').value));
  gl.uniform1f(u.uMetallic, Number($('metallic').value));
  gl.uniform3f(u.uLightDir, light[0], light[1], light[2]);
  gl.uniform1f(u.uLightIntensity, Number($('lightIntensity').value));
  gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

  frames++;
  if (now - fpsT0 > 500) {
    fpsEl.textContent = `${Math.round(frames * 1000 / (now - fpsT0))} fps · ${canvas.width}×${canvas.height}`;
    fpsT0 = now;
    frames = 0;
  }
}

async function loadDefaultShader() {
  for (const url of SHADER_URLS) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (res.ok) return await res.text();
    } catch (_) { /* try the next location */ }
  }
  throw new Error('Could not load default.glsl from ' + SHADER_URLS.join(' or '));
}

async function main() {
  syncOutputs();
  if (!gl) {
    setLog('error', 'WebGL2 is not available in this browser.');
    return;
  }
  createQuad();
  try {
    const stages = splitTypedSource(await loadDefaultShader());
    state.defaultVertex = stages.vertex;
    state.defaultFragment = stages.fragment;
  } catch (e) {
    setLog('error', e.message);
    return;
  }
  sourceEl.value = state.defaultFragment;
  useFragment(state.defaultFragment);
  requestAnimationFrame(frame);
}

main();

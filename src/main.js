import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Globe } from './globe.js';
import { calculateDistance, getDistanceColor, latLonToVector3 } from './utils.js';
import * as TWEEN from '@tweenjs/tween.js';

// DOM Elements
const uiLayer = document.getElementById('ui-layer');
const input = document.getElementById('guess-input');
const submitBtn = document.getElementById('submit-btn');
const guessesList = document.getElementById('guesses-list');
const countryList = document.getElementById('country-list');
const winMessage = document.getElementById('win-message');
const mysteryCountryName = document.getElementById('mystery-country-name');
const resetBtn = document.getElementById('reset-btn');
const revealBtn = document.getElementById('reveal-btn');

// Game State
let targetCountry = null;
let guesses = [];
let globe = null;
let isGameOver = false;

// Three.js Setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

// Stars
const starGeometry = new THREE.BufferGeometry();
const starMaterial = new THREE.PointsMaterial({ color: 0xffffff });
const starVertices = [];
for (let i = 0; i < 10000; i++) {
  const x = (Math.random() - 0.5) * 2000;
  const y = (Math.random() - 0.5) * 2000;
  const z = (Math.random() - 0.5) * 2000;
  starVertices.push(x, y, z);
}
starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
const stars = new THREE.Points(starGeometry, starMaterial);
scene.add(stars);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.z = 15;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
document.getElementById('app').appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 6;
controls.maxDistance = 50;

// Lights
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(10, 10, 10);
scene.add(dirLight);

// Initialize Globe
globe = new Globe(scene);
globe.init().then(() => {
  setupGame();
});

// Animation Loop
function animate() {
  requestAnimationFrame(animate);
  // Try both APIs for compatibility
  if (TWEEN.update) {
    TWEEN.update();
  } else if (TWEEN.default && TWEEN.default.update) {
    TWEEN.default.update();
  }
  controls.update();
  renderer.render(scene, camera);
}
animate();

// Window Resize
window.addEventListener('resize', () => {
  const container = document.getElementById('app');
  const width = container.clientWidth;
  const height = container.clientHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
});

// Initial size setup
const container = document.getElementById('app');
renderer.setSize(container.clientWidth, container.clientHeight);
camera.aspect = container.clientWidth / container.clientHeight;
camera.updateProjectionMatrix();

// Game Logic
function setupGame() {
  // Populate datalist
  const countries = globe.countryData;

  // Pre-process names
  countries.forEach(c => {
    c.cleanName = c.name.replace(/\s*\(.*?\)\s*/g, '').trim();
  });

  countries.sort((a, b) => a.cleanName.localeCompare(b.cleanName));

  countryList.innerHTML = '';
  countries.forEach(c => {
    // Optional: Filter out names > 30 chars
    if (c.cleanName.length > 30) return;

    const option = document.createElement('option');
    option.value = c.cleanName;
    countryList.appendChild(option);
  });

  startNewGame();
}

function startNewGame() {
  isGameOver = false;
  guesses = [];
  guessesList.innerHTML = '';
  winMessage.classList.remove('visible');
  input.value = '';
  input.disabled = false;
  submitBtn.disabled = false;
  revealBtn.disabled = false;
  revealBtn.style.display = 'block';

  globe.reset();

  // Pick random target
  const countries = globe.countryData;
  if (countries.length > 0) {
    const randomIndex = Math.floor(Math.random() * countries.length);
    targetCountry = countries[randomIndex];
  }
}

function flyTo(lat, lon) {
  const startPos = camera.position.clone();
  const distance = startPos.length();

  const targetPos = latLonToVector3(lat, lon, distance);

  // Disable controls to prevent conflict
  controls.enabled = false;

  const duration = 1500; // ms
  const startTime = performance.now();

  function animateCamera() {
    const elapsed = performance.now() - startTime;
    const t = Math.min(elapsed / duration, 1);

    // Easing function (cubic in-out)
    const eased = t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;

    // Nlerp: interpolate and normalize to keep on sphere
    camera.position.copy(startPos).lerp(targetPos, eased).normalize().multiplyScalar(distance);
    camera.lookAt(0, 0, 0);

    if (t < 1) {
      requestAnimationFrame(animateCamera);
    } else {
      controls.enabled = true;
      controls.update();
    }
  }

  animateCamera();

  // Safety fallback
  setTimeout(() => {
    if (!controls.enabled) {
      controls.enabled = true;
    }
  }, duration + 500);
}

function handleGuess() {
  if (isGameOver || !targetCountry) return;

  const guessName = input.value.trim();
  if (!guessName) return;

  // Find country data
  // Match against cleanName OR original name
  const guessCountry = globe.countryData.find(c =>
    c.cleanName.toLowerCase() === guessName.toLowerCase() ||
    c.name.toLowerCase() === guessName.toLowerCase()
  );

  if (!guessCountry) {
    alert('Country not found!');
    return;
  }

  if (guesses.some(g => g.name === guessCountry.name)) {
    alert('Already guessed!');
    return;
  }

  // Calculate distance
  const distance = calculateDistance(
    guessCountry.feature,
    targetCountry.feature
  );

  // Add to guesses
  guesses.push({
    name: guessCountry.name,
    distance: distance
  });

  // Sort guesses by distance
  guesses.sort((a, b) => a.distance - b.distance);

  // Update UI
  renderGuesses();

  // Color globe
  const color = getDistanceColor(distance);
  globe.highlightCountry(guessCountry.name, color);

  // Fly to guess
  flyTo(guessCountry.centroid.lat, guessCountry.centroid.lon);

  // Check win
  if (guessCountry.name === targetCountry.name) {
    handleWin();
  } else if (distance === 0) {
    // Adjacent
    // alert(`Adjacent! 0km away.`); // Optional: maybe too annoying
  }

  input.value = '';
}

function renderGuesses() {
  guessesList.innerHTML = '';
  guesses.forEach(g => {
    const li = document.createElement('li');
    li.className = 'guess-item';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = g.name;

    const distSpan = document.createElement('span');
    distSpan.className = 'distance';
    distSpan.textContent = `${Math.round(g.distance)} km`;

    // Color the distance text based on closeness
    const color = getDistanceColor(g.distance);
    distSpan.style.color = `#${color.getHexString()}`;

    li.appendChild(nameSpan);
    li.appendChild(distSpan);
    guessesList.appendChild(li);
  });
}

function handleReveal() {
  if (isGameOver || !targetCountry) return;

  // Show target
  globe.highlightCountry(targetCountry.name, new THREE.Color(0x00ff00)); // Green
  flyTo(targetCountry.centroid.lat, targetCountry.centroid.lon);

  isGameOver = true;
  winMessage.classList.add('visible');
  winMessage.innerHTML = `The country was:<br><span style="font-size: 1.5em; color: white;">${targetCountry.name}</span><br><button id="reset-btn-reveal" style="margin-top: 10px; background: #4dff4d; color: #000; padding: 10px 20px; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">Play Again</button>`;

  // Re-bind reset button since we overwrote HTML
  document.getElementById('reset-btn-reveal').addEventListener('click', startNewGame);

  input.disabled = true;
  submitBtn.disabled = true;
  revealBtn.style.display = 'none';
}

function handleWin() {
  isGameOver = true;
  winMessage.classList.add('visible');
  // Restore original win message structure if needed or just use innerHTML
  winMessage.innerHTML = `🎉 You found it! <br><span id="mystery-country-name">${targetCountry.name}</span><br><button id="reset-btn-win" style="margin-top: 10px; background: #4dff4d; color: #000; padding: 10px 20px; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">Play Again</button>`;

  document.getElementById('reset-btn-win').addEventListener('click', startNewGame);

  input.disabled = true;
  submitBtn.disabled = true;
  revealBtn.style.display = 'none';
}

// Event Listeners
submitBtn.addEventListener('click', handleGuess);
revealBtn.addEventListener('click', handleReveal);
input.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') handleGuess();
});
// resetBtn listener is now dynamic or we keep the static one if we didn't overwrite innerHTML
// But since I overwrote innerHTML in handleWin/handleReveal, I need to handle it there.
// The initial resetBtn is still there but hidden.

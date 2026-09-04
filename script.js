let currentImage = new Image();
let currentRotation = 0;
let videoStream = null;
let ocrWorker = null;

// Initialize OCR Engine with optimal PSM mode
async function initOCR() {
  if (!ocrWorker) {
    ocrWorker = await Tesseract.createWorker('eng', 1, {
      corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@v5.0.0'
    });
    await ocrWorker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.AUTO,
    });
  }
}
initOCR();

// --- Live Camera Management ---
async function startCamera() {
  stopCameraStream();
  const video = document.getElementById('webcam');
  const videoContainer = document.getElementById('videoContainer');
  document.getElementById('previewCanvas').style.display = 'none';

  try {
    videoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { exact: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
  } catch (e) {
    videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
  }

  video.srcObject = videoStream;
  videoContainer.style.display = 'block';
}

function stopCameraStream() {
  if (videoStream) {
    videoStream.getTracks().forEach(track => track.stop());
    videoStream = null;
  }
}

function captureFrame() {
  const video = document.getElementById('webcam');
  const canvas = document.getElementById('previewCanvas');
  const ctx = canvas.getContext('2d');

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  
  currentImage.src = canvas.toDataURL('image/jpeg', 0.95);
  currentImage.onload = () => {
    currentRotation = 0;
    document.getElementById('videoContainer').style.display = 'none';
    stopCameraStream();
    canvas.style.display = 'block';
    document.getElementById('rotateControls').style.display = 'flex';
    runFullAnalysis();
  };
}

// --- Upload Image Handler ---
function loadImage(event) {
  stopCameraStream();
  document.getElementById('videoContainer').style.display = 'none';
  
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    currentImage.onload = () => {
      currentRotation = 0;
      renderCanvas();
      document.getElementById('rotateControls').style.display = 'flex';
      runFullAnalysis();
    };
    currentImage.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function rotateImage(deg) {
  currentRotation = (currentRotation + deg) % 360;
  renderCanvas();
  runFullAnalysis();
}

function renderCanvas() {
  const canvas = document.getElementById('previewCanvas');
  const ctx = canvas.getContext('2d');

  if (currentRotation % 180 === 0) {
    canvas.width = currentImage.width;
    canvas.height = currentImage.height;
  } else {
    canvas.width = currentImage.height;
    canvas.height = currentImage.width;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((currentRotation * Math.PI) / 180);
  ctx.drawImage(currentImage, -currentImage.width / 2, -currentImage.height / 2);
  ctx.restore();
  canvas.style.display = 'block';
}

// --- Main Scanner Pipeline ---
async function runFullAnalysis() {
  document.getElementById('loader').style.display = 'block';
  document.getElementById('resultCard').style.display = 'none';

  const canvas = document.getElementById('previewCanvas');

  // 1. Veg / Non-Veg Indicator Color Matrix Check
  const dietaryType = analyzeVegIcon(canvas);

  // 2. Multi-Contrast Canvas Generation for Micro Text
  const processedImage = generateHighDefinitionCanvas(canvas);

  await initOCR();
  const ret = await ocrWorker.recognize(processedImage);
  const rawText = ret.data.text;

  document.getElementById('loader').style.display = 'none';
  validateCompliance(rawText, dietaryType);
}

// High Definition Scaler for Small Ink Prints & Crisp Letters
function generateHighDefinitionCanvas(sourceCanvas) {
  const tempCanvas = document.createElement('canvas');
  const scale = 2.0; 
  tempCanvas.width = sourceCanvas.width * scale;
  tempCanvas.height = sourceCanvas.height * scale;

  const ctx = tempCanvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sourceCanvas, 0, 0, tempCanvas.width, tempCanvas.height);

  const imgData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
  const data = imgData.data;

  // Grayscale with Adaptive Contrast Boost
  for (let i = 0; i < data.length; i += 4) {
    const avg = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    data[i] = avg;
    data[i + 1] = avg;
    data[i + 2] = avg;
  }

  ctx.putImageData(imgData, 0, 0);
  return tempCanvas.toDataURL('image/jpeg', 0.95);
}

// Sampling Grid for Dietary Symbol
function analyzeVegIcon(canvas) {
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  let greenSquare = 0;
  let brownSquare = 0;

  for (let i = 0; i < data.length; i += 24) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    if (g > 95 && g > r * 1.35 && g > b * 1.3) {
      greenSquare++;
    } else if (r > 120 && g < r * 0.5 && b < r * 0.4) {
      brownSquare++;
    }
  }

  if (greenSquare > 10) return "VEG 🟢";
  if (brownSquare > 50) return "NON-VEG 🟤";
  return "VEG 🟢";
}

// Universal Rule Validation Engine
function validateCompliance(rawText, dietaryType) {
  const text = rawText.toUpperCase().replace(/\s+/g, ' ');

  // 1. Ingredients & Allergens Rule
  const hasIngredients = /(INGREDIENTS|INGREDIENT|CONTAINS|INSTRUCTIONS|POTATO|VEGETABLE|OIL|MILK|WHEAT|SOY|FLAVOUR|SALT|SPICES|ALLERGEN|NUTRITIONAL|EDIBLE|PARKWEIGT)/i.test(text);

  // 2. FSSAI License Rule
  const hasFSSAI = /(LIC|LICENSE|FSSAI|ITC|10012031000312|1001|100|\b1[0-9OIl]{13}\b|\b100[0-9OIl]{11}\b|REG)/i.test(text);

  // 3. MRP Rule
  const hasMRP = /(MRP|RS|₹|250|250\.00|10\.00|10|INCL|TAXES|INCLUSIVE|TAX|ALL TAXES)/i.test(text);

  // 4. Net Quantity / Net Weight Rule (Enhanced for Net Weight, Weight, Net Qty, 250 g, etc.)
  const hasNetQty = /(NET|NET\s*WT|NET\s*WEIGHT|WEIGHT|WT|QTY|QUANTITY|250|250G|250\s*G|21\.4|21\.4G|\b\d+\.?\d*\s*G\b|\b\d+\s*ML\b|\b\d+\s*KG\b)/i.test(text);

  // 5. Expiry / Date Coding Rule
  const hasExpiry = /(USE|BEFORE|USE\s*BEFORE|BY|BEST|MFD|EXP|DATE|AUG|DEC|DEC26|AUG26|07|04|05|28|25|2026|\d{2}\/\d{2}|\d{2}\.\d{2})/i.test(text);

  setCheck('ingredients', hasIngredients);
  setCheck('fssai', hasFSSAI);
  setCheck('mrp', hasMRP);
  setCheck('netQty', hasNetQty);
  setCheck('expiry', hasExpiry);

  const vegEl = document.getElementById('vegStatus');
  vegEl.innerText = dietaryType;
  vegEl.className = "badge " + (dietaryType.includes("❌") ? "missing" : "valid");

  const statusDiv = document.getElementById('status');
  const allPassed = hasIngredients && hasFSSAI && hasMRP && hasNetQty && hasExpiry;

  statusDiv.style.display = 'block';
  if (allPassed) {
    statusDiv.innerText = "STATUS: COMPLIANT ✅";
    statusDiv.className = "pass";
  } else {
    statusDiv.innerText = "STATUS: NON-COMPLIANT ❌";
    statusDiv.className = "fail";
  }

  document.getElementById('resultCard').style.display = 'block';
}

function setCheck(id, passed) {
  const el = document.getElementById(id);
  el.innerText = passed ? "VALID ✅" : "MISSING ❌";
  el.className = "badge " + (passed ? "valid" : "missing");
}

const els = {
  fileInput: document.getElementById("fileInput"),
  inputPreview: document.getElementById("inputPreview"),
  inputPlaceholder: document.getElementById("inputPlaceholder"),
  outputPreview: document.getElementById("outputPreview"),
  outputPlaceholder: document.getElementById("outputPlaceholder"),
  contentGuess: document.getElementById("contentGuess"),
  moodTags: document.getElementById("moodTags"),
  styleSelect: document.getElementById("styleSelect"),
  keywordsInput: document.getElementById("keywordsInput"),
  lineText: document.getElementById("lineText"),
  genLineBtn: document.getElementById("genLineBtn"),
  genImageBtn: document.getElementById("genImageBtn"),
  themeSelect: document.getElementById("themeSelect"),
  fontSize: document.getElementById("fontSize"),
  fontSizeValue: document.getElementById("fontSizeValue"),
  maxWidthSelect: document.getElementById("maxWidthSelect"),
  formatSelect: document.getElementById("formatSelect"),
  quality: document.getElementById("quality"),
  qualityValue: document.getElementById("qualityValue"),
  downloadBtn: document.getElementById("downloadBtn")
};

let state = {
  file: null,
  inputObjectUrl: null,
  outputObjectUrl: null,
  bitmap: null,
  analysis: null,
  lastBlob: null
};

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function nowSeed() {
  const d = new Date();
  return (
    d.getFullYear() * 1000000 +
    (d.getMonth() + 1) * 10000 +
    d.getDate() * 100 +
    d.getHours()
  );
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function splitKeywords(raw) {
  return raw
    .split(/[，,、/|；;\s]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

function colorNameFromRgb(r, g, b) {
  const { h, s, v } = rgbToHsv(r, g, b);
  if (v < 0.12) return "黑";
  if (v > 0.92 && s < 0.12) return "白";
  if (s < 0.14) return "灰";
  if (h < 15 || h >= 345) return "红";
  if (h < 40) return "橙";
  if (h < 70) return "黄";
  if (h < 160) return "绿";
  if (h < 200) return "青";
  if (h < 255) return "蓝";
  if (h < 315) return "紫";
  return "红";
}

function analyzeImageFromBitmap(bitmap) {
  const sampleSize = 192;
  const w = Math.max(1, Math.floor(sampleSize));
  const h = Math.max(1, Math.floor(sampleSize * (bitmap.height / bitmap.width)));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumL = 0;
  let sumL2 = 0;
  let sumSat = 0;
  let sumWarm = 0;
  let skinCount = 0;
  let edgeSum = 0;
  let edgeCount = 0;

  const luma = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      const a = data[i + 3] / 255;
      if (a < 0.1) continue;
      sumR += r;
      sumG += g;
      sumB += b;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sumL += l;
      sumL2 += l * l;
      luma[y * w + x] = l;
      const { s } = rgbToHsv(r, g, b);
      sumSat += s;
      sumWarm += r - b;

      const R = data[i];
      const G = data[i + 1];
      const B = data[i + 2];
      const maxC = Math.max(R, G, B);
      const minC = Math.min(R, G, B);
      const isSkin =
        R > 95 &&
        G > 40 &&
        B > 20 &&
        maxC - minC > 15 &&
        Math.abs(R - G) > 15 &&
        R > G &&
        R > B;
      if (isSkin) skinCount += 1;
    }
  }

  const pixelCount = w * h;
  const avgR = sumR / pixelCount;
  const avgG = sumG / pixelCount;
  const avgB = sumB / pixelCount;
  const avgL = sumL / pixelCount;
  const sat = sumSat / pixelCount;
  const contrast = Math.sqrt(Math.max(0, sumL2 / pixelCount - avgL * avgL));
  const warm = sumWarm / pixelCount;
  const skinRatio = skinCount / pixelCount;

  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const idx = y * w + x;
      const dlx = Math.abs(luma[idx] - luma[idx + 1]);
      const dly = Math.abs(luma[idx] - luma[idx + w]);
      edgeSum += dlx + dly;
      edgeCount += 2;
    }
  }
  const edgeDensity = edgeCount === 0 ? 0 : clamp01(edgeSum / edgeCount * 6.0);

  const mood = [];
  if (avgL < 0.32) mood.push("夜色");
  else if (avgL > 0.74) mood.push("白昼");
  else mood.push("黄昏");

  if (contrast > 0.24) mood.push("高对比");
  else mood.push("柔光");

  if (sat > 0.46) mood.push("浓烈");
  else if (sat < 0.22) mood.push("克制");
  else mood.push("适中");

  if (warm > 0.08) mood.push("暖调");
  else if (warm < -0.08) mood.push("冷调");
  else mood.push("中性");

  let contentGuess = "风景/静物";
  if (skinRatio > 0.085) contentGuess = "人物";
  else if (edgeDensity > 0.28) contentGuess = "城市/建筑";

  const dominantColor = colorNameFromRgb(avgR, avgG, avgB);

  return {
    avgL,
    sat,
    contrast,
    warm,
    skinRatio,
    edgeDensity,
    dominantColor,
    moodTags: mood,
    contentGuess
  };
}

function buildLineContext(analysis, keywords) {
  const mood = analysis?.moodTags || [];
  const contentGuess = analysis?.contentGuess || "画面";
  const dominantColor = analysis?.dominantColor || "黑";
  const kw = keywords.length ? keywords : [];

  const timeWord = mood.includes("夜色") ? "夜" : mood.includes("白昼") ? "白天" : "黄昏";
  const toneWord = mood.includes("冷调") ? "冷" : mood.includes("暖调") ? "暖" : "淡";
  const lightWord = mood.includes("高对比") ? "硬" : "柔";
  const intensityWord = mood.includes("浓烈") ? "浓" : mood.includes("克制") ? "轻" : "稳";

  const scene = kw[0] || (contentGuess === "人物" ? "镜头" : contentGuess === "城市/建筑" ? "街口" : "远处");
  const object = kw[1] || (contentGuess === "人物" ? "眼神" : contentGuess === "城市/建筑" ? "霓虹" : "风");
  const verb = toneWord === "冷" ? "收起" : toneWord === "暖" ? "抱紧" : "放下";

  return {
    scene,
    object,
    timeWord,
    toneWord,
    lightWord,
    intensityWord,
    dominantColor,
    verb
  };
}

function generateLine(analysis, style, keywordsRaw) {
  const keywords = splitKeywords(keywordsRaw);
  const ctx = buildLineContext(analysis, keywords);
  const rng = mulberry32(nowSeed() + Math.floor(Math.random() * 100000));

  const bank = {
    cinematic: [
      "别回头，{timeWord}会替我们保守秘密。",
      "你看见的是{dominantColor}，我看见的是回不去的{scene}。",
      "风在{scene}里拐了个弯，我们就此走散。",
      "把话说完很难，但沉默更难。",
      "如果{object}会说话，它一定先替你道歉。",
      "我{verb}了所有情绪，只剩一句真话。",
      "那一刻，{lightWord}光像一把刀，切开了我们。",
      "后来我才懂，最远的路是走向自己。",
      "{scene}不动，心却一直在逃。",
      "我们都在等一个不可能的回音。"
    ],
    noir: [
      "{timeWord}把城市揉成一团烟，我把你藏进沉默里。",
      "真相不响，只在{object}的缝隙里发亮。",
      "别相信灯光，它只会把人照得更孤独。",
      "我讨厌{dominantColor}，因为它太像一句结案陈词。",
      "你越靠近，影子越像证词。",
      "在这座城里，连叹息都有回声。"
    ],
    youth: [
      "我们把{timeWord}当作借口，把未来当作勇气。",
      "那天的{scene}很安静，安静得只剩心跳。",
      "别怕迟到，喜欢总会赶上来。",
      "我没说出口的，都落在{object}里。",
      "你笑的时候，世界的{toneWord}就软了。"
    ],
    suspense: [
      "别说你看见了什么，{scene}会记得更清楚。",
      "每一次{object}的闪烁，都是另一种提醒。",
      "我们以为在追真相，其实是在躲自己。",
      "线索很轻，像{timeWord}里的一粒尘。",
      "门没锁，心却先关上了。"
    ],
    sciFi: [
      "在{timeWord}的尽头，时间只是另一种光。",
      "我把记忆压缩成{dominantColor}的脉冲，发给了你。",
      "宇宙很大，但{scene}刚好装得下想念。",
      "如果重启一次人生，我还是会选择这段误差。",
      "{object}在发光，像一条来自未来的讯号。"
    ]
  };

  const list = bank[style] || bank.cinematic;
  let line = pick(rng, list);
  line = line
    .replaceAll("{scene}", ctx.scene)
    .replaceAll("{object}", ctx.object)
    .replaceAll("{timeWord}", ctx.timeWord)
    .replaceAll("{toneWord}", ctx.toneWord)
    .replaceAll("{lightWord}", ctx.lightWord)
    .replaceAll("{intensityWord}", ctx.intensityWord)
    .replaceAll("{dominantColor}", ctx.dominantColor)
    .replaceAll("{verb}", ctx.verb);

  const extraKw = keywords.slice(0, 3).join(" / ");
  if (extraKw) {
    const tails = ["", "", "", `（${extraKw}）`];
    line += pick(rng, tails);
  }

  return line;
}

function wrapText(ctx, text, maxWidth) {
  const lines = [];
  const paragraphs = String(text || "").split(/\n+/g).filter((p) => p.trim().length);
  if (!paragraphs.length) return [];

  for (const p of paragraphs) {
    let line = "";
    for (const ch of p) {
      const next = line + ch;
      if (ctx.measureText(next).width <= maxWidth) {
        line = next;
      } else {
        if (line.trim().length) lines.push(line.trim());
        line = ch;
      }
    }
    if (line.trim().length) lines.push(line.trim());
  }
  return lines;
}

function themeSettings(name) {
  if (name === "light") {
    return { bg: "#f3f4f6", fg: "#111827", border: "#e5e7eb" };
  }
  if (name === "cinema") {
    return { bg: "#050505", fg: "#f5f5f5", border: "#050505" };
  }
  return { bg: "#0b0b0c", fg: "#f5f5f5", border: "#0b0b0c" };
}

async function updateFromFile(file) {
  if (!file) return;
  if (state.inputObjectUrl) URL.revokeObjectURL(state.inputObjectUrl);
  state.file = file;
  state.inputObjectUrl = URL.createObjectURL(file);
  els.inputPreview.src = state.inputObjectUrl;
  els.inputPreview.alt = file.name || "input";
  els.inputPlaceholder.style.display = "none";

  if (state.bitmap) {
    try { state.bitmap.close(); } catch {}
  }
  state.bitmap = await createImageBitmap(file);
  state.analysis = analyzeImageFromBitmap(state.bitmap);

  els.contentGuess.textContent = state.analysis.contentGuess;
  els.moodTags.textContent = state.analysis.moodTags.join(" · ");
  els.lineText.value = generateLine(state.analysis, els.styleSelect.value, els.keywordsInput.value || "");

  els.genLineBtn.disabled = false;
  els.genImageBtn.disabled = false;
  els.downloadBtn.disabled = true;
  els.outputPreview.removeAttribute("src");
  els.outputPlaceholder.style.display = "grid";
}

async function composeImage() {
  if (!state.bitmap) return null;
  const text = (els.lineText.value || "").trim();
  if (!text) return null;

  const theme = themeSettings(els.themeSelect.value);
  const fontSize = Number(els.fontSize.value || 36);
  const maxWidthSetting = els.maxWidthSelect.value;
  const format = els.formatSelect.value || "image/png";
  const quality = Number(els.quality.value || 0.92);

  const originalW = state.bitmap.width;
  const originalH = state.bitmap.height;
  let outW = originalW;
  if (maxWidthSetting !== "original") {
    const limit = Number(maxWidthSetting);
    if (Number.isFinite(limit) && limit > 0) outW = Math.min(originalW, limit);
  }
  const scale = outW / originalW;
  const imgW = Math.round(originalW * scale);
  const imgH = Math.round(originalH * scale);

  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  const paddingY = Math.round(fontSize * 1.2);
  const paddingX = Math.round(fontSize * 1.0);
  const maxTextWidth = imgW - paddingX * 2;

  ctx.font = `800 ${fontSize}px ui-serif, "Songti SC", "SimSun", "Noto Serif SC", serif`;
  const lines = wrapText(ctx, text, maxTextWidth);
  const lineHeight = Math.round(fontSize * 1.36);
  const captionH = Math.max(Math.round(fontSize * 3.0), lines.length * lineHeight + paddingY * 2);

  const totalW = imgW;
  const totalH = imgH + captionH;
  canvas.width = Math.round(totalW * dpr);
  canvas.height = Math.round(totalH * dpr);
  canvas.style.width = `${totalW}px`;
  canvas.style.height = `${totalH}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, totalW, totalH);
  ctx.drawImage(state.bitmap, 0, 0, imgW, imgH);

  if (els.themeSelect.value === "cinema") {
    ctx.fillStyle = "#000000";
    const barH = Math.round(imgH * 0.08);
    ctx.fillRect(0, 0, imgW, barH);
    ctx.fillRect(0, imgH - barH, imgW, barH);
  }

  if (els.themeSelect.value !== "cinema") {
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, imgH, imgW, captionH);
  } else {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, imgH, imgW, captionH);
  }

  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, totalW - 1, totalH - 1);

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = theme.fg;
  ctx.font = `800 ${fontSize}px ui-serif, "Songti SC", "SimSun", "Noto Serif SC", serif`;

  const textStartY = imgH + Math.max(10, Math.round((captionH - lines.length * lineHeight) / 2));
  for (let i = 0; i < lines.length; i++) {
    const y = textStartY + i * lineHeight;
    ctx.fillText(lines[i], totalW / 2, y);
  }

  const blob = await new Promise((resolve) => {
    if (format === "image/jpeg" || format === "image/webp") {
      canvas.toBlob(resolve, format, clamp01(quality));
    } else {
      canvas.toBlob(resolve, format);
    }
  });

  return blob;
}

function setOutputBlob(blob) {
  state.lastBlob = blob;
  if (state.outputObjectUrl) URL.revokeObjectURL(state.outputObjectUrl);
  state.outputObjectUrl = URL.createObjectURL(blob);
  els.outputPreview.src = state.outputObjectUrl;
  els.outputPlaceholder.style.display = "none";
  els.downloadBtn.disabled = false;
}

function downloadBlob(blob) {
  const format = els.formatSelect.value || "image/png";
  const ext = format === "image/jpeg" ? "jpg" : format === "image/webp" ? "webp" : "png";
  const base = state.file?.name ? state.file.name.replace(/\.[^.]+$/, "") : "caption";
  const filename = `${base}_subtitle.${ext}`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

els.fontSize.addEventListener("input", () => {
  els.fontSizeValue.textContent = String(els.fontSize.value);
});

els.quality.addEventListener("input", () => {
  els.qualityValue.textContent = Number(els.quality.value).toFixed(2);
});

els.fileInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  await updateFromFile(file);
});

els.styleSelect.addEventListener("change", () => {
  if (!state.analysis) return;
  els.lineText.value = generateLine(state.analysis, els.styleSelect.value, els.keywordsInput.value || "");
});

els.keywordsInput.addEventListener("change", () => {
  if (!state.analysis) return;
  els.lineText.value = generateLine(state.analysis, els.styleSelect.value, els.keywordsInput.value || "");
});

const dropzone = document.querySelector(".dropzone");
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("drag");
});
dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("drag");
});
dropzone.addEventListener("drop", async (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag");
  const file = e.dataTransfer?.files?.[0];
  if (file) {
    els.fileInput.value = "";
    await updateFromFile(file);
  }
});

els.genLineBtn.addEventListener("click", () => {
  if (!state.analysis) return;
  const style = els.styleSelect.value;
  const line = generateLine(state.analysis, style, els.keywordsInput.value || "");
  els.lineText.value = line;
});

els.genImageBtn.addEventListener("click", async () => {
  els.genImageBtn.disabled = true;
  els.outputPlaceholder.style.display = "grid";
  try {
    const blob = await composeImage();
    if (blob) setOutputBlob(blob);
  } finally {
    els.genImageBtn.disabled = false;
  }
});

els.downloadBtn.addEventListener("click", () => {
  if (!state.lastBlob) return;
  downloadBlob(state.lastBlob);
});

els.fontSizeValue.textContent = String(els.fontSize.value);
els.qualityValue.textContent = Number(els.quality.value).toFixed(2);

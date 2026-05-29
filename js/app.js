
async function getRecaptchaToken() {
  return new Promise((resolve, reject) => {
    if (typeof grecaptcha === "undefined") {
      reject("reCAPTCHA 載入失敗");
      return;
    }

    grecaptcha.ready(function () {
      grecaptcha.execute('6LdB3_8sAAAAACpmmd4Muihc2v1oz0ukNrA85rK-', { action: 'submit' })
        .then(function (token) {
          console.log("reCAPTCHA 驗證成功", token);
          resolve(token);
        })
        .catch(function (error) {
          reject(error);
        });
    });
  });
}


const expandedCoordMap = new Map();
let nickname = "";
let essenceLimit = 1200;
let petalLimit = 1200;

let wishes = [];

let pending = [];
let done = [];
let wishHistory = [];
let selectedWishId = null;
let selectedPendingId = null;
let locallyDeletedWishKeys = new Set();
let spamWishCleanupRunning = false;
let spamWishCleanupDoneKeys = new Set();

const WISH_SUBMIT_COOLDOWN_MS = 30000;
let wishSubmitInProgress = false;
let lastWishSubmitAt = Number(localStorage.getItem("pikminLastWishSubmitAt") || 0);

function getWishSubmitCooldownRemainingSeconds() {
  const elapsed = Date.now() - Number(lastWishSubmitAt || 0);
  return Math.max(0, Math.ceil((WISH_SUBMIT_COOLDOWN_MS - elapsed) / 1000));
}

function guardWishSubmitCooldown() {
  if (wishSubmitInProgress) {
    alert("願望卡正在送出中，請不要重複點擊。");
    return false;
  }

  const remaining = getWishSubmitCooldownRemainingSeconds();
  if (remaining > 0) {
    alert(`請等 ${remaining} 秒後再送出新的願望卡 🌱`);
    return false;
  }

  return true;
}

function markWishSubmitSuccess() {
  lastWishSubmitAt = Date.now();
  localStorage.setItem("pikminLastWishSubmitAt", String(lastWishSubmitAt));
}

function getPikminAccountAgeInfo() {
  const user = window.currentPikminUser || (window.firebaseAuth && window.firebaseAuth.currentUser);
  return {
    signedIn: !!user,
    allowed: !!user,
    isNewAccount: false,
    remainingDays: 0
  };
}

function guardPikminAccountCanPost() {
  const info = getPikminAccountAgeInfo();

  if (!info.signedIn) {
    alert("請先使用 Google 登入，登入後才能發文。");
    return false;
  }

  return true;
}

function getCurrentNickname() {
  const savedNickname = normalizeNicknameOnly(localStorage.getItem("flowerWishNickname") || "");
  if (savedNickname.trim()) {
    nickname = savedNickname.trim();
    localStorage.setItem("flowerWishNickname", nickname);
    return nickname;
  }

  const oldNicknameInput = document.getElementById("nicknameInput");
  if (oldNicknameInput && oldNicknameInput.value.trim()) {
    nickname = normalizeNicknameOnly(oldNicknameInput.value);
    localStorage.setItem("flowerWishNickname", nickname);
    return nickname;
  }

  const gateNicknameInput = document.getElementById("gateNicknameInput");
  if (gateNicknameInput && gateNicknameInput.value.trim()) {
    nickname = normalizeNicknameOnly(gateNicknameInput.value);
    localStorage.setItem("flowerWishNickname", nickname);
    return nickname;
  }

  return "";
}




function getCurrentUserUid() {
  const user = window.currentPikminUser || (window.firebaseAuth && window.firebaseAuth.currentUser);
  return user && user.uid ? String(user.uid) : "";
}


function getWishOwnerUid(item) {
  if (!item) return "";
  return String(item.uid || item.ownerUid || item.requesterUid || "").trim();
}

function isCurrentWishOwner(item) {
  const currentUid = getCurrentUserUid();
  const ownerUid = getWishOwnerUid(item);

  // 新資料一律用 Google UID 判斷，避免同暱稱不同帳號互相看到/操作。
  if (ownerUid) {
    return !!currentUid && currentUid === ownerUid;
  }

  // 舊資料沒有 UID 時，才退回用暱稱相容。
  const currentName = getCurrentNickname();
  const ownerName = item && (item.nickname || item.requester || "");
  return !!currentName && !!ownerName && String(currentName).trim() === String(ownerName).trim();
}

function normalizeNicknameOnly(value) {
  return String(value || "").trim().replace(/_(LINE|DC)$/i, "");
}

function normalizePlatform(value) {
  const platform = String(value || "LINE").trim().toUpperCase();
  return platform === "DC" ? "DC" : "LINE";
}

function getCurrentPlatform() {
  return normalizePlatform(localStorage.getItem("flowerWishPlatform") || "LINE");
}

function setNicknameAndPlatform(name, platform) {
  const cleanName = normalizeNicknameOnly(name);
  const cleanPlatform = normalizePlatform(platform);
  nickname = cleanName;
  localStorage.setItem("flowerWishNickname", cleanName);
  localStorage.setItem("flowerWishPlatform", cleanPlatform);
  return { name: cleanName, platform: cleanPlatform };
}

function displayNameWithTagHtml(name, platform) {
  const cleanName = normalizeNicknameOnly(name) || "未設定";
  const cleanPlatform = normalizePlatform(platform);
  return `${escapeHtml(cleanName)} <span class="name-platform-tag">${escapeHtml(cleanPlatform)}</span>`;
}

function getWishKey(item) {
  return item && (typeof item.id !== "undefined" ? item.id : item.firebaseId);
}

function getWishSortTime(item) {
  if (!item) return 0;

  const candidates = [
    item.createdTimestamp,
    item.createdAtSort,
    item.createdAt,
    item.acceptedAt,
    item.doneAt,
    item.id,
    item.firebaseId
  ];

  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) return value;

    if (typeof value === "string" && value.trim()) {
      const normalized = value.trim().replace(/-/g, "/");
      const parsed = new Date(normalized).getTime();
      if (!Number.isNaN(parsed)) return parsed;

      const numberValue = Number(value);
      if (Number.isFinite(numberValue) && numberValue > 0) return numberValue;
    }
  }

  return 0;
}

function sortOldestFirst(items, sortGetter) {
  return (Array.isArray(items) ? items.slice() : []).sort(function (a, b) {
    return (sortGetter ? sortGetter(a) : getWishSortTime(a)) - (sortGetter ? sortGetter(b) : getWishSortTime(b));
  });
}

function jsValue(value) {
  return JSON.stringify(value);
}

function getLikedDoneKeys() {
  try {
    return JSON.parse(localStorage.getItem("flowerWishLikedDoneKeys") || "[]");
  } catch (error) {
    return [];
  }
}

function hasLikedDoneKey(doneKey) {
  return getLikedDoneKeys().map(String).includes(String(doneKey));
}

function setLikedDoneKey(doneKey, liked) {
  const keys = getLikedDoneKeys().map(String);
  const key = String(doneKey);
  const nextKeys = liked
    ? Array.from(new Set([...keys, key]))
    : keys.filter(function (item) { return item !== key; });

  localStorage.setItem("flowerWishLikedDoneKeys", JSON.stringify(nextKeys));
}

const DEFAULT_FLOWER_DEX = [
  { name: "風鈴草", subtitle: "6月新花・目前無法獲得", colors: ["白", "紅", "藍"], locked: true },
  { name: "勿忘草", colors: ["白", "黃", "紅", "藍"] },
  { name: "週年玫瑰", colors: ["白", "黃", "紅", "藍"] },
  { name: "銀蓮花", colors: ["白", "黃", "紅", "藍"] },
  { name: "九重葛", colors: ["白", "黃", "紅", "藍"] },
  { name: "海芋", colors: ["白", "黃", "紅", "藍"] },
  { name: "山茶花", colors: ["白", "黃", "紅", "藍"] },
  { name: "油菜花", colors: ["白", "黃", "藍"] },
  { name: "康乃馨", colors: ["白", "黃", "紅", "藍"] },
  { name: "嘉德麗雅蘭", colors: ["白", "黃", "紅", "藍"] },
  { name: "雞冠花", colors: ["白", "黃", "紅", "藍"] },
  { name: "櫻花", colors: ["白"] },
  { name: "菊花", colors: ["白", "黃", "紅", "藍"] },
  { name: "鐵線蓮", colors: ["白", "黃", "紅", "藍"] },
  { name: "彼岸花", colors: ["白", "黃", "紅"] },
  { name: "鈴蘭", colors: ["白", "紅"] },
  { name: "大波斯菊", colors: ["白", "黃", "紅"] },
  { name: "兔耳花", colors: ["白", "紅", "藍"] },
  { name: "大理花", colors: ["白", "黃", "紅", "藍"] },
  { name: "石竹", colors: ["白", "紅", "藍"] },
  { name: "小蒼蘭", colors: ["白", "黃", "紅", "藍"] },
  { name: "龍膽", colors: ["白", "紅", "藍"] },
  { name: "聖誕玫瑰", colors: ["白", "黃", "紅", "藍"] },
  { name: "扶桑花", colors: ["白", "黃", "紅", "藍"] },
  { name: "風信子", colors: ["白", "黃", "紅", "藍"] },
  { name: "繡球花", colors: ["白", "紅", "藍"] },
  { name: "鳶尾花", colors: ["白", "黃", "紅", "藍"] },
  { name: "百合", colors: ["白", "黃", "紅"] },
  { name: "萬壽菊", colors: ["白", "黃", "紅"] },
  { name: "牽牛花", colors: ["白", "黃", "紅", "藍"] },
  { name: "蝴蝶蘭", colors: ["白", "黃", "紅", "藍"] },
  { name: "水仙花", colors: ["白", "黃"] },
  { name: "粉蝶花", colors: ["藍"] },
  { name: "睡蓮", colors: ["白", "黃", "紅", "藍"] },
  { name: "三色堇", colors: ["白", "黃", "紅", "藍"] },
  { name: "牡丹", colors: ["白", "黃", "紅", "藍"] },
  { name: "矮牽牛", colors: ["白", "黃", "紅", "藍"] },
  { name: "梅花", colors: ["白", "黃", "紅"] },
  { name: "雞蛋花", colors: ["白", "黃", "紅"] },
  { name: "聖誕紅", colors: ["白", "黃", "紅", "藍"] },
  { name: "櫻草花", colors: ["白", "黃", "紅", "藍"] },
  { name: "玫瑰", colors: ["白", "黃", "紅", "藍"] },
  { name: "鼠尾草", colors: ["白", "黃", "紅", "藍"] },
  { name: "金魚草", colors: ["白", "黃", "紅", "藍"] },
  { name: "雪花蓮", colors: ["白", "黃", "紅"] },
  { name: "天堂鳥", colors: ["白", "黃", "紅"] },
  { name: "向日葵", colors: ["黃"] },
  { name: "豌豆花", colors: ["白", "黃", "紅", "藍"] },
  { name: "鬱金香", colors: ["白", "黃", "紅", "藍"] },
  { name: "鸚鵡鬱金香", colors: ["白", "黃", "紅", "藍"] }
];


function isLockedFlowerName(name) {
  const text = String(name || "").trim();
  return text === "風鈴草" || /風鈴草/.test(text);
}

function isLockedWishFlowerValue(value) {
  const text = String(value || "").trim();
  return /風鈴草/.test(text);
}

function warnLockedFlower() {
  alert("風鈴草 5/31 才會開放，目前先保留選項，暫時不能許願或上傳喔～");
}

let flowerDex = JSON.parse(JSON.stringify(DEFAULT_FLOWER_DEX));
let cloudFlowerCatalog = [];
let flowerCatalogListenerStarted = false;
let dexFilterMode = "all";
let dexActiveFilters = [];

function normalizeCatalogColor(color) {
  return String(color || "").trim().replace(/色$/u, "");
}

function normalizeCatalogName(name) {
  return String(name || "").trim().toLowerCase();
}

function getCatalogSortTime(flower) {
  const value = flower && (flower.createdAt || flower.customAddedAt || flower.updatedAt || flower.createdAtSort);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value || 0).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function rebuildFlowerDexFromSources() {
  const builtInFlowers = JSON.parse(JSON.stringify(DEFAULT_FLOWER_DEX));
  const customFlowers = [];

  (Array.isArray(cloudFlowerCatalog) ? cloudFlowerCatalog : [])
    .slice()
    .sort(function (a, b) { return getCatalogSortTime(b) - getCatalogSortTime(a); })
    .forEach(function (flower) {
      if (!flower || !flower.name) return;

      const cleanFlower = {
        name: String(flower.name || "").trim(),
        subtitle: String(flower.subtitle || "").trim(),
        colors: Array.isArray(flower.colors) && flower.colors.length
          ? flower.colors.map(normalizeCatalogColor).filter(Boolean)
          : ["白"],
        locked: !!flower.locked,
        isCustomFlower: true,
        customAddedAt: getCatalogSortTime(flower)
      };

      const index = builtInFlowers.findIndex(function (item) {
        return normalizeCatalogName(item.name) === normalizeCatalogName(cleanFlower.name);
      });

      if (index >= 0) {
        builtInFlowers[index] = Object.assign({}, builtInFlowers[index], cleanFlower);
      } else {
        customFlowers.push(cleanFlower);
      }
    });

  flowerDex = customFlowers.concat(builtInFlowers);
}

function startFlowerCatalogListener() {
  if (flowerCatalogListenerStarted) return;
  if (!window.firebaseDB || !window.firebaseFns || !window.firebaseFns.onSnapshot || !window.firebaseFns.collection) {
    setTimeout(startFlowerCatalogListener, 500);
    return;
  }

  flowerCatalogListenerStarted = true;
  try {
    window.firebaseFns.onSnapshot(
      window.firebaseFns.collection(window.firebaseDB, "flowerCatalog"),
      function (snapshot) {
        cloudFlowerCatalog = snapshot.docs.map(function (docSnap) {
          return docSnap.data() || {};
        });
        rebuildFlowerDexFromSources();
        try { renderAll(); } catch (error) { console.warn("自訂花種重新整理失敗", error); }
      },
      function (error) {
        console.warn("讀取自訂花種失敗", error);
      }
    );
  } catch (error) {
    flowerCatalogListenerStarted = false;
    console.warn("自訂花種監聽啟動失敗", error);
  }
}

document.addEventListener("DOMContentLoaded", function () {
  buildTimeOptions();
  loadData();
  rebuildFlowerDexFromSources();
  initFlowerPicker();
  startFlowerCatalogListener();
  fixExampleCardMessageSafely();
  updateLimitInputs();
  renderAll();
});

function buildTimeOptions() {
  const hourIds = ["startHour", "endHour"];
  const minuteIds = ["startMinute", "endMinute"];

  hourIds.forEach(function (id) {
    const el = document.getElementById(id);
    for (let i = 0; i <= 23; i++) {
      const option = document.createElement("option");
      option.value = String(i).padStart(2, "0");
      option.textContent = String(i).padStart(2, "0");
      el.appendChild(option);
    }
  });

  minuteIds.forEach(function (id) {
    const el = document.getElementById(id);
    ["00", "10", "20", "30", "40", "50"].forEach(function (m) {
      const option = document.createElement("option");
      option.value = m;
      option.textContent = m;
      el.appendChild(option);
    });
  });

  document.getElementById("startHour").value = "14";
  document.getElementById("endHour").value = "20";
}


function normalizeWishColorValue(color) {
  const text = String(color || "").trim();
  // 「混色／隨意色」是許願單真正的選項值，不能被切成「混／隨意」，
  // 否則從圖鑑白色快速許願時，設定 colorSelect.value = "混色" 會對不到選項。
  if (text === "混色" || text === "隨意色") return text;
  return text.replace(/色$/u, "");
}

function isWhiteWishColor(color) {
  const normalized = normalizeWishColorValue(color);
  return normalized === "白" || normalized === "white";
}

function getWishColorOptions(baseColors) {
  // 許願單不提供「白／白色」選項；白花仍保留在花朵圖鑑 DEFAULT_FLOWER_DEX 裡顯示。
  // 混色／隨意色依照花種原本的顏色數量判斷：原本有 2 色以上，即使扣掉白色後只剩 1 色，也要顯示。
  const colors = Array.isArray(baseColors) && baseColors.length ? baseColors.slice() : ["黃", "紅", "藍"];
  const shouldAddSpecialColors = colors.length >= 2;
  const seen = {};
  const uniqueColors = [];
  colors.forEach(function (color) {
    const normalized = normalizeWishColorValue(color);
    if (!normalized || isWhiteWishColor(normalized) || seen[normalized]) return;
    seen[normalized] = true;
    uniqueColors.push(normalized);
  });
  if (shouldAddSpecialColors) {
    if (!uniqueColors.includes("混色")) uniqueColors.push("混色");
    if (!uniqueColors.includes("隨意色")) uniqueColors.push("隨意色");
  }
  return uniqueColors;
}


function findCatalogFlowerForWish(name) {
  const key = String(name || "").trim().toLowerCase();
  if (!key) return null;
  const sources = [];
  try { if (Array.isArray(flowerDex)) sources.push(flowerDex); } catch (e) {}
  try { if (Array.isArray(DEFAULT_FLOWER_DEX)) sources.push(DEFAULT_FLOWER_DEX); } catch (e) {}
  for (const list of sources) {
    const found = list.find(function (flower) {
      return String(flower && flower.name || "").trim().toLowerCase() === key;
    });
    if (found) return found;
  }
  return null;
}


function getWishFlowerBaseNameFromValue(value) {
  let text = String(value || "").trim();
  if (!text) return "";
  ["隨意色", "混色", "黃色", "紅色", "藍色", "白色", "黃", "紅", "藍", "白"].forEach(function (prefix) {
    if (text.startsWith(prefix)) text = text.slice(prefix.length).trim();
  });
  return text;
}

function isCatalogWishFlowerValue(value) {
  const baseName = getWishFlowerBaseNameFromValue(value);
  return !!findCatalogFlowerForWish(baseName);
}

function warnChooseCatalogFlower() {
  alert("請從花種選單選擇圖鑑裡已有的花種，不能自由輸入新花種。");
}

function getCurrentWishFlowerName() {
  const input = document.getElementById("flowerComboInput") || document.getElementById("flowerKeywordInput");
  return input ? input.value.trim() : "";
}

function shouldShowWishSpecialColors(flowerName) {
  const flower = findCatalogFlowerForWish(flowerName);
  return !!(flower && Array.isArray(flower.colors) && flower.colors.length >= 2);
}

function appendWishColorOptionIfMissing(colorSelect, color) {
  if (!colorSelect) return;
  const normalized = normalizeWishColorValue(color);
  const exists = Array.from(colorSelect.options).some(function (option) {
    return normalizeWishColorValue(option.value || option.textContent) === normalized;
  });
  if (exists) return;
  const option = document.createElement("option");
  option.value = normalized;
  option.textContent = getWishColorLabel(normalized);
  colorSelect.appendChild(option);
}

function getWishColorLabel(color) {
  return String(color || "").endsWith("色") ? color : color + "色";
}

function buildWishFlowerName(color, flowerName) {
  if (!flowerName) return "";
  if (!color) return flowerName;
  return getWishColorLabel(color) + flowerName;
}

function removeWhiteWishColorOptions() {
  const colorSelect = document.getElementById("flowerColorSelect");
  if (!colorSelect) return;
  Array.from(colorSelect.options).forEach(function (option) {
    if (isWhiteWishColor(option.value) || isWhiteWishColor(option.textContent)) {
      option.remove();
    }
  });

  const currentFlowerName = getCurrentWishFlowerName();
  if (shouldShowWishSpecialColors(currentFlowerName)) {
    colorSelect.style.display = "";
    appendWishColorOptionIfMissing(colorSelect, "混色");
    appendWishColorOptionIfMissing(colorSelect, "隨意色");
  }

  if (colorSelect.options.length && isWhiteWishColor(colorSelect.value)) {
    colorSelect.selectedIndex = 0;
  }
}

function initFlowerPicker() {
  const comboInput = document.getElementById("flowerComboInput") || document.getElementById("flowerKeywordInput");
  const dropdown = document.getElementById("flowerComboDropdown");
  const colorSelect = document.getElementById("flowerColorSelect");
  const flowerInput = document.getElementById("flowerInput");

  if (!comboInput || !colorSelect || !flowerInput) return;

  const allColors = ["黃", "紅", "藍"];

  function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function getTypedFlowerName() {
    return comboInput.value.trim();
  }

  function findFlowerByName(name) {
    const normalized = normalizeText(name);
    return flowerDex.find(function (flower) {
      return normalizeText(flower.name) === normalized;
    });
  }

  function getFilteredFlowers() {
    const keyword = normalizeText(comboInput.value);
    if (!keyword) return flowerDex;
    return flowerDex.filter(function (flower) {
      const name = normalizeText(flower.name);
      const subtitle = normalizeText(flower.subtitle || "");
      return name.includes(keyword) || subtitle.includes(keyword);
    });
  }

  function closeDropdown() {
    if (dropdown) dropdown.classList.remove("open");
  }

  function renderDropdown() {
    if (!dropdown) return;
    const flowers = getFilteredFlowers();
    dropdown.innerHTML = "";

    if (!flowers.length) {
      const empty = document.createElement("div");
      empty.className = "flower-combo-empty";
      empty.textContent = "沒有符合的花種";
      dropdown.appendChild(empty);
      dropdown.classList.add("open");
      return;
    }

    flowers.forEach(function (flower) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "flower-combo-option" + (flower.locked ? " is-disabled" : "");
      btn.setAttribute("role", "option");
      btn.textContent = flower.subtitle ? flower.name + "（" + flower.subtitle + "）" : flower.name;
      if (flower.locked) {
        btn.disabled = true;
        btn.setAttribute("aria-disabled", "true");
        btn.title = "5/31 才會開放，目前不能選擇";
      }
      btn.addEventListener("mousedown", function (event) {
        event.preventDefault();
        if (flower.locked) {
          warnLockedFlower();
          return;
        }
        comboInput.value = flower.name;
        comboInput.removeAttribute("aria-invalid");
        renderColorOptions();
        closeDropdown();
      });
      dropdown.appendChild(btn);
    });

    dropdown.classList.add("open");
  }

  function renderColorOptions() {
    const flowerName = getTypedFlowerName();
    const selectedFlower = findFlowerByName(flowerName);
    const currentColor = colorSelect.value;

    if (selectedFlower && selectedFlower.locked) {
      colorSelect.style.display = "";
      colorSelect.innerHTML = "";
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "5/31 開放後才能選";
      colorSelect.appendChild(option);
      flowerInput.value = "";
      return;
    }

    const baseColors = selectedFlower && Array.isArray(selectedFlower.colors) ? selectedFlower.colors : null;

    // 單色花：櫻花、向日葵、粉蝶花等，直接許願，不顯示顏色選單
    if (selectedFlower && (!baseColors || (baseColors.length <= 1 && getWishColorOptions(baseColors).length <= 1))) {
      colorSelect.style.display = "none";
      colorSelect.innerHTML = "";
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "單色花";
      colorSelect.appendChild(option);
      flowerInput.value = flowerName;
      return;
    }

    colorSelect.style.display = "";
    const colors = getWishColorOptions(baseColors || allColors);

    colorSelect.innerHTML = "";
    colors.forEach(function (color) {
      const option = document.createElement("option");
      option.value = color;
      option.textContent = getWishColorLabel(color);
      colorSelect.appendChild(option);
    });

    removeWhiteWishColorOptions();

    if (colors.includes(currentColor) && !isWhiteWishColor(currentColor)) {
      colorSelect.value = currentColor;
    }

    updateSelectedFlowerInput();
  }

  function updateSelectedFlowerInput() {
    const flowerName = getTypedFlowerName();
    const color = colorSelect.value;
    const selectedFlower = findFlowerByName(flowerName);

    if (!selectedFlower || isLockedFlowerName(flowerName)) {
      flowerInput.value = "";
      return;
    }

    flowerInput.value = buildWishFlowerName(color, flowerName);
  }

  comboInput.oninput = function () {
    const matchedFlower = findFlowerByName(comboInput.value);
    if (!matchedFlower && comboInput.value.trim()) {
      flowerInput.value = "";
      comboInput.setAttribute("aria-invalid", "true");
    } else {
      comboInput.removeAttribute("aria-invalid");
    }
    renderDropdown();
    renderColorOptions();
  };
  comboInput.onfocus = function () {
    renderDropdown();
  };
  comboInput.onblur = function () {
    const matchedFlower = findFlowerByName(comboInput.value);
    if (!matchedFlower && comboInput.value.trim()) {
      flowerInput.value = "";
      comboInput.setAttribute("aria-invalid", "true");
    }
  };
  comboInput.onkeydown = function (event) {
    if (event.key === "Escape") closeDropdown();
  };
  colorSelect.onchange = updateSelectedFlowerInput;

  if (!window.__flowerPickerOutsideClickAdded) {
    document.addEventListener("mousedown", function (event) {
      const wrap = document.querySelector(".flower-combo-wrap");
      if (wrap && !wrap.contains(event.target)) {
        const menu = document.getElementById("flowerComboDropdown");
        if (menu) menu.classList.remove("open");
      }
    });
    window.__flowerPickerOutsideClickAdded = true;
  }

  renderColorOptions();
}
function clearFlowerComboInput() {
  const comboInput = document.getElementById("flowerComboInput") || document.getElementById("flowerKeywordInput");
  const flowerInput = document.getElementById("flowerInput");
  if (comboInput) {
    comboInput.value = "";
    comboInput.dispatchEvent(new Event("input", { bubbles: true }));
    comboInput.focus();
  }
  if (flowerInput) flowerInput.value = "";
}

function clearDexSearchInput() {
  const searchInput = document.getElementById("dexSearchInput");
  if (searchInput) {
    searchInput.value = "";
    searchInput.focus();
  }
  renderDex();
}

function resetFlowerPicker() {
  const comboInput = document.getElementById("flowerComboInput") || document.getElementById("flowerKeywordInput");
  if (comboInput) comboInput.value = "";
  initFlowerPicker();
}

let __pikminCurrentSection = document.querySelector(".page-section.active")?.id || "wish";

function showSection(sectionId, btn) {
  const previousSection = __pikminCurrentSection;

  document.querySelectorAll(".page-section").forEach(function (section) {
    section.classList.remove("active");
  });

  const targetSection = document.getElementById(sectionId);
  if (targetSection) targetSection.classList.add("active");

  document.querySelectorAll(".nav-btn").forEach(function (item) {
    item.classList.remove("active");
  });
  if (btn) btn.classList.add("active");

  __pikminCurrentSection = sectionId;

  // 從歷史許願切回許願池時，重新整理訂單畫面並短暫提示同步中，避免畫面看起來像訂單消失。
  if (previousSection === "history" && sectionId === "wish") {
    showAppLoadingOverlay("正在同步許願池", "正在重新載入訂單資料，請稍等一下。", 900);
    refreshWishOrderViews();
  }
}


function jumpToOrderSection(event, targetId) {
  if (event) event.preventDefault();

  const wishBtn = document.querySelector('.nav-btn[onclick*="showSection(\'wish\'"]') ||
    document.querySelector('.nav-btn[onclick*="showSection(&quot;wish&quot;"]') ||
    document.querySelector('.nav-btn');

  if (typeof showSection === 'function' && wishBtn) {
    showSection('wish', wishBtn);
  }

  setTimeout(function () {
    const target = document.getElementById(targetId);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.replaceState(null, '', '#' + targetId);
    }
  }, 60);
}

function saveNickname() {
  const input = document.getElementById("nicknameInput");
  if (!input) return;

  nickname = input ? normalizeNicknameOnly(input.value) : "";

  if (!nickname) {
    alert("請先輸入 LINE 社群暱稱。");
    return;
  }

  localStorage.setItem("flowerWishNickname", nickname);
  alert("暱稱已設定：" + nickname);
}



/* =========================
   重複許願確認視窗
========================= */
let repeatWishResolver = null;
let repeatWishPendingSubmit = false;

function normalizeRepeatWishText(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function getRepeatWishCount(flower, nickname) {
  const targetFlower = normalizeRepeatWishText(flower);
  const targetNickname = normalizeRepeatWishText(nickname);
  if (!targetFlower || !targetNickname) return 0;

  const activeLists = [];
  if (Array.isArray(wishes)) activeLists.push(...wishes);
  if (Array.isArray(pending)) activeLists.push(...pending);

  return activeLists.filter(function (wish) {
    if (!wish || wish.isExample) return false;
    const wishStatus = String(wish.status || "wish").toLowerCase();
    if (wishStatus === "done" || wishStatus === "completed" || wishStatus === "cancelled" || wishStatus === "canceled") return false;
    return normalizeRepeatWishText(wish.flower) === targetFlower && normalizeRepeatWishText(wish.nickname) === targetNickname;
  }).length;
}

function ensureRepeatWishModal() {
  if (document.getElementById("repeatWishModal")) return;

  const style = document.createElement("style");
  style.id = "repeatWishModalStyle";
  style.textContent = `
    .repeat-wish-modal {
      position: fixed;
      inset: 0;
      z-index: 99999;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 18px;
      background: rgba(0, 0, 0, 0.48);
      backdrop-filter: blur(3px);
    }
    .repeat-wish-modal.show { display: flex; }
    .repeat-wish-box {
      width: min(92vw, 420px);
      border-radius: 22px;
      padding: 22px 20px 18px;
      background: linear-gradient(180deg, #fffdf2 0%, #edf8df 100%);
      color: #28422c;
      box-shadow: 0 18px 45px rgba(0, 0, 0, 0.28);
      text-align: center;
      border: 2px solid rgba(128, 169, 82, 0.55);
    }
    .repeat-wish-box h3 {
      margin: 0 0 10px;
      font-size: 20px;
      line-height: 1.35;
    }
    .repeat-wish-box p {
      margin: 0 0 18px;
      font-size: 15px;
      line-height: 1.7;
    }
    .repeat-wish-actions {
      display: flex;
      gap: 4px;
      justify-content: center;
      flex-wrap: wrap;
    }
    .repeat-wish-actions button {
      border: 0;
      border-radius: 999px;
      padding: 10px 18px;
      font-weight: 800;
      cursor: pointer;
      font-size: 15px;
    }
    .repeat-wish-submit {
      background: #6f9f38;
      color: white;
    }
    .repeat-wish-cancel {
      background: rgba(255,255,255,0.86);
      color: #395331;
      border: 1px solid rgba(75, 111, 52, 0.25) !important;
    }
  `;
  document.head.appendChild(style);

  const modal = document.createElement("div");
  modal.id = "repeatWishModal";
  modal.className = "repeat-wish-modal";
  modal.innerHTML = `
    <div class="repeat-wish-box" role="dialog" aria-modal="true" aria-labelledby="repeatWishTitle">
      <h3 id="repeatWishTitle">🌸 偵測到重複許願</h3>
      <p id="repeatWishText">你目前已有相同願望，是否仍要重複許願？</p>
      <div class="repeat-wish-actions">
        <button type="button" class="repeat-wish-cancel" id="repeatWishCancelBtn">取消</button>
        <button type="button" class="repeat-wish-submit" id="repeatWishSubmitBtn">仍然送出</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById("repeatWishCancelBtn").addEventListener("click", function () {
    closeRepeatWishModal(false);
  });
  document.getElementById("repeatWishSubmitBtn").addEventListener("click", function () {
    closeRepeatWishModal(true);
  });
  modal.addEventListener("click", function (event) {
    if (event.target === modal) closeRepeatWishModal(false);
  });
}

function closeRepeatWishModal(shouldSubmit) {
  const modal = document.getElementById("repeatWishModal");
  if (modal) modal.classList.remove("show");
  repeatWishPendingSubmit = false;
  if (typeof repeatWishResolver === "function") {
    const resolver = repeatWishResolver;
    repeatWishResolver = null;
    resolver(!!shouldSubmit);
  }
}

function askRepeatWishIfNeeded(flower, nickname) {
  const count = getRepeatWishCount(flower, nickname);
  if (count <= 0) return Promise.resolve(true);
  if (repeatWishPendingSubmit) return Promise.resolve(false);

  ensureRepeatWishModal();
  repeatWishPendingSubmit = true;
  const text = document.getElementById("repeatWishText");
  if (text) {
    text.textContent = `你目前已有 ${count} 筆相同願望，是否仍要重複許願？`;
  }
  const modal = document.getElementById("repeatWishModal");
  if (modal) modal.classList.add("show");

  return new Promise(function (resolve) {
    repeatWishResolver = resolve;
  });
}

async function addWish() {
  const flower = document.getElementById("flowerInput").value.trim();
  const message = document.getElementById("messageInput").value.trim();

  nickname = getCurrentNickname();

  if (!guardWishSubmitCooldown()) return;

  if (!guardPikminAccountCanPost()) return;

  if (!nickname) {
    alert("請先設定暱稱，建議使用 LINE 社群暱稱。");
    return;
  }

  if (!flower) {
    warnChooseCatalogFlower();
    return;
  }

  if (!isCatalogWishFlowerValue(flower)) {
    warnChooseCatalogFlower();
    resetFlowerPicker();
    return;
  }

  if (isLockedWishFlowerValue(flower)) {
    warnLockedFlower();
    resetFlowerPicker();
    return;
  }

  const canSubmitRepeatWish = await askRepeatWishIfNeeded(flower, nickname);
  if (!canSubmitRepeatWish) return;

  try {
    await getRecaptchaToken();
  } catch (error) {
    console.error(error);
    alert("reCAPTCHA 驗證失敗，請重新整理後再試一次。");
    return;
  }


  const start = document.getElementById("startHour").value + ":" + document.getElementById("startMinute").value;
  const end = document.getElementById("endHour").value + ":" + document.getElementById("endMinute").value;

  wishSubmitInProgress = true;

  wishes.push({
    id: Date.now(),
    flower: flower,
    nickname: nickname,
    uid: getCurrentUserUid(),
    ownerUid: getCurrentUserUid(),
    requesterUid: getCurrentUserUid(),
    createdAt: formatNow(),
    timeRange: start + " - " + end,
    deleteAt: getWishDeleteAtThreeDaysLater(),
    message: message || "沒有留言",
    isExample: false
  });

  document.getElementById("flowerInput").value = "";
  resetFlowerPicker();
  document.getElementById("messageInput").value = "";
  saveData();
  renderAll();
  markWishSubmitSuccess();
  wishSubmitInProgress = false;
  alert("已成功送出許願 🌸");
}


function showSuccessToast(message) {
  const toast = document.createElement("div");
  toast.className = "success-toast";
  toast.textContent = message;

  document.body.appendChild(toast);

  requestAnimationFrame(function () {
    toast.classList.add("show");
  });

  setTimeout(function () {
    toast.classList.remove("show");

    setTimeout(function () {
      toast.remove();
    }, 300);
  }, 2200);
}


function openConfirmModal(id) {
  selectedWishId = id;
  closeWishDetailModal();
  const modal = document.getElementById("confirmModal");
  if (modal) {
    modal.classList.add("show");
  }
}

// 給動態產生的卡片使用：避免 inline onclick 在某些瀏覽器/同步卡片上失效


document.addEventListener("click", function (event) {
  const detailBtn = event.target.closest(".detail-btn[data-detail-wish-key]");
  if (detailBtn && !detailBtn.disabled) {
    event.preventDefault();
    openWishDetailModal(detailBtn.dataset.detailWishKey);
    return;
  }

  const helpBtn = event.target.closest(".help-btn[data-wish-key]");
  if (helpBtn && !helpBtn.disabled) {
    event.preventDefault();
    openConfirmModal(helpBtn.dataset.wishKey);
    return;
  }

  const doneBtn = event.target.closest(".done-btn[data-pending-key]");
  if (doneBtn && !doneBtn.disabled) {
    event.preventDefault();
    openDoneModal(doneBtn.dataset.pendingKey);
    return;
  }

  const cancelTakeBtn = event.target.closest(".cancel-take-btn[data-pending-key]");
  if (cancelTakeBtn && !cancelTakeBtn.disabled) {
    event.preventDefault();
    cancelTakeOrder(cancelTakeBtn.dataset.pendingKey);
    return;
  }

  const likeBtn = event.target.closest(".like-btn[data-done-key]");
  if (likeBtn) {
    event.preventDefault();
    toggleLike(likeBtn.dataset.doneKey);
    return;
  }

  const copyBtn = event.target.closest(".copy-btn[data-done-key]");
  if (copyBtn) {
    event.preventDefault();
    copyCoords(copyBtn.dataset.doneKey);
    return;
  }

  const toggleCoordBtn = event.target.closest(".toggle-coord-btn[data-target]");
  if (toggleCoordBtn) {
    event.preventDefault();

    const targetId = toggleCoordBtn.dataset.target;
    const target = document.getElementById(targetId);
    if (!target) return;

    const isHidden = target.style.display === "none" || !target.style.display;

    target.style.display = isHidden ? "block" : "none";
    toggleCoordBtn.textContent = isHidden ? "隱藏詳細座標" : "顯示詳細座標";
    expandedCoordMap.set(targetId, isHidden);

    return;
  }
});

function bindDynamicButtons() {
  document.querySelectorAll(".detail-btn[data-detail-wish-key]").forEach(function (btn) {
    btn.onclick = function () {
      openWishDetailModal(btn.dataset.detailWishKey);
    };
  });

  document.querySelectorAll(".help-btn[data-wish-key]").forEach(function (btn) {
    btn.onclick = function () {
      openConfirmModal(btn.dataset.wishKey);
    };
  });

  document.querySelectorAll(".done-btn[data-pending-key]").forEach(function (btn) {
    btn.onclick = function () {
      openDoneModal(btn.dataset.pendingKey);
    };
  });

  document.querySelectorAll(".cancel-take-btn[data-pending-key]").forEach(function (btn) {
    btn.onclick = function () {
      cancelTakeOrder(btn.dataset.pendingKey);
    };
  });

  document.querySelectorAll(".delete-btn[data-delete-wish]").forEach(function (btn) {
    btn.onclick = function () {
      deleteWish(btn.dataset.deleteWish);
    };
  });
}

function deleteWish(id) {
  const wishIndex = wishes.findIndex(function (item) {
    return String(getWishKey(item)) === String(id);
  });

  if (wishIndex === -1) return;

  const wish = wishes[wishIndex];

  if (wish.status === "pending" || wish.status === "done") {
    alert("已被接單的願望不可刪除。");
    return;
  }

  if (!isCurrentWishOwner(wish)) {
    alert("只有原許願者可以刪除。");
    return;
  }

  

  const deletedWish = wishes[wishIndex];
  const deletedKey = String(deletedWish.firebaseId || deletedWish.id || id || "");
  if (deletedKey) locallyDeletedWishKeys.add(deletedKey);

  const cancelHistoryRecord = makeWishHistoryRecord({
    id: deletedWish.id,
    firebaseId: deletedWish.firebaseId,
    sourceWishId: deletedWish.firebaseId || deletedWish.id || "",
    flower: deletedWish.flower,
    farmer: "—",
    acceptedBy: "—",
    nickname: deletedWish.nickname,
    cancelledAt: Date.now()
  }, "已取消");

  addLocalWishHistory(cancelHistoryRecord);

  wishes.splice(wishIndex, 1);
  saveData();
  renderAll();

  if (deletedWish.firebaseId && window.firebaseDB && window.firebaseFns) {
    const { deleteDoc, doc } = window.firebaseFns;
    deleteDoc(doc(window.firebaseDB, "wishes", deletedWish.firebaseId))
      .catch(function (error) {
        console.error("Firebase 刪除同步失敗", error);
        alert("雲端刪除失敗，請檢查 Firebase 規則或網路連線。");
      });
  }

  syncWishHistoryToCloud(cancelHistoryRecord);
}

function closeConfirmModal() {
  selectedWishId = null;
  document.getElementById("confirmModal").classList.remove("show");
}

function confirmTakeOrder() {
  nickname = getCurrentNickname();

  if (!nickname) {
    alert("請先輸入 LINE 社群暱稱，才能接單。");
    openRuleModal();
    return;
  }

  const selectedWishKeys = String(selectedWishId || "").split("||").filter(Boolean);
  const selectedWishKeySet = new Set(selectedWishKeys);
  const takeIndexes = [];

  wishes.forEach(function (item, index) {
    if (selectedWishKeySet.has(String(getWishKey(item)))) {
      takeIndexes.push(index);
    }
  });

  if (takeIndexes.length === 0) {
    closeConfirmModal();
    return;
  }

  if (takeIndexes.some(function (index) { return wishes[index].isExample; })) {
    alert("範例卡不能接單。");
    closeConfirmModal();
    return;
  }

  const acceptedAt = formatNow();
  const takenWishes = takeIndexes.sort(function (a, b) { return b - a; }).map(function (index) {
    return wishes.splice(index, 1)[0];
  }).reverse();

  takenWishes.forEach(function (wish) {
    wish.farmer = nickname;
    wish.farmerUid = getCurrentUserUid();
    wish.acceptedBy = nickname;
    wish.acceptedByUid = getCurrentUserUid();
    wish.farmerPlatform = getCurrentPlatform();
    wish.acceptedByPlatform = getCurrentPlatform();
    wish.acceptedAt = acceptedAt;
    wish.status = "pending";
    pending.unshift(wish);

    if (wish.firebaseId && window.firebaseDB && window.firebaseFns) {
      const { updateDoc, doc } = window.firebaseFns;
      updateDoc(doc(window.firebaseDB, "wishes", wish.firebaseId), {
        acceptedBy: nickname,
        acceptedByUid: getCurrentUserUid(),
        farmer: nickname,
        farmerUid: getCurrentUserUid(),
        acceptedByPlatform: getCurrentPlatform(),
        farmerPlatform: getCurrentPlatform(),
        acceptedAt: wish.acceptedAt,
        status: "pending"
      }).catch(function (error) {
        console.error("Firebase 接單同步失敗", error);
      });
    }
  });

  closeConfirmModal();
  saveData();
  renderAll();
}

function isCurrentFarmer(item) {
  if (!item) return false;

  const currentUid = getCurrentUserUid();
  const farmerUid = String(item.farmerUid || item.acceptedByUid || "").trim();

  // 新資料一律用 Google UID 判斷接單花農，暱稱只做顯示。
  if (farmerUid) {
    return !!currentUid && currentUid === farmerUid;
  }

  // 舊資料沒有 UID 時，才退回用暱稱相容。
  const currentName = getCurrentNickname();
  const farmerName = item && (item.farmer || item.acceptedBy || "");
  return !!currentName && !!farmerName && String(currentName).trim() === String(farmerName).trim();
}

function openDoneModal(id) {
  const selectedPendingKeys = String(id || "").split("||").filter(Boolean);
  const keySet = new Set(selectedPendingKeys);
  const targets = pending.filter(function (item) {
    return keySet.has(String(getWishKey(item)));
  });

  if (!targets.length) return;

  if (!targets.every(function (item) { return isCurrentFarmer(item); })) {
    alert("只有接單花農可以按完成分享。");
    return;
  }

  selectedPendingId = id;
  setDoneModalText(false);

  const harvestInput = document.getElementById("harvestInfoInput");
  const locationInput = document.getElementById("shareLocationInput");
  if (harvestInput) harvestInput.value = "";
  if (locationInput) locationInput.value = "";

  document.getElementById("doneModal").classList.add("show");
}

function setDoneModalText(isFarmerShare) {
  const title = document.getElementById("doneModalTitle");
  const desc = document.getElementById("doneModalDesc");
  if (!title || !desc) return;

  if (isFarmerShare) {
    title.textContent = "花農上傳座標";
    desc.textContent = "請輸入採收資訊與分享地點，送出後會直接公開到已完成區。";
  } else {
    title.textContent = "完成分享";
    desc.textContent = "請輸入採收資訊與分享地點。分享地點可以直接貼上多行座標。";
  }
}

function openFarmerShareModal() {
  const flower = document.getElementById("flowerInput")?.value?.trim();
  const currentName = getCurrentNickname();

  if (!currentName) {
    alert("請先設定暱稱，才能上傳花農座標。");
    openRuleModal();
    return;
  }

  if (!flower) {
    alert("請先選擇或輸入花種，再上傳座標。");
    return;
  }

  selectedPendingId = "__farmer_direct_share__";
  setDoneModalText(true);

  const harvestInput = document.getElementById("harvestInfoInput");
  const locationInput = document.getElementById("shareLocationInput");
  if (harvestInput) harvestInput.value = "";
  if (locationInput) locationInput.value = "";

  document.getElementById("doneModal").classList.add("show");
}

function closeDoneModal() {
  selectedPendingId = null;
  setDoneModalText(false);
  document.getElementById("doneModal").classList.remove("show");
}

function hasSharedCoordinates(item) {
  if (!item) return false;
  const candidates = [
    item.location,
    item.shareLocation,
    item.coords,
    item.coordinate,
    item.coordinates,
    item.shareText,
    item.harvestInfo
  ];
  return candidates.some(function (value) {
    return typeof value === "string" && value.trim();
  });
}

async function cancelTakeOrder(id) {
  const selectedPendingKeys = String(id || "").split("||").filter(Boolean);
  const keySet = new Set(selectedPendingKeys);
  const targetIndexes = [];

  pending.forEach(function (item, index) {
    if (keySet.has(String(getWishKey(item)))) targetIndexes.push(index);
  });

  if (!targetIndexes.length) return;

  const targets = targetIndexes.map(function (index) { return pending[index]; });

  if (!targets.every(function (item) { return isCurrentFarmer(item); })) {
    alert("只有接單花農可以取消接單。");
    return;
  }

  if (targets.some(function (item) { return hasSharedCoordinates(item) || item.status === "done" || item.doneAt; })) {
    alert("已送出座標後不能取消接單。");
    return;
  }

  const reason = prompt("請輸入取消原因：");
  if (reason === null) return;

  const cleanReason = reason.trim();
  if (!cleanReason) {
    alert("請填寫取消原因，才能取消接單。");
    return;
  }

  const returnedWishes = targetIndexes.sort(function (a, b) { return b - a; }).map(function (index) {
    return pending.splice(index, 1)[0];
  }).reverse();

  for (const returnedWish of returnedWishes) {
    const oldFarmer = returnedWish.farmer || returnedWish.acceptedBy || getCurrentNickname() || "花農";

    returnedWish.cancelReason = cleanReason;
    returnedWish.lastCancelReason = cleanReason;
    returnedWish.lastCanceledBy = oldFarmer;
    returnedWish.lastCanceledAt = formatNow();
    returnedWish.farmer = "";
    returnedWish.acceptedBy = "";
    returnedWish.acceptedAt = "";
    returnedWish.status = "wish";

    wishes.unshift(returnedWish);

    if (returnedWish.firebaseId && window.firebaseDB && window.firebaseFns) {
      const { updateDoc, doc } = window.firebaseFns;
      try {
        await updateDoc(doc(window.firebaseDB, "wishes", returnedWish.firebaseId), {
          status: "wish",
          farmer: "",
          acceptedBy: "",
          acceptedAt: "",
          cancelReason: cleanReason,
          lastCancelReason: cleanReason,
          lastCanceledBy: oldFarmer,
          lastCanceledAt: returnedWish.lastCanceledAt
        });
      } catch (error) {
        console.error("Firebase 取消接單同步失敗", error);
        alert("本機已取消，但雲端同步失敗。請重新整理後確認訂單狀態。");
      }
    }
  }

  saveData();
  renderAll();
}

function previewCleanCoords() {
  const input = document.getElementById("shareLocationInput");
  const cleaned = cleanCoordinates(input.value);

  if (!cleaned) {
    alert("沒有找到有效座標。");
    return;
  }

  input.value = cleaned;
  alert("座標格式已整理完成！");
}



function openUploadConfirmModal() {
  const harvestInfo = document.getElementById("harvestInfoInput").value.trim();
  const rawLocation = document.getElementById("shareLocationInput").value;
  const cleanedLocation = cleanCoordinates(rawLocation);

  if (!cleanedLocation) {
    alert("請輸入有效座標，例如：22.817601,89.563802");
    return;
  }

  document.getElementById("shareLocationInput").value = cleanedLocation;
  document.getElementById("uploadHarvestPreview").textContent = harvestInfo || "沒有補充採收資訊";
  document.getElementById("uploadCoordCount").textContent = cleanedLocation.split("\n").filter(Boolean).length;

  document.getElementById("doneModal").classList.remove("show");
  document.getElementById("uploadConfirmModal").classList.add("show");
}

function closeUploadConfirmModal() {
  document.getElementById("uploadConfirmModal").classList.remove("show");
  document.getElementById("doneModal").classList.add("show");
}



function getHistorySortTime(item) {
  if (!item) return 0;

  // 歷史許願要依照畫面顯示的完成/取消時間排序，避免 Firebase 重新同步時 createdAt 被刷新，導致舊資料跑到上面。
  const candidates = [
    item.time,
    item.doneAt,
    item.cancelledAt,
    item.canceledAt,
    item.finishedAt,
    item.historyCreatedAt,
    item.createdAtSort,
    item.createdTimestamp,
    item.createdAt
  ];

  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) return value;

    if (typeof value === "string" && value.trim()) {
      const normalized = value.trim().replace(/-/g, "/");
      const parsed = new Date(normalized).getTime();
      if (!Number.isNaN(parsed)) return parsed;

      // 舊資料格式多半是「05/25 09:58」，補上今年後才能正確排序。
      const shortMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
      if (shortMatch) {
        const year = new Date().getFullYear();
        const month = Number(shortMatch[1]);
        const day = Number(shortMatch[2]);
        const hour = Number(shortMatch[3]);
        const minute = Number(shortMatch[4]);
        return new Date(year, month - 1, day, hour, minute).getTime();
      }
    }
  }

  return 0;
}

function makeWishHistoryRecord(item, statusText) {
  const farmerName = item.farmer || item.acceptedBy || getCurrentNickname() || "花農";
  const isDirectShare = !!item.directShare;
  const requesterName = isDirectShare ? "" : (item.nickname || item.requester || "許願者");
  const historyTimeSource = item.doneAt || item.cancelledAt || item.canceledAt || item.finishedAt || item.historyCreatedAt || item.createdAtSort || item.createdTimestamp || Date.now();
  const finishedTime = formatHistoryTime(historyTimeSource);
  const stableDirectId = item.sourceWishId || item.id || item.firebaseId || item.historyId || "";
  const stableNormalId = item.sourceWishId || item.firebaseId || item.id || item.historyId || "";
  const stableId = isDirectShare ? stableDirectId : stableNormalId;

  return {
    id: item.historyId || stableId || Date.now(),
    sourceWishId: stableId,
    flower: item.flower || "花朵",
    farmer: farmerName,
    requester: requesterName,
    status: isDirectShare ? (statusText || "花農分享") : (statusText || item.status || "已完成"),
    directShare: isDirectShare,
    time: item.time || finishedTime,
    createdAt: item.createdAt || historyTimeSource,
    historyCreatedAt: getHistorySortTime({ ...item, time: item.time || finishedTime, historyCreatedAt: historyTimeSource }) || Date.now()
  };
}

function formatHistoryTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return formatNow ? formatNow() : "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}/${day} ${hour}:${minute}`;
}

function getWishHistoryUniqueKey(item) {
  const sourceKey = String(item.sourceWishId || item.id || item.firebaseId || "");
  if (sourceKey) {
    if (item.directShare || String(item.requester || "").includes("花農直接分享") || String(item.status || "").includes("花農分享")) {
      return sourceKey + "|directShare";
    }
    return sourceKey + "|" + String(item.status || "");
  }

  return [
    item.flower || "",
    item.farmer || "",
    item.requester || "",
    item.status || "",
    item.time || ""
  ].join("|");
}

function addLocalWishHistory(record) {
  const key = getWishHistoryUniqueKey(record);
  const exists = wishHistory.some(function (item) {
    return getWishHistoryUniqueKey(item) === key;
  });

  if (!exists) {
    wishHistory.push(record);
  }
}

let historyPage = 1;
const HISTORY_PAGE_SIZE = 50;

function renderWishHistory() {
  const list = document.getElementById("wishHistoryList");
  if (!list) return;

  const header = '<div class="wish-history-item history-sticky-head">花朵｜花農 → 許願者｜是否完成｜時間</div>';
  const sortedHistory = [...wishHistory].sort(function (a, b) {
    return getHistorySortTime(b) - getHistorySortTime(a);
  });

  if (!sortedHistory.length) {
    list.innerHTML = header + '<div class="empty">目前還沒有歷史許願紀錄。</div>';
    return;
  }

  const totalPages = Math.max(1, Math.ceil(sortedHistory.length / HISTORY_PAGE_SIZE));
  if (historyPage > totalPages) historyPage = totalPages;
  if (historyPage < 1) historyPage = 1;

  const start = (historyPage - 1) * HISTORY_PAGE_SIZE;
  const pageItems = sortedHistory.slice(start, start + HISTORY_PAGE_SIZE);

  const rows = pageItems.map(function (item) {
    const flower = escapeHtml(item.flower || "花朵");
    const farmer = escapeHtml(item.farmer || item.acceptedBy || "—");
    const requester = item.directShare ? "花農直接分享" : escapeHtml(item.requester || item.nickname || "許願者");
    const status = escapeHtml(item.status || "已完成");
    const time = escapeHtml(item.time || formatHistoryTime(getHistorySortTime(item)));
    return `<div class="wish-history-item">${flower}｜${farmer} → ${requester}｜${status}｜${time}</div>`;
  }).join("");

  const pager = sortedHistory.length > HISTORY_PAGE_SIZE
    ? `<div class="history-pager"><button type="button" onclick="changeHistoryPage(-1)" ${historyPage <= 1 ? "disabled" : ""}>上一頁</button><span>${historyPage} / ${totalPages}</span><button type="button" onclick="changeHistoryPage(1)" ${historyPage >= totalPages ? "disabled" : ""}>下一頁</button></div>`
    : "";

  list.innerHTML = header + rows + pager;
}

function changeHistoryPage(direction) {
  historyPage += direction;

  if (historyPage < 1) historyPage = 1;

  renderWishHistory();
}

async function syncWishHistoryToCloud(record) {
  if (!window.firebaseDB || !window.firebaseFns) return;

  const { collection, addDoc } = window.firebaseFns;

  try {
    await addDoc(collection(window.firebaseDB, "wishHistory"), record);
  } catch (error) {
    console.error("Firebase 歷史許願同步失敗", error);
  }
}


async function confirmDone() {
  const harvestInfo = document.getElementById("harvestInfoInput").value.trim();
  const rawLocation = document.getElementById("shareLocationInput").value;
  const location = cleanCoordinates(rawLocation);

  if (!location) {
    alert("請輸入有效座標，例如：22.817601,89.563802");
    return;
  }

  if (selectedPendingId === "__farmer_direct_share__") {
    const flower = document.getElementById("flowerInput")?.value?.trim();
    const currentName = getCurrentNickname();

    if (!currentName) {
      alert("請先設定暱稱，才能上傳花農座標。");
      return;
    }

    if (!flower) {
      alert("請先選擇或輸入花種。");
      return;
    }

    if (isLockedWishFlowerValue(flower)) {
      warnLockedFlower();
      resetFlowerPicker();
      return;
    }

    const startHour = document.getElementById("startHour")?.value || "14";
    const startMinute = document.getElementById("startMinute")?.value || "00";
    const endHour = document.getElementById("endHour")?.value || "20";
    const endMinute = document.getElementById("endMinute")?.value || "00";
    const message = document.getElementById("messageInput")?.value?.trim() || "花農直接分享";

    const directItem = {
      id: Date.now(),
      flower: flower,
      nickname: "",
      requester: "",
      farmer: currentName,
      farmerUid: currentUid,
      acceptedBy: currentName,
      acceptedByUid: currentUid,
      farmerPlatform: getCurrentPlatform(),
      acceptedByPlatform: getCurrentPlatform(),
      requesterPlatform: "",
      createdAt: formatNow(),
      createdTimestamp: Date.now(),
      timeRange: `${startHour}:${startMinute} - ${endHour}:${endMinute}`,
      message: message,
      harvestInfo: harvestInfo || "沒有補充採收資訊",
      location: location,
      doneAt: Date.now(),
      deleteAt: Date.now() + 60 * 60 * 1000,
      likes: 0,
      liked: false,
      status: "done",
      directShare: true
    };

    const historyRecord = makeWishHistoryRecord(directItem, "花農分享");

    if (window.firebaseDB && window.firebaseFns) {
      const { collection, addDoc } = window.firebaseFns;
      try {
        await addDoc(collection(window.firebaseDB, "wishes"), directItem);
      } catch (error) {
        console.error("Firebase 花農座標同步失敗", error);
        done.push(directItem);
        alert("雲端同步失敗，已先暫存在本機。請重新整理後確認是否有上傳成功。");
      }
    } else {
      done.push(directItem);
    }

    addLocalWishHistory(historyRecord);
    await syncWishHistoryToCloud(historyRecord);

    selectedPendingId = null;
    document.getElementById("shareLocationInput").value = "";
    document.getElementById("harvestInfoInput").value = "";
    document.getElementById("messageInput").value = "";
    document.getElementById("flowerInput").value = "";
    resetFlowerPicker();

    closeDoneModal();
    document.getElementById("uploadConfirmModal").classList.remove("show");

    alert("已上傳到已完成區。\n提醒：這邊不會自動通知，請記得貼到種花群喔！");

    saveData();
    renderAll();
    return;
  }

  const selectedPendingKeys = String(selectedPendingId || "").split("||").filter(Boolean);
  const keySet = new Set(selectedPendingKeys);
  const targetIndexes = [];

  pending.forEach(function (item, index) {
    if (keySet.has(String(getWishKey(item)))) targetIndexes.push(index);
  });

  if (!targetIndexes.length) return;

  const targets = targetIndexes.map(function (index) { return pending[index]; });

  if (!targets.every(function (item) { return isCurrentFarmer(item); })) {
    alert("只有接單花農可以送出完成分享。");
    return;
  }

  const doneItems = targetIndexes.sort(function (a, b) { return b - a; }).map(function (index) {
    return pending.splice(index, 1)[0];
  }).reverse();

  for (const item of doneItems) {
    item.harvestInfo = harvestInfo || "沒有補充採收資訊";
    item.location = location;
    if (typeof item.id === "undefined") item.id = Date.now();
    item.doneAt = Date.now();
    item.deleteAt = Date.now() + 60 * 60 * 1000;
    item.likes = 0;
    item.liked = false;

    done.push(item);

    const historyRecord = makeWishHistoryRecord(item, "已完成");
    addLocalWishHistory(historyRecord);
    await syncWishHistoryToCloud(historyRecord);

    if (item.firebaseId && window.firebaseDB && window.firebaseFns) {
      const { updateDoc, doc } = window.firebaseFns;
      try {
        await updateDoc(doc(window.firebaseDB, "wishes", item.firebaseId), {
          status: "done",
          harvestInfo: item.harvestInfo,
          location: item.location,
          doneAt: item.doneAt,
          deleteAt: item.deleteAt,
          farmer: item.farmer || item.acceptedBy || nickname,
          acceptedBy: item.acceptedBy || item.farmer || nickname,
          likes: item.likes || 0
        });
      } catch (error) {
        console.error("Firebase 完成同步失敗", error);
        alert("本機已完成，但雲端同步失敗。請重新整理後確認是否還在待完成區。");
      }
    }
  }

  selectedPendingId = null;
  document.getElementById("shareLocationInput").value = "";
  document.getElementById("harvestInfoInput").value = "";

  closeDoneModal();
  document.getElementById("uploadConfirmModal").classList.remove("show");

  alert("⚠️ 提醒：這邊不會自動通知許願者\n請記得把完成分享貼到種花群，讓對方看到喔！");

  saveData();
  renderAll();
}

function renderAll() {
  renderWishes();
  renderPending();
  renderDone();
  renderWishHistory();
  renderDex();
  bindDynamicButtons();
}


function timeRangeToDayIntervals(timeRange) {
  const range = parseTimeRangeToMinutes(timeRange);
  if (!range) return null;

  // 一般區間：20:00 - 23:00
  if (range.start <= range.end) {
    return [{ start: range.start, end: range.end }];
  }

  // 跨日區間：21:00 - 03:00，拆成 21:00-24:00 與 00:00-03:00
  return [
    { start: range.start, end: 24 * 60 },
    { start: 0, end: range.end }
  ];
}

function timeRangesOverlap(timeRangeA, timeRangeB) {
  const intervalsA = timeRangeToDayIntervals(timeRangeA);
  const intervalsB = timeRangeToDayIntervals(timeRangeB);

  if (!intervalsA || !intervalsB) {
    return String(timeRangeA || "").trim() === String(timeRangeB || "").trim();
  }

  return intervalsA.some(function (a) {
    return intervalsB.some(function (b) {
      return Math.max(a.start, b.start) <= Math.min(a.end, b.end);
    });
  });
}

function getWishGroupKey(wish) {
  return String(wish && wish.flower || "").trim();
}

function normalizeWishTimeRange(value) {
  return String(value || "未設定").trim() || "未設定";
}

function groupByValue(items, getter) {
  const map = new Map();
  items.forEach(function (item) {
    const key = getter(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  });
  return Array.from(map.entries()).map(function (entry) {
    return { key: entry[0], items: entry[1] };
  });
}

function groupWishesByFlower(wishList) {
  return groupByValue(wishList, getWishGroupKey).map(function (group) {
    return group.items;
  });
}

function groupWishesByExactTime(wishList) {
  return groupByValue(wishList, function (wish) {
    return normalizeWishTimeRange(wish.timeRange);
  });
}

function ensureWishDetailModal() {
  let modal = document.getElementById("wishDetailModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "wishDetailModal";
  modal.className = "modal wish-detail-modal";
  modal.innerHTML = `
    <div class="modal-box modal-box-large wish-detail-box" role="dialog" aria-modal="true" aria-labelledby="wishDetailTitle">
      <h2 id="wishDetailTitle">詳細資訊</h2>
      <div id="wishDetailContent" class="wish-detail-content"></div>
      <div class="modal-actions">
        <button class="cancel-btn" type="button" onclick="closeWishDetailModal()">關閉</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.addEventListener("click", function (event) {
    if (event.target === modal) closeWishDetailModal();
  });

  return modal;
}

function closeWishDetailModal() {
  const modal = document.getElementById("wishDetailModal");
  if (modal) modal.classList.remove("show");
}

function openWishDetailModal(groupKeysText) {
  const selectedWishKeys = String(groupKeysText || "").split("||").filter(Boolean);
  const keySet = new Set(selectedWishKeys);
  const group = sortOldestFirst(wishes).filter(function (wish) {
    return keySet.has(String(getWishKey(wish))) && wish.status !== "pending" && wish.status !== "done";
  });

  if (!group.length) {
    alert("這個時段已經被接走或不存在了。");
    renderAll();
    return;
  }

  const firstWish = group[0];
  const modal = ensureWishDetailModal();
  const title = document.getElementById("wishDetailTitle");
  const content = document.getElementById("wishDetailContent");
  const timeGroups = groupWishesByExactTime(group);

  if (title) title.textContent = `🌸 ${firstWish.flower || "花朵"}`;

  if (content) {
    content.innerHTML = `
      <p class="wish-detail-summary">目前 ${group.length} 人許願</p>
      ${timeGroups.map(function (timeGroup) {
        const timeWishKeys = timeGroup.items.map(function (wish) { return getWishKey(wish); }).join("||");
        const peopleHtml = timeGroup.items.map(function (wish) {
          return `
            <div class="wish-detail-person">
              <p>👤 ${displayNameWithTagHtml(wish.nickname || "匿名許願者", wish.requesterPlatform || wish.platform)}</p>
              <p>💬 ${escapeHtml(wish.message || "沒有留言")}</p>
              ${wish.lastCancelReason || wish.cancelReason ? `<p class="hint cancel-reason">上次取消原因：${escapeHtml(wish.lastCancelReason || wish.cancelReason)}</p>` : ""}
            </div>
          `;
        }).join("");

        return `
          <section class="wish-time-group-detail">
            <h3>🕒 ${escapeHtml(timeGroup.key)}｜${timeGroup.items.length}人許願</h3>
            <div class="wish-detail-people">${peopleHtml}</div>
            ${firstWish.isExample
              ? `<button class="help-btn disabled-btn" type="button" disabled>範例卡不能接單</button>`
              : `<button class="help-btn" type="button" data-wish-key="${escapeHtml(timeWishKeys)}">我可以幫忙</button>`}
          </section>
        `;
      }).join("")}
    `;
  }

  modal.classList.add("show");
}

function renderWishes() {
  removeExpiredWishes();
  const list = document.getElementById("wishList");
  if (!list) return;
  list.innerHTML = "";

  const activeWishes = sortOldestFirst(wishes).filter(function (wish) {
    return wish.status !== "pending" && wish.status !== "done";
  });

  if (activeWishes.length === 0) {
    list.innerHTML = '<div class="empty">目前沒有願望卡。</div>';
    return;
  }

  const groupedWishes = groupWishesByFlower(activeWishes);

  groupedWishes.forEach(function (group) {
    const firstWish = group[0];
    const cardClass = firstWish.isExample ? "card example-card" : "card";
    const timeGroups = groupWishesByExactTime(group);
    const groupWishKeys = group.map(function (wish) { return getWishKey(wish); }).join("||");
    const groupCurrentlyAvailable = group.some(function (wish) {
      return isTimeRangeCurrentlyAvailable(wish.timeRange);
    });
    const groupTimeRanges = timeGroups.map(function (timeGroup) { return timeGroup.key; }).join("、");
    const timeListHtml = timeGroups.map(function (timeGroup) {
      return `<li>${escapeHtml(timeGroup.key)}（${timeGroup.items.length}人）</li>`;
    }).join("");

    list.innerHTML += `
      <article class="${cardClass}" data-owner-uid="${escapeHtml(getWishOwnerUid(firstWish))}" data-time-range="${escapeHtml(groupTimeRanges || firstWish.timeRange || "")}" data-currently-available="${groupCurrentlyAvailable ? "true" : "false"}">
        <h3>🌸 ${escapeHtml(firstWish.flower)}</h3>
        <p>目前 ${group.length} 人許願</p>
        <div class="wish-time-summary">
          <p>🕒 可採花時段</p>
          <ul>${timeListHtml}</ul>
        </div>
        <div class="wish-actions merged-help-action">
          <button class="detail-btn" type="button" data-detail-wish-key="${escapeHtml(groupWishKeys)}">詳細資訊</button>
          ${group.some(function(wish){
            return !wish.isExample && isCurrentWishOwner(wish);
          }) ? `<button class="delete-btn outer-delete-btn" type="button" data-delete-group="${escapeHtml(groupWishKeys)}">刪除我的許願</button>` : ""}
        </div>
      </article>
    `;
  });
}

function getPendingGroupKey(item) {
  return [
    String(item.flower || "").trim(),
    normalizeWishTimeRange(item.timeRange),
    String(item.farmerUid || item.acceptedByUid || item.farmer || item.acceptedBy || "").trim(),
    String(item.acceptedAt || "").trim()
  ].join("__");
}

function groupPendingOrders(pendingList) {
  return groupByValue(pendingList, getPendingGroupKey).map(function (group) {
    return group.items;
  });
}

function renderPending() {
  const list = document.getElementById("pendingList");
  if (!list) return;
  list.innerHTML = "";

  if (pending.length === 0) {
    list.innerHTML = '<div class="empty">目前沒有待完成願望。</div>';
    return;
  }

  const groupedPending = groupPendingOrders(sortOldestFirst(pending));

  groupedPending.forEach(function (group) {
    const firstItem = group[0];
    const canComplete = group.every(function (item) { return isCurrentFarmer(item); });
    const pendingKeys = group.map(function (item) { return getWishKey(item); }).join("||");
    const safePendingKeys = escapeHtml(pendingKeys);
    const requesterList = group.map(function (item) {
      return `<li>${displayNameWithTagHtml(item.nickname || "匿名許願者", item.requesterPlatform || item.platform)}${item.message ? `｜${escapeHtml(item.message)}` : ""}</li>`;
    }).join("");
    const actionButton = canComplete
      ? `<div class="pending-actions"><button class="done-btn" type="button" data-pending-key="${safePendingKeys}">完成分享</button><button class="cancel-take-btn" type="button" data-pending-key="${safePendingKeys}">取消接單</button></div>`
      : `<button class="done-btn disabled-btn" type="button" disabled>等待花農完成分享</button>`;

    list.innerHTML += `
      <article class="card" data-farmer-uid="${escapeHtml(String(firstItem.farmerUid || firstItem.acceptedByUid || "").trim())}">
        <h3>🌱 ${escapeHtml(firstItem.flower)}</h3>
        <p>🌙 可收花時間：${escapeHtml(firstItem.timeRange || "未設定")}｜${group.length}人</p>
        <p>🌱 接單花農：${displayNameWithTagHtml(firstItem.farmer || firstItem.acceptedBy || "花農", firstItem.farmerPlatform || firstItem.acceptedByPlatform)}</p>
        <div class="pending-requesters">
          <p>👤 許願者：</p>
          <ul>${requesterList}</ul>
        </div>
        ${actionButton}
      </article>
    `;
  });
}

function renderDone() {
  const now = Date.now();
  done = done.filter(function (item) {
    return !item.deleteAt || item.deleteAt > now;
  });

  const list = document.getElementById("doneList");
  list.innerHTML = "";

  if (done.length === 0) {
    list.innerHTML = '<div class="empty">目前沒有完成分享。</div>';
    return;
  }

  sortOldestFirst(done, function (item) { return item.doneAt || getWishSortTime(item); }).forEach(function (item) {
    if (typeof item.id === "undefined") item.id = item.firebaseId || Date.now();
    if (typeof item.likes === "undefined") item.likes = 0;
    const doneKey = getWishKey(item);
    item.liked = hasLikedDoneKey(doneKey);

    const donePeopleHtml = item.directShare
      ? `<p>📍 分享類型：花農直接上傳</p><p>🌱 分享花農：${displayNameWithTagHtml(item.farmer, item.farmerPlatform || item.acceptedByPlatform)}</p>`
      : `<p>👤 發願者：${displayNameWithTagHtml(item.nickname, item.requesterPlatform || item.platform)}</p><p>🌱 接單花農：${displayNameWithTagHtml(item.farmer, item.farmerPlatform || item.acceptedByPlatform)}</p>`;

    list.innerHTML += `
      <article class="card">
        <h3>✨ ${escapeHtml(item.flower)}</h3>
        ${donePeopleHtml}
        <p>🌼 採收資訊：${escapeHtml(item.harvestInfo)}</p>

        ${(() => {
          const coordId = `coord-${item.id}`;
          const coordOpen = expandedCoordMap.get(coordId) === true;
          return `
            <button class="detail-btn toggle-coord-btn" type="button" data-target="${coordId}">
              ${coordOpen ? "隱藏詳細座標" : "顯示詳細座標"}
            </button>

            <div id="${coordId}" style="display:${coordOpen ? "block" : "none"}; margin-top:10px;">
              <p>📍 座標：</p>
              <pre class="coord-list">${escapeHtml(item.location).replace(/\\n/g, "\n")}</pre>
            </div>
          `;
        })()}

        <div class="done-actions">
          <button class="like-btn ${item.liked ? "liked" : ""}" type="button" data-done-key="${escapeHtml(doneKey)}">
            👍 ${item.likes}
          </button>
          <button class="copy-btn" type="button" data-done-key="${escapeHtml(doneKey)}">
            快速複製座標
          </button>
        </div>

        <p>⏰ 剩餘刪除時間：${getRemainTime(item.deleteAt)}</p>
      </article>
    `;
  });

  saveData();
}

setInterval(function () {
  renderWishes();
  renderDone();
  bindDynamicButtons();
  saveData();
}, 3000);

async function toggleLike(id) {
  const item = done.find(function (x) {
    return String(getWishKey(x)) === String(id);
  });

  if (!item) return;

  const doneKey = getWishKey(item);
  const alreadyLiked = hasLikedDoneKey(doneKey);

  // 可按讚／取消按讚：再點一次會取消，數字不會低於 0
  if (alreadyLiked) {
    item.likes = Math.max(0, Number(item.likes || 0) - 1);
    item.liked = false;
    setLikedDoneKey(doneKey, false);
  } else {
    item.likes = Number(item.likes || 0) + 1;
    item.liked = true;
    setLikedDoneKey(doneKey, true);
  }


  saveData();
  renderDone();

  // 完成區的讚數要寫回 Firebase，否則重新整理或即時同步後會變回 0。
  if (item.firebaseId && window.firebaseDB && window.firebaseFns) {
    const { updateDoc, doc } = window.firebaseFns;
    try {
      await updateDoc(doc(window.firebaseDB, "wishes", item.firebaseId), {
        likes: item.likes
      });
    } catch (error) {
      console.warn("讚數同步失敗", error);
      alert("讚數同步失敗，請稍後再試。");
    }
  }
}



function copyHarvestInfo() {
  const harvestInput = document.getElementById("harvestInfoInput");
  const locationInput = document.getElementById("shareLocationInput");

  const harvestInfo = harvestInput ? harvestInput.value.trim() : "";
  const locationText = "https://zhizhi67742.github.io/pikminWish_New/";

  let flowerName = "";

  if (selectedPendingId === "__farmer_direct_share__") {
    flowerName = document.getElementById("flowerInput")?.value?.trim() || "";
  } else {
    const selectedPendingKeys = String(selectedPendingId || "").split("||").filter(Boolean);
    const target = pending.find(function (item) {
      return selectedPendingKeys.includes(String(getWishKey(item)));
    });

    if (target) {
      flowerName = target.flower || "";
    }
  }

  const copyText = `${flowerName} / ${harvestInfo}\n-\n${locationText}`.trim();

  if (!copyText) {
    alert("沒有可複製的內容！");
    return;
  }

  navigator.clipboard.writeText(copyText).then(function () {
    alert("已複製！");
  }).catch(function () {
    const temp = document.createElement("textarea");
    temp.value = copyText;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand("copy");
    document.body.removeChild(temp);
    alert("已複製！");
  });
}

function copyCoords(id) {
  const item = done.find(function (x) {
    return String(getWishKey(x)) === String(id);
  });

  if (!item) return;

  const coordCount = item.location.split("\n").filter(Boolean).length;

  navigator.clipboard.writeText(item.location).then(function () {
    alert("已複製 " + coordCount + " 組座標！");
  }).catch(function () {
    const temp = document.createElement("textarea");
    temp.value = item.location;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand("copy");
    document.body.removeChild(temp);
    alert("已複製 " + coordCount + " 組座標！");
  });
}

function renderDex() {
  const list = document.getElementById("flowerDexList");
  const searchInput = document.getElementById("dexSearchInput");
  const keyword = searchInput ? searchInput.value.trim() : "";

  if (!list) return;

  list.innerHTML = "";
  updateDexFilterButtons();

  const filteredDex = flowerDex.filter(function (flower) {
    if (keyword && !flower.name.includes(keyword)) return false;

    return flower.colors.some(function (color) {
      return isDexRowMatchingFilter(flower.name, color);
    });
  });

  if (filteredDex.length === 0) {
    list.innerHTML = '<div class="empty">找不到符合的花種。</div>';
    return;
  }

  const openedFlowerNames = Array.from(document.querySelectorAll(".dex-item.open .dex-title"))
    .map(function (btn) { return (btn.dataset.flowerName || "").trim(); })
    .filter(Boolean);

  filteredDex.forEach(function (flower, index) {
    let rows = "";

    flower.colors.forEach(function (color) {
      const essenceKey = `dex_${flower.name}_${color}_essence`;
      const petalKey = `dex_${flower.name}_${color}_petal`;
      const safeEssenceKey = escapeHtml(essenceKey);
      const safePetalKey = escapeHtml(petalKey);

      const essence = Number(safeGetLocalStorage(essenceKey) || 0);
      const petal = Number(safeGetLocalStorage(petalKey) || 0);

      if (!isDexRowMatchingFilter(flower.name, color)) return;

      rows += `
        <tr class="dex-data-row" data-essence-key="${safeEssenceKey}" data-petal-key="${safePetalKey}">
          <td>${getColorEmoji(color)} ${color}</td>

          <td>
            <div class="dex-input-line">
              <input
                type="number"
                min="0"
                max="${essenceLimit}"
                value="${essence}"
                data-dex-key="${safeEssenceKey}"
                oninput="saveDexValue('${essenceKey}', this.value, ${essenceLimit}, false)"
                onchange="saveDexValue('${essenceKey}', this.value, ${essenceLimit}, false)"
              />
              <span>/ ${essenceLimit}</span>
            </div>
          </td>

          <td>
            <div class="dex-input-line">
              <input
                type="number"
                min="0"
                max="${petalLimit}"
                value="${petal}"
                data-dex-key="${safePetalKey}"
                oninput="saveDexValue('${petalKey}', this.value, ${petalLimit}, false)"
                onchange="saveDexValue('${petalKey}', this.value, ${petalLimit}, false)"
              />
              <span>/ ${petalLimit}</span>
            </div>
          </td>

          <td class="dex-status-cell">${getDexStatus(essence, petal)}</td>

          <td>
            <button class="confirm-btn" onclick="wishFromDex('${flower.name}', '${color}')">缺</button>
          </td>
        </tr>
      `;
    });

    const subtitle = flower.subtitle ? `<span class="flower-subtitle">（${escapeHtml(flower.subtitle)}）</span>` : "";

    list.innerHTML += `
      <div class="dex-item ${(openedFlowerNames.length ? openedFlowerNames.includes(flower.name) : index === 0) ? "open" : ""}">
        <button class="dex-title" data-flower-name="${escapeHtml(flower.name)}" onclick="toggleDex(this)">🌼 ${escapeHtml(flower.name)}${subtitle} ▼</button>
        <div class="dex-content">
          <table class="dex-table">
            <thead>
              <tr>
                <th>顏色</th>
                <th>精華</th>
                <th>花瓣</th>
                <th>狀態</th>
                <th>快速許願</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;
  });
}


function getDexFilterGroup(mode) {
  if (["missing", "full", "essence", "petal"].includes(mode)) return "status";
  if (["white", "yellow", "red", "blue"].includes(mode)) return "color";
  if (["forget", "rose"].includes(mode)) return "monthly";
  return "all";
}

function getDexActiveFilterGroups() {
  const groups = { status: [], color: [], monthly: [] };

  dexActiveFilters.forEach(function (mode) {
    const group = getDexFilterGroup(mode);
    if (groups[group]) groups[group].push(mode);
  });

  return groups;
}

function isDexRowMatchingFilter(flowerName, color) {
  if (!Array.isArray(dexActiveFilters) || dexActiveFilters.length === 0) return true;

  const essence = Number(safeGetLocalStorage(`dex_${flowerName}_${color}_essence`) || 0);
  const petal = Number(safeGetLocalStorage(`dex_${flowerName}_${color}_petal`) || 0);
  const isFull = essence >= essenceLimit && petal >= petalLimit;
  const filters = getDexActiveFilterGroups();

  const statusOk = filters.status.length === 0 || filters.status.some(function (mode) {
    if (mode === "missing") return !isFull;
    if (mode === "full") return isFull;
    if (mode === "essence") return essence < essenceLimit;
    if (mode === "petal") return petal < petalLimit;
    return true;
  });

  const colorMap = { white: "白", yellow: "黃", red: "紅", blue: "藍" };
  const colorOk = filters.color.length === 0 || filters.color.some(function (mode) {
    return color.includes(colorMap[mode]);
  });

  const monthlyOk = filters.monthly.length === 0 || filters.monthly.some(function (mode) {
    if (mode === "forget") return flowerName.includes("勿忘草");
    if (mode === "rose") return flowerName.includes("週年玫瑰") || flowerName.includes("周年玫瑰") || flowerName.includes("周年紀念玫瑰");
    return true;
  });

  return statusOk && colorOk && monthlyOk;
}

function toggleDexAdvanced() {
  const panel = document.getElementById("dexAdvancedPanel");
  const btn = document.getElementById("dexAdvancedBtn");
  if (!panel) return;

  const isOpen = panel.classList.toggle("open");
  if (btn) btn.classList.toggle("active", isOpen);
}

function setDexFilter(mode) {
  mode = mode || "all";

  if (mode === "all") {
    dexActiveFilters = [];
  } else {
    dexActiveFilters = Array.isArray(dexActiveFilters) ? dexActiveFilters : [];
    if (dexActiveFilters.includes(mode)) {
      dexActiveFilters = dexActiveFilters.filter(function (item) { return item !== mode; });
    } else {
      dexActiveFilters.push(mode);
    }
  }

  dexFilterMode = dexActiveFilters.length ? dexActiveFilters.join(",") : "all";
  safeSetLocalStorage("flowerDexActiveFilters", JSON.stringify(dexActiveFilters));
  safeSetLocalStorage("flowerDexFilterMode", dexFilterMode);
  renderDex();
}

function updateDexFilterButtons() {
  dexActiveFilters = Array.isArray(dexActiveFilters) ? dexActiveFilters : [];

  document.querySelectorAll(".dex-filter-btn").forEach(function (btn) {
    const mode = btn.dataset.filter;
    btn.classList.toggle("active", mode === "all" ? dexActiveFilters.length === 0 : dexActiveFilters.includes(mode));
  });
}

function toggleDex(btn) {
  btn.parentElement.classList.toggle("open");
}

function getDexInputByKey(key) {
  const safeKey = String(key || "");
  if (!safeKey) return null;

  if (window.CSS && typeof window.CSS.escape === "function") {
    return document.querySelector(`[data-dex-key="${CSS.escape(safeKey)}"]`);
  }

  return Array.from(document.querySelectorAll("[data-dex-key]")).find(function (input) {
    return input.dataset.dexKey === safeKey;
  }) || null;
}

function updateDexRowStatusFromKey(key) {
  const input = getDexInputByKey(key);
  if (!input) return;

  const row = input.closest(".dex-data-row");
  if (!row) return;

  const essenceKey = row.dataset.essenceKey || "";
  const petalKey = row.dataset.petalKey || "";
  const essence = Number(safeGetLocalStorage(essenceKey) || 0);
  const petal = Number(safeGetLocalStorage(petalKey) || 0);
  const statusCell = row.querySelector(".dex-status-cell");

  if (statusCell) statusCell.innerHTML = getDexStatus(essence, petal);
}

function saveDexValue(key, value, limit, shouldRender) {
  let number = Number(value);

  if (Number.isNaN(number)) number = 0;
  if (number < 0) number = 0;
  if (number > limit) number = limit;
  if (number > 1200) number = 1200;

  safeSetLocalStorage(key, String(number));
  saveDexBackupValue(key, number);

  const activeInput = getDexInputByKey(key);
  if (activeInput && activeInput.value !== String(number)) {
    activeInput.value = String(number);
  }

  if (shouldRender !== false) {
    renderDex();
  } else {
    updateDexRowStatusFromKey(key);
  }
}

function saveGlobalLimit(type, value) {
  let number = Number(value);

  if (number < 1) number = 1;
  if (number > 1200) number = 1200;

  if (type === "essence") {
    essenceLimit = number;
    safeSetLocalStorage("flowerWishEssenceLimit", String(number));
  }

  if (type === "petal") {
    petalLimit = number;
    safeSetLocalStorage("flowerWishPetalLimit", String(number));
  }

  clampDexValuesToLimits();
  updateLimitInputs();
  renderDex();
  scheduleDexCloudSave();
}

function updateLimitInputs() {
  const essenceInput = document.getElementById("essenceLimitInput");
  const petalInput = document.getElementById("petalLimitInput");

  if (essenceInput) essenceInput.value = essenceLimit;
  if (petalInput) petalInput.value = petalLimit;
}

function clampDexValuesToLimits() {
  flowerDex.forEach(function (flower) {
    flower.colors.forEach(function (color) {
      const essenceKey = `dex_${flower.name}_${color}_essence`;
      const petalKey = `dex_${flower.name}_${color}_petal`;

      const essence = Number(safeGetLocalStorage(essenceKey) || 0);
      const petal = Number(safeGetLocalStorage(petalKey) || 0);

      if (essence > essenceLimit) {
        safeSetLocalStorage(essenceKey, String(essenceLimit));
        saveDexBackupValue(essenceKey, essenceLimit);
      }

      if (petal > petalLimit) {
        safeSetLocalStorage(petalKey, String(petalLimit));
        saveDexBackupValue(petalKey, petalLimit);
      }
    });
  });
}

function wishFromDex(name, color) {
  const firstBtn = document.querySelector('.nav-btn[onclick*="showSection(\'wish\'"]') ||
    document.querySelector('.nav-btn[onclick*="showSection(&quot;wish&quot;)"]') ||
    document.querySelectorAll(".nav-btn")[0];

  if (typeof showSection === "function") {
    showSection("wish", firstBtn);
  }

  const flowerName = String(name || "").trim();
  const rawColor = String(color || "").trim();
  // 圖鑑裡「白色」仍然顯示，但許願單不開放白色；
  // 從圖鑑按白色的「缺」時，自動改成許願單可用的「混色」。
  const normalizedColor = isWhiteWishColor(rawColor) ? "混色" : normalizeWishColorValue(rawColor);

  function applyQuickWishSelection() {
    const comboInput = document.getElementById("flowerComboInput") || document.getElementById("flowerKeywordInput");
    const colorSelect = document.getElementById("flowerColorSelect");
    const flowerInput = document.getElementById("flowerInput");
    const dropdown = document.getElementById("flowerComboDropdown");
    const catalogFlower = findCatalogFlowerForWish(flowerName);

    if (!comboInput || !colorSelect || !flowerInput || !catalogFlower) return false;

    // 先初始化選單事件，再把快速許願的花名真正寫進搜尋框。
    initFlowerPicker();

    comboInput.value = flowerName;
    comboInput.removeAttribute("aria-invalid");
    comboInput.dispatchEvent(new Event("input", { bubbles: true }));

    const baseColors = Array.isArray(catalogFlower.colors) ? catalogFlower.colors : [];
    const wishColors = getWishColorOptions(baseColors);
    const isSingleColorFlower = baseColors.length <= 1 && wishColors.length <= 1 && normalizedColor !== "混色";

    if (isSingleColorFlower) {
      colorSelect.style.display = "none";
      colorSelect.innerHTML = '<option value="">單色花</option>';
      flowerInput.value = flowerName;
    } else {
      colorSelect.style.display = "";
      if (normalizedColor && !isWhiteWishColor(normalizedColor)) {
        appendWishColorOptionIfMissing(colorSelect, normalizedColor);
        colorSelect.value = normalizedColor;
      } else if (colorSelect.options.length) {
        colorSelect.selectedIndex = 0;
      }
      colorSelect.dispatchEvent(new Event("change", { bubbles: true }));
      flowerInput.value = buildWishFlowerName(colorSelect.value, flowerName);
    }

    if (dropdown) dropdown.classList.remove("open");

    const messageInput = document.getElementById("messageInput");
    if (messageInput) messageInput.focus();

    window.scrollTo({ top: 0, behavior: "smooth" });
    return true;
  }

  // 有些手機瀏覽器切換頁籤後 DOM 會晚一點完成 active，補兩次確保會自動填入。
  if (!applyQuickWishSelection()) {
    setTimeout(applyQuickWishSelection, 60);
  } else {
    setTimeout(applyQuickWishSelection, 80);
  }
}

function getDexStatus(essence, petal) {
  if (essence >= essenceLimit && petal >= petalLimit) {
    return '<span class="status-full">已滿 ✨</span>';
  }

  if (essence < Math.min(100, essenceLimit) || petal < Math.min(100, petalLimit)) {
    return '<span class="status-low">不足 ⚠️</span>';
  }

  return "收集中 🌱";
}

function getColorEmoji(color) {
  const map = {
    "白": "🤍",
    "黃": "💛",
    "紅": "❤️",
    "藍": "💙"
  };
  return map[color] || "🌸";
}


function getWishDeleteAtThreeDaysLater() {
  return Date.now() + (3 * 24 * 60 * 60 * 1000);
}

function getWishDeleteAtFromEndTime(endTime) {
  const now = new Date();
  const parts = endTime.split(":");
  const endDate = new Date();

  endDate.setHours(Number(parts[0]), Number(parts[1]), 0, 0);

  if (endDate.getTime() <= now.getTime()) {
    endDate.setDate(endDate.getDate() + 1);
  }

  return endDate.getTime();
}

function cleanCoordinates(rawText) {
  const text = String(rawText || "")
    .replace(/[「」『』“”‘’"'`]/g, "")
    .replace(/[，]/g, ",");

  const matches = text.match(/-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?/g) || [];

  return matches
    .map(function (item) {
      return item.replace(/\s+/g, "").trim();
    })
    .filter(function (item, index, arr) {
      return item && arr.indexOf(item) === index;
    })
    .join("\n");
}

function formatRemainTime(targetTime) {
  if (!targetTime) return "未設定";

  const remain = Math.max(0, targetTime - Date.now());
  const totalSeconds = Math.floor(remain / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}小時 ${String(minutes).padStart(2, "0")}分`;
  }

  return `${String(minutes).padStart(2, "0")}分 ${String(seconds).padStart(2, "0")}秒`;
}

function isEndingSoon(targetTime) {
  if (!targetTime) return false;
  const remain = targetTime - Date.now();
  return remain > 0 && remain <= 30 * 60 * 1000;
}


function isDemoWish(wish) {
  if (!wish) return false;
  return wish.isExample === true ||
    wish.id === 999999 ||
    wish.nickname === "範例玩家" ||
    wish.nickname === "小芽";
}

function removeDemoWishesFromStorage() {
  wishes = wishes.filter(function (wish) {
    return !isDemoWish(wish);
  });

  pending = pending.filter(function (wish) {
    return !isDemoWish(wish);
  });

  done = done.filter(function (wish) {
    return !isDemoWish(wish);
  });

  safeSetLocalStorage("flowerWishWishes", JSON.stringify(wishes));
  safeSetLocalStorage("flowerWishPending", JSON.stringify(pending));
  safeSetLocalStorage("flowerWishDone", JSON.stringify(done));
  safeSetLocalStorage("flowerWishHistory", JSON.stringify(wishHistory));
}

function removeExpiredWishes() {
  const now = Date.now();
  wishes = wishes.filter(function (wish) {
    return !isDemoWish(wish) && (!wish.deleteAt || wish.deleteAt > now);
  });
}

function formatNow() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
}

function getRemainTime(deleteAt) {
  const remain = Math.max(0, deleteAt - Date.now());
  const totalSeconds = Math.floor(remain / 1000);
  const m = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const s = String(totalSeconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function saveData() {
  safeSetLocalStorage("flowerWishNickname", nickname);
  safeSetLocalStorage("flowerWishWishes", JSON.stringify(wishes));
  safeSetLocalStorage("flowerWishPending", JSON.stringify(pending));
  safeSetLocalStorage("flowerWishDone", JSON.stringify(done));
  safeSetLocalStorage("flowerWishHistory", JSON.stringify(wishHistory));
}

function loadData() {
  nickname = safeGetLocalStorage("flowerWishNickname") || "";
  
  const oldNicknameInput = document.getElementById("nicknameInput");
  if (oldNicknameInput) {
    oldNicknameInput.value = nickname;
  }

  const savedWishes = safeGetLocalStorage("flowerWishWishes");
  const savedPending = safeGetLocalStorage("flowerWishPending");
  const savedDone = safeGetLocalStorage("flowerWishDone");
  const savedHistory = safeGetLocalStorage("flowerWishHistory");
  essenceLimit = Number(safeGetLocalStorage("flowerWishEssenceLimit") || 1200);
  petalLimit = Number(safeGetLocalStorage("flowerWishPetalLimit") || 1200);
  try {
    dexActiveFilters = JSON.parse(safeGetLocalStorage("flowerDexActiveFilters") || "[]");
  } catch (error) {
    dexActiveFilters = [];
  }

  if (!Array.isArray(dexActiveFilters)) dexActiveFilters = [];

  const oldDexFilterMode = safeGetLocalStorage("flowerDexFilterMode") || "all";
  if (dexActiveFilters.length === 0 && oldDexFilterMode !== "all" && !oldDexFilterMode.includes(",")) {
    dexActiveFilters = [oldDexFilterMode];
  }

  dexFilterMode = dexActiveFilters.length ? dexActiveFilters.join(",") : "all";

  if (savedWishes) wishes = JSON.parse(savedWishes);
  if (savedPending) pending = JSON.parse(savedPending);
  if (savedDone) done = JSON.parse(savedDone);
  if (savedHistory) wishHistory = JSON.parse(savedHistory);

  removeDemoWishesFromStorage();


  flowerDex = JSON.parse(JSON.stringify(DEFAULT_FLOWER_DEX));
  rebuildFlowerDexFromSources();
  restoreDexBackupValues();
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function safeSetLocalStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn("localStorage 寫入失敗：", key, error);
    return false;
  }
}

function safeGetLocalStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.warn("localStorage 讀取失敗：", key, error);
    return null;
  }
}

function getDexBackup() {
  try {
    return JSON.parse(safeGetLocalStorage("flowerDexBackupV2") || "{}");
  } catch (error) {
    return {};
  }
}

function saveDexBackupValue(key, number) {
  const backup = getDexBackup();
  backup[key] = {
    value: Number(number) || 0,
    updatedAt: Date.now()
  };
  safeSetLocalStorage("flowerDexBackupV2", JSON.stringify(backup));
  safeSetLocalStorage("flowerDexLastSavedAt", String(Date.now()));
  scheduleDexCloudSave();
}

function restoreDexBackupValues() {
  const backup = getDexBackup();

  Object.keys(backup).forEach(function (key) {
    if (safeGetLocalStorage(key) === null && backup[key] && typeof backup[key].value !== "undefined") {
      safeSetLocalStorage(key, String(backup[key].value));
    }
  });
}

function fixExampleCardMessageSafely() {
  let changed = false;

  wishes.forEach(function(wish){
    if (wish.isExample && wish.message !== "謝謝花農") {
      wish.message = "謝謝花農";
      changed = true;
    }
  });

  if (changed) {
    saveData();
  }
}



/* =========================
   花朵圖鑑雲端同步（用暱稱當同步代號）
   同一個暱稱在手機/電腦輸入後，就會讀同一份圖鑑。
========================= */

let dexCloudSaveTimer = null;
let dexCloudLoadedName = "";
let dexCloudIsApplying = false;

function getDexUserKey(name) {
  const raw = String(name || getCurrentNickname() || "").trim();
  if (!raw) return "";
  return encodeURIComponent(raw).replaceAll("/", "%2F");
}

function getDexCloudDocRef(name) {
  if (!window.firebaseDB || !window.firebaseFns || !window.firebaseFns.doc) return null;
  const key = getDexUserKey(name);
  if (!key) return null;
  return window.firebaseFns.doc(window.firebaseDB, "flowerDexUsers", key);
}

async function loadDexFromCloud(name) {
  const docRef = getDexCloudDocRef(name);
  if (!docRef || !window.firebaseFns.getDoc) return;

  try {
    const snap = await window.firebaseFns.getDoc(docRef);
    dexCloudLoadedName = String(name || getCurrentNickname() || "").trim();

    if (!snap.exists()) {
      scheduleDexCloudSave();
      return;
    }

    const data = snap.data() || {};
    const values = data.values || {};

    dexCloudIsApplying = true;

    Object.keys(values).forEach(function (key) {
      const item = values[key];
      const cloudValue = typeof item === "object" && item !== null ? item.value : item;
      const cloudUpdatedAt = typeof item === "object" && item !== null ? Number(item.updatedAt || data.updatedAt || 0) : Number(data.updatedAt || 0);
      const localBackup = getDexBackup()[key];
      const localUpdatedAt = localBackup ? Number(localBackup.updatedAt || 0) : 0;

      // 新裝置沒有資料時讀雲端；兩邊都有資料時保留更新時間較新的。
      if (safeGetLocalStorage(key) === null || cloudUpdatedAt >= localUpdatedAt) {
        safeSetLocalStorage(key, String(Number(cloudValue) || 0));
      }
    });

    if (data.essenceLimit) {
      essenceLimit = Number(data.essenceLimit) || essenceLimit;
      safeSetLocalStorage("flowerWishEssenceLimit", String(essenceLimit));
    }

    if (data.petalLimit) {
      petalLimit = Number(data.petalLimit) || petalLimit;
      safeSetLocalStorage("flowerWishPetalLimit", String(petalLimit));
    }

    // 把雲端值重新整理進備份，之後才不會被舊 localStorage 蓋回去。
    const backup = getDexBackup();
    Object.keys(values).forEach(function (key) {
      const item = values[key];
      const cloudValue = typeof item === "object" && item !== null ? item.value : item;
      backup[key] = { value: Number(cloudValue) || 0, updatedAt: Number(data.updatedAt || Date.now()) };
    });
    safeSetLocalStorage("flowerDexBackupV2", JSON.stringify(backup));

    dexCloudIsApplying = false;
    updateLimitInputs();
    renderDex();
  } catch (error) {
    dexCloudIsApplying = false;
    console.warn("圖鑑雲端讀取失敗", error);
  }
}

function scheduleDexCloudSave() {
  if (dexCloudIsApplying) return;
  if (!window.firebaseDB || !window.firebaseFns || !window.firebaseFns.setDoc) return;
  const name = getCurrentNickname();
  if (!name) return;

  clearTimeout(dexCloudSaveTimer);
  dexCloudSaveTimer = setTimeout(function () {
    saveDexToCloud(name);
  }, 500);
}

async function saveDexToCloud(name) {
  const docRef = getDexCloudDocRef(name);
  if (!docRef || !window.firebaseFns.setDoc) return;

  const backup = getDexBackup();
  const now = Date.now();
  const values = {};

  Object.keys(backup).forEach(function (key) {
    values[key] = {
      value: Number(backup[key].value) || 0,
      updatedAt: Number(backup[key].updatedAt || now)
    };
  });

  try {
    await window.firebaseFns.setDoc(docRef, {
      nickname: String(name || "").trim(),
      values: values,
      essenceLimit: essenceLimit,
      petalLimit: petalLimit,
      updatedAt: now
    }, { merge: true });
  } catch (error) {
    console.warn("圖鑑雲端儲存失敗", error);
  }
}


function getSpamWishGroupKey(wish) {
  return String(wish && wish.flower || "").trim();
}

function findSpamWishGroups(wishList) {
  const activeWishes = (Array.isArray(wishList) ? wishList : []).filter(function (wish) {
    return wish && wish.firebaseId && wish.status !== "pending" && wish.status !== "done";
  });

  const grouped = groupByValue(activeWishes, getSpamWishGroupKey);

  return grouped.filter(function (group) {
    // 正常社群許願不可能同一花種瞬間累積到 1000 人；超過就視為惡意刷單。
    return group.items.length >= 1000;
  });
}

async function cleanupSpamWishGroups(wishList) {
  if (spamWishCleanupRunning) return;
  if (!window.firebaseDB || !window.firebaseFns || !window.firebaseFns.deleteDoc || !window.firebaseFns.doc) return;

  const spamGroups = findSpamWishGroups(wishList).filter(function (group) {
    return !spamWishCleanupDoneKeys.has(group.key);
  });

  if (!spamGroups.length) return;

  spamWishCleanupRunning = true;

  const { deleteDoc, doc } = window.firebaseFns;
  const db = window.firebaseDB;

  try {
    for (const group of spamGroups) {
      spamWishCleanupDoneKeys.add(group.key);
      const ids = group.items
        .map(function (wish) { return wish.firebaseId; })
        .filter(Boolean);

      showSuccessToast(`偵測到異常刷單：${group.key || "未命名花種"}（${ids.length} 筆），正在清理…`);

      for (let i = 0; i < ids.length; i += 50) {
        const batchIds = ids.slice(i, i + 50);
        await Promise.all(batchIds.map(function (id) {
          locallyDeletedWishKeys.add(String(id));
          return deleteDoc(doc(db, "wishes", id));
        }));
      }

      showSuccessToast(`已清理異常刷單：${group.key || "未命名花種"}`);
    }
  } catch (error) {
    console.error("異常刷單清理失敗", error);
    alert("偵測到異常刷單，但雲端刪除失敗。請確認 Firebase 刪除權限或網路狀態。");
  } finally {
    spamWishCleanupRunning = false;
  }
}



/* ===== 進站載入視窗控制 ===== */
window.__pikminInitialLoadState = window.__pikminInitialLoadState || { wishes:false, history:false };
function getOrCreateAppLoadingOverlay() {
  let overlay = document.getElementById("appLoadingOverlay");
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = "appLoadingOverlay";
  overlay.className = "app-loading-overlay hide";
  overlay.setAttribute("aria-live", "polite");
  overlay.setAttribute("aria-busy", "true");
  overlay.innerHTML = `
    <div class="app-loading-card">
      <div class="app-loading-spinner"></div>
      <div class="app-loading-title">資料載入中</div>
      <div class="app-loading-text">正在同步許願池資料，請稍等一下。</div>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function showAppLoadingOverlay(title, text, autoHideMs) {
  const overlay = getOrCreateAppLoadingOverlay();
  const titleEl = overlay.querySelector(".app-loading-title");
  const textEl = overlay.querySelector(".app-loading-text");
  if (titleEl && title) titleEl.textContent = title;
  if (textEl && text) textEl.textContent = text;

  overlay.classList.remove("hide");
  overlay.setAttribute("aria-busy", "true");

  if (overlay.__pikminHideTimer) clearTimeout(overlay.__pikminHideTimer);
  if (autoHideMs) {
    overlay.__pikminHideTimer = setTimeout(hideAppLoadingOverlay, autoHideMs);
  }
}

function hideAppLoadingOverlay() {
  const overlay = document.getElementById("appLoadingOverlay");
  if (!overlay) return;
  overlay.classList.add("hide");
  overlay.setAttribute("aria-busy", "false");
}

function refreshWishOrderViews() {
  try {
    if (typeof renderWishes === "function") renderWishes();
    if (typeof renderPending === "function") renderPending();
    if (typeof renderDone === "function") renderDone();
    if (typeof bindDynamicButtons === "function") bindDynamicButtons();
  } catch (error) {
    console.error("重新整理許願池訂單失敗", error);
  }
}
function markAppInitialLoaded(part) {
  window.__pikminInitialLoadState[part] = true;
  if (window.__pikminInitialLoadState.wishes && window.__pikminInitialLoadState.history) {
    hideAppLoadingOverlay();
  }
}
window.addEventListener("load", function () {
  setTimeout(hideAppLoadingOverlay, 8000);
});

/* =========================
   Firebase 即時同步系統
========================= */

window.addEventListener("firebase-ready", () => {
  startFirebaseSync();
});

async function startFirebaseSync() {
  const db = window.firebaseDB;
  const {
    collection,
    addDoc,
    updateDoc,
    deleteDoc,
    doc,
    onSnapshot,
    setDoc,
    getDoc
  } = window.firebaseFns;

  const wishesRef = collection(db, "wishes");
  const wishHistoryRef = collection(db, "wishHistory");

  // Firebase 準備好後，先讀取這個暱稱的雲端圖鑑。
  const savedDexName = getCurrentNickname();
  if (savedDexName) {
    loadDexFromCloud(savedDexName);
  }

  // 即時同步許願卡：許願區公開、待完成區公開、完成區公開。
  wishHistory = []; renderWishHistory();

  onSnapshot(wishesRef, (snapshot) => {
    const localWishes = wishes.filter(function (item) {
      return !item.firebaseId;
    });
    const localPending = pending.filter(function (item) {
      return !item.firebaseId;
    });
    const localDone = done.filter(function (item) {
      return !item.firebaseId;
    });

    wishes = localWishes;
    pending = localPending;
    done = localDone;

    snapshot.forEach((docItem) => {
      const data = {
        firebaseId: docItem.id,
        ...docItem.data()
      };

      if (locallyDeletedWishKeys.has(String(data.firebaseId || data.id || "")) || isDemoWish(data)) {
        return;
      }

      if (data.status === "pending") {
        data.farmer = data.farmer || data.acceptedBy || "花農";
        pending.push(data);
      } else if (data.status === "done") {
        data.farmer = data.farmer || data.acceptedBy || "花農";
        done.push(data);
        if (!data.directShare) {
          addLocalWishHistory(makeWishHistoryRecord(data, "已完成"));
        }
      } else {
        wishes.push(data);
      }
    });

    cleanupSpamWishGroups(wishes);

    renderWishes();
    renderPending();
    renderDone();
    renderWishHistory();
    saveData();
    bindDynamicButtons();
    markAppInitialLoaded("wishes");
  });

  // 即時同步歷史許願：新增許願不寫入；只顯示完成、刪除/取消、花農分享。
  onSnapshot(wishHistoryRef, (snapshot) => {
    const cloudHistory = [];

    snapshot.forEach((docItem) => {
      const data = {
        historyId: docItem.id,
        ...docItem.data()
      };
      const status = String(data.status || "");

      if (status.includes("已完成") || status.includes("已取消") || status.includes("刪除") || status.includes("花農分享")) {
        cloudHistory.push(data);
      }
    });

    wishHistory = [];
    cloudHistory.forEach(function (item) {
      addLocalWishHistory(item);
    });

    renderWishHistory();
    saveData();
    markAppInitialLoaded("history");
  });

  // Firebase 新增願望
  const originalAddWish = window.addWish;

  window.addWish = async function () {
    const flower = document.getElementById("flowerInput")?.value?.trim();
    const nickname = getCurrentNickname();

    if (!guardWishSubmitCooldown()) return;

    if (!guardPikminAccountCanPost()) return;

    if (!nickname) {
      alert("請先輸入 LINE 社群暱稱，才能新增願望。");
      openRuleModal();
      return;
    }

    if (!flower) {
      warnChooseCatalogFlower();
      return;
    }

    if (!isCatalogWishFlowerValue(flower)) {
      warnChooseCatalogFlower();
      resetFlowerPicker();
      return;
    }

    if (isLockedWishFlowerValue(flower)) {
      warnLockedFlower();
      resetFlowerPicker();
      return;
    }

    const canSubmitRepeatWish = await askRepeatWishIfNeeded(flower, nickname);
    if (!canSubmitRepeatWish) return;

    const startHour = document.getElementById("startHour")?.value || "14";
    const startMinute = document.getElementById("startMinute")?.value || "00";
    const endHour = document.getElementById("endHour")?.value || "20";
    const endMinute = document.getElementById("endMinute")?.value || "00";

    const message = document.getElementById("messageInput")?.value || "";

    const now = new Date();

    const newWish = {
      flower,
      nickname,
      requesterPlatform: getCurrentPlatform(),
      createdAt: now.toLocaleString(),
      timeRange: `${startHour}:${startMinute} - ${endHour}:${endMinute}`,
      message,
      deleteAt: getWishDeleteAtThreeDaysLater(),
      createdTimestamp: Date.now(),
      uid: getCurrentUserUid(),
      ownerUid: getCurrentUserUid(),
      requesterUid: getCurrentUserUid(),
      ownerEmail: window.currentPikminUser ? window.currentPikminUser.email : "",
      status: "wish"
    };

    wishSubmitInProgress = true;

    try {
      await getRecaptchaToken();
      await addDoc(wishesRef, newWish);
      markWishSubmitSuccess();

      alert("已成功送出許願 🌸");

      document.getElementById("flowerInput").value = "";
      resetFlowerPicker();
      if (document.getElementById("messageInput")) {
        document.getElementById("messageInput").value = "";
      }
    } catch (error) {
      console.error(error);
      alert("送出失敗，請稍後再試。");
    } finally {
      wishSubmitInProgress = false;
    }
  };

  // 接單同步
  window.acceptWish = async function(firebaseId) {
    const nickname = localStorage.getItem("flowerWishNickname") || "花農";

    const target = wishes.find(w => w.firebaseId === firebaseId);

    if (!target) return;

    const ok = confirm(`確認接單 ${target.flower} 嗎？`);

    if (!ok) return;

    await updateDoc(doc(db, "wishes", firebaseId), {
      acceptedBy: nickname,
        acceptedByUid: getCurrentUserUid(),
      farmer: nickname,
        farmerUid: getCurrentUserUid(),
      acceptedByPlatform: getCurrentPlatform(),
      farmerPlatform: getCurrentPlatform(),
      farmerUid: window.currentPikminUser ? window.currentPikminUser.uid : "",
      farmerEmail: window.currentPikminUser ? window.currentPikminUser.email : "",
      acceptedAt: formatNow(),
      status: "pending"
    });

    alert("接單成功！");
  };
}




function enterWebsite() {
  const input = document.getElementById("gateNicknameInput");
  const socialSelect = document.getElementById("socialTypeSelect");
  const rawNickname = input ? input.value.trim() : "";
  const platform = socialSelect ? socialSelect.value : "LINE";

  if (!window.currentPikminUser) {
    alert("請先使用 Google 登入，登入後才能使用許願池與圖鑑。");
    return;
  }

  if (!rawNickname) {
    alert("請輸入 LINE 社群或 DC 暱稱");
    return;
  }

  const saved = setNicknameAndPlatform(rawNickname, platform);
  nickname = saved.name;

  const nicknameInput = document.getElementById("nicknameInput");
  if (nicknameInput) {
    nicknameInput.value = nickname;
  }

  const gate = document.getElementById("nicknameGate");
  if (gate) {
    gate.classList.add("hidden-gate");
    gate.style.display = "none";
    gate.style.visibility = "hidden";
    gate.style.pointerEvents = "none";
  }

  if (typeof updateNicknameDisplay === "function") {
    updateNicknameDisplay();
  }

  if (window.firebaseDB && window.firebaseFns && typeof loadDexFromCloud === "function") {
    loadDexFromCloud(nickname);
  }
}

function openRuleModal() {
  const gate = document.getElementById("nicknameGate");
  const input = document.getElementById("gateNicknameInput");
  const savedNickname = localStorage.getItem("flowerWishNickname");

  if (input && savedNickname) {
    input.value = savedNickname;
  }

  if (gate) {
    gate.classList.remove("hidden-gate");
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const savedNickname = localStorage.getItem("flowerWishNickname");
  const input = document.getElementById("gateNicknameInput");
  const nicknameInput = document.getElementById("nicknameInput");

  if (input && savedNickname) {
    input.value = savedNickname;
  }

  if (nicknameInput && savedNickname) {
    nicknameInput.value = savedNickname;
  }

  // 每次進入網站都顯示規則視窗，但暱稱會自動帶入
  const gate = document.getElementById("nicknameGate");
  if (gate) {
    gate.classList.remove("hidden-gate");
  }
});


function updateNicknameDisplay() {
  const nicknameText = document.getElementById("currentNicknameText");
  if (!nicknameText) return;

  const currentName = getCurrentNickname();
  nicknameText.innerHTML = displayNameWithTagHtml(currentName || "未設定", getCurrentPlatform());
}

function openNicknameModal() {
  const gate = document.getElementById("nicknameGate");
  if (!gate) return;

  gate.classList.remove("hidden-gate");

  const input = document.getElementById("gateNicknameInput");
  const savedNickname = localStorage.getItem("flowerWishNickname");

  if (input && savedNickname) {
    input.value = savedNickname;
  }
}

const originalEnterWebsite = enterWebsite;
enterWebsite = async function(...args) {
  const result = await originalEnterWebsite.apply(this, args);
  updateNicknameDisplay();
  return result;
};

window.addEventListener("load", () => {
  setTimeout(updateNicknameDisplay, 300);
});


/* ===== 區塊折疊：只套用許願區 / 待完成區 / 已完成區 ===== */
function setCollapseHeight(el) {
  if (!el || el.classList.contains("is-collapsed")) return;
  el.style.maxHeight = el.scrollHeight + "px";
}

function refreshCollapseHeights() {
  document.querySelectorAll(".collapse-content").forEach(setCollapseHeight);
}

function initCollapseBlocks() {
  document.querySelectorAll(".collapse-btn").forEach(function (btn) {
    if (btn.dataset.collapseReady === "1") return;
    btn.dataset.collapseReady = "1";

    btn.addEventListener("click", function () {
      const targetId = btn.getAttribute("data-collapse-target");
      const target = document.getElementById(targetId);
      const icon = btn.querySelector(".collapse-icon");
      if (!target) return;

      if (target.classList.contains("is-collapsed")) {
        target.classList.remove("is-collapsed");
        target.style.maxHeight = target.scrollHeight + "px";
        btn.setAttribute("aria-expanded", "true");
        if (icon) icon.textContent = "▼";
      } else {
        target.style.maxHeight = target.scrollHeight + "px";
        requestAnimationFrame(function () {
          target.classList.add("is-collapsed");
          target.style.maxHeight = "0px";
        });
        btn.setAttribute("aria-expanded", "false");
        if (icon) icon.textContent = "▶";
      }
    });
  });

  refreshCollapseHeights();

  ["wishList", "pendingList", "doneList"].forEach(function (id) {
    const el = document.getElementById(id);
    if (!el || el.dataset.collapseObserved === "1") return;
    el.dataset.collapseObserved = "1";
    new MutationObserver(refreshCollapseHeights).observe(el, { childList: true, subtree: true });
  });
}

window.addEventListener("load", initCollapseBlocks);
window.addEventListener("resize", refreshCollapseHeights);
document.addEventListener("DOMContentLoaded", initCollapseBlocks);


/* ===== 回到頂部按鈕 ===== */
function initBackToTopBtn() {
  const btn = document.getElementById("backToTopBtn");
  if (!btn || btn.dataset.ready === "1") return;

  btn.dataset.ready = "1";
  btn.addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: "smooth" });
    document.documentElement.scrollTo({ top: 0, behavior: "smooth" });
    document.body.scrollTo({ top: 0, behavior: "smooth" });
  });
}

document.addEventListener("DOMContentLoaded", initBackToTopBtn);
window.addEventListener("load", initBackToTopBtn);








/* ===== 訂單顯示篩選 ===== */
window.orderFilterState = window.orderFilterState || {
  wishList: "all",
  pendingList: "all"
};

function getCurrentPikminUserName() {
  return (localStorage.getItem("flowerWishNickname") || "").trim();
}

function normalizeOrderText(text) {
  return String(text || "").replace(/\s+/g, "");
}

function getFieldValueFromCard(card, labels) {
  const text = normalizeOrderText(card.innerText || card.textContent || "");

  for (const label of labels) {
    const key = normalizeOrderText(label);
    const start = text.indexOf(key);
    if (start === -1) continue;

    const after = text.slice(start + key.length);
    const nextStop = after.search(/(花朵|花種|顏色|許願者|接單花農|花農|是否完成|時間|座標|完成分享|取消|刪除|我可以幫忙|確認接單|已接單)/);
    return nextStop === -1 ? after : after.slice(0, nextStop);
  }

  return "";
}


function parseTimeRangeToMinutes(timeRange) {
  const text = String(timeRange || "");
  const match = text.match(/(\d{1,2})\s*[:：]\s*(\d{2})\s*[-~～至到－—–]\s*(\d{1,2})\s*[:：]\s*(\d{2})/);
  if (!match) return null;

  const startHour = Number(match[1]);
  const startMinute = Number(match[2]);
  const endHour = Number(match[3]);
  const endMinute = Number(match[4]);

  if (startHour > 23 || endHour > 23 || startMinute > 59 || endMinute > 59) return null;

  return {
    start: startHour * 60 + startMinute,
    end: endHour * 60 + endMinute
  };
}

function isTimeRangeCurrentlyAvailable(timeRange) {
  const range = parseTimeRangeToMinutes(timeRange);
  if (!range) return false;

  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();

  // 一般區間：14:00 - 20:00
  if (range.start <= range.end) {
    return current >= range.start && current <= range.end;
  }

  // 跨日區間：22:00 - 02:00
  return current >= range.start || current <= range.end;
}

function orderCardIsCurrentlyAvailable(card) {
  if (!card) return false;
  if (card.dataset.currentlyAvailable === "true") return true;
  if (card.dataset.currentlyAvailable === "false") return false;
  const timeRange = card.dataset.timeRange || getFieldValueFromCard(card, ["可收花時間：", "可收花時間", "可採花時間：", "可採花時間"]);
  return isTimeRangeCurrentlyAvailable(timeRange);
}

function orderCardBelongsToMe(card, listId, currentName) {
  if (!card) return false;

  const currentUid = getCurrentUserUid();

  if (listId === "wishList") {
    const ownerUid = String(card.dataset.ownerUid || "").trim();
    if (ownerUid) return !!currentUid && ownerUid === currentUid;

    // 舊卡沒有 UID 時才用刪除按鈕/暱稱相容。
    if (card.querySelector(".outer-delete-btn")) return true;
    if (!currentName) return false;
    const cleanName = normalizeOrderText(currentName);
    const wishOwner = getFieldValueFromCard(card, ["許願者：", "許願者", "暱稱：", "暱稱"]);
    return normalizeOrderText(wishOwner).includes(cleanName);
  }

  if (listId === "pendingList") {
    const farmerUid = String(card.dataset.farmerUid || "").trim();
    if (farmerUid) return !!currentUid && farmerUid === currentUid;

    // 舊卡沒有 UID 時才用暱稱相容。
    if (!currentName) return false;
    const cleanName = normalizeOrderText(currentName);
    const farmer = getFieldValueFromCard(card, ["接單花農：", "接單花農", "花農：", "花農"]);
    return normalizeOrderText(farmer).includes(cleanName);
  }

  return false;
}

function applyOrderFilter(listId) {
  const list = document.getElementById(listId);
  if (!list) return;

  const mode = window.orderFilterState[listId] || "all";
  const cards = Array.from(list.children).filter(function (el) {
    return !el.classList.contains("order-filter-empty");
  });

  list.querySelectorAll(".order-filter-empty").forEach(function (el) {
    el.remove();
  });

  if (mode === "all") {
    cards.forEach(function (card) {
      card.style.display = "";
    });
    if (typeof refreshCollapseHeights === "function") refreshCollapseHeights();
    return;
  }

  let shown = 0;

  if (mode === "available" && listId === "wishList") {
    cards.forEach(function (card) {
      const ok = orderCardIsCurrentlyAvailable(card);
      card.style.display = ok ? "" : "none";
      if (ok) shown++;
    });

    if (shown === 0) {
      const empty = document.createElement("div");
      empty.className = "order-filter-empty";
      empty.textContent = "目前沒有可接訂單。";
      list.appendChild(empty);
    }

    if (typeof refreshCollapseHeights === "function") refreshCollapseHeights();
    return;
  }

  const currentName = getCurrentPikminUserName();

  if (!currentName) {
    cards.forEach(function (card) {
      card.style.display = "none";
    });
    const empty = document.createElement("div");
    empty.className = "order-filter-empty";
    empty.textContent = "尚未設定暱稱，無法篩選自己的訂單。";
    list.appendChild(empty);
    if (typeof refreshCollapseHeights === "function") refreshCollapseHeights();
    return;
  }

  cards.forEach(function (card) {
    const ok = orderCardBelongsToMe(card, listId, currentName);
    card.style.display = ok ? "" : "none";
    if (ok) shown++;
  });

  if (shown === 0) {
    const empty = document.createElement("div");
    empty.className = "order-filter-empty";
    empty.textContent = listId === "wishList" ? "目前沒有自己發的訂單。" : "目前沒有自己接的訂單。";
    list.appendChild(empty);
  }

  if (typeof refreshCollapseHeights === "function") refreshCollapseHeights();
}

function syncOrderFilterButtons(listId) {
  document.querySelectorAll('.order-filter-btn[data-filter-target="' + listId + '"]').forEach(function (btn) {
    btn.classList.toggle("active", btn.getAttribute("data-filter-mode") === (window.orderFilterState[listId] || "all"));
  });
}

function initOrderFilters() {
  // 事件委派：按鈕即使重繪也能按
  if (document.body.dataset.orderFilterClickReady !== "1") {
    document.body.dataset.orderFilterClickReady = "1";

    document.body.addEventListener("click", function (event) {
      const btn = event.target.closest(".order-filter-btn");
      if (!btn) return;

      event.preventDefault();
      event.stopPropagation();

      const listId = btn.getAttribute("data-filter-target");
      const mode = btn.getAttribute("data-filter-mode") || "all";
      if (!listId) return;

      window.orderFilterState[listId] = mode;
      syncOrderFilterButtons(listId);
      applyOrderFilter(listId);
    }, true);
  }

  ["wishList", "pendingList"].forEach(function (id) {
    syncOrderFilterButtons(id);
    applyOrderFilter(id);

    const list = document.getElementById(id);
    if (!list || list.dataset.orderFilterObserved === "1") return;

    list.dataset.orderFilterObserved = "1";
    new MutationObserver(function (mutations) {
      // 避免自己新增空狀態時重複觸發到卡住
      const hasRealCardChange = mutations.some(function (m) {
        return Array.from(m.addedNodes).concat(Array.from(m.removedNodes)).some(function (node) {
          return node.nodeType === 1 && !node.classList.contains("order-filter-empty");
        });
      });

      if (hasRealCardChange) {
        applyOrderFilter(id);
      }
    }).observe(list, { childList: true });
  });
}

document.addEventListener("DOMContentLoaded", initOrderFilters);
window.addEventListener("load", initOrderFilters);
setTimeout(initOrderFilters, 500);


window.enterWebsite = enterWebsite;

document.addEventListener("DOMContentLoaded", function () {
  const enterBtn = null; // disabled duplicate enter handler; index.html uses robust handler
  if (enterBtn) {
    enterBtn.addEventListener("click", function (e) {
      e.preventDefault();
      enterWebsite();
    });
  }
});


/* ===== FIX: 進站後「修改暱稱」可重新開啟 ===== */
function splitSavedNicknameForGate(savedNickname) {
  const text = String(savedNickname || "").trim();
  const match = text.match(/_(LINE|DC)$/i);
  return {
    name: match ? text.replace(/_(LINE|DC)$/i, "") : text,
    platform: match ? match[1].toUpperCase() : getCurrentPlatform()
  };
}

function showNicknameGateForEdit() {
  const gate = document.getElementById("nicknameGate");
  if (!gate) return;

  const savedNickname = localStorage.getItem("flowerWishNickname") || "";
  const parsed = splitSavedNicknameForGate(savedNickname);

  const input = document.getElementById("gateNicknameInput");
  const select = document.getElementById("socialTypeSelect");

  if (input) input.value = parsed.name;
  if (select) select.value = parsed.platform;

  gate.classList.remove("hidden-gate");
  gate.style.setProperty("display", "flex", "important");
  gate.style.setProperty("visibility", "visible", "important");
  gate.style.setProperty("pointer-events", "auto", "important");
  document.body.style.overflow = "hidden";

  setTimeout(function () {
    if (input) input.focus();
  }, 80);
}

window.openNicknameModal = showNicknameGateForEdit;
window.openRuleModal = showNicknameGateForEdit;

function updateCurrentNicknameBar() {
  const nicknameText = document.getElementById("currentNicknameText");
  if (!nicknameText) return;
  const currentName = getCurrentNickname() || nickname || "";
  nicknameText.innerHTML = displayNameWithTagHtml(currentName || "未設定", getCurrentPlatform());
}

window.updateCurrentNicknameBar = updateCurrentNicknameBar;



/* ===== FORCE JS FIX: move nickname badge below title ===== */
(function () {
  function moveNicknameBarBelowTitle() {
    const bar = document.getElementById("currentNicknameBar") ||
      document.querySelector(".current-nickname-bar, .nickname-status, .nickname-pill");
    const title = document.querySelector(".hero-title, .main-title, .site-title, .hero h1, h1");
    if (!bar || !title) return;

    bar.style.position = "relative";
    bar.style.left = "auto";
    bar.style.right = "auto";
    bar.style.top = "auto";
    bar.style.bottom = "auto";
    bar.style.transform = "none";
    bar.style.margin = "16px auto 0";
    bar.style.zIndex = "1";

    if (title.nextElementSibling !== bar) {
      title.insertAdjacentElement("afterend", bar);
    }
  }

  document.addEventListener("DOMContentLoaded", moveNicknameBarBelowTitle);
  window.addEventListener("load", moveNicknameBarBelowTitle);
  setTimeout(moveNicknameBarBelowTitle, 300);
})();



/* ===== DEPLOY FIX: 花種同一格輸入＋下拉，修正上傳後選單被擋/沒顯示 ===== */
(function () {
  function normalizeFlowerText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function getFlowerSourceList() {
    try {
      if (Array.isArray(flowerDex) && flowerDex.length) return flowerDex;
    } catch (e) {}
    try {
      if (Array.isArray(DEFAULT_FLOWER_DEX) && DEFAULT_FLOWER_DEX.length) return DEFAULT_FLOWER_DEX;
    } catch (e) {}
    return [];
  }

  function applyDropdownPosition(input, dropdown) {
    if (!input || !dropdown) return;
    const wrap = input.closest(".flower-combo-wrap") || input.parentElement;
    if (wrap && dropdown.parentElement !== wrap) {
      wrap.appendChild(dropdown);
    }
    if (wrap) {
      wrap.style.position = "relative";
      wrap.style.overflow = "visible";
    }
    dropdown.style.position = "absolute";
    dropdown.style.left = "0";
    dropdown.style.right = "auto";
    dropdown.style.top = (input.offsetHeight + 6) + "px";
    dropdown.style.width = input.offsetWidth + "px";
    dropdown.style.maxHeight = "260px";
    dropdown.style.zIndex = "999999";
    dropdown.style.transform = "none";
  }

  function installFlowerDeployDropdownFix() {
    const input = document.getElementById("flowerComboInput") || document.getElementById("flowerKeywordInput");
    const dropdown = document.getElementById("flowerComboDropdown");
    const colorSelect = document.getElementById("flowerColorSelect");
    const hiddenInput = document.getElementById("flowerInput");
    if (!input || !dropdown || !colorSelect || !hiddenInput) return;

    if (input.dataset.deployDropdownFixed === "1") return;
    input.dataset.deployDropdownFixed = "1";

    const defaultColors = ["黃", "紅", "藍"];

    function findFlower(name) {
      const key = normalizeFlowerText(name);
      return getFlowerSourceList().find(function (flower) {
        return normalizeFlowerText(flower.name) === key;
      });
    }

    function updateHiddenValue() {
      const name = input.value.trim();
      const color = colorSelect.value;
      if (isLockedFlowerName(name)) {
        hiddenInput.value = "";
        return;
      }
      hiddenInput.value = buildWishFlowerName(color, name);
    }

    function renderColors() {
      const current = colorSelect.value;
      const found = findFlower(input.value);
      if (found && found.locked) {
        colorSelect.innerHTML = "";
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "5/31 開放後才能選";
        colorSelect.appendChild(option);
        hiddenInput.value = "";
        return;
      }
      const baseFlowerColors = found && Array.isArray(found.colors) ? found.colors : [];
      const colors = getWishColorOptions(baseFlowerColors.length ? baseFlowerColors : defaultColors);

      colorSelect.innerHTML = "";

      if (baseFlowerColors.length <= 1 && colors.length <= 1) {
        colorSelect.style.display = "none";
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "單色花";
        colorSelect.appendChild(option);
      } else {
        colorSelect.style.display = "";
        colors.forEach(function (color) {
          const option = document.createElement("option");
          option.value = color;
          option.textContent = getWishColorLabel(color);
          colorSelect.appendChild(option);
        });

        removeWhiteWishColorOptions();
        if (colors.includes(current) && !isWhiteWishColor(current)) colorSelect.value = current;
      }

      updateHiddenValue();
    }

    function closeDropdown() {
      dropdown.classList.remove("open");
      dropdown.style.display = "none";
    }

    function openDropdown() {
      const keyword = normalizeFlowerText(input.value);
      const flowers = getFlowerSourceList().filter(function (flower) {
        const name = normalizeFlowerText(flower.name);
        const subtitle = normalizeFlowerText(flower.subtitle || "");
        return !keyword || name.includes(keyword) || subtitle.includes(keyword);
      });

      dropdown.innerHTML = "";

      if (!flowers.length) {
        const empty = document.createElement("div");
        empty.className = "flower-combo-empty";
        empty.textContent = "沒有符合的花種";
        dropdown.appendChild(empty);
      } else {
        flowers.forEach(function (flower) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "flower-combo-option" + (flower.locked ? " is-disabled" : "");
          btn.textContent = flower.subtitle ? flower.name + "（" + flower.subtitle + "）" : flower.name;
          if (flower.locked) {
            btn.disabled = true;
            btn.setAttribute("aria-disabled", "true");
            btn.title = "5/31 才會開放，目前不能選擇";
          }
          btn.addEventListener("mousedown", function (event) {
            event.preventDefault();
            event.stopPropagation();
            if (flower.locked) {
              warnLockedFlower();
              return;
            }
            input.value = flower.name;
            renderColors();
            closeDropdown();
          });
          dropdown.appendChild(btn);
        });
      }

      applyDropdownPosition(input, dropdown);
      dropdown.style.display = "block";
      dropdown.classList.add("open");
    }

    input.addEventListener("focus", openDropdown);
    input.addEventListener("click", openDropdown);
    input.addEventListener("input", function () {
      renderColors();
      openDropdown();
    });
    input.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeDropdown();
    });
    colorSelect.addEventListener("change", updateHiddenValue);

    window.addEventListener("resize", function () {
      if (dropdown.classList.contains("open")) applyDropdownPosition(input, dropdown);
    });

    document.addEventListener("mousedown", function (event) {
      if (event.target === input || dropdown.contains(event.target)) return;
      closeDropdown();
    });

    renderColors();
  }

  document.addEventListener("DOMContentLoaded", installFlowerDeployDropdownFix);
  window.addEventListener("load", installFlowerDeployDropdownFix);
  setTimeout(installFlowerDeployDropdownFix, 300);
})();


  document.addEventListener("click", function (event) {
    const deleteGroupButton = event.target.closest("[data-delete-group]");
    if (deleteGroupButton) {
      const keys = String(deleteGroupButton.getAttribute("data-delete-group") || "").split("||").filter(Boolean);
      const myWishes = wishes.filter(function(wish){
        return keys.includes(String(getWishKey(wish))) &&
          isCurrentWishOwner(wish) &&
          wish.status !== "pending" &&
          wish.status !== "done";
      });

      if (!myWishes.length) {
        alert("找不到你的許願單。");
        return;
      }

      myWishes.forEach(function(wish){
        deleteWish(getWishKey(wish));
      });
    }
  });


(function installNoWhiteWishColorGuard() {
  function setup() {
    const colorSelect = document.getElementById("flowerColorSelect");
    if (!colorSelect || colorSelect.dataset.noWhiteGuard === "1") return;
    colorSelect.dataset.noWhiteGuard = "1";
    removeWhiteWishColorOptions();
    colorSelect.addEventListener("focus", removeWhiteWishColorOptions);
    colorSelect.addEventListener("click", removeWhiteWishColorOptions);
    colorSelect.addEventListener("change", function () {
      removeWhiteWishColorOptions();
      if (isWhiteWishColor(colorSelect.value) && colorSelect.options.length) colorSelect.selectedIndex = 0;
    });
    new MutationObserver(removeWhiteWishColorOptions).observe(colorSelect, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setup);
  } else {
    setup();
  }
})();

/* OCR 圖片辨識匯入圖鑑（前台） */
(function () {
  const OCR_COLORS = ["白", "黃", "紅", "藍"];
  let ocrRows = [];

  function $(id) {
    return document.getElementById(id);
  }

  function normalizeOcrColor(color) {
    return String(color || "")
      .trim()
      .replace(/色$/u, "")
      .replace(/蓝/g, "藍")
      .replace(/黄/g, "黃")
      .replace(/红/g, "紅");
  }

  function getOcrFlowerNames() {
    const fromDex = Array.isArray(flowerDex) ? flowerDex.map(function (item) { return item.name; }) : [];
    const extra = [
      "風鈴草", "勿忘草", "週年玫瑰", "週年紀念玫瑰", "周年玫瑰", "周年紀念玫瑰", "銀蓮花", "九重葛", "海芋", "山茶花", "油菜花", "康乃馨",
      "嘉德麗雅蘭", "雞冠花", "櫻花", "菊花", "鐵線蓮", "彼岸花", "鈴蘭", "大波斯菊", "兔耳花", "大理花",
      "石竹", "小蒼蘭", "龍膽", "聖誕玫瑰", "扶桑花", "風信子", "繡球花", "鳶尾花", "百合", "萬壽菊",
      "牽牛花", "蝴蝶蘭", "水仙花", "粉蝶花", "睡蓮", "三色堇", "牡丹", "矮牽牛", "梅花", "雞蛋花",
      "聖誕紅", "櫻草花", "玫瑰", "鼠尾草", "金魚草", "雪花蓮", "天堂鳥", "向日葵", "豌豆花", "鬱金香", "鸚鵡鬱金香"
    ];
    return Array.from(new Set(fromDex.concat(extra).filter(Boolean))).sort(function (a, b) { return b.length - a.length; });
  }

  function cleanOcrText(text) {
    return String(text || "")
      .replace(/[|｜]/g, " ")
      .replace(/[Oo]/g, "0")
      .replace(/色週年紀念玫瑰/g, "色週年玫瑰")
      .replace(/周年/g, "週年")
      .replace(/蓝/g, "藍")
      .replace(/黄/g, "黃")
      .replace(/红/g, "紅");
  }

  function normalizeOcrFlowerName(name) {
    return String(name || "").trim().replace("週年紀念玫瑰", "週年玫瑰");
  }

  function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function parseOcrItems(text) {
    const cleaned = cleanOcrText(text);
    const itemMatches = [];
    const colorPattern = "(白|黃|紅|藍)色";
    const flowerPattern = getOcrFlowerNames().map(escapeRegExp).join("|");
    if (!flowerPattern) return [];
    const itemRegex = new RegExp(colorPattern + "\\s*(" + flowerPattern + ")", "gu");
    let match;
    while ((match = itemRegex.exec(cleaned))) {
      itemMatches.push({ index: match.index, color: normalizeOcrColor(match[1]), flower: normalizeOcrFlowerName(match[2]) });
    }

    const numbers = [];
    const numberRegex = /\b\d{1,4}\b/g;
    while ((match = numberRegex.exec(cleaned))) {
      const value = Number(match[0]);
      if (Number.isFinite(value) && value >= 0 && value <= 1200) numbers.push({ index: match.index, value: value });
    }

    return itemMatches.map(function (item) {
      const before = numbers.filter(function (num) { return num.index < item.index; }).slice(-1)[0];
      const after = numbers.find(function (num) { return num.index > item.index; });
      return {
        flower: item.flower,
        color: item.color,
        topNumber: before ? before.value : 0,
        bottomNumber: after ? after.value : 0
      };
    }).filter(function (row, index, arr) {
      const key = row.color + "_" + row.flower + "_" + row.topNumber + "_" + row.bottomNumber;
      return arr.findIndex(function (item) {
        return item.color + "_" + item.flower + "_" + item.topNumber + "_" + item.bottomNumber === key;
      }) === index;
    });
  }

  function rowsWithLayout(rows) {
    const layout = $("ocrLayoutSelect")?.value || "petalTopEssenceBottom";
    return rows.map(function (row) {
      return {
        flower: row.flower,
        color: row.color,
        petal: layout === "petalTopEssenceBottom" ? row.topNumber : row.bottomNumber,
        essence: layout === "petalTopEssenceBottom" ? row.bottomNumber : row.topNumber
      };
    });
  }

  function renderOcrRows(rows) {
    ocrRows = rowsWithLayout(rows);
    const list = $("ocrResultList");
    if (!list) return;
    if (!ocrRows.length) {
      list.innerHTML = '<div class="empty">目前沒有解析到資料。可以手動修正上方文字後按「重新解析文字」。</div>';
      return;
    }

    list.innerHTML = `
      <table class="ocr-result-table">
        <thead><tr><th>套用</th><th>顏色</th><th>花種</th><th>花瓣</th><th>精華</th></tr></thead>
        <tbody>
          ${ocrRows.map(function (row, index) { return `
            <tr>
              <td><input data-ocr-field="enabled" data-index="${index}" type="checkbox" checked /></td>
              <td>
                <select data-ocr-field="color" data-index="${index}">
                  ${OCR_COLORS.map(function (color) { return `<option value="${color}" ${color === row.color ? "selected" : ""}>${color}</option>`; }).join("")}
                </select>
              </td>
              <td><input data-ocr-field="flower" data-index="${index}" type="text" value="${escapeHtml(row.flower)}" /></td>
              <td><input data-ocr-field="petal" data-index="${index}" type="number" min="0" max="1200" value="${escapeHtml(row.petal)}" /></td>
              <td><input data-ocr-field="essence" data-index="${index}" type="number" min="0" max="1200" value="${escapeHtml(row.essence)}" /></td>
            </tr>`; }).join("")}
        </tbody>
      </table>
    `;
  }

  function collectOcrRowsFromTable() {
    const tableRows = Array.from(document.querySelectorAll("#ocrResultList tbody tr"));
    return tableRows.map(function (tr, index) {
      const get = function (field) { return tr.querySelector('[data-ocr-field="' + field + '"][data-index="' + index + '"]'); };
      return {
        enabled: !!get("enabled")?.checked,
        color: normalizeOcrColor(get("color")?.value),
        flower: normalizeOcrFlowerName(get("flower")?.value),
        petal: Math.max(0, Math.min(1200, Number(get("petal")?.value || 0))),
        essence: Math.max(0, Math.min(1200, Number(get("essence")?.value || 0)))
      };
    }).filter(function (row) { return row.enabled && row.flower && row.color; });
  }

  async function runOcrImport() {
    const input = $("ocrImageInput");
    const file = input?.files?.[0];
    if (!file) {
      alert("請先選擇截圖。");
      return;
    }
    if (!window.Tesseract) {
      alert("OCR 套件尚未載入，請重新整理後再試。");
      return;
    }

    const progress = $("ocrProgress");
    const rawText = $("ocrRawText");
    const actions = $("ocrActions");
    const runBtn = $("runOcrImportBtn");
    if (progress) {
      progress.hidden = false;
      progress.textContent = "辨識中... 這可能需要 10～30 秒。";
    }
    if (rawText) rawText.hidden = true;
    if (actions) actions.hidden = true;
    if (runBtn) runBtn.disabled = true;

    try {
      const result = await window.Tesseract.recognize(file, "chi_tra+eng", {
        logger: function (message) {
          if (!progress || !message?.status) return;
          const percent = typeof message.progress === "number" ? " " + Math.round(message.progress * 100) + "%" : "";
          progress.textContent = message.status + percent;
        }
      });
      const text = result?.data?.text || "";
      if (rawText) {
        rawText.value = cleanOcrText(text);
        rawText.hidden = false;
      }
      if (actions) actions.hidden = false;
      if (progress) progress.textContent = "辨識完成，請先檢查下方表格再套用。";
      renderOcrRows(parseOcrItems(rawText?.value || text));
    } catch (error) {
      console.error(error);
      if (progress) progress.textContent = "辨識失敗，請換一張更清楚的截圖再試。";
    } finally {
      if (runBtn) runBtn.disabled = false;
    }
  }

  function previewOcrImage() {
    const input = $("ocrImageInput");
    const file = input?.files?.[0];
    const wrap = $("ocrPreviewWrap");
    const image = $("ocrImagePreview");
    if (!file || !wrap || !image) return;
    image.src = URL.createObjectURL(file);
    wrap.hidden = false;
  }

  function parseOcrTextAgain() {
    const rawText = $("ocrRawText");
    renderOcrRows(parseOcrItems(rawText?.value || ""));
  }

  function applyOcrRowsToDex() {
    const rows = collectOcrRowsFromTable();
    if (!rows.length) {
      alert("沒有可套用的資料。");
      return;
    }
    rows.forEach(function (row) {
      const petalKey = "dex_" + row.flower + "_" + row.color + "_petal";
      const essenceKey = "dex_" + row.flower + "_" + row.color + "_essence";
      safeSetLocalStorage(petalKey, String(row.petal));
      safeSetLocalStorage(essenceKey, String(row.essence));
      saveDexBackupValue(petalKey, row.petal);
      saveDexBackupValue(essenceKey, row.essence);
    });
    renderDex();
    alert("已套用 " + rows.length + " 筆到圖鑑。");
  }

  function setupFrontOcrImport() {
    $("ocrImageInput")?.addEventListener("change", previewOcrImage);
    $("runOcrImportBtn")?.addEventListener("click", runOcrImport);
    $("parseOcrTextBtn")?.addEventListener("click", parseOcrTextAgain);
    $("applyOcrResultBtn")?.addEventListener("click", applyOcrRowsToDex);
    $("ocrLayoutSelect")?.addEventListener("change", parseOcrTextAgain);
  }

  document.addEventListener("DOMContentLoaded", setupFrontOcrImport);
})();

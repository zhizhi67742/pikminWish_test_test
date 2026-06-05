import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  deleteDoc,
  setDoc,
  updateDoc,
  writeBatch,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

// ⭐ 重要：請把下面改成你的 Google 登入信箱。
// 例如：const ADMIN_EMAILS = ["yourname@gmail.com"];
const ADMIN_EMAILS = [
  "y0966621741@gmail.com"
];

const firebaseConfig = {
  apiKey: "AIzaSyAVMgid570CLZDQTPzhx2jQjatg62inRcY",
  authDomain: "pikminwish.firebaseapp.com",
  databaseURL: "https://pikminwish-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "pikminwish",
  storageBucket: "pikminwish.firebasestorage.app",
  messagingSenderId: "823415386805",
  appId: "1:823415386805:web:a8cd25fcb88100619144fc",
  measurementId: "G-62WR9TP8QT"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
getRedirectResult(auth).catch((error) => {
  console.error("Google redirect 登入結果讀取失敗", error);
});

let currentUser = null;
let wishDocs = [];
let historyDocs = [];
let customFlowerDocs = [];
let eventBannerSettings = null;
let unsubscribeEventBanner = null;
let unsubscribeWishes = null;
let unsubscribeHistory = null;
let unsubscribeFlowers = null;

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

const DEFAULT_FLOWER_DEX = [
  { name: "風鈴草", colors: ["白", "紅", "藍"] },
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
function makeFlowerDocId(name) {
  return encodeURIComponent(String(name || "").trim()).replaceAll("/", "%2F");
}

function normalizeFlowerColor(color) {
  return String(color || "").trim().replace(/色$/u, "");
}

function getSelectedQuickFlowerColors() {
  return Array.from(document.querySelectorAll('input[name="quickFlowerColor"]:checked'))
    .map((input) => normalizeFlowerColor(input.value))
    .filter(Boolean)
    .filter((color, index, arr) => arr.indexOf(color) === index);
}


function formatDate(value) {
  if (!value) return "-";
  if (typeof value?.toDate === "function") return value.toDate().toLocaleString("zh-TW");
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-TW");
}

function getSortTime(item) {
  const data = item.data || item;
  const candidates = [
    data.createdTimestamp,
    data.createdAtSort,
    data.createdAt,
    data.acceptedAt,
    data.doneAt,
    data.deletedAt,
    data.time,
    item.id
  ];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value?.toDate === "function") return value.toDate().getTime();
    if (typeof value === "string" && value.trim()) {
      const parsed = new Date(value.replaceAll("-", "/")).getTime();
      if (!Number.isNaN(parsed)) return parsed;
      const asNumber = Number(value);
      if (Number.isFinite(asNumber)) return asNumber;
    }
  }
  return 0;
}

function isAdmin(user) {
  const email = normalize(user?.email);
  return ADMIN_EMAILS.map(normalize).includes(email);
}

async function login() {
  try {
    await signInWithRedirect(auth, provider);
  } catch (error) {
    console.error(error);
    alert("Google 登入失敗，請稍後再試。若你正在 LINE / Discord 內建瀏覽器，請改用 Safari 或 Chrome 開啟。");
  }
}

async function logout() {
  await signOut(auth);
}

function getAccountLabel(user) {
  if (!user) return "未登入";
  const name = user.displayName || "Google 使用者";
  const email = user.email || "";
  return email ? `${name}（${email}）` : name;
}

function setAuthUi(user) {
  currentUser = user;
  const allowed = !!user && isAdmin(user);
  const headerAccount = $("adminHeaderAccount");

  $("adminLoginBtn").hidden = !!user;
  $("adminLogoutBtn").hidden = !user;
  $("loginPanel").hidden = !!user;
  $("noAccessPanel").hidden = !user || allowed;
  $("adminPanel").hidden = !allowed;

  if (headerAccount) {
    headerAccount.hidden = !user;
    headerAccount.textContent = user ? `已登入：${getAccountLabel(user)}` : "未登入";
  }

  if (user) {
    $("adminUserEmail").textContent = getAccountLabel(user);
    $("noAccessText").textContent = `${user.email || "這個帳號"} 不在管理員清單內。`;
  } else {
    $("adminUserEmail").textContent = "-";
  }

  if (allowed) startAdminListeners();
  else stopAdminListeners();
}

function startAdminListeners() {
  if (!unsubscribeWishes) {
    unsubscribeWishes = onSnapshot(collection(db, "wishes"), (snapshot) => {
      wishDocs = snapshot.docs.map((docSnap) => ({ id: docSnap.id, data: docSnap.data() }));
      renderWishes();
    }, (error) => {
      console.error(error);
      alert("讀取許願資料失敗，請檢查 Firebase Rules。");
    });
  }

  if (!unsubscribeHistory) {
    unsubscribeHistory = onSnapshot(collection(db, "wishHistory"), (snapshot) => {
      historyDocs = snapshot.docs.map((docSnap) => ({ id: docSnap.id, data: docSnap.data() }));
      renderHistory();
    }, (error) => {
      console.error(error);
      alert("讀取歷史紀錄失敗，請檢查 Firebase Rules。");
    });
  }

  if (!unsubscribeFlowers) {
    unsubscribeFlowers = onSnapshot(collection(db, "flowerCatalog"), (snapshot) => {
      customFlowerDocs = snapshot.docs
        .filter((docSnap) => docSnap.id !== "__eventBanner" && docSnap.data()?.hiddenFromCatalog !== true && docSnap.data()?.type !== "eventBanner")
        .map((docSnap) => ({ id: docSnap.id, data: docSnap.data() }));
      renderCustomFlowers();
    }, (error) => {
      console.error(error);
      alert("讀取自訂花種失敗，請檢查 Firebase Rules。");
    });
  }
}

function stopAdminListeners() {
  if (unsubscribeWishes) unsubscribeWishes();
  if (unsubscribeHistory) unsubscribeHistory();
  if (unsubscribeFlowers) unsubscribeFlowers();
  unsubscribeWishes = null;
  unsubscribeHistory = null;
  unsubscribeFlowers = null;
  wishDocs = [];
  historyDocs = [];
  customFlowerDocs = [];
  renderWishes();
  renderHistory();
  renderCustomFlowers();
}

function wishMatchesSearch(item, keyword) {
  if (!keyword) return true;
  const data = item.data || {};
  const text = [
    data.flower,
    data.color,
    data.nickname,
    data.requester,
    data.farmer,
    data.acceptedBy,
    data.status,
    data.harvestInfo,
    data.coords
  ].join(" ").toLowerCase();
  return text.includes(keyword);
}

function historyMatchesSearch(item, keyword) {
  if (!keyword) return true;
  const data = item.data || {};
  const text = [
    data.flower,
    data.nickname,
    data.requester,
    data.farmer,
    data.status,
    data.type,
    data.action,
    data.time
  ].join(" ").toLowerCase();
  return text.includes(keyword);
}

function statusLabel(status) {
  const value = String(status || "wish");
  if (value === "wish") return "許願中";
  if (value === "pending") return "待完成";
  if (value === "done") return "已完成";
  return value;
}

function getFlowerSortValue(data, fallbackIndex) {
  const value = data && data.sortOrder;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallbackIndex;
}

function getMergedFlowerItems() {
  const cloudByName = new Map();
  (Array.isArray(customFlowerDocs) ? customFlowerDocs : []).forEach((entry) => {
    const data = entry.data || {};
    const key = normalize(data.name || decodeURIComponent(entry.id || ""));
    if (!key) return;
    cloudByName.set(key, entry);
  });

  const items = [];
  DEFAULT_FLOWER_DEX.forEach((flower, index) => {
    const key = normalize(flower.name);
    const cloud = cloudByName.get(key);
    const merged = Object.assign({}, flower, cloud?.data || {}, {
      name: (cloud?.data?.name || flower.name),
      colors: Array.isArray(cloud?.data?.colors) && cloud.data.colors.length ? cloud.data.colors : flower.colors,
      source: cloud?.data?.source || "builtin",
      isBuiltIn: true,
      fallbackIndex: index
    });
    items.push({ id: cloud?.id || makeFlowerDocId(flower.name), data: merged });
    cloudByName.delete(key);
  });

  Array.from(cloudByName.values()).forEach((entry, index) => {
    const data = entry.data || {};
    items.push({
      id: entry.id,
      data: Object.assign({}, data, {
        name: data.name || decodeURIComponent(entry.id || ""),
        source: data.source || "admin",
        isBuiltIn: false,
        fallbackIndex: DEFAULT_FLOWER_DEX.length + index
      })
    });
  });

  return items.sort((a, b) => {
    const orderDiff = getFlowerSortValue(a.data, a.data.fallbackIndex) - getFlowerSortValue(b.data, b.data.fallbackIndex);
    if (orderDiff) return orderDiff;
    return String(a.data?.name || "").localeCompare(String(b.data?.name || ""), "zh-Hant");
  });
}

function renderCustomFlowers() {
  const list = $("customFlowerList");
  const count = $("customFlowerCount");
  const notice = $("flowerSortNotice");
  const items = getMergedFlowerItems();
  if (count) count.textContent = String(items.length);
  if (notice) notice.textContent = items.length ? `目前共 ${items.length} 個花種。按「上移／下移」後會直接儲存。` : "";
  if (!list) return;

  if (!items.length) {
    list.innerHTML = '<div class="empty">目前沒有花種資料。</div>';
    return;
  }

  list.innerHTML = items.map(({ id, data }, index) => {
    const colors = Array.isArray(data.colors) ? data.colors.join("、") : "-";
    const locked = data.locked ? "已鎖定" : "可許願";
    const sourceLabel = data.isBuiltIn ? "內建花種" : "自訂花種";
    const subtitle = data.subtitle ? `<div class="item-subtitle">${escapeHtml(data.subtitle)}</div>` : "";
    const deleteButton = data.isBuiltIn
      ? ""
      : `<button class="danger-btn mini-btn" data-action="delete-flower" data-id="${escapeHtml(id)}" type="button">刪除花種</button>`;
    return `
      <article class="admin-item flower-admin-item flower-sort-item">
        <div class="sort-rank">${index + 1}</div>
        <div class="flower-sort-main">
          <div class="item-top">
            <div>
              <div class="item-title">${escapeHtml(data.name || id)}</div>
              ${subtitle}
            </div>
            <span class="badge">${escapeHtml(sourceLabel)} · ${escapeHtml(locked)}</span>
          </div>
          <div class="meta-grid">
            <div><b>顏色：</b>${escapeHtml(colors)}</div>
            <div><b>ID：</b>${escapeHtml(id)}</div>
          </div>
          <div class="item-actions">
            <button class="mini-btn" data-action="move-flower" data-id="${escapeHtml(id)}" data-direction="up" type="button" ${index === 0 ? "disabled" : ""}>⬆️ 上移</button>
            <button class="mini-btn" data-action="move-flower" data-id="${escapeHtml(id)}" data-direction="down" type="button" ${index === items.length - 1 ? "disabled" : ""}>⬇️ 下移</button>
            <button class="mini-btn" data-action="edit-flower" data-id="${escapeHtml(id)}" type="button">帶入表單</button>
            ${deleteButton}
          </div>
        </div>
      </article>
    `;
  }).join("");
}

async function persistFlowerOrder(items) {
  if (!currentUser || !isAdmin(currentUser)) return;
  const batch = writeBatch(db);
  items.forEach((item, index) => {
    const data = item.data || {};
    const name = data.name || decodeURIComponent(item.id || "");
    if (!name) return;
    const id = makeFlowerDocId(name);
    batch.set(doc(db, "flowerCatalog", id), {
      name,
      colors: Array.isArray(data.colors) && data.colors.length ? data.colors : ["白"],
      subtitle: data.subtitle || "",
      locked: !!data.locked,
      source: data.source || (data.isBuiltIn ? "builtin" : "admin"),
      sortOrder: index,
      updatedAt: Date.now(),
      updatedBy: currentUser.email || ""
    }, { merge: true });
  });
  await batch.commit();
}

async function moveFlower(id, direction) {
  const items = getMergedFlowerItems();
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return;
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= items.length) return;
  const next = items.slice();
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  await persistFlowerOrder(next);
}

async function saveQuickFlower(event) {
  event.preventDefault();
  if (!currentUser || !isAdmin(currentUser)) return;

  const name = $("quickFlowerName")?.value.trim();
  const subtitle = $("quickFlowerSubtitle")?.value.trim();
  const colors = getSelectedQuickFlowerColors();
  const locked = !!$("quickFlowerLocked")?.checked;

  if (!name) {
    alert("請輸入花種名稱。");
    return;
  }

  if (!colors.length) {
    alert("請至少選一個圖鑑顏色。");
    return;
  }

  const id = makeFlowerDocId(name);
  const now = Date.now();
  await setDoc(doc(db, "flowerCatalog", id), {
    name,
    subtitle,
    colors,
    locked,
    source: "admin",
    createdAt: now,
    customAddedAt: now,
    sortOrder: getMergedFlowerItems().length,
    updatedAt: now,
    updatedBy: currentUser.email || ""
  }, { merge: true });

  $("quickFlowerForm").reset();
  const white = document.querySelector('input[name="quickFlowerColor"][value="白"]');
  if (white) white.checked = true;
  alert(`已新增 / 更新「${name}」。`);
}

function fillQuickFlowerForm(id) {
  const item = getMergedFlowerItems().find((entry) => entry.id === id);
  if (!item) return;
  const data = item.data || {};
  $("quickFlowerName").value = data.name || "";
  $("quickFlowerSubtitle").value = data.subtitle || "";
  $("quickFlowerLocked").checked = !!data.locked;
  const colors = Array.isArray(data.colors) ? data.colors.map(normalizeFlowerColor) : [];
  document.querySelectorAll('input[name="quickFlowerColor"]').forEach((input) => {
    input.checked = colors.includes(normalizeFlowerColor(input.value));
  });
  $("quickFlowerName").focus();
}

async function deleteCustomFlower(id) {
  const item = getMergedFlowerItems().find((entry) => entry.id === id);
  const name = item?.data?.name || id;
  if (!confirm(`確定要刪除自訂花種「${name}」嗎？正式網站也會移除這個自訂選項。`)) return;
  await deleteDoc(doc(db, "flowerCatalog", id));
}

function getDefaultEventBannerSettings() {
  return {
    enabled: true,
    badge: "🌼 5月新花",
    title: "勿忘草登場",
    text: "本月活動花種，記得更新你的圖鑑庫存！"
  };
}

function renderEventBannerForm() {
  const form = $("eventBannerForm");
  if (!form) return;
  const data = Object.assign(getDefaultEventBannerSettings(), eventBannerSettings || {});
  const enabled = $("eventBannerEnabled");
  const badge = $("eventBannerBadgeInput");
  const title = $("eventBannerTitleInput");
  const text = $("eventBannerTextInput");
  const notice = $("eventBannerNotice");
  if (enabled) enabled.checked = data.enabled !== false;
  if (badge) badge.value = data.badge || "";
  if (title) title.value = data.title || "";
  if (text) text.value = data.text || "";
  if (notice) notice.textContent = eventBannerSettings ? "目前已讀取線上活動公告。" : "目前使用預設公告，儲存後會同步到正式網站。";
}

function listenEventBannerSettings() {
  if (unsubscribeEventBanner) unsubscribeEventBanner();
  unsubscribeEventBanner = onSnapshot(doc(db, "flowerCatalog", "__eventBanner"), (docSnap) => {
    eventBannerSettings = docSnap.exists() ? docSnap.data() : null;
    renderEventBannerForm();
  }, (error) => {
    console.error("讀取活動公告失敗", error);
    renderEventBannerForm();
  });
}

async function saveEventBanner(event) {
  event.preventDefault();
  if (!currentUser || !isAdmin(currentUser)) {
    alert("請先用管理員帳號登入後再儲存活動公告。");
    return;
  }
  const enabled = !!$("eventBannerEnabled")?.checked;
  const badge = $("eventBannerBadgeInput")?.value.trim() || "🌼 新花公告";
  const title = $("eventBannerTitleInput")?.value.trim() || "活動花種登場";
  const text = $("eventBannerTextInput")?.value.trim() || "本月活動花種，記得更新你的圖鑑庫存！";
  const notice = $("eventBannerNotice");
  try {
    await setDoc(doc(db, "flowerCatalog", "__eventBanner"), {
      type: "eventBanner",
      hiddenFromCatalog: true,
      enabled,
      badge,
      title,
      text,
      updatedAt: Date.now(),
      updatedBy: currentUser.email || ""
    }, { merge: true });
    if (notice) notice.textContent = "已儲存，正式網站會自動更新。";
    alert("活動公告已儲存。");
  } catch (error) {
    console.error("活動公告儲存失敗", error);
    if (notice) notice.textContent = "儲存失敗：" + (error?.message || error);
    alert("活動公告儲存失敗，請按 F12 看 Console 錯誤。\n" + (error?.message || error));
  }
}

function renderWishes() {
  const list = $("wishList");
  const keyword = normalize($("wishSearch")?.value);
  const items = wishDocs
    .filter((item) => wishMatchesSearch(item, keyword))
    .sort((a, b) => getSortTime(b) - getSortTime(a));

  $("wishCount").textContent = String(wishDocs.length);

  if (!list) return;
  if (!items.length) {
    list.innerHTML = '<div class="empty">目前沒有符合的許願資料。</div>';
    return;
  }

  list.innerHTML = items.map(({ id, data }) => {
    const flower = [data.color, data.flower].filter(Boolean).join("色") || data.flower || "未命名許願";
    const requester = data.nickname || data.requester || "-";
    const farmer = data.farmer || data.acceptedBy || "-";
    const created = formatDate(data.createdAt || data.createdTimestamp || data.createdAtSort);
    const accepted = formatDate(data.acceptedAt);
    const doneAt = formatDate(data.doneAt);
    return `
      <article class="admin-item">
        <div class="item-top">
          <div class="item-title">${escapeHtml(flower)}</div>
          <span class="badge">${escapeHtml(statusLabel(data.status))}</span>
        </div>
        <div class="meta-grid">
          <div><b>許願者：</b>${escapeHtml(requester)}</div>
          <div><b>花農：</b>${escapeHtml(farmer)}</div>
          <div><b>建立：</b>${escapeHtml(created)}</div>
          <div><b>接單：</b>${escapeHtml(accepted)}</div>
          <div><b>完成：</b>${escapeHtml(doneAt)}</div>
          <div><b>ID：</b>${escapeHtml(id)}</div>
          <div><b>採收資訊：</b>${escapeHtml(data.harvestInfo || "-")}</div>
          <div><b>座標：</b>${escapeHtml(data.coords || data.coordinates || "-")}</div>
        </div>
        <div class="item-actions">
          <button class="mini-btn" data-action="status" data-id="${escapeHtml(id)}" data-status="wish" type="button">改許願中</button>
          <button class="mini-btn" data-action="status" data-id="${escapeHtml(id)}" data-status="pending" type="button">改待完成</button>
          <button class="mini-btn" data-action="status" data-id="${escapeHtml(id)}" data-status="done" type="button">改已完成</button>
          <button class="danger-btn mini-btn" data-action="delete-wish" data-id="${escapeHtml(id)}" type="button">刪除</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderHistory() {
  const list = $("historyList");
  const keyword = normalize($("historySearch")?.value);
  const items = historyDocs
    .filter((item) => historyMatchesSearch(item, keyword))
    .sort((a, b) => getSortTime(b) - getSortTime(a));

  $("historyCount").textContent = String(historyDocs.length);

  if (!list) return;
  if (!items.length) {
    list.innerHTML = '<div class="empty">目前沒有符合的歷史紀錄。</div>';
    return;
  }

  list.innerHTML = items.map(({ id, data }) => {
    const flower = [data.color, data.flower].filter(Boolean).join("色") || data.flower || "未命名紀錄";
    const requester = data.requester || data.nickname || "-";
    const farmer = data.farmer || data.acceptedBy || "-";
    const status = data.status || data.type || data.action || "-";
    const time = formatDate(data.time || data.createdAt || data.doneAt || data.deletedAt);
    return `
      <article class="admin-item">
        <div class="item-top">
          <div class="item-title">${escapeHtml(flower)}</div>
          <span class="badge">${escapeHtml(status)}</span>
        </div>
        <div class="meta-grid">
          <div><b>許願者：</b>${escapeHtml(requester)}</div>
          <div><b>花農：</b>${escapeHtml(farmer)}</div>
          <div><b>時間：</b>${escapeHtml(time)}</div>
          <div><b>ID：</b>${escapeHtml(id)}</div>
        </div>
        <div class="item-actions">
          <button class="danger-btn mini-btn" data-action="delete-history" data-id="${escapeHtml(id)}" type="button">刪除紀錄</button>
        </div>
      </article>
    `;
  }).join("");
}

async function updateWishStatus(id, status) {
  if (!confirm(`確定要把這筆資料改成「${statusLabel(status)}」嗎？`)) return;
  await updateDoc(doc(db, "wishes", id), { status });
}

async function deleteWish(id) {
  if (!confirm("確定要刪除這筆許願資料嗎？這個動作不能復原。")) return;
  await deleteDoc(doc(db, "wishes", id));
}

async function deleteHistory(id) {
  if (!confirm("確定要刪除這筆歷史紀錄嗎？")) return;
  await deleteDoc(doc(db, "wishHistory", id));
}

function setupEvents() {
  $("adminLoginBtn").addEventListener("click", login);
  $("loginPanelBtn").addEventListener("click", login);
  $("adminLogoutBtn").addEventListener("click", logout);
  $("wishSearch").addEventListener("input", renderWishes);
  $("historySearch").addEventListener("input", renderHistory);
  $("quickFlowerForm").addEventListener("submit", saveQuickFlower);
  const eventBannerForm = $("eventBannerForm");
  if (eventBannerForm) eventBannerForm.addEventListener("submit", saveEventBanner);

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((item) => item.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      document.querySelectorAll("[data-tab-panel]").forEach((panel) => {
        panel.hidden = panel.dataset.tabPanel !== tab;
      });
    });
  });

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button || !currentUser || !isAdmin(currentUser)) return;

    const action = button.dataset.action;
    const id = button.dataset.id;
    try {
      if (action === "status") await updateWishStatus(id, button.dataset.status);
      if (action === "delete-wish") await deleteWish(id);
      if (action === "delete-history") await deleteHistory(id);
      if (action === "edit-flower") fillQuickFlowerForm(id);
      if (action === "delete-flower") await deleteCustomFlower(id);
      if (action === "move-flower") await moveFlower(id, button.dataset.direction);
    } catch (error) {
      console.error(error);
      alert("操作失敗，請檢查 Firebase Rules 或網路狀態。");
    }
  });
}

setupEvents();
listenEventBannerSettings();
onAuthStateChanged(auth, setAuthUi);

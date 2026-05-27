// ==============================
    // 1. Firebase 設定：等等把你的 firebaseConfig 貼到這裡
    // ==============================
    import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
    import {
      getAuth,
      GoogleAuthProvider,
      signInWithPopup,
      signOut,
      onAuthStateChanged
    } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
    import {
      getFirestore,
      collection,
      addDoc,
      updateDoc,
      deleteDoc,
      doc,
      onSnapshot,
      query,
      orderBy,
      serverTimestamp,
      Timestamp
    } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

    
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
    const auth = getAuth(app);
    const db = getFirestore(app);
    const provider = new GoogleAuthProvider();

    // ==============================
    // 2. 基本資料
    // ==============================
    const SITE_URL = "https://zhizhi67742.github.io/pikmin-wish/";
    const FLOWERS = [
      { name: "櫻花", colors: ["粉"], lockedUntil: null },
      { name: "向日葵", colors: ["黃"], lockedUntil: null },
      { name: "粉蝶花", colors: ["藍"], lockedUntil: null },
      { name: "玫瑰", colors: ["紅", "黃", "藍"], lockedUntil: null },
      { name: "鬱金香", colors: ["紅", "黃", "藍"], lockedUntil: null },
      { name: "風鈴草", colors: ["藍"], lockedUntil: "2026-05-31" }
    ];

    let currentUser = null;
    let wishes = [];
    let currentFilter = "all";
    let pendingSubmit = null;

    const $ = (id) => document.getElementById(id);
    const fmtTime = (value) => {
      if (!value) return "";
      const date = value.toDate ? value.toDate() : new Date(value);
      return date.toLocaleString("zh-TW", { hour12: false });
    };
    const escapeHtml = (str = "") => String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

    // ==============================
    // 3. 登入 / 登出
    // ==============================
    async function login() {
      await signInWithPopup(auth, provider);
    }
    async function logout() {
      await signOut(auth);
    }

    $("loginBtn").onclick = login;
    $("loginBtn2").onclick = login;
    $("logoutBtn").onclick = logout;

    onAuthStateChanged(auth, (user) => {
      currentUser = user;
      const loggedIn = !!user;
      $("loginScreen").classList.toggle("hidden", loggedIn);
      $("app").classList.toggle("hidden", !loggedIn);
      $("quickNav").classList.toggle("hidden", !loggedIn);
      $("topBtn").classList.toggle("hidden", !loggedIn);
      $("loginBtn").classList.toggle("hidden", loggedIn);
      $("logoutBtn").classList.toggle("hidden", !loggedIn);
      $("userName").textContent = user ? user.displayName || "已登入" : "尚未登入";
      $("userPhoto").classList.toggle("hidden", !user?.photoURL);
      if (user?.photoURL) $("userPhoto").src = user.photoURL;
      renderAll();
    });

    // ==============================
    // 4. 花種 / 顏色
    // ==============================
    function initFlowerList() {
      const list = $("flowerList");
      list.innerHTML = FLOWERS.map(f => `<option value="${escapeHtml(f.name)}"></option>`).join("");
      updateColorOptions();
    }

    function isFlowerLocked(flower) {
      if (!flower?.lockedUntil) return false;
      const today = new Date();
      const unlock = new Date(`${flower.lockedUntil}T00:00:00+08:00`);
      return today < unlock;
    }

    function updateColorOptions() {
      const flowerName = $("flowerInput").value.trim();
      const flower = FLOWERS.find(f => f.name === flowerName);
      const select = $("flowerColor");
      const baseColors = flower ? flower.colors : ["黃", "紅", "藍"];
      const colors = baseColors.length >= 2 ? [...baseColors, "混色", "隨意色"] : baseColors;
      select.innerHTML = colors.map(c => `<option value="${c}">${c}</option>`).join("");
      select.disabled = colors.length <= 1;
    }
    $("flowerInput").addEventListener("input", updateColorOptions);
    initFlowerList();

    // ==============================
    // 5. Firebase 即時資料
    // ==============================
    const wishesQuery = query(collection(db, "wishes"), orderBy("createdAt", "desc"));
    onSnapshot(wishesQuery, (snapshot) => {
      wishes = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      autoCleanOldDone();
      renderAll();
    });

    async function autoCleanOldDone() {
      const now = Date.now();
      for (const item of wishes) {
        if (!["done", "cancelled"].includes(item.status)) continue;
        const doneDate = item.completedAt?.toDate?.() || item.cancelledAt?.toDate?.();
        if (!doneDate) continue;
        const days = (now - doneDate.getTime()) / 86400000;
        if (days >= 3) await deleteDoc(doc(db, "wishes", item.id));
      }
    }

    // ==============================
    // 6. 新增許願
    // ==============================
    function collectWishForm() {
      const options = [...document.querySelectorAll(".quickOpt:checked")].map(el => el.value);
      const note = $("wishNote").value.trim();
      const flowerName = $("flowerInput").value.trim();
      const flower = FLOWERS.find(f => f.name === flowerName);
      if (isFlowerLocked(flower)) {
        alert(`${flowerName} 目前尚未開放選擇`);
        return null;
      }
      return {
        requesterName: $("wishName").value.trim(),
        requesterUid: currentUser.uid,
        requesterPhoto: currentUser.photoURL || "",
        contactType: $("contactType").value,
        contactId: $("contactId").value.trim(),
        flowerName,
        flowerColor: $("flowerColor").value,
        harvestTime: $("harvestTime").value.trim(),
        note: [...options, note].filter(Boolean).join("、"),
        status: "open",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
    }

    async function submitWish(data) {
      await addDoc(collection(db, "wishes"), data);
      $("wishForm").reset();
      updateColorOptions();
      alert("已成功許願 🌸");
    }

    $("wishForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!currentUser) return alert("請先登入");
      const data = collectWishForm();
      if (!data) return;
      const duplicate = wishes.find(w => w.status === "open" && w.flowerName === data.flowerName && w.flowerColor === data.flowerColor);
      if (duplicate) {
        pendingSubmit = data;
        $("duplicateText").textContent = `目前已有 ${data.flowerColor} ${data.flowerName} 的許願單，確定還要新增嗎？`;
        $("duplicateDialog").showModal();
        return;
      }
      await submitWish(data);
    });

    $("confirmDuplicate").onclick = async () => {
      if (pendingSubmit) await submitWish(pendingSubmit);
      pendingSubmit = null;
      $("duplicateDialog").close();
    };
    $("cancelDuplicate").onclick = () => {
      pendingSubmit = null;
      $("duplicateDialog").close();
    };

    // ==============================
    // 7. 訂單操作
    // ==============================
    async function takeWish(id) {
      const helperName = prompt("請輸入花農名稱");
      if (!helperName) return;
      await updateDoc(doc(db, "wishes", id), {
        status: "progress",
        helperUid: currentUser.uid,
        helperName,
        acceptedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }

    async function cancelTake(id) {
      const reason = prompt("請輸入取消原因");
      if (reason === null) return;
      await updateDoc(doc(db, "wishes", id), {
        status: "open",
        helperUid: "",
        helperName: "",
        cancelReason: reason,
        updatedAt: serverTimestamp()
      });
    }

    async function completeWish(id) {
      const coords = prompt("請輸入座標");
      if (!coords) return;
      await updateDoc(doc(db, "wishes", id), {
        status: "done",
        coords,
        completedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }

    async function directUpload() {
      const flowerName = prompt("花種");
      if (!flowerName) return;
      const helperName = prompt("花農名稱");
      if (!helperName) return;
      const note = prompt("採收資訊", "白花/櫻花收") || "";
      const coords = prompt("座標");
      if (!coords) return;
      await addDoc(collection(db, "wishes"), {
        requesterName: "花農直接上傳",
        requesterUid: currentUser.uid,
        helperUid: currentUser.uid,
        helperName,
        flowerName,
        flowerColor: "",
        harvestTime: "",
        note,
        coords,
        status: "done",
        createdAt: serverTimestamp(),
        completedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }

    async function deleteWish(id) {
      await deleteDoc(doc(db, "wishes", id));
    }

    function copyInfo(item, includeCoords = false) {
      const lines = [
        `${item.flowerName || "花種"} / ${item.note || "採收資訊"}`,
        "-",
        SITE_URL
      ];
      if (includeCoords && item.coords) lines.unshift(item.coords);
      navigator.clipboard.writeText(lines.join("\n"));
      alert("已複製");
    }

    // ==============================
    // 8. 渲染
    // ==============================
    function renderAll() {
      if (!currentUser) return;
      renderWishes();
      renderDex();
      renderHistory();
    }

    function canManage(item) {
      return item.requesterUid === currentUser?.uid || item.helperUid === currentUser?.uid;
    }

    function filteredOpenItems() {
      let items = wishes.filter(w => w.status === "open");
      if (currentFilter === "mine") items = items.filter(canManage);
      if (currentFilter === "available") items = items.filter(w => !!w.harvestTime);
      return items;
    }

    function renderWishes() {
      $("wishCards").innerHTML = filteredOpenItems().map(renderOpenCard).join("") || `<p class="muted">目前沒有可接訂單。</p>`;
      $("progressCards").innerHTML = wishes.filter(w => w.status === "progress").map(renderProgressCard).join("") || `<p class="muted">目前沒有待完成訂單。</p>`;
      $("doneCards").innerHTML = wishes.filter(w => w.status === "done").map(renderDoneCard).join("") || `<p class="muted">目前沒有完成分享。</p>`;
    }

    function renderOpenCard(item) {
      return `<article class="card">
        <div class="card-title">✨ ${escapeHtml(item.flowerColor || "")} ${escapeHtml(item.flowerName)} <span class="badge">可接單</span></div>
        <div>⏰ 可採收時間：${escapeHtml(item.harvestTime || "未填寫")}</div>
        <div class="card-actions">
          <button onclick="window.showDetail('${item.id}')">詳細資訊</button>
          <button class="btn-secondary" onclick="window.takeWish('${item.id}')">我可以幫忙</button>
          ${item.requesterUid === currentUser.uid ? `<button class="btn-danger" onclick="window.deleteWish('${item.id}')">刪除</button>` : ""}
        </div>
      </article>`;
    }

    function renderProgressCard(item) {
      return `<article class="card">
        <div class="card-title">🌱 ${escapeHtml(item.flowerColor || "")} ${escapeHtml(item.flowerName)} <span class="badge">待完成</span></div>
        <div>👤 許願者：${escapeHtml(item.requesterName || "")}</div>
        <div>🌱 花農：${escapeHtml(item.helperName || "")}</div>
        <div>🌼 採收資訊：${escapeHtml(item.note || "無")}</div>
        <div class="card-actions">
          <button class="btn-light" onclick="window.copyInfoById('${item.id}')">複製資訊</button>
          ${item.helperUid === currentUser.uid ? `<button class="btn-secondary" onclick="window.completeWish('${item.id}')">上傳座標</button><button class="btn-light" onclick="window.cancelTake('${item.id}')">取消接單</button>` : ""}
        </div>
      </article>`;
    }

    function renderDoneCard(item) {
      return `<article class="card">
        <div class="card-title">✅ ${escapeHtml(item.flowerColor || "")} ${escapeHtml(item.flowerName)}</div>
        <div>👤 許願者：${escapeHtml(item.requesterName || "")}</div>
        <div>🌱 花農：${escapeHtml(item.helperName || "")}</div>
        <div>🌼 採收資訊：${escapeHtml(item.note || "無")}</div>
        <details class="details"><summary>顯示詳細座標</summary><div>📍 ${escapeHtml(item.coords || "")}</div></details>
        <div class="card-actions">
          <button class="btn-light" onclick="window.copyCoords('${item.id}')">快速複製座標</button>
          <button class="btn-light" onclick="window.copyInfoById('${item.id}')">複製資訊</button>
        </div>
      </article>`;
    }

    function renderDex(filter = "all") {
      const flowerNamesInWish = new Set(wishes.filter(w => w.status === "open").map(w => w.flowerName));
      const list = FLOWERS.filter(f => {
        const missing = flowerNamesInWish.has(f.name);
        if (filter === "missing") return missing;
        if (filter === "full") return !missing;
        return true;
      });
      $("dexList").innerHTML = list.map(f => {
        const locked = isFlowerLocked(f);
        return `<article class="card">
          <div class="card-title">🌼 ${escapeHtml(f.name)} ${locked ? `<span class="badge">5/31 前未開放</span>` : ""}</div>
          <div class="muted">顏色：${f.colors.join("、")}</div>
          <button class="btn-small" ${locked ? "disabled" : ""} onclick="window.jumpWish('${f.name}')">缺</button>
        </article>`;
      }).join("");
    }

    function renderHistory() {
      const list = wishes.filter(w => ["done", "cancelled"].includes(w.status));
      $("historyList").innerHTML = list.map(item => `<article class="card">
        <div class="card-title">${item.status === "done" ? "✅" : "❌"} ${escapeHtml(item.flowerName || "紀錄")}</div>
        <div>時間：${fmtTime(item.completedAt || item.cancelledAt || item.updatedAt)}</div>
        <div>許願者：${escapeHtml(item.requesterName || "")}</div>
        <div>花農：${escapeHtml(item.helperName || "")}</div>
      </article>`).join("") || `<p class="muted">目前沒有歷史紀錄。</p>`;
    }

    // ==============================
    // 9. UI 操作
    // ==============================
    document.querySelectorAll(".tab-btn").forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        document.querySelectorAll(".page").forEach(p => p.classList.add("hidden"));
        $(btn.dataset.tab).classList.remove("hidden");
      };
    });

    document.querySelectorAll(".collapse-btn").forEach(btn => {
      btn.onclick = () => {
        const body = btn.closest(".panel").querySelector(".panel-body");
        body.classList.toggle("collapsed");
        btn.textContent = body.classList.contains("collapsed") ? "展開" : "收合";
      };
    });

    $("showAllBtn").onclick = () => { currentFilter = "all"; renderWishes(); };
    $("showMineBtn").onclick = () => { currentFilter = "mine"; renderWishes(); };
    $("availableBtn").onclick = () => { currentFilter = "available"; renderWishes(); };
    $("topBtn").onclick = () => scrollTo({ top: 0, behavior: "smooth" });

    document.querySelectorAll(".dex-filter").forEach(btn => {
      btn.onclick = () => renderDex(btn.dataset.filter);
    });

    // ==============================
    // 10. window handlers
    // ==============================
    window.takeWish = takeWish;
    window.cancelTake = cancelTake;
    window.completeWish = completeWish;
    window.deleteWish = deleteWish;
    window.directUpload = directUpload;
    window.copyInfoById = (id) => {
      const item = wishes.find(w => w.id === id);
      if (item) copyInfo(item);
    };
    window.copyCoords = (id) => {
      const item = wishes.find(w => w.id === id);
      if (!item?.coords) return;
      navigator.clipboard.writeText(item.coords);
      alert("已複製座標");
    };
    window.jumpWish = (flowerName) => {
      document.querySelector('[data-tab="wishPage"]').click();
      $("flowerInput").value = flowerName;
      updateColorOptions();
      $("newWishPanel").scrollIntoView({ behavior: "smooth" });
    };
    window.showDetail = (id) => {
      const item = wishes.find(w => w.id === id);
      if (!item) return;
      $("detailTitle").textContent = `✨ ${item.flowerColor || ""} ${item.flowerName}`;
      $("detailContent").innerHTML = `
        <div class="details">
          <div>👤 許願者：${escapeHtml(item.requesterName || "")}</div>
          <div>📮 聯絡：${escapeHtml(item.contactType || "")} ${escapeHtml(item.contactId || "")}</div>
          <div>⏰ 可採收時間：${escapeHtml(item.harvestTime || "")}</div>
          <div>🌼 採收資訊：${escapeHtml(item.note || "無")}</div>
        </div>`;
      $("detailActions").innerHTML = `<button class="btn-secondary" onclick="window.takeWish('${item.id}'); detailDialog.close();">我可以幫忙</button>`;
      $("detailDialog").showModal();
    };

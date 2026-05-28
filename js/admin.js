import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";

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
const provider = new GoogleAuthProvider();

const ADMIN_EMAILS = [
  "y0966621741@gmail.com"
];

const loginGate = document.getElementById("adminLoginGate");
const adminContent = document.getElementById("adminContent");
const accountInfo = document.getElementById("adminAccountInfo");
const userText = document.getElementById("adminUserText");
const loginBtn = document.getElementById("adminGoogleLoginBtn");
const backBtn = document.getElementById("adminBackHomeBtn");

function getUserName(user) {
  return user?.displayName || user?.email || "管理員";
}

function showLogin(user = null, message = "") {
  document.body.classList.add("admin-locked");
  document.body.classList.remove("admin-ready");

  if (loginGate) loginGate.style.display = "flex";
  if (adminContent) adminContent.style.display = "none";

  if (accountInfo) {
    if (user) {
      accountInfo.innerHTML = `
        <strong>${getUserName(user)}</strong>
        <span>${user.email || ""}</span>
        ${message ? `<em>${message}</em>` : ""}
      `;
    } else {
      accountInfo.textContent = "目前狀態：未登入";
    }
  }
}

function showAdmin(user) {
  document.body.classList.remove("admin-locked");
  document.body.classList.add("admin-ready");

  if (loginGate) loginGate.style.display = "none";
  if (adminContent) adminContent.style.display = "block";

  if (userText) {
    userText.textContent = `已登入：${getUserName(user)}（${user.email || ""}）`;
  }
}

loginBtn?.addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error(error);
    alert("Google 登入失敗，請再試一次。");
  }
});

backBtn?.addEventListener("click", () => {
  location.href = "index.html";
});

onAuthStateChanged(auth, (user) => {
  if (!user) {
    showLogin();
    return;
  }

  if (!ADMIN_EMAILS.includes(user.email)) {
    showLogin(user, "這個帳號沒有管理權限");
    return;
  }

  showAdmin(user);
});

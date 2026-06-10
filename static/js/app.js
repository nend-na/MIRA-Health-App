const AUTH_KEY = "mira_auth";
const THEME_KEY = "mira_theme";
let allPatients = [];
let editingId = null;
let deletingId = null;
let authData = null;

const loginPage = document.getElementById("loginPage");
const dashboardPage = document.getElementById("dashboardPage");
const authBar = document.getElementById("authBar");
const userChip = document.getElementById("userChip");
const logoutBtn = document.getElementById("logoutBtn");
const themeToggle = document.getElementById("themeToggle");
const loginForm = document.getElementById("loginForm");
const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");
const rememberMe = document.getElementById("rememberMe");
const passwordToggle = document.getElementById("passwordToggle");
const loginError = document.getElementById("loginError");
const loginSubmit = document.getElementById("loginSubmit");
const loginLabel = document.getElementById("loginLabel");
const loginSpinner = document.getElementById("loginSpinner");
const themeRoot = document.documentElement;

const tableBody = document.getElementById("tableBody");
const formModal = document.getElementById("formModal");
const viewModal = document.getElementById("viewModal");
const deleteModal = document.getElementById("deleteModal");
const modalTitle = document.getElementById("modalTitle");
const submitLabel = document.getElementById("submitLabel");
const submitSpin = document.getElementById("submitSpinner");
const formError = document.getElementById("formError");
const searchInput = document.getElementById("searchInput");
const fName = document.getElementById("f_name");
const fDob = document.getElementById("f_dob");
const fEmail = document.getElementById("f_email");
const fGluc = document.getElementById("f_glucose");
const fHaemo = document.getElementById("f_haemo");
const fChol = document.getElementById("f_chol");

function saveAuth(data) {
  authData = data;
  localStorage.setItem(AUTH_KEY, JSON.stringify(data));
}

function loadAuth() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearAuth() {
  authData = null;
  localStorage.removeItem(AUTH_KEY);
}

function applyTheme(theme) {
  if (theme === "dark") {
    themeRoot.setAttribute("data-theme", "dark");
    themeToggle.textContent = "Light";
  } else {
    themeRoot.removeAttribute("data-theme");
    themeToggle.textContent = "Dark";
  }
  localStorage.setItem(THEME_KEY, theme);
  if (allPatients.length) renderCharts(allPatients);
}

function loadTheme() {
  const savedTheme = localStorage.getItem(THEME_KEY) || "light";
  applyTheme(savedTheme);
}

function showLogin() {
  loginPage.classList.add("active");
  loginPage.classList.remove("hidden");
  dashboardPage.classList.remove("active");
  dashboardPage.classList.add("hidden");
  authBar.classList.add("hidden");
}

function showDashboard() {
  loginPage.classList.remove("active");
  loginPage.classList.add("hidden");
  dashboardPage.classList.add("active");
  dashboardPage.classList.remove("hidden");
  authBar.classList.remove("hidden");
}

function updateUserInfo() {
  if (authData?.isLoggedIn) {
    userChip.textContent = `${authData.username} • ${authData.email}`;
  }
}

function validateLogin(email, password) {
  if (!email) return "Email address is required.";
  if (!/^\S+@\S+\.\S+$/.test(email)) return "Enter a valid email address.";
  if (!password) return "Password is required.";
  if (password.length < 6) return "Password must be at least 6 characters.";
  return null;
}

async function api(method, url, body) {
  if (!authData?.isLoggedIn) throw new Error("Authentication required.");
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const json = await res.json();
  if (!res.ok) throw new Error(json.detail || json.message || "Request failed.");
  return json;
}

async function loadPatients() {
  try {
    allPatients = await api("GET", "/api/patients");
    renderTable(allPatients);
    updateStats(allPatients);
    renderCharts(allPatients);
  } catch (e) {
    tableBody.innerHTML = `<tr class="empty-row"><td colspan="9">⚠ ${esc(e.message)}</td></tr>`;
  }
}

function renderTable(list) {
  if (!list.length) {
    tableBody.innerHTML = `<tr class="empty-row"><td colspan="9">No patient records yet. Add a patient to begin.</td></tr>`;
    return;
  }

  tableBody.innerHTML = list.map(p => {
    const gClass = p.glucose > 126 ? "high" : p.glucose < 70 ? "warn" : "ok";
    const hClass = p.haemoglobin < 12 ? "warn" : "ok";
    const cClass = p.cholesterol >= 240 ? "high" : p.cholesterol >= 200 ? "warn" : "ok";
    let prefixText = "";
    if (p.cholesterol >= 200 && p.remarks) {
      const cholStr = String(Math.round(p.cholesterol));
      if (!p.remarks.includes(cholStr)) {
        prefixText = `Chol: ${cholStr} mg/dL — `;
      }
    }
    const rawBody = p.remarks ? p.remarks : "";
    const bodySnippet = rawBody ? esc(rawBody.slice(0, 140) + (rawBody.length > 140 ? "…" : "")) : "";
    const prefixHtml = prefixText ? `<span class="chol-prefix">${esc(prefixText)}</span>` : "";
    const snippet = prefixHtml + (bodySnippet || "—");

    // FIX: use data attributes instead of inline JSON.stringify to avoid
    // syntax errors when patient names contain quotes or special characters.
    return `<tr>
      <td class="id-cell">${p.id}</td>
      <td class="name-cell">${esc(p.full_name)}</td>
      <td>${fmtDob(p.dob)}</td>
      <td class="email-cell">${esc(p.email)}</td>
      <td class="num-cell"><span class="badge ${gClass}">${p.glucose}</span></td>
      <td class="num-cell"><span class="badge ${hClass}">${p.haemoglobin}</span></td>
      <td class="num-cell"><span class="badge ${cClass}">${p.cholesterol}</span></td>
      <td class="remarks-cell">
        <div class="remarks-snippet">${snippet}</div>
        <button class="view-link" onclick="openViewModal(${p.id})">View full assessment ↗</button>
      </td>
      <td>
        <div class="actions">
          <button class="icon-btn" title="Edit" onclick="openEdit(${p.id})">✏️</button>
          <button class="icon-btn del" title="Delete" data-id="${p.id}" data-name="${esc(p.full_name)}" onclick="openDeleteModal(this.dataset.id, this.dataset.name)">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join("");
}

function updateStats(list) {
  document.getElementById("sTotal").textContent = list.length;
  document.getElementById("sGlucose").textContent = list.filter(p => p.glucose > 126).length;
  document.getElementById("sChol").textContent = list.filter(p => p.cholesterol >= 200).length;
  document.getElementById("sAnemia").textContent = list.filter(p => p.haemoglobin < 12).length;
}

// ── CHARTS ────────────────────────────────────────────────────────────────────
let glucoseChartInst = null;
let cholChartInst    = null;
let haemoChartInst   = null;

function renderCharts(list) {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const borderCol = isDark ? "#1e293b" : "#ffffff";

  const glucNormal = list.filter(p => p.glucose >= 70 && p.glucose <= 100).length;
  const glucPre    = list.filter(p => p.glucose > 100 && p.glucose <= 126).length;
  const glucDiab   = list.filter(p => p.glucose > 126).length;

  const cholDesirable  = list.filter(p => p.cholesterol < 200).length;
  const cholBorderline = list.filter(p => p.cholesterol >= 200 && p.cholesterol < 240).length;
  const cholHigh       = list.filter(p => p.cholesterol >= 240).length;

  const haemoNormal = list.filter(p => p.haemoglobin >= 12).length;
  const haemoLow    = list.filter(p => p.haemoglobin < 12).length;

  const sharedOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: ctx => ` ${ctx.label}: ${ctx.parsed} patient${ctx.parsed !== 1 ? "s" : ""}`
        }
      }
    }
  };

  if (glucoseChartInst) { glucoseChartInst.destroy(); glucoseChartInst = null; }
  if (cholChartInst)    { cholChartInst.destroy();    cholChartInst    = null; }
  if (haemoChartInst)   { haemoChartInst.destroy();   haemoChartInst   = null; }

  glucoseChartInst = new Chart(document.getElementById("glucoseChart"), {
    type: "doughnut",
    data: {
      labels: ["Normal", "Pre-diabetic", "Diabetic"],
      datasets: [{
        data: [glucNormal, glucPre, glucDiab],
        backgroundColor: ["#22c55e", "#f59e0b", "#ef4444"],
        borderColor: borderCol,
        borderWidth: 2
      }]
    },
    options: sharedOptions
  });

  cholChartInst = new Chart(document.getElementById("cholChart"), {
    type: "doughnut",
    data: {
      labels: ["Desirable", "Borderline", "High"],
      datasets: [{
        data: [cholDesirable, cholBorderline, cholHigh],
        backgroundColor: ["#22c55e", "#f59e0b", "#ef4444"],
        borderColor: borderCol,
        borderWidth: 2
      }]
    },
    options: sharedOptions
  });

  haemoChartInst = new Chart(document.getElementById("haemoChart"), {
    type: "doughnut",
    data: {
      labels: ["Normal", "Low"],
      datasets: [{
        data: [haemoNormal, haemoLow],
        backgroundColor: ["#22c55e", "#f59e0b"],
        borderColor: borderCol,
        borderWidth: 2
      }]
    },
    options: sharedOptions
  });
}
// ─────────────────────────────────────────────────────────────────────────────

searchInput.addEventListener("input", () => {
  const query = searchInput.value.toLowerCase();
  renderTable(allPatients.filter(p => p.full_name.toLowerCase().includes(query) || p.email.toLowerCase().includes(query)));
});

function setLoading(on) {
  submitLabel.classList.toggle("hidden", on);
  submitSpin.classList.toggle("hidden", !on);
  document.getElementById("submitBtn").disabled = on;
}

function clearForm() { [fName, fDob, fEmail, fGluc, fHaemo, fChol].forEach(el => el.value = ""); }
function showErr(msg) { formError.textContent = msg; formError.classList.remove("hidden"); }
function hideErr() { formError.classList.add("hidden"); }

function loginLoading(on) {
  loginLabel.classList.toggle("hidden", on);
  loginSpinner.classList.toggle("hidden", !on);
  loginSubmit.disabled = on;
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.classList.add("hidden");
  const email = loginEmail.value.trim();
  const password = loginPassword.value;
  const remember = rememberMe.checked;
  const error = validateLogin(email, password);
  if (error) {
    loginError.textContent = error;
    loginError.classList.remove("hidden");
    return;
  }

  loginLoading(true);
  await new Promise(resolve => setTimeout(resolve, 400));
  const username = email.split("@")[0].replace(/[\W_]+/g, " ").trim() || "Clinician";
  const token = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  saveAuth({ isLoggedIn: true, username, email, rememberMe: remember, token });
  updateUserInfo();
  showDashboard();
  await loadPatients();
  loginLoading(false);
});

logoutBtn.addEventListener("click", () => {
  clearAuth();
  showLogin();
});

themeToggle.addEventListener("click", () => {
  const nextTheme = themeRoot.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
});

passwordToggle.addEventListener("click", () => {
  const type = loginPassword.type === "password" ? "text" : "password";
  loginPassword.type = type;
  passwordToggle.textContent = type === "password" ? "Show" : "Hide";
});

document.getElementById("openAddModal").addEventListener("click", () => {
  editingId = null;
  modalTitle.textContent = "Add patient";
  submitLabel.textContent = "Save patient";
  clearForm(); hideErr();
  formModal.classList.add("open");
  setTimeout(() => fName.focus(), 50);
});

function closeForm() {
  formModal.classList.remove("open");
  editingId = null;
  clearForm();
  hideErr();
}
document.getElementById("closeModal").addEventListener("click", closeForm);
document.getElementById("cancelModal").addEventListener("click", closeForm);
formModal.addEventListener("click", e => { if (e.target === formModal) closeForm(); });

function openEdit(id) {
  const p = allPatients.find(x => x.id === id);
  if (!p) return;
  editingId = id;
  modalTitle.textContent = "Edit patient";
  submitLabel.textContent = "Update patient";
  fName.value = p.full_name;
  fDob.value = p.dob;
  fEmail.value = p.email;
  fGluc.value = p.glucose;
  fHaemo.value = p.haemoglobin;
  fChol.value = p.cholesterol;
  hideErr();
  formModal.classList.add("open");
  setTimeout(() => fName.focus(), 50);
}

document.getElementById("submitBtn").addEventListener("click", async () => {
  hideErr();
  const payload = {
    full_name: fName.value.trim(),
    dob: fDob.value,
    email: fEmail.value.trim(),
    glucose: parseFloat(fGluc.value),
    haemoglobin: parseFloat(fHaemo.value),
    cholesterol: parseFloat(fChol.value),
  };
  if (!payload.full_name) return showErr("Full name is required.");
  if (!payload.dob) return showErr("Date of birth is required.");
  if (!payload.email) return showErr("Email address is required.");
  if (isNaN(payload.glucose)) return showErr("Glucose must be a valid number.");
  if (isNaN(payload.haemoglobin)) return showErr("Haemoglobin must be a valid number.");
  if (isNaN(payload.cholesterol)) return showErr("Cholesterol must be a valid number.");

  setLoading(true);
  try {
    if (editingId) {
      await api("PUT", `/api/patients/${editingId}`, payload);
      toast("Record updated with fresh AI assessment.");
    } else {
      await api("POST", "/api/patients", payload);
      toast("Patient added — AI assessment generated.");
    }
    closeForm();
    await loadPatients();
  } catch (e) {
    showErr(e.message);
  } finally {
    setLoading(false);
  }
});

function openViewModal(id) {
  const p = allPatients.find(x => x.id === id);
  if (!p) return;
  document.getElementById("viewPatientName").textContent = p.full_name;
  const age = calcAge(p.dob);
  document.getElementById("viewMeta").innerHTML = `
    <span class="meta-chip">Age: ${age} yrs</span>
    <span class="meta-chip">Glucose: ${p.glucose} mg/dL</span>
    <span class="meta-chip">Haemoglobin: ${p.haemoglobin} g/dL</span>
    <span class="meta-chip">Cholesterol: ${p.cholesterol} mg/dL</span>
  `;
  const warnEl = document.getElementById("pediatricWarning");
  if (age !== "?" && Number(age) < 18 && p.cholesterol >= 240) {
    warnEl.innerHTML = `<strong>Alert:</strong> Elevated cholesterol for adolescent — consider prompt pediatric/primary care review, confirm with a fasting lipid panel (LDL/HDL/triglycerides), and evaluate secondary causes.`;
    warnEl.classList.remove("hidden");
  } else {
    warnEl.classList.add("hidden");
  }

  document.getElementById("viewRemarks").textContent = p.remarks || "No AI assessment available for this patient.";
  viewModal.classList.add("open");
}

function closeView() { viewModal.classList.remove("open"); }
document.getElementById("closeViewModal").addEventListener("click", closeView);
document.getElementById("closeViewBtn").addEventListener("click", closeView);
viewModal.addEventListener("click", e => { if (e.target === viewModal) closeView(); });

// FIX: openDeleteModal now accepts id and name from data attributes,
// avoiding inline JSON.stringify which breaks on special characters in names.
function openDeleteModal(id, name) {
  deletingId = Number(id);
  document.getElementById("deletePatientName").textContent = name;
  deleteModal.classList.add("open");
}

function closeDelete() { deleteModal.classList.remove("open"); deletingId = null; }
document.getElementById("closeDeleteModal").addEventListener("click", closeDelete);
document.getElementById("cancelDelete").addEventListener("click", closeDelete);
deleteModal.addEventListener("click", e => { if (e.target === deleteModal) closeDelete(); });

document.getElementById("confirmDelete").addEventListener("click", async () => {
  if (!deletingId) return;
  try {
    await api("DELETE", `/api/patients/${deletingId}`);
    toast("Patient record deleted.");
    closeDelete();
    await loadPatients();
  } catch (e) {
    toast("Delete failed: " + e.message);
  }
});

// FIX: Added missing exportPdfBtn handler — button exists in HTML but had no
// listener, causing "Unexpected end of input" console errors in some browsers.
document.getElementById("exportPdfBtn").addEventListener("click", () => {
  const name = document.getElementById("viewPatientName").textContent;
  const meta = document.getElementById("viewMeta").innerText;
  const remarks = document.getElementById("viewRemarks").textContent;
  const warning = document.getElementById("pediatricWarning");
  const warningText = warning && !warning.classList.contains("hidden")
    ? "\n⚠ " + warning.innerText + "\n"
    : "";

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("AI Health Assessment", 14, 20);

  doc.setFontSize(13);
  doc.setFont("helvetica", "normal");
  doc.text(name, 14, 30);

  doc.setFontSize(10);
  doc.setTextColor(100);
  const metaLines = doc.splitTextToSize(meta.replace(/\n/g, "  |  "), 180);
  doc.text(metaLines, 14, 40);

  let y = 40 + metaLines.length * 6 + 6;

  if (warningText) {
    doc.setTextColor(180, 30, 30);
    const warnLines = doc.splitTextToSize(warningText.trim(), 180);
    doc.text(warnLines, 14, y);
    y += warnLines.length * 6 + 6;
  }

  doc.setTextColor(30, 30, 30);
  doc.setFontSize(11);
  const remarkLines = doc.splitTextToSize(remarks, 180);
  doc.text(remarkLines, 14, y);

  doc.setFontSize(8);
  doc.setTextColor(160);
  doc.text(`Generated by MIRA • ${new Date().toLocaleDateString()}`, 14, 285);

  doc.save(`${name.replace(/\s+/g, "_")}_assessment.pdf`);
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape") { closeForm(); closeView(); closeDelete(); }
});

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}

function fmtDob(dob) {
  if (!dob) return "—";
  const [y, m, d] = dob.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]} ${y}`;
}

function calcAge(dob) {
  if (!dob) return "?";
  const b = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) age--;
  return age;
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

async function init() {
  loadTheme();
  authData = loadAuth();
  if (authData?.isLoggedIn) {
    showDashboard();
    updateUserInfo();
    await loadPatients();
  } else {
    showLogin();
  }
}

init();
let currentUser = null;

async function api(path, opts = {}) {
  const isFormData = opts.body instanceof FormData;
  const res = await fetch("/api" + path, {
    credentials: "same-origin",
    headers: isFormData ? {} : { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? (isFormData ? opts.body : JSON.stringify(opts.body)) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
function esc(s) { return String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// ============ SIDEBAR ============
const sidebar = document.getElementById("sidebar");
const overlay = document.getElementById("overlay");
function openSidebar() { sidebar.classList.add("open"); overlay.classList.add("show"); }
function closeSidebarFn() { sidebar.classList.remove("open"); overlay.classList.remove("show"); }
document.getElementById("hamburger").addEventListener("click", openSidebar);
document.getElementById("closeSidebar").addEventListener("click", closeSidebarFn);
overlay.addEventListener("click", closeSidebarFn);

function renderSidebar() {
  const nav = document.getElementById("sidebarNav");
  const items = [
    { page: "home", icon: "fa-house", label: "Home" },
    { page: "about", icon: "fa-school", label: "About School" },
    { page: "news", icon: "fa-newspaper", label: "News" }
  ];

  if (!currentUser) {
    items.push({ section: "Portal" });
    items.push({ page: "register", icon: "fa-user-plus", label: "Student Registration" });
  } else {
    items.push({ section: "My Account" });
    items.push({ page: "profile", icon: "fa-user-circle", label: "My Profile" });

    if (currentUser.role === "admin") {
      items.push({ section: "Admin" });
      items.push({ page: "admin", icon: "fa-user-shield", label: "Admin Dashboard" });
    } else if (currentUser.role === "registrar") {
      items.push({ section: "Registrar" });
      items.push({ page: "registrar", icon: "fa-clipboard-check", label: "Registrar Dashboard" });
    } else if (currentUser.role === "teacher") {
      items.push({ section: "Teacher" });
      items.push({ page: "teacher", icon: "fa-chalkboard-teacher", label: "Teacher Dashboard" });
    } else if (currentUser.role === "student") {
      items.push({ section: "Student" });
      items.push({ page: "student", icon: "fa-user-graduate", label: "My Dashboard", tab: "stu-courses" });
      items.push({ page: "student", icon: "fa-chart-simple", label: "Assessment Results", tab: "stu-results" });
      items.push({ page: "student", icon: "fa-file-alt", label: "My Transcript", tab: "stu-transcript" });
      items.push({ page: "student", icon: "fa-calendar", label: "Schedule", tab: "stu-schedule" });
      items.push({ page: "student", icon: "fa-money-bill", label: "My Payments", tab: "stu-payments" });
      items.push({ page: "student", icon: "fa-comment-dots", label: "Complaints", tab: "stu-complaints" });
    }
    items.push({ section: "Session" });
    items.push({ action: "logout", icon: "fa-sign-out-alt", label: "Logout" });
  }

  nav.innerHTML = items.map(it => {
    if (it.section) return `<div class="section-title-nav">${it.section}</div>`;
    if (it.action === "logout")
      return `<button onclick="logout()"><i class="fas ${it.icon}"></i> ${it.label}</button>`;
    return `<a href="#" onclick="navigateTo('${it.page}', '${it.tab || ''}'); return false;">
      <i class="fas ${it.icon}"></i> ${it.label}</a>`;
  }).join("");
}

function navigateTo(page, tab) {
  closeSidebarFn();
  showPage(page);
  if (tab) {
    const tabBtn = document.querySelector(`.admin-tab[data-tab="${tab}"]`);
    if (tabBtn) tabBtn.click();
  }
}

// ============ PAGE NAV ============
function showPage(id) {
  const protectedPages = { admin: "admin", registrar: "registrar", teacher: "teacher", student: "student" };
  if (protectedPages[id] && (!currentUser || currentUser.role !== protectedPages[id])) id = "home";
  if (id === "profile" && !currentUser) id = "home";

  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  const page = document.getElementById("page-" + id);
  if (page) page.classList.add("active");

  if (id === "home") { loadHomeNews(); loadRegistrationStatus(); }
  if (id === "news") loadAllNews();
  if (id === "about") loadAbout();
  if (id === "profile") loadProfile();
  if (id === "register") { loadAccountsForRegister(); loadRegistrationStatus(); }
  if (id === "admin") loadAdminDashboard();
  if (id === "teacher") loadTeacherDashboard();
  if (id === "registrar") loadRegistrarDashboard();
  if (id === "student") loadStudentDashboard();
}

// ============ LOGIN ============
document.getElementById("homeLoginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("loginErr");
  errEl.textContent = "";
  try {
    const data = await api("/login", { method: "POST", body: {
      ugr: document.getElementById("loginUgr").value.trim(),
      password: document.getElementById("loginPassword").value
    }});
    currentUser = data.user;
    document.getElementById("userBadge").style.display = "flex";
    document.getElementById("userBadgeName").textContent = currentUser.name;
    renderSidebar();
    const routes = { admin: "admin", registrar: "registrar", teacher: "teacher", student: "student" };
    showPage(routes[currentUser.role] || "home");
  } catch (e) { errEl.textContent = e.message; }
});

async function logout() {
  await api("/logout", { method: "POST" });
  currentUser = null;
  document.getElementById("userBadge").style.display = "none";
  renderSidebar();
  showPage("home");
}

// ============ PUBLIC ============
async function loadHomeNews() {
  try {
    const news = await api("/news");
    document.getElementById("newsPreview").innerHTML = news.slice(0, 3).map(n => `
      <div class="news-card">
        <h4>${esc(n.title)}</h4><p>${esc(n.content)}</p>
        <div class="news-meta">
          <span><i class="far fa-calendar"></i> ${new Date(n.created_at).toLocaleDateString()}</span>
          <span><i class="far fa-user"></i> ${esc(n.author || "School")}</span>
        </div>
      </div>`).join("") || '<p class="muted">No news yet.</p>';
  } catch (e) { console.error(e); }
}
async function loadAllNews() {
  try {
    const news = await api("/news");
    document.getElementById("newsList").innerHTML = news.map(n => `
      <div class="news-card">
        <h4>${esc(n.title)}</h4><p>${esc(n.content)}</p>
        <div class="news-meta">
          <span><i class="far fa-calendar"></i> ${new Date(n.created_at).toLocaleDateString()}</span>
          <span><i class="far fa-user"></i> ${esc(n.author || "School")}</span>
        </div>
      </div>`).join("") || '<p class="muted">No news yet.</p>';
  } catch (e) { console.error(e); }
}
async function loadAbout() {
  try {
    const a = await api("/about");
    document.getElementById("aboutTitle").textContent = a.title || "Excellence Academy";
    document.getElementById("aboutHistory").textContent = a.history || "";
    document.getElementById("aboutMission").textContent = a.mission || "";
    document.getElementById("aboutVision").textContent = a.vision || "";
    if (a.image_url) document.getElementById("aboutImage").src = a.image_url;
  } catch (e) { console.error(e); }
}
async function loadRegistrationStatus() {
  try {
    const s = await api("/registration-status");
    const txt = document.getElementById("regStatusText");
    const btn = document.getElementById("openRegBtn");
    if (s.open) { txt.textContent = "🟢 Registration is OPEN."; btn.style.display = "inline"; }
    else { txt.textContent = "🔒 Registration CLOSED."; btn.style.display = "none"; }
    const msg = document.getElementById("regClosedMsg");
    if (msg) msg.textContent = s.open ? "" : "Registration is currently closed.";
  } catch (e) { console.error(e); }
}

// ============ REGISTER ============
async function verifyUgr() {
  const ugr = document.getElementById("regUgr").value.trim();
  const status = document.getElementById("ugrStatus");
  if (!ugr) { status.textContent = ""; return; }
  try {
    const data = await api("/check-prereg/" + encodeURIComponent(ugr));
    if (data.found) {
      status.style.color = "var(--success)";
      status.textContent = `✅ ${data.student.name} — verified! Complete the form below.`;
      document.getElementById("regName").value = data.student.name;
      if (data.student.grade) document.getElementById("regGrade").value = data.student.grade;
    } else {
      status.style.color = "var(--error)";
      status.textContent = "❌ This UGR is not pre-registered. Contact the admin office.";
    }
  } catch (e) { status.style.color = "var(--error)"; status.textContent = "❌ " + e.message; }
}

async function loadAccountsForRegister() {
  try {
    const accounts = await api("/accounts");
    const sel = document.getElementById("regAccount");
    sel.innerHTML = '<option value="">— Select bank account —</option>' +
      accounts.map(a => `<option value="${a.id}">${esc(a.bank_name)} — ${esc(a.account_number)}</option>`).join("");
  } catch (e) { console.error(e); }
}

function showAccountInfo() {
  const sel = document.getElementById("regAccount");
  const info = document.getElementById("accountInfo");
  const opt = sel.options[sel.selectedIndex];
  if (!sel.value) { info.innerHTML = ""; return; }
  const txt = opt.textContent;
  info.innerHTML = `<strong>Pay to:</strong> ${esc(txt)}<br><small>After payment, upload receipt below.</small>`;
}

document.getElementById("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("regErr");
  errEl.textContent = "";
  const fd = new FormData();
  const fields = ["regUgr:ugr", "regName:name", "regEmail:email", "regGrade:grade", "regPhone:phone",
    "regAddress:address", "regPrevSchool:previous_school", "regBirthPlace:birth_place",
    "regBirthDate:birth_date", "regFather:father_name", "regMother:mother_name",
    "regGuardianPhone:guardian_phone", "regPassword:password", "regAccount:account_id",
    "regAmount:payment_amount"];
  fields.forEach(f => {
    const [id, key] = f.split(":");
    fd.append(key, document.getElementById(id).value || "");
  });
  const fileMap = { regPhoto: "photo", regTranscript: "transcript", regCertificate: "certificate", regReceipt: "receipt" };
  for (const [id, key] of Object.entries(fileMap)) {
    const f = document.getElementById(id).files[0];
    if (f) fd.append(key, f);
  }
  try {
    const data = await api("/register", { method: "POST", body: fd });
    alert("✅ " + data.message);
    showPage("home");
    document.getElementById("loginUgr").value = document.getElementById("regUgr").value;
    document.getElementById("registerForm").reset();
  } catch (e) { errEl.textContent = e.message; }
});

// ============ PROFILE ============
async function loadProfile() {
  try {
    const u = await api("/me");
    const photoStyle = u.photo ? `background-image: url('${esc(u.photo)}');` : `background: #dde9f2;`;
    let docs = {};
    try { docs = JSON.parse(u.documents || "{}"); } catch {}
    document.getElementById("profileCard").innerHTML = `
      <div class="profile-photo" style="${photoStyle}">${u.photo ? "" : '<i class="fas fa-user"></i>'}</div>
      <div class="profile-info">
        <h2>${esc(u.name)}</h2>
        <span class="role">${esc(u.role)}</span>
        <div class="profile-details">
          <div><div class="label">ID / UGR</div><div class="value">${esc(u.ugr)}</div></div>
          <div><div class="label">Email</div><div class="value">${esc(u.email || "—")}</div></div>
          <div><div class="label">Grade</div><div class="value">${esc(u.grade || "—")}</div></div>
          <div><div class="label">Department</div><div class="value">${esc(u.department || "—")}</div></div>
          <div><div class="label">Phone</div><div class="value">${esc(u.phone || "—")}</div></div>
          <div><div class="label">Birth Place</div><div class="value">${esc(u.birth_place || "—")}</div></div>
          <div><div class="label">Previous School</div><div class="value">${esc(u.previous_school || "—")}</div></div>
          <div><div class="label">Father</div><div class="value">${esc(u.father_name || "—")}</div></div>
          <div><div class="label">Mother</div><div class="value">${esc(u.mother_name || "—")}</div></div>
          <div><div class="label">Guardian Phone</div><div class="value">${esc(u.guardian_phone || "—")}</div></div>
          <div><div class="label">Member Since</div><div class="value">${new Date(u.created_at).toLocaleDateString()}</div></div>
        </div>
        ${u.address ? `<p style="margin-top:1rem;color:var(--muted);font-size:0.85rem;"><strong>Address:</strong> ${esc(u.address)}</p>` : ""}
        ${docs.transcript || docs.certificate ? `<p style="margin-top:0.8rem;font-size:0.85rem;">
          ${docs.transcript ? `<a href="${esc(docs.transcript)}" target="_blank" class="icon-btn"><i class="fas fa-file"></i> Transcript</a>` : ""}
          ${docs.certificate ? `<a href="${esc(docs.certificate)}" target="_blank" class="icon-btn"><i class="fas fa-award"></i> Certificate</a>` : ""}
        </p>` : ""}
      </div>`;
  } catch (e) { console.error(e); }
}

// ============ ADMIN ============
async function loadAdminDashboard() {
  try {
    const stats = await api("/admin/stats");
    document.getElementById("statStudents").textContent = stats.students;
document.getElementById("statPendingStudents").textContent = stats.pendingStudents;
    document.getElementById("statTeachers").textContent = stats.teachers;
    document.getElementById("statPayments").textContent = stats.pendingPayments;
    document.getElementById("statMarks").textContent = stats.pendingMarks;
    document.getElementById("statComplaints").textContent = stats.complaints;
    const s = await api("/registration-status");
    updateToggleBtn(s.open);
    loadAdminUsers();
  } catch (e) { console.error(e); }
}

function updateToggleBtn(open) {
  const btn = document.getElementById("regToggleBtn");
  btn.dataset.open = open;
  btn.innerHTML = `<i class="fas fa-toggle-${open ? 'on' : 'off'}"></i> <span>${open ? 'Open' : 'Closed'}</span>`;
}
async function loadApprovals() {
  try {
    // Fetch all pending students (you can add a filter later if needed)
    const users = await api("/admin/users?role=student");
    const pending = users.filter(u => u.status === 'pending');
    
    const el = document.getElementById("approvalsList");
    
    if (!pending.length) {
      el.innerHTML = '<p class="muted">✅ No pending approvals. All caught up!</p>';
      return;
    }

    el.innerHTML = pending.map(u => `
      <div class="approval-card">
        <div class="approval-header">
          <div>
            <h4>${esc(u.name)}</h4>
            <span class="ugr-badge">${esc(u.ugr)}</span>
            <span class="grade-badge">${esc(u.grade || "—")}</span>
          </div>
          <div class="approval-actions">
            <button class="btn btn-success" onclick="approveStudent('${esc(u.ugr)}')">
              <i class="fas fa-check"></i> Approve
            </button>
            <button class="btn btn-danger" onclick="rejectStudent('${esc(u.ugr)}')">
              <i class="fas fa-times"></i> Reject
            </button>
          </div>
        </div>
        
        <div class="approval-details">
          <div class="detail-item"><span class="label">Email:</span> ${esc(u.email || "—")}</div>
          <div class="detail-item"><span class="label">Phone:</span> ${esc(u.phone || "—")}</div>
          <div class="detail-item"><span class="label">Birth Place:</span> ${esc(u.birth_place || "—")}</div>
          <div class="detail-item"><span class="label">Previous School:</span> ${esc(u.previous_school || "—")}</div>
          <div class="detail-item"><span class="label">Father:</span> ${esc(u.father_name || "—")}</div>
          <div class="detail-item"><span class="label">Mother:</span> ${esc(u.mother_name || "—")}</div>
          <div class="detail-item"><span class="label">Address:</span> ${esc(u.address || "—")}</div>
          <div class="detail-item"><span class="label">Registered:</span> ${new Date(u.created_at).toLocaleString()}</div>
        </div>
      </div>
    `).join("");
  } catch (e) { console.error(e); }
}

async function approveStudent(ugr) {
  if (!confirm(`Approve ${ugr} and activate their account?`)) return;
  try {
    const data = await api(`/admin/approve-student/${encodeURIComponent(ugr)}`, { method: "POST" });
    alert("✅ " + data.message);
    loadApprovals();
    loadAdminUsers();
    loadAdminDashboard();
  } catch (e) { alert("❌ " + e.message); }
}

async function rejectStudent(ugr) {
  if (!confirm(`Reject ${ugr}?`)) return;
  try {
    await api(`/admin/reject-student/${encodeURIComponent(ugr)}`, { method: "POST" });
    alert("❌ Student rejected.");
    loadApprovals();
    loadAdminUsers();
  } catch (e) { alert("❌ " + e.message); }
}
async function toggleRegistration() {
  const btn = document.getElementById("regToggleBtn");
  const newState = btn.dataset.open !== "true";
  try {
    await api("/admin/toggle-registration", { method: "POST", body: { open: newState }});
    updateToggleBtn(newState);
    alert(`Registration is now ${newState ? "OPEN" : "CLOSED"}`);
  } catch (e) { alert(e.message); }
}

async function loadAdminUsers() {
  try {
    const users = await api("/admin/users");
    const grouped = {};
    users.forEach(u => { if (!grouped[u.role]) grouped[u.role] = []; grouped[u.role].push(u); });
    const el = document.getElementById("adminUsersList");
    el.innerHTML = Object.entries(grouped).map(([role, list]) => `
      <h4 style="margin-top:1.2rem;color:var(--primary);text-transform:capitalize;font-size:0.95rem;">
        <i class="fas fa-${role === 'student' ? 'user-graduate' : role === 'teacher' ? 'chalkboard-teacher' : role === 'registrar' ? 'clipboard-check' : 'user-shield'}"></i>
        ${role}s (${list.length})
      </h4>
      ${list.map(u => `
        <div class="list-row">
          <div class="info">
            <span class="name">${esc(u.name)} ${u.registration_complete === 1 ? "✅" : "⏳"}</span>
            <span class="sub">${esc(u.ugr)} · ${esc(u.email || "no email")} · ${esc(u.grade || u.department || "")}</span>
          </div>
          <div class="actions">
            ${role === "student" && u.registration_complete === 1 ? `<button class="icon-btn" onclick="adminDownloadTranscript('${esc(u.ugr)}')"><i class="fas fa-download"></i></button>` : ""}
            ${u.role !== "admin" ? `<button class="icon-btn danger" onclick="adminDeleteUser('${esc(u.ugr)}')"><i class="fas fa-trash"></i></button>` : ""}
          </div>
        </div>`).join("")}
    `).join("");
  } catch (e) { console.error(e); }
}

async function adminPreRegister() {
  const msg = document.getElementById("preMsg");
  msg.textContent = "";
  try {
    const data = await api("/admin/pre-register", { method: "POST", body: {
      ugr: document.getElementById("preUgr").value.trim(),
      name: document.getElementById("preName").value.trim(),
      grade: document.getElementById("preGrade").value
    }});
    msg.style.color = "var(--success)";
    msg.textContent = "✅ " + data.message;
    document.getElementById("preUgr").value = "";
    document.getElementById("preName").value = "";
    loadAdminUsers();
    loadPreRegistered();
  } catch (e) { msg.style.color = "var(--error)"; msg.textContent = "❌ " + e.message; }
}

async function loadPreRegistered() {
  try {
    const users = await api("/admin/users?role=student");
    const pending = users.filter(u => u.registration_complete === 0);
    document.getElementById("preRegisteredList").innerHTML = pending.length
      ? pending.map(u => `
        <div class="list-row">
          <div class="info">
            <span class="name">${esc(u.name)}</span>
            <span class="sub">${esc(u.ugr)} · ${esc(u.grade || "")} · awaiting registration</span>
          </div>
        </div>`).join("")
      : '<p class="muted">No pending pre-registrations.</p>';
  } catch (e) { console.error(e); }
}

async function adminAddUser() {
  const msg = document.getElementById("newUserMsg");
  msg.textContent = "";
  const fd = new FormData();
  fd.append("role", document.getElementById("newRole").value);
  fd.append("ugr", document.getElementById("newUgr").value.trim());
  fd.append("name", document.getElementById("newName").value.trim());
  fd.append("email", document.getElementById("newEmail").value.trim());
  fd.append("phone", document.getElementById("newPhone").value.trim());
  fd.append("department", document.getElementById("newDepartment").value.trim());
  fd.append("password", document.getElementById("newPassword").value);
  const photo = document.getElementById("newPhoto").files[0];
  if (photo) fd.append("photo", photo);
  try {
    await api("/admin/users", { method: "POST", body: fd });
    msg.style.color = "var(--success)";
    msg.textContent = "✅ User created!";
    document.getElementById("newUgr").value = "";
    document.getElementById("newName").value = "";
    document.getElementById("newEmail").value = "";
    document.getElementById("newPhone").value = "";
    document.getElementById("newDepartment").value = "";
    document.getElementById("newPhoto").value = "";
    loadAdminUsers();
  } catch (e) { msg.style.color = "var(--error)"; msg.textContent = "❌ " + e.message; }
}

async function adminDeleteUser(ugr) {
  if (!confirm(`Delete user ${ugr} and all related data?`)) return;
  try {
    await api(`/admin/users/${encodeURIComponent(ugr)}`, { method: "DELETE" });
    loadAdminUsers();
    loadAdminDashboard();
  } catch (e) { alert(e.message); }
}

function adminDownloadTranscript(ugr) {
  window.location.href = `/api/student/transcript?ugr=${encodeURIComponent(ugr)}`;
}

async function loadPayments() {
  try {
    const list = await api("/admin/payments");
    const el = document.getElementById("paymentsList");
    if (!list.length) { el.innerHTML = '<p class="muted">No payments yet.</p>'; return; }
    el.innerHTML = `<table class="marks-table">
      <thead><tr><th>Student</th><th>Amount</th><th>Account</th><th>Receipt</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>
      ${list.map(p => `<tr>
        <td>${esc(p.student_name || p.student_ugr)}</td>
        <td><strong>${p.amount} ETB</strong></td>
        <td>${esc(p.bank_name || "—")}</td>
        <td>${p.receipt_url ? `<a href="${esc(p.receipt_url)}" target="_blank" class="icon-btn"><i class="fas fa-receipt"></i> View</a>` : "—"}</td>
        <td><span class="status-badge ${p.status}">${p.status}</span></td>
        <td>
          ${p.status === "pending" ? `
            <button class="icon-btn success" onclick="approvePayment(${p.id})"><i class="fas fa-check"></i></button>
            <button class="icon-btn danger" onclick="rejectPayment(${p.id})"><i class="fas fa-times"></i></button>
          ` : "—"}
        </td>
      </tr>`).join("")}
      </tbody></table>`;
  } catch (e) { console.error(e); }
}

async function approvePayment(id) {
  try {
    await api(`/admin/payments/${id}/approve`, { method: "POST" });
    loadPayments(); loadAdminDashboard();
  } catch (e) { alert(e.message); }
}
async function rejectPayment(id) {
  const reason = prompt("Reason for rejection:");
  if (reason === null) return;
  try {
    await api(`/admin/payments/${id}/reject`, { method: "POST", body: { reason }});
    loadPayments(); loadAdminDashboard();
  } catch (e) { alert(e.message); }
}

async function loadMarksApproval() {
  try {
    const list = await api("/admin/pending-marks");
    const el = document.getElementById("marksApprovalList");
    if (!list.length) { el.innerHTML = '<p class="muted">✅ No marks awaiting approval.</p>'; return; }
    el.innerHTML = `<table class="marks-table">
      <thead><tr><th>Student</th><th>Course</th><th>Mid</th><th>Final</th><th>Assign</th><th>Total</th><th>Teacher</th><th>Action</th></tr></thead>
      <tbody>
      ${list.map(a => `<tr>
        <td>${esc(a.student_name || a.student_ugr)}</td>
        <td>${esc(a.course_code)} — ${esc(a.course_name)}</td>
        <td>${a.mid_mark}</td><td>${a.final_mark}</td><td>${a.assignment_mark}</td>
        <td><strong>${a.total_mark}</strong></td>
        <td>${esc(a.teacher_name || a.teacher_ugr)}</td>
        <td>
          <button class="icon-btn success" onclick="approveMark(${a.id})"><i class="fas fa-check"></i></button>
          <button class="icon-btn danger" onclick="rejectMark(${a.id})"><i class="fas fa-times"></i></button>
        </td>
      </tr>`).join("")}
      </tbody></table>`;
  } catch (e) { console.error(e); }
}

async function approveMark(id) {
  try {
    await api(`/admin/marks/${id}/approve`, { method: "POST" });
    loadMarksApproval(); loadAdminDashboard();
  } catch (e) { alert(e.message); }
}
async function rejectMark(id) {
  const reason = prompt("Reason for rejection:");
  if (reason === null) return;
  try {
    await api(`/admin/marks/${id}/reject`, { method: "POST", body: { reason }});
    loadMarksApproval();
  } catch (e) { alert(e.message); }
}

async function loadAdminAccounts() {
  try {
    const list = await api("/admin/accounts");
    document.getElementById("accountsList").innerHTML = list.map(a => `
      <div class="list-row">
        <div class="info">
          <span class="name">${esc(a.bank_name)} — ${esc(a.account_number)}</span>
          <span class="sub">${esc(a.account_name)} · ${esc(a.branch || "—")}</span>
        </div>
        <div class="actions">
          <button class="icon-btn danger" onclick="deleteAccount(${a.id})"><i class="fas fa-trash"></i></button>
        </div>
      </div>`).join("") || '<p class="muted">No accounts yet.</p>';
  } catch (e) { console.error(e); }
}
async function adminAddAccount() {
  try {
    await api("/admin/accounts", { method: "POST", body: {
      bank_name: document.getElementById("accBank").value.trim(),
      account_number: document.getElementById("accNumber").value.trim(),
      account_name: document.getElementById("accName").value.trim(),
      branch: document.getElementById("accBranch").value.trim()
    }});
    document.getElementById("accBank").value = "";
    document.getElementById("accNumber").value = "";
    document.getElementById("accName").value = "";
    document.getElementById("accBranch").value = "";
    loadAdminAccounts();
  } catch (e) { alert(e.message); }
}
async function deleteAccount(id) {
  if (!confirm("Delete this account?")) return;
  await api(`/admin/accounts/${id}`, { method: "DELETE" });
  loadAdminAccounts();
}

async function loadAdminCourses() {
  try {
    const list = await api("/admin/courses");
    document.getElementById("adminCoursesList").innerHTML = list.map(c => `
      <div class="list-row">
        <div class="info">
          <span class="name">${esc(c.code)} — ${esc(c.name)}</span>
          <span class="sub">${esc(c.teacher_name || "no teacher")} · ${esc(c.semester)} · ${esc(c.grade)}</span>
        </div>
        <div class="actions">
          <button class="icon-btn danger" onclick="deleteCourse(${c.id})"><i class="fas fa-trash"></i></button>
        </div>
      </div>`).join("") || '<p class="muted">No courses.</p>';
  } catch (e) { console.error(e); }
}
async function adminAddCourse() {
  try {
    await api("/admin/courses", { method: "POST", body: {
      code: document.getElementById("courseCode").value.trim(),
      name: document.getElementById("courseName").value.trim(),
      teacher_ugr: document.getElementById("courseTeacher").value.trim(),
      semester: document.getElementById("courseSemester").value,
      grade: document.getElementById("courseGrade").value,
      credits: document.getElementById("courseCredits").value
    }});
    document.getElementById("courseCode").value = "";
    document.getElementById("courseName").value = "";
    loadAdminCourses();
  } catch (e) { alert(e.message); }
}
async function deleteCourse(id) {
  if (!confirm("Delete this course?")) return;
  await api(`/admin/courses/${id}`, { method: "DELETE" });
  loadAdminCourses();
}

async function loadAdminSchedules() {
  try {
    const list = await api("/admin/schedules");
    document.getElementById("schedulesList").innerHTML = list.map(s => `
      <div class="list-row">
        <div class="info">
          <span class="name">${esc(s.day_of_week)} ${esc(s.start_time)}-${esc(s.end_time)} — ${esc(s.course_code)}</span>
          <span class="sub">${esc(s.course_name || "")} · ${esc(s.teacher_name || "")} · ${esc(s.room || "")} · ${esc(s.semester)} ${esc(s.year)} · ${esc(s.grade)}</span>
        </div>
        <div class="actions">
          <button class="icon-btn danger" onclick="deleteSchedule(${s.id})"><i class="fas fa-trash"></i></button>
        </div>
      </div>`).join("") || '<p class="muted">No schedule entries.</p>';
  } catch (e) { console.error(e); }
}
async function adminAddSchedule() {
  try {
    await api("/admin/schedules", { method: "POST", body: {
      course_code: document.getElementById("schCourseCode").value.trim(),
      course_name: document.getElementById("schCourseName").value.trim(),
      day_of_week: document.getElementById("schDay").value,
      start_time: document.getElementById("schStart").value.trim(),
      end_time: document.getElementById("schEnd").value.trim(),
      room: document.getElementById("schRoom").value.trim(),
      teacher_name: document.getElementById("schTeacher").value.trim(),
      semester: document.getElementById("schSemester").value,
      year: document.getElementById("schYear").value.trim(),
      grade: document.getElementById("schGrade").value
    }});
    loadAdminSchedules();
  } catch (e) { alert(e.message); }
}
async function deleteSchedule(id) {
  if (!confirm("Delete this schedule?")) return;
  await api(`/admin/schedules/${id}`, { method: "DELETE" });
  loadAdminSchedules();
}

async function loadComplaints() {
  try {
    const list = await api("/admin/complaints");
    const el = document.getElementById("complaintsList");
    if (!list.length) { el.innerHTML = '<p class="muted">No complaints yet.</p>'; return; }
    el.innerHTML = list.map(c => `
      <div class="complaint-item">
        <h4>${esc(c.subject)}</h4>
        <p>${esc(c.message)}</p>
        <div class="meta">
          <span><strong>${esc(c.student_name || c.student_ugr)}</strong> · ${new Date(c.created_at).toLocaleString()}</span>
          <span class="status-badge ${c.status === 'open' ? 'pending' : 'approved'}">${c.status}</span>
        </div>
        ${c.admin_reply ? `<div class="complaint-reply"><strong>Admin reply:</strong> ${esc(c.admin_reply)}</div>` : `
          <button class="icon-btn" style="margin-top:0.5rem;" onclick="replyComplaint(${c.id})"><i class="fas fa-reply"></i> Reply</button>
        `}
      </div>`).join("");
  } catch (e) { console.error(e); }
}
async function replyComplaint(id) {
  const reply = prompt("Your reply:");
  if (!reply) return;
  try {
    await api(`/admin/complaints/${id}/reply`, { method: "POST", body: { reply, status: "resolved" }});
    loadComplaints();
  } catch (e) { alert(e.message); }
}

async function loadAdminNews() {
  try {
    const news = await api("/news");
    document.getElementById("adminNewsList").innerHTML = news.map(n => `
      <div class="list-row">
        <div class="info">
          <span class="name">${esc(n.title)}</span>
          <span class="sub">${new Date(n.created_at).toLocaleDateString()}</span>
        </div>
        <div class="actions">
          <button class="icon-btn danger" onclick="deleteNews(${n.id})"><i class="fas fa-trash"></i></button>
        </div>
      </div>`).join("") || '<p class="muted">No news.</p>';
  } catch (e) { console.error(e); }
}
async function adminPostNews() {
  try {
    await api("/admin/news", { method: "POST", body: {
      title: document.getElementById("newsTitle").value.trim(),
      content: document.getElementById("newsContent").value.trim()
    }});
    document.getElementById("newsTitle").value = "";
    document.getElementById("newsContent").value = "";
    loadAdminNews();
  } catch (e) { alert(e.message); }
}
async function deleteNews(id) {
  if (!confirm("Delete this news?")) return;
  await api(`/admin/news/${id}`, { method: "DELETE" });
  loadAdminNews();
}

async function loadAdminAbout() {
  try {
    const a = await api("/about");
    document.getElementById("editTitle").value = a.title || "";
    document.getElementById("editImage").value = a.image_url || "";
    document.getElementById("editHistory").value = a.history || "";
    document.getElementById("editMission").value = a.mission || "";
    document.getElementById("editVision").value = a.vision || "";
  } catch (e) { console.error(e); }
}
async function adminSaveAbout() {
  const msg = document.getElementById("aboutMsg");
  try {
    await api("/admin/about", { method: "PUT", body: {
      title: document.getElementById("editTitle").value,
      image_url: document.getElementById("editImage").value,
      history: document.getElementById("editHistory").value,
      mission: document.getElementById("editMission").value,
      vision: document.getElementById("editVision").value
    }});
    msg.style.color = "var(--success)";
    msg.textContent = "✅ Updated!";
  } catch (e) { msg.style.color = "var(--error)"; msg.textContent = "❌ " + e.message; }
}

// ============ TEACHER ============
async function loadTeacherDashboard() {
  try {
    const me = await api("/me");
    document.getElementById("teacherMeta").textContent = `${me.ugr} · ${me.department || "Teacher"}`;
    const courses = await api("/teacher/courses");
    document.getElementById("tCourseCode").innerHTML = courses.map(c => `<option value="${esc(c.code)}">${esc(c.code)} — ${esc(c.name)}</option>`).join("") || '<option value="">No courses</option>';
    loadTeacherAssessments();
  } catch (e) { console.error(e); }
}
async function loadTeacherAssessments() {
  try {
    const list = await api("/teacher/assessments");
    const el = document.getElementById("teacherAssessments");
    if (!list.length) { el.innerHTML = '<p class="muted">No assessments yet.</p>'; return; }
    el.innerHTML = `<table class="marks-table">
      <thead><tr><th>Student</th><th>Course</th><th>Mid</th><th>Final</th><th>Assign</th><th>Total</th><th>Status</th></tr></thead>
      <tbody>${list.map(a => `<tr>
        <td>${esc(a.student_name || a.student_ugr)}</td>
        <td>${esc(a.course_code)} — ${esc(a.course_name)}</td>
        <td>${a.mid_mark}</td><td>${a.final_mark}</td><td>${a.assignment_mark}</td>
        <td><strong>${a.total_mark}</strong></td>
        <td><span class="status-badge ${a.status}">${a.status.replace(/_/g, ' ')}</span></td>
      </tr>`).join("")}</tbody></table>`;
  } catch (e) { console.error(e); }
}
async function teacherAddAssessment() {
  const msg = document.getElementById("tMsg");
  msg.textContent = "";
  try {
    await api("/teacher/assessments", { method: "POST", body: {
      student_ugr: document.getElementById("tStudentUgr").value.trim(),
      course_code: document.getElementById("tCourseCode").value,
      mid_mark: document.getElementById("tMid").value,
      final_mark: document.getElementById("tFinal").value,
      assignment_mark: document.getElementById("tAssign").value,
      semester: document.getElementById("tSemester").value,
      year: document.getElementById("tYear").value.trim()
    }});
    msg.style.color = "var(--success)";
    msg.textContent = "✅ Submitted for admin approval.";
    document.getElementById("tStudentUgr").value = "";
    document.getElementById("tMid").value = "";
    document.getElementById("tFinal").value = "";
    document.getElementById("tAssign").value = "";
    loadTeacherAssessments();
  } catch (e) { msg.style.color = "var(--error)"; msg.textContent = "❌ " + e.message; }
}

// ============ REGISTRAR ============
async function loadRegistrarDashboard() { loadRegistrarPending(); loadRegistrarAll(); }
async function loadRegistrarPending() {
  try {
    const list = await api("/registrar/pending");
    const el = document.getElementById("registrarPending");
    if (!list.length) { el.innerHTML = '<p class="muted">✅ No pending.</p>'; return; }
    el.innerHTML = `<table class="marks-table">
      <thead><tr><th>Student</th><th>Course</th><th>Mid</th><th>Final</th><th>Assign</th><th>Total</th><th>Action</th></tr></thead>
      <tbody>${list.map(a => `<tr>
        <td>${esc(a.student_name || a.student_ugr)}</td>
        <td>${esc(a.course_code)} — ${esc(a.course_name)}</td>
        <td>${a.mid_mark}</td><td>${a.final_mark}</td><td>${a.assignment_mark}</td>
        <td><strong>${a.total_mark}</strong></td>
        <td>
          <button class="icon-btn success" onclick="registrarApprove(${a.id})"><i class="fas fa-check"></i></button>
          <button class="icon-btn danger" onclick="registrarReject(${a.id})"><i class="fas fa-times"></i></button>
        </td>
      </tr>`).join("")}</tbody></table>`;
  } catch (e) { console.error(e); }
}
async function loadRegistrarAll() {
  try {
    const list = await api("/registrar/all");
    const el = document.getElementById("registrarAll");
    if (!list.length) { el.innerHTML = '<p class="muted">None.</p>'; return; }
    el.innerHTML = `<table class="marks-table">
      <thead><tr><th>Student</th><th>Course</th><th>Total</th><th>Status</th></tr></thead>
      <tbody>${list.map(a => `<tr>
        <td>${esc(a.student_name || a.student_ugr)}</td>
        <td>${esc(a.course_code)} — ${esc(a.course_name)}</td>
        <td><strong>${a.total_mark}</strong></td>
        <td><span class="status-badge ${a.status}">${a.status.replace(/_/g, ' ')}</span></td>
      </tr>`).join("")}</tbody></table>`;
  } catch (e) { console.error(e); }
}
async function registrarApprove(id) {
  try {
    await api(`/registrar/assessments/${id}/approve`, { method: "POST" });
    loadRegistrarPending(); loadRegistrarAll();
  } catch (e) { alert(e.message); }
}
async function registrarReject(id) {
  const reason = prompt("Reason:");
  if (reason === null) return;
  try {
    await api(`/registrar/assessments/${id}/reject`, { method: "POST", body: { reason }});
    loadRegistrarPending(); loadRegistrarAll();
  } catch (e) { alert(e.message); }
}
// Populate Review Card dynamically
function updateReviewCard() {
  const reviewDetails = document.getElementById("reviewDetails");
  const approveBox = document.getElementById("approveInfo");
  
  const fields = [
    { label: "Full Name", id: "regName" },
    { label: "Grade", id: "regGrade", type: "select" },
    { label: "Email", id: "regEmail" },
    { label: "Phone", id: "regPhone" },
    { label: "Birth Place", id: "regBirthPlace" },
    { label: "Birth Date", id: "regBirthDate" },
    { label: "Previous School", id: "regPrevSchool" },
    { label: "Address", id: "regAddress" },
    { label: "Father's Name", id: "regFather" },
    { label: "Mother's Name", id: "regMother" },
    { label: "Guardian Phone", id: "regGuardianPhone" }
  ];

  let hasData = false;
  let html = "";

  fields.forEach(f => {
    const el = document.getElementById(f.id);
    let value = el ? el.value.trim() : "";
    if (value) {
      hasData = true;
      html += `<div class="review-row"><span class="label">${f.label}</span><span class="value">${esc(value)}</span></div>`;
    }
  });

  if (hasData) {
    reviewDetails.innerHTML = html;
    approveBox.disabled = false; // Enable the checkbox
  } else {
    reviewDetails.innerHTML = `<p class="muted" style="text-align:center; padding: 1rem;">Please fill out the form above to generate your summary.</p>`;
    approveBox.disabled = true;
  }
}

// Attach listeners to all form inputs to update the review card live
document.querySelectorAll("#registerForm input, #registerForm select, #registerForm textarea").forEach(el => {
  el.addEventListener("input", updateReviewCard);
  el.addEventListener("change", updateReviewCard);
});

// ============ STUDENT ============
async function loadStudentDashboard() {
  try {
    const me = await api("/me");
    document.getElementById("studentWelcome").textContent = me.name;
    document.getElementById("studentMeta").textContent = `${me.ugr} · ${me.grade || "—"}`;
    const data = await api("/student/dashboard");

    // Courses
    document.getElementById("studentCourses").innerHTML = data.courses.length
      ? `<div class="course-grid">${data.courses.map(c => `
        <div class="course-card">
          <div class="code">${esc(c.code)}</div>
          <h4>${esc(c.name)}</h4>
          <p><i class="fas fa-chalkboard-teacher"></i> ${esc(c.teacher_name || "TBA")}</p>
          <p><i class="fas fa-calendar"></i> ${esc(c.semester)} · ${c.credits} credits</p>
        </div>`).join("")}</div>`
      : '<p class="muted">No courses.</p>';

    // Assessments
    document.getElementById("studentAssessments").innerHTML = data.assessments.length
      ? `<table class="marks-table">
        <thead><tr><th>Course</th><th>Mid</th><th>Final</th><th>Assign</th><th>Total</th><th>Semester</th><th>Status</th></tr></thead>
        <tbody>${data.assessments.map(a => `<tr>
          <td>${esc(a.course_code)} — ${esc(a.course_name)}</td>
          <td>${a.mid_mark}</td><td>${a.final_mark}</td><td>${a.assignment_mark}</td>
          <td><span class="mark-pill ${a.total_mark >= 50 ? 'pass' : 'fail'}">${a.total_mark}</span></td>
          <td>${esc(a.semester)}</td>
          <td><span class="status-badge ${a.status}">${a.status.replace(/_/g, ' ')}</span></td>
        </tr>`).join("")}</tbody></table>`
      : '<p class="muted">No assessments.</p>';
      document.getElementById("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("regErr");
  errEl.textContent = "";
  
  // NEW: Check approval box
  if (!document.getElementById("approveInfo").checked) {
    errEl.textContent = "❌ You must approve the information before registering.";
    return;
  }

  const fd = new FormData();
  const fields = ["regUgr:ugr", "regName:name", "regEmail:email", "regGrade:grade", "regPhone:phone",
    "regAddress:address", "regPrevSchool:previous_school", "regBirthPlace:birth_place",
    "regBirthDate:birth_date", "regFather:father_name", "regMother:mother_name",
    "regGuardianPhone:guardian_phone", "regPassword:password", "regAccount:account_id",
    "regAmount:payment_amount"];
  fields.forEach(f => {
    const [id, key] = f.split(":");
    fd.append(key, document.getElementById(id).value || "");
  });
  const fileMap = { regPhoto: "photo", regTranscript: "transcript", regCertificate: "certificate", regReceipt: "receipt" };
  for (const [id, key] of Object.entries(fileMap)) {
    const f = document.getElementById(id).files[0];
    if (f) fd.append(key, f);
  }
  
  try {
    const data = await api("/register", { method: "POST", body: fd });
    alert("✅ " + data.message);
    showPage("home");
    document.getElementById("loginUgr").value = document.getElementById("regUgr").value;
    document.getElementById("registerForm").reset();
    document.getElementById("reviewDetails").innerHTML = `<p class="muted" style="text-align:center; padding: 1rem;">Please fill out the form above to generate your summary.</p>`;
    document.getElementById("approveInfo").checked = false;
    document.getElementById("approveInfo").disabled = true;
  } catch (e) { errEl.textContent = e.message; }
});

    // Transcript preview
    const approved = data.assessments.filter(a => a.status === "approved");
    const sem1 = approved.filter(a => a.semester === "Semester 1");
    const sem2 = approved.filter(a => a.semester === "Semester 2");
    function renderFrame(title, list) {
      if (!list.length) return `<div class="transcript-frame"><h4>${title} <span>Empty</span></h4><p class="muted">No approved results.</p></div>`;
      const avg = (list.reduce((s, a) => s + a.total_mark, 0) / list.length).toFixed(2);
      return `<div class="transcript-frame">
        <h4>${title} <span>${list.length} courses</span></h4>
        <table class="transcript-table">
          <thead><tr><th>Code</th><th>Course</th><th>Total</th></tr></thead>
          <tbody>${list.map(a => `<tr><td>${esc(a.course_code)}</td><td>${esc(a.course_name)}</td><td><strong>${a.total_mark}</strong></td></tr>`).join("")}</tbody>
        </table>
        <div class="transcript-summary"><span>Average</span><span>${avg}</span></div>
      </div>`;
    }
    document.getElementById("studentTranscript").innerHTML = `<div class="transcript-frameset">
      ${renderFrame("First Semester", sem1)}${renderFrame("Second Semester", sem2)}
    </div>`;

    // Schedule
    loadStudentSchedule();

    // Payments
    const payments = await api("/student/payments");
    document.getElementById("studentPayments").innerHTML = payments.length
      ? `<table class="marks-table"><thead><tr><th>Amount</th><th>Bank</th><th>Status</th><th>Date</th></tr></thead>
        <tbody>${payments.map(p => `<tr>
          <td><strong>${p.amount} ETB</strong></td>
          <td>${esc(p.bank_name || "—")}</td>
          <td><span class="status-badge ${p.status}">${p.status}</span></td>
          <td>${new Date(p.created_at).toLocaleDateString()}</td>
        </tr>`).join("")}</tbody></table>`
      : '<p class="muted">No payments yet.</p>';

    // Complaints
    loadStudentComplaints();
  } catch (e) { console.error(e); }
}

async function loadStudentSchedule() {
  try {
    const list = await api("/schedules");
    const el = document.getElementById("studentSchedule");
    if (!list.length) { el.innerHTML = '<p class="muted">No schedule available.</p>'; return; }
    const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    el.innerHTML = days.map(day => {
      const dayRows = list.filter(r => r.day_of_week === day);
      if (!dayRows.length) return "";
      return `<div class="schedule-day">
        <h4>${day}</h4>
        <table>
          <thead><tr><th>Time</th><th>Course</th><th>Teacher</th><th>Room</th></tr></thead>
          <tbody>${dayRows.map(r => `<tr>
            <td>${esc(r.start_time)} - ${esc(r.end_time)}</td>
            <td>${esc(r.course_code)} ${esc(r.course_name || "")}</td>
            <td>${esc(r.teacher_name || "—")}</td>
            <td>${esc(r.room || "—")}</td>
          </tr>`).join("")}</tbody>
        </table>
      </div>`;
    }).join("");
  } catch (e) { console.error(e); }
}

async function loadStudentComplaints() {
  try {
    const list = await api("/student/complaints");
    document.getElementById("studentComplaints").innerHTML = list.length
      ? list.map(c => `
        <div class="complaint-item">
          <h4>${esc(c.subject)}</h4>
          <p>${esc(c.message)}</p>
          <div class="meta">
            <span>${new Date(c.created_at).toLocaleString()}</span>
            <span class="status-badge ${c.status === 'open' ? 'pending' : 'approved'}">${c.status}</span>
          </div>
          ${c.admin_reply ? `<div class="complaint-reply"><strong>Admin:</strong> ${esc(c.admin_reply)}</div>` : ""}
        </div>`).join("")
      : '<p class="muted">No complaints filed.</p>';
  } catch (e) { console.error(e); }
}

async function studentSubmitComplaint() {
  const msg = document.getElementById("compMsg");
  msg.textContent = "";
  try {
    await api("/student/complaints", { method: "POST", body: {
      subject: document.getElementById("compSubject").value.trim(),
      message: document.getElementById("compMessage").value.trim()
    }});
    msg.style.color = "var(--success)";
    msg.textContent = "✅ Submitted. Admin will reply soon.";
    document.getElementById("compSubject").value = "";
    document.getElementById("compMessage").value = "";
    loadStudentComplaints();
  } catch (e) { msg.style.color = "var(--error)"; msg.textContent = "❌ " + e.message; }
}

function downloadTranscript() { window.location.href = "/api/student/transcript"; }
function downloadSchedule() { window.location.href = "/api/student/schedule-pdf"; }

// ============ TABS ============
document.querySelectorAll(".admin-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    const parent = tab.closest(".page");
    parent.querySelectorAll(".admin-tab").forEach(t => t.classList.remove("active"));
    parent.querySelectorAll(".admin-tab-content").forEach(c => c.classList.remove("active"));
    tab.classList.add("active");
    const content = document.getElementById("tab-" + tab.dataset.tab);
    if (content) content.classList.add("active");
    const t = tab.dataset.tab;
    if (t === "users") loadAdminUsers();
    if (t === "pre-register") loadPreRegistered();
    if (t === "payments") loadPayments();
    if (t === "marks-approval") loadMarksApproval();
    if (t === "accounts") loadAdminAccounts();
    if (t === "courses") loadAdminCourses();
    if (t === "schedules") loadAdminSchedules();
    if (t === "complaints") loadComplaints();
    if (t === "news") loadAdminNews();
    if (t === "about") loadAdminAbout();
    if (t === "reg-pending") loadRegistrarPending();
    if (t === "reg-all") loadRegistrarAll();
    if (t === "stu-courses") loadStudentDashboard();
    if (t === "stu-results") loadStudentDashboard();
    if (t === "stu-transcript") loadStudentDashboard();
    if (t === "stu-schedule") loadStudentSchedule();
    if (t === "stu-payments") loadStudentDashboard();
    if (t === "stu-complaints") loadStudentComplaints();
    if (t === "approvals") loadApprovals();
  });
});
// ============ FOOTER INTERACTIONS ============
function subscribeNewsletter(e) {
  e.preventDefault();
  const email = document.getElementById("newsletterEmail").value.trim();
  if (!email) return;
  
  // Simple validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    alert("❌ Please enter a valid email address.");
    return;
  }

  // Simulate saving subscription (you can also save this to DB via API later)
  alert(`✅ Thank you! ${email} has been subscribed to our newsletter.`);
  document.getElementById("newsletterEmail").value = "";
}

// Show/hide back-to-top button on scroll
window.addEventListener("scroll", () => {
  const btn = document.getElementById("backToTop");
  if (!btn) return;
  if (window.scrollY > 400) {
    btn.classList.add("visible");
  } else {
    btn.classList.remove("visible");
  }
});

// ============ BOOT ============
(async () => {
  renderSidebar();
  loadHomeNews();
  loadRegistrationStatus();
  loadAccountsForRegister();
  try {
    currentUser = await api("/me");
    document.getElementById("userBadge").style.display = "flex";
    document.getElementById("userBadgeName").textContent = currentUser.name;
    renderSidebar();
    const routes = { admin: "admin", registrar: "registrar", teacher: "teacher", student: "student" };
    showPage(routes[currentUser.role] || "home");
  } catch (e) {}
})();
// ============ FORGOT PASSWORD ============
function toggleForgotPassword(e) {
  if (e) e.preventDefault();
  const loginBox = document.querySelector(".login-home");
  const forgotBox = document.getElementById("forgotPasswordBox");
  
  if (forgotBox.style.display === "none") {
    loginBox.style.display = "none";
    forgotBox.style.display = "block";
  } else {
    loginBox.style.display = "block";
    forgotBox.style.display = "none";
  }
}

document.getElementById("forgotPasswordForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("forgotErr");
  errEl.textContent = "";

  try {
    const data = await api("/forgot-password", { method: "POST", body: {
      ugr: document.getElementById("forgotUgr").value.trim(),
      guardian_phone: document.getElementById("forgotPhone").value.trim(),
      new_password: document.getElementById("forgotNewPassword").value
    }});
    
    alert("✅ " + data.message);
    
    // Reset form and switch back to login
    document.getElementById("forgotPasswordForm").reset();
    toggleForgotPassword();
    document.getElementById("loginUgr").value = document.getElementById("forgotUgr").value;
    
  } catch (e) {
    errEl.textContent = "❌ " + e.message;
  }
});
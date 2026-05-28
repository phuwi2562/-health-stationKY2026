const POPULATION_KEY = "khamyai.ncd.population";
const RECORDS_KEY = "khamyai.ncd.records";
const SETTINGS_KEY = "khamyai.ncd.settings";
const USERS_KEY = "khamyai.ncd.users";
const SESSION_KEY = "khamyai.ncd.session";
const DEFAULT_SHEET_ID = "1yydaayto6uVSTJ8Qav84kBcZ_HDQiBGKBIkBOGjlBvU";

let population = readJson(POPULATION_KEY, []);
let records = readJson(RECORDS_KEY, []);
let settings = readJson(SETTINGS_KEY, { sheetId: DEFAULT_SHEET_ID, webAppUrl: "" });
let users = readJson(USERS_KEY, []);
let session = readJson(SESSION_KEY, null);
let currentUser = null;
let selectedPerson = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

document.addEventListener("DOMContentLoaded", async () => {
  await bootstrapUsers();
  setupLogoFallbacks();
  bindEvents();
  $("#sheetId").value = settings.sheetId || DEFAULT_SHEET_ID;
  $("#webAppUrl").value = settings.webAppUrl || "";
  $("[name='screeningDate']").valueAsDate = new Date();
  await restoreSession();
  if (!population.length) await loadBundledPopulation({ silent: true });
});

function bindEvents() {
  $$(".auth-tab").forEach((tab) => tab.addEventListener("click", () => switchAuthTab(tab.dataset.authTab)));
  $("#loginForm").addEventListener("submit", handleLogin);
  $("#registerForm").addEventListener("submit", handleRegister);
  $("#logoutBtn").addEventListener("click", confirmLogout);
  $("#changePasswordBtn").addEventListener("click", () => $("#passwordDialog").showModal());
  $("#passwordForm").addEventListener("submit", handleChangePassword);

  $$(".tab").forEach((tab) => tab.addEventListener("click", () => switchView(tab.dataset.view)));
  $("#personSearch").addEventListener("input", renderPeople);
  $("#loadBundledCsv").addEventListener("click", () => loadBundledPopulation({ silent: false }));
  $("#csvFile").addEventListener("change", handleCsvUpload);
  $("#usersCsvFile").addEventListener("change", handleUsersCsvUpload);
  $("#seedVolunteerUsers").addEventListener("click", seedVolunteerUsersFromPopulation);
  $("#screeningForm").addEventListener("submit", handleScreeningSubmit);
  $("#exportCsv").addEventListener("click", exportRecords);
  $("#syncSettingsBtn").addEventListener("click", () => $("#settingsDialog").showModal());
  $("#saveSettings").addEventListener("click", () => {
    settings = {
      sheetId: $("#sheetId").value.trim() || DEFAULT_SHEET_ID,
      webAppUrl: $("#webAppUrl").value.trim(),
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    showToast("บันทึกการตั้งค่าแล้ว", "success");
  });
}

function setupLogoFallbacks() {
  document.querySelectorAll(".logo-frame img").forEach((image) => {
    image.addEventListener("error", () => {
      image.closest(".logo-frame")?.classList.add("image-error");
    }, { once: true });
    image.addEventListener("load", () => {
      image.closest(".logo-frame")?.classList.remove("image-error");
    });
  });
}

async function bootstrapUsers() {
  if (users.length) return;
  users = [{
    id: createId(),
    username: "admin",
    passwordHash: await hashPassword("123456"),
    fullName: "ผู้ดูแลระบบตำบลคำใหญ่",
    role: "admin",
    status: "active",
    volunteerName: "",
    createdAt: new Date().toISOString(),
    approvedAt: new Date().toISOString(),
    mustChangePassword: true,
  }];
  saveUsers();
}

async function restoreSession() {
  currentUser = users.find((user) => user.id === session?.userId && user.status === "active") || null;
  if (currentUser) {
    showApp();
  } else {
    localStorage.removeItem(SESSION_KEY);
    showAuth();
  }
}

function showAuth() {
  $("#authScreen").classList.remove("hidden");
  $("#appShell").classList.add("hidden");
}

function showApp() {
  $("#authScreen").classList.add("hidden");
  $("#appShell").classList.remove("hidden");
  $("#currentUserChip").textContent = `${currentUser.fullName} (${roleLabel(currentUser.role)})`;
  $("#screenerInput").value = currentUser.fullName;
  document.body.classList.toggle("is-admin", currentUser.role === "admin");
  if (currentUser.mustChangePassword) {
    setTimeout(() => {
      $("#passwordDialog").showModal();
      showToast("กรุณาเปลี่ยนรหัสผ่านเริ่มต้นก่อนใช้งานต่อ", "warning");
    }, 300);
  }
  renderAll();
}

function switchAuthTab(tabId) {
  $$(".auth-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.authTab === tabId));
  $$(".auth-form").forEach((form) => form.classList.toggle("active", form.id === `${tabId}Form`));
}

async function handleLogin(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const username = cleanUsername(form.get("username"));
  const passwordHash = await hashPassword(form.get("password"));
  const user = users.find((item) => item.username === username);
  if (!user || user.passwordHash !== passwordHash) {
    showToast("Username หรือ Password ไม่ถูกต้อง", "error");
    return;
  }
  if (user.status !== "active") {
    showToast(user.status === "pending" ? "บัญชีนี้รอผู้ดูแลอนุมัติ" : "บัญชีนี้ถูกระงับการใช้งาน", "warning");
    return;
  }
  session = { userId: user.id, loggedInAt: new Date().toISOString() };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  currentUser = user;
  event.currentTarget.reset();
  showApp();
}

async function handleRegister(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const username = cleanUsername(form.get("username"));
  const password = String(form.get("password") || "");
  const confirmPassword = String(form.get("confirmPassword") || "");
  if (password !== confirmPassword) {
    showToast("ยืนยันรหัสผ่านไม่ตรงกัน", "error");
    return;
  }
  if (users.some((user) => user.username === username)) {
    showToast("Username นี้มีอยู่แล้ว", "error");
    return;
  }
  users.push({
    id: createId(),
    username,
    passwordHash: await hashPassword(password),
    fullName: String(form.get("fullName") || "").trim(),
    role: form.get("role"),
    status: "pending",
    volunteerName: "",
    createdAt: new Date().toISOString(),
    approvedAt: "",
    mustChangePassword: false,
  });
  saveUsers();
  event.currentTarget.reset();
  switchAuthTab("login");
  showToast("ส่งคำขอสมัครแล้ว กรุณารอผู้ดูแลอนุมัติ", "success");
}

async function handleChangePassword(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const oldPasswordHash = await hashPassword(form.get("oldPassword"));
  const newPassword = String(form.get("newPassword") || "");
  const confirmPassword = String(form.get("confirmPassword") || "");
  if (currentUser.passwordHash !== oldPasswordHash) {
    showToast("รหัสผ่านเดิมไม่ถูกต้อง", "error");
    return;
  }
  if (newPassword !== confirmPassword) {
    showToast("ยืนยันรหัสผ่านใหม่ไม่ตรงกัน", "error");
    return;
  }
  updateUser(currentUser.id, {
    passwordHash: await hashPassword(newPassword),
    mustChangePassword: false,
    passwordChangedAt: new Date().toISOString(),
  });
  currentUser = users.find((user) => user.id === currentUser.id);
  event.currentTarget.reset();
  $("#passwordDialog").close();
  showToast("เปลี่ยนรหัสผ่านแล้ว", "success");
}

async function confirmLogout() {
  const confirmed = await sweetConfirm({
    title: "ออกจากระบบ?",
    message: "ข้อมูลที่บันทึกไว้ในเครื่องจะยังอยู่ แต่ต้องเข้าสู่ระบบใหม่เพื่อใช้งานต่อ",
    type: "warning",
    confirmText: "ออกจากระบบ",
    cancelText: "ยกเลิก",
  });
  if (!confirmed) return;
  logout();
}

function logout() {
  currentUser = null;
  session = null;
  localStorage.removeItem(SESSION_KEY);
  showAuth();
}

function switchView(viewId) {
  if (viewId === "accounts" && currentUser?.role !== "admin") return;
  $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === viewId));
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
}

async function loadBundledPopulation({ silent }) {
  try {
    const response = await fetch("data/population-35-plus.csv");
    const text = await response.text();
    population = parseCsv(text).map(normalizePerson).filter((person) => person.id || person.fullName);
    savePopulation();
    renderAll();
    if (!silent) showToast(`โหลดรายชื่อกลุ่มเป้าหมาย ${population.length.toLocaleString("th-TH")} คนแล้ว`, "success");
  } catch (error) {
    if (!silent) showToast("โหลดไฟล์แนบไม่สำเร็จ กรุณาเปิดผ่าน local server หรืออัปโหลด CSV เอง", "error");
  }
}

function handleCsvUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    population = parseCsv(String(reader.result)).map(normalizePerson).filter((person) => person.id || person.fullName);
    savePopulation();
    renderAll();
    showToast(`นำเข้า CSV ${population.length.toLocaleString("th-TH")} คนแล้ว`, "success");
  };
  reader.readAsText(file, "utf-8");
}

async function handleUsersCsvUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const rows = parseCsv(String(reader.result));
    let imported = 0;
    for (const row of rows) {
      const username = cleanUsername(row.username || row.Username || row["username"]);
      const password = row.password || row.Password || row["password"];
      if (!username || !password) continue;
      const user = {
        id: createId(),
        username,
        passwordHash: await hashPassword(password),
        fullName: row.fullName || row["ชื่อ-สกุล"] || row["ชื่อ"] || username,
        role: row.role || row["บทบาท"] || "volunteer",
        status: row.status || row["สถานะ"] || "active",
        volunteerName: row.volunteerName || row["อสม."] || row["อสม.ที่รับผิดชอบ"] || "",
        createdAt: new Date().toISOString(),
        approvedAt: new Date().toISOString(),
        mustChangePassword: true,
      };
      const existing = users.find((item) => item.username === username);
      if (existing) Object.assign(existing, user, { id: existing.id });
      else users.push(user);
      imported += 1;
    }
    saveUsers();
    renderUsers();
    showToast(`นำเข้าบัญชีผู้ใช้ ${imported.toLocaleString("th-TH")} รายการแล้ว`, "success");
  };
  reader.readAsText(file, "utf-8");
}

async function seedVolunteerUsersFromPopulation() {
  const names = [...new Set(population.map((person) => person.volunteer).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th"));
  let created = 0;
  for (const [index, name] of names.entries()) {
    if (users.some((user) => user.volunteerName === name || user.fullName === name)) continue;
    const username = `v${String(index + 1).padStart(3, "0")}`;
    users.push({
      id: createId(),
      username,
      passwordHash: await hashPassword("123456"),
      fullName: name,
      role: "volunteer",
      status: "active",
      volunteerName: name,
      createdAt: new Date().toISOString(),
      approvedAt: new Date().toISOString(),
      mustChangePassword: true,
    });
    created += 1;
  }
  saveUsers();
  renderUsers();
  showToast(`สร้างบัญชี อสม. ใหม่ ${created.toLocaleString("th-TH")} บัญชีแล้ว`, "success");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const clean = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];
    const next = clean[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value !== "")) rows.push(row);
  const headers = rows.shift()?.map((header) => header.trim()) || [];
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

function normalizePerson(row) {
  const firstName = row["ชื่อ"] || row.firstName || "";
  const lastName = row["นามสกุล"] || row.lastName || "";
  return {
    order: row["ลำดับ"] || "",
    id: row["เลขบัตรประชาชน"] || row.id || "",
    prefix: row["คำนำหน้า"] || "",
    firstName,
    lastName,
    fullName: `${row["คำนำหน้า"] || ""}${firstName} ${lastName}`.trim(),
    gender: row["เพศ"] || "",
    age: Number(row["อายุ"] || 0),
    birthDate: row["วันเกิด"] || "",
    disease: row["โรคประจำตัว"] || "",
    village: row["หมู่บ้าน"] || "",
    houseNo: row["บ้านเลขที่"] || "",
    area: row["เขตพื้นที่"] || "",
    volunteer: row["อสม.ที่รับผิดชอบ"] || "",
    verifyStatus: row["สถานะตรวจสอบ"] || "",
  };
}

function renderAll() {
  if (!currentUser) return;
  renderPeople();
  renderPopulationTable();
  renderDashboard();
  renderUsers();
  $("#populationCount").textContent = `${population.length.toLocaleString("th-TH")} คน`;
  const villages = new Set(population.map((p) => p.village).filter(Boolean));
  const volunteers = new Set(population.map((p) => p.volunteer).filter(Boolean));
  $("#villageStat").textContent = `${villages.size.toLocaleString("th-TH")} หมู่บ้าน`;
  $("#volunteerStat").textContent = `${volunteers.size.toLocaleString("th-TH")} อสม.`;
  $("#screenedStat").textContent = `${new Set(records.map((r) => r.personId).filter(Boolean)).size.toLocaleString("th-TH")} คัดกรองแล้ว`;
}

function visiblePopulation() {
  if (currentUser?.role === "volunteer" && currentUser.volunteerName) {
    return population.filter((person) => person.volunteer === currentUser.volunteerName);
  }
  return population;
}

function filterPeople() {
  const query = $("#personSearch").value.trim().toLowerCase();
  const source = visiblePopulation();
  if (!query) return source.slice(0, 80);
  return source
    .filter((person) => [person.id, person.fullName, person.village, person.houseNo, person.volunteer].join(" ").toLowerCase().includes(query))
    .slice(0, 120);
}

function renderPeople() {
  const list = $("#personList");
  const people = filterPeople();
  list.innerHTML = people.map((person) => {
    const active = selectedPerson?.id === person.id ? " active" : "";
    return `<button class="person-card${active}" type="button" data-id="${escapeHtml(person.id)}">
      <strong>${escapeHtml(person.fullName || "ไม่ระบุชื่อ")} <small>${person.age || "-"} ปี</small></strong>
      <span>${escapeHtml(person.village)} บ้านเลขที่ ${escapeHtml(person.houseNo || "-")}</span>
      <span>อสม. ${escapeHtml(person.volunteer || "-")} | ${escapeHtml(person.disease || "ไม่มีโรคประจำตัว")}</span>
    </button>`;
  }).join("") || `<p class="muted">ไม่พบรายชื่อ</p>`;
  list.querySelectorAll(".person-card").forEach((button) => button.addEventListener("click", () => selectPerson(button.dataset.id)));
}

function selectPerson(id) {
  selectedPerson = visiblePopulation().find((person) => person.id === id) || null;
  if (!selectedPerson) return;
  $("#selectedPerson").innerHTML = `<strong>${escapeHtml(selectedPerson.fullName)} อายุ ${selectedPerson.age || "-"} ปี</strong>
    <span>${escapeHtml(selectedPerson.village)} บ้านเลขที่ ${escapeHtml(selectedPerson.houseNo || "-")} | อสม. ${escapeHtml(selectedPerson.volunteer || "-")}</span>
    <span>โรคประจำตัว: ${escapeHtml(selectedPerson.disease || "ไม่มีข้อมูล")}</span>`;
  const history = $("[name='history']");
  if (!history.value && selectedPerson.disease && selectedPerson.disease !== "ไม่มี") {
    history.value = `โรคประจำตัวเดิม: ${selectedPerson.disease}`;
  }
  renderPeople();
}

function renderPopulationTable() {
  const statusById = new Set(records.map((record) => record.personId));
  $("#populationTable").innerHTML = visiblePopulation().slice(0, 300).map((person) => `<tr>
    <td>${escapeHtml(person.fullName)}</td>
    <td>${person.age || "-"}</td>
    <td>${escapeHtml(person.village)}</td>
    <td>${escapeHtml(person.houseNo)}</td>
    <td>${escapeHtml(person.volunteer)}</td>
    <td>${statusById.has(person.id) ? "คัดกรองแล้ว" : escapeHtml(person.verifyStatus || "รอคัดกรอง")}</td>
  </tr>`).join("");
}

function renderUsers() {
  if (currentUser?.role !== "admin") return;
  $("#pendingUserStat").textContent = `${users.filter((u) => u.status === "pending").length.toLocaleString("th-TH")} รออนุมัติ`;
  $("#activeUserStat").textContent = `${users.filter((u) => u.status === "active").length.toLocaleString("th-TH")} ใช้งานได้`;
  $("#volunteerUserStat").textContent = `${users.filter((u) => u.role === "volunteer").length.toLocaleString("th-TH")} อสม.`;
  $("#usersTable").innerHTML = users.map((user) => `<tr>
    <td>${escapeHtml(user.fullName)}</td>
    <td><code>${escapeHtml(user.username)}</code></td>
    <td>${roleLabel(user.role)}</td>
    <td>${statusLabel(user.status)}${user.mustChangePassword ? " / ต้องเปลี่ยนรหัส" : ""}</td>
    <td>${escapeHtml(user.volunteerName || "-")}</td>
    <td>
      <div class="row-actions">
        ${user.status !== "active" ? `<button class="mini-button" data-user-action="approve" data-id="${user.id}" type="button">อนุมัติ</button>` : ""}
        ${user.status !== "suspended" && user.role !== "admin" ? `<button class="mini-button" data-user-action="suspend" data-id="${user.id}" type="button">ระงับ</button>` : ""}
        ${user.status === "suspended" ? `<button class="mini-button" data-user-action="approve" data-id="${user.id}" type="button">เปิดใช้</button>` : ""}
        <button class="mini-button" data-user-action="reset" data-id="${user.id}" type="button">รีเซ็ตรหัส</button>
      </div>
    </td>
  </tr>`).join("");
  $("#usersTable").querySelectorAll("[data-user-action]").forEach((button) => {
    button.addEventListener("click", () => handleUserAction(button.dataset.userAction, button.dataset.id));
  });
}

async function handleUserAction(action, id) {
  const user = users.find((item) => item.id === id);
  const confirmText = action === "reset" ? "รีเซ็ตรหัส" : action === "suspend" ? "ระงับบัญชี" : "อนุมัติ";
  const message = action === "reset"
    ? `ตั้งรหัสผ่านของ ${user?.fullName || "ผู้ใช้งาน"} กลับเป็น 123456`
    : action === "suspend"
      ? `ระงับการเข้าใช้งานของ ${user?.fullName || "ผู้ใช้งาน"}`
      : `เปิดใช้งานบัญชีของ ${user?.fullName || "ผู้ใช้งาน"}`;
  const confirmed = await sweetConfirm({
    title: `${confirmText}?`,
    message,
    type: action === "suspend" ? "warning" : "info",
    confirmText,
    cancelText: "ยกเลิก",
  });
  if (!confirmed) return;
  if (action === "approve") updateUser(id, { status: "active", approvedAt: new Date().toISOString() });
  if (action === "suspend") updateUser(id, { status: "suspended" });
  if (action === "reset") updateUser(id, { passwordHash: await hashPassword("123456"), mustChangePassword: true });
  renderUsers();
  showToast(action === "reset" ? "รีเซ็ตรหัสผ่านเป็น 123456 แล้ว" : "อัปเดตสถานะผู้ใช้งานแล้ว", "success");
}

function handleScreeningSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const values = Object.fromEntries(form.entries());
  const metrics = prepareMetrics(values);
  const analysis = analyzeHealth(metrics, selectedPerson);
  const record = {
    recordId: createId(),
    createdAt: new Date().toISOString(),
    createdByUserId: currentUser.id,
    createdByName: currentUser.fullName,
    personId: selectedPerson?.id || "",
    fullName: selectedPerson?.fullName || "ไม่ระบุชื่อ",
    age: selectedPerson?.age || "",
    gender: selectedPerson?.gender || "",
    village: selectedPerson?.village || "",
    houseNo: selectedPerson?.houseNo || "",
    volunteer: selectedPerson?.volunteer || currentUser.volunteerName || "",
    disease: selectedPerson?.disease || "",
    ...values,
    ...metrics,
    riskLevel: analysis.level,
    riskLabel: analysis.label,
    flags: analysis.flags.join(" | "),
    advice: analysis.advice.join(" | "),
    followUp: analysis.followUp,
  };
  records.unshift(record);
  saveRecords();
  renderResult(analysis, metrics);
  renderAll();
  postToSheet(record);
  event.currentTarget.reset();
  $("[name='screeningDate']").valueAsDate = new Date();
  $("#screenerInput").value = currentUser.fullName;
}

function prepareMetrics(values) {
  const weight = Number(values.weight || 0);
  const height = Number(values.height || 0);
  const heightM = height / 100;
  const bmi = weight && height ? weight / (heightM * heightM) : 0;
  return {
    weight,
    height,
    bmi: bmi ? Number(bmi.toFixed(1)) : "",
    waist: Number(values.waist || 0) || "",
    sbp: Number(values.sbp || 0),
    dbp: Number(values.dbp || 0),
    pulse: Number(values.pulse || 0) || "",
    glucose: Number(values.glucose || 0) || "",
    cholesterol: Number(values.cholesterol || 0) || "",
    phq2: Number(values.phq2 || 0) || "",
  };
}

function analyzeHealth(metrics, person) {
  const flags = [];
  const advice = [];
  let score = 0;
  let urgent = false;

  if (metrics.bmi) {
    if (metrics.bmi >= 30) addRisk("BMI อยู่ในเกณฑ์อ้วนระดับสูง", 2);
    else if (metrics.bmi >= 25) addRisk("BMI อยู่ในเกณฑ์อ้วน", 2);
    else if (metrics.bmi >= 23) addRisk("BMI เริ่มเกินเกณฑ์เอเชีย", 1);
    else if (metrics.bmi < 18.5) addRisk("BMI ต่ำกว่าเกณฑ์", 1);
  }

  if (metrics.waist) {
    const waistLimit = person?.gender === "ชาย" ? 90 : 80;
    if (metrics.waist >= waistLimit) addRisk("รอบเอวเกินเกณฑ์", 1);
  }

  if (metrics.sbp >= 180 || metrics.dbp >= 110) {
    addRisk("ความดันสูงมาก ควรส่งต่อทันที", 3);
    urgent = true;
  } else if (metrics.sbp >= 140 || metrics.dbp >= 90) {
    addRisk("ความดันโลหิตสูง", 2);
  } else if (metrics.sbp >= 120 || metrics.dbp >= 80) {
    addRisk("ความดันเริ่มสูง", 1);
  }

  if (metrics.glucose) {
    if (metrics.glucose >= 126) addRisk("น้ำตาลอยู่ในเกณฑ์สงสัยเบาหวาน", 2);
    else if (metrics.glucose >= 100) addRisk("น้ำตาลเริ่มสูง", 1);
  }

  if (metrics.cholesterol) {
    if (metrics.cholesterol >= 240) addRisk("ไขมันรวมสูง", 2);
    else if (metrics.cholesterol >= 200) addRisk("ไขมันรวมเริ่มสูง", 1);
  }

  const form = new FormData($("#screeningForm"));
  if (form.get("smoking") === "สูบปัจจุบัน") addRisk("สูบบุหรี่ปัจจุบัน", 1);
  if (form.get("alcohol") === "ดื่มประจำ") addRisk("ดื่มแอลกอฮอล์ประจำ", 1);
  if (form.get("salt") === "สูง") addRisk("บริโภคเค็มสูง", 1);
  if (metrics.phq2 >= 3) addRisk("คัดกรองซึมเศร้า PHQ-2 เป็นบวก", 2);

  if (flags.length === 0) {
    advice.push("รักษาพฤติกรรมสุขภาพเดิม ออกกำลังกายสม่ำเสมอ กินผักผลไม้ และตรวจติดตามตามรอบนัด");
  } else {
    advice.push("ลดหวาน มัน เค็ม เพิ่มผัก และออกกำลังกายอย่างน้อย 150 นาทีต่อสัปดาห์");
    advice.push("วัดความดันซ้ำหลังพัก 5 นาที และบันทึกค่าไว้เพื่อติดตามแนวโน้ม");
  }
  if (metrics.bmi >= 23 || metrics.waist) advice.push("ตั้งเป้าลดรอบเอวทีละน้อย โดยชั่งน้ำหนักและวัดรอบเอวเดือนละครั้ง");
  if (metrics.glucose >= 100) advice.push("ควรตรวจน้ำตาลซ้ำแบบอดอาหาร และรับคำแนะนำจาก รพ.สต.");
  if (metrics.phq2 >= 3) advice.push("ควรประเมิน 9Q ต่อ และให้ อสม./เจ้าหน้าที่ติดตามภาวะอารมณ์");

  const level = urgent || score >= 4 ? "high" : score >= 1 ? "risk" : "normal";
  const label = level === "high" ? "กลุ่มเสี่ยงสูง/ควรส่งต่อ" : level === "risk" ? "กลุ่มเสี่ยง" : "กลุ่มปกติ";
  const followUp = level === "high" ? "ส่งต่อ รพ.สต./หน่วยบริการภายใน 24-72 ชั่วโมง หรือตามความเร่งด่วนของอาการ" : level === "risk" ? "นัดติดตามภายใน 1-3 เดือน" : "ติดตามตามรอบคัดกรองประจำปี";
  return { level, label, flags, advice, followUp };

  function addRisk(message, weight) {
    flags.push(message);
    score += weight;
  }
}

function renderResult(analysis, metrics) {
  $("#resultBox").className = `result-box ${analysis.level}`;
  $("#resultBox").innerHTML = `<div>
    <p class="eyebrow">AI Health Brief</p>
    <h2>${analysis.label}</h2>
    <p>BMI ${metrics.bmi || "-"} | ความดัน ${metrics.sbp}/${metrics.dbp} mmHg | นัดติดตาม: ${analysis.followUp}</p>
    <strong>ประเด็นที่พบ</strong>
    <ul>${(analysis.flags.length ? analysis.flags : ["ยังไม่พบค่าผิดปกติจากข้อมูลที่กรอก"]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    <strong>คำแนะนำรายบุคคล</strong>
    <ul>${analysis.advice.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
  </div>`;
}

async function postToSheet(record) {
  if (!settings.webAppUrl) {
    showToast("บันทึกในเครื่องแล้ว หากต้องการส่งเข้า Google Sheet ให้ตั้งค่า Web App URL", "info");
    return;
  }
  try {
    await fetch(settings.webAppUrl, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ sheetId: settings.sheetId || DEFAULT_SHEET_ID, record }),
    });
    showToast("บันทึกในเครื่องและส่งไป Google Sheet แล้ว", "success");
  } catch (error) {
    showToast("บันทึกในเครื่องแล้ว แต่ส่ง Google Sheet ไม่สำเร็จ", "error");
  }
}

function renderDashboard() {
  const visibleRecords = currentUser?.role === "volunteer" && currentUser.volunteerName
    ? records.filter((record) => record.volunteer === currentUser.volunteerName || record.createdByUserId === currentUser.id)
    : records;
  $("#totalRecords").textContent = visibleRecords.length.toLocaleString("th-TH");
  $("#normalRecords").textContent = visibleRecords.filter((r) => r.riskLevel === "normal").length.toLocaleString("th-TH");
  $("#riskRecords").textContent = visibleRecords.filter((r) => r.riskLevel === "risk").length.toLocaleString("th-TH");
  $("#highRecords").textContent = visibleRecords.filter((r) => r.riskLevel === "high").length.toLocaleString("th-TH");
  $("#reportList").innerHTML = visibleRecords.slice(0, 40).map((record) => `<article class="report-item ${record.riskLevel}">
    <strong>${escapeHtml(record.fullName)} - ${escapeHtml(record.riskLabel)}</strong>
    <span>${new Date(record.createdAt).toLocaleString("th-TH")} | ${escapeHtml(record.village)} บ้านเลขที่ ${escapeHtml(record.houseNo)} | ผู้บันทึก ${escapeHtml(record.createdByName || "-")}</span>
    <span>BMI ${record.bmi || "-"} | BP ${record.sbp}/${record.dbp} | ${escapeHtml(record.flags || "ไม่พบความเสี่ยง")}</span>
  </article>`).join("") || `<p class="muted">ยังไม่มีข้อมูลคัดกรอง</p>`;
}

function exportRecords() {
  if (!records.length) {
    showToast("ยังไม่มีข้อมูลสำหรับส่งออก", "warning");
    return;
  }
  const headers = Object.keys(records[0]);
  const csv = [headers.join(","), ...records.map((record) => headers.map((header) => csvCell(record[header])).join(","))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ncd-screening-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function hashPassword(password) {
  if (!globalThis.crypto?.subtle) {
    return `fallback:${fallbackHash(String(password))}`;
  }
  const bytes = new TextEncoder().encode(String(password));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fallbackHash(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function updateUser(id, patch) {
  users = users.map((user) => user.id === id ? { ...user, ...patch } : user);
  saveUsers();
}

function saveUsers() {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function savePopulation() {
  localStorage.setItem(POPULATION_KEY, JSON.stringify(population));
}

function saveRecords() {
  localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
}

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function cleanUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function roleLabel(role) {
  return ({ admin: "ผู้ดูแล", volunteer: "อสม.", public: "ประชาชน" })[role] || role;
}

function statusLabel(status) {
  return ({ active: "ใช้งานได้", pending: "รออนุมัติ", suspended: "ระงับ" })[status] || status;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function showToast(message, type = "success") {
  sweetAlert({
    title: alertTitle(type),
    message,
    type,
    autoClose: type === "success" || type === "info" ? 2100 : 0,
    confirmText: "ตกลง",
  });
}

function sweetAlert({ title, message, type = "info", autoClose = 0, confirmText = "ตกลง" }) {
  return createSweetDialog({ title, message, type, confirmText, autoClose, showCancel: false });
}

function sweetConfirm({ title, message, type = "warning", confirmText = "ตกลง", cancelText = "ยกเลิก" }) {
  return createSweetDialog({ title, message, type, confirmText, cancelText, showCancel: true });
}

function createSweetDialog(options) {
  removeSweetDialog();
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "sweet-overlay";
    overlay.innerHTML = `
      <section class="sweet-card" role="alertdialog" aria-modal="true" aria-labelledby="sweetTitle" aria-describedby="sweetMessage">
        <div class="sweet-icon ${options.type}">${sweetIcon(options.type)}</div>
        <h2 class="sweet-title" id="sweetTitle">${escapeHtml(options.title)}</h2>
        <p class="sweet-message" id="sweetMessage">${escapeHtml(options.message)}</p>
        <div class="sweet-actions">
          ${options.showCancel ? `<button class="ghost-button" data-sweet="cancel" type="button">${escapeHtml(options.cancelText)}</button>` : ""}
          <button class="${options.type === "warning" ? "danger-button" : "primary-button"}" data-sweet="confirm" type="button">${escapeHtml(options.confirmText)}</button>
        </div>
      </section>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("show"));

    const close = (result) => {
      document.removeEventListener("keydown", onKeyDown);
      overlay.classList.remove("show");
      setTimeout(() => overlay.remove(), 180);
      resolve(result);
    };

    overlay.querySelector("[data-sweet='confirm']").addEventListener("click", () => close(true));
    overlay.querySelector("[data-sweet='cancel']")?.addEventListener("click", () => close(false));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay && options.showCancel) close(false);
    });
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        close(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    if (options.autoClose) {
      setTimeout(() => close(true), options.autoClose);
    }
  });
}

function removeSweetDialog() {
  document.querySelector(".sweet-overlay")?.remove();
}

function sweetIcon(type) {
  return ({ success: "✓", error: "!", warning: "!", info: "i" })[type] || "i";
}

function alertTitle(type) {
  return ({ success: "สำเร็จ", error: "ไม่สำเร็จ", warning: "โปรดตรวจสอบ", info: "แจ้งเตือน" })[type] || "แจ้งเตือน";
}

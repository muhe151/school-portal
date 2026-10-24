require("dotenv").config();
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const bcrypt = require("bcryptjs");
const PDFDocument = require("pdfkit");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const db = require("./database");

const app = express();
const PORT = process.env.PORT || 3000;

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(uploadsDir));

app.use(session({
  store: new SQLiteStore({ db: "sessions.db", dir: __dirname }),
  secret: process.env.SESSION_SECRET || "devsecret",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 12 }
}));

// ========== MIDDLEWARE ==========
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Not authenticated" });
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user || !roles.includes(req.session.user.role))
      return res.status(403).json({ error: "Access denied" });
    next();
  };
}

// ========== AUTH ==========
app.post("/api/login", (req, res) => {
  const { ugr, password } = req.body;
  if (!ugr || !password) return res.status(400).json({ error: "Missing credentials" });
  db.get(`SELECT * FROM users WHERE ugr = ?`, [ugr], (err, user) => {
    if (err || !user) return res.status(401).json({ error: "Invalid ID or password" });
    if (!bcrypt.compareSync(password, user.password))
      return res.status(401).json({ error: "Invalid ID or password" });
    req.session.user = {
      id: user.id, ugr: user.ugr, name: user.name, role: user.role,
      grade: user.grade, department: user.department, photo: user.photo
    };
    res.json({ success: true, user: req.session.user });
  });
});
// ========== FORGOT PASSWORD ==========
app.post("/api/forgot-password", (req, res) => {
  const { ugr, guardian_phone, new_password } = req.body;
  
  if (!ugr || !guardian_phone || !new_password) {
    return res.status(400).json({ error: "UGR, Guardian Phone, and New Password are required." });
  }

  // Find the student and check if the guardian phone matches
  db.get(`SELECT * FROM users WHERE ugr = ? AND role = 'student'`, [ugr], (err, user) => {
    if (err || !user) {
      return res.status(404).json({ error: "Student with this UGR not found." });
    }
    
    // Normalize phone numbers (remove spaces, dashes, etc.) for comparison
    const cleanInput = guardian_phone.replace(/\D/g, "");
    const cleanDbPhone = (user.guardian_phone || "").replace(/\D/g, "");

    if (!cleanDbPhone || cleanInput !== cleanDbPhone) {
      return res.status(401).json({ error: "Guardian phone number does not match our records." });
    }

    // Hash the new password and update
    const hash = bcrypt.hashSync(new_password, 10);
    db.run(`UPDATE users SET password = ? WHERE id = ?`, [hash, user.id], function (err2) {
      if (err2) return res.status(500).json({ error: "Failed to update password." });
      res.json({ success: true, message: "Password reset successfully. You can now log in." });
    });
  });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get("/api/me", requireAuth, (req, res) => {
  db.get(`SELECT id, ugr, name, email, role, grade, department, phone, address, photo,
                  previous_school, birth_place, birth_date, father_name, mother_name,
                  guardian_phone, documents, registered_by_admin, registration_complete,
                  year_of_study, account_id, created_at
          FROM users WHERE id = ?`, [req.session.user.id], (err, user) => {
    if (err || !user) return res.status(404).json({ error: "Not found" });
    res.json(user);
  });
});

// Check if UGR is pre-registered by admin
app.get("/api/check-prereg/:ugr", (req, res) => {
  db.get(`SELECT ugr, name, grade FROM users WHERE ugr = ? AND role='student' AND registered_by_admin = 1`,
    [req.params.ugr], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ found: !!row, student: row || null });
    });
});

// Student self-registration — must match pre-registered UGR
app.post("/api/register", upload.fields([
  { name: "photo", maxCount: 1 },
  { name: "transcript", maxCount: 1 },
  { name: "certificate", maxCount: 1 },
  { name: "receipt", maxCount: 1 }
]), (req, res) => {
  db.get(`SELECT value FROM settings WHERE key = 'self_registration_open'`, (err, row) => {
    if (!row || row.value !== "1")
      return res.status(403).json({ error: "Registration is currently closed." });

    const { ugr, name, email, password, grade, phone, address,
            previous_school, birth_place, birth_date, father_name, mother_name,
            guardian_phone, account_id, payment_amount } = req.body;

    if (!ugr || !name || !password)
      return res.status(400).json({ error: "UGR, name, password required" });

    // Check pre-registration
    db.get(`SELECT * FROM users WHERE ugr = ? AND role='student'`, [ugr], (e, existing) => {
      if (!existing)
        return res.status(403).json({ error: "This UGR was not pre-registered by admin. Contact office." });
      if (existing.registration_complete === 1)
        return res.status(400).json({ error: "This UGR is already registered. Please log in." });

      const hash = bcrypt.hashSync(password, 10);
      const files = req.files || {};
      const photo = files.photo ? `/uploads/${files.photo[0].filename}` : null;
      const transcript = files.transcript ? `/uploads/${files.transcript[0].filename}` : null;
      const certificate = files.certificate ? `/uploads/${files.certificate[0].filename}` : null;
      const receipt = files.receipt ? `/uploads/${files.receipt[0].filename}` : null;
      const documents = JSON.stringify({ transcript, certificate });

      db.run(`UPDATE users SET
              name = ?, email = COALESCE(?, email), password = ?, grade = COALESCE(?, grade),
              phone = ?, address = ?, previous_school = ?, birth_place = ?, birth_date = ?,
              father_name = ?, mother_name = ?, guardian_phone = ?, documents = ?,
              photo = ?, registration_complete = 1, account_id = ?,
              year_of_study = strftime('%Y', 'now')
              WHERE ugr = ?`,
        [name, email || null, hash, grade || null, phone || null, address || null,
         previous_school || null, birth_place || null, birth_date || null,
         father_name || null, mother_name || null, guardian_phone || null, documents,
         photo, account_id ? Number(account_id) : null, ugr],
        function (err2) {
          if (err2) return res.status(500).json({ error: err2.message });

          // Create payment record if amount provided
          if (payment_amount && receipt) {
            db.run(`INSERT INTO payments (student_ugr, amount, account_id, receipt_url, status)
                    VALUES (?,?,?,?, 'pending')`,
              [ugr, Number(payment_amount), account_id ? Number(account_id) : null, receipt],
              (e3) => { /* ignore */ });
          }
          res.json({ success: true, message: "Registration complete. Please log in." });
        });
    });
  });
});

app.get("/api/registration-status", (req, res) => {
  db.get(`SELECT value FROM settings WHERE key = 'self_registration_open'`, (err, row) => {
    res.json({ open: row && row.value === "1" });
  });
});

app.get("/api/accounts", (req, res) => {
  db.all(`SELECT * FROM accounts ORDER BY bank_name`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// ========== PUBLIC ==========
app.get("/api/news", (req, res) => {
  db.all(`SELECT id, title, content, author, created_at FROM news ORDER BY created_at DESC`,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
});

app.get("/api/about", (req, res) => {
  db.get(`SELECT * FROM about_school WHERE id = 1`, (err, row) => {
    res.json(row || {});
  });
});

app.get("/api/schedules", requireAuth, (req, res) => {
  const grade = req.session.user.grade || "Grade 10";
  db.all(`SELECT * FROM schedules WHERE grade = ? ORDER BY year DESC, semester, day_of_week, start_time`,
    [grade], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
});

// ========== ADMIN ==========
app.get("/api/admin/stats", requireRole("admin"), (req, res) => {
  const queries = {
  students: `SELECT COUNT(*) AS c FROM users WHERE role='student'`,
  pendingStudents: `SELECT COUNT(*) AS c FROM users WHERE role='student' AND status='pending'`,
    teachers: `SELECT COUNT(*) AS c FROM users WHERE role='teacher'`,
    courses: `SELECT COUNT(*) AS c FROM courses`,
    pendingPayments: `SELECT COUNT(*) AS c FROM payments WHERE status='pending'`,
    pendingMarks: `SELECT COUNT(*) AS c FROM assessments WHERE status='pending_admin'`,
    pendingRegistrar: `SELECT COUNT(*) AS c FROM assessments WHERE status='pending_registrar'`,
    complaints: `SELECT COUNT(*) AS c FROM complaints WHERE status='open'`
  };
  const out = {};
  let pending = Object.keys(queries).length;
  Object.entries(queries).forEach(([k, q]) => {
    db.get(q, (e, r) => { out[k] = r ? r.c : 0; if (--pending === 0) res.json(out); });
  });
});

app.get("/api/admin/users", requireRole("admin"), (req, res) => {
  const role = req.query.role;
  const q = role
    ? `SELECT * FROM users WHERE role = ? ORDER BY ugr`
    : `SELECT * FROM users ORDER BY role, ugr`;
  db.all(q, role ? [role] : [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Pre-register student (admin sets up initial UGR)
app.post("/api/admin/pre-register", requireRole("admin"), upload.single("photo"), (req, res) => {
  const { ugr, name, grade } = req.body;
  if (!ugr || !name || !grade)
    return res.status(400).json({ error: "UGR, name, grade required" });
  if (!/^UGR\/\d{4}\/\d{3,}$/i.test(ugr))
    return res.status(400).json({ error: "UGR must look like UGR/2024/004" });
  const tempPw = bcrypt.hashSync("temp" + Date.now(), 10);
  db.run(`INSERT INTO users (ugr, name, role, grade, password, registered_by_admin, registration_complete)
          VALUES (?,?, 'student', ?, ?, 1, 0)`,
    [ugr, name, grade, tempPw], function (err) {
      if (err) {
        if (err.message.includes("UNIQUE"))
          return res.status(400).json({ error: "UGR already exists" });
        return res.status(500).json({ error: err.message });
      }
      res.json({ success: true, message: `Pre-registered ${ugr}. Student can now complete registration.` });
    });
});

// Add other user types (teacher, registrar, admin)
app.post("/api/admin/users", requireRole("admin"), upload.single("photo"), (req, res) => {
  const { ugr, name, email, password, role, grade, department, phone, address } = req.body;
  if (!ugr || !name || !password || !role)
    return res.status(400).json({ error: "Missing required fields" });
  if (role === "student")
    return res.status(400).json({ error: "Use /admin/pre-register for students" });
  const hash = bcrypt.hashSync(password, 10);
  const photo = req.file ? `/uploads/${req.file.filename}` : null;
  db.run(`INSERT INTO users (ugr, name, email, password, role, grade, department, phone, address, photo, registered_by_admin, registration_complete)
          VALUES (?,?,?,?,?,?,?,?,?,?, 1, 1)`,
    [ugr, name, email || null, hash, role, grade || null, department || null, phone || null, address || null, photo],
    function (err) {
      if (err) {
        if (err.message.includes("UNIQUE")) return res.status(400).json({ error: "UGR or email exists" });
        return res.status(500).json({ error: err.message });
      }
      res.json({ success: true, id: this.lastID });
    });
});

app.delete("/api/admin/users/:ugr", requireRole("admin"), (req, res) => {
  const ugr = req.params.ugr;
  db.run(`DELETE FROM assessments WHERE student_ugr = ?`, [ugr], () => {
    db.run(`DELETE FROM payments WHERE student_ugr = ?`, [ugr], () => {
      db.run(`DELETE FROM complaints WHERE student_ugr = ?`, [ugr], () => {
        db.run(`DELETE FROM users WHERE ugr = ? AND role != 'admin'`, [ugr], function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ success: true });
        });
      });
    });
  });
});

// Registration window toggle
app.post("/api/admin/toggle-registration", requireRole("admin"), (req, res) => {
  const { open } = req.body;
  db.run(`INSERT INTO settings (key, value) VALUES ('self_registration_open', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [open ? "1" : "0"], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, open: !!open });
    });
});

// Courses
app.get("/api/admin/courses", requireRole("admin"), (req, res) => {
  db.all(`SELECT * FROM courses ORDER BY grade, semester, code`, (err, rows) => {
    res.json(rows);
  });
});
app.post("/api/admin/courses", requireRole("admin"), (req, res) => {
  const { code, name, teacher_ugr, semester, grade, credits } = req.body;
  db.get(`SELECT name FROM users WHERE ugr = ? AND role = 'teacher'`, [teacher_ugr || ""], (e, t) => {
    db.run(`INSERT INTO courses (code, name, teacher_ugr, teacher_name, semester, grade, credits)
            VALUES (?,?,?,?,?,?,?)`,
      [code, name, teacher_ugr || null, t ? t.name : null, semester, grade, credits || 3],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
      });
  });
});
app.delete("/api/admin/courses/:id", requireRole("admin"), (req, res) => {
  db.run(`DELETE FROM courses WHERE id = ?`, [req.params.id], function (err) {
    res.json({ success: true });
  });
});

// Accounts (payment)
app.get("/api/admin/accounts", requireRole("admin"), (req, res) => {
  db.all(`SELECT * FROM accounts ORDER BY bank_name`, (err, rows) => {
    res.json(rows);
  });
});
app.post("/api/admin/accounts", requireRole("admin"), (req, res) => {
  const { bank_name, account_number, account_name, branch } = req.body;
  db.run(`INSERT INTO accounts (bank_name, account_number, account_name, branch) VALUES (?,?,?,?)`,
    [bank_name, account_number, account_name, branch || null], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
});
app.delete("/api/admin/accounts/:id", requireRole("admin"), (req, res) => {
  db.run(`DELETE FROM accounts WHERE id = ?`, [req.params.id], function (err) {
    res.json({ success: true });
  });
});

// Payments
app.get("/api/admin/payments", requireRole("admin"), (req, res) => {
  db.all(`SELECT p.*, u.name AS student_name,
                 a.bank_name, a.account_number
          FROM payments p
          LEFT JOIN users u ON u.ugr = p.student_ugr
          LEFT JOIN accounts a ON a.id = p.account_id
          ORDER BY p.created_at DESC`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});
app.post("/api/admin/payments/:id/approve", requireRole("admin"), (req, res) => {
  db.run(`UPDATE payments SET status='approved', approved_by=?, approved_at=CURRENT_TIMESTAMP
          WHERE id = ?`,
    [req.session.user.ugr, req.params.id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
});
app.post("/api/admin/payments/:id/reject", requireRole("admin"), (req, res) => {
  const { reason } = req.body;
  db.run(`UPDATE payments SET status='rejected', rejection_reason=?, approved_by=?, approved_at=CURRENT_TIMESTAMP
          WHERE id = ?`,
    [reason || "Not specified", req.session.user.ugr, req.params.id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
});

// Admin approval of teacher marks
app.get("/api/admin/pending-marks", requireRole("admin"), (req, res) => {
  db.all(`SELECT a.*, u.name AS student_name, t.name AS teacher_name
          FROM assessments a
          LEFT JOIN users u ON u.ugr = a.student_ugr
          LEFT JOIN users t ON t.ugr = a.teacher_ugr
          WHERE a.status = 'pending_admin'
          ORDER BY a.created_at ASC`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});
app.post("/api/admin/marks/:id/approve", requireRole("admin"), (req, res) => {
  db.run(`UPDATE assessments SET admin_approved=1, status='pending_registrar'
          WHERE id = ?`, [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});
app.post("/api/admin/marks/:id/reject", requireRole("admin"), (req, res) => {
  const { reason } = req.body;
  db.run(`UPDATE assessments SET status='rejected', rejection_reason=? WHERE id = ?`,
    [reason || "Not specified", req.params.id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
});

// Complaints
app.get("/api/admin/complaints", requireRole("admin"), (req, res) => {
  db.all(`SELECT c.*, u.name AS student_name
          FROM complaints c
          LEFT JOIN users u ON u.ugr = c.student_ugr
          ORDER BY c.created_at DESC`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});
app.post("/api/admin/complaints/:id/reply", requireRole("admin"), (req, res) => {
  const { reply, status } = req.body;
  db.run(`UPDATE complaints SET admin_reply=?, status=?, replied_at=CURRENT_TIMESTAMP
          WHERE id = ?`,
    [reply, status || "resolved", req.params.id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
});

// Schedules (admin)
app.get("/api/admin/schedules", requireRole("admin"), (req, res) => {
  db.all(`SELECT * FROM schedules ORDER BY grade, semester, day_of_week, start_time`, (err, rows) => {
    res.json(rows);
  });
});
app.post("/api/admin/schedules", requireRole("admin"), (req, res) => {
  const { course_code, course_name, day_of_week, start_time, end_time, room,
          teacher_name, semester, year, grade } = req.body;
  db.run(`INSERT INTO schedules (course_code, course_name, day_of_week, start_time, end_time, room, teacher_name, semester, year, grade)
          VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [course_code, course_name, day_of_week, start_time, end_time, room,
     teacher_name, semester, year, grade], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
});
app.delete("/api/admin/schedules/:id", requireRole("admin"), (req, res) => {
  db.run(`DELETE FROM schedules WHERE id = ?`, [req.params.id], function (err) {
    res.json({ success: true });
  });
});

// News & About
app.post("/api/admin/news", requireRole("admin"), (req, res) => {
  const { title, content } = req.body;
  db.run(`INSERT INTO news (title, content, author) VALUES (?,?,?)`,
    [title, content, req.session.user.name], function (err) {
      res.json({ success: true });
    });
});
app.delete("/api/admin/news/:id", requireRole("admin"), (req, res) => {
  db.run(`DELETE FROM news WHERE id = ?`, [req.params.id], function () {
    res.json({ success: true });
  });
});
app.put("/api/admin/about", requireRole("admin"), (req, res) => {
  const { title, history, mission, vision, image_url } = req.body;
  db.run(`UPDATE about_school SET title=?, history=?, mission=?, vision=?, image_url=? WHERE id=1`,
    [title, history, mission, vision, image_url], function () {
      res.json({ success: true });
    });
});

// ========== TEACHER ==========
app.get("/api/teacher/courses", requireRole("teacher"), (req, res) => {
  db.all(`SELECT * FROM courses WHERE teacher_ugr = ? ORDER BY semester, code`,
    [req.session.user.ugr], (err, rows) => {
      res.json(rows);
    });
});

app.get("/api/teacher/assessments", requireRole("teacher"), (req, res) => {
  db.all(`SELECT a.*, u.name AS student_name FROM assessments a
          LEFT JOIN users u ON u.ugr = a.student_ugr
          WHERE a.teacher_ugr = ?
          ORDER BY a.created_at DESC`, [req.session.user.ugr], (err, rows) => {
    res.json(rows);
  });
});

app.post("/api/teacher/assessments", requireRole("teacher"), (req, res) => {
  const { student_ugr, course_code, mid_mark, final_mark, assignment_mark, semester, year } = req.body;
  if (!student_ugr || !course_code)
    return res.status(400).json({ error: "Student and course required" });
  const mid = Number(mid_mark) || 0;
  const fin = Number(final_mark) || 0;
  const ass = Number(assignment_mark) || 0;
  if ([mid, fin, ass].some(n => n < 0 || n > 100))
    return res.status(400).json({ error: "Marks must be 0-100" });

  const total = mid + fin + ass;

  db.get(`SELECT name FROM courses WHERE code = ? AND teacher_ugr = ?`,
    [course_code, req.session.user.ugr], (e, course) => {
      if (!course) return res.status(403).json({ error: "Not your course" });
      db.get(`SELECT ugr FROM users WHERE ugr = ? AND role='student'`, [student_ugr], (e2, st) => {
        if (!st) return res.status(404).json({ error: "Student not found" });
        db.run(`INSERT INTO assessments
                  (student_ugr, course_code, course_name, mid_mark, final_mark, assignment_mark, total_mark,
                   semester, year, teacher_ugr, teacher_approved, status)
                VALUES (?,?,?,?,?,?,?,?,?,?, 1, 'pending_admin')
                ON CONFLICT(student_ugr, course_code, semester, year)
                DO UPDATE SET mid_mark=excluded.mid_mark, final_mark=excluded.final_mark,
                              assignment_mark=excluded.assignment_mark, total_mark=excluded.total_mark,
                              teacher_approved=1, status='pending_admin',
                              admin_approved=0, registrar_approved=0, rejection_reason=NULL`,
          [student_ugr, course_code, course.name, mid, fin, ass, total,
           semester, year, req.session.user.ugr],
          function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, message: "Submitted for admin approval" });
          });
      });
    });
});

// ========== REGISTRAR ==========
app.get("/api/registrar/pending", requireRole("registrar"), (req, res) => {
  db.all(`SELECT a.*, u.name AS student_name, t.name AS teacher_name
          FROM assessments a
          LEFT JOIN users u ON u.ugr = a.student_ugr
          LEFT JOIN users t ON t.ugr = a.teacher_ugr
          WHERE a.status = 'pending_registrar'
          ORDER BY a.created_at ASC`, (err, rows) => {
    res.json(rows);
  });
});

app.get("/api/registrar/all", requireRole("registrar"), (req, res) => {
  db.all(`SELECT a.*, u.name AS student_name, t.name AS teacher_name
          FROM assessments a
          LEFT JOIN users u ON u.ugr = a.student_ugr
          LEFT JOIN users t ON t.ugr = a.teacher_ugr
          ORDER BY a.created_at DESC LIMIT 200`, (err, rows) => {
    res.json(rows);
  });
});

app.post("/api/registrar/assessments/:id/approve", requireRole("registrar"), (req, res) => {
  db.run(`UPDATE assessments SET status='approved', registrar_approved=1, rejection_reason=NULL
          WHERE id = ?`, [req.params.id], function (err) {
    res.json({ success: true });
  });
});
app.post("/api/registrar/assessments/:id/reject", requireRole("registrar"), (req, res) => {
  const { reason } = req.body;
  db.run(`UPDATE assessments SET status='rejected', rejection_reason=? WHERE id = ?`,
    [reason || "Not specified", req.params.id], function (err) {
      res.json({ success: true });
    });
});

// ========== STUDENT ==========
app.get("/api/student/dashboard", requireRole("student"), (req, res) => {
  const ugr = req.session.user.ugr;
  const grade = req.session.user.grade;
  db.all(`SELECT code, name, teacher_name, semester, credits FROM courses WHERE grade = ? ORDER BY semester, code`,
    [grade], (err, courses) => {
      db.all(`SELECT course_code, course_name, mid_mark, final_mark, assignment_mark, total_mark,
                     semester, year, status, rejection_reason
              FROM assessments WHERE student_ugr = ?
              ORDER BY year DESC, semester, course_code`, [ugr], (err2, assessments) => {
        res.json({ courses: courses || [], assessments: assessments || [] });
      });
    });
});

// Complaints (student)
app.get("/api/student/complaints", requireRole("student"), (req, res) => {
  db.all(`SELECT * FROM complaints WHERE student_ugr = ? ORDER BY created_at DESC`,
    [req.session.user.ugr], (err, rows) => {
      res.json(rows);
    });
});
app.post("/api/student/complaints", requireRole("student"), (req, res) => {
  const { subject, message } = req.body;
  if (!subject || !message) return res.status(400).json({ error: "Subject and message required" });
  db.run(`INSERT INTO complaints (student_ugr, subject, message) VALUES (?,?,?)`,
    [req.session.user.ugr, subject, message], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
});
// ========== ADMIN APPROVES STUDENT ==========
// Approve a pending student so they can log in
app.post("/api/admin/approve-student/:ugr", requireRole("admin"), (req, res) => {
  const ugr = req.params.ugr;
  
  db.run(`UPDATE users SET status = 'active' WHERE ugr = ? AND role = 'student' AND status = 'pending'`, 
    [ugr], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Student not found or already approved" });
      res.json({ success: true, message: `${ugr} approved and activated.` });
    });
});

// Payments (student)
app.get("/api/student/payments", requireRole("student"), (req, res) => {
  db.all(`SELECT p.*, a.bank_name FROM payments p
          LEFT JOIN accounts a ON a.id = p.account_id
          WHERE p.student_ugr = ? ORDER BY p.created_at DESC`,
    [req.session.user.ugr], (err, rows) => {
      res.json(rows);
    });
});

// Transcript (approved only)
app.get("/api/student/transcript", requireAuth, (req, res) => {
  const targetUgr = (req.session.user.role === "student")
    ? req.session.user.ugr
    : (req.query.ugr || req.session.user.ugr);

  db.get(`SELECT * FROM users WHERE ugr = ? AND role = 'student'`, [targetUgr], (err, student) => {
    if (err || !student) return res.status(404).send("Student not found");
    db.all(`SELECT course_code, course_name, mid_mark, final_mark, assignment_mark, total_mark,
                   semester, year
            FROM assessments
            WHERE student_ugr = ? AND status = 'approved'
            ORDER BY year, semester, course_code`, [targetUgr], (err2, marks) => {
      if (err2) return res.status(500).send(err2.message);
      generateTranscriptPDF(res, student, marks || []);
    });
  });
});

// Schedule PDF
app.get("/api/student/schedule-pdf", requireAuth, (req, res) => {
  const grade = req.session.user.grade || "Grade 10";
  db.all(`SELECT * FROM schedules WHERE grade = ? ORDER BY year DESC, semester, day_of_week, start_time`,
    [grade], (err, rows) => {
      if (err) return res.status(500).send(err.message);
      generateSchedulePDF(res, req.session.user, rows || []);
    });
});

// ========== PDF GENERATORS ==========
function generateTranscriptPDF(res, student, marks) {
  const doc = new PDFDocument({ margin: 50, size: "A4" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition",
    `attachment; filename="Transcript_${student.ugr.replace(/\//g, "_")}.pdf"`);
  doc.pipe(res);

  doc.rect(0, 0, 595, 110).fill("#1e3b5c");
  doc.fillColor("#fff").fontSize(24).font("Helvetica-Bold")
    .text("EXCELLENCE ACADEMY", 50, 35, { align: "center", width: 495 });
  doc.fontSize(12).font("Helvetica")
    .text("Official Academic Transcript", 50, 72, { align: "center", width: 495 });

  doc.fillColor("#1e3b5c").rect(50, 130, 495, 130).lineWidth(1).stroke();
  doc.fillColor("#000").fontSize(11).font("Helvetica-Bold").text("STUDENT INFORMATION", 65, 142);
  doc.font("Helvetica").fontSize(10);
  doc.text(`Name:        ${student.name}`, 65, 165);
  doc.text(`UGR:         ${student.ugr}`, 65, 182);
  doc.text(`Grade:       ${student.grade || "N/A"}`, 65, 199);
  doc.text(`Birth Place: ${student.birth_place || "—"}`, 65, 216);
  doc.text(`Issued:      ${new Date().toLocaleDateString("en-GB")}`, 340, 165);
  doc.text(`Prev School: ${student.previous_school || "—"}`, 340, 182);
  doc.text(`Registrar:   Office of the Registrar`, 340, 199);

  const sem1 = marks.filter(m => m.semester === "Semester 1");
  const sem2 = marks.filter(m => m.semester === "Semester 2");
  let y = 285;

  function drawSem(title, list) {
    if (list.length === 0) return;
    if (y > 640) { doc.addPage(); y = 60; }
    doc.fillColor("#1e3b5c").rect(50, y, 495, 26).fill();
    doc.fillColor("#fff").font("Helvetica-Bold").fontSize(10);
    doc.text(title.toUpperCase(), 60, y + 8);
    y += 26;
    doc.fillColor("#eef3f9").rect(50, y, 495, 20).fill();
    doc.fillColor("#1e3b5c").fontSize(8.5);
    doc.text("CODE", 60, y + 6);
    doc.text("COURSE", 110, y + 6);
    doc.text("MID", 290, y + 6);
    doc.text("FINAL", 330, y + 6);
    doc.text("ASSIGN", 380, y + 6);
    doc.text("TOTAL", 435, y + 6);
    doc.text("GRADE", 490, y + 6);
    y += 20;
    let totalSum = 0;
    list.forEach((m, i) => {
      if (y > 720) { doc.addPage(); y = 60; }
      if (i % 2 === 0) doc.fillColor("#f8fafc").rect(50, y, 495, 18).fill();
      doc.fillColor("#000").font("Helvetica").fontSize(8.5);
      doc.text(m.course_code, 60, y + 4);
      doc.text(m.course_name.slice(0, 25), 110, y + 4);
      doc.text(String(m.mid_mark || 0), 290, y + 4);
      doc.text(String(m.final_mark || 0), 330, y + 4);
      doc.text(String(m.assignment_mark || 0), 380, y + 4);
      const total = m.total_mark || 0;
      doc.text(String(total), 435, y + 4);
      const letter = total >= 90 ? "A" : total >= 80 ? "B" : total >= 70 ? "C" : total >= 60 ? "D" : "F";
      doc.text(letter, 490, y + 4);
      totalSum += total;
      y += 18;
    });
    doc.fillColor("#1e3b5c").font("Helvetica-Bold").fontSize(9);
    doc.text(`Semester Average: ${(totalSum / list.length).toFixed(2)}`, 60, y + 4);
    y += 25;
  }

  drawSem("First Semester", sem1);
  drawSem("Second Semester", sem2);

  if (marks.length === 0) {
    doc.fillColor("#888").font("Helvetica-Oblique").fontSize(11)
      .text("No approved results yet.", 60, y);
    y += 30;
  }

  y += 10;
  doc.moveTo(50, y).lineTo(545, y).strokeColor("#1e3b5c").lineWidth(1.5).stroke();
  y += 15;
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#1e3b5c");
  if (marks.length) {
    const avg = marks.reduce((s, m) => s + (m.total_mark || 0), 0) / marks.length;
    doc.text(`Cumulative Average:  ${avg.toFixed(2)}`, 60, y);
    doc.text(`Total Courses:  ${marks.length}`, 380, y);
  }

  y += 70;
  doc.font("Helvetica").fontSize(10).fillColor("#000");
  doc.text("_________________________", 60, y);
  doc.text("Registrar Signature", 60, y + 15);
  doc.text("Date: _______________", 380, y);

  doc.fontSize(8).fillColor("#888").font("Helvetica-Oblique")
    .text("Only registrar-approved marks appear on this transcript.",
      50, 790, { align: "center", width: 495 });
  doc.end();
}

function generateSchedulePDF(res, student, rows) {
  const doc = new PDFDocument({ margin: 50, size: "A4" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition",
    `attachment; filename="Schedule_${student.ugr.replace(/\//g, "_")}.pdf"`);
  doc.pipe(res);

  doc.rect(0, 0, 595, 100).fill("#1e3b5c");
  doc.fillColor("#fff").fontSize(22).font("Helvetica-Bold")
    .text("EXCELLENCE ACADEMY", 50, 30, { align: "center", width: 495 });
  doc.fontSize(12).font("Helvetica")
    .text("Weekly Class Schedule", 50, 62, { align: "center", width: 495 });

  doc.fillColor("#000").fontSize(11).font("Helvetica-Bold");
  doc.text(`Student: ${student.name}`, 50, 130);
  doc.text(`UGR: ${student.ugr}`, 50, 148);
  doc.text(`Grade: ${student.grade || "—"}`, 50, 166);

  // Group by day
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  let y = 200;

  days.forEach(day => {
    const dayRows = rows.filter(r => r.day_of_week === day);
    if (dayRows.length === 0) return;
    if (y > 680) { doc.addPage(); y = 60; }
    doc.fillColor("#1e3b5c").rect(50, y, 495, 22).fill();
    doc.fillColor("#fff").font("Helvetica-Bold").fontSize(11).text(day.toUpperCase(), 60, y + 5);
    y += 22;

    doc.fillColor("#eef3f9").rect(50, y, 495, 18).fill();
    doc.fillColor("#1e3b5c").fontSize(9).font("Helvetica-Bold");
    doc.text("TIME", 60, y + 4);
    doc.text("COURSE", 160, y + 4);
    doc.text("TEACHER", 320, y + 4);
    doc.text("ROOM", 470, y + 4);
    y += 18;

    dayRows.forEach((r, i) => {
      if (i % 2 === 0) doc.fillColor("#f8fafc").rect(50, y, 495, 18).fill();
      doc.fillColor("#000").font("Helvetica").fontSize(9);
      doc.text(`${r.start_time} - ${r.end_time}`, 60, y + 4);
      doc.text(`${r.course_code} ${r.course_name || ""}`.slice(0, 28), 160, y + 4);
      doc.text((r.teacher_name || "—").slice(0, 22), 320, y + 4);
      doc.text(r.room || "—", 470, y + 4);
      y += 18;
    });
    y += 12;
  });

  if (rows.length === 0) {
    doc.fillColor("#888").fontSize(11).font("Helvetica-Oblique")
      .text("No schedule available yet.", 60, y);
  }

  doc.fontSize(8).fillColor("#888").font("Helvetica-Oblique")
    .text("This schedule is subject to change. Check the portal for updates.",
      50, 790, { align: "center", width: 495 });
  doc.end();
}

// ========== START ==========
app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
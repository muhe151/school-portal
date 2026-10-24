require("dotenv").config();
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

// Use the Internal Database URL from Render
const connectionString = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }, // Force SSL
  connectionTimeoutMillis: 10000
});

// Create a wrapper to mimic SQLite's API so server.js doesn't need to change
const db = {
  serialize: (callback) => {
    // We'll run the table creation immediately
    if (callback) callback();
  },
  run: (sql, params, callback) => {
    // Convert SQLite '?' to PostgreSQL '$1, $2'
    let index = 1;
    const pgSql = sql.replace(/\?/g, () => `$${index++}`);
    pool.query(pgSql, params || [], (err, res) => {
      if (callback) callback.call({ lastID: res?.rows[0]?.id, changes: res?.rowCount }, err);
    });
  },
  get: (sql, params, callback) => {
    let index = 1;
    const pgSql = sql.replace(/\?/g, () => `$${index++}`);
    pool.query(pgSql, params || [], (err, res) => {
      if (callback) callback(err, res?.rows[0]);
    });
  },
  all: (sql, params, callback) => {
    let index = 1;
    const pgSql = sql.replace(/\?/g, () => `$${index++}`);
    pool.query(pgSql, params || [], (err, res) => {
      if (callback) callback(err, res?.rows);
    });
  }
};

// Initialize tables
const initDb = async () => {
  const queries = [
    `CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      ugr TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','registrar','teacher','student')),
      grade TEXT,
      department TEXT,
      phone TEXT,
      address TEXT,
      photo TEXT,
      previous_school TEXT,
      birth_place TEXT,
      birth_date TEXT,
      father_name TEXT,
      mother_name TEXT,
      guardian_phone TEXT,
      documents TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','active','inactive')),
      year_of_study TEXT,
      account_id INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS courses (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      teacher_ugr TEXT,
      teacher_name TEXT,
      semester TEXT NOT NULL,
      grade TEXT NOT NULL,
      credits INTEGER DEFAULT 3
    )`,
    `CREATE TABLE IF NOT EXISTS assessments (
      id SERIAL PRIMARY KEY,
      student_ugr TEXT NOT NULL,
      course_code TEXT NOT NULL,
      course_name TEXT NOT NULL,
      mid_mark REAL DEFAULT 0,
      final_mark REAL DEFAULT 0,
      assignment_mark REAL DEFAULT 0,
      total_mark REAL DEFAULT 0,
      semester TEXT NOT NULL,
      year TEXT NOT NULL,
      teacher_ugr TEXT,
      teacher_approved INTEGER DEFAULT 0,
      admin_approved INTEGER DEFAULT 0,
      registrar_approved INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending_teacher' CHECK(status IN ('pending_teacher','pending_admin','pending_registrar','approved','rejected')),
      rejection_reason TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(student_ugr, course_code, semester, year)
    )`,
    `CREATE TABLE IF NOT EXISTS news (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      author TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS about_school (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      title TEXT, history TEXT, mission TEXT, vision TEXT, image_url TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS accounts (
      id SERIAL PRIMARY KEY,
      bank_name TEXT NOT NULL,
      account_number TEXT NOT NULL,
      account_name TEXT NOT NULL,
      branch TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      student_ugr TEXT NOT NULL,
      amount REAL NOT NULL,
      account_id INTEGER,
      receipt_url TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      rejection_reason TEXT,
      approved_by TEXT,
      approved_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS schedules (
      id SERIAL PRIMARY KEY,
      course_code TEXT NOT NULL,
      course_name TEXT,
      day_of_week TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      room TEXT,
      teacher_name TEXT,
      semester TEXT NOT NULL,
      year TEXT NOT NULL,
      grade TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS complaints (
      id SERIAL PRIMARY KEY,
      student_ugr TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved')),
      admin_reply TEXT,
      replied_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`
  ];

  for (let q of queries) {
    await pool.query(q);
  }

  // Seed data if empty
  const res = await pool.query('SELECT COUNT(*) AS c FROM users');
  if (parseInt(res.rows[0].c) === 0) {
    const adminPw = bcrypt.hashSync("admin123", 10);
    const regPw = bcrypt.hashSync("registrar123", 10);
    const teacherPw = bcrypt.hashSync("teacher123", 10);
    const studentPw = bcrypt.hashSync("student123", 10);

    await pool.query(`INSERT INTO users (ugr, name, email, password, role, status) VALUES ($1,$2,$3,$4,$5,'active')`, ["ADMIN001", "Principal Admin", "admin@school.edu", adminPw, "admin"]);
    await pool.query(`INSERT INTO users (ugr, name, email, password, role, status) VALUES ($1,$2,$3,$4,$5,'active')`, ["REG001", "Registrar Office", "registrar@school.edu", regPw, "registrar"]);

    await pool.query(`INSERT INTO users (ugr, name, email, password, role, department, status) VALUES ($1,$2,$3,$4,$5,$6,'active')`, ["TCH001", "Mr. David Chen", "david@school.edu", teacherPw, "teacher", "Mathematics"]);
    await pool.query(`INSERT INTO users (ugr, name, email, password, role, department, status) VALUES ($1,$2,$3,$4,$5,$6,'active')`, ["TCH002", "Ms. Sarah Wills", "sarah@school.edu", teacherPw, "teacher", "Physics"]);

    await pool.query(`INSERT INTO users (ugr, name, email, password, role, grade, status, year_of_study) VALUES ($1,$2,$3,$4,$5,$6,'active','2025')`, ["UGR/2024/001", "Alice Johnson", "alice@school.edu", studentPw, "student", "Grade 10"]);
    await pool.query(`INSERT INTO users (ugr, name, role, grade, password, status) VALUES ($1,$2,$3,$4,$5,'pending')`, ["UGR/2024/004", "Test Student", "student", "Grade 10", "temp"]);

    await pool.query(`INSERT INTO accounts (bank_name, account_number, account_name, branch) VALUES ($1,$2,$3,$4)`, ["Commercial Bank of Ethiopia", "1000123456789", "Excellence Academy", "Main Branch"]);

    await pool.query(`INSERT INTO courses (code, name, teacher_ugr, teacher_name, semester, grade, credits) VALUES ($1,$2,$3,$4,$5,$6,$7)`, ["MATH101", "Mathematics", "TCH001", "Mr. David Chen", "Semester 1", "Grade 10", 3]);
    await pool.query(`INSERT INTO courses (code, name, teacher_ugr, teacher_name, semester, grade, credits) VALUES ($1,$2,$3,$4,$5,$6,$7)`, ["PHY101", "Physics", "TCH002", "Ms. Sarah Wills", "Semester 1", "Grade 10", 3]);

    await pool.query(`INSERT INTO schedules (course_code, course_name, day_of_week, start_time, end_time, room, teacher_name, semester, year, grade) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, ["MATH101", "Mathematics", "Monday", "08:00", "10:00", "Room A101", "Mr. David Chen", "Semester 1", "2025", "Grade 10"]);
    await pool.query(`INSERT INTO schedules (course_code, course_name, day_of_week, start_time, end_time, room, teacher_name, semester, year, grade) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, ["PHY101", "Physics", "Tuesday", "10:15", "12:15", "Lab B201", "Ms. Sarah Wills", "Semester 1", "2025", "Grade 10"]);

    await pool.query(`INSERT INTO assessments (student_ugr, course_code, course_name, mid_mark, final_mark, assignment_mark, total_mark, semester, year, teacher_ugr, teacher_approved, admin_approved, registrar_approved, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,1,1,'approved')`, ["UGR/2024/001", "MATH101", "Mathematics", 28, 55, 9, 92, "Semester 1", "2025", "TCH001"]);
    await pool.query(`INSERT INTO assessments (student_ugr, course_code, course_name, mid_mark, final_mark, assignment_mark, total_mark, semester, year, teacher_ugr, teacher_approved, admin_approved, registrar_approved, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,1,1,'approved')`, ["UGR/2024/001", "PHY101", "Physics", 25, 50, 13, 88, "Semester 1", "2025", "TCH002"]);

    await pool.query(`INSERT INTO about_school (id, title, history, mission, vision, image_url) VALUES (1, $1, $2, $3, $4, $5)`, [
      "Excellence Academy",
      "Founded in 1995, Excellence Academy has grown from a small community school into one of the region's leading institutions.",
      "To provide a nurturing, inclusive, and innovative learning environment.",
      "To be a beacon of academic excellence and character development.",
      "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=1200&auto=format&fit=crop&q=80"
    ]);

    await pool.query(`INSERT INTO settings (key, value) VALUES ('self_registration_open', '1')`);
  }
};

initDb().catch(console.error);

module.exports = db;
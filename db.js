// db.js — SQLite 数据库模块
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.db');
const db = new Database(DB_PATH);

// 启用 WAL 模式提升并发性能
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 建表
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    city TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    last_login TEXT
  );

  CREATE TABLE IF NOT EXISTS competitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    unit_id TEXT,
    name TEXT NOT NULL,
    platform TEXT DEFAULT '途家民宿',
    room_type TEXT,
    current_price INTEGER DEFAULT 0,
    previous_price INTEGER DEFAULT 0,
    occupancy_rate REAL DEFAULT 0.6,
    longitude REAL,
    latitude REAL,
    address TEXT,
    rating REAL DEFAULT 0,
    reviews INTEGER DEFAULT 0,
    distance TEXT DEFAULT '',
    source TEXT DEFAULT 'manual',
    is_own INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS usage_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    city TEXT,
    details TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS error_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    error_type TEXT,
    message TEXT,
    stack TEXT,
    user_agent TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    competitor_id INTEGER NOT NULL,
    price INTEGER NOT NULL,
    occupancy_rate REAL DEFAULT 0.6,
    recorded_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (competitor_id) REFERENCES competitors(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS crawl_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL DEFAULT 'tujia',
    city TEXT,
    status TEXT DEFAULT 'pending',
    result TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    finished_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_price_history_competitor ON price_history(competitor_id);
  CREATE INDEX IF NOT EXISTS idx_price_history_recorded ON price_history(recorded_at);
  CREATE INDEX IF NOT EXISTS idx_crawl_tasks_status ON crawl_tasks(status);
`);

// 数据库迁移（必须在预编译语句之前执行）
try { db.exec('ALTER TABLE users ADD COLUMN role TEXT DEFAULT "user"'); } catch (e) {}
try { db.exec('ALTER TABLE competitors ADD COLUMN last_crawled_at TEXT'); } catch (e) {}

// 预编译语句（性能优化）
const stmts = {
  // Users
  createUser: db.prepare('INSERT INTO users (username, password_hash, role, city) VALUES (?, ?, ?, ?)'),
  findByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  findUserById: db.prepare('SELECT id, username, role, city, created_at, last_login FROM users WHERE id = ?'),
  updateLastLogin: db.prepare("UPDATE users SET last_login = datetime('now','localtime') WHERE id = ?"),
  updateCity: db.prepare('UPDATE users SET city = ? WHERE id = ?'),
  userCount: db.prepare('SELECT COUNT(*) as count FROM users'),
  allUsers: db.prepare('SELECT id, username, role, city, created_at, last_login FROM users ORDER BY created_at DESC'),

  // Competitors
  getCompetitors: db.prepare('SELECT * FROM competitors WHERE user_id = ? ORDER BY id'),
  addCompetitor: db.prepare('INSERT INTO competitors (user_id, unit_id, name, platform, room_type, current_price, previous_price, occupancy_rate, longitude, latitude, address, rating, reviews, distance, source, is_own) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'),
  deleteCompetitor: db.prepare('DELETE FROM competitors WHERE id = ? AND user_id = ?'),
  updateCompetitor: db.prepare('UPDATE competitors SET current_price=?, previous_price=?, occupancy_rate=? WHERE id=? AND user_id=?'),
  competitorCount: db.prepare('SELECT COUNT(*) as count FROM competitors WHERE user_id = ?'),

  // Usage logs
  insertLog: db.prepare('INSERT INTO usage_logs (user_id, action, city, details) VALUES (?,?,?,?)'),
  getLogs: db.prepare('SELECT ul.*, u.username FROM usage_logs ul LEFT JOIN users u ON ul.user_id = u.id ORDER BY ul.created_at DESC LIMIT 200'),
  dailyActiveUsers: db.prepare("SELECT COUNT(DISTINCT user_id) as count FROM usage_logs WHERE created_at >= date('now','localtime')"),

  // Error logs
  insertError: db.prepare('INSERT INTO error_logs (user_id, error_type, message, stack, user_agent) VALUES (?,?,?,?,?)'),
  getErrors: db.prepare('SELECT * FROM error_logs ORDER BY created_at DESC LIMIT 100'),

  // Price history
  insertPriceHistory: db.prepare('INSERT INTO price_history (competitor_id, price, occupancy_rate) VALUES (?,?,?)'),
  getPriceHistory: db.prepare('SELECT * FROM price_history WHERE competitor_id = ? ORDER BY recorded_at DESC LIMIT ?'),
  getLatestPrice: db.prepare('SELECT price, recorded_at FROM price_history WHERE competitor_id = ? ORDER BY recorded_at DESC LIMIT 1'),
  cleanOldHistory: db.prepare("DELETE FROM price_history WHERE recorded_at < datetime('now','-30 days')"),

  // Crawl tasks
  createCrawlTask: db.prepare('INSERT INTO crawl_tasks (platform, city, status) VALUES (?,?,?)'),
  updateCrawlTask: db.prepare("UPDATE crawl_tasks SET status=?, result=?, finished_at=datetime('now','localtime') WHERE id=?"),
  getCrawlTasks: db.prepare('SELECT * FROM crawl_tasks ORDER BY created_at DESC LIMIT 50'),
  getPendingCrawlTasks: db.prepare("SELECT * FROM crawl_tasks WHERE status='pending' ORDER BY created_at"),

  // Competitor update helpers
  updateCompetitorPrice: db.prepare("UPDATE competitors SET current_price=?, previous_price=?, occupancy_rate=?, last_crawled_at=datetime('now','localtime') WHERE id=?"),
  getCompetitorsNeedingRefresh: db.prepare("SELECT * FROM competitors WHERE source='tujia' AND unit_id IS NOT NULL ORDER BY last_crawled_at ASC"),
  getAllCompetitorsForRefresh: db.prepare('SELECT * FROM competitors WHERE source IS NOT NULL'),
};

// 确保默认 admin 账号存在
const adminExists = stmts.findByUsername.get('admin');
if (!adminExists) {
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('admin123', 10);
  stmts.createUser.run('admin', hash, 'admin', '大理');
}

module.exports = { db, stmts };

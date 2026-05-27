// server.js — 多用户版民宿竞品监控后端
const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { db, stmts } = require('./db');

const CRAWLER_URL = process.env.CRAWLER_URL || 'http://127.0.0.1:9000';

const app = express();
const PORT = process.env.PORT || 3002;
const JWT_SECRET = process.env.JWT_SECRET || 'homestay-monitor-secret-change-in-production';
const JWT_EXPIRES = '7d';

// 请求日志（调试用）
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const icon = res.statusCode >= 400 ? '❌' : res.statusCode >= 300 ? '↪' : '✓';
    console.log(`  ${icon} [${res.statusCode}] ${req.method} ${req.originalUrl} (${ms}ms)`);
  });
  next();
});

// 爬虫服务代理
async function crawlerProxy(path, opts = {}) {
  const { method = 'GET', body } = opts;
  const fetchOpts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) fetchOpts.body = JSON.stringify(body);
  const r = await fetch(CRAWLER_URL + path, fetchOpts);
  return r.json();
}

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ====== JWT 中间件 ======
function authRequired(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: '请先登录' });
  }
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

function adminRequired(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  next();
}

function logAction(userId, action, city, details) {
  try { stmts.insertLog.run(userId, action, city, details ? JSON.stringify(details) : null); } catch (e) {}
}

// ====== Auth API ======
app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  if (username.length < 2 || password.length < 4) return res.status(400).json({ error: '用户名至少2位，密码至少4位' });

  const exists = stmts.findByUsername.get(username);
  if (exists) return res.status(409).json({ error: '用户名已存在' });

  const hash = bcrypt.hashSync(password, 10);
  const result = stmts.createUser.run(username, hash, 'user', '');
  const token = jwt.sign({ id: result.lastInsertRowid, username, role: 'user' }, JWT_SECRET, { expiresIn: JWT_EXPIRES });

  logAction(result.lastInsertRowid, 'register', null, { username });
  res.json({ token, user: { id: result.lastInsertRowid, username, role: 'user', city: '' } });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = stmts.findByUsername.get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  stmts.updateLastLogin.run(user.id);
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });

  logAction(user.id, 'login', null, null);
  res.json({ token, user: { id: user.id, username: user.username, role: user.role, city: user.city } });
});

// ====== User API ======
app.get('/api/me', authRequired, (req, res) => {
  const user = stmts.findUserById.get(req.user.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  res.json(user);
});

app.put('/api/me', authRequired, (req, res) => {
  const { city } = req.body;
  if (city) stmts.updateCity.run(city, req.user.id);
  const user = stmts.findUserById.get(req.user.id);
  logAction(req.user.id, 'update_profile', city, null);
  res.json(user);
});

// ====== Competitor API ======
app.get('/api/competitors', authRequired, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = Math.min(parseInt(req.query.pageSize) || 30, 100);
  const platform = req.query.platform || '';
  const type = req.query.type || '';

  let sql = 'SELECT * FROM competitors WHERE user_id = ?';
  const params = [req.user.id];

  if (platform) {
    sql += ' AND platform = ?';
    params.push(platform);
  }
  if (type === 'homestay') {
    sql += " AND (platform = '民宿' OR name LIKE '%民宿%' OR name LIKE '%客栈%')";
  } else if (type === 'hotel') {
    sql += " AND (platform != '民宿' OR name NOT LIKE '%民宿%')";
  }

  // 总数
  const countRow = db.prepare(sql.replace('SELECT *', 'SELECT COUNT(*) as c')).get(...params);
  const total = countRow.c;

  // 分页
  const offset = (page - 1) * pageSize;
  sql += ' ORDER BY id LIMIT ? OFFSET ?';
  const rows = db.prepare(sql).all(...params, pageSize, offset);

  res.json({
    items: rows.map(c => ({
      id: c.id,
      unitId: c.unit_id,
      name: c.name,
      platform: c.platform,
      roomType: c.room_type,
      currentPrice: c.current_price,
      previousPrice: c.previous_price,
      occupancyRate: c.occupancy_rate,
      longitude: c.longitude,
      latitude: c.latitude,
      address: c.address,
      rating: c.rating,
      reviews: c.reviews,
      distance: c.distance,
      source: c.source,
      isOwn: !!c.is_own,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
});

app.post('/api/competitors', authRequired, (req, res) => {
  const item = req.body;
  const result = stmts.addCompetitor.run(
    req.user.id, item.unitId || null, item.name, item.platform || '途家民宿',
    item.roomType || '', item.currentPrice || 0, item.previousPrice || 0,
    item.occupancyRate || 0.6, item.longitude || null, item.latitude || null,
    item.address || '', item.rating || 0, item.reviews || 0,
    item.distance || '', item.source || 'tujia', 0
  );

  logAction(req.user.id, 'add_competitor', null, { name: item.name, price: item.currentPrice });
  res.json({ success: true, id: result.lastInsertRowid });
});

app.delete('/api/competitors/:id', authRequired, (req, res) => {
  const result = stmts.deleteCompetitor.run(req.params.id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: '竞品不存在' });
  logAction(req.user.id, 'remove_competitor', null, { competitorId: req.params.id });
  res.json({ success: true });
});

app.put('/api/competitors/:id', authRequired, (req, res) => {
  const { currentPrice, previousPrice, occupancyRate } = req.body;
  const result = stmts.updateCompetitor.run(currentPrice, previousPrice, occupancyRate, req.params.id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: '竞品不存在' });
  res.json({ success: true });
});

// ====== 途家搜索代理（→ Python 爬虫服务） ======
app.get('/api/tujia/search', authRequired, async (req, res) => {
  const { city, page = 0, size = 20 } = req.query;
  if (!city) return res.status(400).json({ error: 'city required' });

  logAction(req.user.id, 'search', city, null);

  try {
    const data = await crawlerProxy('/crawl/search', {
      method: 'POST',
      body: { city, page: parseInt(page), size: Math.min(parseInt(size), 50) },
    });

    if (data.error) return res.json({ error: data.error });
    res.json({ total: data.total, listings: data.listings });
  } catch (e) {
    res.status(502).json({ error: '爬虫服务不可用: ' + e.message });
  }
});

// ====== 错误日志上报 ======
app.post('/api/errors', authRequired, (req, res) => {
  const { error_type, message, stack } = req.body;
  stmts.insertError.run(req.user.id, error_type, message, stack, req.headers['user-agent'] || '');
  res.json({ success: true });
});

// ====== 管理后台 API ======
app.get('/api/admin/stats', authRequired, adminRequired, (req, res) => {
  const users = stmts.userCount.get().count;
  const dau = stmts.dailyActiveUsers.get().count;
  const totalCompetitors = db.prepare('SELECT COUNT(*) as count FROM competitors').get().count;
  const totalLogs = db.prepare('SELECT COUNT(*) as count FROM usage_logs').get().count;
  const todayLogs = db.prepare("SELECT COUNT(*) as count FROM usage_logs WHERE created_at >= date('now','localtime')").get().count;

  const topActions = db.prepare(`
    SELECT action, COUNT(*) as count FROM usage_logs
    WHERE created_at >= date('now','-7 days','localtime')
    GROUP BY action ORDER BY count DESC
  `).all();

  res.json({ users, dau, totalCompetitors, totalLogs, todayLogs, topActions });
});

app.get('/api/admin/users', authRequired, adminRequired, (req, res) => {
  const users = stmts.allUsers.all();
  const enriched = users.map(u => ({
    ...u,
    competitorCount: stmts.competitorCount.get(u.id).count,
    lastActive: db.prepare('SELECT MAX(created_at) as t FROM usage_logs WHERE user_id = ?').get(u.id)?.t || null,
  }));
  res.json(enriched);
});

app.get('/api/admin/logs', authRequired, adminRequired, (req, res) => {
  res.json(stmts.getLogs.all());
});

app.get('/api/admin/errors', authRequired, adminRequired, (req, res) => {
  res.json(stmts.getErrors.all());
});

// ====== 价格历史 API ======
app.get('/api/competitors/:id/history', authRequired, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const history = stmts.getPriceHistory.all(req.params.id, limit);
  res.json(history.map(h => ({
    id: h.id,
    price: h.price,
    occupancyRate: h.occupancy_rate,
    recordedAt: h.recorded_at,
  })));
});

// ====== 爬虫触发 API ======
app.post('/api/crawl/trigger', authRequired, async (req, res) => {
  try {
    const data = await crawlerProxy('/crawl/refresh', { method: 'POST' });
    logAction(req.user.id, 'trigger_crawl', null, data);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: '爬虫服务不可用: ' + e.message });
  }
});

// ====== 爬虫统计 API ======
app.get('/api/crawl/stats', authRequired, async (req, res) => {
  try {
    const data = await crawlerProxy('/crawl/stats');
    res.json(data);
  } catch (e) {
    res.json({ status: 'unavailable', error: e.message });
  }
});

// ====== GPS 附近搜索 API ======
app.post('/api/nearby', authRequired, async (req, res) => {
  const { lat, lng, radius = 10.0, size = 30, platform = 'all' } = req.body;
  if (!lat || !lng) return res.status(400).json({ error: 'lat,lng required' });

  logAction(req.user.id, 'nearby_search', null, { lat, lng, radius });

  try {
    const data = await crawlerProxy('/crawl/nearby', {
      method: 'POST',
      body: { lat: parseFloat(lat), lng: parseFloat(lng), radius: parseFloat(radius), size: parseInt(size), platform },
    });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: '附近搜索失败: ' + e.message });
  }
});

// ====== 关键词搜索 API ======
app.post('/api/search/keyword', authRequired, async (req, res) => {
  const { keyword, city, size = 50 } = req.body;
  if (!keyword) return res.status(400).json({ error: 'keyword required' });

  logAction(req.user.id, 'keyword_search', city, { keyword });

  try {
    const data = await crawlerProxy('/crawl/search/keyword', {
      method: 'POST',
      body: { keyword, city: city || '', size: Math.min(parseInt(size), 100) },
    });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: '关键词搜索失败: ' + e.message });
  }
});

// ====== 携程搜索 API ======
app.get('/api/ctrip/search', authRequired, async (req, res) => {
  const { city, page = 0, size = 20 } = req.query;
  if (!city) return res.status(400).json({ error: 'city required' });

  logAction(req.user.id, 'ctrip_search', city, null);

  try {
    const data = await crawlerProxy('/crawl/ctrip/search', {
      method: 'POST',
      body: { city, page: parseInt(page), size: Math.min(parseInt(size), 50) },
    });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: '携程搜索失败: ' + e.message });
  }
});

// ====== 地理反查（高德） ======
app.get('/api/geo/city', async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat,lng required' });
  const key = process.env.AMAP_KEY || '';
  if (!key) return res.json({ city: '', district: '', lat, lng, note: 'no AMAP_KEY' });
  try {
    const r = await fetch(`https://restapi.amap.com/v3/geocode/regeo?key=${key}&location=${lng},${lat}&extensions=base`, { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    const comp = d.regeocode?.addressComponent || {};
    res.json({ city: comp.city || comp.province || '', district: comp.district || '', adcode: comp.adcode || '', lat, lng });
  } catch (e) {
    res.json({ city: '', district: '', lat, lng });
  }
});

// ====== 启动 ======
app.listen(PORT, async () => {
  console.log(`🏡 homestay-monitor v2: http://localhost:${PORT}`);
  console.log(`   默认管理员: admin / admin123`);
  try {
    const h = await fetch(CRAWLER_URL + '/health');
    const d = await h.json();
    console.log(`   🕷️ 爬虫服务: ${CRAWLER_URL} (${d.status})`);
  } catch (e) {
    console.log(`   ⚠️ 爬虫服务未启动: ${CRAWLER_URL}`);
    console.log(`   请先启动爬虫: cd crawler && python main.py`);
  }
});

// api.js — 数据接口适配器（多用户版，JWT 认证）
const API = (() => {
  let token = localStorage.getItem('homestay_token') || '';

  function headers() {
    const h = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = 'Bearer ' + token;
    return h;
  }

  async function request(method, path, body) {
    const opts = { method, headers: headers() };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(path, opts);
    if (r.status === 401) {
      localStorage.removeItem('homestay_token');
      localStorage.removeItem('homestay_user');
      window.location.reload();
      throw new Error('登录过期');
    }
    return r.json();
  }

  return {
    setToken(t) { token = t; localStorage.setItem('homestay_token', t); },
    getToken() { return token; },
    clearAuth() { token = ''; localStorage.removeItem('homestay_token'); localStorage.removeItem('homestay_user'); },

    // 认证
    async register(username, password) {
      const r = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
      return r.json();
    },
    async login(username, password) {
      const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
      return r.json();
    },

    // 用户
    async getMe() { return request('GET', '/api/me'); },
    async updateMe(data) { return request('PUT', '/api/me', data); },

    // 竞品
    async fetchCompetitors() {
      const data = await request('GET', '/api/competitors');
      return Array.isArray(data) ? data : [];
    },
    async addCompetitor(item) {
      return request('POST', '/api/competitors', item);
    },
    async removeCompetitor(id) {
      return request('DELETE', '/api/competitors/' + id);
    },

    // 途家搜索
    async searchTujia(city, page = 0, size = 30) {
      const r = await fetch('/api/tujia/search?city=' + encodeURIComponent(city) + '&page=' + page + '&size=' + size, { headers: headers() });
      if (r.status === 401) { localStorage.removeItem('homestay_token'); window.location.reload(); return {}; }
      return r.json();
    },

    // 定位
    getCurrentPosition() {
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error('浏览器不支持定位'));
        navigator.geolocation.getCurrentPosition(
          pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          err => reject(err),
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        );
      });
    },
    async reverseGeocode(lat, lng) {
      const r = await fetch('/api/geo/city?lat=' + lat + '&lng=' + lng);
      return r.json();
    },

    // 错误上报
    async reportError(type, message, stack) {
      try { await request('POST', '/api/errors', { error_type: type, message, stack }); } catch (e) {}
    },

    // 管理后台（仅 admin）
    async adminStats() { return request('GET', '/api/admin/stats'); },
    async adminUsers() { return request('GET', '/api/admin/users'); },
    async adminLogs() { return request('GET', '/api/admin/logs'); },
    async adminErrors() { return request('GET', '/api/admin/errors'); },
  };
})();

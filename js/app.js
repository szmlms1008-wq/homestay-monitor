// app.js — 主渲染与交互逻辑（多用户版）
(function () {
  let listings = [];
  let selectedId = null;
  let activePlatforms = new Set(['携程', '美团民宿', '途家民宿', '飞猪']);
  let propertyType = 'all'; // 'all' | 'homestay' | 'hotel'
  let chartMode = '7d';
  let chart = null;
  let autoRefresh = true;
  let refreshTimer = null;
  let priceUpdateUnsub = null;
  let timelineEvents = [];
  let currentCity = '都江堰';
  let currentGps = { lat: 30.998, lng: 103.646 };
  let currentUser = null;
  const appEl = document.getElementById('app');

  // ====== 登录 / 注册 ======
  function showLogin() {
    appEl.innerHTML = `
      <div class="login-wrap">
        <div class="login-card">
          <div class="login-logo">🏡</div>
          <h2>民宿竞品监控</h2>
          <p class="login-sub">登录查看周边民宿价格</p>
          <form id="loginForm" class="login-form">
            <input class="login-input" id="loginUser" type="text" placeholder="用户名" autocomplete="username" required>
            <input class="login-input" id="loginPass" type="password" placeholder="密码" autocomplete="current-password" required>
            <button class="login-btn" type="submit">登 录</button>
          </form>
          <p class="login-switch">还没有账号？<a href="#" id="showRegister">立即注册</a></p>
          <p class="login-error" id="loginError"></p>
        </div>
      </div>
    `;

    document.getElementById('loginForm').onsubmit = async (e) => {
      e.preventDefault();
      const u = document.getElementById('loginUser').value.trim();
      const p = document.getElementById('loginPass').value.trim();
      if (!u || !p) return;
      const el = document.getElementById('loginError');
      el.textContent = '登录中...';
      el.className = 'login-error';
      const result = await API.login(u, p);
      if (result.token) {
        API.setToken(result.token);
        localStorage.setItem('homestay_user', JSON.stringify(result.user));
        currentUser = result.user;
        currentCity = '';
        el.textContent = '';
        await initApp();
      } else {
        el.textContent = result.error || '登录失败';
        el.className = 'login-error show';
      }
    };

    document.getElementById('showRegister').onclick = (e) => { e.preventDefault(); showRegister(); };
  }

  function showRegister() {
    appEl.innerHTML = `
      <div class="login-wrap">
        <div class="login-card">
          <div class="login-logo">🏡</div>
          <h2>注册账号</h2>
          <p class="login-sub">免费注册，开始监控竞品</p>
          <form id="regForm" class="login-form">
            <input class="login-input" id="regUser" type="text" placeholder="用户名（至少2位）" autocomplete="username" required minlength="2">
            <input class="login-input" id="regPass" type="password" placeholder="密码（至少4位）" autocomplete="new-password" required minlength="4">
            <button class="login-btn" type="submit">注 册</button>
          </form>
          <p class="login-switch">已有账号？<a href="#" id="showLogin">返回登录</a></p>
          <p class="login-error" id="loginError"></p>
        </div>
      </div>
    `;

    document.getElementById('regForm').onsubmit = async (e) => {
      e.preventDefault();
      const u = document.getElementById('regUser').value.trim();
      const p = document.getElementById('regPass').value.trim();
      if (!u || !p) return;
      const el = document.getElementById('loginError');
      el.textContent = '注册中...';
      el.className = 'login-error';
      const result = await API.register(u, p);
      if (result.token) {
        API.setToken(result.token);
        localStorage.setItem('homestay_user', JSON.stringify(result.user));
        currentUser = result.user;
        currentCity = '';
        el.textContent = '';
        await initApp();
      } else {
        el.textContent = result.error || '注册失败';
        el.className = 'login-error show';
      }
    };

    document.getElementById('showLogin').onclick = (e) => { e.preventDefault(); showLogin(); };
  }

  // ====== 主应用 ======
  function addTimelineEvents(changes) {
    changes.forEach(l => {
      const diff = l.currentPrice - l.previousPrice;
      const pct = l.previousPrice > 0 ? Math.round((diff / l.previousPrice) * 100) : 0;
      timelineEvents.unshift({
        id: l.id, name: l.name, from: l.previousPrice, to: l.currentPrice,
        diff, pct, time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      });
    });
    if (timelineEvents.length > 50) timelineEvents = timelineEvents.slice(0, 50);
  }

  function setCurrentCity(city) {
    if (!city) return;
    currentCity = city;
    const title = document.getElementById('cityTitle');
    if (title) title.innerHTML = '🏠 ' + currentCity + '片区';
    try { localStorage.setItem('homestay_city', city); API.updateMe({ city }).catch(() => {}); } catch (e) {}
  }

  function calcCompIndices() {
    const filtered = listings.filter(l => activePlatforms.has(l.platform));
    const total = filtered.length;
    if (total === 0) return null;
    const marketAvgPrice = Math.round(filtered.reduce((s, l) => s + l.currentPrice, 0) / total);
    const marketAvgOcc = Math.round(filtered.reduce((s, l) => s + l.occupancyRate, 0) / total * 100);
    const marketRevPAR = Math.round(marketAvgPrice * marketAvgOcc / 100);

    const ownListings = filtered.filter(l => l.isOwn);
    const prices = filtered.map(l => l.currentPrice).sort((a, b) => a - b);
    const marketMin = prices[0];
    const marketMax = prices[total - 1];
    const marketP25 = prices[Math.floor(total * 0.25)];
    const marketP75 = prices[Math.floor(total * 0.75)];

    if (ownListings.length === 0) {
      return { marketAvgPrice, marketAvgOcc, marketRevPAR, mpi: null, ari: null, rgi: null,
        ownListings: [], marketMin, marketMax, marketP25, marketP75 };
    }
    const ownAvgPrice = Math.round(ownListings.reduce((s, l) => s + l.currentPrice, 0) / ownListings.length);
    const ownAvgOcc = Math.round(ownListings.reduce((s, l) => s + l.occupancyRate, 0) / ownListings.length * 100);
    const ownRevPAR = Math.round(ownAvgPrice * ownAvgOcc / 100);
    const mpi = marketAvgOcc > 0 ? Math.round(ownAvgOcc / marketAvgOcc * 100) : 100;
    const ari = marketAvgPrice > 0 ? Math.round(ownAvgPrice / marketAvgPrice * 100) : 100;
    const rgi = marketRevPAR > 0 ? Math.round(ownRevPAR / marketRevPAR * 100) : 100;
    return { marketAvgPrice, marketAvgOcc, marketRevPAR, mpi, ari, rgi,
      ownListings, marketMin, marketMax, marketP25, marketP75, ownAvgPrice };
  }

  function indexBadge(val) {
    if (val === null || val === undefined) return { cls: '', text: '暂无' };
    if (val >= 110) return { cls: 'comp-great', text: '领先 ' + val };
    if (val >= 95) return { cls: 'comp-ok', text: '持平 ' + val };
    return { cls: 'comp-warn', text: '落后 ' + val };
  }

  function render() {
    const filtered = listings.filter(l => {
      const plat = l.platform;
      const inPlatform = activePlatforms.has(plat) ||
        (activePlatforms.has('美团民宿') && ['民宿', '酒店', '公寓', '青旅', '度假村'].includes(plat)) ||
        (activePlatforms.has('途家民宿') && plat === '途家民宿');
      if (!inPlatform) return false;
      if (propertyType === 'homestay') return plat === '民宿' || (l.name || '').includes('民宿');
      if (propertyType === 'hotel') return plat === '酒店' || (l.name || '').includes('酒店');
      return true;
    });
    const total = filtered.length;
    const hasData = total > 0;

    // 基于 GPS 距离的附近房源统计
    const nearbyListings = currentGps ? filtered.filter(l => {
      if (!l.latitude || !l.longitude) return false;
      const d = haversine(currentGps.lat, currentGps.lng, l.latitude, l.longitude);
      return d <= 10;
    }) : filtered;
    const nearbyTotal = nearbyListings.length || total;
    const statsSource = nearbyListings.length ? nearbyListings : filtered;

    const pricedItems = statsSource.filter(l => (l.currentPrice || 0) > 0);
    const avgPrice = pricedItems.length > 0 ? Math.round(pricedItems.reduce((s, l) => s + l.currentPrice, 0) / pricedItems.length) : 0;
    const upCount = filtered.filter(l => l.currentPrice > l.previousPrice).length;
    const downCount = filtered.filter(l => l.currentPrice < l.previousPrice).length;
    const avgOcc = hasData ? Math.round(statsSource.reduce((s, l) => s + (l.occupancyRate || 0), 0) / (statsSource.length || 1) * 100) : 0;
    const ownListings = filtered.filter(l => l.isOwn);
    const sorted = [...filtered].sort((a, b) => a.currentPrice - b.currentPrice);
    const ownRanks = ownListings.length ? ownListings.map(l => sorted.findIndex(s => s.id === l.id) + 1).join('/') : '-';

    const comp = calcCompIndices();
    const mpiB = indexBadge(comp ? comp.mpi : null);
    const ariB = indexBadge(comp ? comp.ari : null);
    const rgiB = indexBadge(comp ? comp.rgi : null);
    const beating = comp && comp.mpi >= 100 && comp.ari >= 100 && comp.rgi >= 100;

    const now = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const isAdmin = currentUser && currentUser.role === 'admin';
    const areaLabel = nearbyListings.length ? '附近 10km' : '全部';

    appEl.innerHTML = `
      <div class="topbar">
        <div class="topbar-left">
          <h1 id="cityTitle">🏠 ${currentCity || '搜索民宿/酒店'}</h1>
          <span class="live-badge">● 实时监控中</span>
          ${beating ? '<span class="beating-badge">🏆 击败竞品组</span>' : ''}
        </div>
        <div class="topbar-right">
          <span class="user-label" title="当前用户">👤 ${currentUser ? currentUser.username : ''}</span>
          <button class="locate-btn" id="btnLocate" onclick="window._hSearch()">📍 定位搜竞品</button>
          ${isAdmin ? '<button class="admin-btn" onclick="window._hAdmin()">⚙️ 管理</button>' : ''}
          <button class="logout-btn" onclick="window._hLogout()">退出</button>
          <div class="platform-filters">
            <span style="font-size:11px;color:#888;margin-right:4px;">平台:</span>
            ${['携程', '美团民宿', '途家民宿', '飞猪'].map(p => `
              <button class="platform-btn${activePlatforms.has(p) ? ' active' : ''}" data-platform="${p}">${p.replace('民宿','')}</button>
            `).join('')}
            <span style="margin:0 8px;color:#ddd;">|</span>
            <span style="font-size:11px;color:#888;margin-right:4px;">类型:</span>
            ${['全部', '民宿', '酒店'].map(t => `
              <button class="platform-btn${propertyType === (t==='全部'?'all':t) ? ' active' : ''}" data-type="${t==='全部'?'all':t}">${t}</button>
            `).join('')}
          </div>
          <button class="locate-btn" id="btnRefreshAll" style="background:#fff;color:var(--primary);border:1px solid var(--primary);">🔄 刷新所有价格</button>
          <span class="refresh-info">更新于 ${now}</span>
        </div>
      </div>

      <div class="hero-cards">
        <div class="hero-card hc-price"><div class="hc-label">${areaLabel}片区均价</div><div class="hc-value">${avgPrice > 0 ? '¥' + avgPrice : '暂无'}</div><div class="hc-sub">${pricedItems.length > 0 ? '基于 ' + pricedItems.length + ' 家有报价民宿' : '暂无报价数据'}</div></div>
        <div class="hero-card hc-occ"><div class="hc-label">${areaLabel}片区入住率</div><div class="hc-value">${avgOcc}%</div><div class="hc-sub">${avgOcc >= 70 ? '旺季水平' : avgOcc > 0 ? '淡季水平' : '暂无数据'}</div></div>
        <div class="hero-card hc-rgi"><div class="hc-label">综合收益 RGI</div><div class="hc-value" id="comp-rgi">${rgiB.text}</div><div class="hc-sub">RevPAR ¥${comp ? comp.marketRevPAR : '-'} · 三项全>100 = 击败竞品组</div></div>
      </div>

      <div class="sub-cards">
        <div class="sub-card sc-${mpiB.cls === 'comp-great' ? 'great' : mpiB.cls === 'comp-ok' ? 'ok' : 'warn'}">
          <div class="sc-label">MPI 市场渗透</div><div class="sc-value" id="comp-mpi">${mpiB.text}</div><div class="sc-desc">我 ${comp ? Math.round(ownListings.reduce((s,l)=>s+l.occupancyRate,0)/ownListings.length*100):'-'}% · 市场 ${comp?comp.marketAvgOcc+'%' : '-'}</div>
        </div>
        <div class="sub-card sc-${ariB.cls === 'comp-great' ? 'great' : ariB.cls === 'comp-ok' ? 'ok' : 'warn'}">
          <div class="sc-label">ARI 均价指数</div><div class="sc-value" id="comp-ari">${ariB.text}</div><div class="sc-desc">我 ¥${comp?comp.ownAvgPrice:'-'} · 市场 ¥${comp?comp.marketAvgPrice:'-'}</div>
        </div>
        <div class="sub-card"><div class="sc-label">今日涨 / 跌</div><div class="sc-value"><span class="price-up-color">${upCount}</span> / <span class="price-down-color">${downCount}</span></div><div class="sc-desc">${total-upCount-downCount}家持平</div></div>
        <div class="sub-card"><div class="sc-label">我的排名</div><div class="sc-value">第${ownRanks}</div><div class="sc-desc">共 ${total} 家 · 按价格竞争力</div></div>
        <div class="sub-card"><div class="sc-label">💰 价格温度计</div><canvas id="thermoCanvas"></canvas><div class="sc-desc" id="thermoLabel">市场 ¥${comp ? comp.marketMin : '-'} ~ ¥${comp ? comp.marketMax : '-'}</div></div>
      </div>

      <div class="main-content">
        <div class="left-panel">
          <div class="panel-header">📋 民宿价格一览</div>
          <div style="overflow-x:auto;">
            <table class="listings-table">
              <thead><tr><th>民宿</th><th>平台</th><th>房型</th><th>现价</th><th>变动</th><th>入住率</th><th>距离</th><th></th></tr></thead>
              <tbody>
                ${!hasData ? `<tr><td colspan="8" style="text-align:center;padding:40px;color:#888;">
                  <div style="font-size:16px;margin-bottom:8px;">📭 还没有竞品数据</div>
                  <div>点击上方 <b>📍 定位搜竞品</b> 开始搜索附近民宿，或点击 <b>🔄 刷新所有价格</b> 更新已有数据</div>
                </td></tr>` : ''}
                ${filtered.map(l => {
                  const diff = l.currentPrice - l.previousPrice;
                  const pct = l.previousPrice > 0 ? Math.round((diff / l.previousPrice) * 100) : 0;
                  const changeClass = diff > 0 ? 'price-up-color' : diff < 0 ? 'price-down-color' : '';
                  const changeText = diff > 0 ? `↑${pct}%` : diff < 0 ? `↓${Math.abs(pct)}%` : '-';
                  const occ = occLabel(l.occupancyRate, l.platform, l.rating);
                  const hasPrice = l.currentPrice > 0;
                  const canDelete = !l.isOwn;
                  return `
                    <tr class="${l.isOwn ? 'own' : ''}${selectedId === l.id ? ' selected' : ''}" data-id="${l.id}">
                      <td><strong>${l.name}</strong>${l.isOwn ? '<span class="own-tag">我的</span>' : ''}</td>
                      <td>${platformBadge(l.platform)}</td><td>${l.roomType}</td>
                      <td>${hasPrice ? '<strong>¥' + l.currentPrice + '</strong>' : '<span style="color:#999;">暂无</span>'}</td>
                      <td><span class="price-change ${changeClass}">${hasPrice ? changeText : '-'}</span></td>
                      <td>${occ}</td>
                      <td>${l.distance || '-'}</td>
                      <td>${canDelete ? `<button class="del-comp-btn" data-del="${l.id}" title="移除此竞品">✕</button>` : ''}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
          ${(() => {
            const pg = DataStore.getPagination();
            return pg.totalPages > 1 ? `
            <div style="display:flex;justify-content:center;align-items:center;gap:8px;padding:12px 16px;border-top:1px solid var(--border);">
              <button class="page-btn" data-page="1" ${pg.page <= 1 ? 'disabled' : ''}>首页</button>
              <button class="page-btn" data-page="${pg.page - 1}" ${pg.page <= 1 ? 'disabled' : ''}>上一页</button>
              <span style="font-size:13px;color:#666;">第 ${pg.page}/${pg.totalPages} 页 · 共 ${pg.total} 条</span>
              <button class="page-btn" data-page="${pg.page + 1}" ${pg.page >= pg.totalPages ? 'disabled' : ''}>下一页</button>
              <button class="page-btn" data-page="${pg.totalPages}" ${pg.page >= pg.totalPages ? 'disabled' : ''}>末页</button>
            </div>` : '';
          })()}
        </div>

        <div class="right-panel">
          <div class="chart-card">
            <div class="card-title">📈 ${selectedId ? (listings.find(l => l.id === selectedId) || {}).name || '选择民宿' : '选择一家民宿'}</div>
            <div class="card-subtitle" id="chartStats"></div>
            <div class="chart-tabs">
              <button class="chart-tab${chartMode === '7d' ? ' active' : ''}" data-mode="7d">7天</button>
              <button class="chart-tab${chartMode === '24h' ? ' active' : ''}" data-mode="24h">24小时</button>
            </div>
            <div class="chart-container"><canvas id="priceChart"></canvas></div>
          </div>
          <div class="timeline-card">
            <div class="card-title" style="margin-bottom:8px;">🔔 最近调价记录</div>
            <div class="timeline-list">
              ${timelineEvents.slice(0,12).map(e => {
                const cls = e.diff > 0 ? 'price-up-color' : e.diff < 0 ? 'price-down-color' : '';
                return `<div class="timeline-item" data-id="${e.id}"><span>${e.name} <span class="${cls}">${e.diff>0?'↑':e.diff<0?'↓':'→'} ¥${e.from}→¥${e.to} (${e.pct>0?'+':''}${e.pct}%)</span></span><span class="timeline-time">${e.time}</span></div>`;
              }).join('') || '<div style="text-align:center;color:#888;padding:20px;">等待调价事件...</div>'}
            </div>
          </div>
        </div>
      </div>
    `;

    if (selectedId) updateChart(selectedId);
    drawThermo();
  }

  // ====== 图表 + 温度计 ======
  function updateChart(id) {
    const canvas = document.getElementById('priceChart');
    if (!canvas) return;
    if (!chart) chart = new PriceChart(canvas);
    const listing = listings.find(l => l.id === id);
    if (!listing) return;
    const history = DataStore.getPriceHistory(id);
    chart.setData(history, chartMode);
    if (history.length > 0) {
      const last7 = history.filter(d => d.time >= Date.now() - 7 * 24 * 60 * 60 * 1000);
      const minP = Math.min(...last7.map(d => d.price));
      const maxP = Math.max(...last7.map(d => d.price));
      const statEl = document.getElementById('chartStats');
      if (statEl) statEl.textContent = `近7天最低 ¥${minP} · 最高 ¥${maxP} · 当前 ¥${listing.currentPrice}`;
    }
  }

  function drawThermo() {
    const canvas = document.getElementById('thermoCanvas');
    if (!canvas) return;
    const comp = calcCompIndices();
    if (!comp) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 260;
    const H = 56;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const pad = 10; const barH = 14; const barY = 8;
    const barW = W - pad * 2; const tickY = barY + barH;
    const range = comp.marketMax - comp.marketMin || 1;
    const x = (price) => pad + ((price - comp.marketMin) / range) * barW;

    function roundRect(rx, ry, rw, rh, r) {
      ctx.beginPath(); ctx.moveTo(rx+r, ry); ctx.lineTo(rx+rw-r, ry); ctx.arcTo(rx+rw, ry, rx+rw, ry+r, r);
      ctx.lineTo(rx+rw, ry+rh-r); ctx.arcTo(rx+rw, ry+rh, rx+rw-r, ry+rh, r);
      ctx.lineTo(rx+r, ry+rh); ctx.arcTo(rx, ry+rh, rx, ry+rh-r, r);
      ctx.lineTo(rx, ry+r); ctx.arcTo(rx, ry, rx+r, ry, r); ctx.closePath();
    }

    const grad = ctx.createLinearGradient(pad, 0, pad + barW, 0);
    grad.addColorStop(0, '#43a047'); grad.addColorStop(0.5, '#f9a825'); grad.addColorStop(1, '#e53935');
    ctx.fillStyle = grad; roundRect(pad, barY, barW, barH, 4); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    roundRect(x(comp.marketP25), barY, x(comp.marketP75) - x(comp.marketP25), barH, 4); ctx.fill();

    const midX = x(comp.marketAvgPrice);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(midX, barY - 2); ctx.lineTo(midX, tickY + 6); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('¥' + comp.marketAvgPrice, midX, tickY + 18);

    ctx.fillStyle = '#888'; ctx.font = '9px sans-serif';
    ctx.textAlign = 'left'; ctx.fillText('¥' + comp.marketMin, pad, tickY + 12);
    ctx.textAlign = 'right'; ctx.fillText('¥' + comp.marketMax, pad + barW, tickY + 12);

    if (comp.ownListings && comp.ownListings.length > 0) {
      comp.ownListings.forEach(own => {
        const ox = Math.max(pad, Math.min(pad + barW, x(own.price)));
        ctx.fillStyle = '#1a237e';
        ctx.beginPath(); ctx.moveTo(ox, barY+barH+4); ctx.lineTo(ox-5, barY+barH+14); ctx.lineTo(ox+5, barY+barH+14); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#1a237e'; ctx.beginPath(); ctx.arc(ox, barY+barH/2, 4, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      });
    }
    const label = document.getElementById('thermoLabel');
    if (label) label.textContent = `市场 ¥${comp.marketMin} ~ ¥${comp.marketMax}`;
  }

  // ====== 平台 Badge ======
  function platformBadge(platform) {
    const map = {
      '途家民宿': { cls: 'badge-tj', label: '途家' },
      '携程': { cls: 'badge-ctrip', label: '携程' },
      '民宿': { cls: 'badge-amap', label: '民宿' },
      '酒店': { cls: 'badge-amap-hotel', label: '酒店' },
      '公寓': { cls: 'badge-mt', label: '公寓' },
      '青旅': { cls: 'badge-xz', label: '青旅' },
      '度假村': { cls: 'badge-other', label: '度假村' },
      '美团民宿': { cls: 'badge-mt', label: '美团' },
      '小猪': { cls: 'badge-xz', label: '小猪' },
    };
    const m = map[platform] || { cls: 'badge-other', label: platform };
    return `<span class="platform-badge ${m.cls}">${m.label}</span>`;
  }

  function occLabel(rate, platform, rating) {
    if (platform && (platform.includes('高德') || platform === '携程') && rating > 0) {
      return Math.round(rate * 100) + '%';
    }
    return '-';
  }

  function getActivePlatformsParam() {
    const active = [...activePlatforms];
    // 携程+美团=都调用all, 只有携程=ctrip, 只有美团=amap
    if (active.includes('携程') && !active.includes('美团民宿')) return 'ctrip';
    if (!active.includes('携程') && active.includes('美团民宿')) return 'tujia'; // uses AMap as base
    return 'all';
  }

  // ====== 搜索 ======
  async function doSearch() {
    const modal = document.getElementById('searchModal');
    if (!modal) return;
    const loading = document.getElementById('searchLoading');
    const resultsEl = document.getElementById('searchResults');
    const platParam = getActivePlatformsParam();
    const platNames = [...activePlatforms].join(' + ');
    modal.style.display = 'flex';
    loading.innerHTML = '';
    resultsEl.innerHTML = `
      <div class="manual-search">
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <input class="city-input" id="searchKeyword" type="text" placeholder="搜索民宿/酒店名，如: 希尔顿、民宿、青旅..." style="flex:2;min-width:200px;">
          <input class="city-input" id="searchCity" type="text" placeholder="城市（可选）" style="flex:1;min-width:100px;">
          <button class="city-btn" id="btnKeywordSearch" style="min-width:80px;">🔍 搜索</button>
        </div>
      </div>
      <div style="text-align:center;color:#889999;font-size:12px;padding:4px 0;">数据源: <b>${platNames}</b> · 携程有参考价 · 高德有定位</div>
      <div style="text-align:center;color:#889999;font-size:12px;padding:0 0 8px 0;">搜完点 + 添加为竞品</div>
      <div class="manual-search" style="border-bottom:none;display:flex;gap:8px;">
        <button class="city-btn" id="btnGpsSearch" style="flex:1;background:#fff;color:var(--primary);border:1px solid var(--primary);">📍 附近搜索</button>
        <button class="city-btn" id="btnCitySearch" style="flex:1;background:#fff;color:var(--primary);border:1px solid var(--primary);">🏙️ 城市搜索</button>
      </div>
    `;

    // Keyword search
    document.getElementById('btnKeywordSearch').onclick = async () => {
      const keyword = document.getElementById('searchKeyword').value.trim();
      const city = document.getElementById('searchCity').value.trim();
      if (!keyword) return;
      setCurrentCity(city || keyword);
      loading.innerHTML = '<div class="search-step"><span class="spinner"></span> 搜索「' + keyword + '」' + (city ? ' in ' + city : '') + '...</div>';
      const data = await API.searchKeyword(keyword, city, 100);
      if (data.error) { loading.innerHTML += '<div class="search-step err">❌ ' + data.error + '</div>'; }
      else showResults(data, currentGps, city || keyword);
    };
    document.getElementById('searchKeyword').onkeydown = e => { if (e.key === 'Enter') document.getElementById('btnKeywordSearch').click(); };

    // Nearby search
    document.getElementById('btnGpsSearch').onclick = async () => {
      loading.innerHTML = '<div class="search-step"><span class="spinner"></span> 获取定位...</div>';
      try {
        const pos = await API.getCurrentPosition();
        loading.innerHTML += '<div class="search-step done">📍 (' + pos.lat.toFixed(2) + ', ' + pos.lng.toFixed(2) + ')</div>';
        let city = '';
        try { const g = await API.reverseGeocode(pos.lat, pos.lng); city = g.city || g.district || ''; loading.innerHTML += '<div class="search-step done">🏙️ ' + city + '</div>'; } catch (e) {}
        document.getElementById('searchCity').value = city;
        setCurrentCity(city);
        currentGps = { lat: pos.lat, lng: pos.lng };
        loading.innerHTML += '<div class="search-step"><span class="spinner"></span> 搜索附近50km民宿...</div>';
        const data = await API.searchNearby(pos.lat, pos.lng, 50, 100, platParam);
        if (data.error && !data.listings?.length) loading.innerHTML += '<div class="search-step err">❌ ' + data.error + '</div>';
        else showResults(data, pos, data.city || city);
      } catch (err) {
        loading.innerHTML += '<div class="search-step" style="color:#e65100;">⚠️ GPS 不可用，请使用关键词搜索或城市搜索</div>';
      }
    };

    // City search
    document.getElementById('btnCitySearch').onclick = async () => {
      const city = document.getElementById('searchCity').value.trim() || document.getElementById('searchKeyword').value.trim();
      if (!city) { loading.innerHTML += '<div class="search-step err">❌ 请输入城市名</div>'; return; }
      setCurrentCity(city);
      loading.innerHTML = '<div class="search-step"><span class="spinner"></span> 搜索「' + city + '」酒店民宿...</div>';
      const data = await API.searchKeyword(city, city, 100);
      if (data.error) { loading.innerHTML += '<div class="search-step err">❌ ' + data.error + '</div>'; }
      else showResults(data, null, city);
    };

    // Try to pre-fill city from GPS
    try {
      const pos = await API.getCurrentPosition();
      try {
        const g = await API.reverseGeocode(pos.lat, pos.lng);
        if (g.city) { document.getElementById('searchCity').value = g.city; currentGps = { lat: pos.lat, lng: pos.lng }; }
      } catch (e) {}
    } catch (e) {}
  }

  function estimatePrice(platform, rating) {
    const base = {'民宿': 300, '酒店': 350, '公寓': 250, '青旅': 80, '度假村': 500};
    let p = base[platform] || 300;
    if (rating >= 4.5) p = Math.round(p * 1.3);
    else if (rating >= 4.0) p = Math.round(p * 1.1);
    return p;
  }

  function showResults(data, myPos, cityName) {
    const loading = document.getElementById('searchLoading');
    const results = document.getElementById('searchResults');
    const resultsList = (data.listings || []).map(l => {
      let distKm = '';
      if (l.latitude && l.longitude && myPos) {
        const d = haversine(myPos.lat, myPos.lng, l.latitude, l.longitude);
        distKm = d < 1 ? (d * 1000).toFixed(0) + 'm' : d.toFixed(1) + 'km';
      }
      // 添加估算价格
      let price = l.currentPrice || 0;
      if (!price && l.platform && l.rating) {
        price = estimatePrice(l.platform, l.rating);
      }
      return { ...l, distance: distKm, currentPrice: price };
    }).sort((a, b) => (parseFloat(a.distance) || 999) - (parseFloat(b.distance) || 999));

    loading.innerHTML += '<div class="search-step done">✅ 找到 ' + data.total + ' 个房源，显示前 ' + (resultsList?.length || 0) + ' 个</div>';

    const existingIds = new Set(listings.map(l => String(l.id).replace(/^tj_|ct_|am_/, '')));

    results.innerHTML = `
      <div class="sr-header">${cityName||''} 民宿列表 <span style="font-size:12px;color:#889999;">找到 ${data.total} 个房源 · 点击 + 添加</span></div>
      <div class="sr-list">
        ${resultsList.map((l, idx) => {
          const added = existingIds.has(String(l.unitId || l.id).replace(/^tj_|ct_|am_/, ''));
          const priceHtml = l.currentPrice > 0 ? '¥' + l.currentPrice : '<span style="color:#999;">暂无</span>';
          const occ = occLabel(l.occupancyRate, l.platform, l.rating);
          return `
            <div class="sr-item${added ? ' added' : ''}">
              <div class="sr-info">
                <div class="sr-name">${l.name} ${platformBadge(l.platform)} ${l.rating ? '<span class="sr-rating">★' + l.rating.toFixed(1) + '</span>' : ''}</div>
                <div class="sr-meta">${l.roomType || ''} · ${l.address || ''} · ${l.distance || ''} · 入住率 ${occ}</div>
              </div>
              <div class="sr-price">${priceHtml}</div>
              <button class="sr-add-btn" data-item='${JSON.stringify(l).replace(/'/g,"&#39;")}' ${added ? 'disabled' : ''}>${added ? '已添加' : '+'}</button>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
    return R*2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  // ====== 事件绑定 ======
  appEl.addEventListener('click', async (e) => {
    const platBtn = e.target.closest('.platform-btn');
    if (platBtn) {
      const p = platBtn.dataset.platform;
      const t = platBtn.dataset.type;
      if (p) {
        // Platform toggle - exclusive select
        if (activePlatforms.has(p)) {
          if (activePlatforms.size > 1) activePlatforms.delete(p);
        } else {
          activePlatforms.clear();
          activePlatforms.add(p);
        }
        // Reload data filtered by platform
        const filterPlatform = p === '携程' ? '携程' : p === '途家民宿' ? '途家民宿' : '';
        await window.loadServerCompetitors(1, filterPlatform, propertyType === 'all' ? '' : propertyType);
        listings = DataStore.getListings();
      } else if (t) {
        propertyType = t;
        await window.loadServerCompetitors(1, activePlatforms.has('携程') ? '携程' : '', t === 'all' ? '' : t);
        listings = DataStore.getListings();
      }
      render(); return;
    }

    const row = e.target.closest('tbody tr');
    if (row) { selectedId = selectedId === row.dataset.id ? null : row.dataset.id; render(); return; }

    const tab = e.target.closest('.chart-tab');
    if (tab) { chartMode = tab.dataset.mode; if (selectedId) updateChart(selectedId); render(); return; }

    const timelineItem = e.target.closest('.timeline-item');
    if (timelineItem) { selectedId = timelineItem.dataset.id; render(); return; }

    const pageBtn = e.target.closest('.page-btn');
    if (pageBtn && !pageBtn.disabled) {
      const p = parseInt(pageBtn.dataset.page);
      if (p > 0) {
        await window.loadServerCompetitors(p);
        listings = DataStore.getListings();
        render();
      }
      return;
    }

    const delBtn = e.target.closest('.del-comp-btn');
    if (delBtn) {
      const id = delBtn.dataset.del;
      if (id && confirm('确定移除这个竞品吗？')) {
        await DataStore.removeCompetitor(id);
        listings = DataStore.getListings();
        if (selectedId === id) selectedId = null;
        render();
      }
      return;
    }

    const addBtn = e.target.closest('.sr-add-btn');
    if (addBtn && !addBtn.disabled) {
      const origText = addBtn.textContent;
      addBtn.textContent = '...';
      addBtn.disabled = true;
      try {
        const item = JSON.parse(addBtn.dataset.item);
        const added = await DataStore.addCompetitor(item);
        if (added) {
          addBtn.textContent = '已添加';
          addBtn.closest('.sr-item')?.classList.add('added');
          listings = DataStore.getListings();
          render();
        } else {
          addBtn.textContent = origText;
          addBtn.disabled = false;
        }
      } catch (err) {
        addBtn.textContent = '失败';
        addBtn.disabled = false;
        setTimeout(() => { addBtn.textContent = origText; }, 1500);
      }
      return;
    }
  });

  appEl.addEventListener('change', e => { if (e.target.id === 'autoRefresh') autoRefresh = e.target.checked; });

  async function refreshData() {
    listings = DataStore.getListings();
    render();
  }

  async function updateLiveComponents() { drawThermo(); }

  // ====== 管理后台 ======
  window._hAdmin = async function () {
    try {
      const stats = await API.adminStats();
      const users = await API.adminUsers();
      const logs = await API.adminLogs();

      const modal = document.getElementById('searchModal');
      const results = document.getElementById('searchResults');
      const loading = document.getElementById('searchLoading');
      modal.style.display = 'flex';
      loading.innerHTML = '';

      results.innerHTML = `
        <div style="padding:4px 0;">
          <h3 style="margin-bottom:12px;">📊 管理后台</h3>
          <div class="admin-stats">
            <div class="admin-stat"><div class="num">${stats.users}</div><div class="lbl">总用户</div></div>
            <div class="admin-stat"><div class="num">${stats.dau}</div><div class="lbl">今日活跃</div></div>
            <div class="admin-stat"><div class="num">${stats.totalCompetitors}</div><div class="lbl">总竞品</div></div>
            <div class="admin-stat"><div class="num">${stats.todayLogs}</div><div class="lbl">今日操作</div></div>
          </div>
          <h4 style="margin:16px 0 8px;">👥 用户列表</h4>
          <table class="admin-table"><thead><tr><th>用户名</th><th>角色</th><th>城市</th><th>竞品数</th><th>最后活跃</th><th>注册时间</th></tr></thead>
            <tbody>${users.map(u => `<tr><td>${u.username}</td><td>${u.role}</td><td>${u.city}</td><td>${u.competitorCount}</td><td>${u.lastActive||'-'}</td><td>${u.created_at}</td></tr>`).join('')}</tbody>
          </table>
          <h4 style="margin:16px 0 8px;">📋 最近操作</h4>
          <div style="max-height:200px;overflow-y:auto;">${logs.slice(0,30).map(l => `<div style="font-size:12px;padding:4px 0;border-bottom:1px solid #f0f2f5;"><span style="color:#888;">${l.created_at}</span> <strong>${l.username||'?'}</strong> ${l.action} ${l.city||''}</div>`).join('')}</div>
        </div>
      `;
    } catch (e) {
      alert('需要管理员权限');
    }
  };

  // ====== 退出 ======
  window._hLogout = function () {
    API.clearAuth();
    localStorage.removeItem('homestay_user');
    window.location.reload();
  };

  // ====== 初始化 ======
  async function initApp() {
    // 默认都江堰，GPS 5秒内可用则覆盖
    try {
      const pos = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('timeout')), 5000);
        navigator.geolocation.getCurrentPosition(
          (p) => { clearTimeout(timeout); resolve(p); },
          (e) => { clearTimeout(timeout); reject(e); },
          { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 }
        );
      });
      currentGps = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      try {
        const g = await API.reverseGeocode(currentGps.lat, currentGps.lng);
        if (g.city) currentCity = g.city;
      } catch (e) {}
    } catch (e) {
      // GPS 不可用，保持默认都江堰
    }

    await window.loadServerCompetitors(1);
    listings = DataStore.getListings();
    render();

    refreshTimer = setInterval(refreshData, 30000);
    // 每5分钟自动从爬虫刷新价格
    setInterval(async () => {
      try {
        const result = await DataStore.refreshAllFromCrawler();
        if (result && result.success) {
          listings = DataStore.getListings();
          render();
        }
      } catch (e) {}
    }, 5 * 60 * 1000);
  }

  // 入口
  const token = API.getToken();
  if (token) {
    try { currentUser = JSON.parse(localStorage.getItem('homestay_user') || 'null'); } catch (e) {}
    initApp().catch(e => { console.error(e); showLogin(); });
  } else {
    showLogin();
  }

  appEl.addEventListener('click', async (e) => {
    if (e.target.id === 'btnRefreshAll' || e.target.closest('#btnRefreshAll')) {
      e.target.disabled = true;
      e.target.textContent = '⏳ 正在刷新...';
      try {
        const result = await DataStore.refreshAllFromCrawler();
        if (result && result.success) {
          listings = DataStore.getListings();
          render();
        }
        e.target.textContent = result && result.success
          ? '✅ 已刷新 ' + (result.updated || 0) + ' 个'
          : '⚠️ 刷新失败';
      } catch (err) {
        e.target.textContent = '⚠️ 刷新失败';
      }
      setTimeout(() => {
        e.target.disabled = false;
        e.target.textContent = '🔄 刷新所有价格';
      }, 3000);
      return;
    }
  });

  // 全局函数
  window._hSearch = doSearch;
  window._hAdmin = window._hAdmin;
  window._hLogout = window._hLogout;

  // 全局错误捕获上报
  window.addEventListener('error', (e) => {
    API.reportError('uncaught', e.message, e.error?.stack || '').catch(() => {});
  });
})();

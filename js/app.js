// app.js — 主渲染与交互逻辑

(function () {
  let listings = [];
  let selectedId = null;
  let activePlatforms = new Set(['美团民宿', '途家', '小猪']);
  let chartMode = '7d';
  let chart = null;
  let autoRefresh = true;
  let refreshTimer = null;
  let priceUpdateUnsub = null;
  let timelineEvents = [];
  let currentCity = '大理古城';  // 当前片区，GPS 定位后自动更新
  const appEl = document.getElementById('app');

  // 将价格变动事件加入时间线
  function addTimelineEvents(changes) {
    changes.forEach(l => {
      const diff = l.currentPrice - l.previousPrice;
      const pct = l.previousPrice > 0 ? Math.round((diff / l.previousPrice) * 100) : 0;
      timelineEvents.unshift({
        id: l.id,
        name: l.name,
        from: l.previousPrice,
        to: l.currentPrice,
        diff,
        pct,
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      });
    });
    if (timelineEvents.length > 50) timelineEvents = timelineEvents.slice(0, 50);
  }

  // 更新当前城市
  function setCurrentCity(city) {
    if (!city) return;
    currentCity = city;
    const title = document.getElementById('cityTitle');
    if (title) title.innerHTML = '🏠 ' + currentCity + '片区';
    // 持久化到 localStorage
    try { localStorage.setItem('homestay_city', city); } catch(e) {}
  }

  // ---------- 竞争指数计算 ----------
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

  // 竞争指数评级
  function indexBadge(val) {
    if (val === null || val === undefined) return { cls: '', text: '暂无' };
    if (val >= 110) return { cls: 'comp-great', text: '领先 ' + val };
    if (val >= 95) return { cls: 'comp-ok', text: '持平 ' + val };
    return { cls: 'comp-warn', text: '落后 ' + val };
  }

  // ---------- 渲染 ----------
  function render() {
    const filtered = listings.filter(l => activePlatforms.has(l.platform));
    const total = filtered.length;
    if (total === 0) { appEl.innerHTML = '<div style="text-align:center;padding:60px;color:#888;">没有匹配的民宿</div>'; return; }

    const avgPrice = Math.round(filtered.reduce((s, l) => s + l.currentPrice, 0) / total);
    const upCount = filtered.filter(l => l.currentPrice > l.previousPrice).length;
    const downCount = filtered.filter(l => l.currentPrice < l.previousPrice).length;
    const avgOcc = Math.round(filtered.reduce((s, l) => s + l.occupancyRate, 0) / total * 100);
    const ownListings = filtered.filter(l => l.isOwn);
    const sorted = [...filtered].sort((a, b) => a.currentPrice - b.currentPrice);
    const ownRanks = ownListings.map(l => sorted.findIndex(s => s.id === l.id) + 1).join('/');

    const comp = calcCompIndices();
    const mpiB = indexBadge(comp ? comp.mpi : null);
    const ariB = indexBadge(comp ? comp.ari : null);
    const rgiB = indexBadge(comp ? comp.rgi : null);
    const beating = comp && comp.mpi >= 100 && comp.ari >= 100 && comp.rgi >= 100;

    const now = new Date().toLocaleTimeString('zh-CN', { hour12: false });

    appEl.innerHTML = `
      <!-- 顶部栏 -->
      <div class="topbar">
        <div class="topbar-left">
          <h1 id="cityTitle">🏠 ${currentCity}片区</h1>
          <span class="live-badge">● 实时监控中</span>
          ${beating ? '<span class="beating-badge">🏆 击败竞品组</span>' : ''}
        </div>
        <div class="topbar-right">
          <button class="locate-btn" id="btnLocate" onclick="window._homestaySearch()">📍 定位搜竞品</button>
          <div class="platform-filters">
            ${['美团民宿', '途家', '小猪'].map(p => `
              <button class="platform-btn${activePlatforms.has(p) ? ' active' : ''}" data-platform="${p}">${p}</button>
            `).join('')}
          </div>
          <span class="refresh-info">更新于 ${now}</span>
          <label class="auto-refresh-label">
            <input type="checkbox" id="autoRefresh" ${autoRefresh ? 'checked' : ''}> 30s 自动刷新
          </label>
        </div>
      </div>

      <!-- Hero 卡片（3个核心指标） -->
      <div class="hero-cards">
        <div class="hero-card hc-price">
          <div class="hc-label">片区均价</div>
          <div class="hc-value">¥${avgPrice}</div>
          <div class="hc-sub">基于 ${total} 家民宿</div>
        </div>
        <div class="hero-card hc-occ">
          <div class="hc-label">片区平均入住率</div>
          <div class="hc-value">${avgOcc}%</div>
          <div class="hc-sub">${avgOcc >= 70 ? '旺季水平' : '淡季水平'}</div>
        </div>
        <div class="hero-card hc-rgi">
          <div class="hc-label">综合收益 RGI</div>
          <div class="hc-value" id="comp-rgi">${rgiB.text}</div>
          <div class="hc-sub">RevPAR ¥${comp ? comp.marketRevPAR : '-'} · 三项全>100 = 击败竞品组</div>
        </div>
      </div>

      <!-- 辅卡片（5个） -->
      <div class="sub-cards">
        <div class="sub-card sc-${mpiB.cls === 'comp-great' ? 'great' : mpiB.cls === 'comp-ok' ? 'ok' : 'warn'}">
          <div class="sc-label">MPI 市场渗透</div>
          <div class="sc-value" id="comp-mpi">${mpiB.text}</div>
          <div class="sc-desc">我 ${comp ? Math.round(ownListings.reduce((s,l)=>s+l.occupancyRate,0)/ownListings.length*100):'-'}% · 市场 ${comp?comp.marketAvgOcc+ '%' : '-'}</div>
        </div>
        <div class="sub-card sc-${ariB.cls === 'comp-great' ? 'great' : ariB.cls === 'comp-ok' ? 'ok' : 'warn'}">
          <div class="sc-label">ARI 均价指数</div>
          <div class="sc-value" id="comp-ari">${ariB.text}</div>
          <div class="sc-desc">我 ¥${comp?comp.ownAvgPrice:'-'} · 市场 ¥${comp?comp.marketAvgPrice:'-'}</div>
        </div>
        <div class="sub-card">
          <div class="sc-label">今日涨 / 跌</div>
          <div class="sc-value"><span class="price-up-color">${upCount}</span> / <span class="price-down-color">${downCount}</span></div>
          <div class="sc-desc">${total - upCount - downCount}家持平</div>
        </div>
        <div class="sub-card">
          <div class="sc-label">我的排名</div>
          <div class="sc-value">第${ownRanks}</div>
          <div class="sc-desc">共 ${total} 家 · 按价格竞争力</div>
        </div>
        <div class="sub-card">
          <div class="sc-label">💰 价格温度计</div>
          <canvas id="thermoCanvas"></canvas>
          <div class="sc-desc" id="thermoLabel">市场 ¥${comp ? comp.marketMin : '-'} ~ ¥${comp ? comp.marketMax : '-'}</div>
        </div>
      </div>

      <!-- 主内容 -->
      <div class="main-content">
        <!-- 左: 表格 -->
        <div class="left-panel">
          <div class="panel-header">📋 民宿价格一览</div>
          <div style="overflow-x:auto;">
            <table class="listings-table">
              <thead>
                <tr>
                  <th>民宿</th><th>平台</th><th>房型</th><th>现价</th><th>变动</th><th>入住率</th><th>距离</th><th></th>
                </tr>
              </thead>
              <tbody>
                ${filtered.map(l => {
                  const diff = l.currentPrice - l.previousPrice;
                  const pct = l.previousPrice > 0 ? Math.round((diff / l.previousPrice) * 100) : 0;
                  const changeClass = diff > 0 ? 'price-up-color' : diff < 0 ? 'price-down-color' : '';
                  const changeText = diff > 0 ? `↑${pct}%` : diff < 0 ? `↓${Math.abs(pct)}%` : '-';
                  const occPct = Math.round(l.occupancyRate * 100);
                  return `
                    <tr class="${l.isOwn ? 'own' : ''}${selectedId === l.id ? ' selected' : ''}" data-id="${l.id}">
                      <td><strong>${l.name}</strong>${l.isOwn ? '<span class="own-tag">我的</span>' : ''}</td>
                      <td>${l.platform}</td>
                      <td>${l.roomType}</td>
                      <td><strong>¥${l.currentPrice}</strong></td>
                      <td><span class="price-change ${changeClass}">${changeText}</span></td>
                      <td>${occPct}%<span class="occupancy-bar"><span class="occupancy-bar-fill" style="width:${occPct}%"></span></span></td>
                      <td>${l.distance}</td>
                      <td>${l.source === 'tujia' && !l.isOwn ? `<button class="del-comp-btn" data-del="${l.id}" title="移除此竞品">✕</button>` : ''}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- 右: 图表 + 时间线 -->
        <div class="right-panel">
          <div class="chart-card">
            <div class="card-title">📈 ${selectedId ? (listings.find(l => l.id === selectedId) || {}).name || '选择民宿' : '选择一家民宿'}</div>
            <div class="card-subtitle" id="chartStats"></div>
            <div class="chart-tabs">
              <button class="chart-tab${chartMode === '7d' ? ' active' : ''}" data-mode="7d">7天</button>
              <button class="chart-tab${chartMode === '24h' ? ' active' : ''}" data-mode="24h">24小时</button>
            </div>
            <div class="chart-container">
              <canvas id="priceChart"></canvas>
            </div>
          </div>
          <div class="timeline-card">
            <div class="card-title" style="margin-bottom:8px;">🔔 最近调价记录</div>
            <div class="timeline-list">
              ${timelineEvents.slice(0, 12).map(e => {
                const cls = e.diff > 0 ? 'price-up-color' : e.diff < 0 ? 'price-down-color' : '';
                return `
                  <div class="timeline-item" data-id="${e.id}">
                    <span>${e.name} <span class="${cls}">${e.diff > 0 ? '↑' : e.diff < 0 ? '↓' : '→'} ¥${e.from}→¥${e.to} (${e.pct > 0 ? '+' : ''}${e.pct}%)</span></span>
                    <span class="timeline-time">${e.time}</span>
                  </div>
                `;
              }).join('')}
              ${timelineEvents.length === 0 ? '<div style="text-align:center;color:#888;padding:20px;">等待调价事件...</div>' : ''}
            </div>
          </div>
        </div>
      </div>
    `;

    // 更新图表
    if (selectedId) {
      updateChart(selectedId);
    }
    // 绘制价格温度计
    drawThermo();
  }

  function updateChart(id) {
    const canvas = document.getElementById('priceChart');
    if (!canvas) return;
    if (!chart) chart = new PriceChart(canvas);
    const history = DataStore.getPriceHistory(id);
    chart.setData(history, chartMode);

    const listing = listings.find(l => l.id === id);
    if (listing && history.length > 0) {
      const last7 = history.filter(d => d.time >= Date.now() - 7 * 24 * 60 * 60 * 1000);
      const minP = Math.min(...last7.map(d => d.price));
      const maxP = Math.max(...last7.map(d => d.price));
      const statEl = document.getElementById('chartStats');
      if (statEl) {
        statEl.textContent = `近7天最低 ¥${minP} · 最高 ¥${maxP} · 当前 ¥${listing.currentPrice}`;
      }
    }
  }

  // ---------- 价格温度计 ----------
  function drawThermo() {
    const canvas = document.getElementById('thermoCanvas');
    if (!canvas) return;
    const comp = calcCompIndices();
    if (!comp) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 300;
    const H = 64;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const pad = 12;
    const barH = 18;
    const barY = 12;
    const barW = W - pad * 2;
    const tickY = barY + barH;

    const range = comp.marketMax - comp.marketMin || 1;
    const x = (price) => pad + ((price - comp.marketMin) / range) * barW;

    // 辅助：绘制圆角矩形
    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.arcTo(x + w, y, x + w, y + r, r);
      ctx.lineTo(x + w, y + h - r);
      ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
      ctx.lineTo(x + r, y + h);
      ctx.arcTo(x, y + h, x, y + h - r, r);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.closePath();
    }

    // 温度计背景条（绿→黄→红渐变）
    const grad = ctx.createLinearGradient(pad, 0, pad + barW, 0);
    grad.addColorStop(0, '#43a047');
    grad.addColorStop(0.5, '#f9a825');
    grad.addColorStop(1, '#e53935');
    ctx.fillStyle = grad;
    roundRect(pad, barY, barW, barH, 4);
    ctx.fill();

    // P25 到 P75 区间高亮
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    roundRect(x(comp.marketP25), barY, x(comp.marketP75) - x(comp.marketP25), barH, 4);
    ctx.fill();

    // 市场中位数标记
    const midX = x(comp.marketAvgPrice);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(midX, barY - 3);
    ctx.lineTo(midX, tickY + 8);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('市场均价¥' + comp.marketAvgPrice, midX, tickY + 22);

    // 刻度标签
    ctx.fillStyle = '#888';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('¥' + comp.marketMin, pad, tickY + 14);
    ctx.textAlign = 'right';
    ctx.fillText('¥' + comp.marketMax, pad + barW, tickY + 14);

    // 我的民宿价格标记
    if (comp.ownListings && comp.ownListings.length > 0) {
      comp.ownListings.forEach(own => {
        const ox = Math.max(pad, Math.min(pad + barW, x(own.price)));
        // 三角形标记
        ctx.fillStyle = '#1a237e';
        ctx.beginPath();
        ctx.moveTo(ox, barY + barH + 6);
        ctx.lineTo(ox - 6, barY + barH + 18);
        ctx.lineTo(ox + 6, barY + barH + 18);
        ctx.closePath();
        ctx.fill();
        // 小圆点
        ctx.fillStyle = '#1a237e';
        ctx.beginPath();
        ctx.arc(ox, barY + barH / 2, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      });
    }

    // 更新下方标签
    const label = document.getElementById('thermoLabel');
    if (label) {
      const posDesc = comp.ownAvgPrice < comp.marketP25 ? '← 价格偏低，有竞争力'
        : comp.ownAvgPrice > comp.marketP75 ? '→ 价格偏高，可能失去客源'
        : '在市场中位区间';
      label.textContent = `市场 ¥${comp.marketMin} ~ ¥${comp.marketMax} · ${posDesc}`;
    }
  }

  // ---------- 事件绑定 ----------
  appEl.addEventListener('click', e => {
    const platBtn = e.target.closest('.platform-btn');
    if (platBtn) {
      const p = platBtn.dataset.platform;
      if (activePlatforms.has(p)) {
        if (activePlatforms.size > 1) activePlatforms.delete(p);
      } else {
        activePlatforms.add(p);
      }
      render();
      return;
    }

    const row = e.target.closest('tbody tr');
    if (row) {
      const id = parseInt(row.dataset.id);
      selectedId = selectedId === id ? null : id;
      render();
      return;
    }

    const tab = e.target.closest('.chart-tab');
    if (tab) {
      chartMode = tab.dataset.mode;
      if (selectedId) updateChart(selectedId);
      render();
      return;
    }

    const timelineItem = e.target.closest('.timeline-item');
    if (timelineItem) {
      selectedId = parseInt(timelineItem.dataset.id);
      render();
      return;
    }

    // 删除竞品按钮
    const delBtn = e.target.closest('.del-comp-btn');
    if (delBtn) {
      const id = delBtn.dataset.del;
      if (id && confirm('确定移除这个竞品吗？')) {
        API.removeCompetitor(id);
        listings = listings.filter(l => l.id !== id);
        if (selectedId === id) selectedId = null;
        render();
      }
      return;
    }
  });

  appEl.addEventListener('change', e => {
    if (e.target.id === 'autoRefresh') {
      autoRefresh = e.target.checked;
    }
  });

  // ---------- 数据刷新 ----------
  async function refreshData() {
    listings = await API.fetchListings();
    render();
  }

  // ---------- 启动 ----------
  async function init() {
    // 恢复上次使用的城市
    try {
      const savedCity = localStorage.getItem('homestay_city');
      if (savedCity) currentCity = savedCity;
    } catch(e) {}

    listings = await API.fetchListings();

    priceUpdateUnsub = API.onPriceUpdate(changes => {
      changes.forEach(ch => {
        const local = listings.find(l => l.id === ch.id);
        if (local) {
          local.previousPrice = ch.previousPrice;
          local.currentPrice = ch.currentPrice;
          local.occupancyRate = ch.occupancyRate;
        }
      });
      addTimelineEvents(changes);
      if (selectedId && changes.some(c => c.id === selectedId)) {
        updateChart(selectedId);
      }
      updateLiveComponents();
    });

    refreshTimer = setInterval(refreshData, 30000);
    render();
    DataStore.startSimulation();
  }

  // 轻量更新
  function updateLiveComponents() {
    const filtered = listings.filter(l => activePlatforms.has(l.platform));
    if (filtered.length === 0) return;
    const total = filtered.length;
    const avgPrice = Math.round(filtered.reduce((s, l) => s + l.currentPrice, 0) / total);
    const upCount = filtered.filter(l => l.currentPrice > l.previousPrice).length;
    const downCount = filtered.filter(l => l.currentPrice < l.previousPrice).length;
    const avgOcc = Math.round(filtered.reduce((s, l) => s + l.occupancyRate, 0) / total * 100);
    const sorted = [...filtered].sort((a, b) => a.currentPrice - b.currentPrice);
    const ownListings = filtered.filter(l => l.isOwn);
    const ownRanks = ownListings.map(l => sorted.findIndex(s => s.id === l.id) + 1).join('/');

    // 更新 Hero 卡片
    const heroValues = document.querySelectorAll('.hero-card .hc-value');
    if (heroValues[0]) heroValues[0].textContent = '¥' + avgPrice;
    if (heroValues[1]) heroValues[1].textContent = avgOcc + '%';

    // 更新竞争指数
    const comp = calcCompIndices();
    if (comp && comp.mpi !== null) {
      const mpiB = indexBadge(comp.mpi);
      const ariB = indexBadge(comp.ari);
      const rgiB = indexBadge(comp.rgi);
      const mpiEl = document.getElementById('comp-mpi');
      const ariEl = document.getElementById('comp-ari');
      const rgiEl = document.getElementById('comp-rgi');
      if (mpiEl) { mpiEl.textContent = mpiB.text; mpiEl.className = 'comp-value ' + mpiB.cls; }
      if (ariEl) { ariEl.textContent = ariB.text; ariEl.className = 'comp-value ' + ariB.cls; }
      if (rgiEl) { rgiEl.textContent = rgiB.text; rgiEl.className = 'comp-value ' + rgiB.cls; }
    }

    // 更新时间线
    const tlList = document.querySelector('.timeline-list');
    if (tlList) {
      tlList.innerHTML = timelineEvents.slice(0, 12).map(e => {
        const cls = e.diff > 0 ? 'price-up-color' : e.diff < 0 ? 'price-down-color' : '';
        return `
          <div class="timeline-item" data-id="${e.id}">
            <span>${e.name} <span class="${cls}">${e.diff > 0 ? '↑' : e.diff < 0 ? '↓' : '→'} ¥${e.from}→¥${e.to} (${e.pct > 0 ? '+' : ''}${e.pct}%)</span></span>
            <span class="timeline-time">${e.time}</span>
          </div>
        `;
      }).join('') || '<div style="text-align:center;color:#888;padding:20px;">等待调价事件...</div>';
    }

    const refreshInfo = document.querySelector('.refresh-info');
    if (refreshInfo) {
      refreshInfo.textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
    }

    // 更新价格温度计
    drawThermo();
    // 更新击败徽章
    const beating = comp && comp.mpi >= 100 && comp.ari >= 100 && comp.rgi >= 100;
    const existingBadge = document.querySelector('.beating-badge');
    if (beating && !existingBadge) {
      const left = document.querySelector('.topbar-left');
      if (left) {
        const badge = document.createElement('span');
        badge.className = 'beating-badge';
        badge.textContent = '🏆 击败竞品组';
        left.appendChild(badge);
      }
    } else if (!beating && existingBadge) {
      existingBadge.remove();
    }
  }

  // ---------- 定位搜索竞品 ----------
  let searchResultsCache = [];

  async function doSearch() {
    const modal = document.getElementById('searchModal');
    const loading = document.getElementById('searchLoading');
    const resultsEl = document.getElementById('searchResults');

    // 立即弹出面板
    modal.style.display = 'flex';
    loading.innerHTML = '';
    resultsEl.innerHTML = `
      <div class="manual-search">
        <input class="city-input" id="manualCity" type="text" placeholder="输入城市名，如: 大理、上海、成都、丽江...">
        <button class="city-btn" id="btnManualSearch">搜索</button>
      </div>
      <div class="search-hint">💡 点击「搜索」直接查，或用下方「定位搜」自动识别城市</div>
      <div class="manual-search" style="border-bottom:none;">
        <button class="city-btn" id="btnGpsSearch" style="background:#fff;color:var(--primary);border:1px solid var(--primary);">📍 定位自动搜</button>
      </div>
    `;

    // 手动搜索按钮
    document.getElementById('btnManualSearch').onclick = async function () {
      const city = document.getElementById('manualCity').value.trim();
      if (!city) return;
      setCurrentCity(city);
      loading.innerHTML = '<div class="search-step"><span class="spinner"></span> 正在搜索「' + city + '」...</div>';
      const data = await API.searchTujia(city, 0, 30);
      if (data.error) {
        loading.innerHTML += '<div class="search-step err">❌ ' + data.error + '</div>';
      } else {
        showResults(data, null, city);
      }
    };

    // 回车也搜
    document.getElementById('manualCity').onkeydown = function (e) {
      if (e.key === 'Enter') document.getElementById('btnManualSearch').click();
    };

    // GPS 定位搜索按钮
    document.getElementById('btnGpsSearch').onclick = async function () {
      loading.innerHTML = '<div class="search-step"><span class="spinner"></span> 正在获取定位...</div>';
      try {
        const pos = await API.getCurrentPosition();
        loading.innerHTML += '<div class="search-step done">📍 定位成功: ' + pos.lat.toFixed(4) + ', ' + pos.lng.toFixed(4) + '</div>';

        let city = '大理';
        try {
          const geo = await API.reverseGeocode(pos.lat, pos.lng);
          city = geo.city || geo.district || '大理';
          loading.innerHTML += '<div class="search-step done">🏙️ 识别城市: ' + city + '</div>';
        } catch (e) {
          loading.innerHTML += '<div class="search-step done">📍 默认城市: 大理</div>';
        }

        // 自动填到输入框，更新标题
        document.getElementById('manualCity').value = city;
        setCurrentCity(city);

        loading.innerHTML += '<div class="search-step"><span class="spinner"></span> 正在搜索「' + city + '」附近民宿...</div>';
        const data = await API.searchTujia(city, 0, 30);
        if (data.error) {
          loading.innerHTML += '<div class="search-step err">❌ ' + data.error + '</div>';
        } else {
          showResults(data, pos, city);
        }
      } catch (err) {
        loading.innerHTML += '<div class="search-step" style="color:#e65100;">⚠️ 定位失败: ' + (err.message || '请检查浏览器权限') + '</div>';
        loading.innerHTML += '<div class="search-step">👉 请在上方手动输入城市名搜索</div>';
      }
    };

    // 自动尝试定位，静默填充城市名
    try {
      const pos = await API.getCurrentPosition();
      try {
        const geo = await API.reverseGeocode(pos.lat, pos.lng);
        const city = geo.city || geo.district || '';
        if (city) {
          document.getElementById('manualCity').value = city;
          document.getElementById('manualCity').placeholder = '已识别: ' + city;
        }
      } catch (e) { /* 静默失败 */ }
    } catch (e) { /* 静默失败 */ }
  }

  function showResults(data, myPos, cityName) {
    const loading = document.getElementById('searchLoading');
    const results = document.getElementById('searchResults');
    const cityLabel = cityName || '';

    // 计算距离并排序
    const resultsList = (data.listings || []).map((l) => {
      let distKm = '';
      if (l.latitude && l.longitude && myPos) {
        const d = haversine(myPos.lat, myPos.lng, l.latitude, l.longitude);
        distKm = d < 1 ? (d * 1000).toFixed(0) + 'm' : d.toFixed(1) + 'km';
      }
      return { ...l, distance: distKm };
    }).sort((a, b) => {
      const da = parseFloat(a.distance) || 999;
      const db = parseFloat(b.distance) || 999;
      return da - db;
    });

    searchResultsCache = resultsList;
    loading.innerHTML += '<div class="search-step done">✅ 找到 ' + data.total + ' 个房源，显示前 ' + resultsList.length + ' 个</div>';

    results.innerHTML = `
      <div class="sr-header">${cityLabel} 民宿列表 <span style="font-size:12px;color:#889999;">找到 ${data.total} 个房源 · 点击 + 添加为竞品</span></div>
      <div class="sr-list">
        ${resultsList.map((l, idx) => {
          const savedCompetitors = JSON.parse(localStorage.getItem('homestay_competitors') || '[]');
          const added = savedCompetitors.find((x) => x.id === l.id);
          return `
            <div class="sr-item${added ? ' added' : ''}" data-idx="${idx}">
              <div class="sr-info">
                <div class="sr-name">${l.name} ${l.rating ? '<span class="sr-rating">★' + l.rating.toFixed(1) + '</span>' : ''}</div>
                <div class="sr-meta">${l.roomType} · ${l.address || ''} · ${l.distance || ''} · ${l.reviews || 0}条点评</div>
              </div>
              <div class="sr-price">¥${l.currentPrice}</div>
              <button class="sr-add-btn" data-item='${JSON.stringify(l).replace(/'/g, "&#39;")}' ${added ? 'disabled' : ''}>
                ${added ? '已添加' : '+'}
              </button>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // Haversine 距离计算
  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // 搜索结果中点击添加竞品
  document.getElementById('searchResults').addEventListener('click', (e) => {
    const btn = e.target.closest('.sr-add-btn');
    if (!btn || btn.disabled) return;
    try {
      const item = JSON.parse(btn.dataset.item);
      const added = API.addCompetitor(item);
      if (added) {
        btn.disabled = true;
        btn.textContent = '已添加';
        btn.closest('.sr-item')?.classList.add('added');
        // 刷新列表
        listings = listings.filter(l => true); // trigger re-sort
        refreshData();
      }
    } catch (err) {
      console.error('添加失败:', err);
    }
  });

  // 关闭搜索面板的点击
  document.getElementById('searchModal').addEventListener('click', function (e) {
    if (e.target === this) {
      this.style.display = 'none';
    }
  });

  // 暴露全局搜索函数
  window._homestaySearch = doSearch;

  init();
})();

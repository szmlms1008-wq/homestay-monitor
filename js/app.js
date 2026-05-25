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

    const now = new Date().toLocaleTimeString('zh-CN', { hour12: false });

    appEl.innerHTML = `
      <!-- 顶部栏 -->
      <div class="topbar">
        <div class="topbar-left">
          <h1>🏠 大理古城片区</h1>
          <span class="live-badge">● 实时监控中</span>
        </div>
        <div class="topbar-right">
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

      <!-- 指标卡片 -->
      <div class="summary-cards">
        <div class="summary-card">
          <div class="label">片区均价</div>
          <div class="value">¥${avgPrice}</div>
          <div class="change flat">基于 ${total} 家民宿</div>
        </div>
        <div class="summary-card">
          <div class="label">今日涨价 / 降价</div>
          <div class="value"><span class="price-up-color">${upCount}家</span> / <span class="price-down-color">${downCount}家</span></div>
          <div class="change flat">${total - upCount - downCount}家持平</div>
        </div>
        <div class="summary-card">
          <div class="label">片区平均入住率</div>
          <div class="value">${avgOcc}%</div>
          <div class="change ${avgOcc >= 70 ? 'up' : 'down'}">${avgOcc >= 70 ? '旺季水平' : '淡季水平'}</div>
        </div>
        <div class="summary-card">
          <div class="label">我的排名</div>
          <div class="value">第${ownRanks} / ${total}</div>
          <div class="change flat">按价格竞争力</div>
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
                  <th>民宿</th><th>平台</th><th>房型</th><th>现价</th><th>变动</th><th>入住率</th><th>距离</th>
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
  }

  function updateChart(id) {
    const canvas = document.getElementById('priceChart');
    if (!canvas) return;
    if (!chart) chart = new PriceChart(canvas);
    const history = DataStore.getPriceHistory(id);
    chart.setData(history, chartMode);

    // 更新统计信息
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

  // ---------- 事件绑定 ----------
  appEl.addEventListener('click', e => {
    // 平台筛选按钮
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

    // 表格行: 选中民宿
    const row = e.target.closest('tbody tr');
    if (row) {
      const id = parseInt(row.dataset.id);
      selectedId = selectedId === id ? null : id;
      render();
      return;
    }

    // 图表时间切换
    const tab = e.target.closest('.chart-tab');
    if (tab) {
      chartMode = tab.dataset.mode;
      if (selectedId) updateChart(selectedId);
      render();
      return;
    }

    // 时间线条目: 选中民宿
    const timelineItem = e.target.closest('.timeline-item');
    if (timelineItem) {
      selectedId = parseInt(timelineItem.dataset.id);
      render();
      return;
    }
  });

  // 自动刷新开关
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
    listings = await API.fetchListings();

    // 订阅实时价格变动
    priceUpdateUnsub = API.onPriceUpdate(changes => {
      // 更新本地数据
      changes.forEach(ch => {
        const local = listings.find(l => l.id === ch.id);
        if (local) {
          local.previousPrice = ch.previousPrice;
          local.currentPrice = ch.currentPrice;
          local.occupancyRate = ch.occupancyRate;
        }
      });
      addTimelineEvents(changes);
      // 只更新时间线和图表，不全量重渲染（避免表格闪烁）
      if (selectedId && changes.some(c => c.id === selectedId)) {
        updateChart(selectedId);
      }
      // 更新指标卡片和时间线（轻量刷新）
      updateLiveComponents();
    });

    // 定时全量刷新
    refreshTimer = setInterval(refreshData, 30000);

    render();

    // 启动价格模拟
    DataStore.startSimulation();
  }

  // 轻量更新（价格变动时，不重绘整个 DOM）
  function updateLiveComponents() {
    // 更新指标卡片
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

    const cards = document.querySelectorAll('.summary-card .value');
    if (cards[0]) cards[0].textContent = '¥' + avgPrice;
    if (cards[1]) cards[1].innerHTML = '<span class="price-up-color">' + upCount + '家</span> / <span class="price-down-color">' + downCount + '家</span>';
    if (cards[2]) cards[2].textContent = avgOcc + '%';
    if (cards[3]) cards[3].textContent = '第' + ownRanks + ' / ' + total;

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

    // 更新刷新时间
    const refreshInfo = document.querySelector('.refresh-info');
    if (refreshInfo) {
      refreshInfo.textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
    }
  }

  init();
})();

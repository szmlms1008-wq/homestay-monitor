// data.js — 客户端数据模型（多用户版，竞品从服务器加载）

const PLATFORMS = ['美团民宿', '途家', '小猪'];
const ROOM_TYPES = ['大床房', '标间', '套房'];

// 初始民宿列表（自己的房源，写死在前端）
const INITIAL_LISTINGS = [
  { id: 'own_1', name: '山水间民宿', platform: '美团民宿', roomType: '大床房', currentPrice: 328, occupancyRate: 0.85, isOwn: true,  distance: '0.3km', source: 'manual' },
  { id: 'own_2', name: '慢时光',     platform: '途家',     roomType: '大床房', currentPrice: 298, occupancyRate: 0.72, isOwn: true,  distance: '0.4km', source: 'manual' },
  { id: 'own_3', name: '山猪迷路',   platform: '美团民宿', roomType: '大床房', currentPrice: 380, occupancyRate: 0.78, isOwn: true,  distance: '0.2km', source: 'manual' },
];

function generatePriceHistory(basePrice) {
  const history = [];
  const now = Date.now();
  for (let i = 84; i >= 0; i--) {
    const time = now - i * 2 * 60 * 60 * 1000;
    const variance = (Math.random() - 0.5) * basePrice * 0.2;
    const price = Math.round(basePrice + variance);
    history.push({ time, price });
  }
  return history;
}

// 全局竞品列表 = 自己的房源 + 从服务器加载的竞品
let listings = INITIAL_LISTINGS.map(l => ({ ...l, previousPrice: l.currentPrice, priceHistory: generatePriceHistory(l.currentPrice) }));
let serverCompetitors = [];

// 从服务器加载竞品
async function loadServerCompetitors() {
  const token = localStorage.getItem('homestay_token');
  if (!token) return;

  try {
    const data = await API.fetchCompetitors();
    if (Array.isArray(data)) {
      serverCompetitors = data.map(c => ({
        id: 'tj_' + c.id,
        name: c.name,
        platform: c.platform,
        roomType: c.roomType,
        currentPrice: c.currentPrice,
        previousPrice: c.previousPrice || c.currentPrice,
        occupancyRate: c.occupancyRate,
        longitude: c.longitude,
        latitude: c.latitude,
        address: c.address,
        rating: c.rating,
        reviews: c.reviews,
        distance: c.distance,
        source: c.source || 'tujia',
        isOwn: false,
        priceHistory: generatePriceHistory(c.currentPrice),
      }));
      rebuildListings();
    }
  } catch (e) {
    console.error('加载竞品失败:', e);
  }
}

function rebuildListings() {
  listings = [
    ...INITIAL_LISTINGS.map(l => ({ ...l, previousPrice: l.currentPrice, priceHistory: generatePriceHistory(l.currentPrice) })),
    ...serverCompetitors,
  ];
}

// listener
const listeners = [];
let simulationRunning = false;
let simulationTimer = null;

function simulatePriceChange() {
  if (listings.length === 0) return;
  const count = 1 + Math.floor(Math.random() * 3);
  const indices = new Set();
  while (indices.size < count) {
    indices.add(Math.floor(Math.random() * listings.length));
  }
  const changed = [];
  indices.forEach(i => {
    const listing = listings[i];
    const changePct = (Math.random() - 0.5) * 0.16;
    const newPrice = Math.max(50, Math.round(listing.currentPrice * (1 + changePct)));
    listing.previousPrice = listing.currentPrice;
    listing.currentPrice = newPrice;
    listing.priceHistory.push({ time: Date.now(), price: newPrice });
    if (listing.priceHistory.length > 200) listing.priceHistory = listing.priceHistory.slice(-200);
    listing.occupancyRate = Math.min(1, Math.max(0.2, listing.occupancyRate + (Math.random() - 0.5) * 0.05));
    changed.push(listing);
  });
  listeners.forEach(fn => fn(changed));
}

function startSimulation() {
  if (simulationRunning) return;
  simulationRunning = true;
  function tick() {
    if (!simulationRunning) return;
    simulatePriceChange();
    simulationTimer = setTimeout(tick, 5000 + Math.random() * 10000);
  }
  tick();
}

function stopSimulation() {
  simulationRunning = false;
  if (simulationTimer) { clearTimeout(simulationTimer); simulationTimer = null; }
}

const DataStore = {
  getListings() {
    return listings.map(l => ({
      id: l.id, name: l.name, platform: l.platform,
      roomType: l.roomType, currentPrice: l.currentPrice,
      previousPrice: l.previousPrice, occupancyRate: l.occupancyRate,
      isOwn: l.isOwn, distance: l.distance, source: l.source,
      longitude: l.longitude, latitude: l.latitude,
      rating: l.rating, reviews: l.reviews,
    }));
  },

  getPriceHistory(id) {
    const listing = listings.find(l => l.id === id);
    return listing ? [...listing.priceHistory] : [];
  },

  async addCompetitor(item) {
    const exists = serverCompetitors.find(c => c.name === item.name && c.platform === item.platform);
    if (exists) return false;
    try {
      const result = await API.addCompetitor(item);
      if (result.success) {
        await loadServerCompetitors();
        return true;
      }
    } catch (e) {
      console.error('添加竞品失败:', e);
    }
    return false;
  },

  async removeCompetitor(id) {
    const numericId = String(id).replace('tj_', '');
    if (!numericId || isNaN(parseInt(numericId))) return false;
    try {
      await API.removeCompetitor(parseInt(numericId));
      await loadServerCompetitors();
      return true;
    } catch (e) {
      console.error('删除竞品失败:', e);
      return false;
    }
  },

  onUpdate(fn) {
    listeners.push(fn);
    return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  },

  startSimulation,
  stopSimulation,

  getMarketStats() {
    const all = listings.map(l => ({ price: l.currentPrice, occupancy: l.occupancyRate }));
    const total = all.length;
    if (total === 0) return { avgPrice: 0, avgOccupancy: 0, avgRevPAR: 0, total: 0, min: 0, max: 0, p25: 0, p50: 0, p75: 0 };
    const avgPrice = Math.round(all.reduce((s, l) => s + l.price, 0) / total);
    const avgOccupancy = all.reduce((s, l) => s + l.occupancy, 0) / total;
    const avgRevPAR = Math.round(avgPrice * avgOccupancy);
    const prices = all.map(l => l.price).sort((a, b) => a - b);
    return {
      avgPrice, avgOccupancy, avgRevPAR, total,
      min: prices[0], max: prices[total - 1],
      p25: prices[Math.floor(total * 0.25)], p50: prices[Math.floor(total * 0.5)], p75: prices[Math.floor(total * 0.75)],
    };
  },
};

window.DataStore = DataStore;
window.loadServerCompetitors = loadServerCompetitors;

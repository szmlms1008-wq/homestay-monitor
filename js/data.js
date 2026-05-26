// data.js — 数据模型与模拟器（支持本地竞品存储）

const PLATFORMS = ['美团民宿', '途家', '小猪'];
const ROOM_TYPES = ['大床房', '标间', '套房'];
const STORAGE_KEY = 'homestay_competitors';

// 初始民宿列表
const INITIAL_LISTINGS = [
  { id: 1,  name: '山水间民宿', platform: '美团民宿', roomType: '大床房', currentPrice: 328, occupancyRate: 0.85, isOwn: true,  distance: '0.3km', source: 'manual' },
  { id: 2,  name: '云栖小筑',   platform: '途家',     roomType: '大床房', currentPrice: 268, occupancyRate: 0.60, isOwn: false, distance: '0.8km', source: 'manual' },
  { id: 3,  name: '听风阁',     platform: '小猪',     roomType: '标间',   currentPrice: 358, occupancyRate: 0.90, isOwn: false, distance: '0.5km', source: 'manual' },
  { id: 4,  name: '花间堂',     platform: '美团民宿', roomType: '套房',   currentPrice: 458, occupancyRate: 0.78, isOwn: false, distance: '1.0km', source: 'manual' },
  { id: 5,  name: '竹隐居',     platform: '途家',     roomType: '大床房', currentPrice: 218, occupancyRate: 0.45, isOwn: false, distance: '1.5km', source: 'manual' },
  { id: 6,  name: '望山居',     platform: '小猪',     roomType: '套房',   currentPrice: 388, occupancyRate: 0.70, isOwn: false, distance: '1.2km', source: 'manual' },
  { id: 7,  name: '暖阳小院',   platform: '美团民宿', roomType: '标间',   currentPrice: 198, occupancyRate: 0.55, isOwn: false, distance: '0.6km', source: 'manual' },
  { id: 8,  name: '慢时光',     platform: '途家',     roomType: '大床房', currentPrice: 298, occupancyRate: 0.72, isOwn: true,  distance: '0.4km', source: 'manual' },
  { id: 9,  name: '苍山雪',     platform: '小猪',     roomType: '大床房', currentPrice: 278, occupancyRate: 0.65, isOwn: false, distance: '0.9km', source: 'manual' },
  { id: 10, name: '洱海月',     platform: '美团民宿', roomType: '套房',   currentPrice: 528, occupancyRate: 0.82, isOwn: false, distance: '1.8km', source: 'manual' },
  { id: 11, name: '白族人家',   platform: '途家',     roomType: '标间',   currentPrice: 238, occupancyRate: 0.50, isOwn: false, distance: '1.1km', source: 'manual' },
  { id: 12, name: '古城边',     platform: '美团民宿', roomType: '大床房', currentPrice: 348, occupancyRate: 0.88, isOwn: false, distance: '0.7km', source: 'manual' },
];

// 生成最近7天的历史价格
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

// 加载竞品（合并初始列表 + localStorage 中添加的）
function loadCompetitors() {
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch (e) {
    saved = [];
  }
  return saved;
}

function saveCompetitors(competitors) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(competitors));
}

// 从 localStorage 加载竞品列表，与初始列表合并
let savedCompetitors = loadCompetitors();
let listings = [...INITIAL_LISTINGS];

// 合并 saved 数据
savedCompetitors.forEach((saved) => {
  const exists = listings.find((l) => l.id === saved.id);
  if (!exists) {
    listings.push({
      ...saved,
      previousPrice: saved.currentPrice,
      priceHistory: generatePriceHistory(saved.currentPrice),
    });
  } else {
    // 更新已存在的竞品数据
    Object.assign(exists, saved);
  }
});

// listener
const listeners = [];
let simulationRunning = false;
let simulationTimer = null;

function simulatePriceChange() {
  const count = 1 + Math.floor(Math.random() * 3);
  const indices = new Set();
  while (indices.size < count) {
    indices.add(Math.floor(Math.random() * listings.length));
  }

  const changed = [];
  indices.forEach((i) => {
    const listing = listings[i];
    const changePct = (Math.random() - 0.5) * 0.16;
    const newPrice = Math.max(50, Math.round(listing.currentPrice * (1 + changePct)));
    listing.previousPrice = listing.currentPrice;
    listing.currentPrice = newPrice;
    listing.priceHistory.push({ time: Date.now(), price: newPrice });
    if (listing.priceHistory.length > 200) {
      listing.priceHistory = listing.priceHistory.slice(-200);
    }
    listing.occupancyRate = Math.min(1, Math.max(0.2,
      listing.occupancyRate + (Math.random() - 0.5) * 0.05
    ));
    changed.push(listing);
  });

  listeners.forEach((fn) => fn(changed));
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
    return listings.map((l) => ({
      id: l.id, name: l.name, platform: l.platform,
      roomType: l.roomType, currentPrice: l.currentPrice,
      previousPrice: l.previousPrice, occupancyRate: l.occupancyRate,
      isOwn: l.isOwn, distance: l.distance, source: l.source,
      longitude: l.longitude, latitude: l.latitude,
      rating: l.rating, reviews: l.reviews,
    }));
  },

  getPriceHistory(id) {
    const listing = listings.find((l) => l.id === id);
    return listing ? [...listing.priceHistory] : [];
  },

  // 添加竞品（从途家搜索结果）
  addCompetitor(item) {
    const id = item.id || ('tj_' + Date.now());
    const exists = listings.find((l) => l.id === id);
    if (exists) return false;

    const newListing = {
      ...item,
      id,
      isOwn: false,
      source: 'tujia',
      previousPrice: item.currentPrice,
      occupancyRate: item.occupancyRate || 0.6,
      distance: item.distance || '',
      priceHistory: generatePriceHistory(item.currentPrice),
    };
    listings.push(newListing);

    // 保存到 localStorage
    savedCompetitors.push({
      id, name: item.name, platform: item.platform,
      roomType: item.roomType, currentPrice: item.currentPrice,
      occupancyRate: newListing.occupancyRate,
      isOwn: false, distance: item.distance || '',
      source: 'tujia', longitude: item.longitude,
      latitude: item.latitude, rating: item.rating,
      reviews: item.reviews,
    });
    saveCompetitors(savedCompetitors);
    return true;
  },

  // 删除竞品
  removeCompetitor(id) {
    const idx = listings.findIndex((l) => l.id === id);
    if (idx === -1) return false;
    if (listings[idx].isOwn || listings[idx].source === 'manual') return false;
    listings.splice(idx, 1);
    savedCompetitors = savedCompetitors.filter((s) => s.id !== id);
    saveCompetitors(savedCompetitors);
    return true;
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
    const all = listings.map((l) => ({
      price: l.currentPrice, occupancy: l.occupancyRate,
    }));
    const total = all.length;
    if (total === 0) return { avgPrice: 0, avgOccupancy: 0, avgRevPAR: 0, total: 0, min: 0, max: 0, p25: 0, p50: 0, p75: 0 };
    const avgPrice = Math.round(all.reduce((s, l) => s + l.price, 0) / total);
    const avgOccupancy = all.reduce((s, l) => s + l.occupancy, 0) / total;
    const avgRevPAR = Math.round(avgPrice * avgOccupancy);

    const prices = all.map((l) => l.price).sort((a, b) => a - b);
    const min = prices[0];
    const max = prices[total - 1];
    const p25 = prices[Math.floor(total * 0.25)];
    const p50 = prices[Math.floor(total * 0.5)];
    const p75 = prices[Math.floor(total * 0.75)];

    return { avgPrice, avgOccupancy, avgRevPAR, total, min, max, p25, p50, p75 };
  },
};

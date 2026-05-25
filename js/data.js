// data.js — Mock 数据与价格模拟器

const PLATFORMS = ['美团民宿', '途家', '小猪'];
const ROOM_TYPES = ['大床房', '标间', '套房'];

// 初始民宿列表
const INITIAL_LISTINGS = [
  { id: 1,  name: '山水间民宿', platform: '美团民宿', roomType: '大床房', currentPrice: 328, occupancyRate: 0.85, isOwn: true,  distance: '0.3km' },
  { id: 2,  name: '云栖小筑',   platform: '途家',     roomType: '大床房', currentPrice: 268, occupancyRate: 0.60, isOwn: false, distance: '0.8km' },
  { id: 3,  name: '听风阁',     platform: '小猪',     roomType: '标间',   currentPrice: 358, occupancyRate: 0.90, isOwn: false, distance: '0.5km' },
  { id: 4,  name: '花间堂',     platform: '美团民宿', roomType: '套房',   currentPrice: 458, occupancyRate: 0.78, isOwn: false, distance: '1.0km' },
  { id: 5,  name: '竹隐居',     platform: '途家',     roomType: '大床房', currentPrice: 218, occupancyRate: 0.45, isOwn: false, distance: '1.5km' },
  { id: 6,  name: '望山居',     platform: '小猪',     roomType: '套房',   currentPrice: 388, occupancyRate: 0.70, isOwn: false, distance: '1.2km' },
  { id: 7,  name: '暖阳小院',   platform: '美团民宿', roomType: '标间',   currentPrice: 198, occupancyRate: 0.55, isOwn: false, distance: '0.6km' },
  { id: 8,  name: '慢时光',     platform: '途家',     roomType: '大床房', currentPrice: 298, occupancyRate: 0.72, isOwn: true,  distance: '0.4km' },
  { id: 9,  name: '苍山雪',     platform: '小猪',     roomType: '大床房', currentPrice: 278, occupancyRate: 0.65, isOwn: false, distance: '0.9km' },
  { id: 10, name: '洱海月',     platform: '美团民宿', roomType: '套房',   currentPrice: 528, occupancyRate: 0.82, isOwn: false, distance: '1.8km' },
  { id: 11, name: '白族人家',   platform: '途家',     roomType: '标间',   currentPrice: 238, occupancyRate: 0.50, isOwn: false, distance: '1.1km' },
  { id: 12, name: '古城边',     platform: '美团民宿', roomType: '大床房', currentPrice: 348, occupancyRate: 0.88, isOwn: false, distance: '0.7km' },
];

// 生成最近7天的历史价格（每2小时一个数据点）
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

// 深拷贝并扩展初始数据
let listings = INITIAL_LISTINGS.map(l => ({
  ...l,
  previousPrice: l.currentPrice,
  priceHistory: generatePriceHistory(l.currentPrice),
}));

// 调价事件订阅者
const listeners = [];

// 模拟随机调价：每 5-15 秒随机选 1-3 家，价格波动 -8% ~ +8%
function simulatePriceChange() {
  const count = 1 + Math.floor(Math.random() * 3);
  const indices = new Set();
  while (indices.size < count) {
    indices.add(Math.floor(Math.random() * listings.length));
  }

  const changes = [];
  indices.forEach(i => {
    const listing = listings[i];
    const changePct = (Math.random() - 0.5) * 0.16;
    const newPrice = Math.max(50, Math.round(listing.currentPrice * (1 + changePct)));
    listing.previousPrice = listing.currentPrice;
    listing.currentPrice = newPrice;
    listing.priceHistory.push({ time: Date.now(), price: newPrice });
    // 只保留最近 200 条历史
    if (listing.priceHistory.length > 200) {
      listing.priceHistory = listing.priceHistory.slice(-200);
    }
    // 入住率小幅波动
    listing.occupancyRate = Math.min(1, Math.max(0.2,
      listing.occupancyRate + (Math.random() - 0.5) * 0.05
    ));
    changes.push(listing);
  });

  listeners.forEach(fn => fn(changes));
}

function startSimulation() {
  function tick() {
    simulatePriceChange();
    const delay = 5000 + Math.random() * 10000;
    setTimeout(tick, delay);
  }
  tick();
}

// 数据访问接口（供 api.js 调用）
const DataStore = {
  getListings() {
    return listings.map(l => ({
      id: l.id,
      name: l.name,
      platform: l.platform,
      roomType: l.roomType,
      currentPrice: l.currentPrice,
      previousPrice: l.previousPrice,
      occupancyRate: l.occupancyRate,
      isOwn: l.isOwn,
      distance: l.distance,
    }));
  },

  getPriceHistory(id) {
    const listing = listings.find(l => l.id === id);
    return listing ? listing.priceHistory : [];
  },

  onUpdate(fn) {
    listeners.push(fn);
    return () => {
      const idx = listeners.indexOf(fn);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  },

  startSimulation,
};

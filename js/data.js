// data.js — 客户端数据模型（纯实时数据，无模拟）
const PLATFORMS = ['美团民宿', '途家', '携程', '小猪'];

let listings = [];
let serverCompetitors = [];
let pagination = { page: 1, totalPages: 1, total: 0 };

// 从服务器加载竞品
async function loadServerCompetitors(page = 1, platform = '', type = '') {
  const token = localStorage.getItem('homestay_token');
  if (!token) return;

  try {
    const data = await API.fetchCompetitors(page, 30, platform, type);
    if (data && data.items) {
      const enriched = data.items.map(c => ({
        id: 'tj_' + c.id,
        dbId: c.id,
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
        source: c.source || 'manual',
        isOwn: !!c.isOwn,
        priceHistory: [],
      }));
      serverCompetitors = enriched;
      listings = [...serverCompetitors];
      pagination = { page: data.page, totalPages: data.totalPages, total: data.total };
    }
  } catch (e) {
    console.error('加载竞品失败:', e);
  }
}

const DataStore = {
  getPagination() { return { ...pagination }; },

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
      const payload = {
        unitId: String(item.unitId || item.id || ''),
        name: item.name || '',
        platform: item.platform || '酒店',
        roomType: item.roomType || '',
        currentPrice: item.currentPrice || 0,
        previousPrice: item.previousPrice || item.currentPrice || 0,
        occupancyRate: item.occupancyRate || 0.5,
        longitude: item.longitude || null,
        latitude: item.latitude || null,
        address: item.address || '',
        rating: item.rating || 0,
        reviews: item.reviews || 0,
        distance: item.distance || '',
        source: item.source || 'amap',
      };
      const result = await API.addCompetitor(payload);
      if (result.success) {
        await loadServerCompetitors(1);
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

  async refreshCompetitor(id) {
    const listing = listings.find(l => l.id === id);
    if (!listing || !listing.dbId) return false;
    try {
      const historyData = await API.getPriceHistory(listing.dbId, 100);
      if (Array.isArray(historyData) && historyData.length > 0) {
        listing.priceHistory = historyData.map(h => ({
          time: new Date(h.recordedAt).getTime(),
          price: h.price,
        }));
        const latest = historyData[0];
        if (latest) {
          listing.previousPrice = listing.currentPrice;
          listing.currentPrice = latest.price;
          listing.occupancyRate = latest.occupancyRate;
        }
        return true;
      }
    } catch (e) { console.error('刷新竞品失败:', e); }
    return false;
  },

  async refreshAllFromCrawler() {
    try {
      const result = await API.triggerCrawl();
      if (result && result.success) {
        await loadServerCompetitors();
      }
      return result;
    } catch (e) { console.error('触发爬虫失败:', e); return null; }
  },

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

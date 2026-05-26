// api.js — 数据接口适配器
const API = (() => {
  function delay(ms = 200) {
    return new Promise((r) => setTimeout(r, ms));
  }

  return {
    async fetchListings() {
      await delay(300);
      return DataStore.getListings();
    },

    async fetchPriceHistory(id) {
      await delay(200);
      return DataStore.getPriceHistory(id);
    },

    onPriceUpdate(fn) {
      return DataStore.onUpdate(fn);
    },

    getMarketStats() {
      return DataStore.getMarketStats();
    },

    // 添加竞品
    addCompetitor(item) {
      return DataStore.addCompetitor(item);
    },

    // 删除竞品
    removeCompetitor(id) {
      return DataStore.removeCompetitor(id);
    },

    // 获取浏览器定位
    getCurrentPosition() {
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          return reject(new Error('浏览器不支持定位'));
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          (err) => reject(err),
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
        );
      });
    },

    // 反查城市名
    async reverseGeocode(lat, lng) {
      const r = await fetch(`/api/geo/city?lat=${lat}&lng=${lng}`);
      return r.json();
    },

    // 搜索途家民宿
    async searchTujia(city, page = 0, size = 20) {
      const r = await fetch(`/api/tujia/search?city=${encodeURIComponent(city)}&page=${page}&size=${size}`);
      return r.json();
    },
  };
})();

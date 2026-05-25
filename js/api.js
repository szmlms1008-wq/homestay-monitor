// api.js — 数据接口适配器
// 当前对接 data.js mock 数据。切换真实 API 时只需修改此文件中三个函数。

const API = (() => {
  // 模拟网络延迟
  function delay(ms = 200) {
    return new Promise(r => setTimeout(r, ms));
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
  };
})();

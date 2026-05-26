// server.js — 途家 API 代理 + 静态文件服务
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// 途家 API 代理
app.get('/api/tujia/search', async (req, res) => {
  const { city, page = 0, size = 20 } = req.query;
  if (!city) return res.status(400).json({ error: 'city required' });

  try {
    const payload = JSON.stringify({
      conditions: [{ type: 1, value: city }],
      onlyReturnTotalCount: false,
      pageIndex: parseInt(page),
      pageSize: Math.min(parseInt(size), 50),
      returnFilterConditions: true,
      returnGeoConditions: true,
      url: '',
    });

    const r = await fetch('https://www.tujia.com/bingo/pc/search/searchhouse', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Referer: 'https://www.tujia.com/',
        Accept: 'application/json',
      },
      body: payload,
      signal: AbortSignal.timeout(15000),
    });

    const data = await r.json();

    if (data.ret !== true) {
      return res.json({ error: data.errmsg || 'API error', code: data.errcode });
    }

    const listings = (data.data.items || []).map((item) => {
      let rating = 0, reviews = 0, layout = '', wholeUnit = '';
      (item.unitSummeries || []).forEach((s) => {
        const t = s.text;
        if (t.includes('分')) {
          const parts = t.split('/');
          rating = parseFloat(parts[0]) || 0;
          reviews = parseInt(parts[1]) || 0;
        } else if (t.includes('床') || t.includes('居')) {
          layout = t;
        } else if (t.includes('整套') || t.includes('独立') || t.includes('单间')) {
          wholeUnit = t;
        }
      });
      return {
        id: 'tj_' + item.unitId,
        unitId: item.unitId,
        name: item.unitName,
        platform: '途家民宿',
        roomType: layout || wholeUnit || '未知房型',
        currentPrice: item.finalPrice || item.productPrice || 0,
        previousPrice: item.productPrice || item.finalPrice || 0,
        longitude: item.longitude,
        latitude: item.latitude,
        address: item.address,
        rating,
        reviews,
        cityName: item.cityName,
        districtName: item.districtName,
        occupancyRate: Math.min(0.95, Math.max(0.1, rating / 5)),
        isOwn: false,
        distance: '',
        source: 'tujia',
      };
    });

    res.json({ total: data.data.totalCount, listings });
  } catch (e) {
    res.status(502).json({ error: 'upstream error: ' + e.message });
  }
});

// 根据经纬度反查城市名（高德地图）
app.get('/api/geo/city', async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat,lng required' });

  const key = process.env.AMAP_KEY || '';
  if (!key) {
    return res.json({ city: '', district: '', adcode: '', lat, lng, note: 'no AMAP_KEY' });
  }

  try {
    const url = `https://restapi.amap.com/v3/geocode/regeo?key=${key}&location=${lng},${lat}&extensions=base`;
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    const comp = d.regeocode?.addressComponent || {};
    res.json({
      city: comp.city || comp.province || '',
      district: comp.district || '',
      adcode: comp.adcode || '',
      lat, lng,
    });
  } catch (e) {
    res.json({ city: '', district: '', lat, lng, note: 'geocode fail' });
  }
});

app.listen(PORT, () => {
  console.log(`🏡 homestay-monitor: http://localhost:${PORT}`);
  console.log(`   Tujia API proxy: /api/tujia/search?city=dali`);
  console.log(`   Geo API:          /api/geo/city?lat=25.6&lng=100.2`);
});

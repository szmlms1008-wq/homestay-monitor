// charts.js — Canvas 折线图

class PriceChart {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.data = [];
    this.mode = '7d'; // '7d' | '24h'
    this.padding = { top: 20, right: 20, bottom: 40, left: 55 };
  }

  setData(data, mode = '7d') {
    this.data = data;
    this.mode = mode;
    this.draw();
  }

  draw() {
    const { ctx, canvas, padding } = this;
    const W = canvas.clientWidth || 600;
    const H = canvas.clientHeight || 280;
    const pw = W - padding.left - padding.right;
    const ph = H - padding.top - padding.bottom;

    // 高 DPI 适配
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 清空
    ctx.clearRect(0, 0, W, H);

    if (this.data.length < 2) {
      ctx.fillStyle = '#999';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('数据不足', W / 2, H / 2);
      return;
    }

    // 数据裁剪
    const now = Date.now();
    const cutoff = this.mode === '24h' ? now - 24 * 60 * 60 * 1000 : now - 7 * 24 * 60 * 60 * 1000;
    const filtered = this.data.filter(d => d.time >= cutoff);

    if (filtered.length < 2) {
      ctx.fillStyle = '#999';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('数据不足', W / 2, H / 2);
      return;
    }

    const prices = filtered.map(d => d.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceRange = maxPrice - minPrice || 1;
    const yMin = minPrice - priceRange * 0.15;
    const yMax = maxPrice + priceRange * 0.15;
    const actualRange = yMax - yMin;

    const xScale = (i) => padding.left + (i / (filtered.length - 1)) * pw;
    const yScale = (p) => padding.top + ph - ((p - yMin) / actualRange) * ph;

    // 网格线
    const gridLines = 5;
    ctx.strokeStyle = '#e8ecf0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= gridLines; i++) {
      const y = padding.top + (i / gridLines) * ph;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(W - padding.right, y);
      ctx.stroke();

      const val = Math.round(yMax - (i / gridLines) * actualRange);
      ctx.fillStyle = '#888';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('¥' + val, padding.left - 6, y + 3);
    }

    // X轴时间标签
    ctx.fillStyle = '#888';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    const xLabels = this.mode === '24h' ? 6 : 7;
    for (let i = 0; i <= xLabels; i++) {
      const idx = Math.floor((i / xLabels) * (filtered.length - 1));
      const x = xScale(idx);
      const d = new Date(filtered[idx].time);
      const label = this.mode === '24h'
        ? d.getHours() + ':00'
        : (d.getMonth() + 1) + '/' + d.getDate();
      ctx.fillText(label, x, H - padding.bottom + 16);
    }

    // 折线下面积渐变
    const gradient = ctx.createLinearGradient(0, padding.top, 0, H - padding.bottom);
    gradient.addColorStop(0, 'rgba(13, 148, 136, 0.15)');
    gradient.addColorStop(1, 'rgba(13, 148, 136, 0.01)');

    ctx.beginPath();
    ctx.moveTo(xScale(0), yScale(filtered[0].price));
    for (let i = 1; i < filtered.length; i++) {
      ctx.lineTo(xScale(i), yScale(filtered[i].price));
    }
    ctx.lineTo(xScale(filtered.length - 1), H - padding.bottom);
    ctx.lineTo(xScale(0), H - padding.bottom);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // 折线
    ctx.beginPath();
    ctx.moveTo(xScale(0), yScale(filtered[0].price));
    for (let i = 1; i < filtered.length; i++) {
      ctx.lineTo(xScale(i), yScale(filtered[i].price));
    }
    ctx.strokeStyle = '#0d9488';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 数据点
    const step = Math.max(1, Math.floor(filtered.length / 20));
    for (let i = 0; i < filtered.length; i += step) {
      const x = xScale(i);
      const y = yScale(filtered[i].price);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#0d9488';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // 最后一个点加大
    const last = filtered.length - 1;
    const lx = xScale(last);
    const ly = yScale(filtered[last].price);
    ctx.beginPath();
    ctx.arc(lx, ly, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#0d9488';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

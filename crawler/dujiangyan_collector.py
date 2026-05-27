"""都江堰全量数据采集 - 网格搜索突破100条限制"""
import json, logging, math, time
import requests
from config import AMAP_KEY

logger = logging.getLogger(__name__)

# 都江堰市中心坐标
DUJIANGYAN_CENTER = (30.998, 103.646)

# 网格参数：3km step, 覆盖15km范围 = 25个网格
GRID_STEP = 0.03  # ~3km
GRID_RANGE = 0.15  # ~15km

POI_TYPES = '100000|080300|080302|080304|080303'


def generate_grid_points(center_lat, center_lng, step, radius):
    """生成网格搜素点"""
    points = []
    lat_steps = int(radius / step)
    lng_steps = int(radius / step)
    for i in range(-lat_steps, lat_steps + 1):
        for j in range(-lng_steps, lng_steps + 1):
            points.append((center_lat + i * step, center_lng + j * step))
    return points


def collect_all_hotels() -> dict:
    """采集都江堰全部酒店/民宿数据"""
    if not AMAP_KEY:
        return {'error': 'AMAP_KEY 未配置', 'listings': [], 'total': 0}

    all_listings = []
    seen_ids = set()
    points = generate_grid_points(DUJIANGYAN_CENTER[0], DUJIANGYAN_CENTER[1],
                                   GRID_STEP, GRID_RANGE)
    logger.info(f'都江堰网格搜索: {len(points)} 个网格点')

    for idx, (lat, lng) in enumerate(points):
        for page in range(1, 4):  # 每格3页
            try:
                url = (
                    f'https://restapi.amap.com/v3/place/around'
                    f'?key={AMAP_KEY}&location={lng},{lat}'
                    f'&radius=3000&types={POI_TYPES}'
                    f'&keywords=民宿|酒店|客栈|宾馆|公寓|青旅|度假'
                    f'&offset=25&page={page}&extensions=all'
                )
                resp = requests.get(url, timeout=10)
                data = resp.json()

                if data.get('status') != '1':
                    break

                pois = data.get('pois', [])
                if not pois:
                    break

                new_count = 0
                for p in pois:
                    pid = p.get('id', '')
                    if pid in seen_ids:
                        continue
                    seen_ids.add(pid)
                    new_count += 1

                    loc = p.get('location', '').split(',')
                    biz = p.get('biz_ext', {}) or {}
                    lng_p = float(loc[0]) if len(loc) > 0 else 0
                    lat_p = float(loc[1]) if len(loc) > 1 else 0
                    rating = float(biz.get('rating', 0)) if biz.get('rating') else 0

                    name = p.get('name', '')
                    if any(w in name for w in ['民宿', '客栈']):
                        platform = '民宿'
                    elif any(w in name for w in ['公寓']):
                        platform = '公寓'
                    elif any(w in name for w in ['青旅', '青年', '背包']):
                        platform = '青旅'
                    elif any(w in name for w in ['度假', '山庄', '温泉']):
                        platform = '度假村'
                    else:
                        platform = '酒店'

                    all_listings.append({
                        'unitId': pid,
                        'name': name,
                        'platform': platform,
                        'roomType': p.get('type', ''),
                        'currentPrice': 0,
                        'previousPrice': 0,
                        'longitude': lng_p,
                        'latitude': lat_p,
                        'address': p.get('address', ''),
                        'rating': rating,
                        'reviews': 0,
                        'cityName': p.get('cityname', '都江堰'),
                        'districtName': p.get('adname', ''),
                        'occupancyRate': min(0.95, max(0.1, rating / 5)) if rating else 0.5,
                        'source': 'amap',
                        'tel': biz.get('tel', '') or p.get('tel', ''),
                    })

            except Exception as e:
                logger.error(f'网格({lat},{lng}) p{page}: {e}')
                break

        if (idx + 1) % 5 == 0:
            logger.info(f'  进度: {idx+1}/{len(points)} 网格, 已收集 {len(all_listings)} 条')

    all_listings.sort(key=lambda x: x.get('rating', 0), reverse=True)
    logger.info(f'都江堰采集完成: {len(all_listings)} 条不重复数据')
    return {'total': len(all_listings), 'listings': all_listings, 'city': '都江堰'}


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
    result = collect_all_hotels()
    print('Total:', result['total'])
    for l in result['listings'][:10]:
        addr = l['address'][:30] if l.get('address') else ''
    name = l['name']
    platform = l['platform']
    rating = l['rating']
    print(f'  {name} | {platform} | ★{rating} | {addr}')

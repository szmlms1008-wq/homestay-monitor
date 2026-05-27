"""高德地图搜索 - 关键词 + 周边搜索"""
import logging
import requests
from config import AMAP_KEY

logger = logging.getLogger(__name__)

# 搜索关键词（用 | 表示 OR）
SEARCH_KEYWORDS = '民宿|酒店|公寓|客栈|青旅|宾馆|度假'

POI_TYPES = '100000|080300|080302|080304|080303|080306|080311'


def search_nearby(lat: float, lng: float, radius: int = 5000,
                  size: int = 100) -> dict:
    """周边搜索 - 用关键词覆盖所有住宿类型"""
    if not AMAP_KEY:
        return {'error': 'AMAP_KEY 未配置', 'listings': [], 'total': 0}

    all_listings = []
    pages = 5  # 翻5页，每页25条=125条

    for page in range(1, pages + 1):
        try:
            url = (
                f'https://restapi.amap.com/v3/place/around'
                f'?key={AMAP_KEY}&location={lng},{lat}'
                f'&radius={radius}&types={POI_TYPES}'
                f'&keywords={SEARCH_KEYWORDS}'
                f'&offset=25&page={page}&extensions=all'
            )
            resp = requests.get(url, timeout=10)
            data = resp.json()

            if data.get('status') != '1':
                if page == 1:
                    logger.warning(f'高德周边搜索失败: {data.get("info")}')
                break

            pois = data.get('pois', [])
            if not pois:
                break

            for p in pois:
                loc = p.get('location', '').split(',')
                biz = p.get('biz_ext', {}) or {}
                photos = p.get('photos', [])
                photo_url = photos[0].get('url', '') if photos else ''

                lng_p = float(loc[0]) if len(loc) > 0 else 0
                lat_p = float(loc[1]) if len(loc) > 1 else 0
                rating = float(biz.get('rating', 0)) if biz.get('rating') else 0

                # 根据名称智能分类
                pname = p.get('name', '')
                if any(w in pname for w in ['民宿', '客栈', '客寨']):
                    platform = '民宿'
                elif any(w in pname for w in ['公寓', '公馆']):
                    platform = '公寓'
                elif any(w in pname for w in ['青旅', '青年', '背包']):
                    platform = '青旅'
                elif any(w in pname for w in ['度假', '山庄', '温泉']):
                    platform = '度假村'
                else:
                    platform = '酒店'

                all_listings.append({
                    'unitId': p.get('id', ''),
                    'name': p.get('name', ''),
                    'platform': platform,
                    'roomType': p.get('type', ''),
                    'currentPrice': 0,
                    'previousPrice': 0,
                    'longitude': lng_p,
                    'latitude': lat_p,
                    'address': p.get('address', ''),
                    'rating': rating,
                    'reviews': 0,
                    'cityName': p.get('cityname', ''),
                    'districtName': p.get('adname', ''),
                    'occupancyRate': min(0.95, max(0.1, rating / 5)) if rating else 0.5,
                    'source': 'amap',
                    'photoUrl': photo_url,
                    'tel': biz.get('tel', '') or p.get('tel', ''),
                })

        except Exception as e:
            logger.error(f'高德周边搜索 page {page} 异常: {e}')
            break

    seen = set()
    unique = []
    for l in all_listings:
        if l['unitId'] not in seen:
            seen.add(l['unitId'])
            unique.append(l)

    unique.sort(key=lambda x: x.get('rating', 0), reverse=True)
    return {'total': len(unique), 'listings': unique[:size]}


def search_by_keyword(keyword: str, city: str = '', size: int = 100) -> dict:
    """关键词搜索 - 不限POI类型，全局搜索民宿/酒店"""
    if not AMAP_KEY:
        return {'error': 'AMAP_KEY 未配置', 'listings': [], 'total': 0}

    all_listings = []
    pages = 4

    for page in range(1, pages + 1):
        try:
            params = {
                'key': AMAP_KEY,
                'keywords': keyword,
                'types': POI_TYPES,
                'offset': 25,
                'page': page,
                'extensions': 'all',
            }
            if city:
                params['city'] = city

            resp = requests.get(
                'https://restapi.amap.com/v3/place/text',
                params=params,
                timeout=10,
            )
            data = resp.json()
            if data.get('status') != '1':
                if page == 1:
                    logger.warning(f'高德文本搜索失败: {data.get("info")}')
                break

            pois = data.get('pois', [])
            if not pois:
                break

            for p in pois:
                loc = p.get('location', '').split(',')
                biz = p.get('biz_ext', {}) or {}

                lng_p = float(loc[0]) if len(loc) > 0 else 0
                lat_p = float(loc[1]) if len(loc) > 1 else 0
                rating = float(biz.get('rating', 0)) if biz.get('rating') else 0

                pname = p.get('name', '')
                if any(w in pname for w in ['民宿', '客栈', '客寨']):
                    platform = '民宿'
                elif any(w in pname for w in ['公寓', '公馆']):
                    platform = '公寓'
                elif any(w in pname for w in ['青旅', '青年', '背包']):
                    platform = '青旅'
                elif any(w in pname for w in ['度假', '山庄', '温泉']):
                    platform = '度假村'
                else:
                    platform = '酒店'

                all_listings.append({
                    'unitId': p.get('id', ''),
                    'name': p.get('name', ''),
                    'platform': platform,
                    'roomType': p.get('type', ''),
                    'currentPrice': 0,
                    'previousPrice': 0,
                    'longitude': lng_p,
                    'latitude': lat_p,
                    'address': p.get('address', ''),
                    'rating': rating,
                    'reviews': 0,
                    'cityName': p.get('cityname', ''),
                    'districtName': p.get('adname', ''),
                    'occupancyRate': min(0.95, max(0.1, rating / 5)) if rating else 0.5,
                    'source': 'amap',
                    'photoUrl': '',
                    'tel': biz.get('tel', '') or p.get('tel', ''),
                })

        except Exception as e:
            logger.error(f'高德文本搜索 page {page} 异常: {e}')
            break

    seen = set()
    unique = []
    for l in all_listings:
        if l['unitId'] not in seen:
            seen.add(l['unitId'])
            unique.append(l)

    unique.sort(key=lambda x: x.get('rating', 0), reverse=True)
    return {'total': len(unique), 'listings': unique[:size]}

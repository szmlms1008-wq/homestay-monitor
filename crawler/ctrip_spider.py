"""携程酒店爬虫 - 从 PC 页面 SSR 数据解析

原理：携程 PC 端酒店列表页 (hotels.ctrip.com/hotel/<city><id>)
在服务端渲染时把完整酒店数据注入 window.IBU_HOTEL JSON。
直接解析 HTML 中的 JSON，无需 API 认证。

注意：默认日期为当天，大部分酒店显示"售罄"。
价格需搭配携程 SOA2 API + 真实 session 获取。
"""
import json
import logging
import re
from typing import Optional
from datetime import date, timedelta

from scrapling.fetchers import StealthySession

logger = logging.getLogger(__name__)

CITY_IDS = {
    '成都': (28, 'chengdu'), '大理': (32, 'dali'), '丽江': (37, 'lijiang'),
    '昆明': (34, 'kunming'), '重庆': (4, 'chongqing'), '上海': (2, 'shanghai'),
    '北京': (1, 'beijing'), '杭州': (17, 'hangzhou'), '三亚': (43, 'sanya'),
    '厦门': (25, 'xiamen'), '西安': (10, 'xian'), '青岛': (13, 'qingdao'),
    '苏州': (19, 'suzhou'), '南京': (12, 'nanjing'), '武汉': (16, 'wuhan'),
    '长沙': (27, 'changsha'), '广州': (3, 'guangzhou'), '深圳': (99, 'shenzhen'),
    '桂林': (44, 'guilin'), '张家界': (79, 'zhangjiajie'),
}


def get_city_key(city: str) -> tuple:
    """返回 (cityId, cityEnName)"""
    for name, (cid, en) in CITY_IDS.items():
        if name in city or city in name:
            return cid, en
    return 28, 'chengdu'


def _extract_ibu_hotel(content: str) -> Optional[dict]:
    """从 HTML 提取 window.IBU_HOTEL JSON"""
    idx = content.find('IBU_HOTEL')
    if idx < 0:
        return None
    eq = content.find('=', idx)
    start = content.find('{', eq)
    depth = 0
    end = start
    for i in range(start, len(content)):
        if content[i] == '{':
            depth += 1
        elif content[i] == '}':
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    return json.loads(content[start:end])


def parse_hotel(h: dict) -> Optional[dict]:
    """解析携程酒店条目 → 统一格式"""
    base = h.get('base', {})
    if not base.get('hotelId'):
        return None

    score = h.get('score', {})
    money = h.get('money', {})
    pos = h.get('position', {})
    comment = h.get('comment', {})

    name = base.get('hotelName', '')
    rating = float(score.get('number', 0) or 0)
    star = base.get('star', '')

    # 价格：携程默认当天售罄，用星级估算参考价
    price = money.get('price', 0) or money.get('currentPrice', 0) or money.get('displayPrice', 0)
    if not price:
        for v in money.values():
            if isinstance(v, dict):
                price = v.get('price', 0) or v.get('currentPrice', 0)
                if price:
                    break

    sold_out = money.get('soldOut', False)

    # 售罄时按星级给出参考价位
    if sold_out or not price:
        star_level = base.get('star', '')
        if '5' in str(star_level): price = 680
        elif '4' in str(star_level): price = 420
        elif '3' in str(star_level): price = 260
        elif '2' in str(star_level): price = 150
        else: price = 320

    # 地址和区域
    addr = pos.get('address', '')
    area = pos.get('area', {})
    zone = area.get('name', '') if isinstance(area, dict) else ''
    city_name = pos.get('cityName', '')

    # 评论
    reviews = comment.get('count', 0) or comment.get('commentCount', 0)

    return {
        'unitId': str(base.get('hotelId')),
        'name': name,
        'platform': '携程',
        'roomType': f'{star}星' if star else '酒店',
        'currentPrice': int(price),
        'previousPrice': int(price) if price and not sold_out else 0,
        'longitude': None,
        'latitude': None,
        'address': addr,
        'rating': rating,
        'reviews': int(reviews) if reviews else 0,
        'cityName': city_name,
        'districtName': zone,
        'occupancyRate': min(0.95, max(0.1, rating / 5)) if rating else 0.4,
        'source': 'ctrip',
        'star': star,
    }


def search_ctrip(city: str, page: int = 0, size: int = 30) -> dict:
    """搜索携程酒店 - 多页抓取(每页15条)，最多5页=75条"""
    city_id, city_en = get_city_key(city)
    all_listings = []
    total = 0
    pages_to_fetch = min(1, max(1, size // 15 + 1))  # 1页=15条，保证速度

    session = StealthySession(headless=True)
    try:
        session.start()
        page_obj = session.context.new_page()

        for p in range(1, pages_to_fetch + 1):
            url = f'https://hotels.ctrip.com/hotel/{city_en}{city_id}'
            if p > 1:
                url += f'-p{p}'
            logger.info(f'携程 p{p}: {url}')
            page_obj.goto(url, wait_until='load', timeout=30000)

            data = _extract_ibu_hotel(page_obj.content())
            if not data:
                if p == 1:
                    return {'error': '未找到 IBU_HOTEL', 'listings': [], 'total': 0}
                break

            fpl = data.get('initData', {}).get('firstPageList', {})
            hl = fpl.get('hotelList', {})
            hotels = hl.get('list', [])
            if p == 1:
                total = fpl.get('hotelListAddtionInfo', {}).get('hotelTotalCount', len(hotels))

            listings = [parse_hotel(h) for h in hotels]
            all_listings.extend([l for l in listings if l is not None])

            if len(hotels) < 15:
                break

        return {'total': total, 'listings': all_listings[:size], 'city': city}
    except Exception as e:
        logger.exception(f'携程失败: {e}')
        return {'error': str(e), 'listings': [], 'total': 0}
    finally:
        try:
            session.close()
        except Exception:
            pass
        return {'error': str(e), 'listings': [], 'total': 0}


def search_ctrip_nearby(lat: float, lng: float, size: int = 30) -> dict:
    """携程附近搜索 - 暂用城市搜索代替"""
    return {'error': '携程附近搜索暂未实现，请使用城市搜索', 'listings': [], 'total': 0}

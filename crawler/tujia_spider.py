"""途家民宿爬虫 - 基于 Scrapling FetcherSession"""
import json
import logging
from typing import Optional
from scrapling.fetchers import FetcherSession

logger = logging.getLogger(__name__)

TUJIA_SEARCH_URL = 'https://www.tujia.com/bingo/pc/search/searchhouse'

HEADERS = {
    'Content-Type': 'text/plain',
    'Referer': 'https://www.tujia.com/',
    'Accept': 'application/json',
}

def build_search_body(city: str, page: int = 0, size: int = 30) -> dict:
    return {
        'conditions': [{'type': 1, 'value': city}],
        'onlyReturnTotalCount': False,
        'pageIndex': page,
        'pageSize': min(size, 50),
        'returnFilterConditions': True,
        'returnGeoConditions': True,
        'url': '',
    }

def parse_listing(item: dict) -> Optional[dict]:
    """解析单个房源数据"""
    if not item.get('unitId'):
        return None

    rating = 0.0
    reviews = 0
    layout = ''
    whole_unit = ''

    for s in (item.get('unitSummeries') or []):
        t = s.get('text', '')
        if '分' in t:
            parts = t.split('/')
            try:
                rating = float(parts[0])
                reviews = int(parts[1]) if len(parts) > 1 else 0
            except (ValueError, IndexError):
                pass
        elif '床' in t or '居' in t:
            layout = t
        elif any(kw in t for kw in ('整套', '独立', '单间')):
            whole_unit = t

    current_price = item.get('finalPrice') or item.get('productPrice') or 0
    previous_price = item.get('productPrice') or item.get('finalPrice') or 0

    return {
        'unitId': item.get('unitId'),
        'name': item.get('unitName', ''),
        'platform': '途家民宿',
        'roomType': layout or whole_unit or '未知房型',
        'currentPrice': current_price,
        'previousPrice': previous_price,
        'longitude': item.get('longitude'),
        'latitude': item.get('latitude'),
        'address': item.get('address', ''),
        'rating': rating,
        'reviews': reviews,
        'cityName': item.get('cityName', ''),
        'districtName': item.get('districtName', ''),
        'occupancyRate': min(0.95, max(0.1, rating / 5)),
        'source': 'tujia',
    }

def search_tujia(city: str, page: int = 0, size: int = 30) -> dict:
    """使用 Scrapling FetcherSession 调用途家搜索 API"""
    try:
        with FetcherSession(impersonate='chrome') as session:
            resp = session.post(
                TUJIA_SEARCH_URL,
                data=json.dumps(build_search_body(city, page, size)),
                headers=HEADERS,
            )
            raw = resp.body
            if not raw:
                return {'error': 'empty response', 'listings': [], 'total': 0}

            data = json.loads(raw)
            if data.get('ret') is not True:
                return {
                    'error': data.get('errmsg', 'API error'),
                    'code': data.get('errcode'),
                    'listings': [],
                    'total': 0,
                }

            listings = [parse_listing(item) for item in (data.get('data', {}).get('items') or [])]
            listings = [l for l in listings if l is not None]

            return {
                'total': data.get('data', {}).get('totalCount', len(listings)),
                'listings': listings,
                'city': city,
            }

    except Exception as e:
        logger.exception(f'途家搜索失败: {e}')
        return {'error': str(e), 'listings': [], 'total': 0}

def fetch_single_listing(unit_id: str) -> Optional[dict]:
    """获取单个房源最新价格"""
    try:
        result = search_tujia('', 0, 1)
        if result.get('listings'):
            for listing in result['listings']:
                if str(listing.get('unitId')) == str(unit_id):
                    return listing
    except Exception as e:
        logger.exception(f'获取房源 {unit_id} 失败: {e}')
    return None

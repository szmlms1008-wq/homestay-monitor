"""民宿价格爬虫服务 - FastAPI + Scrapling"""
import logging
import sys
import os
import math
import requests as http_requests

# 确保可以 import 同目录模块
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from contextlib import asynccontextmanager

from db import (
    get_conn, insert_price_history, update_competitor_price,
    get_all_competitors, get_competitor_by_id, get_competitors_for_refresh,
    create_crawl_task, update_crawl_task, clean_old_history,
)
from tujia_spider import search_tujia
from ctrip_spider import search_ctrip, search_ctrip_nearby
from amap_spider import search_nearby as amap_search_nearby, search_by_keyword as amap_search_keyword
from scheduler import start_scheduler, stop_scheduler
from config import AMAP_KEY, CRAWLER_PORT

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(name)s: %(message)s')
logger = logging.getLogger(__name__)


def haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """计算两点间距离（km）"""
    R = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lng / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def reverse_geocode(lat: float, lng: float) -> dict:
    """高德逆地理编码 → {city, district, adcode}"""
    if not AMAP_KEY:
        return {'city': '', 'district': ''}
    try:
        url = f'https://restapi.amap.com/v3/geocode/regeo?key={AMAP_KEY}&location={lng},{lat}&extensions=base'
        resp = http_requests.get(url, timeout=5)
        data = resp.json()
        comp = data.get('regeocode', {}).get('addressComponent', {})
        return {
            'city': comp.get('city') or comp.get('province') or '',
            'district': comp.get('district') or '',
            'adcode': comp.get('adcode') or '',
        }
    except Exception as e:
        logger.warning(f'逆地理编码失败: {e}')
        return {'city': '', 'district': ''}


def refresh_all_competitors():
    """定时任务：刷新所有已添加竞品的价格"""
    conn = get_conn()
    try:
        competitors = get_competitors_for_refresh(conn)
        if not competitors:
            logger.info('无竞品需要刷新')
            return

        updated = 0
        for comp in competitors:
            try:
                result = search_tujia(comp['address'] or '', 0, 3)
                listings = result.get('listings', [])
                unit_id = comp.get('unit_id')
                matched = None

                if unit_id:
                    for l in listings:
                        if str(l.get('unitId')) == str(unit_id):
                            matched = l
                            break

                if matched:
                    prev_price = comp['current_price']
                    new_price = matched['currentPrice']
                    occ = matched['occupancyRate']
                    insert_price_history(conn, comp['id'], new_price, occ)
                    update_competitor_price(conn, comp['id'], new_price, prev_price, occ)
                    updated += 1
            except Exception as e:
                logger.error(f'刷新竞品 {comp["id"]} 失败: {e}')

        conn.commit()
        logger.info(f'定时刷新完成：{updated}/{len(competitors)} 个竞品已更新')
    except Exception as e:
        conn.rollback()
        logger.exception(f'定时刷新失败: {e}')
    finally:
        conn.close()


def cleanup_job():
    conn = get_conn()
    try:
        clean_old_history(conn)
        conn.commit()
        logger.info('清理过期历史数据完成')
    except Exception as e:
        logger.error(f'清理历史数据失败: {e}')
    finally:
        conn.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    start_scheduler(refresh_all_competitors, cleanup_job)
    logger.info('爬虫服务已启动')
    yield
    stop_scheduler()
    logger.info('爬虫服务已停止')


app = FastAPI(title='民宿价格爬虫服务', version='1.0.0', lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*'],
)


class SearchRequest(BaseModel):
    city: str
    page: int = 0
    size: int = 30
    platform: str = 'tujia'


class NearbyRequest(BaseModel):
    lat: float
    lng: float
    radius: float = 50.0
    size: int = 100
    platform: str = 'all'


class RefreshRequest(BaseModel):
    competitor_id: int


# ====== 爬虫 API ======

@app.post('/crawl/nearby')
def api_nearby(req: NearbyRequest):
    """GPS 附近搜索：高德 POI（主） + 途家/携程（辅）→ 距离排序"""
    platform = req.platform or 'all'
    geo = reverse_geocode(req.lat, req.lng)
    city = geo.get('city') or geo.get('district') or ''
    logger.info(f'GPS ({req.lat},{req.lng}) → {city} (platform={platform})')

    all_listings = []
    error = None
    radius_m = int(req.radius * 1000)

    # 1. 高德 POI 搜索（主数据源，坐标准确）
    amap_result = amap_search_nearby(req.lat, req.lng, radius_m, max(req.size, 30))
    if not amap_result.get('error'):
        all_listings.extend(amap_result.get('listings', []))
    else:
        error = amap_result.get('error')

    # 2. 携程搜索（补充评分和星级）
    if platform in ('ctrip', 'all'):
        try:
            result = search_ctrip(city, 0, max(req.size, 30))
            if not result.get('error'):
                all_listings.extend(result.get('listings', []))
        except Exception:
            pass

    # 3. 携程搜索（补充）
    if platform in ('ctrip', 'all'):
        result = search_ctrip_nearby(req.lat, req.lng, req.size)
        if not result.get('error'):
            all_listings.extend(result.get('listings', []))

    # 计算距离并排序
    nearby = []
    for l in all_listings:
        lat = l.get('latitude')
        lng = l.get('longitude')
        if lat and lng:
            dist = haversine(req.lat, req.lng, lat, lng)
            if dist <= req.radius:
                l['distance'] = f'{dist:.1f}km' if dist >= 1 else f'{dist * 1000:.0f}m'
                l['distanceKm'] = round(dist, 2)
                nearby.append(l)
        else:
            # 无坐标时保留（如携程），距离留空
            l['distance'] = ''
            nearby.append(l)

    nearby.sort(key=lambda x: x.get('distanceKm', 999))
    for l in nearby:
        l.pop('distanceKm', None)

    return {
        'total': len(nearby),
        'listings': nearby,
        'city': city,
        'lat': req.lat,
        'lng': req.lng,
        'platform': platform,
        'error': error if not nearby else None,
    }

@app.post('/crawl/search')
def api_search(req: SearchRequest):
    """搜索民宿房源（支持 platform: tujia / ctrip / all）"""
    platform = req.platform or 'tujia'
    conn = get_conn()
    try:
        task_id = create_crawl_task(conn, platform, req.city, 'running')
        conn.commit()
    except Exception as e:
        task_id = None
        logger.error(f'创建爬取任务失败: {e}')
    finally:
        conn.close()

    all_listings = []
    total = 0
    error = None

    if platform in ('tujia', 'all'):
        result = search_tujia(req.city, req.page, req.size)
        listings = result.get('listings', [])
        all_listings.extend(listings)
        total += result.get('total', 0)

    if platform in ('ctrip', 'all'):
        result = search_ctrip(req.city, req.page, req.size)
        ct_listings = result.get('listings', [])
        all_listings.extend(ct_listings)
        total += result.get('total', 0)

    if task_id:
        conn = get_conn()
        try:
            status = 'done' if not error else 'failed'
            update_crawl_task(conn, task_id, status, error)
            conn.commit()
        finally:
            conn.close()

    return {
        'total': total,
        'listings': all_listings,
        'city': req.city,
        'platform': platform,
        'error': error,
    }


@app.post('/crawl/refresh')
def api_refresh_all():
    """刷新所有竞品价格"""
    conn = get_conn()
    try:
        competitors = get_competitors_for_refresh(conn)
        updated = 0
        for comp in competitors:
            try:
                result = search_tujia(comp['address'] or '', 0, 3)
                listings = result.get('listings', [])
                unit_id = comp.get('unit_id')
                matched = None

                if unit_id:
                    for l in listings:
                        if str(l.get('unitId')) == str(unit_id):
                            matched = l
                            break

                if matched:
                    prev_price = comp['current_price']
                    new_price = matched['currentPrice']
                    occ = matched['occupancyRate']
                    insert_price_history(conn, comp['id'], new_price, occ)
                    update_competitor_price(conn, comp['id'], new_price, prev_price, occ)
                    updated += 1
            except Exception as e:
                logger.error(f'刷新竞品 {comp["id"]} 失败: {e}')

        conn.commit()
        return {'success': True, 'updated': updated, 'total': len(competitors)}
    except Exception as e:
        conn.rollback()
        raise HTTPException(500, str(e))
    finally:
        conn.close()


@app.post('/crawl/refresh/{competitor_id}')
def api_refresh_one(competitor_id: int):
    """刷新单个竞品价格"""
    conn = get_conn()
    try:
        comp = get_competitor_by_id(conn, competitor_id)
        if not comp:
            raise HTTPException(404, '竞品不存在')

        result = search_tujia(comp['address'] or '', 0, 3)
        listings = result.get('listings', [])
        unit_id = comp.get('unit_id')
        matched = None

        if unit_id:
            for l in listings:
                if str(l.get('unitId')) == str(unit_id):
                    matched = l
                    break

        if matched:
            prev_price = comp['current_price']
            new_price = matched['currentPrice']
            occ = matched['occupancyRate']
            insert_price_history(conn, competitor_id, new_price, occ)
            update_competitor_price(conn, competitor_id, new_price, prev_price, occ)
            conn.commit()
            return {'success': True, 'current_price': new_price, 'previous_price': prev_price}

        return {'success': False, 'error': '未找到匹配房源'}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(500, str(e))
    finally:
        conn.close()


@app.get('/crawl/stats')
def api_stats():
    """获取爬虫统计"""
    conn = get_conn()
    try:
        total = conn.execute('SELECT COUNT(*) as c FROM competitors').fetchone()['c']
        with_history = conn.execute(
            'SELECT COUNT(DISTINCT competitor_id) as c FROM price_history'
        ).fetchone()['c']
        today = conn.execute(
            "SELECT COUNT(*) as c FROM crawl_tasks WHERE created_at >= date('now','localtime')"
        ).fetchone()['c']
        last = conn.execute(
            'SELECT * FROM crawl_tasks ORDER BY created_at DESC LIMIT 1'
        ).fetchone()
        return {
            'total_competitors': total,
            'competitors_with_history': with_history,
            'today_crawls': today,
            'last_crawl': dict(last) if last else None,
        }
    finally:
        conn.close()


@app.post('/crawl/ctrip/search')
def api_ctrip_search(req: SearchRequest):
    """携程民宿搜索"""
    result = search_ctrip(req.city, req.page, req.size)
    return {
        'total': result.get('total', 0),
        'listings': result.get('listings', []),
        'city': req.city,
        'error': result.get('error'),
    }


@app.post('/crawl/ctrip/nearby')
def api_ctrip_nearby(req: NearbyRequest):
    """携程 GPS 附近搜索（携程原生支持坐标搜索）"""
    result = search_ctrip_nearby(req.lat, req.lng, req.size)
    listings = result.get('listings', [])

    # 计算距离
    for l in listings:
        lat = l.get('latitude')
        lng = l.get('longitude')
        if lat and lng:
            dist = haversine(req.lat, req.lng, lat, lng)
            if dist <= req.radius:
                l['distance'] = f'{dist:.1f}km' if dist >= 1 else f'{dist * 1000:.0f}m'
            else:
                l['distance'] = ''

    nearby = [l for l in listings if l.get('distance')]
    nearby.sort(key=lambda x: float(x.get('distance', '999km').replace('km', '').replace('m', '')) if 'm' in x.get('distance', '') else float(x.get('distance', '999km').replace('km', '')))

    return {
        'total': len(nearby),
        'listings': nearby,
        'lat': req.lat,
        'lng': req.lng,
        'error': result.get('error'),
    }


class KeywordSearchRequest(BaseModel):
    keyword: str
    city: str = ''
    size: int = 50


@app.post('/crawl/search/keyword')
def api_keyword_search(req: KeywordSearchRequest):
    """关键词搜索民宿/酒店（AMap + 携程）"""
    all_listings = []
    total = 0

    # 1. 高德关键词搜索
    result = amap_search_keyword(req.keyword, req.city, max(req.size, 50))
    all_listings.extend(result.get('listings', []))
    total += result.get('total', 0)

    # 2. 如果指定了城市，也搜携程
    if req.city:
        try:
            ct_result = search_ctrip(req.city, 0, max(req.size, 15))
            if not ct_result.get('error'):
                ct_listings = ct_result.get('listings', [])
                all_listings.extend(ct_listings)
                total += len(ct_listings)
        except Exception:
            pass

    return {
        'total': total,
        'listings': all_listings[:max(req.size, 100)],
        'keyword': req.keyword,
        'error': result.get('error') if not all_listings else None,
    }


@app.get('/health')
def health():
    return {'status': 'ok', 'service': 'homestay-crawler'}


if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=CRAWLER_PORT)

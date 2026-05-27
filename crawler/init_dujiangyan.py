"""一次性初始化都江堰数据到数据库"""
import sys, os, sqlite3, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dujiangyan_collector import collect_all_hotels

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data.db')

def init():
    print('采集都江堰全量数据...')
    result = collect_all_hotels()
    listings = result['listings']
    print(f'共 {len(listings)} 条，正在入库...')

    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")

    # 清空旧数据
    conn.execute('DELETE FROM competitors')
    conn.execute('DELETE FROM price_history')

    # 都江堰市中心
    CENTER_LAT, CENTER_LNG = 30.998, 103.646

    count = 0
    for l in listings:
        # 安全获取字段
        name = str(l.get('name', '') or '')
        platform = str(l.get('platform', '') or '酒店')
        rating = float(l.get('rating', 0) or 0)
        addr = str(l.get('address', '') or '')
        room_type = str(l.get('roomType', '') or '')
        unit_id = str(l.get('unitId', '') or '')
        lat = float(l.get('latitude', 0) or 0)
        lng = float(l.get('longitude', 0) or 0)

        # 估算价格
        base_price = {'民宿': 300, '酒店': 350, '公寓': 250, '青旅': 80, '度假村': 500}.get(platform, 300)
        if rating >= 4.5: base_price = int(base_price * 1.3)
        elif rating >= 4.0: base_price = int(base_price * 1.1)
        elif rating >= 3.0: base_price = int(base_price * 0.9)
        price = max(50, int(base_price * (0.9 + random.random() * 0.2)))

        # 距离
        dlat = math.radians(lat - CENTER_LAT)
        dlng = math.radians(lng - CENTER_LNG)
        a = math.sin(dlat/2)**2 + math.cos(math.radians(CENTER_LAT)) * math.cos(math.radians(lat)) * math.sin(dlng/2)**2
        dist = 6371 * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
        dist_str = f'{dist:.1f}km' if dist >= 1 else f'{dist*1000:.0f}m'

        occupancy = float(l.get('occupancyRate', 0.5) or 0.5)

        conn.execute(
            'INSERT INTO competitors (user_id, unit_id, name, platform, room_type, current_price, previous_price, occupancy_rate, longitude, latitude, address, rating, reviews, distance, source, is_own, last_crawled_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (1, unit_id, name, platform, room_type,
             price, price, occupancy,
             lng, lat, addr, rating, 0,
             dist_str, 'amap', 0, None)
        )

        conn.execute(
            'INSERT INTO price_history (competitor_id, price, occupancy_rate) VALUES (?,?,?)',
            (conn.execute('SELECT last_insert_rowid()').fetchone()[0], price, occupancy)
        )

        count += 1
        if count % 500 == 0:
            conn.commit()
            print(f'  已入库 {count}/{len(listings)}')

    conn.commit()
    print(f'入库完成: {count} 条')

    # 统计
    stats = conn.execute(
        "SELECT platform, COUNT(*) as c, AVG(current_price) as avg_p FROM competitors GROUP BY platform ORDER BY c DESC"
    ).fetchall()
    for row in stats:
        print(f'  {row[0]}: {row[1]}家, 均价¥{int(row[2])}')

    conn.close()

if __name__ == '__main__':
    init()

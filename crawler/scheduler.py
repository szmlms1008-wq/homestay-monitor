"""定时任务调度 - 周期性刷新竞品价格"""
import logging
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger

logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler()

def start_scheduler(refresh_all_fn, cleanup_fn=None):
    """启动定时任务
    Args:
        refresh_all_fn: 刷新所有竞品价格的回调函数
        cleanup_fn: 清理旧数据的回调函数
    """
    scheduler.add_job(
        refresh_all_fn,
        IntervalTrigger(minutes=30),
        id='refresh_all_competitors',
        name='刷新所有竞品价格',
        replace_existing=True,
    )

    if cleanup_fn:
        scheduler.add_job(
            cleanup_fn,
            CronTrigger(hour=3, minute=0),
            id='cleanup_old_history',
            name='清理30天前的历史数据',
            replace_existing=True,
        )

    scheduler.start()
    logger.info('定时任务调度器已启动：每30分钟刷新竞品价格')

def stop_scheduler():
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info('定时任务调度器已停止')

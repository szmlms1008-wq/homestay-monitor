"""配置加载 - 从 .env 文件读取 API 密钥"""
import os


def _load_env():
    """从项目根目录 .env 加载配置"""
    env_file = os.path.join(os.path.dirname(__file__), '..', '.env')
    if os.path.exists(env_file):
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, _, val = line.partition('=')
                    key = key.strip()
                    val = val.strip().strip('"').strip("'")
                    if key and key not in os.environ:
                        os.environ[key] = val


_load_env()


def get(key: str, default: str = '') -> str:
    return os.environ.get(key, default)


AMAP_KEY = get('AMAP_KEY')
CRAWLER_PORT = int(get('CRAWLER_PORT', '9000'))

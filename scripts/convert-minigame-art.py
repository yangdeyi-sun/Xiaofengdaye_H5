"""将现有 WebP 资源转换为抖音包内支持的 PNG；不改变图集坐标/尺寸。"""
from pathlib import Path
import sys
import json
from PIL import Image

source = Path(sys.argv[1]).resolve()
target = Path(sys.argv[2]).resolve()
full_pages = set(json.loads(sys.argv[3])) if len(sys.argv) > 3 else None
for file in source.rglob('*.webp'):
    rel = file.relative_to(source)
    if file.name.startswith('store_feature_'):
        continue
    if rel.parts[0] != 'low' and file.name.startswith('atlas_') and full_pages is not None and file.name not in full_pages:
        continue
    output = target / rel.with_suffix('.png')
    output.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(file) as image:
        # 保留WebP解码后的每个像素；全尺寸/半尺寸都提供，由三端共用的渲染规则选择。
        image.convert('RGBA').save(output, optimize=True)

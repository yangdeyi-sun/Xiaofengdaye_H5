"""将现有 WebP 资源转换为抖音包内支持的 PNG；不改变图集坐标/尺寸。"""
from pathlib import Path
import sys
from PIL import Image

source = Path(sys.argv[1]).resolve()
target = Path(sys.argv[2]).resolve()
for file in source.rglob('*.webp'):
    rel = file.relative_to(source)
    if rel.parts[0] != 'low' and (file.name.startswith('atlas_') or file.name.startswith('store_feature_')):
        continue
    output = target / rel.with_suffix('.png')
    output.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(file) as image:
        # 半尺寸图集保留尺寸和透明度，索引色降低小游戏包体与解码开销。
        image.convert('RGBA').quantize(colors=128, method=Image.Quantize.FASTOCTREE).save(output, optimize=True)

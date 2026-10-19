"""明星蜂配饰：与原蜜蜂同一套画风（深棕描边 #60482F、约 3.5px 线宽、平涂、圆润）。
坐标是 256×256 帧内、各工种首帧的姿势；生成时按每帧眼睛（侦察蜂按护目镜）位置跟随摆动。"""
O = '#60482F'
SW = 3.5


def svg(body: str) -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">'
            f'<g stroke="{O}" stroke-width="{SW}" stroke-linejoin="round" stroke-linecap="round">{body}</g></svg>')


def star(cx, cy, r, fill='#FFD84A', rot=0):
    import math
    pts = []
    for i in range(10):
        rr = r if i % 2 == 0 else r * 0.45
        a = math.radians(-90 + rot + i * 36)
        pts.append(f'{cx + rr * math.cos(a):.1f},{cy + rr * math.sin(a):.1f}')
    return f'<polygon points="{" ".join(pts)}" fill="{fill}"/>'


ACC = {
    # ---------------- 采集蜂 ----------------
    # 闪电：天蓝运动发带 + 闪电徽章
    'lightning': svg(
        '<path d="M95,92 Q125,81 155,92 L153,78 Q125,67 97,78 Z" fill="#7EC8E3"/>'
        '<path d="M153,79 L167,72 L164,88 L155,91" fill="#7EC8E3"/>'
        '<path d="M154,85 L168,92 L158,96 Z" fill="#7EC8E3"/>'
        '<path d="M130,68 L117,86 L126,86 L119,101 L137,80 L128,80 L135,68 Z" fill="#FFD84A" stroke-width="2.6"/>'
    ),
    # 大胃王：餐巾围兜 + 一滴蜂蜜
    'bigbelly': svg(
        '<path d="M99,136 Q125,146 151,136 L147,152 Q140,172 125,175 Q110,172 103,152 Z" fill="#FFF9E8"/>'
        '<path d="M103,152 Q125,160 147,152" fill="none" stroke="#D8644F" stroke-width="3"/>'
        '<circle cx="113" cy="146" r="2.2" fill="#D8644F" stroke="none"/><circle cx="137" cy="146" r="2.2" fill="#D8644F" stroke="none"/>'
        '<circle cx="125" cy="149" r="2.2" fill="#D8644F" stroke="none"/>'
        '<path d="M125,158 Q119,166 121,169 Q125,173 129,169 Q131,166 125,158 Z" fill="#F2B33D" stroke-width="2.5"/>'
    ),
    # 灵鼻子：耳边小粉花 + 粉色小鼻头
    'nose': svg(
        '<g transform="translate(152,80)">'
        + ''.join(f'<ellipse cx="0" cy="-8" rx="5.5" ry="7.5" fill="#F4A6C0" transform="rotate({a})"/>' for a in (0, 72, 144, 216, 288))
        + '<circle cx="0" cy="0" r="4.5" fill="#FFE07A"/></g>'
        '<ellipse cx="125" cy="113" rx="4.2" ry="3.2" fill="#E48A9B" stroke-width="2.2"/>'
    ),
    # ---------------- 侦察蜂（参照护目镜位置） ----------------
    # 千里眼：探险家帽
    'farsight': svg(
        '<ellipse cx="125" cy="74" rx="41" ry="8.5" fill="#D9BE84"/>'
        '<path d="M98,74 Q98,48 125,46 Q152,48 152,74 Z" fill="#E8D39C"/>'
        '<path d="M99,66 Q125,60 151,66 L152,73 Q125,67 98,73 Z" fill="#8A6A3E" stroke-width="2.5"/>'
        '<path d="M112,52 Q120,49 126,50" fill="none" stroke="#FFF6DA" stroke-width="3"/>'
    ),
    # 疾风：迎风飘扬的红围巾
    'gale': svg(
        '<path d="M70,148 Q84,140 98,145 L103,152 Q86,150 74,158 Z" fill="#E2574C"/>'
        '<path d="M76,164 Q90,152 103,150 L106,157 Q92,160 82,170 Z" fill="#E2574C"/>'
        '<path d="M97,134 Q125,144 153,134 L154,144 Q125,154 96,144 Z" fill="#E2574C"/>'
        '<circle cx="102" cy="146" r="7" fill="#E2574C"/>'
        '<path d="M110,141 L114,145 M124,143 L128,147 M138,141 L142,145" stroke="#FFF2E6" stroke-width="2.2"/>'
    ),
    # 幸运星：头顶四叶草 + 小金星
    'lucky': svg(
        '<path d="M154,80 Q158,90 153,98" fill="none" stroke-width="3"/>'
        + ''.join(f'<path d="M0,0 C-7,-4 -8,-12 -3,-14 C0,-15 1,-12 0,-10 C-1,-12 3,-15 5,-12 C8,-8 5,-3 0,0 Z" fill="#6DB25A" stroke-width="2.4" transform="translate(154,74) rotate({a}) scale(1.35)"/>' for a in (0, 90, 180, 270))

    ),
    # ---------------- 巢内工蜂 ----------------
    # 酿蜜师：白色厨师帽
    'brewer': svg(
        '<circle cx="108" cy="54" r="12" fill="#FFFFFF"/><circle cx="142" cy="54" r="12" fill="#FFFFFF"/>'
        '<circle cx="125" cy="47" r="14" fill="#FFFFFF"/>'
        '<path d="M101,58 L149,58 L148,77 Q125,72 102,77 Z" fill="#FFFFFF"/>'
        '<path d="M115,62 L115,72 M125,61 L125,72 M135,62 L135,72" stroke="#D9CDB8" stroke-width="2.4"/>'
    ),
    # 筑巢匠：蓝色波点头巾，侧边打结
    'mason': svg(
        '<path d="M93,90 Q92,64 125,64 Q158,64 157,90 Q125,80 93,90 Z" fill="#5E8FC4"/>'
        '<path d="M155,84 L168,78 L166,90 Z" fill="#5E8FC4"/><path d="M155,86 L169,94 L160,97 Z" fill="#5E8FC4"/>'
        + ''.join(f'<circle cx="{x}" cy="{y}" r="2.4" fill="#FFFFFF" stroke="none"/>' for x, y in ((106, 78), (118, 70), (132, 70), (144, 78), (125, 79), (112, 84), (139, 84)))
    ),
    # 小管家：红领结 + 圆框眼镜
    'keeper': svg(
        '<circle cx="112" cy="105" r="10" fill="#FFFFFF" fill-opacity="0.18" stroke-width="2.6"/>'
        '<circle cx="138" cy="105" r="10" fill="#FFFFFF" fill-opacity="0.18" stroke-width="2.6"/>'
        '<path d="M122,104 Q125,101 128,104" fill="none" stroke-width="2.4"/>'
        '<path d="M108,131 L122,138 L108,146 Z" fill="#C9574A"/><path d="M142,131 L128,138 L142,146 Z" fill="#C9574A"/>'
        '<circle cx="125" cy="138" r="4.5" fill="#E07A6B"/>'
    ),
    # ---------------- 守卫蜂（头盔上） ----------------
    # 铁壁：头盔红色羽冠 + 金星
    'iron': svg(
        '<path d="M119,68 C112,50 120,34 140,32 C132,40 135,52 133,68 Z" fill="#D35A4A"/>'
        '<path d="M123,62 Q124,48 133,40" fill="none" stroke="#F29A8B" stroke-width="2.4"/>'
        + star(125, 86, 7.5)
    ),
    # 哨兵：头盔侧边的小旗
    'sentinel': svg(
        '<path d="M103,74 L92,32" fill="none" stroke-width="4"/>'
        '<path d="M92,32 L66,38 L76,44 L95,47 Z" fill="#F2994A"/>'
        '<circle cx="92" cy="31" r="3.4" fill="#FFD84A" stroke-width="2.4"/>'
    ),
    # 小医官：头盔红十字徽章 + 腰间急救包
    'medic': svg(
        '<circle cx="125" cy="83" r="9.5" fill="#FFFFFF"/>'
        '<path d="M125,77.5 L125,88.5 M119.5,83 L130.5,83" stroke="#E0574F" stroke-width="3.6"/>'
        '<rect x="77" y="150" width="22" height="17" rx="4" fill="#FFFFFF"/>'
        '<path d="M84,150 Q88,144 92,150" fill="none" stroke-width="2.6"/>'
        '<path d="M88,154 L88,163 M83.5,158.5 L92.5,158.5" stroke="#E0574F" stroke-width="3"/>'
    ),
}

ROLE = {
    'lightning': 'forager', 'bigbelly': 'forager', 'nose': 'forager',
    'farsight': 'scout', 'gale': 'scout', 'lucky': 'scout',
    'brewer': 'house', 'mason': 'house', 'keeper': 'house',
    'iron': 'guard', 'sentinel': 'guard', 'medic': 'guard',
}

/**
 * 程序化原创美术（2D 卡通风格）。全部图形由代码绘制，无外部图片版权风险，任意缩放清晰。
 * 只使用 ArkUI 与浏览器共有的 CanvasRenderingContext2D 子集。
 */

export class ArtEnv {
  /** ArkUI 画布字体单位 vp；网页预览为 px */
  static fontUnit: string = 'vp';
  static fontFamily: string = 'sans-serif';
}

export function font(size: number, bold: boolean): string {
  return `${bold ? 'bold ' : ''}${Math.round(size)}${ArtEnv.fontUnit} ${ArtEnv.fontFamily}`;
}

export const ROLE_TINT: Record<string, string> = {
  'scout': '#5DADE2',
  'forager': '#F5B041',
  'house': '#F7DC6F',
  'guard': '#E74C3C',
  'queen': '#AF7AC5'
};

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arc(x + w - rr, y + rr, rr, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arc(x + w - rr, y + h - rr, rr, 0, Math.PI / 2);
  ctx.lineTo(x + rr, y + h);
  ctx.arc(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + rr);
  ctx.arc(x + rr, y + rr, rr, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

/** 一只卡通蜜蜂。angle 为朝向（弧度），wing 为翅膀相位，pollen 是否携带花粉 */
export function drawBee(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, angle: number, wing: number,
  role: string, pollen: boolean, detail: boolean): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(s, s);
  const flap = 0.55 + 0.45 * Math.sin(wing);
  // 翅膀
  ctx.fillStyle = 'rgba(235,248,255,0.78)';
  ctx.strokeStyle = 'rgba(120,160,190,0.7)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.ellipse(-1, -4.6, 3.4, 5.2 * flap + 1, -0.5, 0, Math.PI * 2);
  ctx.fill();
  if (detail) {
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(-1, 4.6, 3.4, 5.2 * flap + 1, 0.5, 0, Math.PI * 2);
  ctx.fill();
  if (detail) {
    ctx.stroke();
  }
  // 身体
  const isQueen = role === 'queen';
  const len: number = isQueen ? 9 : 6.5;
  ctx.fillStyle = isQueen ? '#F4C542' : (role === 'house' ? '#F9E07F' : '#F6BE2C');
  ctx.beginPath();
  ctx.ellipse(-1.5, 0, len, 4.2, 0, 0, Math.PI * 2);
  ctx.fill();
  // 条纹
  ctx.fillStyle = '#2B2118';
  const stripes = isQueen ? 4 : 3;
  for (let i = 0; i < stripes; i++) {
    const sx = -len + 3 + i * (len * 1.4 / stripes);
    ctx.beginPath();
    ctx.ellipse(sx - 1.5, 0, 1.0, 4.0 - Math.abs(i - 1) * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // 螫针
  ctx.beginPath();
  ctx.moveTo(-len - 1.5, -0.8);
  ctx.lineTo(-len - 4, 0);
  ctx.lineTo(-len - 1.5, 0.8);
  ctx.closePath();
  ctx.fill();
  // 头
  ctx.fillStyle = '#3A2A1C';
  ctx.beginPath();
  ctx.arc(len - 1, 0, 3.1, 0, Math.PI * 2);
  ctx.fill();
  if (detail) {
    // 眼睛
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(len, -1.3, 0.9, 0, Math.PI * 2);
    ctx.arc(len, 1.3, 0.9, 0, Math.PI * 2);
    ctx.fill();
    // 触角
    ctx.strokeStyle = '#3A2A1C';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(len + 1.5, -1.5);
    ctx.quadraticCurveTo(len + 4, -3, len + 5, -4.5);
    ctx.moveTo(len + 1.5, 1.5);
    ctx.quadraticCurveTo(len + 4, 3, len + 5, 4.5);
    ctx.stroke();
  }
  // 工种标记
  const tint = ROLE_TINT[role];
  if (tint !== undefined && role !== 'forager' && role !== 'house') {
    ctx.fillStyle = tint;
    ctx.beginPath();
    ctx.arc(-1.5, 0, isQueen ? 2.2 : 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  if (pollen) {
    ctx.fillStyle = '#FF9F1C';
    ctx.beginPath();
    ctx.arc(0, -4.4, 1.5, 0, Math.PI * 2);
    ctx.arc(0, 4.4, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  if (isQueen) {
    // 皇冠独立使用屏幕坐标绘制，避免跟随蜂后身体旋转后横倒或歪到侧面。
    const headX = x + Math.cos(angle) * (len + 1) * s;
    const headY = y + Math.sin(angle) * (len + 1) * s;
    ctx.save();
    // 皇冠底边轻压住头部上缘，视觉上像真正戴在头上；尺寸略小于原版，避免像悬浮贴纸。
    ctx.translate(headX, headY - 0.55 * s);
    ctx.scale(s * 0.76, s * 0.76);
    ctx.fillStyle = '#FFD54A';
    ctx.strokeStyle = '#B7791F';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(-4.2, 0);
    ctx.lineTo(4.2, 0);
    ctx.lineTo(4.6, -4.2);
    ctx.lineTo(2.2, -2.7);
    ctx.lineTo(0, -5.1);
    ctx.lineTo(-2.2, -2.7);
    ctx.lineTo(-4.6, -4.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

/** 单朵花：花瓣数随花种变化 */
export function drawFlower(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, petal: string, center: string,
  petals: number, sway: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(sway);
  ctx.fillStyle = petal;
  for (let i = 0; i < petals; i++) {
    const a = i / petals * Math.PI * 2;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, r * 0.55, r * 0.32, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = center;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.38, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.arc(-r * 0.12, -r * 0.12, r * 0.13, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** 薰衣草穗状花 */
export function drawSpike(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, color: string, sway: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(sway * 0.5);
  ctx.strokeStyle = '#4E8B3A';
  ctx.lineWidth = Math.max(0.8, h * 0.06);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -h);
  ctx.stroke();
  ctx.fillStyle = color;
  for (let i = 0; i < 5; i++) {
    const yy = -h * 0.45 - i * h * 0.12;
    ctx.beginPath();
    ctx.ellipse(-h * 0.06, yy, h * 0.07, h * 0.1, -0.4, 0, Math.PI * 2);
    ctx.ellipse(h * 0.06, yy, h * 0.07, h * 0.1, 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** 草编蜂箱（巢外视图中心） */
export function drawSkep(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, glow: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  // 阴影
  ctx.fillStyle = 'rgba(40,30,10,0.25)';
  ctx.beginPath();
  ctx.ellipse(0, 26, 34, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  if (glow > 0) {
    const g = ctx.createRadialGradient(0, 0, 10, 0, 0, 60);
    g.addColorStop(0, `rgba(255,220,120,${0.45 * glow})`);
    g.addColorStop(1, 'rgba(255,220,120,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 60, 0, Math.PI * 2);
    ctx.fill();
  }
  // 草环层
  const bands = 5;
  for (let i = 0; i < bands; i++) {
    const w = 30 - i * 4.2;
    const yy = 20 - i * 8.5;
    const grad = ctx.createLinearGradient(-w, yy, w, yy);
    grad.addColorStop(0, '#B8862B');
    grad.addColorStop(0.5, '#E2B354');
    grad.addColorStop(1, '#A87420');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(0, yy, w, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(110,70,15,0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.fillStyle = '#D9A743';
  ctx.beginPath();
  ctx.ellipse(0, -22, 9, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  // 巢门
  ctx.fillStyle = '#3B2611';
  ctx.beginPath();
  ctx.ellipse(0, 21, 7, 4, 0, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawWasp(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, angle: number, wing: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(s, s);
  const flap = 0.6 + 0.4 * Math.sin(wing);
  ctx.fillStyle = 'rgba(220,230,240,0.7)';
  ctx.beginPath();
  ctx.ellipse(-2, -5, 3, 7 * flap, -0.8, 0, Math.PI * 2);
  ctx.ellipse(-2, 5, 3, 7 * flap, 0.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#F2C200';
  ctx.beginPath();
  ctx.ellipse(-6, 0, 7, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#111111';
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(-10 + i * 3.2, -3.2, 1.4, 6.4);
  }
  ctx.fillStyle = '#F2C200';
  ctx.beginPath();
  ctx.ellipse(2.5, 0, 2.8, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#C0392B';
  ctx.beginPath();
  ctx.arc(6, -1.4, 1.2, 0, Math.PI * 2);
  ctx.arc(6, 1.4, 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#111111';
  ctx.beginPath();
  ctx.arc(5.5, 0, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawWeb(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 0.9;
  const spokes = 8;
  ctx.beginPath();
  for (let i = 0; i < spokes; i++) {
    const a = i / spokes * Math.PI * 2;
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.stroke();
  for (let k = 1; k <= 4; k++) {
    const rr = r * k / 4.3;
    ctx.beginPath();
    for (let i = 0; i <= spokes; i++) {
      const a = i / spokes * Math.PI * 2;
      const px = Math.cos(a) * rr;
      const py = Math.sin(a) * rr;
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();
  }
  ctx.fillStyle = '#2C2C2C';
  ctx.beginPath();
  ctx.arc(r * 0.15, -r * 0.1, r * 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawMoth(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, wing: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  const f = 0.7 + 0.3 * Math.sin(wing);
  ctx.fillStyle = '#9C8B73';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-9 * f, -6);
  ctx.lineTo(-7 * f, 5);
  ctx.closePath();
  ctx.moveTo(0, 0);
  ctx.lineTo(9 * f, -6);
  ctx.lineTo(7 * f, 5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#6B5B45';
  ctx.beginPath();
  ctx.ellipse(0, 0, 1.6, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawBear(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number): void {
  ctx.save();
  ctx.translate(x, y + Math.sin(t * 3) * 1.5);
  ctx.scale(s, s);
  ctx.fillStyle = '#6E4B2A';
  ctx.beginPath();
  ctx.ellipse(0, 10, 22, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, -12, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-11, -23, 5.5, 0, Math.PI * 2);
  ctx.arc(11, -23, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#C49A6C';
  ctx.beginPath();
  ctx.ellipse(0, -7, 7, 5.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1E1208';
  ctx.beginPath();
  ctx.arc(0, -9, 2.2, 0, Math.PI * 2);
  ctx.arc(-5.5, -15, 1.7, 0, Math.PI * 2);
  ctx.arc(5.5, -15, 1.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 180 * (60 * i - 30);
    const px = cx + r * Math.cos(a);
    const py = cy + r * Math.sin(a);
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
}

/** 巢房图标（在格子中心绘制，单位尺寸 r） */
export function drawBuildingIcon(ctx: CanvasRenderingContext2D, type: string, x: number, y: number, r: number,
  fill: number, t: number): void {
  ctx.save();
  ctx.translate(x, y);
  const k = r / 20;
  ctx.scale(k, k);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (type === 'queen') {
    drawBee(ctx, 0, 2, 1.25, -Math.PI / 2, t * 8, 'queen', false, true);
  } else if (type === 'nursery') {
    ctx.fillStyle = '#FFF8E7';
    ctx.strokeStyle = '#C9A46A';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2 + 0.5;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * 6, Math.sin(a) * 6, 4.2, 3, a + 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  } else if (type === 'scoutRoom') {
    ctx.strokeStyle = '#2E86C1';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#2E86C1';
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(3, 0);
    ctx.lineTo(0, 8);
    ctx.lineTo(-3, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#E74C3C';
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(3, 0);
    ctx.lineTo(-3, 0);
    ctx.closePath();
    ctx.fill();
  } else if (type === 'foragerRoom') {
    drawFlower(ctx, 0, 0, 10, '#FF8FB1', '#F2B705', 6, Math.sin(t) * 0.1);
  } else if (type === 'brewery') {
    ctx.fillStyle = '#8D5524';
    roundRect(ctx, -8, -5, 16, 14, 4);
    ctx.fill();
    ctx.fillStyle = '#F5B041';
    ctx.beginPath();
    ctx.ellipse(0, -5, 8, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5D3A1A';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(4, -12);
    ctx.lineTo(1, -4);
    ctx.stroke();
  } else if (type === 'storage') {
    ctx.fillStyle = 'rgba(120,70,10,0.35)';
    hexPath(ctx, 0, 0, 12);
    ctx.fill();
    ctx.save();
    hexPath(ctx, 0, 0, 12);
    ctx.clip();
    const lvl = 12 - 24 * Math.max(0, Math.min(1, fill));
    const g = ctx.createLinearGradient(0, lvl, 0, 12);
    g.addColorStop(0, '#FFC94A');
    g.addColorStop(1, '#D98E04');
    ctx.fillStyle = g;
    ctx.fillRect(-14, lvl, 28, 26);
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.ellipse(-4, -4, 2, 3, -0.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 'guardRoom') {
    ctx.fillStyle = '#C0392B';
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(9, -6);
    ctx.lineTo(7, 5);
    ctx.lineTo(0, 11);
    ctx.lineTo(-7, 5);
    ctx.lineTo(-9, -6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#F7DC6F';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4, 0);
    ctx.lineTo(0, 6);
    ctx.lineTo(-4, 0);
    ctx.closePath();
    ctx.fill();
  } else if (type === 'evolution') {
    ctx.strokeStyle = '#8E44AD';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const a = i / 40 * Math.PI * 4 + t;
      const rr = i / 40 * 10;
      if (i === 0) {
        ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      } else {
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
    }
    ctx.stroke();
    ctx.fillStyle = '#D2B4DE';
    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** 资源小图标（顶部状态栏、按钮） */
export function drawResIcon(ctx: CanvasRenderingContext2D, res: string, x: number, y: number, r: number): void {
  ctx.save();
  ctx.translate(x, y);
  if (res === 'nectar') {
    ctx.fillStyle = '#7FD1F7';
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.quadraticCurveTo(r, 0, 0, r);
    ctx.quadraticCurveTo(-r, 0, 0, -r);
    ctx.fill();
  } else if (res === 'honey') {
    ctx.fillStyle = '#F5A623';
    hexPath(ctx, 0, 0, r);
    ctx.fill();
  } else if (res === 'wax') {
    ctx.fillStyle = '#F3E5AB';
    ctx.strokeStyle = '#C9A46A';
    ctx.lineWidth = 1;
    hexPath(ctx, 0, 0, r);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillStyle = '#FFF4D6';
    ctx.strokeStyle = '#E3B04B';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

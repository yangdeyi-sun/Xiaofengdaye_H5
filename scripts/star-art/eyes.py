"""在原蜜蜂帧里找头部姿势：眼睛（采集/巢内/守卫蜂）或护目镜镜片（侦察蜂）。"""
import json, math, os
import numpy as np
from PIL import Image
from scipy import ndimage
# 原工种图集所在目录（build.py 会按项目路径改写）
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'public', 'art', 'v1') + os.sep
REF_MID=(125.0,105.0); REF_D=26.0
def load(name):
    d=json.load(open(SRC+name+'.json'))
    pages=[np.array(Image.open(SRC+p['image']).convert('RGBA')) for p in d['pages']]
    return d,pages
def frame_arr(d,pages,key):
    fr=d['frames'][key]; b=fr['frame']
    return pages[fr.get('page',0)][b['y']:b['y']+b['h'], b['x']:b['x']+b['w']]
def eyes(a):
    r,g,b,al=[a[...,i].astype(int) for i in range(4)]
    dark=(al>200)&(r<120)&(g<90)&(b<70)
    lab,n=ndimage.label(dark)
    objs=ndimage.find_objects(lab)
    out=[]
    for i,sl in enumerate(objs,1):
        if sl is None: continue
        h=sl[0].stop-sl[0].start; w=sl[1].stop-sl[1].start
        if h>16 or w>14 or h<6: continue
        m=(lab[sl]==i); area=m.sum()
        if area<25 or area>140: continue
        ys,xs=np.nonzero(m); cy=ys.mean()+sl[0].start; cx=xs.mean()+sl[1].start
        y0,y1=max(0,sl[0].start-3),min(256,sl[0].stop+3); x0,x1=max(0,sl[1].start-3),min(256,sl[1].stop+3)
        ring=a[y0:y1,x0:x1]
        yel=((ring[...,0]>200)&(ring[...,1]>150)&(ring[...,2]<120)).sum()
        lens=((ring[...,2]>170)&(ring[...,1]>170)&(ring[...,0]<210)).sum()
        if yel+lens<10: continue
        if cy<70 or cy>140: continue
        out.append((cx,cy,area))
    # pick the pair with similar size and distance 18..34
    best=None
    for i in range(len(out)):
        for j in range(i+1,len(out)):
            a1,a2=out[i],out[j]
            dd=math.hypot(a1[0]-a2[0],a1[1]-a2[1])
            if not 16<dd<36: continue
            if abs(a1[2]-a2[2])>25: continue
            sc=abs(dd-26)+abs(a1[2]-a2[2])*0.2
            if best is None or sc<best[0]: best=(sc,a1,a2)
    if best is None: return None
    l,r=sorted([best[1],best[2]],key=lambda e:e[0])
    return l,r
def transform(e):
    l,r=e
    mx,my=(l[0]+r[0])/2,(l[1]+r[1])/2
    ang=math.atan2(r[1]-l[1],r[0]-l[0]); dd=math.hypot(r[0]-l[0],r[1]-l[1])
    s=dd/REF_D
    # 3/4 view frames: eye distance shrinks horizontally; keep scale near 1 (bees don't really shrink)
    s=max(0.92,min(1.08,s))
    return mx,my,ang,s
def lenses(a):
    r,g,b,al=[a[...,i].astype(int) for i in range(4)]
    m=(al>200)&(b>170)&(g>170)&(r<215)&(b>r+10)
    lab,n=ndimage.label(m)
    out=[]
    for i,sl in enumerate(ndimage.find_objects(lab),1):
        if sl is None: continue
        mm=(lab[sl]==i); area=mm.sum()
        if area<200 or area>1400: continue
        ys,xs=np.nonzero(mm); out.append((xs.mean()+sl[1].start, ys.mean()+sl[0].start, area))
    out.sort(key=lambda e:-e[2])
    if len(out)<2: return None
    l,r=sorted(out[:2],key=lambda e:e[0])
    return l,r


if __name__=='__main__':
    for name in ['atlas_bees_forager','atlas_bees_scout','atlas_bees_house','atlas_bees_guard']:
        d,pages=load(name); miss=[]; stats=[]
        for k in d['frames']:
            e=eyes(frame_arr(d,pages,k))
            if e is None: miss.append(k)
            else:
                t=transform(e); stats.append((k,round(t[0]),round(t[1]),round(math.degrees(t[2])),round(t[3],2)))
        print(name, 'missing', miss)
        print('  ', [s for s in stats if abs(s[3])>3 or abs(s[1]-125)>4 or abs(s[2]-105)>4][:30])


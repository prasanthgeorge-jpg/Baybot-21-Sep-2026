#!/usr/bin/env python3
"""Adds each product's official video (direct MP4 + poster) to data/products-seed.json.
Tennant: the product page's JW Platform video (Overview first, then Demo, else the first non-training one).
PUDU forklift and mowers: the video on the product page. Run: python3 tools/import_videos.py"""
import json, re, os, glob, hashlib, html, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED = os.path.join(ROOT, 'data', 'products-seed.json')
UA = {'User-Agent': 'Mozilla/5.0'}
API = 'https://www.tennantco.com/tennantwebservices/v2/tennant/products/search'

def get(u):
    for i in range(4):
        try: return urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=45).read()
        except Exception:
            if i == 3: raise

ROBOT_CODES = {'tennant-t380amr': '2000055', 'tennant-t7amr': '2000056', 'tennant-t16amr': '2000054', 'tennant-x2-rovr': '2215278',
               'tennant-x4-rovr': '2000084', 'tennant-x6-rovr': '2000140', 'tennant-x16-sweep': '2000309', 'tennant-p1-vac': '2216378'}
urls = {}
for src in ['burnishers-and-floor-machines', 'extractors', 'scrubbers', 'specialty-cleaning-equipment', 'sweeper-scrubbers', 'sweepers', 'vacuums', 'robotics']:
    d = json.loads(get('%s?query=:relevance:productType:MACHINE:category:%s&fields=FULL&pageSize=100' % (API, src)))
    for p in d['products']: urls[p['code']] = p['url']

def pick(page):
    vids = []
    for m in re.finditer(r'<div class="item-title">\s*(.*?)\s*</div>\s*<div class="video-wrapper">\s*<div id="([A-Za-z0-9]{8})_(?:video_)?div" (?:data-video-group-id="([^"]*)" )?data-video-sort-order="(\d+)"', page, re.S):
        vids.append((m.group(3) or '', int(m.group(4)), m.group(2), html.unescape(re.sub(r'<[^>]+>', '', m.group(1))).strip()))
    seen, uniq = set(), []
    for v in vids:
        if v[2] not in seen: seen.add(v[2]); uniq.append(v)
    for group in ('overview', 'demo'):
        c = sorted([v for v in uniq if v[0] == group], key=lambda v: v[1])
        if c: return c[0]
    c = sorted([v for v in uniq if v[0] != 'training'], key=lambda v: v[1])
    return c[0] if c else None

def jw(mid):
    d = json.loads(get('https://cdn.jwplayer.com/v2/media/' + mid))['playlist'][0]
    mp4 = [s for s in d['sources'] if s['type'] == 'video/mp4' and s.get('height')]
    best = max([s for s in mp4 if s['height'] <= 720] or mp4, key=lambda s: s['height'])
    return best['file'], d.get('image', '')

def work(p):
    if p['brand'] != 'tennant' or p.get('videoSrc'): return p['slug'], None
    code = ROBOT_CODES.get(p['slug'])
    if not code:
        for c in urls:
            if p['id'] == 'tn' + hashlib.md5(c.encode()).hexdigest()[:14]: code = c
    if not code or code not in urls: return p['slug'], None
    try:
        v = None
        for _ in range(4):
            v = pick(get('https://www.tennantco.com' + urls[code]).decode('utf8', 'ignore'))
            if v: break
        if not v: return p['slug'], None
        f, poster = jw(v[2]); return p['slug'], (f, poster, v[3])
    except Exception as e:
        print('fail', p['slug'], e); return p['slug'], None

seed = json.load(open(SEED))
with ThreadPoolExecutor(4) as ex:
    res = dict(ex.map(work, seed['products']))
n = 0
for p in seed['products']:
    r = res.get(p['slug'])
    if r: p['videoSrc'], p['videoPoster'], p['videoTitle'] = r; n += 1
# PUDU forklift and mowers
for p in seed['products']:
    key = {'pudu-mp2000': 'mp2000', 'pudu-gt3': 'pudu-gt3', 'pudu-gt5': 'pudu-gt5', 'pudu-gt7': 'pudu-gt7'}.get(p['slug'])
    if not key: continue
    page = get('https://www.pudurobotics.com/en/products/' + key).decode('utf8', 'ignore')
    d = json.loads(re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', page, re.S).group(1))['props']['pageProps']
    f0 = [c for c in d['productDetailData'] if c['__component'] == 'product-info.f0'][0]
    if f0.get('videoUrl'):
        p['videoSrc'] = f0['videoUrl']['url']; p['videoPoster'] = (f0.get('mediaUrl') or {}).get('url', ''); n += 1
json.dump(seed, open(SEED, 'w'), indent=2, ensure_ascii=False)
print(n, 'products now have an official video of', len(seed['products']))
for p in seed['products']:
    if not p.get('videoSrc'): print('no video:', p['name'])

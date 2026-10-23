#!/usr/bin/env python3
"""Adds PUDU's autonomous forklift (MP2000) and robotic lawn mowers (GT3, GT5, GT7) to
data/products-seed.json from pudurobotics.com. Photos go to assets/images/models/ as WebP.
Run: python3 tools/import_pudu_extras.py"""
import json, re, os, io, html, hashlib, urllib.request
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED = os.path.join(ROOT, 'data', 'products-seed.json')
IMG = os.path.join(ROOT, 'assets', 'images', 'models')
UA = {'User-Agent': 'Mozilla/5.0'}
CATS = {
    'forklift': ('Autonomous Forklifts', 'AI-native pallet handling robots that load, lift and move pallets without a driver.', 'warehouse'),
    'lawn-mowers': ('Robotic Lawn Mowers', 'Commercial autonomous mowers for sports fields, campuses, parks and large grounds.', 'seedling'),
}
ITEMS = [('mp2000', 'forklift', ['Warehouses', 'Distribution Centers', 'Manufacturing Plants', 'Logistics Hubs']),
         ('pudu-gt3', 'lawn-mowers', ['Campuses', 'Parks', 'Golf Courses', 'Commercial Grounds']),
         ('pudu-gt5', 'lawn-mowers', ['Sports Fields', 'Campuses', 'Parks', 'Commercial Grounds']),
         ('pudu-gt7', 'lawn-mowers', ['Golf Courses', 'Sports Fields', 'Resorts', 'Estates'])]

def get(u): return urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60).read()
def clean(t): return re.sub(r'\s+', ' ', html.unescape(str(t or ''))).strip()

listing = get('https://www.pudurobotics.com/en/products').decode('utf8', 'ignore')
def nav_image(title):
    m = re.search(r'\{"title":"' + re.escape(title) + r'","desc":"[^"]*","mediaUrl":"([^"]*)"', listing)
    return m.group(1)

seed = json.load(open(SEED))
have_cats = {c['id'] for c in seed['categories']}
for cid, (label, desc, icon) in CATS.items():
    if cid not in have_cats:
        seed['categories'].append({'id': cid, 'label': label, 'description': desc, 'icon': icon, 'createdAt': '2026-10-23T00:00:00.000Z'})
seed['products'] = [p for p in seed['products'] if p['slug'] not in ('pudu-' + k.replace('pudu-', '') for k, *_ in ITEMS)]

for key, cat, deployed in ITEMS:
    page = get('https://www.pudurobotics.com/en/products/' + key).decode('utf8', 'ignore')
    d = json.loads(re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', page, re.S).group(1))['props']['pageProps']
    base, comps = d['productBaseData'], d['productDetailData']
    name = clean(base['name']); tagline = clean(base['second_title'])
    feats, paras, specs, video, photo = [], [], [], '', ''
    for c in comps:
        k = c['__component']
        if k.startswith('product-info.f1') and c.get('title') and c.get('desc'):
            feats.append({'title': clean(c['title']), 'text': clean(c['desc'])}); paras.append(clean(c['desc']))
        if k == 'product-info.c3' and not specs:
            for pr in c['paramsList']:
                v = ' / '.join(clean(x['title']) for x in pr['value'])
                if clean(pr['title']) and v: specs.append({'label': clean(pr['title']), 'value': v})
        if k == 'product-info.c7' and c.get('robot'): photo = c['robot']['url']
    for c in comps:
        if c['__component'] == 'product-info.icon-1-f7-2':
            for it in c['dataList']:
                t = clean(it['title'])
                if t and not any(f['title'] == t for f in feats): feats.append({'title': t, 'text': ''})
    feats = [f for f in feats if f['text']][:8] or feats[:8]
    photo = nav_image(name) or photo
    im = Image.open(io.BytesIO(get(photo))).convert('RGBA')
    bbox = im.getbbox()
    if bbox: im = im.crop(bbox)
    im.thumbnail((900, 900))
    slug = 'pudu-' + key.replace('pudu-', '')
    fn = slug + '.webp'
    im.save(os.path.join(IMG, fn), 'WEBP', quality=85, method=6)
    summary = (paras[0] if paras else tagline)
    seed['products'].append({
        'id': 'pd' + hashlib.md5(key.encode()).hexdigest()[:14], 'slug': slug, 'name': name, 'brand': 'pudu',
        'category': cat, 'categoryLabel': CATS[cat][0], 'layout': 'showcase', 'tagline': tagline,
        'summary': summary[:240], 'overview': '\n\n'.join(paras[:4]) or summary, 'videoId': '',
        'deployedIn': deployed, 'features': feats, 'specs': specs[:14], 'image': 'assets/images/models/' + fn,
        'gallery': [], 'status': 'published', 'createdAt': '2026-10-23T00:00:00.000Z', 'updatedAt': '2026-10-23T00:00:00.000Z'})
    print(name, '|', tagline, '|', len(feats), 'features', len(specs), 'specs', im.size)
json.dump(seed, open(SEED, 'w'), indent=2, ensure_ascii=False)

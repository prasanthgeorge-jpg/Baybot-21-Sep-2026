#!/usr/bin/env python3
"""Adds Tennant's non-robot machines (scrubbers, sweepers, extractors, ...) to
data/products-seed.json from Tennant's public product catalogue. Photos are saved as WebP
under assets/images/models/. Run: python3 tools/import_tennant_machines.py"""
import json, re, os, hashlib, html, io, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED = os.path.join(ROOT, 'data', 'products-seed.json')
IMG = os.path.join(ROOT, 'assets', 'images', 'models')
API = 'https://www.tennantco.com/tennantwebservices/v2/tennant/products/search'
UA = {'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'}

CATS = {
    'walk-behind-scrubbers': ('Walk-Behind Floor Scrubbers', 'Walk-behind and push scrubbers for aisles, restrooms and tight spaces.', 'broom'),
    'ride-on-scrubbers': ('Ride-On Floor Scrubbers', 'Ride-on and stand-on scrubbers for large areas and industrial floors.', 'truck'),
    'sweepers': ('Sweepers', 'Walk-behind and ride-on sweepers for indoor and outdoor debris.', 'dolly'),
    'sweeper-scrubbers': ('Sweeper-Scrubbers', 'Machines that sweep and scrub in a single pass.', 'industry'),
    'burnishers-floor-machines': ('Burnishers & Floor Machines', 'High-speed burnishers and floor machines for polishing and floor finishing.', 'building'),
    'extractors': ('Carpet Extractors', 'Carpet and upholstery extractors from spot cleaning to ride-on.', 'seedling'),
    'vacuums': ('Vacuums', 'Dry, wet/dry, upright, backpack and canister vacuums.', 'box-open'),
    'specialty-cleaning': ('Specialty Cleaning Equipment', 'Canister and pressure cleaning equipment for specialised jobs.', 'screwdriver-wrench'),
}
SRC = {'burnishers-and-floor-machines': 'burnishers-floor-machines', 'extractors': 'extractors', 'scrubbers': 'scrubbers',
       'specialty-cleaning-equipment': 'specialty-cleaning', 'sweeper-scrubbers': 'sweeper-scrubbers', 'sweepers': 'sweepers', 'vacuums': 'vacuums'}

def get(url, headers=None):
    return urllib.request.urlopen(urllib.request.Request(url, headers=headers or UA), timeout=40).read()

def text(h):
    h = re.sub(r'<[^>]+>', ' ', h or '')
    return re.sub(r'\s+', ' ', html.unescape(h)).strip()

def category_of(src, p):
    if src != 'scrubbers': return SRC[src]
    s = (p['url'] + ' ' + p['name']).lower()
    return 'ride-on-scrubbers' if re.search(r'ride-on|rider|stand-on', s) else 'walk-behind-scrubbers'

seed = json.load(open(SEED))
have = {p['slug'] for p in seed['products']}
robot_codes = {'2000140', '2215278', '2000084', '2000054', '2000056', '2000055', '2000309', '2216378'}
found = {}
for src in SRC:
    d = json.loads(get('%s?query=:relevance:productType:MACHINE:category:%s&fields=FULL&pageSize=100' % (API, src)))
    for p in d['products']:
        if p['machineStatus'] != 'AVAILABLE' or p['code'] in robot_codes or p['code'] in found: continue
        p['_cat'] = category_of(src, p); found[p['code']] = p
print(len(found), 'available non-robot machines')

def build(p):
    url = 'https://www.tennantco.com' + p['url']
    parts = p['url'].split('/')[-1].split('.')           # product.<model>.<type...>.<code>.html
    model_slug, type_slug = parts[1], parts[2] if len(parts) > 4 else ''
    kind = type_slug.replace('-', ' ').title() if type_slug and not re.search(r'\d', type_slug) else ''
    meta, title = '', ''
    try:
        page = get(url, {'User-Agent': 'Mozilla/5.0'}).decode('utf8', 'ignore')
        title = text((re.findall(r'<title>(.*?)</title>', page, re.S) or [''])[0]).split('|')[0].strip()
        meta = text((re.findall(r'<meta name="description" content="(.*?)"', page, re.S) or [''])[0])
    except Exception as e:
        pass
    br = re.findall(r'\[([^\]]+)\]', p['name'])
    model = (br[0] if br and not re.search(r'NA|TENNANT|V,|\d\s*(IN|AH|CM)', br[0]) else model_slug.upper()).strip()
    if title and kind and title.lower().endswith(kind.lower()):
        model = title[:-len(kind)].strip() or model
    elif title and '|' not in title and len(title) < 60 and not kind:
        model = title
    model = re.sub(r'\s+', ' ', model)
    name = ('Tennant ' + model) if not model.lower().startswith('tennant') else model
    slug = 'tennant-' + re.sub(r'[^a-z0-9]+', '-', model_slug.lower()).strip('-')
    if not kind:
        kind = text(p.get('summary') or '').title()[:60]
    desc = text(p.get('description'))
    summary = (meta or desc)[:260]
    # photo
    fn = slug + '.webp'
    try:
        im = Image.open(io.BytesIO(get('https://www.tennantco.com/services/product/image.tennant.%s.image' % p['code'], {'User-Agent': 'Mozilla/5.0'}))).convert('RGB')
        im.save(os.path.join(IMG, fn), 'WEBP', quality=82, method=6)
    except Exception as e:
        print('no photo', p['code'], e); return None
    return {
        'id': 'tn' + hashlib.md5(p['code'].encode()).hexdigest()[:14], 'slug': slug, 'name': name, 'brand': 'tennant',
        'category': p['_cat'], 'categoryLabel': CATS[p['_cat']][0], 'layout': 'showcase',
        'tagline': kind or CATS[p['_cat']][0][:-1], 'summary': summary or (name + ' from Tennant.'),
        'overview': desc or summary, 'videoId': '', 'deployedIn': [], 'features': [], 'specs': [],
        'image': 'assets/images/models/' + fn, 'gallery': [], 'status': 'published',
        'createdAt': '2026-10-23T00:00:00.000Z', 'updatedAt': '2026-10-23T00:00:00.000Z', '_code': p['code']}

with ThreadPoolExecutor(8) as ex:
    built = [b for b in ex.map(build, found.values()) if b]
slugs = set(have); out = []
for b in sorted(built, key=lambda b: (list(CATS).index(b['category']), b['name'])):
    if b['slug'] in slugs: b['slug'] += '-' + b['_code']
    slugs.add(b['slug']); b.pop('_code'); out.append(b)
have_cats = {c['id'] for c in seed['categories']}
for cid, (label, desc, icon) in CATS.items():
    if cid in have_cats or not any(b['category'] == cid for b in out): continue
    seed['categories'].append({'id': cid, 'label': label, 'description': desc, 'icon': icon, 'createdAt': '2026-10-23T00:00:00.000Z'})
seed['products'] = [p for p in seed['products'] if not p['id'].startswith('tn') or p['id'].startswith(('tnt', 'tntx'))] + out
json.dump(seed, open(SEED, 'w'), indent=2, ensure_ascii=False)
print('added', len(out))
for b in out: print(b['category'], '|', b['name'], '|', b['tagline'])

#!/usr/bin/env python3
"""Adds the Hivebotics Abluo restroom cleaning robots (Mark 1 and Mark 2) to data/products-seed.json
from hivebotics.tech (details, photos and the YouTube demo videos listed on its product page).
Run: python3 tools/import_hivebotics.py"""
import json, os, io, urllib.request
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED = os.path.join(ROOT, 'data', 'products-seed.json')
IMG = os.path.join(ROOT, 'assets', 'images', 'models')
SB = 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/691290ba8bd9a0702ef397bb/'

def fetch(u): return urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0'}), timeout=60).read()
def save(name, url, width=1200):
    im = Image.open(io.BytesIO(fetch(url))).convert('RGB')
    im.thumbnail((width, width))
    fn = name + '.webp'
    im.save(os.path.join(IMG, fn), 'WEBP', quality=82, method=6)
    return 'assets/images/models/' + fn

CAT = ('restroom-cleaning', 'Restroom Cleaning Robots', 'Autonomous robots that clean, sanitize and verify restrooms in high-traffic facilities.', 'broom')
NOW = '2026-10-23T00:00:00.000Z'

m1_img = save('hivebotics-abluo-mark-1', 'https://hivebotics.tech/media/abluo-whole-robot.webp')
m1_gal = [save('hivebotics-abluo-mark-1-g1', 'https://hivebotics.tech/media/abluo-hero-v5-poster.webp'),
          save('hivebotics-abluo-mark-1-g2', 'https://hivebotics.tech/media/abluo-with-staff-v3.webp')]
m2_img = save('hivebotics-abluo-mark-2', SB + 'c17a92f5f_WhatsAppImage2026-02-13at91045PM.jpg')
m2_gal = [save('hivebotics-abluo-mark-2-g%d' % (i + 1), SB + f) for i, f in enumerate([
    'd21975a7d_WhatsAppImage2026-02-13at91044PM2.jpg', '67cd5e976_WhatsAppImage2026-02-13at91047PM.jpg',
    'b19aaf7c9_WhatsAppImage2026-02-22at11449AM.jpg', '3d4fb5061_WhatsAppImage2026-02-22at12445AM.jpg',
    'eb37d72d9_Gemini_Generated_Image_capswxcapswxcaps.png', '0974c6dd9_Gemini_Generated_Image_kwoutykwoutykwou.png'])]

def prod(pid, slug, name, tagline, summary, overview, deployed, feats, specs, image, gallery, extra):
    p = {'id': pid, 'slug': slug, 'name': name, 'brand': 'hivebotics', 'category': CAT[0], 'categoryLabel': CAT[1],
         'layout': 'showcase', 'tagline': tagline, 'summary': summary, 'overview': overview, 'videoId': '', 'deployedIn': deployed,
         'features': [{'title': a, 'text': b} for a, b in feats], 'specs': [{'label': a, 'value': b} for a, b in specs],
         'image': image, 'gallery': gallery, 'status': 'published', 'createdAt': NOW, 'updatedAt': NOW}
    p.update(extra); return p

ENV = ['Airports', 'Hospitals & Healthcare', 'Educational Campuses', 'Shopping Malls', 'Commercial & Office Buildings', 'Industrial Facilities']
mk1 = prod('hv0000000000mk01', 'hivebotics-abluo-mark-1', 'Hivebotics Abluo Mark 1', 'Autonomous Bathroom Cleaning Robot',
    'Hospital-grade disinfection. Zero human intervention. 24/7 operation.',
    'Abluo Mark 1 is the original autonomous restroom cleaning robot from Hivebotics. It cleans toilet bowls, urinals, sinks, floors, mirrors and partitions on its own, and its AI vision system verifies cleanliness as it works.\\n\\n'
    'Hospital-grade steaming, chemical jetting, vacuuming and blow drying give consistent disinfection on every surface, while built-in navigation, obstacle detection and automatic recharging keep it running without manual oversight.'.replace('\\n', '\n'),
    ENV[:4],
    [('AI Vision System', 'Advanced computer vision verifies cleanliness in real time, detects stains, and learns to tackle different surfaces with precision.'),
     ('Industrial Cleaning', 'Hospital-grade steaming, chemical jetting, vacuuming and blow drying ensure consistent disinfection across all surfaces.'),
     ('Full Autonomy', 'Intelligent navigation, obstacle detection, optimal route planning and automatic recharging, with no manual oversight required.'),
     ('Safety Features', 'Real-time obstacle detection, emergency stop system, human presence sensors and auto-shutdown protocols.')],
    [('Dimensions', '775 mm x 510 mm x 1100 mm'), ('Weight (loaded)', '225 kg'), ('Power source', 'Lithium-ion battery'), ('Runtime', '4 to 6 hours continuous'),
     ('Coverage', '8 to 12 bathrooms per cycle'), ('Cleaning speed', '30 to 40 minutes per bathroom'),
     ('Cleaning zones', 'Toilet bowls, urinals, sinks and faucets, floors, mirrors, partitions')],
    m1_img, m1_gal,
    {'videoId': 'CJAWnxS1ZGA', 'extraVideos': [
        {'id': 'czN-DJeXj0Q', 'title': 'Robot versus Human: Toilet Bowl Cleaning'},
        {'id': 'HwibAW55_xo', 'title': 'Human versus Robot: Sink Cleaning'},
        {'id': 'M6z_hMr1YbE', 'title': 'Abluo M1: AI Restroom Cleaning Robot'}]})
mk2 = prod('hv0000000000mk02', 'hivebotics-abluo-mark-2', 'Hivebotics Abluo Mark 2', 'AI Restroom Cleaner',
    'Next-generation AI restroom cleaner with 3D SLAM navigation, a 6-axis robot arm and swappable batteries for non-stop operation.',
    'Abluo Mark 2 is an AI-powered autonomous cleaning robot designed for high-traffic facilities such as airports, hospitals, schools and commercial buildings. It works alongside facility staff to automate repetitive restroom cleaning workflows.\n\n'
    'Powered by Hivebotics OS and HiveIntelligence, its physical AI layer, it gives organizations reliable hygiene standards with greater operational visibility and control, and cuts labor intervention by about 60 to 70 percent.',
    ENV,
    [('Fully Autonomous Cleaning', 'Restroom cleaning workflows that need minimal staff supervision, cutting labor intervention by about 60 to 70 percent.'),
     ('AI-Powered Vision and Navigation', '3D SLAM with LiDAR, depth cameras and ultrasonic sensors for real-time mapping and safe navigation in complex environments.'),
     ('Multi-Function Cleaning', 'A complete sanitation cycle: seat lifting, flushing, contactless steam cleaning, chemical jetting and blow drying.'),
     ('Non-Stop Cleaning', 'Swappable high-capacity battery modules minimize downtime. An optional docking station recharges, refills water and replenishes cleaning solutions automatically.'),
     ('Safety by Design', 'Cliff sensors, bumper sensors, ultrasound safety sensors and advanced monitoring for reliable operation in public spaces.'),
     ('Operational Data and Predictive Maintenance', 'Real-time performance tracking through the HiveCommand app, with 4G LTE connectivity, GPS geofencing and WPA2-Enterprise security.')],
    [('Labor reduction', '60 to 70 percent'), ('Cleaning cycle', 'About 40 minutes'), ('Battery runtime', '3 hours (swappable batteries)'),
     ('Robot arm', '6 DOF, 0.02 mm repeatability'), ('Navigation', '3D SLAM with LiDAR'), ('Computing', 'AMD Ryzen with NVIDIA Quadro RTX'),
     ('Cleaning modes', '6, including 173 degrees C steam sanitation'), ('Connectivity', '4G LTE, GPS geofencing, WPA2-Enterprise'),
     ('Operation modes', 'Automatic, manual, HiveCommand app')],
    m2_img, m2_gal, {})

seed = json.load(open(SEED))
if not any(c['id'] == CAT[0] for c in seed['categories']):
    seed['categories'].append({'id': CAT[0], 'label': CAT[1], 'description': CAT[2], 'icon': CAT[3], 'createdAt': NOW})
seed['products'] = [p for p in seed['products'] if p.get('brand') != 'hivebotics'] + [mk1, mk2]
json.dump(seed, open(SEED, 'w'), indent=2, ensure_ascii=False)
print('added', mk1['name'], mk2['name'])

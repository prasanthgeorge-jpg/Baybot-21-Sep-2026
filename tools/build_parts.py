#!/usr/bin/env python3
"""Rebuild the Parts Store price list inside parts-store.html from data/parts.json.

    python3 tools/build_parts.py

Writes between <!-- PARTS:START --> and <!-- PARTS:END -->. Edit data/parts.json (or re-run
tools/import_parts_prices.py on a new Excel), not the generated HTML.
"""
import json, os, re
from html import escape as esc

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SECTIONS = [
    ("consumables", "Consumables", "fa-rotate", "Brushes, squeegees, filters and other wear items that are replaced on a schedule."),
    ("accessories", "Accessories", "fa-plug", "Docks, charging stations, add-on modules and optional equipment."),
    ("spare-parts", "Spare Parts", "fa-gears", "Replacement components for repairs: wheels, sensors, boards, shells and more."),
]
ORDER = ["PUDU CC1", "PUDU SH1", "PUDU MT1", "PUDU T300", "BellaBot", "BellaBot Pro", "KettyBot", "KettyBot Pro",
         "HolaBot", "PuduBot", "PuduBot 2", "SwiftBot", "FlashBot"]
OTHER = "Other"


def money(v):
    return "${:,.2f}".format(v)


def row(it, sec):
    robots = it["robot"] or []
    fits = ", ".join(robots) if robots else "Various"
    keys = robots or [OTHER]
    search = " ".join([it["name"], it["sku"], it.get("note", ""), fits]).lower()
    if it["image"]:
        img = '<img src="assets/images/parts/%s" alt="" width="64" height="64" loading="lazy" decoding="async">' % esc(it["image"])
    else:
        img = '<span class="pl-noimg" aria-hidden="true"><i class="fas fa-gear"></i></span>'
    if it["price"] is None:
        price = '<a class="pl-quote" href="#request-part" data-sku="%s">Request a quote</a>' % esc(it["sku"])
    else:
        price = '<span class="pl-price">%s</span>' % money(it["price"])
    note = it.get("note", "")
    note_html = '<span class="pl-note">%s</span>' % esc(note) if note and note.lower() != it["name"].lower() else ""
    return (
        '<tr data-robots="%s" data-search="%s">'
        '<td class="pl-photo">%s</td>'
        '<td class="pl-name"><strong>%s</strong>%s</td>'
        '<td class="pl-sku" data-label="Part no.">%s</td>'
        '<td class="pl-fits" data-label="Fits">%s</td>'
        '<td class="pl-cost" data-label="Price (USD)">%s</td></tr>'
    ) % ("|".join(keys), esc(search), img, esc(it["name"]), note_html, esc(it["sku"]), esc(fits), price)


def build():
    data = json.load(open(os.path.join(ROOT, "data/parts.json")))["sections"]
    used = set()
    for sec in data.values():
        for it in sec:
            used.update(it["robot"] or [OTHER])
    chips = [r for r in ORDER if r in used] + sorted(r for r in used if r not in ORDER and r != OTHER)
    if OTHER in used:
        chips.append(OTHER)
    total = sum(len(v) for v in data.values())
    o = []
    o.append('''<section class="parts-list-section" id="price-list">
            <div class="container">
                <div class="section-header text-center">
                    <span class="section-label">Price List</span>
                    <h2 class="section-title">Parts &amp; Consumables Prices</h2>
                    <p class="section-description">%s genuine parts with prices, grouped as consumables, accessories and spare parts. Find your part by name, part number or robot.</p>
                </div>
                <p class="pl-disclaimer"><i class="fas fa-circle-info" aria-hidden="true"></i> Prices are in US dollars for end users. They are for information and can change from time to time. Shipping charges apply. Please contact us for today&rsquo;s price and to confirm the part fits your serial number.</p>

                <div class="pl-toolbar" id="plToolbar">
                    <div class="pl-tabs" role="tablist" aria-label="Price list sections">''' % format(total, ','))
    for k, title, icon, _ in SECTIONS:
        o.append('<a href="#pl-%s" class="pl-tab" data-target="%s"><i class="fas %s" aria-hidden="true"></i> %s <span class="pl-count" data-count-for="%s">%d</span></a>' % (k, k, icon, title, k, len(data[k])))
    o.append('''</div>
                    <div class="pl-filters">
                        <label class="pl-search"><i class="fas fa-magnifying-glass" aria-hidden="true"></i><span class="visually-hidden">Search parts</span><input type="search" id="plSearch" placeholder="Search by part name or number" autocomplete="off"></label>
                        <label class="pl-robot"><span class="visually-hidden">Filter by robot</span><select id="plRobot"><option value="">All robots</option>''')
    for c in chips:
        o.append('<option value="%s">%s</option>' % (esc(c), esc(c)))
    o.append('</select></label></div></div>')
    for k, title, icon, desc in SECTIONS:
        items = sorted(data[k], key=lambda i: (ORDER.index(i["robot"][0]) if i["robot"] and i["robot"][0] in ORDER else 99, i["name"].lower()))
        o.append('<section class="pl-block" id="pl-%s" data-section="%s"><div class="pl-block-head"><h3><i class="fas %s" aria-hidden="true"></i> %s</h3><p>%s <span class="pl-shown"></span></p></div>' % (k, k, icon, title, esc(desc)))
        o.append('<div class="pl-table-wrap"><table class="pl-table"><thead><tr><th scope="col"><span class="visually-hidden">Photo</span></th><th scope="col">Part</th><th scope="col">Part no.</th><th scope="col">Fits</th><th scope="col">Price (USD)</th></tr></thead><tbody>')
        o.extend(row(i, k) for i in items)
        o.append('</tbody></table></div><p class="pl-empty" hidden>No parts match. Try a different word or robot, or <a href="#request-part">ask us for the part</a>.</p></section>')
    o.append('</div></section>')
    block = "\n".join(o)

    p = os.path.join(ROOT, "parts-store.html")
    s = open(p, encoding="utf-8").read()
    pat = re.compile(r"<!-- PARTS:START[^>]*-->.*?<!-- PARTS:END -->", re.S)
    new = "<!-- PARTS:START - generated by tools/build_parts.py from data/parts.json; edit the data, not this block -->\n        " + block + "\n        <!-- PARTS:END -->"
    if pat.search(s):
        s = pat.sub(lambda m: new, s)
    else:  # first run: replace the old six-card "Replacement Parts & Consumables" section
        a = s.index('<section class="industries-section">\n            <div class="container">\n                <div class="section-header text-center">\n                    <span class="section-label">Product Parts</span>')
        b = s.index('<section class="about-section" id="request-part">')
        s = s[:a] + new + "\n\n        " + s[b:]
    open(p, "w", encoding="utf-8").write(s)
    print("Built price list: %d parts, %d robots" % (total, len(chips)))


if __name__ == "__main__":
    build()

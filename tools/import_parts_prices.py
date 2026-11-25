#!/usr/bin/env python3
"""Read the PUDU parts price list (Excel) into data/parts.json and part photos into assets/images/parts/.

    python3 tools/import_parts_prices.py "/path/to/price list.xlsx"

Only the END-USER price is kept. Dealer prices are never written to disk. Sheets used: the first three
(Consumables, Accessories, Spare Parts). Then run tools/build_parts.py to rebuild the Parts Store page.
"""
import sys, os, re, io, json, hashlib
from decimal import Decimal, ROUND_HALF_UP
import openpyxl
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEETS = [  # key, sheet index, end-user column index
    ("consumables", 0, 6),
    ("accessories", 1, 6),
    ("spare-parts", 2, 7),
]
THUMB = 220


def clean(v):
    return re.sub(r"\s+", " ", str(v)).strip() if v is not None else ""


def english(v):
    """Names are 'Chinese\\nEnglish' in places; keep the English line."""
    lines = [clean(x) for x in str(v or "").split("\n") if clean(x)]
    latin = [x for x in lines if re.search(r"[A-Za-z]", x)]
    return (latin[-1] if latin else (lines[-1] if lines else "")).strip()


def robots(v):
    v = str(v or "")
    parts = [clean(x) for x in re.split(r"[\n|]", v) if clean(x)]
    out = []
    for p in parts:
        p = {"Pudubot": "PuduBot", "PuduBot2": "PuduBot 2", "Bellabot": "BellaBot", "Bellabot Pro": "BellaBot Pro",
             "Kettybot": "KettyBot", "Kettybot Pro": "KettyBot Pro", "Holabot": "HolaBot", "Swiftbot": "SwiftBot",
             "Flashbot": "FlashBot"}.get(p, p)
        if p not in out:
            out.append(p)
    return out


def main(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    os.makedirs(os.path.join(ROOT, "assets/images/parts"), exist_ok=True)
    seen_img = {}
    data = {}
    for key, idx, price_col in SHEETS:
        ws = wb.worksheets[idx]
        pics = {}
        for im in ws._images:
            r = im.anchor._from.row  # 0-based row
            try:
                raw = im._data()
            except Exception:
                continue
            pics.setdefault(r, raw)
        items = []
        by_sku = {}
        for r, row in enumerate(ws.iter_rows(values_only=True)):
            sku = clean(row[1]) if len(row) > 1 else ""
            if not re.match(r"^\d{4,5}-\d{6}$", sku):
                continue
            name = english(row[3]) or english(row[5] if len(row) > 5 else "")
            if not name or name == "0":
                continue  # no usable name: skip rather than publish an unlabelled price
            p = row[price_col]
            price = float(Decimal(str(p)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)) if isinstance(p, (int, float)) else None
            img = ""
            raw = pics.get(r)
            if raw:
                h = hashlib.md5(raw).hexdigest()[:12]
                if h not in seen_img:
                    try:
                        im = Image.open(io.BytesIO(raw)).convert("RGB")
                        im.thumbnail((THUMB, THUMB))
                        fn = "%s.webp" % h
                        im.save(os.path.join(ROOT, "assets/images/parts", fn), "WEBP", quality=72)
                        seen_img[h] = fn
                    except Exception:
                        seen_img[h] = ""
                img = seen_img[h]
            if sku in by_sku:  # same part listed for several robots: one row, all robots
                it = by_sku[sku]
                for rb in robots(row[0]):
                    if rb not in it["robot"]:
                        it["robot"].append(rb)
                it["image"] = it["image"] or img
                continue
            it = {"sku": sku, "name": name, "robot": robots(row[0]), "note": english(row[4]) if len(row) > 4 else "",
                  "price": price, "image": img}
            by_sku[sku] = it
            items.append(it)
        data[key] = items
    out = os.path.join(ROOT, "data/parts.json")
    json.dump({"sections": data}, open(out, "w"), indent=1, ensure_ascii=False)
    for k, v in data.items():
        print(k, len(v), "with price:", sum(1 for i in v if i["price"] is not None), "with photo:", sum(1 for i in v if i["image"]))
    print("photos:", len([x for x in seen_img.values() if x]))


if __name__ == "__main__":
    main(sys.argv[1])

#!/usr/bin/env python3
"""Build data/menu.sqlite from the CookUnity spreadsheet. Standard library only."""

import sqlite3
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
XLSX = ROOT / "data" / "cookunity_east_coast_public_menu_2026-10-08.xlsx"
OUT = ROOT / "data" / "menu.sqlite"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def col_index(cell_ref):
    col = ""
    row = ""
    for char in cell_ref:
        if char.isalpha():
            col += char
        else:
            row += char
    n = 0
    for char in col:
        n = n * 26 + ord(char) - 64
    return n, int(row)


def load_rows(path):
    with zipfile.ZipFile(path) as workbook:
        shared = ET.fromstring(workbook.read("xl/sharedStrings.xml"))
        strings = [
            "".join(node.text or "" for node in item.iter(NS + "t"))
            for item in shared
        ]
        sheet = ET.fromstring(workbook.read("xl/worksheets/sheet1.xml"))
    rows = {}
    for cell in sheet.iter(NS + "c"):
        ref = cell.attrib.get("r")
        if not ref:
            continue
        col, row = col_index(ref)
        value_node = cell.find(NS + "v")
        value = value_node.text if value_node is not None else ""
        if cell.attrib.get("t") == "s" and value != "":
            value = strings[int(value)]
        rows.setdefault(row, {})[col] = value
    return rows


def flags(categories, tags):
    cats = categories.lower()
    blob = f"{categories} {tags}".lower()
    is_fish = (
        "seafood" in cats
        or "protein: fish" in blob
        or "protein: shrimp" in blob
        or "protein: salmon" in blob
        or "shellfish" in blob
        or "protein: lobster" in blob
        or "protein: cod" in blob
        or "protein: sea bass" in blob
        or "protein: tilapia" in blob
        or "protein: swai" in blob
        or "protein: barramundi" in blob
        or "protein: mahi" in blob
        or "protein: arctic char" in blob
    )
    is_chicken = "poultry" in cats or "chicken" in blob
    is_meat = "beef" in cats or any(
        token in blob
        for token in (
            "protein: beef",
            "protein: pork",
            "protein: lamb",
            "protein: bacon",
            "protein: ham",
            "protein: brisket",
        )
    )
    is_veg = ("vegetarian" in cats or "vegan" in cats) and not (
        is_fish or is_chicken or is_meat
    )
    return int(is_fish), int(is_chicken), int(is_meat), int(is_veg)


def number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def main():
    rows = load_rows(XLSX)
    meals = []
    for row_number in range(8, max(rows) + 1):
        row = rows.get(row_number) or {}
        name = row.get(1, "")
        if not name:
            continue
        categories = row.get(3, "")
        tags = row.get(4, "")
        fish, chicken, meat, veg = flags(categories, tags)
        meals.append(
            (
                name,
                row.get(2, ""),
                categories,
                tags,
                row.get(5, ""),
                number(row.get(6)),
                number(row.get(7)),
                number(row.get(8)),
                number(row.get(9)),
                number(row.get(10)),
                row.get(11, ""),
                row.get(12, ""),
                fish,
                chicken,
                meat,
                veg,
            )
        )

    if OUT.exists():
        OUT.unlink()
    connection = sqlite3.connect(OUT)
    connection.execute(
        """
        CREATE TABLE meals (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          chef TEXT,
          categories TEXT,
          tags TEXT,
          url TEXT,
          calories REAL,
          protein REAL,
          carbs REAL,
          fat REAL,
          protein_per_100 REAL,
          nutrition_labels TEXT,
          cookunity_labels TEXT,
          is_fish INTEGER,
          is_chicken INTEGER,
          is_meat INTEGER,
          is_veg INTEGER
        )
        """
    )
    connection.executemany(
        """
        INSERT INTO meals (
          name, chef, categories, tags, url, calories, protein, carbs, fat,
          protein_per_100, nutrition_labels, cookunity_labels,
          is_fish, is_chicken, is_meat, is_veg
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        meals,
    )
    connection.commit()
    counts = connection.execute(
        """
        SELECT COUNT(*), SUM(is_fish), SUM(is_chicken), SUM(is_meat), SUM(is_veg)
        FROM meals
        """
    ).fetchone()
    connection.close()
    print(f"Wrote {OUT} meals={counts[0]} fish={counts[1]} chicken={counts[2]} meat={counts[3]} veg={counts[4]}")


if __name__ == "__main__":
    main()

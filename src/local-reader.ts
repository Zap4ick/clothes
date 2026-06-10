import * as fs from "fs";
import * as path from "path";
import * as XLSX from "xlsx";
import type { ClothingItem } from "./sheets";

const TABS = ["Shoes", "Tops", "Pants", "Accessories"];

function parseRows(rows: unknown[][]): ClothingItem[] {
  if (rows.length < 2) return [];
  // Skip header row, expect: name, type, color, condition, fit, notes
  return rows.slice(1).flatMap((row) => {
    const [name, type, color, condition, fit, notes] = row.map((v) =>
      v != null ? String(v).trim() : "",
    );
    if (!name) return [];
    return [
      {
        category: "",
        name,
        type: type ?? "",
        color: color ?? "",
        condition: condition || "okay",
        fit: fit || "regular",
        notes: notes ?? "",
      },
    ];
  });
}

function readSingleFile(filePath: string): ClothingItem[] {
  const wb = XLSX.readFile(filePath);
  const items: ClothingItem[] = [];

  for (const tab of TABS) {
    const ws = wb.Sheets[tab];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });
    for (const item of parseRows(rows)) {
      items.push({ ...item, category: tab });
    }
  }

  return items;
}

function readPerTabFiles(dir: string): ClothingItem[] {
  const items: ClothingItem[] = [];

  for (const tab of TABS) {
    const candidates = [
      path.join(dir, `${tab}.csv`),
      path.join(dir, `${tab}.xlsx`),
      path.join(dir, `${tab}.xls`),
    ];
    const file = candidates.find(fs.existsSync);
    if (!file) continue;

    const wb = XLSX.readFile(file);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });
    for (const item of parseRows(rows)) {
      items.push({ ...item, category: tab });
    }
  }

  return items;
}

export function fetchClothesFromFiles(): ClothingItem[] {
  const dir = path.resolve(process.env.WARDROBE_PATH ?? "./wardrobe");

  if (!fs.existsSync(dir)) {
    throw new Error(
      `Wardrobe folder not found: ${dir}\nCreate it and add Shoes.csv/xlsx, Tops.csv/xlsx, Pants.csv/xlsx — or a single wardrobe.xlsx with those sheet tabs.`,
    );
  }

  // Single-file mode: wardrobe.xlsx (or .xls) with Shoes/Tops/Pants sheets
  const singleFile = ["wardrobe.xlsx", "wardrobe.xls"]
    .map((f) => path.join(dir, f))
    .find(fs.existsSync);
  if (singleFile) return readSingleFile(singleFile);

  // Per-tab mode: Shoes.csv, Tops.csv, Pants.csv (or .xlsx)
  return readPerTabFiles(dir);
}

import * as fs from "fs";
import { google } from "googleapis";
import * as path from "path";

export interface ClothingItem {
  category: string; // tab name: Shoes, Tops, Pants
  name: string;
  type: string;
  color: string;
  condition: string;
  fit: string;
  notes: string;
}

const TABS = ["Shoes", "Tops", "Pants", "Accessories"];

export async function fetchClothes(): Promise<ClothingItem[]> {
  const credentialsPath = path.resolve(
    process.env.GOOGLE_CREDENTIALS_PATH ?? "./credentials/service-account.json",
  );

  if (!fs.existsSync(credentialsPath)) {
    throw new Error(
      `Service account credentials not found at: ${credentialsPath}`,
    );
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: credentialsPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  const sheetId = process.env.SHEET_ID;
  if (!sheetId) {
    throw new Error("SHEET_ID environment variable is not set.");
  }

  const allItems: ClothingItem[] = [];

  for (const tab of TABS) {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: tab,
    });

    const rows = response.data.values ?? [];
    if (rows.length < 2) continue;

    // Header row: name, type, color, condition, fit, notes
    for (const row of rows.slice(1)) {
      const [name, type, color, condition, fit, notes] = row as string[];
      if (!name) continue;
      allItems.push({
        category: tab,
        name: name.trim(),
        type: (type ?? "").trim(),
        color: (color ?? "").trim(),
        condition: (condition || "okay").trim(),
        fit: (fit || "regular").trim(),
        notes: (notes ?? "").trim(),
      });
    }
  }

  return allItems;
}

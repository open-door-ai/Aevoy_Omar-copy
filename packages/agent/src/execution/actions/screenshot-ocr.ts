/**
 * Screenshot + OCR Action
 * Captures screenshots and extracts text using Tesseract.js (offline) + AI vision (online)
 * Beats GenSpark with multi-engine OCR, table detection, and region-specific extraction
 */

import type { Page } from "patchright";
import { createWorker, type Worker } from "tesseract.js";
import { generateVisionResponse } from "../../services/ai.js";
import fs from "fs/promises";
import path from "path";

export interface ScreenshotOCRParams {
  fullPage?: boolean;
  region?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  engine?: "tesseract" | "vision" | "auto"; // auto = tesseract first, fallback to vision
  languages?: string[]; // Tesseract language codes: eng, spa, fra, deu, chi_sim, etc.
  detectTables?: boolean;
  detectForms?: boolean;
  format?: "text" | "structured"; // structured includes bounding boxes
}

export interface OCRResult {
  success: boolean;
  text?: string;
  confidence?: number;
  engine?: string;
  structuredData?: {
    blocks?: Array<{
      text: string;
      confidence: number;
      bbox: { x: number; y: number; width: number; height: number };
    }>;
    tables?: Array<{
      rows: number;
      cols: number;
      data: string[][];
    }>;
    forms?: Array<{
      label: string;
      value: string;
      type: "text" | "checkbox" | "radio" | "select";
    }>;
  };
  screenshotPath?: string;
  error?: string;
}

let tesseractWorker: Worker | null = null;

/**
 * Initialize Tesseract worker (singleton)
 */
async function getTesseractWorker(languages: string[] = ["eng"]): Promise<Worker> {
  if (!tesseractWorker) {
    console.log("[OCR] Initializing Tesseract worker...");
    tesseractWorker = await createWorker(languages);
  }
  return tesseractWorker;
}

/**
 * Capture screenshot and extract text using Tesseract (offline)
 */
async function extractWithTesseract(
  page: Page,
  params: ScreenshotOCRParams
): Promise<OCRResult> {
  try {
    // Capture screenshot
    const screenshotBuffer = await page.screenshot({
      fullPage: params.fullPage ?? false,
      clip: params.region,
      type: "png",
    });

    // Save screenshot to temp
    const timestamp = Date.now();
    const tempDir = path.join(process.cwd(), "temp", "screenshots");
    await fs.mkdir(tempDir, { recursive: true });
    const screenshotPath = path.join(tempDir, `screenshot-${timestamp}.png`);
    await fs.writeFile(screenshotPath, screenshotBuffer);

    // Extract text with Tesseract
    const worker = await getTesseractWorker(params.languages || ["eng"]);
    const { data } = await worker.recognize(screenshotBuffer);

    console.log(`[OCR-TESSERACT] Extracted ${data.text.length} characters with ${data.confidence}% confidence`);

    // Build structured data if requested
    let structuredData;
    if (params.format === "structured") {
      structuredData = {
        blocks: data.blocks?.map((block) => ({
          text: block.text,
          confidence: block.confidence,
          bbox: {
            x: block.bbox.x0,
            y: block.bbox.y0,
            width: block.bbox.x1 - block.bbox.x0,
            height: block.bbox.y1 - block.bbox.y0
          },
        })) || [],
        tables: [] as Array<{ rows: number; cols: number; data: string[][] }>,
        forms: [] as Array<{ label: string; value: string; type: "text" | "checkbox" | "radio" | "select" }>,
      };

      // Detect tables (simple heuristic: blocks with tabular alignment)
      if (params.detectTables) {
        structuredData.tables = detectTablesFromBlocks(data.blocks || []);
      }

      // Detect forms (simple heuristic: label-value pairs)
      if (params.detectForms) {
        structuredData.forms = detectFormsFromText(data.text);
      }
    }

    return {
      success: true,
      text: data.text.trim(),
      confidence: data.confidence,
      engine: "tesseract",
      structuredData,
      screenshotPath: `/temp/screenshots/screenshot-${timestamp}.png`,
    };
  } catch (error) {
    console.error("[OCR-TESSERACT] Failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Extract text using AI vision (Claude/Gemini)
 */
async function extractWithVision(
  page: Page,
  params: ScreenshotOCRParams
): Promise<OCRResult> {
  try {
    // Capture screenshot
    const screenshotBuffer = await page.screenshot({
      fullPage: params.fullPage ?? false,
      clip: params.region,
      type: "png",
    });

    // Save screenshot
    const timestamp = Date.now();
    const tempDir = path.join(process.cwd(), "temp", "screenshots");
    await fs.mkdir(tempDir, { recursive: true });
    const screenshotPath = path.join(tempDir, `screenshot-${timestamp}.png`);
    await fs.writeFile(screenshotPath, screenshotBuffer);

    const base64 = screenshotBuffer.toString("base64");

    // Build vision prompt
    let visionPrompt = "Extract ALL text from this image. Return the text exactly as it appears, preserving formatting and layout.";

    if (params.detectTables) {
      visionPrompt += " If there are tables, format them with | separators and preserve row/column structure.";
    }

    if (params.detectForms) {
      visionPrompt += " If there are forms, identify field labels and their values, return as 'Label: Value' pairs.";
    }

    if (params.format === "structured") {
      visionPrompt += " Return a JSON object with: { text: string, tables: [...], forms: [...] }";
    }

    // Call AI vision
    const result = await generateVisionResponse(visionPrompt, base64);

    console.log(`[OCR-VISION] Extracted ${result.content.length} characters`);

    // Parse structured response if requested
    let structuredData;
    let extractedText = result.content;

    if (params.format === "structured") {
      try {
        const parsed = JSON.parse(result.content);
        extractedText = parsed.text || result.content;
        structuredData = {
          tables: parsed.tables || [],
          forms: parsed.forms || [],
        };
      } catch {
        // Not JSON, use raw text
        console.log("[OCR-VISION] Response is not JSON, using raw text");
      }
    }

    return {
      success: true,
      text: extractedText.trim(),
      confidence: 95, // AI vision is usually high confidence
      engine: "vision",
      structuredData,
      screenshotPath: `/temp/screenshots/screenshot-${timestamp}.png`,
    };
  } catch (error) {
    console.error("[OCR-VISION] Failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Main screenshot + OCR action
 */
export async function screenshotWithOCR(
  page: Page,
  params: ScreenshotOCRParams = {}
): Promise<OCRResult> {
  const engine = params.engine || "auto";

  console.log(`[OCR] Starting with engine: ${engine}`);

  if (engine === "tesseract") {
    return extractWithTesseract(page, params);
  }

  if (engine === "vision") {
    return extractWithVision(page, params);
  }

  // Auto mode: try Tesseract first (free, offline), fallback to vision
  const tesseractResult = await extractWithTesseract(page, params);

  // If Tesseract confidence is low (<70%) or failed, fallback to vision
  if (
    !tesseractResult.success ||
    (tesseractResult.confidence && tesseractResult.confidence < 70)
  ) {
    console.log(
      `[OCR] Tesseract confidence low (${tesseractResult.confidence}%), falling back to vision`
    );
    return extractWithVision(page, params);
  }

  return tesseractResult;
}

/**
 * Cleanup Tesseract worker
 */
export async function cleanup() {
  if (tesseractWorker) {
    await tesseractWorker.terminate();
    tesseractWorker = null;
  }
}

/**
 * Detect tables from OCR blocks (simple heuristic)
 */
function detectTablesFromBlocks(blocks: any[]): Array<{ rows: number; cols: number; data: string[][] }> {
  // Simple table detection: look for aligned blocks
  const tables: Array<{ rows: number; cols: number; data: string[][] }> = [];

  // Group blocks by Y coordinate (rows)
  const rowGroups: Map<number, any[]> = new Map();

  blocks.forEach((block) => {
    const y = Math.round(block.bbox.y0 / 10) * 10; // Group within 10px
    if (!rowGroups.has(y)) {
      rowGroups.set(y, []);
    }
    rowGroups.get(y)!.push(block);
  });

  // If we have multiple rows with similar column count, it's likely a table
  const rows = Array.from(rowGroups.values());
  if (rows.length >= 2) {
    const columnCounts = rows.map((row) => row.length);
    const avgCols = columnCounts.reduce((a, b) => a + b, 0) / columnCounts.length;

    // If most rows have similar column count, treat as table
    const isTable = columnCounts.filter((c) => Math.abs(c - avgCols) <= 1).length >= rows.length * 0.7;

    if (isTable) {
      const tableData = rows.map((row) =>
        row.sort((a, b) => a.bbox.x0 - b.bbox.x0).map((block) => block.text.trim())
      );

      tables.push({
        rows: tableData.length,
        cols: Math.round(avgCols),
        data: tableData,
      });
    }
  }

  return tables;
}

/**
 * Detect forms from text (simple heuristic)
 */
function detectFormsFromText(text: string): Array<{ label: string; value: string; type: "text" | "checkbox" | "radio" | "select" }> {
  const forms: Array<{ label: string; value: string; type: "text" | "checkbox" | "radio" | "select" }> = [];

  // Look for label: value patterns
  const labelValuePattern = /^(.+?):\s*(.+)$/gm;
  let match;

  while ((match = labelValuePattern.exec(text)) !== null) {
    const label = match[1].trim();
    const value = match[2].trim();

    // Infer type
    let type: "text" | "checkbox" | "radio" | "select" = "text";
    if (value === "☐" || value === "☑" || value.toLowerCase() === "yes" || value.toLowerCase() === "no") {
      type = "checkbox";
    }

    forms.push({ label, value, type });
  }

  return forms;
}

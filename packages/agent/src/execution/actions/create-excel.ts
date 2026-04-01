/**
 * Excel File Generation Action
 * Creates professionally styled Excel spreadsheets with bold headers,
 * alternating row colors, auto-fit columns, number formatting, and borders.
 */

import ExcelJS from 'exceljs';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';

export interface ExcelSheet {
  name: string;
  data: (string | number | boolean | null)[][];
  headers?: string[];
  formulas?: { cell: string; formula: string }[];
  styles?: {
    headerBold?: boolean;
    headerBackgroundColor?: string;
    alternateRowColors?: boolean;
    freezeFirstRow?: boolean;
    autoFilter?: boolean;
  };
}

export interface ExcelGenerationParams {
  filename: string;
  sheets: ExcelSheet[];
  author?: string;
  title?: string;
  description?: string;
}

export interface ExcelGenerationResult {
  success: boolean;
  filepath?: string;
  url?: string;
  error?: string;
  rowCount?: number;
  sheetCount?: number;
  fileSize?: number;
}

// ── Design Tokens ───────────────────────────────────────────────
const EXCEL_THEME = {
  headerBg: 'FF1A1A2E',       // Deep navy (matches PPT dark theme)
  headerFont: 'FFFFFFFF',     // White text on dark header
  headerBorderBottom: 'FF00D4AA', // Teal accent under header
  altRowBg: 'FFF0F4F8',       // Very light blue-gray for alt rows
  borderColor: 'FFE2E8F0',    // Subtle gray borders
  accentText: 'FF1A1A2E',     // Navy for emphasis
  currencyFormat: '#,##0.00',
  percentFormat: '0.00%',
  numberFormat: '#,##0',
  dateFormat: 'yyyy-mm-dd',
} as const;

/**
 * Detect if a column likely contains currency values
 */
function detectColumnType(header: string, values: (string | number | boolean | null)[]): 'currency' | 'percent' | 'number' | 'date' | 'text' {
  const headerLower = header.toLowerCase();

  // Check header name hints
  if (/price|cost|amount|revenue|salary|total|budget|profit|income|expense|fee|tax|balance/i.test(headerLower)) {
    return 'currency';
  }
  if (/percent|rate|ratio|growth|change|margin/i.test(headerLower)) {
    return 'percent';
  }
  if (/date|created|updated|timestamp|time|day|month|year/i.test(headerLower)) {
    return 'date';
  }

  // Check actual values
  const numericValues = values.filter(v => v !== null && v !== '' && !isNaN(Number(v)));
  if (numericValues.length > values.length * 0.6) {
    // Mostly numbers — check if they look like currency (have decimals)
    const hasDecimals = numericValues.some(v => String(v).includes('.'));
    if (hasDecimals && /\$|price|cost/i.test(headerLower)) return 'currency';
    return 'number';
  }

  return 'text';
}

/**
 * Generate an Excel file with multiple sheets, data, and styling
 */
export async function createExcelFile(
  params: ExcelGenerationParams
): Promise<ExcelGenerationResult> {
  try {
    const workbook = new ExcelJS.Workbook();

    // Set workbook properties
    workbook.creator = params.author || 'Anticipy AI Agent';
    workbook.lastModifiedBy = params.author || 'Anticipy AI Agent';
    workbook.created = new Date();
    workbook.modified = new Date();

    if (params.title) {
      workbook.title = params.title;
    }

    if (params.description) {
      workbook.description = params.description;
    }

    let totalRows = 0;

    for (const sheetDef of params.sheets) {
      const worksheet = workbook.addWorksheet(sheetDef.name, {
        properties: { defaultColWidth: 15 },
      });

      // ── Headers ──────────────────────────────────────────
      let startRow = 1;
      if (sheetDef.headers && sheetDef.headers.length > 0) {
        worksheet.addRow(sheetDef.headers);

        const useDefaultStyle = sheetDef.styles?.headerBold !== false;
        if (useDefaultStyle) {
          const headerRow = worksheet.getRow(1);

          if (sheetDef.styles?.headerBackgroundColor) {
            // User-specified header color
            headerRow.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: sheetDef.styles.headerBackgroundColor.replace('#', 'FF') }
            };
            headerRow.font = { bold: true, size: 11 };
          } else {
            // Default: dark navy header with white text
            headerRow.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: EXCEL_THEME.headerBg }
            };
            headerRow.font = {
              bold: true,
              color: { argb: EXCEL_THEME.headerFont },
              size: 11,
              name: 'Segoe UI',
            };
          }

          // Header row height
          headerRow.height = 28;
          headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

          // Thick accent border under header
          headerRow.eachCell((cell) => {
            cell.border = {
              bottom: { style: 'medium', color: { argb: EXCEL_THEME.headerBorderBottom } },
            };
          });
        }

        // Freeze first row (on by default)
        if (sheetDef.styles?.freezeFirstRow !== false) {
          worksheet.views = [{ state: 'frozen', ySplit: 1 }];
        }

        // Auto filter (on by default)
        if (sheetDef.styles?.autoFilter !== false) {
          worksheet.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: 1, column: sheetDef.headers.length }
          };
        }

        startRow = 2;

        // ── Detect column types for formatting ──────────────
        const columnTypes = sheetDef.headers.map((header, colIdx) => {
          const colValues = sheetDef.data.map(row => row[colIdx]);
          return detectColumnType(header, colValues);
        });

        // Apply number formats per column
        columnTypes.forEach((type, colIdx) => {
          const col = worksheet.getColumn(colIdx + 1);
          switch (type) {
            case 'currency':
              col.numFmt = EXCEL_THEME.currencyFormat;
              col.alignment = { horizontal: 'right', vertical: 'middle' };
              break;
            case 'percent':
              col.numFmt = EXCEL_THEME.percentFormat;
              col.alignment = { horizontal: 'right', vertical: 'middle' };
              break;
            case 'number':
              col.numFmt = EXCEL_THEME.numberFormat;
              col.alignment = { horizontal: 'right', vertical: 'middle' };
              break;
            case 'date':
              col.numFmt = EXCEL_THEME.dateFormat;
              col.alignment = { horizontal: 'center', vertical: 'middle' };
              break;
            default:
              col.alignment = { vertical: 'middle' };
              break;
          }
        });
      }

      // ── Data rows ────────────────────────────────────────
      const enableAltRows = sheetDef.styles?.alternateRowColors !== false; // ON by default
      sheetDef.data.forEach((row, index) => {
        const excelRow = worksheet.addRow(row);
        excelRow.height = 22;

        // Alternating row colors (on by default)
        if (enableAltRows) {
          const rowNumber = startRow + index;
          if (rowNumber % 2 === 0) {
            excelRow.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: EXCEL_THEME.altRowBg }
            };
          }
        }

        // Body font
        excelRow.font = { size: 10, name: 'Segoe UI' };

        totalRows++;
      });

      // ── Auto-fit columns ─────────────────────────────────
      worksheet.columns.forEach((column, colIdx) => {
        let maxLength = 0;
        column.eachCell?.({ includeEmpty: false }, cell => {
          const cellValue = cell.value?.toString() || '';
          maxLength = Math.max(maxLength, cellValue.length);
        });
        // Minimum 10, maximum 50, +3 for padding (accounts for filter dropdown)
        column.width = Math.min(Math.max(maxLength + 3, 12), 50);
      });

      // ── Formulas ─────────────────────────────────────────
      if (sheetDef.formulas && sheetDef.formulas.length > 0) {
        sheetDef.formulas.forEach(({ cell, formula }) => {
          const excelCell = worksheet.getCell(cell);
          excelCell.value = { formula } as any;
        });
      }

      // ── Borders ──────────────────────────────────────────
      const lastRow = worksheet.rowCount;
      const lastCol = worksheet.columnCount;

      for (let row = 2; row <= lastRow; row++) { // Start at 2 to skip header (has its own border)
        for (let col = 1; col <= lastCol; col++) {
          const cell = worksheet.getCell(row, col);
          cell.border = {
            ...cell.border,
            top: { style: 'thin', color: { argb: EXCEL_THEME.borderColor } },
            left: { style: 'thin', color: { argb: EXCEL_THEME.borderColor } },
            bottom: { style: 'thin', color: { argb: EXCEL_THEME.borderColor } },
            right: { style: 'thin', color: { argb: EXCEL_THEME.borderColor } }
          };
        }
      }
    }

    // Generate cryptographically random filename to prevent enumeration
    const filename = `${crypto.randomUUID()}.xlsx`;

    // Save to temp directory
    const outputDir = path.join('/tmp', 'aevoy-files', 'excel');
    await fs.mkdir(outputDir, { recursive: true });

    const filepath = path.join(outputDir, filename);

    // Write the file
    await workbook.xlsx.writeFile(filepath);

    // Get file size
    const stats = await fs.stat(filepath);

    return {
      success: true,
      filepath,
      url: `/files/excel/${filename}`,
      rowCount: totalRows,
      sheetCount: params.sheets.length,
      fileSize: stats.size
    };

  } catch (error) {
    console.error('[EXCEL] Generation failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Quick helper: Create a simple data table Excel file
 */
export async function createSimpleTable(
  filename: string,
  headers: string[],
  data: (string | number | boolean | null)[][],
  sheetName: string = 'Sheet1'
): Promise<ExcelGenerationResult> {
  return createExcelFile({
    filename,
    sheets: [{
      name: sheetName,
      headers,
      data,
      styles: {
        headerBold: true,
        alternateRowColors: true,
        freezeFirstRow: true,
        autoFilter: true
      }
    }]
  });
}

/**
 * Helper: Create a financial report with formulas
 */
export async function createFinancialReport(
  filename: string,
  data: { category: string; amount: number }[]
): Promise<ExcelGenerationResult> {
  const headers = ['Category', 'Amount', 'Percentage'];
  const totalRow = data.length + 2;

  const tableData = data.map((item) => [
    item.category,
    item.amount,
    null // Will be calculated via formula
  ]);

  const formulas = [
    // Total formula
    { cell: `B${totalRow}`, formula: `SUM(B2:B${totalRow - 1})` },
    // Percentage formulas for each row
    ...data.map((_, index) => ({
      cell: `C${index + 2}`,
      formula: `B${index + 2}/$B$${totalRow}`
    }))
  ];

  return createExcelFile({
    filename,
    title: 'Financial Report',
    sheets: [{
      name: 'Report',
      headers,
      data: [...tableData, ['Total', null, null]],
      formulas,
      styles: {
        headerBold: true,
        alternateRowColors: true,
        freezeFirstRow: true,
        autoFilter: false
      }
    }]
  });
}

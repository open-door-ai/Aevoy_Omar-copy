/**
 * Excel File Generation Action
 * Creates Excel spreadsheets with data, formulas, styling, and charts
 * Beats GenSpark on file creation
 */

import ExcelJS from 'exceljs';
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

/**
 * Generate an Excel file with multiple sheets, data, and styling
 */
export async function createExcelFile(
  params: ExcelGenerationParams
): Promise<ExcelGenerationResult> {
  try {
    // Create new workbook
    const workbook = new ExcelJS.Workbook();

    // Set workbook properties
    workbook.creator = params.author || 'Aevoy AI Agent';
    workbook.lastModifiedBy = params.author || 'Aevoy AI Agent';
    workbook.created = new Date();
    workbook.modified = new Date();

    if (params.title) {
      workbook.title = params.title;
    }

    if (params.description) {
      workbook.description = params.description;
    }

    let totalRows = 0;

    // Add each sheet
    for (const sheetDef of params.sheets) {
      const worksheet = workbook.addWorksheet(sheetDef.name);

      // Add headers if provided
      let startRow = 1;
      if (sheetDef.headers && sheetDef.headers.length > 0) {
        worksheet.addRow(sheetDef.headers);

        // Style headers
        if (sheetDef.styles?.headerBold !== false) {
          const headerRow = worksheet.getRow(1);
          headerRow.font = { bold: true };

          if (sheetDef.styles?.headerBackgroundColor) {
            headerRow.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: sheetDef.styles.headerBackgroundColor.replace('#', 'FF') }
            };
          } else {
            // Default blue header background
            headerRow.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FF4472C4' }
            };
            headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
          }
        }

        // Freeze first row if requested
        if (sheetDef.styles?.freezeFirstRow !== false) {
          worksheet.views = [{ state: 'frozen', ySplit: 1 }];
        }

        // Add auto filter if requested
        if (sheetDef.styles?.autoFilter !== false) {
          worksheet.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: 1, column: sheetDef.headers.length }
          };
        }

        startRow = 2;
      }

      // Add data rows
      sheetDef.data.forEach((row, index) => {
        worksheet.addRow(row);

        // Alternate row colors
        if (sheetDef.styles?.alternateRowColors) {
          const rowNumber = startRow + index;
          if (rowNumber % 2 === 0) {
            const excelRow = worksheet.getRow(rowNumber);
            excelRow.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFF2F2F2' }
            };
          }
        }

        totalRows++;
      });

      // Auto-fit columns
      worksheet.columns.forEach(column => {
        let maxLength = 0;
        column.eachCell?.({ includeEmpty: false }, cell => {
          const cellValue = cell.value?.toString() || '';
          maxLength = Math.max(maxLength, cellValue.length);
        });
        column.width = Math.min(Math.max(maxLength + 2, 10), 50);
      });

      // Add formulas if provided
      if (sheetDef.formulas && sheetDef.formulas.length > 0) {
        sheetDef.formulas.forEach(({ cell, formula }) => {
          const excelCell = worksheet.getCell(cell);
          excelCell.value = { formula };
        });
      }

      // Add borders to all cells with data
      const lastRow = worksheet.rowCount;
      const lastCol = worksheet.columnCount;

      for (let row = 1; row <= lastRow; row++) {
        for (let col = 1; col <= lastCol; col++) {
          const cell = worksheet.getCell(row, col);
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFD3D3D3' } },
            left: { style: 'thin', color: { argb: 'FFD3D3D3' } },
            bottom: { style: 'thin', color: { argb: 'FFD3D3D3' } },
            right: { style: 'thin', color: { argb: 'FFD3D3D3' } }
          };
        }
      }
    }

    // Generate filename with timestamp if not unique
    const timestamp = Date.now();
    const filename = params.filename.endsWith('.xlsx')
      ? params.filename
      : `${params.filename}-${timestamp}.xlsx`;

    // Save to temp directory
    const outputDir = path.join(process.cwd(), 'temp', 'excel');
    await fs.mkdir(outputDir, { recursive: true });

    const filepath = path.join(outputDir, filename);

    // Write the file
    await workbook.xlsx.writeFile(filepath);

    // Get file size
    const stats = await fs.stat(filepath);

    return {
      success: true,
      filepath,
      url: `/temp/excel/${filename}`, // Relative URL for download
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

  const tableData = data.map((item, index) => [
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

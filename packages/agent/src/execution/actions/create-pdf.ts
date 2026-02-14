/**
 * PDF Generation Action
 * Creates professional PDF documents with text, images, tables, headers/footers
 * Completes the file generation suite
 */

import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { promises as fsPromises } from 'fs';

export interface PDFContent {
  type: 'title' | 'heading' | 'paragraph' | 'bullet' | 'image' | 'pagebreak' | 'table';
  text?: string;
  fontSize?: number;
  alignment?: 'left' | 'center' | 'right' | 'justify';
  bold?: boolean;
  color?: string;
  items?: string[];
  imagePath?: string;
  imageWidth?: number;
  tableData?: {
    headers: string[];
    rows: string[][];
  };
}

export interface PDFParams {
  filename: string;
  title?: string;
  author?: string;
  subject?: string;
  content: PDFContent[];
  pageSize?: 'A4' | 'Letter' | 'Legal';
  margins?: {
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  };
}

export interface PDFResult {
  success: boolean;
  filepath?: string;
  url?: string;
  error?: string;
  pageCount?: number;
  fileSize?: number;
}

/**
 * Generate a PDF document
 */
export async function createPDF(params: PDFParams): Promise<PDFResult> {
  return new Promise(async (resolve) => {
    try {
      // Create PDF document
      const doc = new PDFDocument({
        size: params.pageSize || 'A4',
        margins: {
          top: params.margins?.top || 50,
          bottom: params.margins?.bottom || 50,
          left: params.margins?.left || 50,
          right: params.margins?.right || 50
        },
        info: {
          Title: params.title || params.filename,
          Author: params.author || 'Aevoy AI Agent',
          Subject: params.subject || 'AI-Generated PDF'
        }
      });

      // Generate filename with timestamp
      const timestamp = Date.now();
      const filename = params.filename.endsWith('.pdf')
        ? params.filename
        : `${params.filename}-${timestamp}.pdf`;

      // Save to temp directory
      const outputDir = path.join(process.cwd(), 'temp', 'pdf');
      await fsPromises.mkdir(outputDir, { recursive: true });

      const filepath = path.join(outputDir, filename);
      const writeStream = fs.createWriteStream(filepath);

      // Pipe PDF to file
      doc.pipe(writeStream);

      // Add document title if provided
      if (params.title) {
        doc
          .fontSize(24)
          .font('Helvetica-Bold')
          .text(params.title, {
            align: 'center'
          })
          .moveDown(1.5);
      }

      // Process each content item
      for (const item of params.content) {
        switch (item.type) {
          case 'title': {
            doc
              .fontSize(item.fontSize || 20)
              .font('Helvetica-Bold')
              .fillColor(item.color || '#000000')
              .text(item.text || '', {
                align: item.alignment || 'left'
              })
              .moveDown(1);
            break;
          }

          case 'heading': {
            doc
              .fontSize(item.fontSize || 16)
              .font('Helvetica-Bold')
              .fillColor(item.color || '#000000')
              .text(item.text || '', {
                align: item.alignment || 'left'
              })
              .moveDown(0.5);
            break;
          }

          case 'paragraph': {
            const font = item.bold ? 'Helvetica-Bold' : 'Helvetica';
            doc
              .fontSize(item.fontSize || 12)
              .font(font)
              .fillColor(item.color || '#000000')
              .text(item.text || '', {
                align: item.alignment || 'left',
                lineGap: 5
              })
              .moveDown(0.5);
            break;
          }

          case 'bullet': {
            if (item.items && item.items.length > 0) {
              item.items.forEach(bulletItem => {
                doc
                  .fontSize(item.fontSize || 12)
                  .font('Helvetica')
                  .fillColor(item.color || '#000000')
                  .text(`• ${bulletItem}`, {
                    indent: 20,
                    lineGap: 3
                  });
              });
              doc.moveDown(0.5);
            }
            break;
          }

          case 'image': {
            if (item.imagePath) {
              try {
                // PDFKit only supports 'center' or 'right' for image alignment
                const align = item.alignment === 'center' ? 'center' :
                             item.alignment === 'right' ? 'right' :
                             undefined; // left is default (undefined)

                doc.image(item.imagePath, {
                  fit: [item.imageWidth || 400, 300],
                  align
                });
                doc.moveDown(0.5);
              } catch (error) {
                console.error('[PDF] Failed to add image:', error);
                // Continue without image
              }
            }
            break;
          }

          case 'pagebreak': {
            doc.addPage();
            break;
          }

          case 'table': {
            if (item.tableData) {
              const { headers, rows } = item.tableData;
              const tableTop = doc.y;
              const columnWidth = 100;
              const rowHeight = 25;

              // Draw header row
              doc
                .fillColor('#4472C4')
                .rect(doc.x, tableTop, columnWidth * headers.length, rowHeight)
                .fill();

              doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(10);
              headers.forEach((header, i) => {
                doc.text(
                  header,
                  doc.x + i * columnWidth + 5,
                  tableTop + 8,
                  {
                    width: columnWidth - 10,
                    align: 'left'
                  }
                );
              });

              // Draw data rows
              doc.fillColor('#000000').font('Helvetica');
              rows.forEach((row, rowIndex) => {
                const y = tableTop + rowHeight + rowIndex * rowHeight;

                // Alternate row colors
                if (rowIndex % 2 === 0) {
                  doc
                    .fillColor('#F2F2F2')
                    .rect(doc.x, y, columnWidth * headers.length, rowHeight)
                    .fill();
                }

                doc.fillColor('#000000');
                row.forEach((cell, colIndex) => {
                  doc.text(
                    cell,
                    doc.x + colIndex * columnWidth + 5,
                    y + 8,
                    {
                      width: columnWidth - 10,
                      align: 'left'
                    }
                  );
                });
              });

              doc.y = tableTop + rowHeight + rows.length * rowHeight + 20;
              doc.moveDown(0.5);
            }
            break;
          }
        }
      }

      // Finalize PDF
      doc.end();

      // Wait for file to finish writing
      writeStream.on('finish', async () => {
        try {
          const stats = await fsPromises.stat(filepath);
          const pageCount = doc.bufferedPageRange().count;

          resolve({
            success: true,
            filepath,
            url: `/temp/pdf/${filename}`,
            pageCount,
            fileSize: stats.size
          });
        } catch (error) {
          resolve({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      });

      writeStream.on('error', (error) => {
        resolve({
          success: false,
          error: error.message
        });
      });

    } catch (error) {
      console.error('[PDF] Generation failed:', error);
      resolve({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
}

/**
 * Quick helper: Create a simple text PDF
 */
export async function createSimplePDF(
  filename: string,
  title: string,
  paragraphs: string[]
): Promise<PDFResult> {
  return createPDF({
    filename,
    title,
    content: paragraphs.map(p => ({
      type: 'paragraph',
      text: p
    }))
  });
}

/**
 * Helper: Create a professional report PDF
 */
export async function createReportPDF(
  filename: string,
  title: string,
  sections: Array<{ heading: string; content: string | string[] }>
): Promise<PDFResult> {
  const content: PDFContent[] = [];

  sections.forEach(section => {
    content.push({
      type: 'heading',
      text: section.heading
    });

    if (Array.isArray(section.content)) {
      content.push({
        type: 'bullet',
        items: section.content
      });
    } else {
      content.push({
        type: 'paragraph',
        text: section.content
      });
    }
  });

  return createPDF({
    filename,
    title,
    content
  });
}

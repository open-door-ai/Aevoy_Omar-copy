/**
 * PDF Generation Action
 * Creates professional PDF documents with text, images, tables, headers/footers
 * Completes the file generation suite
 */

import PDFDocument from 'pdfkit';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { promises as fsPromises } from 'fs';

export interface BusinessCardData {
  companyName: string;
  personName: string;
  title: string;
  email?: string;
  phone?: string;
  website?: string;
  address?: string;
  tagline?: string;
  primaryColor?: string;   // hex, default #2563eb
  secondaryColor?: string; // hex, default #1e40af
  accentColor?: string;    // hex, default #f59e0b
}

export interface PDFContent {
  type: 'title' | 'heading' | 'paragraph' | 'bullet' | 'image' | 'pagebreak' | 'table' | 'business_card';
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
  cardData?: BusinessCardData;
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
          Author: params.author || 'Anticipy AI Agent',
          Subject: params.subject || 'AI-Generated PDF'
        }
      });

      // Generate cryptographically random filename to prevent enumeration
      const filename = `${crypto.randomUUID()}.pdf`;

      // Save to temp directory
      const outputDir = path.join('/tmp', 'aevoy-files', 'pdf');
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

          case 'business_card': {
            if (item.cardData) {
              renderBusinessCard(doc, item.cardData);
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
            url: `/files/pdf/${filename}`,
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
 * Render a professional business card (front + back) using PDFKit vector drawing.
 * Standard card: 3.5" × 2" = 252pt × 144pt, rendered at 2× for quality on A4 page.
 */
function renderBusinessCard(doc: InstanceType<typeof PDFDocument>, card: BusinessCardData): void {
  const primary = card.primaryColor || '#2563eb';
  const secondary = card.secondaryColor || '#1e40af';
  const accent = card.accentColor || '#f59e0b';

  // Card dimensions (scaled 2x for print quality on A4)
  const cardW = 504;  // 3.5" × 144
  const cardH = 288;  // 2" × 144
  const pageW = doc.page.width;
  const leftMargin = (pageW - cardW) / 2;
  const cornerR = 12;

  // ── FRONT SIDE ──────────────────────────────────────
  doc.fontSize(10).font('Helvetica').fillColor('#888888')
    .text('FRONT', leftMargin, doc.y, { width: cardW, align: 'center' })
    .moveDown(0.3);

  const frontY = doc.y;

  // Card background — white with subtle border
  doc.save();
  doc.roundedRect(leftMargin, frontY, cardW, cardH, cornerR)
    .lineWidth(1).strokeColor('#e5e7eb').stroke();

  // Left accent bar
  doc.save();
  doc.rect(leftMargin, frontY, cornerR + 4, cardH).clip();
  doc.roundedRect(leftMargin, frontY, cardW, cardH, cornerR).fill(primary);
  doc.restore();

  // Decorative diagonal line (subtle geometric element)
  doc.save();
  doc.roundedRect(leftMargin, frontY, cardW, cardH, cornerR).clip();
  doc.moveTo(leftMargin + cardW - 120, frontY)
    .lineTo(leftMargin + cardW, frontY + 80)
    .lineTo(leftMargin + cardW, frontY)
    .fill(primary);
  doc.opacity(0.15);
  doc.moveTo(leftMargin + cardW - 180, frontY + cardH)
    .lineTo(leftMargin + cardW, frontY + cardH - 100)
    .lineTo(leftMargin + cardW, frontY + cardH)
    .fill(primary);
  doc.restore();

  // Company name (top left, after accent bar)
  const textLeft = leftMargin + 32;
  doc.fontSize(14).font('Helvetica-Bold').fillColor(primary)
    .text(card.companyName.toUpperCase(), textLeft, frontY + 24, { width: cardW - 60 });

  // Tagline under company name
  if (card.tagline) {
    doc.fontSize(7).font('Helvetica').fillColor('#6b7280')
      .text(card.tagline, textLeft, frontY + 42, { width: cardW - 60 });
  }

  // Person name (centered, larger)
  const nameY = frontY + (card.tagline ? 85 : 80);
  doc.fontSize(20).font('Helvetica-Bold').fillColor('#111827')
    .text(card.personName, textLeft, nameY, { width: cardW - 60 });

  // Title
  doc.fontSize(10).font('Helvetica').fillColor(primary)
    .text(card.title, textLeft, nameY + 28, { width: cardW - 60 });

  // Accent line under title
  doc.moveTo(textLeft, nameY + 46).lineTo(textLeft + 60, nameY + 46)
    .lineWidth(2).strokeColor(accent).stroke();

  // Contact info (bottom left)
  const contactY = frontY + cardH - 60;
  const contactFont = 8.5;
  let cy = contactY;
  if (card.email) {
    doc.fontSize(contactFont).font('Helvetica').fillColor('#374151')
      .text(`✉  ${card.email}`, textLeft, cy, { width: cardW - 60 });
    cy += 13;
  }
  if (card.phone) {
    doc.fontSize(contactFont).font('Helvetica').fillColor('#374151')
      .text(`☎  ${card.phone}`, textLeft, cy, { width: cardW - 60 });
    cy += 13;
  }
  if (card.website) {
    doc.fontSize(contactFont).font('Helvetica').fillColor('#374151')
      .text(`⌂  ${card.website}`, textLeft, cy, { width: cardW - 60 });
  }

  doc.restore();

  // ── SPACER ──────────────────────────────────────────
  doc.y = frontY + cardH + 20;
  doc.fontSize(10).font('Helvetica').fillColor('#888888')
    .text('BACK', leftMargin, doc.y, { width: cardW, align: 'center' })
    .moveDown(0.3);

  const backY = doc.y;

  // ── BACK SIDE ───────────────────────────────────────
  // Full color background
  doc.save();
  doc.roundedRect(leftMargin, backY, cardW, cardH, cornerR).fill(primary);

  // Subtle pattern — diagonal lines
  doc.save();
  doc.roundedRect(leftMargin, backY, cardW, cardH, cornerR).clip();
  doc.opacity(0.08);
  for (let i = -cardH; i < cardW + cardH; i += 30) {
    doc.moveTo(leftMargin + i, backY)
      .lineTo(leftMargin + i + cardH, backY + cardH)
      .lineWidth(1).strokeColor('#ffffff').stroke();
  }
  doc.restore();

  // Large company name centered
  doc.fontSize(28).font('Helvetica-Bold').fillColor('#ffffff')
    .text(card.companyName.toUpperCase(), leftMargin + 20, backY + cardH / 2 - 30,
      { width: cardW - 40, align: 'center' });

  // Tagline centered below
  if (card.tagline) {
    doc.fontSize(10).font('Helvetica').fillColor('#ffffffcc')
      .text(card.tagline, leftMargin + 20, backY + cardH / 2 + 8,
        { width: cardW - 40, align: 'center' });
  }

  // Accent line
  const accentLineW = 80;
  doc.moveTo(leftMargin + (cardW - accentLineW) / 2, backY + cardH / 2 + (card.tagline ? 28 : 10))
    .lineTo(leftMargin + (cardW + accentLineW) / 2, backY + cardH / 2 + (card.tagline ? 28 : 10))
    .lineWidth(2).strokeColor(accent).stroke();

  // Website at bottom
  if (card.website) {
    doc.fontSize(9).font('Helvetica').fillColor('#ffffffaa')
      .text(card.website, leftMargin + 20, backY + cardH - 30,
        { width: cardW - 40, align: 'center' });
  }

  // Address at bottom
  if (card.address) {
    doc.fontSize(7).font('Helvetica').fillColor('#ffffff88')
      .text(card.address, leftMargin + 20, backY + cardH - 18,
        { width: cardW - 40, align: 'center' });
  }

  doc.restore();

  // ── CUT GUIDE NOTE ──────────────────────────────────
  doc.y = backY + cardH + 15;
  doc.fontSize(8).font('Helvetica').fillColor('#9ca3af')
    .text('Standard business card size: 3.5" × 2" — print at 100% scale, cut along card edges',
      leftMargin, doc.y, { width: cardW, align: 'center' });

  doc.moveDown(2);
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

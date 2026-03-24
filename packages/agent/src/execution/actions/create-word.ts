/**
 * Word Document Generation Action
 * Creates professional Word documents with modern heading styles,
 * styled tables, proper spacing, and consistent typography.
 */

import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  TableLayoutType, convertInchesToTwip
} from 'docx';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';

export interface WordSection {
  type: 'heading' | 'paragraph' | 'bullet' | 'numbered' | 'table';
  text?: string;
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  items?: string[];
  tableData?: {
    headers: string[];
    rows: string[][];
  };
  bold?: boolean;
  italic?: boolean;
  alignment?: 'left' | 'center' | 'right' | 'justified';
}

export interface WordDocumentParams {
  filename: string;
  title?: string;
  author?: string;
  sections: WordSection[];
}

export interface WordResult {
  success: boolean;
  filepath?: string;
  url?: string;
  error?: string;
  sectionCount?: number;
  fileSize?: number;
}

// ── Design Tokens ───────────────────────────────────────────────
const WORD_THEME = {
  // Colors (matching the overall Aurora palette)
  headingColor: '1A1A2E',   // Deep navy
  accentColor: '00D4AA',    // Teal accent
  bodyColor: '2D3748',      // Dark gray body text
  mutedColor: '718096',     // Muted gray for subtle text
  tableBorderColor: 'E2E8F0',
  tableHeaderBg: '1A1A2E',
  tableHeaderFont: 'FFFFFF',
  tableAltRowBg: 'F7FAFC',

  // Font sizes (half-points)
  titleSize: 56,   // 28pt
  h1Size: 44,      // 22pt
  h2Size: 36,      // 18pt
  h3Size: 28,      // 14pt
  bodySize: 22,    // 11pt
  smallSize: 18,   // 9pt

  // Spacing (twips, 1/20 of a point)
  titleSpaceAfter: 300,
  h1SpaceBefore: 360,
  h1SpaceAfter: 160,
  h2SpaceBefore: 280,
  h2SpaceAfter: 120,
  h3SpaceBefore: 200,
  h3SpaceAfter: 100,
  paraSpaceAfter: 160,
  bulletSpaceAfter: 80,
  tableSpaceBefore: 200,
  tableSpaceAfter: 200,
} as const;

/**
 * Create a styled table from headers + rows
 */
function buildStyledTable(headers: string[], rows: string[][]): Table {
  const columnCount = headers.length;
  // Distribute width evenly across columns (page width ~6.5 inches minus margins)
  const colWidthTwips = Math.floor(convertInchesToTwip(6.5) / columnCount);

  // Header row
  const headerCells = headers.map(header =>
    new TableCell({
      children: [
        new Paragraph({
          children: [
            new TextRun({
              text: header,
              bold: true,
              color: WORD_THEME.tableHeaderFont,
              font: 'Segoe UI',
              size: WORD_THEME.bodySize,
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { before: 60, after: 60 },
        }),
      ],
      shading: {
        type: ShadingType.SOLID,
        color: WORD_THEME.tableHeaderBg,
        fill: WORD_THEME.tableHeaderBg,
      },
      width: { size: colWidthTwips, type: WidthType.DXA },
    })
  );

  // Data rows with alternating colors
  const dataRows = rows.map((row, rowIdx) => {
    const isAlt = rowIdx % 2 === 1;
    const cells = row.map(cellText =>
      new TableCell({
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: cellText || '',
                font: 'Segoe UI',
                size: WORD_THEME.bodySize,
                color: WORD_THEME.bodyColor,
              }),
            ],
            spacing: { before: 40, after: 40 },
          }),
        ],
        shading: isAlt
          ? { type: ShadingType.SOLID, color: WORD_THEME.tableAltRowBg, fill: WORD_THEME.tableAltRowBg }
          : undefined,
        width: { size: colWidthTwips, type: WidthType.DXA },
      })
    );

    // Pad with empty cells if row is shorter than headers
    while (cells.length < columnCount) {
      cells.push(
        new TableCell({
          children: [new Paragraph({ text: '' })],
          width: { size: colWidthTwips, type: WidthType.DXA },
        })
      );
    }

    return new TableRow({ children: cells });
  });

  return new Table({
    rows: [
      new TableRow({ children: headerCells, tableHeader: true }),
      ...dataRows,
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
  });
}

/**
 * Generate a Word document
 */
export async function createWordDocument(
  params: WordDocumentParams
): Promise<WordResult> {
  try {
    const children: (Paragraph | Table)[] = [];

    // ── Title ───────────────────────────────────────────────
    if (params.title) {
      // Accent bar above title
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: '                              ',
              font: 'Segoe UI',
              size: 4,
            }),
          ],
          border: {
            bottom: {
              style: BorderStyle.SINGLE,
              size: 12,
              color: WORD_THEME.accentColor,
              space: 1,
            },
          },
          spacing: { after: 120 },
        })
      );

      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: params.title,
              bold: true,
              font: 'Segoe UI',
              size: WORD_THEME.titleSize,
              color: WORD_THEME.headingColor,
            }),
          ],
          heading: HeadingLevel.TITLE,
          spacing: { after: WORD_THEME.titleSpaceAfter },
        })
      );

      // Date line under title
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: new Date().toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              }),
              font: 'Segoe UI',
              size: WORD_THEME.smallSize,
              color: WORD_THEME.mutedColor,
              italics: true,
            }),
          ],
          spacing: { after: 300 },
        })
      );
    }

    // ── Sections ────────────────────────────────────────────
    for (const section of params.sections) {
      switch (section.type) {
        case 'heading': {
          const level = section.level || 1;
          const headingLevel = level === 1 ? HeadingLevel.HEADING_1 :
                              level === 2 ? HeadingLevel.HEADING_2 :
                              level === 3 ? HeadingLevel.HEADING_3 :
                              level === 4 ? HeadingLevel.HEADING_4 :
                              level === 5 ? HeadingLevel.HEADING_5 :
                              HeadingLevel.HEADING_6;

          const fontSize = level === 1 ? WORD_THEME.h1Size :
                          level === 2 ? WORD_THEME.h2Size :
                          WORD_THEME.h3Size;

          const spaceBefore = level === 1 ? WORD_THEME.h1SpaceBefore :
                             level === 2 ? WORD_THEME.h2SpaceBefore :
                             WORD_THEME.h3SpaceBefore;

          const spaceAfter = level === 1 ? WORD_THEME.h1SpaceAfter :
                            level === 2 ? WORD_THEME.h2SpaceAfter :
                            WORD_THEME.h3SpaceAfter;

          // For H1, add a subtle bottom border as a divider
          if (level === 1) {
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: section.text || '',
                    bold: true,
                    font: 'Segoe UI',
                    size: fontSize,
                    color: WORD_THEME.headingColor,
                  }),
                ],
                heading: headingLevel,
                spacing: { before: spaceBefore, after: spaceAfter },
                border: {
                  bottom: {
                    style: BorderStyle.SINGLE,
                    size: 4,
                    color: WORD_THEME.tableBorderColor,
                    space: 4,
                  },
                },
              })
            );
          } else {
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: section.text || '',
                    bold: true,
                    font: 'Segoe UI',
                    size: fontSize,
                    color: WORD_THEME.headingColor,
                  }),
                ],
                heading: headingLevel,
                spacing: { before: spaceBefore, after: spaceAfter },
              })
            );
          }
          break;
        }

        case 'paragraph': {
          const alignment = section.alignment === 'center' ? AlignmentType.CENTER :
                           section.alignment === 'right' ? AlignmentType.RIGHT :
                           section.alignment === 'justified' ? AlignmentType.JUSTIFIED :
                           AlignmentType.LEFT;

          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: section.text || '',
                  bold: section.bold,
                  italics: section.italic,
                  font: 'Segoe UI',
                  size: WORD_THEME.bodySize,
                  color: WORD_THEME.bodyColor,
                }),
              ],
              alignment,
              spacing: { after: WORD_THEME.paraSpaceAfter, line: 300 },
            })
          );
          break;
        }

        case 'bullet': {
          if (section.items && section.items.length > 0) {
            section.items.forEach((item) => {
              children.push(
                new Paragraph({
                  children: [
                    new TextRun({
                      text: item,
                      font: 'Segoe UI',
                      size: WORD_THEME.bodySize,
                      color: WORD_THEME.bodyColor,
                    }),
                  ],
                  bullet: { level: 0 },
                  spacing: { after: WORD_THEME.bulletSpaceAfter, line: 280 },
                })
              );
            });
            // Extra space after bullet list
            children.push(
              new Paragraph({
                text: '',
                spacing: { after: 80 },
              })
            );
          }
          break;
        }

        case 'numbered': {
          if (section.items && section.items.length > 0) {
            section.items.forEach((item) => {
              children.push(
                new Paragraph({
                  children: [
                    new TextRun({
                      text: item,
                      font: 'Segoe UI',
                      size: WORD_THEME.bodySize,
                      color: WORD_THEME.bodyColor,
                    }),
                  ],
                  numbering: {
                    reference: 'default-numbering',
                    level: 0,
                  },
                  spacing: { after: WORD_THEME.bulletSpaceAfter, line: 280 },
                })
              );
            });
            // Extra space after numbered list
            children.push(
              new Paragraph({
                text: '',
                spacing: { after: 80 },
              })
            );
          }
          break;
        }

        case 'table': {
          if (section.tableData) {
            const { headers, rows } = section.tableData;

            // Add spacing paragraph before table
            children.push(
              new Paragraph({
                text: '',
                spacing: { before: WORD_THEME.tableSpaceBefore },
              })
            );

            // Build and add the styled table
            children.push(buildStyledTable(headers, rows));

            // Add spacing paragraph after table
            children.push(
              new Paragraph({
                text: '',
                spacing: { after: WORD_THEME.tableSpaceAfter },
              })
            );
          }
          break;
        }
      }
    }

    // ── Create Document ─────────────────────────────────────
    const doc = new Document({
      sections: [{
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
            },
          },
        },
        children,
      }],
      title: params.title,
      creator: params.author || 'Aurora AI Agent',
      description: 'AI-Generated Document',
      styles: {
        default: {
          document: {
            run: {
              font: 'Segoe UI',
              size: WORD_THEME.bodySize,
              color: WORD_THEME.bodyColor,
            },
          },
        },
      },
      numbering: {
        config: [{
          reference: 'default-numbering',
          levels: [{
            level: 0,
            format: 'decimal',
            text: '%1.',
            alignment: AlignmentType.LEFT,
          }],
        }],
      },
    });

    // Generate cryptographically random filename to prevent enumeration
    const filename = `${crypto.randomUUID()}.docx`;

    // Save to temp directory
    const outputDir = path.join('/tmp', 'aevoy-files', 'word');
    await fs.mkdir(outputDir, { recursive: true });

    const filepath = path.join(outputDir, filename);

    // Generate and write the file
    const buffer = await Packer.toBuffer(doc);
    await fs.writeFile(filepath, buffer);

    // Get file size
    const stats = await fs.stat(filepath);

    return {
      success: true,
      filepath,
      url: `/files/word/${filename}`,
      sectionCount: params.sections.length,
      fileSize: stats.size
    };

  } catch (error) {
    console.error('[WORD] Generation failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Quick helper: Create a simple text document
 * Intelligently parses content: lines starting with # become headings,
 * lines starting with - or * become bullets, everything else is a paragraph.
 */
export async function createSimpleDocument(
  filename: string,
  title: string,
  paragraphs: string[]
): Promise<WordResult> {
  const sections: WordSection[] = [];

  for (const p of paragraphs) {
    const trimmed = p.trim();

    // Detect markdown-style headings
    if (trimmed.startsWith('### ')) {
      sections.push({ type: 'heading', text: trimmed.slice(4), level: 3 });
    } else if (trimmed.startsWith('## ')) {
      sections.push({ type: 'heading', text: trimmed.slice(3), level: 2 });
    } else if (trimmed.startsWith('# ')) {
      sections.push({ type: 'heading', text: trimmed.slice(2), level: 1 });
    } else if (/^[-*]\s+/.test(trimmed)) {
      // Collect consecutive bullet items
      const lastSection = sections[sections.length - 1];
      const bulletText = trimmed.replace(/^[-*]\s+/, '');
      if (lastSection && lastSection.type === 'bullet') {
        lastSection.items!.push(bulletText);
      } else {
        sections.push({ type: 'bullet', items: [bulletText] });
      }
    } else if (/^\d+\.\s+/.test(trimmed)) {
      // Numbered list item
      const lastSection = sections[sections.length - 1];
      const itemText = trimmed.replace(/^\d+\.\s+/, '');
      if (lastSection && lastSection.type === 'numbered') {
        lastSection.items!.push(itemText);
      } else {
        sections.push({ type: 'numbered', items: [itemText] });
      }
    } else {
      sections.push({ type: 'paragraph', text: trimmed });
    }
  }

  return createWordDocument({
    filename,
    title,
    sections,
  });
}

/**
 * Helper: Create a report with sections
 */
export async function createReport(
  filename: string,
  title: string,
  sections: Array<{ heading: string; content: string }>
): Promise<WordResult> {
  const docSections: WordSection[] = [];

  sections.forEach(section => {
    docSections.push(
      { type: 'heading', text: section.heading, level: 2 },
      { type: 'paragraph', text: section.content }
    );
  });

  return createWordDocument({
    filename,
    title,
    sections: docSections
  });
}

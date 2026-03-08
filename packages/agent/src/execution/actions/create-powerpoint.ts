/**
 * PowerPoint Generation Action
 * Creates professional presentations with slides, text, images, charts
 * Beats GenSpark on presentation generation
 */

import pptxgen from 'pptxgenjs';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';

export interface PresentationSlide {
  title?: string;
  content?: string | string[];
  bullets?: string[];
  image?: {
    path: string;
    x?: number;
    y?: number;
    w?: number;
    h?: number;
  };
  layout?: 'title' | 'content' | 'section' | 'comparison' | 'blank';
  notes?: string;
}

export interface PresentationParams {
  filename: string;
  title?: string;
  author?: string;
  subject?: string;
  slides: PresentationSlide[];
  theme?: {
    backgroundColor?: string;
    titleColor?: string;
    textColor?: string;
    accentColor?: string;
  };
}

export interface PowerPointResult {
  success: boolean;
  filepath?: string;
  url?: string;
  error?: string;
  slideCount?: number;
  fileSize?: number;
}

/**
 * Generate a PowerPoint presentation
 */
export async function createPowerPoint(
  params: PresentationParams
): Promise<PowerPointResult> {
  try {
    // Create new presentation
    // @ts-ignore - pptxgenjs types are incorrect
    const pres = new pptxgen();

    // Set presentation properties
    pres.author = params.author || 'Aevoy AI Agent';
    pres.company = 'Aevoy';
    pres.title = params.title || params.filename;
    pres.subject = params.subject || 'AI-Generated Presentation';

    // Define theme colors
    const theme = {
      background: params.theme?.backgroundColor || 'FFFFFF',
      title: params.theme?.titleColor || '1F4788',
      text: params.theme?.textColor || '333333',
      accent: params.theme?.accentColor || '4472C4'
    };

    // Add each slide
    for (const slideDef of params.slides) {
      const slide = pres.addSlide();

      // Set slide background
      slide.background = { color: theme.background };

      // Apply layout based on type
      switch (slideDef.layout || 'content') {
        case 'title': {
          // Title slide (centered, large text)
          if (slideDef.title) {
            slide.addText(slideDef.title, {
              x: 0.5,
              y: 2.0,
              w: 9.0,
              h: 1.5,
              fontSize: 44,
              bold: true,
              color: theme.title,
              align: 'center',
              valign: 'middle'
            });
          }

          if (slideDef.content) {
            const subtitle = typeof slideDef.content === 'string'
              ? slideDef.content
              : slideDef.content.join('\n');

            slide.addText(subtitle, {
              x: 0.5,
              y: 4.0,
              w: 9.0,
              h: 1.0,
              fontSize: 20,
              color: theme.text,
              align: 'center',
              valign: 'middle'
            });
          }
          break;
        }

        case 'section': {
          // Section header (bold, centered)
          if (slideDef.title) {
            slide.addText(slideDef.title, {
              x: 0.5,
              y: 2.5,
              w: 9.0,
              h: 2.0,
              fontSize: 54,
              bold: true,
              color: theme.accent,
              align: 'center',
              valign: 'middle'
            });
          }
          break;
        }

        case 'comparison': {
          // Two-column layout
          if (slideDef.title) {
            slide.addText(slideDef.title, {
              x: 0.5,
              y: 0.5,
              w: 9.0,
              h: 0.8,
              fontSize: 32,
              bold: true,
              color: theme.title
            });
          }

          if (slideDef.bullets && slideDef.bullets.length >= 2) {
            const half = Math.ceil(slideDef.bullets.length / 2);
            const leftBullets = slideDef.bullets.slice(0, half);
            const rightBullets = slideDef.bullets.slice(half);

            // Left column
            slide.addText(leftBullets.map(b => ({ text: b, options: { bullet: true } })), {
              x: 0.5,
              y: 1.5,
              w: 4.25,
              h: 4.0,
              fontSize: 18,
              color: theme.text
            });

            // Right column
            slide.addText(rightBullets.map(b => ({ text: b, options: { bullet: true } })), {
              x: 5.25,
              y: 1.5,
              w: 4.25,
              h: 4.0,
              fontSize: 18,
              color: theme.text
            });
          }
          break;
        }

        case 'content':
        default: {
          // Standard content slide
          if (slideDef.title) {
            slide.addText(slideDef.title, {
              x: 0.5,
              y: 0.5,
              w: 9.0,
              h: 0.8,
              fontSize: 32,
              bold: true,
              color: theme.title
            });
          }

          // Add bullets if provided
          if (slideDef.bullets && slideDef.bullets.length > 0) {
            slide.addText(
              slideDef.bullets.map(bullet => ({ text: bullet, options: { bullet: true } })),
              {
                x: 0.5,
                y: 1.5,
                w: 9.0,
                h: 4.0,
                fontSize: 18,
                color: theme.text,
                bullet: { code: '2022' } // Bullet point character
              }
            );
          } else if (slideDef.content) {
            // Add plain text content
            const contentText = typeof slideDef.content === 'string'
              ? slideDef.content
              : slideDef.content.join('\n\n');

            slide.addText(contentText, {
              x: 0.5,
              y: 1.5,
              w: 9.0,
              h: 4.0,
              fontSize: 18,
              color: theme.text
            });
          }

          // Add image if provided
          if (slideDef.image) {
            slide.addImage({
              path: slideDef.image.path,
              x: slideDef.image.x || 6.0,
              y: slideDef.image.y || 1.5,
              w: slideDef.image.w || 3.5,
              h: slideDef.image.h || 3.5
            });
          }
          break;
        }

        case 'blank': {
          // Blank slide - user has full control
          // Content will be added manually in params
          break;
        }
      }

      // Add speaker notes if provided
      if (slideDef.notes) {
        slide.addNotes(slideDef.notes);
      }
    }

    // Generate cryptographically random filename to prevent enumeration
    const filename = `${crypto.randomUUID()}.pptx`;

    // Save to temp directory
    const outputDir = path.join('/tmp', 'aevoy-files', 'powerpoint');
    await fs.mkdir(outputDir, { recursive: true });

    const filepath = path.join(outputDir, filename);

    // Write the file
    await pres.writeFile({ fileName: filepath });

    // Get file size
    const stats = await fs.stat(filepath);

    return {
      success: true,
      filepath,
      url: `/files/powerpoint/${filename}`,
      slideCount: params.slides.length,
      fileSize: stats.size
    };

  } catch (error) {
    console.error('[POWERPOINT] Generation failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Quick helper: Create a simple bullet-point presentation
 */
export async function createSimplePresentation(
  filename: string,
  title: string,
  slides: Array<{ title: string; bullets: string[] }>
): Promise<PowerPointResult> {
  return createPowerPoint({
    filename,
    title,
    slides: [
      // Title slide
      {
        title,
        layout: 'title',
        content: 'AI-Generated Presentation'
      },
      // Content slides
      ...slides.map(s => ({
        title: s.title,
        bullets: s.bullets,
        layout: 'content' as const
      }))
    ]
  });
}

/**
 * Helper: Create a pitch deck
 */
export async function createPitchDeck(
  filename: string,
  companyName: string,
  sections: {
    problem: string[];
    solution: string[];
    market: string[];
    traction: string[];
    team: string[];
    ask: string[];
  }
): Promise<PowerPointResult> {
  return createPowerPoint({
    filename,
    title: `${companyName} - Pitch Deck`,
    author: companyName,
    slides: [
      { title: companyName, layout: 'title', content: 'Investor Pitch Deck' },
      { title: 'The Problem', bullets: sections.problem, layout: 'content' },
      { title: 'Our Solution', bullets: sections.solution, layout: 'content' },
      { title: 'Market Opportunity', bullets: sections.market, layout: 'content' },
      { title: 'Traction', bullets: sections.traction, layout: 'content' },
      { title: 'Our Team', bullets: sections.team, layout: 'content' },
      { title: 'The Ask', bullets: sections.ask, layout: 'content' }
    ],
    theme: {
      titleColor: '1F4788',
      accentColor: '4472C4',
      textColor: '333333'
    }
  });
}

/**
 * PowerPoint Generation Action
 * Creates professional presentations with modern design, gradient backgrounds,
 * accent elements, and polished typography.
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

// ── Modern Design Tokens ────────────────────────────────────────
// Dark sophisticated palette by default. Users can override via theme param.
const DESIGN = {
  // Colors
  bgDark: '1A1A2E',        // Deep navy-charcoal
  bgMedium: '16213E',       // Slightly lighter navy
  bgLight: '0F3460',        // Section accent background
  titleWhite: 'FFFFFF',     // White for titles on dark bg
  subtitleGray: 'A0AEC0',   // Muted gray for subtitles
  bodyText: 'E2E8F0',       // Light gray for body text
  accent: '00D4AA',         // Teal-green accent
  accentAlt: '7C5CFC',      // Purple accent for variety
  accentWarm: 'F59E0B',     // Warm amber for highlights
  divider: '2D3748',        // Subtle divider color

  // Fonts (system fonts supported by pptxgenjs)
  fontHeading: 'Segoe UI',
  fontBody: 'Segoe UI',

  // Spacing (inches)
  marginX: 0.8,
  marginY: 0.6,
  contentW: 8.4,            // 10 - 2*marginX
} as const;

/**
 * Add a thin accent bar at the bottom of a slide
 */
function addBottomAccent(slide: any, color: string): void {
  // Bottom accent bar
  slide.addShape('rect', {
    x: 0,
    y: 5.3,
    w: 10,
    h: 0.06,
    fill: { color },
  });
}

/**
 * Add a decorative side accent element
 */
function addSideAccent(slide: any, color: string): void {
  // Left vertical accent stripe
  slide.addShape('rect', {
    x: 0,
    y: 0,
    w: 0.06,
    h: 5.63,
    fill: { color },
  });
}

/**
 * Add slide number in bottom-right corner
 */
function addSlideNumber(slide: any, num: number, total: number): void {
  slide.addText(`${num} / ${total}`, {
    x: 8.5,
    y: 5.15,
    w: 1.2,
    h: 0.3,
    fontSize: 9,
    color: DESIGN.subtitleGray,
    fontFace: DESIGN.fontBody,
    align: 'right',
  });
}

/**
 * Build a gradient-style background using overlapping shapes
 * (pptxgenjs doesn't support true gradients on slide bg, so we layer shapes)
 */
function addDarkBackground(slide: any, variant: 'primary' | 'accent' = 'primary'): void {
  const bgColor = variant === 'accent' ? DESIGN.bgLight : DESIGN.bgDark;
  slide.background = { color: bgColor };

  // Subtle top-right decorative shape (large faded circle impression via rectangle)
  slide.addShape('rect', {
    x: 7.5,
    y: -1.5,
    w: 4.5,
    h: 4.5,
    fill: { color: variant === 'accent' ? DESIGN.accentAlt : DESIGN.accent, type: 'solid' },
    rectRadius: 2.25,
    // @ts-ignore - opacity works at runtime
    transparency: 92,
  });

  // Subtle bottom-left decorative shape
  slide.addShape('rect', {
    x: -1.5,
    y: 3.5,
    w: 3.5,
    h: 3.5,
    fill: { color: DESIGN.accentAlt, type: 'solid' },
    rectRadius: 1.75,
    // @ts-ignore
    transparency: 95,
  });
}

/**
 * Resolve theme: merge user-provided colors with dark defaults
 */
function resolveTheme(userTheme?: PresentationParams['theme']) {
  // If user explicitly provides a white/light background, use light-mode text colors
  const isLightBg = userTheme?.backgroundColor &&
    ['FFFFFF', 'FFF', 'F5F5F5', 'FAFAFA', 'F0F0F0'].includes(
      userTheme.backgroundColor.replace('#', '').toUpperCase()
    );

  if (isLightBg) {
    return {
      background: userTheme!.backgroundColor!.replace('#', ''),
      title: userTheme?.titleColor?.replace('#', '') || '1A1A2E',
      text: userTheme?.textColor?.replace('#', '') || '333333',
      accent: userTheme?.accentColor?.replace('#', '') || DESIGN.accent,
      useDarkBg: false,
    };
  }

  return {
    background: userTheme?.backgroundColor?.replace('#', '') || DESIGN.bgDark,
    title: userTheme?.titleColor?.replace('#', '') || DESIGN.titleWhite,
    text: userTheme?.textColor?.replace('#', '') || DESIGN.bodyText,
    accent: userTheme?.accentColor?.replace('#', '') || DESIGN.accent,
    useDarkBg: !userTheme?.backgroundColor, // Only use decorative shapes on default dark bg
  };
}

/**
 * Generate a PowerPoint presentation
 */
export async function createPowerPoint(
  params: PresentationParams
): Promise<PowerPointResult> {
  try {
    // @ts-ignore - pptxgenjs types are incorrect
    const pres = new pptxgen();

    // Set presentation properties
    pres.author = params.author || 'Aurora AI Agent';
    pres.company = 'Aurora';
    pres.title = params.title || params.filename;
    pres.subject = params.subject || 'AI-Generated Presentation';

    // Set default slide layout
    pres.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 is standard wide, but pptxgenjs uses 10x5.63

    const theme = resolveTheme(params.theme);
    const totalSlides = params.slides.length;

    // Add each slide
    params.slides.forEach((slideDef, slideIndex) => {
      const slide = pres.addSlide();

      // Apply background
      if (theme.useDarkBg) {
        const variant = slideDef.layout === 'section' ? 'accent' : 'primary';
        addDarkBackground(slide, variant);
      } else {
        slide.background = { color: theme.background };
      }

      // Layout-specific rendering
      switch (slideDef.layout || 'content') {
        case 'title': {
          // ── TITLE SLIDE ─────────────────────────────────────
          // Accent line above title
          slide.addShape('rect', {
            x: DESIGN.marginX,
            y: 1.6,
            w: 1.2,
            h: 0.06,
            fill: { color: theme.accent },
          });

          if (slideDef.title) {
            slide.addText(slideDef.title, {
              x: DESIGN.marginX,
              y: 1.8,
              w: DESIGN.contentW,
              h: 1.6,
              fontSize: 40,
              bold: true,
              color: theme.title,
              fontFace: DESIGN.fontHeading,
              align: 'left',
              valign: 'top',
              lineSpacingMultiple: 1.1,
            });
          }

          if (slideDef.content) {
            const subtitle = typeof slideDef.content === 'string'
              ? slideDef.content
              : slideDef.content.join(' | ');

            slide.addText(subtitle, {
              x: DESIGN.marginX,
              y: 3.5,
              w: DESIGN.contentW,
              h: 0.7,
              fontSize: 18,
              color: DESIGN.subtitleGray,
              fontFace: DESIGN.fontBody,
              align: 'left',
              valign: 'top',
            });
          }

          // Author / date line at bottom
          const dateLine = params.author
            ? `${params.author}  |  ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`
            : new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

          slide.addText(dateLine, {
            x: DESIGN.marginX,
            y: 4.8,
            w: DESIGN.contentW,
            h: 0.4,
            fontSize: 11,
            color: DESIGN.subtitleGray,
            fontFace: DESIGN.fontBody,
            align: 'left',
          });

          addBottomAccent(slide, theme.accent);
          break;
        }

        case 'section': {
          // ── SECTION DIVIDER SLIDE ───────────────────────────
          // Large accent number/icon area
          slide.addShape('rect', {
            x: DESIGN.marginX,
            y: 2.0,
            w: 0.8,
            h: 0.06,
            fill: { color: DESIGN.accentWarm },
          });

          if (slideDef.title) {
            slide.addText(slideDef.title, {
              x: DESIGN.marginX,
              y: 2.2,
              w: DESIGN.contentW,
              h: 1.5,
              fontSize: 42,
              bold: true,
              color: theme.title,
              fontFace: DESIGN.fontHeading,
              align: 'left',
              valign: 'middle',
            });
          }

          if (slideDef.content) {
            const sectionContent = typeof slideDef.content === 'string'
              ? slideDef.content
              : slideDef.content.join('\n');
            slide.addText(sectionContent, {
              x: DESIGN.marginX,
              y: 3.7,
              w: 6.0,
              h: 0.6,
              fontSize: 16,
              color: DESIGN.subtitleGray,
              fontFace: DESIGN.fontBody,
              align: 'left',
            });
          }

          addBottomAccent(slide, DESIGN.accentWarm);
          break;
        }

        case 'comparison': {
          // ── TWO-COLUMN COMPARISON SLIDE ──────────────────────
          if (slideDef.title) {
            slide.addText(slideDef.title, {
              x: DESIGN.marginX,
              y: DESIGN.marginY,
              w: DESIGN.contentW,
              h: 0.7,
              fontSize: 26,
              bold: true,
              color: theme.title,
              fontFace: DESIGN.fontHeading,
            });

            // Accent underline
            slide.addShape('rect', {
              x: DESIGN.marginX,
              y: 1.25,
              w: 0.8,
              h: 0.04,
              fill: { color: theme.accent },
            });
          }

          if (slideDef.bullets && slideDef.bullets.length >= 2) {
            const half = Math.ceil(slideDef.bullets.length / 2);
            const leftBullets = slideDef.bullets.slice(0, half);
            const rightBullets = slideDef.bullets.slice(half);

            const colY = 1.5;
            const colH = 3.6;
            const colW = 3.9;
            const gutter = 0.6;

            // Left column background
            slide.addShape('roundRect', {
              x: DESIGN.marginX,
              y: colY,
              w: colW,
              h: colH,
              fill: { color: theme.useDarkBg ? DESIGN.bgMedium : 'F7F8FA' },
              rectRadius: 0.1,
            });

            // Left column text
            slide.addText(
              leftBullets.map(b => ({
                text: b,
                options: {
                  bullet: { code: '2022' },
                  color: theme.text,
                  fontSize: 15,
                  lineSpacingMultiple: 1.4,
                  paraSpaceAfter: 6,
                },
              })),
              {
                x: DESIGN.marginX + 0.3,
                y: colY + 0.3,
                w: colW - 0.6,
                h: colH - 0.6,
                fontFace: DESIGN.fontBody,
                valign: 'top',
              }
            );

            // Right column background
            slide.addShape('roundRect', {
              x: DESIGN.marginX + colW + gutter,
              y: colY,
              w: colW,
              h: colH,
              fill: { color: theme.useDarkBg ? DESIGN.bgMedium : 'F7F8FA' },
              rectRadius: 0.1,
            });

            // Right column text
            slide.addText(
              rightBullets.map(b => ({
                text: b,
                options: {
                  bullet: { code: '2022' },
                  color: theme.text,
                  fontSize: 15,
                  lineSpacingMultiple: 1.4,
                  paraSpaceAfter: 6,
                },
              })),
              {
                x: DESIGN.marginX + colW + gutter + 0.3,
                y: colY + 0.3,
                w: colW - 0.6,
                h: colH - 0.6,
                fontFace: DESIGN.fontBody,
                valign: 'top',
              }
            );
          }

          addSideAccent(slide, theme.accent);
          addSlideNumber(slide, slideIndex + 1, totalSlides);
          break;
        }

        case 'content':
        default: {
          // ── STANDARD CONTENT SLIDE ──────────────────────────
          if (slideDef.title) {
            slide.addText(slideDef.title, {
              x: DESIGN.marginX,
              y: DESIGN.marginY,
              w: DESIGN.contentW,
              h: 0.7,
              fontSize: 26,
              bold: true,
              color: theme.title,
              fontFace: DESIGN.fontHeading,
            });

            // Accent underline below title
            slide.addShape('rect', {
              x: DESIGN.marginX,
              y: 1.25,
              w: 0.8,
              h: 0.04,
              fill: { color: theme.accent },
            });
          }

          const contentY = slideDef.title ? 1.5 : DESIGN.marginY;
          const contentH = slideDef.title ? 3.6 : 4.5;

          if (slideDef.bullets && slideDef.bullets.length > 0) {
            // Styled bullet list with custom bullet character and spacing
            slide.addText(
              slideDef.bullets.map(bullet => ({
                text: bullet,
                options: {
                  bullet: { code: '2023' }, // Triangular bullet
                  color: theme.text,
                  fontSize: 16,
                  lineSpacingMultiple: 1.5,
                  paraSpaceAfter: 8,
                },
              })),
              {
                x: DESIGN.marginX + 0.2,
                y: contentY,
                w: DESIGN.contentW - 0.4,
                h: contentH,
                fontFace: DESIGN.fontBody,
                valign: 'top',
              }
            );
          } else if (slideDef.content) {
            const contentText = typeof slideDef.content === 'string'
              ? slideDef.content
              : slideDef.content.join('\n\n');

            slide.addText(contentText, {
              x: DESIGN.marginX + 0.2,
              y: contentY,
              w: DESIGN.contentW - 0.4,
              h: contentH,
              fontSize: 16,
              color: theme.text,
              fontFace: DESIGN.fontBody,
              lineSpacingMultiple: 1.5,
              valign: 'top',
            });
          }

          // Add image if provided (positioned to the right side)
          if (slideDef.image) {
            slide.addImage({
              path: slideDef.image.path,
              x: slideDef.image.x || 6.0,
              y: slideDef.image.y || 1.5,
              w: slideDef.image.w || 3.5,
              h: slideDef.image.h || 3.5,
              rounding: true,
            });
          }

          addSideAccent(slide, theme.accent);
          addSlideNumber(slide, slideIndex + 1, totalSlides);
          break;
        }

        case 'blank': {
          // Blank slide - user has full control
          break;
        }
      }

      // Add speaker notes if provided
      if (slideDef.notes) {
        slide.addNotes(slideDef.notes);
      }
    });

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
      { title: 'Traction & Metrics', bullets: sections.traction, layout: 'content' },
      { title: 'Our Team', bullets: sections.team, layout: 'comparison' },
      { title: 'The Ask', bullets: sections.ask, layout: 'content' }
    ]
  });
}

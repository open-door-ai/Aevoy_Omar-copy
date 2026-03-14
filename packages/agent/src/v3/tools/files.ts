/**
 * V3 File Creation Tools
 *
 * Document creation (Word, Excel, PowerPoint, PDF) and image generation.
 * Wraps existing action implementations using their helper functions.
 */

import { registerTool } from '../tool-registry.js';
import type { ToolCallResult, TaskContext } from '../types.js';

/** Create document tool */
registerTool({
  name: 'create_document',
  description: 'Create a document file (Word, Excel, PowerPoint, or PDF). Returns a download URL for the created file.',
  category: 'file',
  parameters: {
    type: {
      type: 'string',
      description: 'Document type to create',
      enum: ['word', 'excel', 'powerpoint', 'pdf'],
    },
    title: { type: 'string', description: 'Document title or filename' },
    content: { type: 'string', description: 'Document content. For Excel: JSON array of rows with first row as headers. For others: text with sections separated by newlines.' },
  },
  required: ['type', 'content'],
  async execute(params, ctx): Promise<ToolCallResult> {
    const docType = String(params.type);
    const title = String(params.title || 'document');
    const content = String(params.content);
    const agentUrl = process.env.AGENT_URL || 'https://agent-production-1339.up.railway.app';

    try {
      switch (docType) {
        case 'excel': {
          const { createSimpleTable } = await import('../../execution/actions/create-excel.js');
          let headers: string[] = [];
          let data: (string | number | boolean | null)[][] = [];
          try {
            const parsed = JSON.parse(content);
            if (Array.isArray(parsed) && parsed.length > 0) {
              if (Array.isArray(parsed[0])) {
                // Array of arrays: first row is headers
                headers = parsed[0].map(String);
                data = parsed.slice(1);
              } else if (typeof parsed[0] === 'object') {
                // Array of objects: keys are headers
                headers = Object.keys(parsed[0]);
                data = parsed.map((row: any) => headers.map(h => row[h] ?? null));
              }
            }
          } catch {
            // Plain text: split by newlines and tabs/commas
            const lines = content.split('\n').filter(l => l.trim());
            if (lines.length > 0) {
              headers = lines[0].split(/\t|,/).map(c => c.trim());
              data = lines.slice(1).map(l => l.split(/\t|,/).map(c => c.trim()));
            }
          }
          const result = await createSimpleTable(title, headers, data);
          if (result.success && result.filepath) {
            const url = `${agentUrl}/files/excel/${encodeURIComponent(result.filepath.split('/').pop() || '')}`;
            return { success: true, data: `Excel file created: ${url}`, cost: 0 };
          }
          return { success: false, error: result.error || 'Excel creation failed', cost: 0 };
        }

        case 'word': {
          const { createSimpleDocument } = await import('../../execution/actions/create-word.js');
          const paragraphs = content.split('\n').filter(l => l.trim());
          const result = await createSimpleDocument(title, title, paragraphs);
          if (result.success && result.filepath) {
            const url = `${agentUrl}/files/word/${encodeURIComponent(result.filepath.split('/').pop() || '')}`;
            return { success: true, data: `Word document created: ${url}`, cost: 0 };
          }
          return { success: false, error: result.error || 'Word creation failed', cost: 0 };
        }

        case 'powerpoint': {
          const { createSimplePresentation } = await import('../../execution/actions/create-powerpoint.js');
          // Parse content into slides: split by double newlines or "Slide X:" markers
          const slideTexts = content.split(/\n{2,}|(?=Slide \d+:)/i).filter(s => s.trim());
          const slides = slideTexts.map(text => {
            const lines = text.split('\n').filter(l => l.trim());
            const slideTitle = lines[0]?.replace(/^Slide \d+:\s*/i, '') || 'Slide';
            const bullets = lines.slice(1).map(l => l.replace(/^[-•*]\s*/, ''));
            return { title: slideTitle, bullets };
          });
          const result = await createSimplePresentation(title, title, slides);
          if (result.success && result.filepath) {
            const url = `${agentUrl}/files/powerpoint/${encodeURIComponent(result.filepath.split('/').pop() || '')}`;
            return { success: true, data: `PowerPoint created: ${url}`, cost: 0 };
          }
          return { success: false, error: result.error || 'PowerPoint creation failed', cost: 0 };
        }

        case 'pdf': {
          const { createSimplePDF } = await import('../../execution/actions/create-pdf.js');
          const paragraphs = content.split('\n').filter(l => l.trim());
          const result = await createSimplePDF(title, title, paragraphs);
          if (result.success && result.filepath) {
            const url = `${agentUrl}/files/pdf/${encodeURIComponent(result.filepath.split('/').pop() || '')}`;
            return { success: true, data: `PDF created: ${url}`, cost: 0 };
          }
          return { success: false, error: result.error || 'PDF creation failed', cost: 0 };
        }

        default:
          return { success: false, error: `Unknown document type: ${docType}. Use: word, excel, powerpoint, pdf`, cost: 0 };
      }
    } catch (err) {
      return { success: false, error: `Document creation failed: ${err instanceof Error ? err.message : 'unknown'}`, cost: 0 };
    }
  },
});

/** Generate image tool */
registerTool({
  name: 'generate_image',
  description: 'Generate an image from a text description using AI. Returns a URL to the generated image.',
  category: 'file',
  parameters: {
    prompt: { type: 'string', description: 'Detailed description of the image to generate' },
    style: { type: 'string', description: 'Image style (e.g. "photorealistic", "cartoon", "watercolor", "digital art")' },
  },
  required: ['prompt'],
  async execute(params, ctx): Promise<ToolCallResult> {
    const prompt = String(params.prompt);
    const style = params.style ? String(params.style) : '';
    const fullPrompt = style ? `${style} style: ${prompt}` : prompt;

    try {
      // Try Gemini image generation first
      if (process.env.GOOGLE_API_KEY) {
        try {
          const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${process.env.GOOGLE_API_KEY}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: `Generate an image: ${fullPrompt}` }] }],
                generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
              }),
              signal: AbortSignal.timeout(30000),
            }
          );

          if (geminiRes.ok) {
            const geminiData = await geminiRes.json();
            const parts = geminiData.candidates?.[0]?.content?.parts || [];
            for (const part of parts) {
              if (part.inlineData?.mimeType?.startsWith('image/')) {
                const fs = await import('fs');
                const path = await import('path');
                const dir = '/tmp/aevoy-files/images';
                fs.mkdirSync(dir, { recursive: true });
                const filename = `img_${Date.now()}.png`;
                const filePath = path.join(dir, filename);
                fs.writeFileSync(filePath, Buffer.from(part.inlineData.data, 'base64'));
                const agentUrl = process.env.AGENT_URL || 'https://agent-production-1339.up.railway.app';
                const url = `${agentUrl}/files/images/${filename}`;
                return { success: true, data: `Image generated: ${url}`, cost: 0.01 };
              }
            }
          }
        } catch { /* fall through to Pollinations */ }
      }

      // Fallback: Pollinations.ai (free)
      const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}?width=1024&height=1024&nologo=true`;
      const testRes = await fetch(pollinationsUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(15000),
      });

      if (testRes.ok) {
        return { success: true, data: `Image generated: ${pollinationsUrl}`, cost: 0 };
      }

      return { success: false, error: 'Image generation failed', cost: 0 };
    } catch (err) {
      return { success: false, error: `Image generation failed: ${err instanceof Error ? err.message : 'unknown'}`, cost: 0 };
    }
  },
});

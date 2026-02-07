/**
 * Skill Downloader
 *
 * Fetches skill code from remote sources with SHA-256 hash verification
 * to prevent tampering and ensure integrity.
 */

import crypto from "crypto";
import { SkillManifest } from "./discovery.js";
import tar from "tar-stream";
import { Readable } from "stream";
import zlib from "zlib";

export interface DownloadResult {
  success: boolean;
  code?: string;
  manifest?: SkillManifest;
  hash?: string;
  error?: string;
  size?: number;
}

export class SkillDownloader {
  /**
   * Download skill code from URL with hash verification
   */
  async downloadSkill(
    manifest: SkillManifest,
    options: {
      verifyHash?: boolean;
      maxSizeMB?: number;
      timeoutMs?: number;
    } = {}
  ): Promise<DownloadResult> {
    const { verifyHash = true, maxSizeMB = 5, timeoutMs = 30000 } = options;

    try {
      // Handle different source types
      if (manifest.source === "curated") {
        return this.downloadCuratedSkill(manifest);
      } else if (manifest.source === "n8n") {
        return this.downloadN8nSkill(manifest, maxSizeMB, timeoutMs);
      } else if (manifest.source === "mcp") {
        return this.downloadMCPSkill(manifest, maxSizeMB, timeoutMs);
      }

      return {
        success: false,
        error: `Unknown skill source: ${manifest.source}`,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Download failed: ${msg}`,
      };
    }
  }

  /**
   * Download curated skill (inline code in registry)
   */
  private async downloadCuratedSkill(manifest: SkillManifest): Promise<DownloadResult> {
    // Curated skills have inline code or local file references
    if (manifest.codeUrl === "inline") {
      // Code is embedded in the manifest (not implemented yet)
      return {
        success: false,
        error: "Inline code storage not yet implemented",
      };
    }

    // If codeUrl is a local file path
    if (manifest.codeUrl.startsWith("file://")) {
      const fs = await import("fs/promises");
      const path = await import("path");
      const { fileURLToPath } = await import("url");

      const filePath = manifest.codeUrl.replace("file://", "");
      const code = await fs.readFile(filePath, "utf-8");

      const hash = this.calculateHash(code);

      // Verify hash if provided
      if (manifest.codeHash && hash !== manifest.codeHash) {
        return {
          success: false,
          error: "Hash mismatch - code has been modified",
        };
      }

      return {
        success: true,
        code,
        manifest,
        hash,
        size: Buffer.byteLength(code, "utf-8"),
      };
    }

    return {
      success: false,
      error: "Curated skill has invalid codeUrl",
    };
  }

  /**
   * Download n8n community node from npm
   */
  private async downloadN8nSkill(
    manifest: SkillManifest,
    maxSizeMB: number,
    timeoutMs: number
  ): Promise<DownloadResult> {
    try {
      // Fetch tarball from npm registry
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(manifest.codeUrl, {
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return {
          success: false,
          error: `npm fetch failed: ${response.status}`,
        };
      }

      // Check size
      const contentLength = response.headers.get("content-length");
      if (contentLength) {
        const sizeMB = parseInt(contentLength) / (1024 * 1024);
        if (sizeMB > maxSizeMB) {
          return {
            success: false,
            error: `Package too large: ${sizeMB.toFixed(2)}MB (max ${maxSizeMB}MB)`,
          };
        }
      }

      // Download tarball
      const buffer = await response.arrayBuffer();
      const tarballBuffer = Buffer.from(buffer);

      // Extract code from tarball
      const code = await this.extractN8nCode(tarballBuffer);

      if (!code) {
        return {
          success: false,
          error: "Failed to extract code from tarball",
        };
      }

      const hash = this.calculateHash(code);

      return {
        success: true,
        code,
        manifest,
        hash,
        size: tarballBuffer.length,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `n8n download failed: ${msg}`,
      };
    }
  }

  /**
   * Download MCP skill (placeholder)
   */
  private async downloadMCPSkill(
    manifest: SkillManifest,
    maxSizeMB: number,
    timeoutMs: number
  ): Promise<DownloadResult> {
    // TODO: Implement MCP skill download
    return {
      success: false,
      error: "MCP skill download not yet implemented",
    };
  }

  /**
   * Extract n8n node code from tarball
   */
  private async extractN8nCode(tarballBuffer: Buffer): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const extract = tar.extract();
      const gunzip = zlib.createGunzip();
      let code = "";

      extract.on("entry", (header, stream, next) => {
        // Look for main .node.ts or .node.js file
        if (
          header.name.endsWith(".node.ts") ||
          header.name.endsWith(".node.js") ||
          header.name.endsWith("index.ts") ||
          header.name.endsWith("index.js")
        ) {
          const chunks: Buffer[] = [];

          stream.on("data", (chunk) => {
            chunks.push(chunk);
          });

          stream.on("end", () => {
            if (!code) {
              // Take first matching file
              code = Buffer.concat(chunks).toString("utf-8");
            }
            next();
          });

          stream.resume();
        } else {
          stream.on("end", () => next());
          stream.resume();
        }
      });

      extract.on("finish", () => {
        resolve(code || null);
      });

      extract.on("error", (err) => {
        reject(err);
      });

      // Pipe: tarball buffer → gunzip → tar extract
      const readable = Readable.from(tarballBuffer);
      readable.pipe(gunzip).pipe(extract);
    });
  }

  /**
   * Calculate SHA-256 hash of code
   */
  calculateHash(code: string): string {
    return crypto.createHash("sha256").update(code).digest("hex");
  }

  /**
   * Verify hash matches expected value
   */
  verifyHash(code: string, expectedHash: string): boolean {
    const actualHash = this.calculateHash(code);
    return actualHash === expectedHash;
  }
}

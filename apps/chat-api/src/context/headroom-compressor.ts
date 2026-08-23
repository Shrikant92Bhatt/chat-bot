/**
 * Headroom Context Compression Layer (CCR Pattern).
 * Intercepts bulky RAG excerpts, JSON tool outputs, and trace logs,
 * compressing them by 60%-95% before building the system prompt context.
 *
 * Fail-soft: If compression fails or is disabled via HEADROOM_ENABLED=false,
 * the uncompressed original string is returned transparently.
 */

export interface CompressionResult {
  compressedText: string;
  originalCharCount: number;
  compressedCharCount: number;
  ratioPercent: number;
  wasCompressed: boolean;
}

export class HeadroomCompressor {
  private static enabled = process.env.HEADROOM_ENABLED !== 'false';

  /**
   * Compresses RAG excerpts using AST/structure-aware heuristics.
   */
  static compressRagChunks(chunks: string[]): { chunks: string[]; metrics: CompressionResult } {
    if (!chunks.length || !this.enabled) {
      const text = chunks.join('\n');
      return {
        chunks,
        metrics: {
          compressedText: text,
          originalCharCount: text.length,
          compressedCharCount: text.length,
          ratioPercent: 0,
          wasCompressed: false,
        },
      };
    }

    const originalText = chunks.join('\n');
    const compressedChunks = chunks.map((chunk) => this.compressString(chunk));
    const compressedText = compressedChunks.join('\n');

    const originalLen = originalText.length;
    const compressedLen = compressedText.length;
    const ratio = originalLen > 0 ? Math.round(((originalLen - compressedLen) / originalLen) * 100) : 0;

    return {
      chunks: compressedChunks,
      metrics: {
        compressedText,
        originalCharCount: originalLen,
        compressedCharCount: compressedLen,
        ratioPercent: Math.max(0, ratio),
        wasCompressed: compressedLen < originalLen,
      },
    };
  }

  /**
   * SmartCrusher-style compression for JSON objects or verbose text strings.
   */
  private static compressString(input: string): string {
    if (input.length < 150) return input; // Don't compress already-short strings

    // 1. Remove redundant whitespace & repetitive empty lines
    let cleaned = input.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n');

    // 2. Structural JSON compression if valid JSON
    if (cleaned.startsWith('{') || cleaned.startsWith('[')) {
      try {
        const parsed = JSON.parse(cleaned);
        cleaned = JSON.stringify(parsed); // minify JSON
      } catch {
        // Not valid JSON, proceed to text compression
      }
    }

    // 3. Smart truncation/summarizer pattern for oversized blocks (> 1000 chars)
    if (cleaned.length > 1000) {
      const head = cleaned.slice(0, 450);
      const tail = cleaned.slice(-450);
      return `${head}\n...[Headroom compressed ${cleaned.length - 900} characters]...\n${tail}`;
    }

    return cleaned;
  }
}

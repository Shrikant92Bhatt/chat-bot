import { PDFParse } from 'pdf-parse';

const TEXT_EXTENSIONS = ['.txt', '.md', '.csv', '.json'];
const MAX_CONTENT_CHARS = 200_000; // keeps a single upload from blowing up the in-memory store / prompt context

/**
 * Extracts plain text from an uploaded file buffer for RAG ingestion.
 * Supports plain-text formats directly and PDFs via pdf-parse (verified
 * live: PDFParse.getText() returns { pages: [{text, num}], text, total }).
 */
export async function extractDocumentText(buffer: Buffer, fileName: string, mimeType: string): Promise<string> {
  const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();

  let text: string;

  if (mimeType === 'application/pdf' || extension === '.pdf') {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      text = result.pages.map((p) => p.text).join('\n\n');
    } finally {
      await parser.destroy();
    }
  } else if (TEXT_EXTENSIONS.includes(extension) || mimeType.startsWith('text/')) {
    text = buffer.toString('utf-8');
  } else {
    throw new Error(`Unsupported file type "${extension || mimeType}". Supported: .txt, .md, .csv, .json, .pdf`);
  }

  text = text.trim();
  if (!text) {
    throw new Error('No extractable text found in this file.');
  }

  return text.length > MAX_CONTENT_CHARS ? text.slice(0, MAX_CONTENT_CHARS) : text;
}

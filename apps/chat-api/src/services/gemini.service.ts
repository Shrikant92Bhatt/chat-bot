import { GoogleGenAI } from '@google/genai';
import { ChatStreamRequest } from '@chat-monorepo/shared';
import { Response } from 'express';

export class GeminiService {
  private ai: GoogleGenAI | null = null;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (apiKey) {
      this.ai = new GoogleGenAI({ apiKey });
    } else {
      console.warn('[GeminiService] Warning: GEMINI_API_KEY is not set.');
    }
  }

  async streamChat(request: ChatStreamRequest, res: Response): Promise<void> {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

    if (!apiKey) {
      // Fallback mock stream if API key is missing
      await this.mockStream(request, res, 'Gemini (API Key missing - Mock Stream Mode)');
      return;
    }

    try {
      if (!this.ai) {
        this.ai = new GoogleGenAI({ apiKey });
      }

      const modelName = request.model.includes('pro') ? 'gemini-1.5-pro' : 'gemini-1.5-flash';

      // Convert messages format for Gemini SDK
      const contents = request.messages.map((msg) => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      }));

      const responseStream = await this.ai.models.generateContentStream({
        model: modelName,
        contents: contents as any,
        config: {
          temperature: request.temperature ?? 0.7,
        },
      });

      for await (const chunk of responseStream) {
        const text = chunk.text || '';
        if (text) {
          res.write(`data: ${JSON.stringify({ chunk: text, done: false, model: request.model })}\n\n`);
        }
      }

      res.write(`data: ${JSON.stringify({ chunk: '', done: true, model: request.model })}\n\n`);
      res.end();
    } catch (error) {
      console.error('[GeminiService] Error during streaming:', error);
      res.write(`data: ${JSON.stringify({ error: (error as Error).message, done: true })}\n\n`);
      res.end();
    }
  }

  private async mockStream(request: ChatStreamRequest, res: Response, source: string): Promise<void> {
    const lastUserMessage = request.messages[request.messages.length - 1]?.content || 'Hello';
    const mockReply = `[${source}] Received prompt: "${lastUserMessage}". This is a simulated high-performance response from Gemini model ${request.model}. Glassmorphism design and multi-LLM SSE routing active!`;

    const tokens = mockReply.split(' ');
    for (const token of tokens) {
      res.write(`data: ${JSON.stringify({ chunk: token + ' ', done: false, model: request.model })}\n\n`);
      await new Promise((r) => setTimeout(r, 40));
    }
    res.write(`data: ${JSON.stringify({ chunk: '', done: true, model: request.model })}\n\n`);
    res.end();
  }
}

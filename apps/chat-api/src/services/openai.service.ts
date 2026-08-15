import OpenAI from 'openai';
import { ChatStreamRequest } from '@chat-monorepo/shared';
import { Response } from 'express';

function cleanEnvVar(val?: string): string {
  if (!val) return '';
  return val.replace(/^\uFEFF/, '').replace(/\r/g, '').trim();
}

export class OpenAIService {
  private client: OpenAI | null = null;

  constructor() {
    const apiKey = cleanEnvVar(process.env.OPENAI_API_KEY);
    if (apiKey) {
      this.client = new OpenAI({ apiKey });
    } else {
      console.warn('[OpenAIService] Warning: OPENAI_API_KEY is not set.');
    }
  }

  async streamChat(request: ChatStreamRequest, res: Response): Promise<void> {
    const apiKey = cleanEnvVar(process.env.OPENAI_API_KEY);

    if (!apiKey) {
      await this.mockStream(request, res, 'OpenAI (API Key missing - Mock Stream Mode)');
      return;
    }

    try {
      if (!this.client) {
        this.client = new OpenAI({ apiKey });
      }

      const modelName = request.model.includes('mini') ? 'gpt-4o-mini' : 'gpt-4o';

      const stream = await this.client.chat.completions.create({
        model: modelName,
        messages: request.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        stream: true,
        temperature: request.temperature ?? 0.7,
      });

      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content || '';
        if (text) {
          const sanitizedText = text.replace(/^\uFEFF/, '');
          res.write(`data: ${JSON.stringify({ chunk: sanitizedText, done: false, model: request.model })}\n\n`);
        }
      }

      res.write(`data: ${JSON.stringify({ chunk: '', done: true, model: request.model })}\n\n`);
      res.end();
    } catch (error: any) {
      console.error('[OpenAIService] Error during streaming:', error);
      const cleanError = (error?.message || 'Unknown error').replace(/^\uFEFF/, '').replace(/[\uFEFF]/g, '');
      res.write(`data: ${JSON.stringify({ error: cleanError, done: true })}\n\n`);
      res.end();
    }
  }

  private async mockStream(request: ChatStreamRequest, res: Response, source: string): Promise<void> {
    const lastUserMessage = request.messages[request.messages.length - 1]?.content || 'Hello';
    const mockReply = `[${source}] Received prompt: "${lastUserMessage}". Streaming seamlessly via Express SSE multi-LLM router in OpenAI GPT mode (${request.model}).`;

    const tokens = mockReply.split(' ');
    for (const token of tokens) {
      res.write(`data: ${JSON.stringify({ chunk: token + ' ', done: false, model: request.model })}\n\n`);
      await new Promise((r) => setTimeout(r, 40));
    }
    res.write(`data: ${JSON.stringify({ chunk: '', done: true, model: request.model })}\n\n`);
    res.end();
  }
}

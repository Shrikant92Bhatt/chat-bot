import OpenAI from 'openai';
import { ChatStreamRequest } from '@chat-monorepo/shared';
import { Response } from 'express';

export class OpenAIService {
  private client: OpenAI | null = null;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      this.client = new OpenAI({ apiKey });
    } else {
      console.warn('[OpenAIService] Warning: OPENAI_API_KEY is not set.');
    }
  }

  async streamChat(request: ChatStreamRequest, res: Response): Promise<void> {
    const apiKey = process.env.OPENAI_API_KEY;

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
          res.write(`data: ${JSON.stringify({ chunk: text, done: false, model: request.model })}\n\n`);
        }
      }

      res.write(`data: ${JSON.stringify({ chunk: '', done: true, model: request.model })}\n\n`);
      res.end();
    } catch (error) {
      console.error('[OpenAIService] Error during streaming:', error);
      res.write(`data: ${JSON.stringify({ error: (error as Error).message, done: true })}\n\n`);
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

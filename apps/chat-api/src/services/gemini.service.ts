import { GoogleGenerativeAI, FunctionDeclarationsTool, Content } from '@google/generative-ai';
import { ChatStreamRequest } from '@chat-monorepo/shared';
import { Response } from 'express';
import { McpAdapter } from '../adapters/mcp.adapter';
import { generateFollowUpSuggestions } from './suggestions.service';

function cleanEnvVar(val?: string): string {
  if (!val) return '';
  return val.replace(/^\uFEFF/, '').replace(/\r/g, '').trim();
}

export class GeminiService {
  private genAI: GoogleGenerativeAI | null = null;
  private mcpAdapter = new McpAdapter();

  constructor() {
    const apiKey = cleanEnvVar(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
    } else {
      console.warn('[GeminiService] Warning: GEMINI_API_KEY is not set.');
    }
  }

  async streamChat(request: ChatStreamRequest, res: Response): Promise<void> {
    const apiKey = cleanEnvVar(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);

    if (!apiKey) {
      await this.mockStream(request, res, 'Gemini (API Key missing - Mock Stream Mode)');
      return;
    }

    try {
      if (!this.genAI) {
        this.genAI = new GoogleGenerativeAI(apiKey);
      }

      const modelName = request.model.includes('pro') ? 'gemini-pro-latest' : 'gemini-flash-latest';

      let tools: FunctionDeclarationsTool[] | undefined;
      if (request.mcpEnabled) {
        const functionDeclarations = await this.mcpAdapter.getGeminiFunctionDeclarations();
        tools = [{ functionDeclarations }];
      }

      const model = this.genAI.getGenerativeModel({ model: modelName, tools });

      const contents: Content[] = request.messages.map((msg) => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      }));

      let fullResponseText = '';

      const streamingResult = await model.generateContentStream({ contents });
      const pendingFunctionCallPart = await this.streamTextAndCaptureFunctionCall(streamingResult.stream, res, request.model, (t) => (fullResponseText += t));

      // v1 scope: at most one tool round-trip per turn, not an unbounded
      // agent loop - execute it, feed the result back, stream the model's
      // final natural-language reply.
      if (pendingFunctionCallPart) {
        const fnCall = pendingFunctionCallPart.functionCall as { name: string; args: object };

        res.write(
          `data: ${JSON.stringify({
            toolCall: { name: fnCall.name, args: fnCall.args },
            chunk: '',
            done: false,
            model: request.model,
          })}\n\n`
        );

        const toolResult = await this.mcpAdapter.executeTool(fnCall.name, fnCall.args as Record<string, any>);

        const followUpContents: Content[] = [
          ...contents,
          // Echo the model's function-call part back VERBATIM (not just
          // {name, args}) - it carries a thoughtSignature field the SDK's
          // typed FunctionCall/functionCalls() helper silently drops, and
          // the live API 400s ("Function call is missing a
          // thought_signature") if it's not echoed back on this turn.
          { role: 'model', parts: [pendingFunctionCallPart] },
          // The live API also rejects role: 'function' for this SDK/model
          // version ("Role 'function' is not supported... valid role: ...
          // MODEL, USER") despite that being the documented convention -
          // 'user' is what it actually accepts for a function-response turn.
          {
            role: 'user',
            parts: [{ functionResponse: { name: fnCall.name, response: { result: toolResult } } }],
          },
        ];

        const followUpStream = await model.generateContentStream({ contents: followUpContents });
        await this.streamTextAndCaptureFunctionCall(followUpStream.stream, res, request.model, (t) => (fullResponseText += t));
      }

      const suggestions = await generateFollowUpSuggestions(request.messages, fullResponseText);

      res.write(`data: ${JSON.stringify({ chunk: '', done: true, model: request.model, suggestions })}\n\n`);
      res.end();
    } catch (error: any) {
      console.error('[GeminiService] Error during streaming:', error);
      const cleanError = (error?.message || 'Unknown error').replace(/^\uFEFF/, '').replace(/[\uFEFF]/g, '');
      res.write(`data: ${JSON.stringify({ error: cleanError, done: true })}\n\n`);
      res.end();
    }
  }

  /**
   * Streams text chunks straight to the client. If the model emits a
   * function call instead of/alongside text, returns its raw `part` object
   * (only the first - v1 handles one tool call per turn) instead of
   * streaming it as text. Deliberately walks chunk.candidates[].content.parts
   * directly rather than using the SDK's chunk.functionCalls() helper,
   * which only returns {name, args} - the live API also attaches a
   * thoughtSignature field as a sibling of functionCall on the part itself,
   * which the caller needs to echo back verbatim on the follow-up turn.
   */
  private async streamTextAndCaptureFunctionCall(
    stream: AsyncGenerator<any>,
    res: Response,
    requestModel: ChatStreamRequest['model'],
    onText: (text: string) => void
  ): Promise<any | undefined> {
    let pendingFunctionCallPart: any | undefined;

    for await (const chunk of stream) {
      if (!pendingFunctionCallPart) {
        const parts: any[] | undefined = chunk.candidates?.[0]?.content?.parts;
        pendingFunctionCallPart = parts?.find((p) => p.functionCall);
        if (pendingFunctionCallPart) continue;
      }

      const text = chunk.text();
      if (text) {
        onText(text);
        const sanitizedText = text.replace(/^\uFEFF/, '');
        res.write(`data: ${JSON.stringify({ chunk: sanitizedText, done: false, model: requestModel })}\n\n`);
      }
    }

    return pendingFunctionCallPart;
  }

  private async mockStream(request: ChatStreamRequest, res: Response, source: string): Promise<void> {
    const lastUserMessage = request.messages[request.messages.length - 1]?.content || 'Hello';
    const mockReply = `[${source}] Received prompt: "${lastUserMessage}". High-performance response streaming from Gemini (${request.model}).`;

    const tokens = mockReply.split(' ');
    for (const token of tokens) {
      res.write(`data: ${JSON.stringify({ chunk: token + ' ', done: false, model: request.model })}\n\n`);
      await new Promise((r) => setTimeout(r, 40));
    }

    const suggestions = await generateFollowUpSuggestions(request.messages, mockReply);
    res.write(`data: ${JSON.stringify({ chunk: '', done: true, model: request.model, suggestions })}\n\n`);
    res.end();
  }
}

import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { generateImage } from '../llm/image-gen';

/**
 * Evaluates a restricted arithmetic expression (digits, + - * / ( ) . and
 * whitespace only) without invoking eval() on arbitrary input.
 */
function safeEvaluateArithmetic(expression: string): number {
  if (!/^[\d\s+\-*/().]+$/.test(expression)) {
    throw new Error('Expression contains unsupported characters.');
  }
  // eslint-disable-next-line no-new-func
  const result = Function(`"use strict"; return (${expression});`)();
  if (typeof result !== 'number' || !Number.isFinite(result)) {
    throw new Error('Expression did not evaluate to a finite number.');
  }
  return result;
}

const calculatorTool = tool(
  async ({ expression }: { expression: string }) => {
    const result = safeEvaluateArithmetic(expression);
    return JSON.stringify({ expression, result });
  },
  {
    name: 'system_calculator',
    description: 'Evaluates a mathematical arithmetic expression (+, -, *, /, parentheses) and returns the numeric result.',
    schema: z.object({
      expression: z.string().describe('The arithmetic expression to evaluate, e.g. "(3 + 4) * 2"'),
    }),
  }
);

const webSearchTool = tool(
  async ({ query }: { query: string }) => {
    // No search provider is configured (e.g. Tavily/Bing/SerpAPI). Report
    // this plainly instead of fabricating results the model would present
    // as real.
    console.warn(`[mcp/tools] web_search called for "${query}" but no search provider is configured.`);
    return JSON.stringify({
      available: false,
      message: 'Web search is not configured on this deployment. No live results are available.',
    });
  },
  {
    name: 'web_search',
    description: 'Searches the web for real-time information. Returns an "unavailable" result if no search provider is configured.',
    schema: z.object({
      query: z.string().describe('The search query.'),
    }),
  }
);

const codeInterpreterTool = tool(
  async ({ code }: { code: string }) => {
    console.warn('[mcp/tools] code_interpreter called but no sandboxed execution environment is configured.');
    return JSON.stringify({
      available: false,
      message: 'Code execution is not configured on this deployment.',
      submittedLength: code.length,
    });
  },
  {
    name: 'code_interpreter',
    description: 'Executes a code snippet in a sandboxed environment. Returns an "unavailable" result if no sandbox is configured.',
    schema: z.object({
      code: z.string().describe('The code to execute.'),
    }),
  }
);

const generateImageTool = tool(
  async ({ prompt }: { prompt: string }) => {
    try {
      const { imageUrl } = await generateImage(prompt);
      return JSON.stringify({ success: true, imageUrl, prompt });
    } catch (error) {
      console.error('[mcp/tools] generate_image failed:', error);
      return JSON.stringify({ success: false, error: (error as Error).message });
    }
  },
  {
    name: 'generate_image',
    description: 'Generates an image from a text prompt and returns its URL.',
    schema: z.object({
      prompt: z.string().describe('The text prompt describing the desired image.'),
    }),
  }
);

export const MCP_TOOLS = [calculatorTool, webSearchTool, codeInterpreterTool, generateImageTool];

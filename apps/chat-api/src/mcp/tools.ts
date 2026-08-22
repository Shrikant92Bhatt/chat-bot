import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { generateImage } from '../llm/image-gen';
import { performWebSearch } from '../llm/web-search';
import { getWeather } from '../llm/weather';
import { getStockQuote } from '../llm/stock';
import { executeSandboxedCode } from '../tools/code-sandbox';

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
    try {
      const { answer, citations } = await performWebSearch(query);
      return JSON.stringify({ available: true, answer, citations });
    } catch (error) {
      console.error(`[mcp/tools] web_search failed for "${query}":`, error);
      return JSON.stringify({ available: false, message: (error as Error).message });
    }
  },
  {
    name: 'web_search',
    description: 'Searches the web for real-time, current information (e.g. weather, news, prices, recent events) and returns a grounded answer with sources.',
    schema: z.object({
      query: z.string().describe('The search query.'),
    }),
  }
);

const codeInterpreterTool = tool(
  async ({ code, language }: { code: string; language?: 'javascript' | 'typescript' }) => {
    try {
      const result = await executeSandboxedCode(code, { language: language ?? 'javascript' });
      return JSON.stringify(result);
    } catch (error) {
      // executeSandboxedCode already catches its own failures and returns a
      // structured result; this only fires on a truly unexpected error
      // (e.g. the isolate itself couldn't be constructed).
      console.error('[mcp/tools] code_interpreter failed unexpectedly:', error);
      return JSON.stringify({
        success: false,
        stdout: '',
        stderr: '',
        result: null,
        error: (error as Error).message,
        exitReason: 'runtime_error',
        durationMs: 0,
      });
    }
  },
  {
    name: 'code_interpreter',
    description:
      'Executes a JavaScript or TypeScript snippet in an isolated, resource-limited sandbox (no filesystem or network access, memory and timeout limits enforced) and returns its console output and return value. Wrap the snippet body as if it were a function: use `return <value>;` to get a result back.',
    schema: z.object({
      code: z.string().describe('The JavaScript or TypeScript code to execute. Use `return <value>;` to produce a result.'),
      language: z
        .enum(['javascript', 'typescript'])
        .optional()
        .describe('The language of the snippet. Defaults to "javascript".'),
    }),
  }
);

const weatherTool = tool(
  async ({ location }: { location: string }) => {
    try {
      const weather = await getWeather(location);
      return JSON.stringify({ success: true, ...weather });
    } catch (error) {
      console.error(`[mcp/tools] get_weather failed for "${location}":`, error);
      return JSON.stringify({ success: false, error: (error as Error).message });
    }
  },
  {
    name: 'get_weather',
    description:
      'Gets the current weather and 5-day forecast for a location, as exact structured data (temperature, ' +
      'humidity, wind speed, conditions) - not a summarized description. Prefer this over web_search for ' +
      'any weather question, and use its output directly for a WEATHER_CARD.',
    schema: z.object({
      location: z.string().describe('The place name, e.g. "Pune" or "London, UK".'),
    }),
  }
);

const stockQuoteTool = tool(
  async ({ symbol }: { symbol: string }) => {
    try {
      const quote = await getStockQuote(symbol);
      return JSON.stringify({ success: true, ...quote });
    } catch (error) {
      console.error(`[mcp/tools] get_stock_quote failed for "${symbol}":`, error);
      return JSON.stringify({ success: false, error: (error as Error).message });
    }
  },
  {
    name: 'get_stock_quote',
    description:
      'Gets the current price and change for a stock ticker symbol, as exact structured data (price, change, ' +
      'change percent, currency) - not a summarized description. Prefer this over web_search for any stock ' +
      'price question, and use its output directly for a STOCK_CARD.',
    schema: z.object({
      symbol: z.string().describe('The ticker symbol, e.g. "AAPL" or "TSLA".'),
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

export const MCP_TOOLS = [calculatorTool, webSearchTool, weatherTool, stockQuoteTool, codeInterpreterTool, generateImageTool];

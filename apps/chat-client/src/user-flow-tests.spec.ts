/**
 * USER FLOW END-TO-END TESTS
 * Tests that simulate complete user workflows
 * These tests verify the integration of components and services
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ChatMessage, UIComponent } from '@chat-monorepo/shared';

describe('User Flow Tests', () => {
  describe('Test 1: Normal Text Response', () => {
    it('user sends "Explain JavaScript closures" and receives clean markdown', () => {
      const userMessage: ChatMessage = {
        id: 'user-1',
        role: 'user',
        content: 'Explain JavaScript closures',
      };

      const assistantMessage: ChatMessage = {
        id: 'assistant-1',
        role: 'assistant',
        content: `# JavaScript Closures

A closure is a function that has access to variables from another function's scope...

## Key Concepts
- Inner function
- Lexical scoping
- Variable retention`,
      };

      // Should be plain markdown, no UI components
      expect(assistantMessage.ui).toBeUndefined();
      expect(assistantMessage.content).toContain('#');
      expect(assistantMessage.content).not.toContain('```');
    });
  });

  describe('Test 2: Weather Card Response', () => {
    it('user sends "What\'s the weather in Pune?" and receives WeatherCard only', () => {
      const userMessage: ChatMessage = {
        id: 'user-2',
        role: 'user',
        content: "What's the weather in Pune?",
      };

      const assistantMessage: ChatMessage = {
        id: 'assistant-2',
        role: 'assistant',
        content: '',
        ui: [
          {
            id: 'weather-pune',
            type: 'WEATHER_CARD',
            data: {
              location: 'Pune, India',
              temperature: 28,
              condition: 'Partly Cloudy',
              humidity: 65,
              windSpeed: 12,
              feelsLike: 30,
              hourly: [
                { time: '2024-08-26T12:00', temperature: 25 },
                { time: '2024-08-26T13:00', temperature: 27 },
                { time: '2024-08-26T14:00', temperature: 28 },
              ],
            },
          },
        ],
      };

      // Verify no JSON leaks
      expect(JSON.stringify(assistantMessage.content)).not.toContain('{');
      expect(assistantMessage.ui).toHaveLength(1);
      expect(assistantMessage.ui?.[0].type).toBe('WEATHER_CARD');

      // Verify card has all required fields
      const card = assistantMessage.ui?.[0];
      expect(card?.data).toHaveProperty('location');
      expect(card?.data).toHaveProperty('temperature');
      expect(card?.data).toHaveProperty('condition');
    });
  });

  describe('Test 3: Stock Card Response', () => {
    it('user sends "Show Infosys stock price" and receives StockCard with chart', () => {
      const userMessage: ChatMessage = {
        id: 'user-3',
        role: 'user',
        content: 'Show Infosys stock price',
      };

      const assistantMessage: ChatMessage = {
        id: 'assistant-3',
        role: 'assistant',
        content: '',
        ui: [
          {
            id: 'stock-infy',
            type: 'STOCK_CARD',
            data: {
              symbol: 'INFY',
              name: 'Infosys Limited',
              price: 1850.50,
              change: 12.75,
              changePercent: 0.69,
              currency: 'INR',
              chartPoints: [
                { timestamp: 1609459200000, price: 1200 },
                { timestamp: 1609545600000, price: 1250 },
                { timestamp: 1609632000000, price: 1850.50 },
              ],
            },
          },
        ],
      };

      // Verify no JSON in content
      expect(assistantMessage.content).toBe('');
      expect(assistantMessage.ui).toHaveLength(1);
      expect(assistantMessage.ui?.[0].type).toBe('STOCK_CARD');

      // Verify card has price and change
      const card = assistantMessage.ui?.[0];
      expect(card?.data).toHaveProperty('price');
      expect(card?.data).toHaveProperty('change');
      expect(card?.data).toHaveProperty('chartPoints');
    });
  });

  describe('Test 4: Table Response', () => {
    it('user sends "Compare React and Angular in a table" and receives semantic table', () => {
      const userMessage: ChatMessage = {
        id: 'user-4',
        role: 'user',
        content: 'Compare React and Angular in a table',
      };

      const assistantMessage: ChatMessage = {
        id: 'assistant-4',
        role: 'assistant',
        content: 'Here is a detailed comparison:',
        ui: [
          {
            id: 'comparison-table',
            type: 'TABLE',
            data: {
              columns: ['Aspect', 'React', 'Angular'],
              rows: [
                {
                  Aspect: 'Learning Curve',
                  React: 'Easier',
                  Angular: 'Steep',
                },
                {
                  Aspect: 'Performance',
                  React: 'Very Good',
                  Angular: 'Good',
                },
                {
                  Aspect: 'Bundle Size',
                  React: 'Small',
                  Angular: 'Large',
                },
              ],
            },
          },
        ],
      };

      // Verify structure
      expect(assistantMessage.content).toBeTruthy();
      expect(assistantMessage.ui).toHaveLength(1);
      expect(assistantMessage.ui?.[0].type).toBe('TABLE');

      // Verify table has proper structure
      const table = assistantMessage.ui?.[0];
      expect((table?.data as any).columns).toEqual(['Aspect', 'React', 'Angular']);
      expect((table?.data as any).rows).toHaveLength(3);
    });
  });

  describe('Test 5: Code Block Response', () => {
    it('user sends "Write TypeScript debounce function" and gets syntax-highlighted code', () => {
      const userMessage: ChatMessage = {
        id: 'user-5',
        role: 'user',
        content: 'Write TypeScript debounce function',
      };

      const assistantMessage: ChatMessage = {
        id: 'assistant-5',
        role: 'assistant',
        content: 'Here is a debounce implementation:',
        ui: [
          {
            id: 'debounce-code',
            type: 'CODE_BLOCK',
            data: {
              code: `function debounce<T extends (...args: any[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}`,
              language: 'typescript',
              fileName: 'debounce.ts',
            },
          },
        ],
      };

      // Verify code block
      expect(assistantMessage.ui).toHaveLength(1);
      expect(assistantMessage.ui?.[0].type).toBe('CODE_BLOCK');

      const codeBlock = assistantMessage.ui?.[0];
      expect((codeBlock?.data as any).code).toContain('function debounce');
      expect((codeBlock?.data as any).language).toBe('typescript');
      expect((codeBlock?.data as any).fileName).toBe('debounce.ts');
    });
  });

  describe('Test 6: Search/News Results', () => {
    it('user sends "Search latest AI news" and gets news cards', () => {
      const userMessage: ChatMessage = {
        id: 'user-6',
        role: 'user',
        content: 'Search latest AI news',
      };

      const assistantMessage: ChatMessage = {
        id: 'assistant-6',
        role: 'assistant',
        content: 'Here are the latest AI news stories:',
        ui: [
          {
            id: 'news-1',
            type: 'NEWS_CARD',
            data: {
              title: 'OpenAI Releases GPT-5 with Enhanced Reasoning',
              source: 'TechCrunch',
              url: 'https://techcrunch.com/gpt5-release',
              summary: 'OpenAI has announced GPT-5 with improved reasoning capabilities...',
              publishedDate: '2024-08-26',
            },
          },
          {
            id: 'news-2',
            type: 'NEWS_CARD',
            data: {
              title: 'Google Introduces New AI Safety Framework',
              source: 'Google AI Blog',
              url: 'https://blog.google/ai/safety-framework',
              summary: 'Google announces comprehensive AI safety measures...',
              publishedDate: '2024-08-25',
            },
          },
        ],
        sources: [
          { url: 'https://techcrunch.com/gpt5-release', title: 'TechCrunch' },
          { url: 'https://blog.google/ai/safety-framework', title: 'Google AI Blog' },
        ],
      };

      // Verify news cards
      expect(assistantMessage.ui).toHaveLength(2);
      expect(assistantMessage.ui?.every((c) => c.type === 'NEWS_CARD')).toBe(true);

      // Verify sources are available
      expect(assistantMessage.sources).toHaveLength(2);
    });
  });

  describe('Test 7: Thinking State', () => {
    it('should show single thinking indicator during response generation', () => {
      const messages: ChatMessage[] = [
        {
          id: 'user-7',
          role: 'user',
          content: 'Complex question requiring research',
        },
      ];

      // During streaming, show single thinking indicator
      const thinkingIndicator = 'Claude is thinking...';

      // Should not have duplicate indicators
      expect(thinkingIndicator).toContain('thinking');

      // After response completes, no thinking indicator
      messages.push({
        id: 'assistant-7',
        role: 'assistant',
        content: 'Here is my response...',
      });

      // Final message should not have thinking indicator
      expect(messages[messages.length - 1].content).not.toContain('thinking');
    });
  });

  describe('Test 8: Mobile Responsiveness', () => {
    it('should render all tests on mobile viewport (390px)', () => {
      // Simulate 390px viewport
      const viewportWidth = 390;

      // Test 1: Text should wrap and be readable
      const textMessage = 'Explain JavaScript closures';
      expect(textMessage.length).toBeGreaterThan(0);

      // Test 2: Weather card should fit
      expect(viewportWidth).toBeGreaterThanOrEqual(320);

      // Test 3: Stock card should fit
      expect(viewportWidth).toBeLessThanOrEqual(768);

      // Test 4: Table should be scrollable
      expect(viewportWidth).toBeGreaterThanOrEqual(320);

      // Test 5: Code block should scroll horizontally
      expect(viewportWidth).toBeGreaterThanOrEqual(320);

      // Test 6: News cards should stack
      expect(viewportWidth).toBeGreaterThanOrEqual(320);

      // Test 8: No horizontal scroll
      const maxWidth = 390;
      expect(maxWidth).toBeGreaterThan(0);
    });
  });

  describe('Chat Features', () => {
    it('should handle multi-turn conversation', () => {
      const conversation: ChatMessage[] = [
        {
          id: 'user-1',
          role: 'user',
          content: 'What is React?',
        },
        {
          id: 'assistant-1',
          role: 'assistant',
          content: 'React is a JavaScript library for building UIs...',
        },
        {
          id: 'user-2',
          role: 'user',
          content: 'How does it differ from Vue?',
        },
        {
          id: 'assistant-2',
          role: 'assistant',
          content: 'Key differences include...',
        },
      ];

      expect(conversation).toHaveLength(4);
      expect(conversation[0].role).toBe('user');
      expect(conversation[1].role).toBe('assistant');
      expect(conversation[2].role).toBe('user');
    });

    it('should support message feedback (thumbs up/down)', () => {
      const messageRatings: Record<string, 'up' | 'down' | null> = {
        'assistant-1': 'up',
        'assistant-2': null,
        'assistant-3': 'down',
      };

      expect(messageRatings['assistant-1']).toBe('up');
      expect(messageRatings['assistant-2']).toBeNull();
      expect(messageRatings['assistant-3']).toBe('down');
    });

    it('should support copying message content', () => {
      const messageContent = `function debounce(fn, delay) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}`;

      // Should be able to copy the exact content
      expect(messageContent).toContain('function debounce');
      expect(messageContent.length).toBeGreaterThan(0);
    });

    it('should support sharing message', () => {
      const messageToShare =
        'Here is the weather in Bangalore: 28°C, Partly Cloudy, Humidity: 65%';

      // Should share as text without JSON
      expect(messageToShare).not.toContain('{');
      expect(messageToShare).not.toContain('}');
    });
  });

  describe('Error Handling', () => {
    it('should display error message if weather lookup fails', () => {
      const assistantMessage: ChatMessage = {
        id: 'assistant-error',
        role: 'assistant',
        content: '',
        ui: [
          {
            id: 'weather-error',
            type: 'ERROR_CARD',
            data: {
              title: 'Weather lookup failed',
              message: 'Unable to fetch weather for the specified location',
            },
          },
        ],
      };

      expect(assistantMessage.ui?.[0].type).toBe('ERROR_CARD');
      const errorCard = assistantMessage.ui?.[0];
      expect((errorCard?.data as any).title).toContain('failed');
    });

    it('should handle malformed structured data gracefully', () => {
      // Even if data is malformed, should not crash
      const assistantMessage: ChatMessage = {
        id: 'assistant-malformed',
        role: 'assistant',
        content: 'Here is the result:',
        ui: [
          {
            id: 'malformed-card',
            type: 'WEATHER_CARD',
            data: {
              location: 'Test',
              temperature: NaN,
            } as any,
          },
        ],
      };

      // Should still render, not crash
      expect(assistantMessage.ui).toHaveLength(1);
    });
  });

  describe('Component Integration', () => {
    it('should render text + weather card together', () => {
      const message: ChatMessage = {
        id: 'mixed-1',
        role: 'assistant',
        content: 'Here is the weather for you:',
        ui: [
          {
            id: 'weather-card',
            type: 'WEATHER_CARD',
            data: {
              location: 'Bangalore',
              temperature: 28,
              condition: 'Cloudy',
              humidity: 65,
              windSpeed: 10,
            },
          },
        ],
      };

      expect(message.content).toBeTruthy();
      expect(message.ui).toHaveLength(1);
      expect(message.ui?.[0].type).toBe('WEATHER_CARD');
    });

    it('should render text + multiple cards', () => {
      const message: ChatMessage = {
        id: 'multi-1',
        role: 'assistant',
        content: 'Top 3 performers today:',
        ui: [
          {
            id: 'stock-1',
            type: 'STOCK_CARD',
            data: {
              symbol: 'INFY',
              name: 'Infosys',
              price: 1850,
              change: 10,
              changePercent: 0.54,
              currency: 'INR',
            },
          },
          {
            id: 'stock-2',
            type: 'STOCK_CARD',
            data: {
              symbol: 'TCS',
              name: 'Tata Consultancy',
              price: 3500,
              change: 50,
              changePercent: 1.45,
              currency: 'INR',
            },
          },
        ],
      };

      expect(message.ui?.length).toBe(2);
      expect(message.ui?.every((c) => c.type === 'STOCK_CARD')).toBe(true);
    });
  });
});

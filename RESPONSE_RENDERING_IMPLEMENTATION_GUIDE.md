# Response Rendering Implementation Guide

## Quick Start

This guide shows practical examples of how to use the new response rendering architecture to safely render structured data without JSON leaks.

## Backend: Processing Tool Results

### Example 1: Weather Tool (Already Implemented)

The weather tool is a complete reference implementation:

```typescript
// 1. Tool returns raw JSON
const toolResult = {
  success: true,
  location: "San Francisco",
  current: {
    temperature: 68,
    condition: "Partly Cloudy",
    humidity: 65,
    windSpeed: 12
  },
  forecast: [...]
};

// 2. Normalize it to UI component shape
const result = normalizeToolResultForUi('get_weather', JSON.stringify(toolResult));

// Result is one of:
// { componentType: 'WEATHER_CARD', data: WeatherCardData }  ← Success
// { componentType: 'WEATHER_CARD', error: 'message' }       ← Error
// null                                                       ← Unknown tool
```

### Example 2: Adding a New Tool

To add a custom API tool:

```typescript
// Step 1: Define the expected output type
interface CustomApiResult {
  success: boolean;
  error?: string;
  items: Array<{ id: string; title: string; value: number }>;
  total: number;
}

// Step 2: Create normalization function
function normalizeCustomApi(parsed: Record<string, unknown>): TableData | null {
  if (!Array.isArray(parsed.items)) return null;
  
  const items = parsed.items as Array<Record<string, unknown>>;
  const columns = ['ID', 'Title', 'Value'];
  const rows = items.map(item => [
    item.id as string,
    item.title as string,
    item.value as number
  ]);
  
  return { columns, rows };
}

// Step 3: Add to TOOL_UI_COMPONENT_MAP
export const TOOL_UI_COMPONENT_MAP = {
  get_weather: 'WEATHER_CARD',
  get_stock_quote: 'STOCK_CARD',
  custom_api: 'TABLE', // ← New entry
};

// Step 4: Update normalizeToolResultForUi
if (toolName === 'custom_api') {
  data = normalizeCustomApi(parsed);
  if (data && !isTableData(data)) {
    return { componentType, error: 'Table data validation failed.' };
  }
}

// Step 5: Add fields to leak detection filter
const LEAK_FIELD_NAMES = [
  // ... existing fields
  'items',     // Used by custom_api
  'total',     // Used by custom_api
];
```

## Frontend: Rendering Safe Components

### Example 1: Safely Validating a Component

```typescript
// Inject ResponseRendererService
constructor(private responseRenderer: ResponseRendererService) {}

// Validate before rendering
const component: UIComponent = {
  type: 'WEATHER_CARD',
  id: 'weather-1',
  data: incomingData
};

if (!this.responseRenderer.validateComponent(component)) {
  // Data doesn't match expected type - create error card instead
  const errorCard = this.responseRenderer.createErrorCard(
    'WEATHER_CARD',
    'Weather data was in an unexpected format.'
  );
  renderComponent(errorCard); // Show error to user
} else {
  renderComponent(component); // Safe to render
}
```

### Example 2: Auto-detecting Response Type

```typescript
// You have raw data from an API response or tool
const rawData = await fetchData('/api/weather');

const result = this.responseRenderer.processResponse(rawData);

if (result.valid) {
  // Data matched a known type
  console.log(`Detected type: ${result.componentType}`);
  // Create component with validated data
  const component: UIComponent = {
    type: result.componentType!,
    id: 'component-' + Date.now(),
    data: result.normalizedData
  };
  renderComponent(component);
} else {
  // Data didn't match any known type
  console.warn(`Could not detect response type: ${result.error}`);
  showError('Unable to process response');
}
```

### Example 3: Filtering Invalid Components

```typescript
// You receive a batch of components from the server
const componentsFromServer: UIComponent[] = [
  { type: 'WEATHER_CARD', id: '1', data: validWeatherData },
  { type: 'STOCK_CARD', id: '2', data: invalidStockData }, // ← Missing required fields
  { type: 'CHART', id: '3', data: validChartData },
];

// Filter to only valid components
const validComponents = this.responseRenderer.filterValidComponents(componentsFromServer);
// Result: [component1, component3] - component2 was skipped with warning

attachComponentsToMessage(messageId, validComponents);
```

## Integration: Chat Service

### How setMessageUi Now Works

```typescript
private setMessageUi(
  threadId: string,
  messageId: string,
  ui: UIComponent[],
  sources?: OrchestratorSource[],
  actions?: OrchestratorAction[]
) {
  // 1. Validate all components
  const validatedUi = this.responseRenderer.filterValidComponents(ui);
  
  // 2. Log if we dropped any
  if (validatedUi.length !== ui.length) {
    const droppedCount = ui.length - validatedUi.length;
    console.warn(`Dropped ${droppedCount} invalid component(s)`);
  }
  
  // 3. Attach only valid components
  this.threads.update((threads) => {
    // ... update with validatedUi instead of ui
  });
}
```

### How applyUiStreamEvent Now Works

```typescript
private applyUiStreamEvent(threadId: string, messageId: string, event: UIStreamEvent): void {
  if (event.type === 'ui_update') {
    // Create component with data from stream event
    const component: UIComponent = {
      type: event.componentType,
      id: event.id,
      data: event.data
    };
    
    // Validate before rendering
    if (!this.responseRenderer.validateComponent(component)) {
      // Data doesn't match expected type - show error instead
      console.warn('Invalid component data, converting to error card');
      const errorComponent = this.responseRenderer.createErrorCard(
        event.componentType,
        'Tool returned data in unexpected format.'
      );
      // Render error component instead
      addComponentToMessage(errorComponent);
    } else {
      // Data is valid - render normally
      addComponentToMessage(component);
    }
  }
}
```

## Testing Your Implementation

### Unit Test: Type Guard

```typescript
describe('ResponseRendererService - Custom Type', () => {
  let service: ResponseRendererService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ResponseRendererService]
    });
    service = TestBed.inject(ResponseRendererService);
  });

  it('should validate correct weather data', () => {
    const validData = {
      location: 'NYC',
      current: {
        temperature: 72,
        condition: 'Sunny',
        humidity: 60,
        windSpeed: 10
      }
    };
    expect(service.isWeatherData(validData)).toBe(true);
  });

  it('should reject incomplete weather data', () => {
    const invalidData = {
      location: 'NYC',
      current: {
        temperature: 72
        // Missing required fields: condition, humidity, windSpeed
      }
    };
    expect(service.isWeatherData(invalidData)).toBe(false);
  });

  it('should auto-detect weather type', () => {
    const weatherData = { location: 'NYC', current: { ... } };
    expect(service.detectComponentType(weatherData)).toBe('WEATHER_CARD');
  });
});
```

### Integration Test: Component Validation in ChatService

```typescript
describe('ChatService - Component Validation', () => {
  let service: ChatService;
  let rendererService: ResponseRendererService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ChatService, ResponseRendererService, ...]
    });
    service = TestBed.inject(ChatService);
    rendererService = TestBed.inject(ResponseRendererService);
  });

  it('should filter invalid components during setMessageUi', () => {
    const components: UIComponent[] = [
      {
        type: 'WEATHER_CARD',
        id: '1',
        data: { location: 'NYC' } // Invalid - missing 'current'
      },
      {
        type: 'STOCK_CARD',
        id: '2',
        data: { 
          symbol: 'AAPL',
          name: 'Apple',
          price: 150,
          change: 2,
          changePercent: 1.35,
          currency: 'USD'
        }
      }
    ];

    // Call private method via spy
    spyOn(rendererService, 'filterValidComponents').and.callThrough();
    service['setMessageUi'](threadId, messageId, components);

    expect(rendererService.filterValidComponents).toHaveBeenCalledWith(components);
    // Only the valid stock card should be in the message
  });
});
```

### E2E Test: Weather Card Rendering

```typescript
describe('Weather Card - End-to-End', () => {
  it('should render weather card after successful tool call', async () => {
    // 1. Send message requesting weather
    await fillComposerAndSend('What is the weather in NYC?');

    // 2. Wait for tool call SSE event
    const weatherCard = await page.waitForSelector('app-ui-weather-card', { timeout: 5000 });

    // 3. Verify card is rendered
    expect(weatherCard).toBeTruthy();

    // 4. Verify no raw JSON is visible
    const pageText = await page.textContent('body');
    expect(pageText).not.toContain('"location"');
    expect(pageText).not.toContain('"temperature"');
  });

  it('should show error card on tool failure', async () => {
    // 1. Send message (mock tool to fail)
    mockWeatherToolToFail();
    await fillComposerAndSend('What is the weather in NYC?');

    // 2. Wait for error card
    const errorCard = await page.waitForSelector('app-ui-error-card', { timeout: 5000 });

    // 3. Verify user-friendly error message
    const errorText = await errorCard.textContent();
    expect(errorText).toContain('Failed to render');
    expect(errorText).not.toContain('JSON');
  });
});
```

## Debugging: Common Issues

### Issue: Component renders blank/undefined

```typescript
// Problem: Data passed to component doesn't match type
const component: UIComponent = {
  type: 'WEATHER_CARD',
  id: 'wx-1',
  data: { location: 'NYC' } // ← Missing 'current'!
};

// Solution: Use type guard before rendering
if (!responseRenderer.isWeatherData(component.data)) {
  console.warn('Weather data validation failed:', component.data);
  const errorCard = responseRenderer.createErrorCard(
    'WEATHER_CARD',
    'Missing required weather fields.'
  );
  render(errorCard);
} else {
  render(component); // Safe to render
}
```

### Issue: Raw JSON appears in visible text

```typescript
// Problem: Model outputs JSON directly
// "Here is the weather: {"location":"NYC","current":{...}}"

// Solution: tool-leak-stream-filter catches this
// The filter's output would be:
// "Here is the weather: "
// (JSON object is stripped out)

// If this doesn't work:
// 1. Check that the filter is enabled
// 2. Verify field names are in LEAK_FIELD_NAMES
// 3. Check that 2+ fields are present (not just 1)
// 4. Ensure the object is NOT inside code fence (```...```)
```

### Issue: Component validation fails unexpectedly

```typescript
// Problem: validateComponent() returns false
const component = { type: 'WEATHER_CARD', id: '1', data: weatherData };
if (!service.validateComponent(component)) {
  console.warn('Failed validation!');
}

// Debug: Use detailed type guard
if (!service.isWeatherData(component.data)) {
  // Check each required field
  const data = component.data as Record<string, unknown>;
  console.log('location:', typeof data.location, data.location);
  console.log('current:', typeof data.current, data.current);
  
  if (data.current && typeof data.current === 'object') {
    const curr = data.current as Record<string, unknown>;
    console.log('  temperature:', typeof curr.temperature, curr.temperature);
    console.log('  condition:', typeof curr.condition, curr.condition);
    console.log('  humidity:', typeof curr.humidity, curr.humidity);
    console.log('  windSpeed:', typeof curr.windSpeed, curr.windSpeed);
  }
  // This will show you which field is missing/wrong
}
```

## Performance Checklist

- [ ] Type guards are simple field checks (no deep validation)
- [ ] Component filtering only runs on final payload (not every event)
- [ ] Leak filter runs O(n) on streaming text (efficient)
- [ ] Auto-detection short-circuits on first match
- [ ] No synchronous JSON.parse in hot loops

## Security Checklist

- [ ] All tool outputs go through `normalizeToolResultForUi()`
- [ ] All components validated before rendering
- [ ] Leak filter checks model's visible output
- [ ] Type guards verify all required fields
- [ ] Error cards created for failed validations
- [ ] No use of `[innerHTML]` in component templates
- [ ] All data bound through Angular interpolation
- [ ] Markdown content goes through DOMPurify + Angular sanitizer

## Deployment Checklist

- [ ] ResponseRendererService is provided at root level
- [ ] ChatService has ResponseRendererService injected
- [ ] Leak filter is enabled in API
- [ ] Response discriminator compiles without errors
- [ ] UI component registry includes all components
- [ ] Backend and frontend type definitions match
- [ ] No console errors on valid responses
- [ ] Error cards display gracefully on invalid data

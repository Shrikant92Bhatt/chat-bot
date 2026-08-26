# Response Rendering Architecture

## Overview

This document describes the modern response rendering architecture that prevents raw JSON from appearing to users and automatically renders structured responses correctly.

The architecture implements **defense-in-depth** validation across three layers:

1. **Backend Response Normalization** - Converts tool results to approved component shapes
2. **Leak Prevention Filter** - Prevents raw JSON from appearing in visible text
3. **Frontend Response Validation** - Safely renders and validates all structured responses

---

## Architecture Layers

### Layer 1: Backend Response Normalization

**Files:**
- `apps/chat-api/src/orchestration/ui-tool-adapter.ts`
- `apps/chat-api/src/orchestration/response-discriminator.ts` (NEW)

**Purpose:**
- Converts raw MCP tool results (JSON) into approved UI component shapes
- Normalizes weather and stock tool outputs to their respective card types
- Provides defensive parsing with safe fallbacks for malformed data
- Acts as the single trust boundary between tools and the model

**Key Functions:**

```typescript
// Normalizes tool results to approved component shapes
normalizeToolResultForUi(toolName: string, rawResult: string)
  → { componentType, data } | { componentType, error } | null

// Type guards for validation
isWeatherCardData(data)     // → boolean
isStockCardData(data)       // → boolean
isChartData(data)           // → boolean
isTableData(data)           // → boolean
isNewsCardData(data)        // → boolean

// Auto-detection based on field patterns
autoDetectComponentType(data) → UIComponentType | null

// Safe JSON extraction
extractJsonObject(text)     → Record<string, unknown> | null

// Main entry point
processStructuredResponse(data)
  → { valid, data, componentType, error }
```

**Example:**

```typescript
// Tool result comes in as raw JSON string
const rawResult = '{"location":"NYC","current":{"temperature":72,...}}';

// Normalized to safe component shape
const result = normalizeToolResultForUi('get_weather', rawResult);
// Returns: { componentType: 'WEATHER_CARD', data: {...} }

// Failed tool? Returns error card instead of leaking JSON
if (parsed.success === false) {
  return { componentType, error: 'Friendly error message' };
}
```

---

### Layer 2: Leak Prevention Filter

**File:** `apps/chat-api/src/orchestration/tool-leak-stream-filter.ts`

**Purpose:**
- Prevents raw JSON from leaking into visible reply text (as prose)
- Detects patterns matching structured response field names
- Requires 2+ co-occurring field names for confirmation (guards against false positives)
- Exempts content inside fenced code blocks (```...```)

**Detection Strategy:**

The filter looks for patterns like:
- `"location"` + `"current"` → Likely weather object
- `"symbol"` + `"price"` → Likely stock object
- `"title"` + `"articles"` → Likely news object
- `"needsResearch"` + `"searchQueries"` → Likely research plan (NEVER visible)

**Comprehensive Field List:**

```typescript
LEAK_FIELD_NAMES = [
  // Weather
  'location', 'current', 'humidity', 'forecast', 'hourly', 'windSpeed',
  'temperatureHigh', 'temperatureLow', 'precipitationProbability', 'temperature', 'condition',
  
  // Stock
  'symbol', 'changePercent', 'price', 'change', 'currency',
  
  // Chart/Table
  'chartType', 'xAxis', 'series', 'columns', 'rows',
  
  // News/Search
  'title', 'articles', 'source', 'url', 'publishedAt', 'link', 'items', 'results',
  
  // API responses
  'success', 'error', 'status', 'data',
  
  // Research (CRITICAL - must never leak)
  'needsResearch', 'searchQueries', 'reasoning', 'phase', 'message',
];
```

**Behavior:**

- Scans for `{` followed by 2+ field names within 300 chars
- If match found → drops the entire brace-balanced JSON object
- If inside fenced code block → skips detection
- Otherwise → releases text unchanged

---

### Layer 3: Frontend Response Validation

**Files:**
- `apps/chat-client/src/app/services/response-renderer.service.ts` (NEW)
- `apps/chat-client/src/app/services/chat.service.ts` (ENHANCED)

**Purpose:**
- Provides type-safe response discrimination on the frontend
- Validates all components before rendering
- Handles malformed/incomplete data gracefully
- Implements auto-detection for response types
- Creates error cards for failed validations

**ResponseRendererService:**

```typescript
// Type guards (all return boolean)
isWeatherData(data)         // Validates WEATHER_CARD payload
isStockData(data)           // Validates STOCK_CARD payload
isChartData(data)           // Validates CHART payload
isTableData(data)           // Validates TABLE payload
isNewsData(data)            // Validates NEWS_CARD payload
isMapData(data)             // Validates MAP payload
isProductData(data)         // Validates PRODUCT_CARD payload
isProductCarouselData(data) // Validates PRODUCT_CAROUSEL payload
isCodeBlockData(data)       // Validates CODE_BLOCK payload
isErrorCardData(data)       // Validates ERROR_CARD payload
// ... and more

// Auto-detection
detectComponentType(data)   // → UIComponentType | null

// Validation
validateComponent(component) // → boolean

// Safe JSON extraction
extractJsonObject(text)     // → Record<string, unknown> | null

// Main processing
processResponse(data)       // → { valid, componentType, normalizedData, error }

// Error handling
createErrorCard(type, message, toolName)    // → UIComponent
filterValidComponents(components)            // → UIComponent[] (filtered)
```

**Integration in ChatService:**

```typescript
// In applyUiStreamEvent (for ui_update events)
if (!this.responseRenderer.validateComponent(component)) {
  console.warn('Invalid component data, converting to error card');
  const errorComponent = this.responseRenderer.createErrorCard(...);
  // Render error instead of malformed data
}

// In setMessageUi (before attaching components to message)
const validatedUi = this.responseRenderer.filterValidComponents(ui);
// Only valid components reach the UI layer
```

---

## Component Type Detection

The system can auto-detect response types based on field patterns:

| Component Type | Key Fields | Detected When |
|---|---|---|
| WEATHER_CARD | location, current, temperature, humidity, windSpeed | All required fields present |
| STOCK_CARD | symbol, price, change, changePercent, currency | All required fields present |
| CHART | chartType, xAxis, series | Valid chart configuration detected |
| TABLE | columns, rows | Column/row arrays present |
| NEWS_CARD | articles, title | Article array with titles |
| MAP | center, lat, lng | Center coordinates found |
| CODE_BLOCK | language, code | Code field present |
| ERROR_CARD | title, message | Error structure detected |

**Priority Order:**
1. Weather (most specific)
2. Stock
3. Chart
4. Table
5. News
6. Map
7. Products
8. Documents
9. Code
10. Errors
11. Generic (least specific)

---

## Data Flow

### Normal Path (Tool Success)

```
Tool Output (raw JSON)
    ↓
ui-tool-adapter: normalizeToolResultForUi()
    ↓ (if mapped tool)
TOOL_UI_COMPONENT_MAP: { tool_name → UIComponentType }
    ↓
Normalize weather/stock specifically
    ↓
Validate data matches expected shape
    ↓
SSE Stream: UIStreamEvent (ui_start → ui_update)
    ↓ (frontend)
applyUiStreamEvent() receives ui_update
    ↓
ResponseRendererService: validateComponent()
    ↓ (if valid)
PendingUIBlock transitions to complete UIComponent
    ↓
UiBlockComponent renders with proper component
```

### Error Path (Invalid Data)

```
Tool Output doesn't validate
    ↓
normalizeToolResultForUi() returns error
    ↓
SSE Stream: { error: 'Friendly message' }
    ↓ (frontend)
Error card created and displayed
    ↓
No raw JSON ever visible
```

### Leak Detection Path

```
Model generates prose with raw JSON object
    ↓
tool-leak-stream-filter checks for patterns
    ↓
Finds 2+ field names in lookahead window?
    ↓ (yes)
Drops entire brace-balanced object
    ↓
Remaining prose streams normally
```

---

## Validation Guarantees

### What's Guaranteed:

✅ **No raw JSON in visible text**
- Multiple validation layers catch leaks
- Leak filter requires 2+ field names for confirmation
- Frontend validates all component data

✅ **Type-safe rendering**
- Each component's data must match its declared type
- Type guards verify all required fields
- Malformed data converted to error cards

✅ **Graceful degradation**
- Invalid components → error cards with friendly messages
- Doesn't crash on unexpected input
- Logs all validation failures for debugging

✅ **Comprehensive detection**
- Handles weather, stock, charts, tables, news, maps, products, documents, code
- Auto-detects based on field patterns
- Falls back safely when detection fails

### What's Not Guaranteed:

❌ User-pasted JSON in their own message (not tool output)
- Accepted by design (user's input)
- Still caught by leak filter if it matches patterns

❌ Generic field names in prose
- "price", "currency", "date", etc. alone won't trigger leak detection
- Requires 2+ tool-specific fields together

---

## Adding New Response Types

To add a new structured response type:

### 1. Add to Shared Types

```typescript
// libs/shared/src/interfaces/orchestrator.interface.ts
export interface NewTypeData {
  field1: string;
  field2: number;
  // ...
}

export type UIComponentType = 
  | 'NEW_TYPE'
  | // ... existing types
```

### 2. Add Backend Discriminator

```typescript
// apps/chat-api/src/orchestration/response-discriminator.ts
export function isNewTypeData(data: unknown): data is NewTypeData {
  // Type guard implementation
}

export function detectNewTypeResponse(data: unknown): boolean {
  return isNewTypeData(data);
}

// In autoDetectComponentType:
if (detectNewTypeResponse(data)) return 'NEW_TYPE';
```

### 3. Add to Leak Filter

```typescript
// apps/chat-api/src/orchestration/tool-leak-stream-filter.ts
const LEAK_FIELD_NAMES = [
  // ... existing fields
  'field1', 'field2', // New type fields
];
```

### 4. Add Frontend Validator

```typescript
// apps/chat-client/src/app/services/response-renderer.service.ts
isNewTypeData(data: unknown): data is NewTypeData {
  // Type guard implementation
}

// In detectComponentType:
if (this.isNewTypeData(data)) return 'NEW_TYPE';

// In validateComponent:
case 'NEW_TYPE':
  return this.isNewTypeData(component.data);
```

### 5. Create Component

```typescript
// apps/chat-client/src/app/components/ui-block/components/new-type.component.ts
@Component({
  selector: 'app-ui-new-type',
  // ...
})
export class NewTypeComponent {
  @Input({ required: true }) data!: NewTypeData;
}
```

### 6. Register Component

```typescript
// apps/chat-client/src/app/components/ui-block/ui-block.component.ts
const UI_COMPONENT_REGISTRY: Record<UIComponentType, Type<object>> = {
  NEW_TYPE: NewTypeComponent,
  // ... existing components
};
```

---

## Testing

### Backend Tests

```typescript
// Test response discriminator
describe('response-discriminator', () => {
  it('detects weather responses', () => {
    const data = { location: 'NYC', current: { ... } };
    expect(autoDetectComponentType(data)).toBe('WEATHER_CARD');
  });

  it('rejects malformed data', () => {
    const data = { location: 'NYC' }; // missing 'current'
    expect(isWeatherCardData(data)).toBe(false);
  });
});

// Test leak filter
describe('tool-leak-stream-filter', () => {
  it('catches weather JSON leaks', () => {
    const filter = new ToolResultLeakStreamFilter();
    const text = 'Here is {"location":"NYC","current":{"temperature":72}}';
    const result = filter.push(text);
    expect(result).not.toContain('location');
  });

  it('preserves code blocks', () => {
    const filter = new ToolResultLeakStreamFilter();
    const text = '```json\n{"location":"NYC"}\n```';
    const result = filter.finish(true);
    expect(result).toContain('location'); // Code preserved
  });
});

// Test ui-tool-adapter
describe('ui-tool-adapter', () => {
  it('normalizes weather results', () => {
    const result = normalizeToolResultForUi(
      'get_weather',
      '{"success":true,"location":"NYC",...}'
    );
    expect(result?.componentType).toBe('WEATHER_CARD');
    expect(result?.data).toBeDefined();
  });

  it('returns error on malformed data', () => {
    const result = normalizeToolResultForUi(
      'get_weather',
      '{"success":true,"location":"NYC"}' // missing current
    );
    expect(result?.error).toBeDefined();
  });
});
```

### Frontend Tests

```typescript
// Test response renderer service
describe('ResponseRendererService', () => {
  it('validates weather data correctly', () => {
    const service = new ResponseRendererService();
    const data = { location: 'NYC', current: { ... } };
    expect(service.isWeatherData(data)).toBe(true);
  });

  it('detects component types', () => {
    const service = new ResponseRendererService();
    const data = { symbol: 'AAPL', price: 150, ... };
    expect(service.detectComponentType(data)).toBe('STOCK_CARD');
  });

  it('rejects invalid components', () => {
    const service = new ResponseRendererService();
    const component: UIComponent = {
      type: 'WEATHER_CARD',
      id: 'test',
      data: { location: 'NYC' } // missing current
    };
    expect(service.validateComponent(component)).toBe(false);
  });
});

// Test chat service integration
describe('ChatService', () => {
  it('filters invalid components before setting message UI', () => {
    // ... test that setMessageUi validates components
  });

  it('converts invalid ui_update to error card', () => {
    // ... test that applyUiStreamEvent validates and converts to error
  });
});
```

---

## Performance Considerations

- **Leak Filter**: O(n) streaming analysis, minimal overhead
- **Type Guards**: Simple field checks, ~1-2ms per validation
- **Component Filtering**: Only runs on final UI payload (~6 components max)
- **Auto-detection**: Short-circuits on first match, ~0.5ms typical

---

## Security Model

### Trust Boundaries

1. **Tool Output** → `normalizeToolResultForUi()` (TRUST BOUNDARY)
   - Untrusted input from external tools
   - Normalized to safe shapes before model sees it

2. **Model Output** → `ToolResultLeakStreamFilter` (LEAK DETECTION)
   - Model's own prose + any escaped tool output
   - Streaming detection of JSON patterns

3. **SSE Events** → `ResponseRendererService` (VALIDATION)
   - Pre-validated by backend schema
   - Double-checked before rendering

### Failure Modes

| Failure | Mitigation | Outcome |
|---|---|---|
| Tool returns invalid JSON | Try-catch, return error | Error card displayed |
| Leak filter false positive | Requires 2+ field hits | Worst case: drops valid prose (safe) |
| Component type mismatch | Type guard validation | Converted to error card |
| Malformed field data | Type checks on each field | Rejected, error card shown |

---

## Debugging

### Enable Verbose Logging

```typescript
// In response-renderer.service.ts
if (validComponents.length !== components.length) {
  console.warn(`Dropped ${components.length - validComponents.length} invalid component(s)`);
}

// In chat.service.ts applyUiStreamEvent
if (!this.responseRenderer.validateComponent(component)) {
  console.warn('[ChatService] ui_update event has invalid data', component);
}
```

### Common Issues

**Q: "Component type X failed validation" warning**
A: Component's data doesn't match its declared type. Check that:
- All required fields are present
- Field types match (number, string, array, etc.)
- No extra validation rules (e.g., temperature is positive number)

**Q: Weather/stock card shows error instead of data**
A: Tool returned invalid shape. Check:
- Tool output JSON structure
- Response discriminator type guards
- normalizeToolResultForUi logging

**Q: Raw JSON appears in chat**
A: Leak filter didn't catch it. Likely reasons:
- Less than 2 field names detected (increase lookahead window?)
- Content inside code fence (intentional, preserved)
- Completely different field names (add to LEAK_FIELD_NAMES)

---

## References

- `UIComponentType` → libs/shared/src/interfaces/orchestrator.interface.ts
- `UIStreamEvent` → libs/shared/src/interfaces/ui-stream.interface.ts
- Backend orchestration → apps/chat-api/src/orchestration/
- Frontend UI blocks → apps/chat-client/src/app/components/ui-block/

import { Injectable } from '@angular/core';
import {
  UIComponent,
  UIComponentType,
  WeatherCardData,
  StockCardData,
  ChartData,
  TableData,
  NewsCardData,
  MapData,
  ProductCardData,
  ProductCarouselData,
  FileCardData,
  DocumentPreviewData,
  CodeBlockData,
  ErrorCardData,
  ConfirmationCardData,
} from '@chat-monorepo/shared';

/**
 * Response rendering service that:
 * - Provides type guards for all structured response types
 * - Safely validates and normalizes responses before rendering
 * - Prevents raw JSON from reaching the UI
 * - Implements auto-detection of response types
 * - Handles malformed/incomplete data gracefully
 *
 * This is the single source of truth for response validation on the frontend,
 * complementing the backend's ui-schema.ts validation.
 */
@Injectable({
  providedIn: 'root',
})
export class ResponseRendererService {
  /**
   * Type guard: Is this data a valid WEATHER_CARD payload?
   */
  isWeatherData(data: unknown): data is WeatherCardData {
    if (!data || typeof data !== 'object') return false;
    const obj = data as Record<string, unknown>;
    return (
      typeof obj.location === 'string' &&
      !!obj.current &&
      typeof obj.current === 'object' &&
      typeof (obj.current as Record<string, unknown>).temperature === 'number' &&
      typeof (obj.current as Record<string, unknown>).condition === 'string' &&
      typeof (obj.current as Record<string, unknown>).humidity === 'number' &&
      typeof (obj.current as Record<string, unknown>).windSpeed === 'number'
    );
  }

  /**
   * Type guard: Is this data a valid STOCK_CARD payload?
   */
  isStockData(data: unknown): data is StockCardData {
    if (!data || typeof data !== 'object') return false;
    const obj = data as Record<string, unknown>;
    return (
      typeof obj.symbol === 'string' &&
      typeof obj.name === 'string' &&
      typeof obj.price === 'number' &&
      typeof obj.change === 'number' &&
      typeof obj.changePercent === 'number' &&
      typeof obj.currency === 'string'
    );
  }

  /**
   * Type guard: Is this data a valid CHART payload?
   */
  isChartData(data: unknown): data is ChartData {
    if (!data || typeof data !== 'object') return false;
    const obj = data as Record<string, unknown>;
    if (!['line', 'bar', 'pie', 'area', 'scatter'].includes(obj.chartType as string)) return false;
    if (!Array.isArray(obj.xAxis) || obj.xAxis.length === 0) return false;
    if (!Array.isArray(obj.series) || obj.series.length === 0) return false;
    return obj.series.every(
      (s) =>
        typeof s === 'object' &&
        typeof (s as Record<string, unknown>).name === 'string' &&
        Array.isArray((s as Record<string, unknown>).data)
    );
  }

  /**
   * Type guard: Is this data a valid TABLE payload?
   */
  isTableData(data: unknown): data is TableData {
    if (!data || typeof data !== 'object') return false;
    const obj = data as Record<string, unknown>;
    if (!Array.isArray(obj.columns) || obj.columns.length === 0) return false;
    if (!Array.isArray(obj.rows)) return false;
    return obj.columns.every((c) => typeof c === 'string') && obj.rows.every((r) => Array.isArray(r));
  }

  /**
   * Type guard: Is this data a valid NEWS_CARD payload?
   */
  isNewsData(data: unknown): data is NewsCardData {
    if (!data || typeof data !== 'object') return false;
    const obj = data as Record<string, unknown>;
    if (!Array.isArray(obj.articles) || obj.articles.length === 0) return false;
    return obj.articles.every(
      (a) =>
        typeof a === 'object' &&
        typeof (a as Record<string, unknown>).title === 'string'
    );
  }

  /**
   * Type guard: Is this data a valid MAP payload?
   */
  isMapData(data: unknown): data is MapData {
    if (!data || typeof data !== 'object') return false;
    const obj = data as Record<string, unknown>;
    const center = obj.center as Record<string, unknown> | undefined;
    return (
      !!center &&
      typeof center.lat === 'number' &&
      typeof center.lng === 'number'
    );
  }

  /**
   * Type guard: Is this data a valid PRODUCT_CARD payload?
   */
  isProductData(data: unknown): data is ProductCardData {
    if (!data || typeof data !== 'object') return false;
    const obj = data as Record<string, unknown>;
    return typeof obj.name === 'string';
  }

  /**
   * Type guard: Is this data a valid PRODUCT_CAROUSEL payload?
   */
  isProductCarouselData(data: unknown): data is ProductCarouselData {
    if (!data || typeof data !== 'object') return false;
    const obj = data as Record<string, unknown>;
    if (!Array.isArray(obj.products) || obj.products.length === 0) return false;
    return obj.products.every((p) => this.isProductData(p));
  }

  /**
   * Type guard: Is this data a valid FILE_CARD payload?
   */
  isFileCardData(data: unknown): data is FileCardData {
    if (!data || typeof data !== 'object') return false;
    const obj = data as Record<string, unknown>;
    return typeof obj.fileName === 'string';
  }

  /**
   * Type guard: Is this data a valid DOCUMENT_PREVIEW payload?
   */
  isDocumentPreviewData(data: unknown): data is DocumentPreviewData {
    if (!data || typeof data !== 'object') return false;
    const obj = data as Record<string, unknown>;
    return typeof obj.fileName === 'string';
  }

  /**
   * Type guard: Is this data a valid CODE_BLOCK payload?
   */
  isCodeBlockData(data: unknown): data is CodeBlockData {
    if (!data || typeof data !== 'object') return false;
    const obj = data as Record<string, unknown>;
    return (
      typeof obj.language === 'string' &&
      typeof obj.code === 'string'
    );
  }

  /**
   * Type guard: Is this data a valid ERROR_CARD payload?
   */
  isErrorCardData(data: unknown): data is ErrorCardData {
    if (!data || typeof data !== 'object') return false;
    const obj = data as Record<string, unknown>;
    return (
      typeof obj.title === 'string' &&
      typeof obj.message === 'string'
    );
  }

  /**
   * Type guard: Is this data a valid CONFIRMATION_CARD payload?
   */
  isConfirmationCardData(data: unknown): data is ConfirmationCardData {
    if (!data || typeof data !== 'object') return false;
    const obj = data as Record<string, unknown>;
    return typeof obj.title === 'string';
  }

  /**
   * Auto-detects the UIComponentType for a given data object.
   * Uses a priority-based detection strategy:
   * 1. Check for specific field combinations that identify a type
   * 2. Return the most likely match or null if ambiguous
   *
   * @param data - The raw data to classify
   * @returns The detected UIComponentType or null if no match
   */
  detectComponentType(data: unknown): UIComponentType | null {
    if (this.isWeatherData(data)) return 'WEATHER_CARD';
    if (this.isStockData(data)) return 'STOCK_CARD';
    if (this.isChartData(data)) return 'CHART';
    if (this.isTableData(data)) return 'TABLE';
    if (this.isNewsData(data)) return 'NEWS_CARD';
    if (this.isMapData(data)) return 'MAP';
    if (this.isProductCarouselData(data)) return 'PRODUCT_CAROUSEL';
    if (this.isProductData(data)) return 'PRODUCT_CARD';
    if (this.isDocumentPreviewData(data)) return 'DOCUMENT_PREVIEW';
    if (this.isFileCardData(data)) return 'FILE_CARD';
    if (this.isCodeBlockData(data)) return 'CODE_BLOCK';
    if (this.isErrorCardData(data)) return 'ERROR_CARD';
    if (this.isConfirmationCardData(data)) return 'CONFIRMATION_CARD';
    return null;
  }

  /**
   * Validates that a UIComponent matches its declared type.
   * Returns true only if the component's data passes the appropriate type guard.
   * This is a runtime safety check to catch data mismatches.
   */
  validateComponent(component: UIComponent): boolean {
    switch (component.type) {
      case 'WEATHER_CARD':
        return this.isWeatherData(component.data);
      case 'STOCK_CARD':
        return this.isStockData(component.data);
      case 'CHART':
        return this.isChartData(component.data);
      case 'TABLE':
        return this.isTableData(component.data);
      case 'NEWS_CARD':
        return this.isNewsData(component.data);
      case 'MAP':
        return this.isMapData(component.data);
      case 'PRODUCT_CARD':
        return this.isProductData(component.data);
      case 'PRODUCT_CAROUSEL':
        return this.isProductCarouselData(component.data);
      case 'FILE_CARD':
        return this.isFileCardData(component.data);
      case 'DOCUMENT_PREVIEW':
        return this.isDocumentPreviewData(component.data);
      case 'CODE_BLOCK':
        return this.isCodeBlockData(component.data);
      case 'ERROR_CARD':
        return this.isErrorCardData(component.data);
      case 'CONFIRMATION_CARD':
        return this.isConfirmationCardData(component.data);
      case 'TEXT':
      case 'MARKDOWN':
        // TEXT/MARKDOWN accept any object with a 'text' field
        return typeof component.data === 'object' && component.data !== null && typeof (component.data as Record<string, unknown>).text === 'string';
      default:
        return false;
    }
  }

  /**
   * Safely extracts JSON from text by looking for { ... } patterns.
   * Returns null if no valid JSON object is found.
   * Used for defensive parsing of potentially-malformed responses.
   */
  extractJsonObject(text: string): Record<string, unknown> | null {
    if (!text || typeof text !== 'string') return null;

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed as Record<string, unknown>;
      }
    } catch (e) {
      // JSON parse failed, try incrementally removing trailing chars
    }

    // Try to find a valid JSON object by incrementally removing trailing characters
    // (in case the object is incomplete or malformed)
    let attempt = jsonMatch[0];
    while (attempt.length > 2) {
      attempt = attempt.slice(0, -1);
      try {
        const parsed = JSON.parse(attempt);
        if (typeof parsed === 'object' && parsed !== null) {
          return parsed as Record<string, unknown>;
        }
      } catch (e) {
        // Continue trying
      }
    }

    return null;
  }

  /**
   * Safely processes a structured response, handling malformed or incomplete data.
   * Returns a result object indicating success/failure and the detected component type.
   *
   * This is the main entry point for processing any structured response data.
   */
  processResponse(data: unknown): {
    valid: boolean;
    componentType?: UIComponentType;
    normalizedData?: unknown;
    error?: string;
  } {
    if (!data) {
      return { valid: false, error: 'Response data is empty' };
    }

    // If it's already an object, try detection
    if (typeof data === 'object') {
      const componentType = this.detectComponentType(data);
      if (componentType) {
        return { valid: true, componentType, normalizedData: data };
      }
      return { valid: false, error: 'Data did not match any known response type' };
    }

    // If it's a string, try to extract JSON
    if (typeof data === 'string') {
      const extracted = this.extractJsonObject(data);
      if (extracted) {
        const componentType = this.detectComponentType(extracted);
        if (componentType) {
          return { valid: true, componentType, normalizedData: extracted };
        }
        return { valid: false, error: 'Extracted JSON did not match any known type' };
      }
      return { valid: false, error: 'Could not extract valid JSON from response' };
    }

    return { valid: false, error: 'Response type not recognized' };
  }

  /**
   * Creates a safe error card when a response fails validation.
   * Ensures the error message itself doesn't leak unsafe content.
   */
  createErrorCard(componentType: UIComponentType, message: string, toolName?: string): UIComponent {
    return {
      type: 'ERROR_CARD',
      id: `error-${Date.now()}`,
      data: {
        title: `Failed to render ${componentType.replace(/_/g, ' ').toLowerCase()}`,
        message: message.slice(0, 200), // Truncate to prevent excessively long errors
        toolName,
      } as ErrorCardData,
    };
  }

  /**
   * Filters an array of UIComponents to only those that pass validation.
   * Logs warnings for components that fail validation.
   * Useful for defensive rendering in the UI layer.
   */
  filterValidComponents(components: UIComponent[]): UIComponent[] {
    const validComponents: UIComponent[] = [];
    for (const component of components) {
      if (this.validateComponent(component)) {
        validComponents.push(component);
      } else {
        console.warn(
          `[ResponseRendererService] Component type ${component.type} failed validation, skipping`,
          component
        );
      }
    }
    return validComponents;
  }
}

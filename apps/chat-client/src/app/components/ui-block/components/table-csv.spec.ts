import { describe, it, expect } from 'vitest';
import { TableData } from '@chat-monorepo/shared';
import { detectNumericColumns, escapeCsvField, isNumericCell, tableDataToCsv, tableDataToTsv } from './table-csv';

describe('escapeCsvField', () => {
  it('leaves a plain field untouched', () => {
    expect(escapeCsvField('hello')).toBe('hello');
  });

  it('leaves an empty field untouched', () => {
    expect(escapeCsvField('')).toBe('');
  });

  it('quotes a field containing a comma', () => {
    expect(escapeCsvField('Acme, Inc.')).toBe('"Acme, Inc."');
  });

  it('quotes a field containing a double quote and doubles the embedded quote', () => {
    expect(escapeCsvField('12" monitor')).toBe('"12"" monitor"');
  });

  it('quotes a field containing an embedded newline', () => {
    expect(escapeCsvField('line one\nline two')).toBe('"line one\nline two"');
  });

  it('quotes a field containing an embedded carriage return', () => {
    expect(escapeCsvField('line one\rline two')).toBe('"line one\rline two"');
  });

  it('quotes and doubles quotes when a field has commas and quotes together', () => {
    expect(escapeCsvField('say "hi", please')).toBe('"say ""hi"", please"');
  });

  it('does not add quotes for a field with none of the special characters', () => {
    expect(escapeCsvField('42.50')).toBe('42.50');
  });
});

describe('isNumericCell', () => {
  it('treats a finite number as numeric', () => {
    expect(isNumericCell(42)).toBe(true);
    expect(isNumericCell(-3.5)).toBe(true);
    expect(isNumericCell(0)).toBe(true);
  });

  it('treats null as not numeric', () => {
    expect(isNumericCell(null)).toBe(false);
  });

  it('treats an empty or whitespace-only string as not numeric', () => {
    expect(isNumericCell('')).toBe(false);
    expect(isNumericCell('   ')).toBe(false);
  });

  it('treats plain numeric-looking strings as numeric', () => {
    expect(isNumericCell('42')).toBe(true);
    expect(isNumericCell('42.5')).toBe(true);
    expect(isNumericCell('-3.5')).toBe(true);
  });

  it('treats formatted numeric strings (currency, thousands separators, percent) as numeric', () => {
    expect(isNumericCell('$1,234.50')).toBe(true);
    expect(isNumericCell('12%')).toBe(true);
    expect(isNumericCell('(500)')).toBe(true);
  });

  it('treats a non-numeric string as not numeric', () => {
    expect(isNumericCell('Widget A')).toBe(false);
    expect(isNumericCell('N/A')).toBe(false);
  });
});

describe('detectNumericColumns', () => {
  it('flags a column whose values are all numbers', () => {
    const columns = ['name', 'price'];
    const rows: TableData['rows'] = [
      ['Widget', 9.99],
      ['Gadget', 19.99],
    ];
    expect(detectNumericColumns(columns, rows)).toEqual([false, true]);
  });

  it('flags a column that is majority numeric-looking strings', () => {
    const columns = ['label', 'amount'];
    const rows: TableData['rows'] = [
      ['Q1', '$1,000'],
      ['Q2', '$2,500'],
      ['Q3', null],
    ];
    expect(detectNumericColumns(columns, rows)).toEqual([false, true]);
  });

  it('does not flag a column that is majority non-numeric', () => {
    const columns = ['sku', 'note'];
    const rows: TableData['rows'] = [
      ['A1', 'in stock'],
      ['A2', 'backordered'],
      ['A3', '5'],
    ];
    expect(detectNumericColumns(columns, rows)).toEqual([false, false]);
  });

  it('does not flag an all-null column', () => {
    const columns = ['maybe'];
    const rows: TableData['rows'] = [[null], [null]];
    expect(detectNumericColumns(columns, rows)).toEqual([false]);
  });

  it('returns an empty array for an empty rows set', () => {
    expect(detectNumericColumns(['a', 'b'], [])).toEqual([false, false]);
  });
});

describe('tableDataToCsv', () => {
  it('serializes a simple table with a CRLF-joined header and rows', () => {
    const data: TableData = {
      columns: ['name', 'qty'],
      rows: [
        ['Widget', 3],
        ['Gadget', 5],
      ],
    };
    expect(tableDataToCsv(data)).toBe('name,qty\r\nWidget,3\r\nGadget,5');
  });

  it('renders a null cell as an empty field, not the display placeholder', () => {
    const data: TableData = { columns: ['a', 'b'], rows: [['x', null]] };
    expect(tableDataToCsv(data)).toBe('a,b\r\nx,');
  });

  it('escapes a cell containing a comma and a cell containing a quote in the same row', () => {
    const data: TableData = {
      columns: ['company', 'quote'],
      rows: [['Acme, Inc.', 'they said "great"']],
    };
    expect(tableDataToCsv(data)).toBe('company,quote\r\n"Acme, Inc.","they said ""great"""');
  });

  it('escapes a column header that itself needs quoting', () => {
    const data: TableData = { columns: ['name, full'], rows: [['x']] };
    expect(tableDataToCsv(data)).toBe('"name, full"\r\nx');
  });

  it('handles an empty rows array (header only)', () => {
    const data: TableData = { columns: ['a', 'b'], rows: [] };
    expect(tableDataToCsv(data)).toBe('a,b');
  });
});

describe('tableDataToTsv', () => {
  it('serializes a simple table as tab-separated, newline-joined rows', () => {
    const data: TableData = {
      columns: ['name', 'qty'],
      rows: [
        ['Widget', 3],
        ['Gadget', 5],
      ],
    };
    expect(tableDataToTsv(data)).toBe('name\tqty\nWidget\t3\nGadget\t5');
  });

  it('renders a null cell as an empty field', () => {
    const data: TableData = { columns: ['a', 'b'], rows: [['x', null]] };
    expect(tableDataToTsv(data)).toBe('a\tb\nx\t');
  });

  it('flattens an embedded tab or newline in a cell to a space instead of breaking alignment', () => {
    const data: TableData = { columns: ['a'], rows: [['line1\nline2\ttabbed']] };
    expect(tableDataToTsv(data)).toBe('a\nline1 line2 tabbed');
  });
});

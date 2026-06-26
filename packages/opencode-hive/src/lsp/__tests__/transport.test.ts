import { describe, test, expect, beforeEach, vi } from 'bun:test';
import { LspTransport } from '../transport.js';

describe('LspTransport', () => {
  let transport: LspTransport;

  beforeEach(() => {
    vi.clearAllMocks();
    transport = new LspTransport('/usr/bin/typescript-language-server', ['--stdio']);
  });

  test('initializes with correct properties', () => {
    expect(transport.serverPath).toBe('/usr/bin/typescript-language-server');
    expect(transport.args).toEqual(['--stdio']);
  });

  test('generates incrementing request IDs', () => {
    const id1 = transport.nextId();
    const id2 = transport.nextId();
    const id3 = transport.nextId();
    expect(id2).toBe(id1 + 1);
    expect(id3).toBe(id2 + 1);
  });

  test('formats JSON-RPC request message correctly', () => {
    const message = transport.formatRequest(1, 'initialize', { rootUri: 'file:///test' });
    const parsed = JSON.parse(message);

    expect(parsed).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { rootUri: 'file:///test' },
    });
  });

  test('formats JSON-RPC notification message correctly', () => {
    const message = transport.formatNotification('initialized', {});
    const parsed = JSON.parse(message);

    expect(parsed).toEqual({
      jsonrpc: '2.0',
      method: 'initialized',
      params: {},
    });
  });

  test('encodes message with Content-Length header', () => {
    const message = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}';
    const encoded = transport.encodeMessage(message);

    expect(encoded).toContain('Content-Length:');
    expect(encoded).toContain('\r\n\r\n');
    expect(encoded).toContain(message);
  });

  test('Content-Length matches actual byte length', () => {
    const body = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"rootUri":"file:///test"}}';
    const encoded = transport.encodeMessage(body);
    const match = encoded.match(/Content-Length:\s*(\d+)/);
    expect(match).not.toBeNull();
    const contentLength = parseInt(match![1], 10);
    expect(contentLength).toBe(Buffer.byteLength(body));
  });

  test('parses Content-Length correctly', () => {
    const body = '{"jsonrpc":"2.0","id":1,"result":{}}';
    const raw = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;

    const result = transport.parseRawMessage(raw);
    expect(result).toBe(body);
  });

  test('parseRawMessage returns null for incomplete message', () => {
    const result = transport.parseRawMessage('Content-Length: 100\r\n\r\n{"j');
    expect(result).toBeNull();
  });

  test('parseRawMessage returns null for header-only (no body yet)', () => {
    const result = transport.parseRawMessage('Content-Length: 50\r\n\r\n');
    expect(result).toBeNull();
  });

  test('parseRawMessage handles multiple messages in buffer', () => {
    const body1 = '{"jsonrpc":"2.0","id":1,"result":{}}';
    const body2 = '{"jsonrpc":"2.0","method":"textDocument/publishDiagnostics","params":{}}';
    const raw = `Content-Length: ${Buffer.byteLength(body1)}\r\n\r\n${body1}Content-Length: ${Buffer.byteLength(body2)}\r\n\r\n${body2}`;

    const result1 = transport.parseRawMessage(raw);
    expect(result1).toBe(body1);

    const remaining = raw.substring(raw.indexOf(body1) + body1.length);
    const result2 = transport.parseRawMessage(remaining);
    expect(result2).toBe(body2);
  });

  test('registerNotificationHandler stores handler', () => {
    const handler = vi.fn();
    transport.registerNotificationHandler('textDocument/publishDiagnostics', handler);
    expect(transport.getNotificationHandler('textDocument/publishDiagnostics')).toBe(handler);
  });

  test('getNotificationHandler returns null for unregistered method', () => {
    expect(transport.getNotificationHandler('unknown/method')).toBeNull();
  });

  test('close sets closed flag', () => {
    transport.closed = false;
    transport.close();
    expect(transport.closed).toBe(true);
  });

  test('close is idempotent', () => {
    transport.closed = false;
    transport.close();
    transport.close(); // Second call should not throw
    expect(transport.closed).toBe(true);
  });

  test('processDataBuffer dispatches responses to pending requests', async () => {
    const responsePromise = transport.resolveResponse(1);

    // Simulate server response
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { capabilities: {} } });
    const msg = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    transport.processDataBuffer(Buffer.from(msg));

    const result = await responsePromise;
    expect(result).toEqual({ capabilities: {} });
  });

  test('processDataBuffer rejects pending requests on error response', async () => {
    const responsePromise = transport.resolveResponse(1);

    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'Invalid Request' } });
    const msg = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    transport.processDataBuffer(Buffer.from(msg));

    try {
      await responsePromise;
      expect(true).toBe(false); // Should not reach
    } catch (err: any) {
      expect(err.message).toContain('Invalid Request');
    }
  });

  test('processDataBuffer dispatches notifications to registered handlers', () => {
    const handler = vi.fn();
    transport.registerNotificationHandler('textDocument/publishDiagnostics', handler);

    const params = { uri: 'file:///test.ts', diagnostics: [] };
    const body = JSON.stringify({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params });
    const msg = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    transport.processDataBuffer(Buffer.from(msg));

    expect(handler).toHaveBeenCalledWith(params);
  });

  test('processDataBuffer handles multiple messages in one chunk', () => {
    const handler = vi.fn();
    transport.registerNotificationHandler('textDocument/publishDiagnostics', handler);

    const params1 = { uri: 'file:///a.ts', diagnostics: [] };
    const params2 = { uri: 'file:///b.ts', diagnostics: [] };
    const body1 = JSON.stringify({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: params1 });
    const body2 = JSON.stringify({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: params2 });
    const combined = `Content-Length: ${Buffer.byteLength(body1)}\r\n\r\n${body1}Content-Length: ${Buffer.byteLength(body2)}\r\n\r\n${body2}`;

    transport.processDataBuffer(Buffer.from(combined));

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledWith(params1);
    expect(handler).toHaveBeenCalledWith(params2);
  });

  test('processDataBuffer ignores unknown notifications', () => {
    const body = JSON.stringify({ jsonrpc: '2.0', method: 'unknown/notification', params: {} });
    const msg = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    // Should not throw
    transport.processDataBuffer(Buffer.from(msg));
  });

  test('processDataBuffer handles response for unknown id gracefully', () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 999, result: {} });
    const msg = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    // Should not throw
    transport.processDataBuffer(Buffer.from(msg));
  });

  test('send throws when transport is closed', async () => {
    transport.closed = true;
    try {
      await transport.send('initialize', {});
      expect(true).toBe(false); // Should not reach
    } catch (err: any) {
      expect(err.message).toContain('closed');
    }
  });

  test('send throws when process is null', async () => {
    transport.process = null;
    transport.closed = false;
    try {
      await transport.send('initialize', {});
      expect(true).toBe(false); // Should not reach
    } catch (err: any) {
      expect(err.message).toContain('closed');
    }
  });
});

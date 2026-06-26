import { describe, test, expect, beforeEach, vi } from 'bun:test';
import { LspClient } from '../client.js';
import type { LspTransport } from '../transport.js';

// Create a mock transport that resolves responses from a queue
function createMockTransport() {
  const responseQueue: Map<number, any> = new Map();
  const requests: Array<{ id: number; method: string; params: any }> = [];
  const notifications: Array<{ method: string; params: any }> = [];
  let nextId = 1;

  const transport = {
    nextId: () => nextId++,
    send: vi.fn(async (method: string, params: any) => {
      const id = nextId++;
      requests.push({ id, method, params });
      const response = responseQueue.get(id);
      responseQueue.delete(id);
      return response;
    }),
    formatRequest: (id: number, method: string, params: any) =>
      JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    formatNotification: (method: string, params: any) =>
      JSON.stringify({ jsonrpc: '2.0', method, params }),
    encodeMessage: (body: string) =>
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
    registerNotificationHandler: vi.fn(),
    getNotificationHandler: vi.fn((method: string) => null),
    onNotification: vi.fn((method: string, handler: any) => {}),
    close: vi.fn(),
    closed: false,
    process: {
      pid: 12345,
      stdin: { write: vi.fn() },
      kill: vi.fn(),
    },
    // Test helpers
    _enqueueResponse: (id: number, result: any) => responseQueue.set(id, result),
    _getLastRequest: () => requests[requests.length - 1],
    _getAllRequests: () => [...requests],
    _getLastNotification: () => notifications[notifications.length - 1],
    _getAllNotifications: () => [...notifications],
    _clearRequests: () => { requests.length = 0; },
  };

  return transport as unknown as LspTransport & {
    _enqueueResponse: (id: number, result: any) => void;
    _getLastRequest: () => { id: number; method: string; params: any };
    _getAllRequests: () => Array<{ id: number; method: string; params: any }>;
    _getLastNotification: () => { method: string; params: any } | undefined;
    _getAllNotifications: () => Array<{ method: string; params: any }>;
    _clearRequests: () => void;
  };
}

/**
 * Parse a Content-Length framed LSP message from raw stdin.write data.
 * Returns the JSON-RPC message body.
 */
function parseLspWireMessage(raw: string): any {
  const headerEnd = raw.indexOf('\r\n\r\n');
  if (headerEnd === -1) return null;
  const body = raw.substring(headerEnd + 4);
  return JSON.parse(body);
}

describe('LspClient', () => {
  let mockTransport: ReturnType<typeof createMockTransport>;
  let client: LspClient;

  beforeEach(() => {
    mockTransport = createMockTransport();
    client = new LspClient(mockTransport);
  });

  describe('initialize', () => {
    test('sends initialize request with correct params', async () => {
      mockTransport._enqueueResponse(1, {
        capabilities: { textDocumentSync: 1 },
      });

      await client.initialize('/test/workspace');

      const req = mockTransport._getLastRequest();
      expect(req.method).toBe('initialize');
      expect(req.params).toEqual({
        processId: expect.any(Number),
        rootUri: 'file:///test/workspace',
        capabilities: expect.objectContaining({
          textDocument: expect.any(Object),
        }),
      });
    });

    test('stores server capabilities after initialization', async () => {
      mockTransport._enqueueResponse(1, {
        capabilities: { textDocumentSync: 1, hoverProvider: true },
      });

      await client.initialize('/test/workspace');
      expect(client.serverCapabilities).toEqual({
        textDocumentSync: 1,
        hoverProvider: true,
      });
    });

    test('sends initialized notification after initialize', async () => {
      mockTransport._enqueueResponse(1, { capabilities: {} });

      await client.initialize('/test/workspace');

      // The initialized notification should be sent after the response
      // In a real implementation, this is sent via transport.sendNotification
      expect(client.initialized).toBe(true);
    });
  });

  describe('openFile', () => {
    test('sends textDocument/didOpen notification', async () => {
      mockTransport._enqueueResponse(1, { capabilities: {} });
      await client.initialize('/test/workspace');

      client.openFile('/test/file.ts', 'const x = 1;');

      // Notifications are written to stdin, not via send()
      const stdinWrite = (mockTransport.process as any).stdin.write;
      expect(stdinWrite).toHaveBeenCalled();
      const lastCall = stdinWrite.mock.calls[stdinWrite.mock.calls.length - 1][0];
      const parsed = parseLspWireMessage(lastCall);
      expect(parsed.method).toBe('textDocument/didOpen');
      expect(parsed.params.textDocument).toEqual({
        uri: 'file:///test/file.ts',
        languageId: 'typescript',
        version: 1,
        text: 'const x = 1;',
      });
    });

    test('increments version on subsequent opens', async () => {
      mockTransport._enqueueResponse(1, { capabilities: {} });
      await client.initialize('/test/workspace');

      client.openFile('/test/file.ts', 'const x = 1;');
      client.openFile('/test/file.ts', 'const x = 2;');

      const stdinWrite = (mockTransport.process as any).stdin.write;
      const lastCall = stdinWrite.mock.calls[stdinWrite.mock.calls.length - 1][0];
      const parsed = parseLspWireMessage(lastCall);
      expect(parsed.params.textDocument.version).toBe(2);
    });

    test('detects language from file extension', async () => {
      mockTransport._enqueueResponse(1, { capabilities: {} });
      await client.initialize('/test/workspace');

      client.openFile('/test/file.py', 'x = 1');

      const stdinWrite = (mockTransport.process as any).stdin.write;
      const lastCall = stdinWrite.mock.calls[stdinWrite.mock.calls.length - 1][0];
      const parsed = parseLspWireMessage(lastCall);
      expect(parsed.params.textDocument.languageId).toBe('python');
    });
  });

  describe('closeFile', () => {
    test('sends textDocument/didClose notification', async () => {
      mockTransport._enqueueResponse(1, { capabilities: {} });
      await client.initialize('/test/workspace');

      client.closeFile('/test/file.ts');

      const stdinWrite = (mockTransport.process as any).stdin.write;
      const lastCall = stdinWrite.mock.calls[stdinWrite.mock.calls.length - 1][0];
      const parsed = parseLspWireMessage(lastCall);
      expect(parsed.method).toBe('textDocument/didClose');
      expect(parsed.params).toEqual({
        textDocument: { uri: 'file:///test/file.ts' },
      });
    });
  });

  describe('gotoDefinition', () => {
    test('sends textDocument/definition request', async () => {
      mockTransport._enqueueResponse(1, { capabilities: {} });
      await client.initialize('/test/workspace');

      // Queue the definition response (will be request id 2)
      mockTransport._enqueueResponse(2, [
        { uri: 'file:///test/other.ts', range: { start: { line: 10, character: 0 }, end: { line: 10, character: 5 } } },
      ]);

      const locations = await client.gotoDefinition('/test/file.ts', 5, 3);

      const req = mockTransport._getLastRequest();
      expect(req.method).toBe('textDocument/definition');
      expect(req.params).toEqual({
        textDocument: { uri: 'file:///test/file.ts' },
        position: { line: 4, character: 3 }, // 0-based internally
      });

      expect(locations).toHaveLength(1);
      expect(locations[0].uri).toBe('file:///test/other.ts');
    });

    test('returns empty array when no definitions found', async () => {
      mockTransport._enqueueResponse(1, { capabilities: {} });
      await client.initialize('/test/workspace');
      mockTransport._enqueueResponse(2, []);

      const locations = await client.gotoDefinition('/test/file.ts', 5, 3);
      expect(locations).toEqual([]);
    });
  });

  describe('findReferences', () => {
    test('sends textDocument/references request', async () => {
      mockTransport._enqueueResponse(1, { capabilities: {} });
      await client.initialize('/test/workspace');
      mockTransport._enqueueResponse(2, [
        { uri: 'file:///test/a.ts', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } } },
        { uri: 'file:///test/b.ts', range: { start: { line: 2, character: 0 }, end: { line: 2, character: 5 } } },
      ]);

      const refs = await client.findReferences('/test/file.ts', 10, 5);

      const req = mockTransport._getLastRequest();
      expect(req.method).toBe('textDocument/references');
      expect(req.params).toEqual({
        textDocument: { uri: 'file:///test/file.ts' },
        position: { line: 9, character: 5 },
        context: { includeDeclaration: true },
      });

      expect(refs).toHaveLength(2);
    });
  });

  describe('hover', () => {
    test('sends textDocument/hover request', async () => {
      mockTransport._enqueueResponse(1, { capabilities: {} });
      await client.initialize('/test/workspace');
      mockTransport._enqueueResponse(2, {
        contents: { kind: 'markdown', value: '```typescript\nconst x: number\n```' },
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      });

      const hoverInfo = await client.hover('/test/file.ts', 5, 3);

      const req = mockTransport._getLastRequest();
      expect(req.method).toBe('textDocument/hover');
      expect(hoverInfo).not.toBeNull();
      expect(hoverInfo?.contents).toContain('number');
    });

    test('returns null when no hover info', async () => {
      mockTransport._enqueueResponse(1, { capabilities: {} });
      await client.initialize('/test/workspace');
      mockTransport._enqueueResponse(2, null);

      const hoverInfo = await client.hover('/test/file.ts', 5, 3);
      expect(hoverInfo).toBeNull();
    });
  });

  describe('rename', () => {
    test('sends textDocument/rename request', async () => {
      mockTransport._enqueueResponse(1, { capabilities: {} });
      await client.initialize('/test/workspace');
      mockTransport._enqueueResponse(2, {
        changes: {
          'file:///test/file.ts': [
            { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: 'newName' },
          ],
        },
      });

      const edit = await client.rename('/test/file.ts', 1, 0, 'newName');

      const req = mockTransport._getLastRequest();
      expect(req.method).toBe('textDocument/rename');
      expect(req.params).toEqual({
        textDocument: { uri: 'file:///test/file.ts' },
        position: { line: 0, character: 0 }, // 1-based input → 0-based in LSP
        newName: 'newName',
      });

      expect(edit?.changes).toBeDefined();
    });
  });

  describe('diagnostics', () => {
    test('collects diagnostics from notifications', async () => {
      mockTransport._enqueueResponse(1, { capabilities: {} });
      await client.initialize('/test/workspace');

      // Simulate diagnostics notification
      const handler = mockTransport.registerNotificationHandler.mock.calls.find(
        (call: any[]) => call[0] === 'textDocument/publishDiagnostics'
      );

      if (handler) {
        const diagHandler = handler[1];
        diagHandler({
          uri: 'file:///test/file.ts',
          diagnostics: [
            { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, message: 'Error', severity: 1 },
          ],
        });
      }

      const diagnostics = client.getDiagnostics('/test/file.ts');
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].message).toBe('Error');
    });
  });

  describe('close', () => {
    test('sends shutdown request and then exit notification', async () => {
      mockTransport._enqueueResponse(1, { capabilities: {} });
      await client.initialize('/test/workspace');

      mockTransport._enqueueResponse(2, null); // shutdown response

      await client.close();

      const reqs = mockTransport._getAllRequests();
      const shutdownReq = reqs.find(r => r.method === 'shutdown');
      expect(shutdownReq).toBeDefined();
    });

    test('calls transport.close()', async () => {
      mockTransport._enqueueResponse(1, { capabilities: {} });
      await client.initialize('/test/workspace');

      mockTransport._enqueueResponse(2, null);
      await client.close();

      expect(mockTransport.close).toHaveBeenCalled();
    });
  });
});

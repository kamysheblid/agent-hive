import { spawn, type ChildProcess } from 'child_process';

/**
 * JSON-RPC 2.0 transport over stdio for LSP communication.
 *
 * Handles:
 * - Content-Length framed message encoding/decoding
 * - Request/response correlation via JSON-RPC IDs
 * - Notification dispatch to registered handlers
 * - Process lifecycle management
 */
export class LspTransport {
  readonly serverPath: string;
  readonly args: string[];

  process: ChildProcess | null = null;
  closed = false;

  private idCounter = 0;
  private pendingRequests = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private notificationHandlers = new Map<string, (params: any) => void>();
  private buffer = '';

  constructor(serverPath: string, args: string[]) {
    this.serverPath = serverPath;
    this.args = args;
  }

  /**
   * Start the LSP server process and wire up stdio.
   */
  start(): void {
    this.process = spawn(this.serverPath, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout!.on('data', (chunk: Buffer) => {
      this.processDataBuffer(chunk);
    });

    this.process.on('exit', (code) => {
      this.closed = true;
      // Reject all pending requests
      for (const [id, pending] of this.pendingRequests) {
        pending.reject(new Error(`Server exited with code ${code}`));
      }
      this.pendingRequests.clear();
    });

    this.process.on('error', (err) => {
      this.closed = true;
      for (const [, pending] of this.pendingRequests) {
        pending.reject(err);
      }
      this.pendingRequests.clear();
    });
  }

  /**
   * Generate next JSON-RPC request ID.
   */
  nextId(): number {
    return ++this.idCounter;
  }

  /**
   * Format a JSON-RPC 2.0 request message (with ID, expects response).
   */
  formatRequest(id: number, method: string, params: any): string {
    return JSON.stringify({ jsonrpc: '2.0', id, method, params });
  }

  /**
   * Format a JSON-RPC 2.0 notification message (no ID, no response expected).
   */
  formatNotification(method: string, params: any): string {
    return JSON.stringify({ jsonrpc: '2.0', method, params });
  }

  /**
   * Encode a message with Content-Length header (LSP framing).
   */
  encodeMessage(body: string): string {
    return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
  }

  /**
   * Parse a raw message from the buffer, extracting the body if a complete
   * Content-Length framed message is available.
   *
   * Returns the message body string, or null if the message is incomplete.
   */
  parseRawMessage(raw: string): string | null {
    const headerEnd = raw.indexOf('\r\n\r\n');
    if (headerEnd === -1) return null;

    const header = raw.substring(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) return null;

    const contentLength = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    const body = raw.substring(bodyStart);

    if (Buffer.byteLength(body) < contentLength) return null;

    // Return only the exact bytes for this message
    return Buffer.from(body).subarray(0, contentLength).toString('utf-8');
  }

  /**
   * Register a handler for a server-to-client notification.
   */
  registerNotificationHandler(method: string, handler: (params: any) => void): void {
    this.notificationHandlers.set(method, handler);
  }

  /**
   * Get a registered notification handler.
   */
  getNotificationHandler(method: string): ((params: any) => void) | null {
    return this.notificationHandlers.get(method) ?? null;
  }

  /**
   * Send a request and wait for the response.
   */
  async send(method: string, params: any): Promise<any> {
    if (this.closed || !this.process) {
      throw new Error('Transport is closed');
    }

    const id = this.nextId();
    const body = this.formatRequest(id, method, params);
    const message = this.encodeMessage(body);

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      try {
        this.process!.stdin!.write(message, (err) => {
          if (err) {
            this.pendingRequests.delete(id);
            reject(new Error(`Failed to write to server: ${err.message}`));
          }
        });
      } catch (err: any) {
        this.pendingRequests.delete(id);
        reject(new Error(`Failed to write to server: ${err.message}`));
      }
    });
  }

  /**
   * Resolve a pending response (used by tests to inject responses).
   */
  resolveResponse(id: number): Promise<any> {
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
    });
  }

  /**
   * Process incoming data from stdout, parsing Content-Length framed messages.
   */
  processDataBuffer(chunk: Buffer): void {
    this.buffer += chunk.toString('utf-8');

    while (true) {
      const body = this.parseRawMessage(this.buffer);
      if (body === null) break;

      // Remove the processed message from buffer
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      const header = this.buffer.substring(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) break;
      const contentLength = parseInt(match[1], 10);
      const totalConsumed = headerEnd + 4 + contentLength;
      this.buffer = this.buffer.substring(totalConsumed);

      // Parse the JSON-RPC message
      let message: any;
      try {
        message = JSON.parse(body);
      } catch {
        continue;
      }

      // Response (has id)
      if ('id' in message && message.id !== null) {
        const pending = this.pendingRequests.get(message.id);
        if (pending) {
          this.pendingRequests.delete(message.id);
          if (message.error) {
            pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
          } else {
            pending.resolve(message.result);
          }
        }
      }

      // Notification (has method, no id)
      if ('method' in message && !('id' in message)) {
        const handler = this.notificationHandlers.get(message.method);
        if (handler) {
          handler(message.params);
        }
      }
    }
  }

  /**
   * Close the transport, killing the server process.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;

    if (this.process) {
      try {
        this.process.kill('SIGTERM');
      } catch {
        // Process may already be dead
      }
    }

    // Reject all pending requests
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('Transport closed'));
    }
    this.pendingRequests.clear();
  }
}

/**
 * Create a new LspTransport instance (factory function).
 */
export function createLspTransport(serverPath: string, args: string[]): LspTransport {
  return new LspTransport(serverPath, args);
}

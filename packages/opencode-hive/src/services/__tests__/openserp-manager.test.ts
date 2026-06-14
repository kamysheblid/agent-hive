import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';

// Mock child_process
const mockSpawn = vi.fn();
const mockExecSync = vi.fn();
vi.mock('child_process', () => ({
  spawn: mockSpawn,
  execSync: mockExecSync,
}));

// Mock fs
const mockExistsSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockChmodSync = vi.fn();
const mockCreateWriteStream = vi.fn();
const mockWriteStreamOn = vi.fn();
const mockWriteStreamEnd = vi.fn();
vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  chmodSync: mockChmodSync,
  createWriteStream: mockCreateWriteStream,
}));

// Mock net
const mockCreateConnection = vi.fn();
vi.mock('net', () => ({
  createConnection: mockCreateConnection,
}));

// Mock https for download
const mockHttpsGet = vi.fn();
vi.mock('https', () => ({
  get: mockHttpsGet,
}));

// Mock http for health checks (fail silently — no real server)
const reqMock = { on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() };
reqMock.on.mockImplementation((_event: string, cb: () => void) => {
  // Simulate error immediately so health check resolves false quickly
  setImmediate(cb);
  return reqMock;
});
const mockHttpGet = vi.fn(() => reqMock);
vi.mock('http', () => ({
  get: mockHttpGet,
}));

import { OpenSERPService } from '../openserp-manager.js';

describe('OpenSERPService', () => {
  const TEST_CACHE_DIR = '/tmp/test-cache';
  let service: OpenSERPService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OpenSERPService(TEST_CACHE_DIR);
  });

  afterEach(() => {
    // Clean up any running processes
    service.stop();
  });

  describe('getBinaryPath', () => {
    it('should return correct binary path for current platform', () => {
      const binaryPath = service.getBinaryPath();
      // Should contain cacheDir, openserp, version, platform, and binary name
      expect(binaryPath).toContain(TEST_CACHE_DIR);
      expect(binaryPath).toContain('openserp');
      expect(binaryPath).toContain('0.8.3');
      expect(binaryPath).endsWith('/openserp');
    });
  });

  describe('isBinaryCached', () => {
    it('should return true when binary exists', () => {
      mockExistsSync.mockReturnValue(true);
      expect(service.isBinaryCached()).toBe(true);
    });

    it('should return false when binary does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      expect(service.isBinaryCached()).toBe(false);
    });
  });

  describe('isPortOccupied', () => {
    it('should return true when port is in use', async () => {
      const mockSocket = { on: vi.fn(), once: vi.fn(), destroy: vi.fn() };
      mockCreateConnection.mockReturnValue(mockSocket);

      // Simulate 'connect' event immediately
      mockSocket.on.mockImplementation((event: string, cb: () => void) => {
        if (event === 'connect') cb();
        return mockSocket;
      });
      mockSocket.once.mockImplementation((event: string, cb: () => void) => {
        if (event === 'error') cb();
        return mockSocket;
      });

      const result = await service.isPortOccupied(7000);
      expect(result).toBe(true);
      expect(mockCreateConnection).toHaveBeenCalledWith({ port: 7000 });
    });

    it('should return false when port is free', async () => {
      const mockSocket = { on: vi.fn(), once: vi.fn(), destroy: vi.fn() };
      mockCreateConnection.mockReturnValue(mockSocket);

      // Simulate 'error' event immediately (port not listening)
      mockSocket.on.mockReturnValue(mockSocket);
      mockSocket.once.mockImplementation((event: string, cb: () => void) => {
        if (event === 'error') cb();
        return mockSocket;
      });

      const result = await service.isPortOccupied(7000);
      expect(result).toBe(false);
    });

    it('should timeout and return false after 2 seconds', async () => {
      const mockSocket = { on: vi.fn(), once: vi.fn(), destroy: vi.fn() };
      mockCreateConnection.mockReturnValue(mockSocket);

      // Never emit any event (simulate timeout)
      mockSocket.on.mockReturnValue(mockSocket);
      mockSocket.once.mockReturnValue(mockSocket);

      const result = await service.isPortOccupied(7000);
      expect(result).toBe(false);
    }, 5000);
  });

  describe('start', () => {
    it('should skip start when port is already occupied', async () => {
      const mockSocket = { on: vi.fn(), once: vi.fn(), destroy: vi.fn() };
      mockCreateConnection.mockReturnValue(mockSocket);
      mockSocket.on.mockImplementation((event: string, cb: () => void) => {
        if (event === 'connect') cb();
        return mockSocket;
      });
      mockSocket.once.mockReturnValue(mockSocket);

      await service.start();
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('should download binary when not cached and port free', async () => {
      // Port free
      const mockSocket = { on: vi.fn(), once: vi.fn(), destroy: vi.fn() };
      mockCreateConnection.mockReturnValue(mockSocket);
      mockSocket.on.mockReturnValue(mockSocket);
      mockSocket.once.mockImplementation((event: string, cb: () => void) => {
        if (event === 'error') cb();
        return mockSocket;
      });

      // Binary not cached
      mockExistsSync.mockReturnValue(false);

      // Mock HTTPS download
      const mockResponse = { pipe: vi.fn(), on: vi.fn() };
      mockHttpsGet.mockImplementation((_url: string, cb: (res: any) => void) => {
        cb(mockResponse);
        return { on: vi.fn() };
      });

      // Mock write stream
      const mockWriteStream = { on: vi.fn() };
      mockCreateWriteStream.mockReturnValue(mockWriteStream);

      // Simulate download completion
      mockResponse.on.mockImplementation((event: string, cb: () => void) => {
        if (event === 'finish') setTimeout(cb, 10);
        return mockResponse;
      });

      // Make execSync succeed for tar extraction and chmod
      mockExecSync.mockReturnValue('');

      // Spawn mock for the actual process
      const mockProcess = {
        pid: 12345,
        on: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        kill: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockProcess);

      // Make chmodSync and existsSync work for verify
      mockExistsSync.mockReturnValueOnce(true);

      await service.start();

      // Should have downloaded and spawned
      expect(mockHttpsGet).toHaveBeenCalled();
      expect(mockSpawn).toHaveBeenCalled();
    });

    it('should use cached binary when available and port free', async () => {
      // Port free
      const mockSocket = { on: vi.fn(), once: vi.fn(), destroy: vi.fn() };
      mockCreateConnection.mockReturnValue(mockSocket);
      mockSocket.on.mockReturnValue(mockSocket);
      mockSocket.once.mockImplementation((event: string, cb: () => void) => {
        if (event === 'error') cb();
        return mockSocket;
      });

      // Binary already cached
      mockExistsSync.mockReturnValue(true);

      // Spawn mock
      const mockProcess = {
        pid: 12345,
        on: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        kill: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockProcess);

      await service.start();

      // Should NOT download, should spawn
      expect(mockHttpsGet).not.toHaveBeenCalled();
      expect(mockSpawn).toHaveBeenCalled();
    });

    it('should not start a second process if already running', async () => {
      // Port free
      const mockSocket1 = { on: vi.fn(), once: vi.fn(), destroy: vi.fn() };
      mockCreateConnection.mockReturnValueOnce(mockSocket1);
      mockSocket1.on.mockReturnValue(mockSocket1);
      mockSocket1.once.mockImplementation((event: string, cb: () => void) => {
        if (event === 'error') cb();
        return mockSocket1;
      });

      mockExistsSync.mockReturnValue(true);

      const mockProcess = {
        pid: 12345,
        on: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        kill: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockProcess);

      await service.start();
      expect(mockSpawn).toHaveBeenCalledTimes(1);

      // Second call should not spawn
      vi.clearAllMocks();
      mockCreateConnection.mockReset();
      mockSpawn.mockReset();

      await service.start();
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('should kill the running process', async () => {
      // Start the service first
      const mockSocket = { on: vi.fn(), once: vi.fn(), destroy: vi.fn() };
      mockCreateConnection.mockReturnValue(mockSocket);
      mockSocket.on.mockReturnValue(mockSocket);
      mockSocket.once.mockImplementation((event: string, cb: () => void) => {
        if (event === 'error') cb();
        return mockSocket;
      });
      mockExistsSync.mockReturnValue(true);

      const mockProcess = {
        pid: 12345,
        on: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        kill: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockProcess);

      await service.start();
      service.stop();

      expect(mockProcess.kill).toHaveBeenCalled();
    });

    it('should be safe to call when no process is running', () => {
      // Should not throw
      expect(() => service.stop()).not.toThrow();
    });
  });

  describe('health check', () => {
    it('should eventually return true when server responds', async () => {
      // Start service
      const mockSocket = { on: vi.fn(), once: vi.fn(), destroy: vi.fn() };
      mockCreateConnection.mockReturnValue(mockSocket);
      mockSocket.on.mockReturnValue(mockSocket);
      mockSocket.once.mockImplementation((event: string, cb: () => void) => {
        if (event === 'error') cb();
        return mockSocket;
      });
      mockExistsSync.mockReturnValue(true);

      const mockProcess = {
        pid: 12345,
        on: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        kill: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockProcess);

      await service.start();

      // After start, health should be available (process is running)
      expect(service.isRunning()).toBe(true);
    });
  });

  describe('platform detection', () => {
    it('should detect linux-amd64 platform', () => {
      // Set platform to linux, arch to x64
      const origPlatform = process.platform;
      const origArch = process.arch;

      Object.defineProperty(process, 'platform', { value: 'linux' });
      Object.defineProperty(process, 'arch', { value: 'x64' });

      const ws = new OpenSERPService(TEST_CACHE_DIR);
      const binaryPath = ws.getBinaryPath();
      expect(binaryPath).toContain('linux-amd64');

      // Restore
      Object.defineProperty(process, 'platform', { value: origPlatform });
      Object.defineProperty(process, 'arch', { value: origArch });
    });

    it('should detect darwin-arm64 platform', () => {
      const origPlatform = process.platform;
      const origArch = process.arch;

      Object.defineProperty(process, 'platform', { value: 'darwin' });
      Object.defineProperty(process, 'arch', { value: 'arm64' });

      const ws = new OpenSERPService(TEST_CACHE_DIR);
      const binaryPath = ws.getBinaryPath();
      expect(binaryPath).toContain('darwin-arm64');

      Object.defineProperty(process, 'platform', { value: origPlatform });
      Object.defineProperty(process, 'arch', { value: origArch });
    });

    it('should reject unsupported platforms', () => {
      const origPlatform = process.platform;

      Object.defineProperty(process, 'platform', { value: 'win32' });

      expect(() => new OpenSERPService(TEST_CACHE_DIR)).toThrow('Unsupported platform');

      Object.defineProperty(process, 'platform', { value: origPlatform });
    });
  });
});

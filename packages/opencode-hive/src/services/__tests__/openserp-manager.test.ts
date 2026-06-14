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
const mockUnlinkSync = vi.fn();
const mockCreateWriteStream = vi.fn();
const mockWriteStreamOn = vi.fn();
const mockWriteStreamEnd = vi.fn();
vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  chmodSync: mockChmodSync,
  unlinkSync: mockUnlinkSync,
  createWriteStream: mockCreateWriteStream,
}));

// Mock net — source uses new net.Socket()
const mockSocketOn = vi.fn();
const mockSocketOnce = vi.fn();
const mockSocketDestroy = vi.fn();
const mockSocketConnect = vi.fn();
const mockSocketInstance = {
  on: mockSocketOn,
  once: mockSocketOnce,
  destroy: mockSocketDestroy,
  connect: mockSocketConnect,
};
const MockSocket = vi.fn(() => mockSocketInstance);
vi.mock('net', () => ({
  Socket: MockSocket,
}));

// Mock https for download
const mockHttpsGet = vi.fn();
vi.mock('https', () => ({
  get: mockHttpsGet,
}));

// Mock http for health checks — simulate successful response (200 OK)
const reqMock = { on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() };
reqMock.on.mockImplementation((_event: string, cb: () => void) => {
  setImmediate(cb);
  return reqMock;
});
const mockHttpGet = vi.fn((_url: string, cb?: (res: any) => void) => {
  // Call response callback immediately so the health check promise settles
  if (cb) cb({ statusCode: 200, on: vi.fn() });
  return reqMock;
});
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
      expect(binaryPath.endsWith('/openserp')).toBe(true);
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
      // Simulate 'connect' event — source uses socket.on('connect', cb)
      mockSocketOn.mockImplementation((event: string, cb: () => void) => {
        if (event === 'connect') cb();
        return mockSocketInstance;
      });

      const result = await service.isPortOccupied(7000);
      expect(result).toBe(true);
      expect(mockSocketConnect).toHaveBeenCalledWith(7000);
    });

    it('should return false when port is free', async () => {
      // Simulate 'error' event (port not listening)
      mockSocketOn.mockImplementation((event: string, cb: () => void) => {
        if (event === 'error') cb();
        return mockSocketInstance;
      });

      const result = await service.isPortOccupied(7000);
      expect(result).toBe(false);
    });

    it('should timeout and return false after 2 seconds', async () => {
      // Never emit any event (simulate timeout)
      mockSocketOn.mockReturnValue(mockSocketInstance);

      const result = await service.isPortOccupied(7000);
      expect(result).toBe(false);
    }, 5000);
  });

  describe('start', () => {
    it('should skip start when port is already occupied', async () => {
      // Simulate 'connect' → port occupied
      mockSocketOn.mockImplementation((event: string, cb: () => void) => {
        if (event === 'connect') cb();
        return mockSocketInstance;
      });

      await service.start();
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('should download binary when not cached and port free', async () => {
      // Port free — simulate error on both 'connect' and 'error'
      mockSocketOn.mockImplementation((event: string, cb: () => void) => {
        if (event === 'error') cb();
        return mockSocketInstance;
      });

      // Binary not cached (first call), then verify passes (subsequent calls)
      mockExistsSync.mockReturnValueOnce(false).mockReturnValue(true);

      // Mock HTTPS download — response with 200 OK
      const mockResponse = { pipe: vi.fn(), on: vi.fn(), statusCode: 200 };
      mockHttpsGet.mockImplementation((_url: string, cb: (res: any) => void) => {
        cb(mockResponse);
        return { on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() };
      });

      // Mock write stream with close() and finish event
      const mockWriteStream = { on: vi.fn(), close: vi.fn() };
      mockCreateWriteStream.mockReturnValue(mockWriteStream);
      mockWriteStream.on.mockImplementation((event: string, cb: () => void) => {
        if (event === 'finish') setTimeout(cb, 10);
        return mockWriteStream;
      });

      // Make execSync succeed for tar extraction
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

      await service.start();

      // Should have downloaded and spawned
      expect(mockHttpsGet).toHaveBeenCalled();
      expect(mockSpawn).toHaveBeenCalled();
    });

    it('should use cached binary when available and port free', async () => {
      // Port free
      mockSocketOn.mockImplementation((event: string, cb: () => void) => {
        if (event === 'error') cb();
        return mockSocketInstance;
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
      mockSocketOn.mockImplementation((event: string, cb: () => void) => {
        if (event === 'error') cb();
        return mockSocketInstance;
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
      mockSpawn.mockReset();

      await service.start();
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('should kill the running process', async () => {
      // Port free
      mockSocketOn.mockImplementation((event: string, cb: () => void) => {
        if (event === 'error') cb();
        return mockSocketInstance;
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

      // Make execSync throw so stop() falls through to process.kill
      mockExecSync.mockImplementation(() => { throw new Error('mock'); });

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
      // Port free
      mockSocketOn.mockImplementation((event: string, cb: () => void) => {
        if (event === 'error') cb();
        return mockSocketInstance;
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

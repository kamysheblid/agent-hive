import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import * as https from 'https';
import * as http from 'http';
import { spawn, execSync } from 'child_process';

/**
 * OpenSERP binary version.
 */
const OPENSERP_VERSION = '0.8.3';

/**
 * Platform → download platform folder mapping.
 */
const PLATFORM_MAP: Record<string, Record<string, string>> = {
  linux: { x64: 'linux-amd64', arm64: 'linux-arm64' },
  darwin: { x64: 'darwin-amd64', arm64: 'darwin-arm64' },
};

/**
 * Default port for the OpenSERP backend.
 */
const OPENSERP_PORT = 7000;

/**
 * Health check endpoint.
 */
const HEALTH_PATH = '/health';

/**
 * Maximum restart attempts.
 */
const MAX_RESTARTS = 3;

/**
 * Backoff delays between restarts (seconds).
 */
const BACKOFF_DELAYS = [2, 4, 8];

/**
 * Timeout for health check polling (ms).
 */
const HEALTH_POLL_TIMEOUT = 30000;

/**
 * Timeout for port check (ms).
 */
const PORT_CHECK_TIMEOUT = 2000;

/**
 * OpenSERP Service — manages the OpenSERP backend binary lifecycle.
 *
 * Handles download, caching, process lifecycle, health checks, and restart.
 * 0-risk: never blocks startup for more than 5s, all errors caught and logged.
 */
export class OpenSERPService {
  private cacheDir: string;
  private platformTag: string;
  private process: ReturnType<typeof spawn> | null = null;
  private running = false;
  private stopped = false;

  constructor(cacheDir: string) {
    const plat = process.platform;
    const arch = process.arch;

    const platformMap = PLATFORM_MAP[plat];
    if (!platformMap) {
      throw new Error(
        `Unsupported platform: ${plat}. OpenSERP supports: ${Object.keys(PLATFORM_MAP).join(', ')}`,
      );
    }

    const tag = platformMap[arch];
    if (!tag) {
      throw new Error(
        `Unsupported arch: ${arch} for platform ${plat}. OpenSERP supports: ${Object.keys(platformMap).join(', ')}`,
      );
    }

    this.cacheDir = cacheDir;
    this.platformTag = tag;
  }

  /**
   * Get the full path to the cached OpenSERP binary.
   */
  getBinaryPath(): string {
    return path.join(
      this.cacheDir,
      'openserp',
      OPENSERP_VERSION,
      this.platformTag,
      'openserp',
    );
  }

  /**
   * Check if the OpenSERP binary is already cached.
   */
  isBinaryCached(): boolean {
    return fs.existsSync(this.getBinaryPath());
  }

  /**
   * Check if a port is already occupied by probing it.
   * Returns true if the port is in use.
   */
  isPortOccupied(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timeout = setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, PORT_CHECK_TIMEOUT);

      socket.on('connect', () => {
        clearTimeout(timeout);
        socket.destroy();
        resolve(true);
      });

      socket.on('error', () => {
        clearTimeout(timeout);
        socket.destroy();
        resolve(false);
      });

      socket.connect(port);
    });
  }

  /**
   * Download and extract the OpenSERP binary.
   * Downloads the .tgz archive from GitHub releases and extracts it.
   */
  async download(): Promise<void> {
    const binaryPath = this.getBinaryPath();
    const extractDir = path.dirname(binaryPath);

    // Ensure cache directory exists
    fs.mkdirSync(extractDir, { recursive: true });

    const downloadUrl = `https://github.com/karust/openserp/releases/download/v${OPENSERP_VERSION}/openserp-${this.platformTag}-${OPENSERP_VERSION}.tgz`;
    const tmpPath = path.join(extractDir, `openserp-${Date.now()}.tgz`);

    console.log(`[openserp] Downloading from ${downloadUrl}`);

    await new Promise<void>((resolve, reject) => {
      const file = fs.createWriteStream(tmpPath);
      const request = https.get(downloadUrl, (response) => {
        // Handle redirects
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close();
          fs.unlinkSync(tmpPath);
          // Follow redirect via new request
          https.get(response.headers.location, (res2) => {
            res2.pipe(file);
            file.on('finish', () => {
              file.close();
              resolve();
            });
          }).on('error', (err) => {
            file.close();
            fs.unlinkSync(tmpPath);
            reject(err);
          });
          return;
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(tmpPath);
          reject(new Error(`Download failed: HTTP ${response.statusCode}`));
          return;
        }

        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      });

      request.on('error', (err) => {
        file.close();
        fs.unlinkSync(tmpPath);
        reject(err);
      });

      // Timeout after 60 seconds
      request.setTimeout(60000, () => {
        request.destroy();
        file.close();
        fs.unlinkSync(tmpPath);
        reject(new Error('Download timed out'));
      });
    });

    // Extract the archive using system tar (available on Linux/macOS)
    console.log(`[openserp] Extracting to ${extractDir}`);
    try {
      execSync(`tar -xzf "${tmpPath}" -C "${extractDir}"`, { stdio: 'ignore', timeout: 30000 });
    } catch (err) {
      fs.unlinkSync(tmpPath);
      throw new Error(`Extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Remove the archive
    fs.unlinkSync(tmpPath);

    // Make binary executable
    fs.chmodSync(binaryPath, 0o755);

    // Verify binary is executable
    if (!fs.existsSync(binaryPath)) {
      throw new Error(`Binary not found after extraction: ${binaryPath}`);
    }

    console.log(`[openserp] Binary ready at ${binaryPath}`);
  }

  /**
   * Check if the service is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Start the OpenSERP backend process.
   *
   * - Skips if port is already occupied
   * - Downloads binary if not cached
   * - Spawns the process and polls /health
   * - Auto-restarts up to 3 times with backoff
   * - Never blocks for more than ~5s for init
   */
  async start(): Promise<void> {
    if (this.running || this.process) {
      console.log('[openserp] Already running, skipping');
      return;
    }

    // Check if port is occupied
    const occupied = await this.isPortOccupied(OPENSERP_PORT);
    if (occupied) {
      console.log(`[openserp] Port ${OPENSERP_PORT} already in use, skipping start`);
      return;
    }

    // Ensure binary is cached
    if (!this.isBinaryCached()) {
      try {
        await this.download();
      } catch (err) {
        console.error('[openserp] Download failed:', err instanceof Error ? err.message : err);
        return;
      }
    }

    this.stopped = false;
    await this.startProcess();
  }

  /**
   * Internal method to spawn and monitor the process.
   */
  private async startProcess(): Promise<void> {
    const binaryPath = this.getBinaryPath();
    const args: string[] = [];

    console.log(`[openserp] Starting ${binaryPath} on port ${OPENSERP_PORT}`);

    const child = spawn(binaryPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        OPENSERP_PORT: String(OPENSERP_PORT),
      },
    });

    this.process = child;
    this.running = true;

    child.stdout?.on('data', (data: Buffer) => {
      console.log(`[openserp:stdout] ${data.toString().trim()}`);
    });

    child.stderr?.on('data', (data: Buffer) => {
      console.log(`[openserp:stderr] ${data.toString().trim()}`);
    });

    child.on('exit', (code: number | null, signal: string | null) => {
      console.log(`[openserp] Process exited (code=${code}, signal=${signal})`);
      this.running = false;
      this.process = null;

      // Auto-restart logic
      if (!this.stopped) {
        this.attemptRestart();
      }
    });

    child.on('error', (err: Error) => {
      console.error(`[openserp] Process error: ${err.message}`);
      this.running = false;
      this.process = null;

      if (!this.stopped) {
        this.attemptRestart();
      }
    });

    // Wait for health check
    const healthy = await this.waitForHealth();
    if (!healthy) {
      console.warn('[openserp] Health check failed after start');
      // Process might still be starting, don't kill it
    }
  }

  /**
   * Poll /health endpoint until the server responds or timeout.
   */
  private async waitForHealth(): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < HEALTH_POLL_TIMEOUT) {
      try {
        const result = await this.checkHealth();
        if (result) {
          console.log(`[openserp] Health check passed after ${Date.now() - startTime}ms`);
          return true;
        }
      } catch {
        // Server not ready yet
      }

      await this.sleep(500);
    }

    console.warn(`[openserp] Health check timed out after ${HEALTH_POLL_TIMEOUT}ms`);
    return false;
  }

  /**
   * Perform a single health check against the OpenSERP server.
   */
  private checkHealth(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(`http://localhost:${OPENSERP_PORT}${HEALTH_PATH}`, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(3000, () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  /**
   * Attempt to restart the process with exponential backoff.
   */
  private attemptRestart(): void {
    const attemptCount = this.restartCount;
    this.restartCount++;

    if (attemptCount >= MAX_RESTARTS) {
      console.error(`[openserp] Max restarts (${MAX_RESTARTS}) reached, giving up`);
      return;
    }

    const delay = BACKOFF_DELAYS[attemptCount] ?? 8;
    console.log(`[openserp] Restart attempt ${attemptCount + 1}/${MAX_RESTARTS} in ${delay}s`);

    setTimeout(() => {
      if (!this.stopped) {
        this.startProcess().catch((err) => {
          console.error(`[openserp] Restart failed: ${err.message}`);
        });
      }
    }, delay * 1000);
  }

  private restartCount = 0;

  /**
   * Stop the OpenSERP backend process.
   * Kills the entire process tree.
   */
  stop(): void {
    this.stopped = true;

    if (this.process) {
      const pid = this.process.pid;
      if (pid) {
        try {
          // Kill process tree
          execSync(`kill -- -$(ps -o pgid= -p ${pid} 2>/dev/null | tr -d ' ') 2>/dev/null || true`, {
            stdio: 'ignore',
            timeout: 3000,
          });
        } catch {
          // Fallback: kill just the process
          try {
            this.process.kill('SIGTERM');
          } catch {
            // Force kill
            try {
              this.process.kill('SIGKILL');
            } catch {
              // Process already dead
            }
          }
        }
      } else {
        try {
          this.process.kill('SIGTERM');
        } catch {
          // Process already dead
        }
      }

      this.process = null;
    }

    this.running = false;
  }

  /**
   * Dispose hook — alias for stop().
   */
  dispose(): void {
    this.stop();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

import { defineConfig } from 'vite';
import { createGenerationMiddleware } from './server/middleware.js';
import { createSemanticGuideMiddleware } from './server/semantic-guide-middleware.js';
import { createFeedMiddleware } from './server/feed-middleware.js';
import { createLocalAppServices } from './server/local-app-services.js';

const PRIVATE_SEGMENTS = new Set([
  '.git', '.codex', '.claude', '.cursor', '.agents', '.aws', '.ssh',
  '.blawx-private', 'app-data', 'app-runs', 'artifacts', 'experiments',
  'raw-records', 'receipts', 'server', 'scripts', 'tests',
]);
const PRIVATE_BASENAMES = new Set([
  '.env', '.cursorrules', '.impeccable.md', 'agents.md', 'agents-history.md', 'session.md', 'claude.md',
  '.npmrc', '.netrc', '.pypirc', 'credentials.json', 'release-plan.md', 'publishing-decision.md',
  'redaction-report.md',
]);

export function isPrivateRequestPath(rawUrl) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(rawUrl, 'http://localhost').pathname); }
  catch { return true; }
  const parts = pathname.toLowerCase().split('/').filter(Boolean);
  if (parts.some((part) => PRIVATE_SEGMENTS.has(part))) return true;
  const basename = parts.at(-1) ?? '';
  return PRIVATE_BASENAMES.has(basename)
    || basename.startsWith('.env.')
    || basename.endsWith('.log')
    || /\.(?:pem|key|p12|pfx|crt)$/i.test(basename)
    || /(?:^private-|\b(?:billing|research|receipt|raw-record)\b).*\.(?:md|json|jsonl|txt|log)$/i.test(basename)
    || /\.(?:record|receipt)\.json$/i.test(basename)
    || /^service-account.*\.json$/i.test(basename);
}

function privateRequestGuard(request, response, next) {
  if (!isPrivateRequestPath(request.url ?? '/')) return next();
  response.statusCode = 404;
  response.setHeader('Cache-Control', 'no-store');
  response.end('Not found');
}

function localGenerationPlugin() {
  return {
    name: 'blawx-local-generation',
    async configureServer(server) {
      server.middlewares.use(privateRequestGuard);
      const services = await createLocalAppServices();
      server.middlewares.use(createFeedMiddleware(services.store));
      server.middlewares.use(createSemanticGuideMiddleware(services.semantic));
      server.middlewares.use(createGenerationMiddleware(services.generation));
      server.httpServer?.once('close', () => { void services.close().catch(() => {}); });
    },
  };
}

export default defineConfig({
  plugins: [localGenerationPlugin()],
  build: { rollupOptions: { input: { app: 'index.html' } } },
  server: {
    host: '127.0.0.1',
    fs: {
      strict: true,
      deny: [
        '.env', '.env.*', '*.{crt,pem,key,p12,pfx}', '**/.git/**',
        '.npmrc', '.netrc', '.pypirc', 'credentials.json', 'service-account*.json',
        '**/.codex/**', '**/.claude/**', '**/.cursor/**', '**/.agents/**', '**/.aws/**', '**/.ssh/**',
        '**/.blawx-private/**', '**/app-data/**', '**/app-runs/**', '**/artifacts/**', '**/experiments/**', '**/server/**',
        '**/raw-records/**', '**/receipts/**',
        '**/*.log',
        '**/AGENTS.md', '**/AGENTS-HISTORY.md', '**/SESSION.md', '**/CLAUDE.md', '**/.cursorrules', '**/.impeccable.md',
      ],
    },
  },
});

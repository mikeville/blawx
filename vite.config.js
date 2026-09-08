import { defineConfig } from 'vite';
import { createGenerationService, GenerationError } from './server/generation-service.js';
import { createGenerationMiddleware } from './server/middleware.js';
import { createSemanticGuideService } from './server/semantic-guide-service.js';
import { createSemanticGuideMiddleware } from './server/semantic-guide-middleware.js';

const PRIVATE_SEGMENTS = new Set([
  '.git', '.codex', '.claude', '.cursor', '.agents', '.aws', '.ssh',
  'app-runs', 'artifacts', 'experiments', 'raw-records', 'receipts', 'server', 'scripts', 'tests',
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
  let service;
  let semanticService;
  return {
    name: 'blawx-local-generation',
    configureServer(server) {
      server.middlewares.use(privateRequestGuard);
      service = createGenerationService();
      semanticService = createSemanticGuideService({ isGenerationBusy: service.isBusy });
      server.middlewares.use(createSemanticGuideMiddleware(semanticService));
      server.middlewares.use(createGenerationMiddleware({
        generate(input, options) {
          if (semanticService.isBusy()) throw new GenerationError('busy', 'Another local model request is already running.', null);
          return service.generate(input, options);
        },
      }));
      server.httpServer?.once('close', () => { service.cancel(); semanticService.cancel(); });
    },
  };
}

export default defineConfig({
  plugins: [localGenerationPlugin()],
  build: { rollupOptions: { input: { app: 'index.html', instructionAppearance: 'instruction-appearance.html' } } },
  server: {
    host: '127.0.0.1',
    fs: {
      strict: true,
      deny: [
        '.env', '.env.*', '*.{crt,pem,key,p12,pfx}', '**/.git/**',
        '.npmrc', '.netrc', '.pypirc', 'credentials.json', 'service-account*.json',
        '**/.codex/**', '**/.claude/**', '**/.cursor/**', '**/.agents/**', '**/.aws/**', '**/.ssh/**',
        '**/app-runs/**', '**/artifacts/**', '**/experiments/**', '**/server/**',
        '**/raw-records/**', '**/receipts/**',
        '**/AGENTS.md', '**/AGENTS-HISTORY.md', '**/SESSION.md', '**/CLAUDE.md', '**/.cursorrules', '**/.impeccable.md',
      ],
    },
  },
});

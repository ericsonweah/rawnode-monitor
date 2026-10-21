'use strict';

import path from 'node:path';
import { createRequire, isBuiltin } from 'node:module';
import { pathToFileURL } from 'node:url';

const REQUIRE_CACHE = new Map();

function safeCall(callback, fallback = null) {
  try {
    const value = callback();
    return value === undefined || value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

/** Resolve the framework application root without coupling Events to Foundation. */
export function applicationRoot(app = null) {
  const candidates = [
    typeof app?.basePath === 'function' ? safeCall(() => app.basePath()) : null,
    typeof app?.rootPath === 'function' ? safeCall(() => app.rootPath()) : null,
    typeof app?.path === 'function' ? safeCall(() => app.path()) : null,
    typeof app?.rootPath === 'string' ? app.rootPath : null,
    typeof app?.basePath === 'string' ? app.basePath : null,
    typeof app?.root === 'string' ? app.root : null,
    process.cwd(),
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return path.resolve(candidate);
  }
  return path.resolve(process.cwd());
}

/**
 * Create a resolver whose package scope is the framework root rather than the
 * standalone `src/events/package.json` boundary.
 */
export function applicationRequire(app = null) {
  const root = applicationRoot(app);
  let resolver = REQUIRE_CACHE.get(root);
  if (!resolver) {
    resolver = createRequire(path.join(root, 'package.json'));
    REQUIRE_CACHE.set(root, resolver);
  }
  return resolver;
}

export function resolveApplicationSpecifier(app, specifier) {
  const spec = String(specifier || '').trim();
  if (!spec) throw applicationImportError(spec, applicationRoot(app), null, null, 'EVENTS_APPLICATION_IMPORT_EMPTY');
  return applicationRequire(app).resolve(spec);
}

/**
 * Import application modules from the application package scope.
 *
 * `#` package-import aliases are resolved from the framework root. Relative
 * references remain application-root-relative for compatibility. Bare package
 * references keep normal Node.js resolution semantics.
 */
export async function importApplicationModule(app, specifier, options = {}) {
  const spec = String(specifier || '').trim();
  const root = applicationRoot(app);
  if (!spec) throw applicationImportError(spec, root, null, null, 'EVENTS_APPLICATION_IMPORT_EMPTY');

  if (spec.startsWith('node:') || spec.startsWith('file:') || spec.startsWith('data:')) {
    return await import(spec);
  }

  if (spec.startsWith('#')) {
    let applicationError = null;
    try {
      const resolved = resolveApplicationSpecifier(app, spec);
      return await importResolved(resolved);
    } catch (error) {
      applicationError = error;
    }

    // Preserve package-local private imports for standalone rawnode-events use.
    if (options.fallbackToCurrentPackage !== false) {
      try {
        return await import(spec);
      } catch (packageError) {
        throw applicationImportError(
          spec,
          root,
          applicationError,
          packageError,
          'EVENTS_APPLICATION_IMPORT_UNRESOLVED',
        );
      }
    }

    throw applicationImportError(
      spec,
      root,
      applicationError,
      null,
      'EVENTS_APPLICATION_IMPORT_UNRESOLVED',
    );
  }

  if (path.isAbsolute(spec) || spec.startsWith('.')) {
    const absolute = path.isAbsolute(spec) ? spec : path.resolve(root, spec);
    return await import(pathToFileURL(absolute).href);
  }

  return await import(spec);
}

export function clearApplicationModuleResolverCache() {
  REQUIRE_CACHE.clear();
}

async function importResolved(resolved) {
  const target = String(resolved || '');
  if (target.startsWith('node:') || target.startsWith('file:') || target.startsWith('data:')) {
    return await import(target);
  }
  if (isBuiltin(target)) return await import(target.startsWith('node:') ? target : `node:${target}`);
  if (path.isAbsolute(target)) return await import(pathToFileURL(target).href);
  return await import(target);
}

function applicationImportError(specifier, root, applicationError, packageError, code) {
  const message = code === 'EVENTS_APPLICATION_IMPORT_EMPTY'
    ? 'Application module reference is empty.'
    : `Unable to resolve application module '${specifier}' from RawNode root '${root}'.`;
  const error = new Error(message, { cause: applicationError || packageError || undefined });
  error.name = 'EventApplicationImportError';
  error.code = code;
  error.details = {
    specifier: specifier || null,
    applicationRoot: root,
    applicationResolution: applicationError ? {
      name: applicationError.name || 'Error',
      code: applicationError.code || null,
      message: applicationError.message || String(applicationError),
    } : null,
    packageResolution: packageError ? {
      name: packageError.name || 'Error',
      code: packageError.code || null,
      message: packageError.message || String(packageError),
    } : null,
  };
  return error;
}

export default importApplicationModule;

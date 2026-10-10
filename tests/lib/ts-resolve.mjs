// Node resolve hook: let extensionless relative imports (Vite style) find .ts files.
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/i.test(specifier)) return next(`${specifier}.ts`, context);
    throw err;
  }
}

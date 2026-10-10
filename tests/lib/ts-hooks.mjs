// Lets the tests import the app's TypeScript: Node (22.18 or newer) strips the types itself, and the hook
// registered here resolves the app's extensionless imports ('./http') to their .ts files, as Vite does.
import { register } from 'node:module';
register(new URL('./ts-resolve.mjs', import.meta.url));

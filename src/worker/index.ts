import { Hono } from 'hono';
import { csrf } from 'hono/csrf';
import { grantModulePermissions, type Role } from '../shared/permissions';
import { authRoutes } from './core/auth-routes';
import { requireUser } from './core/auth';
import { AppError } from './core/errors';
import { importRoutes } from './core/import-routes';
import { platformRoutes, restoreRoutes } from './core/platform-routes';
import { promotionRoutes } from './core/promotion-routes';
import { schoolRoutes } from './core/school-routes';
import { staffRoutes } from './core/staff-routes';
import { studentRoutes } from './core/students-routes';
import { userRoutes } from './core/users-routes';
import type { AppEnv } from './env';
import { modules, registerModules } from './modules';
import { feesModule } from './modules/fees';

registerModules([feesModule]);

const api = new Hono<AppEnv>();

// Browsers send Origin on form posts; this blocks requests made from other websites.
api.use(csrf());

// Open routes: bootstrap, one-time setup, sign-in, restore into an empty database.
api.route('/', authRoutes);
api.route('/', restoreRoutes);

// Everything else needs a signed-in user; each route then checks permission and branch.
const secured = new Hono<AppEnv>();
secured.use(requireUser);
secured.route('/', schoolRoutes);
secured.route('/', userRoutes);
secured.route('/', importRoutes); // before studentRoutes so /students/import is not read as /students/:id
secured.route('/', studentRoutes);
secured.route('/', promotionRoutes);
secured.route('/', staffRoutes);
secured.route('/', platformRoutes);

for (const mod of modules) {
  for (const [role, permissions] of Object.entries(mod.rolePermissions)) {
    grantModulePermissions(role as Role, permissions);
  }
  // A module switched off in Settings answers 404 for all its routes.
  secured.use(`/${mod.id}/*`, async (c, next) => {
    const row = await c.env.DB.prepare('SELECT value FROM settings WHERE key = ?')
      .bind(`module.${mod.id}`)
      .first<{ value: string }>();
    if (row?.value === '0')
      throw new AppError(
        404,
        `${mod.name} is switched off. The admin can switch it on in Settings.`,
      );
    await next();
  });
  secured.route(`/${mod.id}`, mod.routes);
}
api.route('/', secured);

api.notFound((c) => c.json({ error: 'This page does not exist on the server.' }, 404));
api.onError((err, c) => {
  if (err instanceof AppError)
    return c.json({ error: err.message, fields: err.fields }, err.status);
  if (err instanceof SyntaxError)
    return c.json({ error: 'The request was not understood. Reload the page and try again.' }, 400);
  console.error(err);
  return c.json(
    { error: 'Something went wrong on the server. Please try again in a minute.' },
    500,
  );
});

const app = new Hono<AppEnv>();
app.route('/api', api);
// Anything that is not /api is the web app (static files, with index.html as fallback).
app.all('*', (c) => (c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.text('Not found', 404)));

export default app;

import assert from 'node:assert/strict';
import router from '../src/routes/activityRoutes';

const paths = [
  '/:id/details', '/:id/teams', '/:id/teams/:teamId/details',
  '/:id/teams/:teamId/responsible-person', '/:id/teams/:teamId/formation',
  '/:id/teams/:teamId/shirts', '/:id/teams/:teamId/lineup',
  '/:id/teams/:teamId/selection-changes', '/:id/invitations',
  '/:id/invitations/:playerId', '/:id/attendance'
];
const routes = (router as any).stack.filter((layer: any) => layer.route).map((layer: any) => layer.route);
const check = (path: string, method: string, roles: string[]) => {
  const route = routes.find((item: any) => item.path === path && item.methods[method]);
  assert(route, `Missing ${method} ${path}`);
  const middleware = route.stack[0].handle;
  let nextCalled = false;
  const res = {
    statusCode: 200,
    status(code: number) { this.statusCode = code; return this; },
    json() { return this; }
  };
  middleware({ groupAccess: { roles } }, res, () => { nextCalled = true; });
  return { status: res.statusCode, nextCalled };
};
for (const path of paths) {
  const method = path.endsWith('/invitations/:playerId') ? 'delete' : path.endsWith('/details') || path.endsWith('/attendance') ? 'patch' : path.endsWith('/teams') || path.endsWith('/invitations') || path.endsWith('/selection-changes') ? 'post' : 'put';
  assert.equal(check(path, method, ['guardian']).status, 403);
  assert.equal(check(path, method, ['trainer']).nextCalled, true);
}
assert.equal(check('/:id/history', 'get', ['trainer']).status, 403);
assert.equal(check('/:id/history', 'get', ['admin']).nextCalled, true);
console.log('Activity route authorization tests passed');

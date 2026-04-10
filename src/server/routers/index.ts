import { router } from '../trpc/init';
import { catalogRouter } from './catalog';
import { subscriptionRouter } from './subscription';
import { licenseRouter } from './license';
import { vendorRouter } from './vendor';
import { billingRouter } from './billing';
import { adminRouter } from './admin';
import { organizationRouter } from './organization';

export const appRouter = router({
  catalog: catalogRouter,
  subscription: subscriptionRouter,
  license: licenseRouter,
  vendor: vendorRouter,
  billing: billingRouter,
  admin: adminRouter,
  organization: organizationRouter,
});

export type AppRouter = typeof appRouter;

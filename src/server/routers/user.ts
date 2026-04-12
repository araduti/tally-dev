import { z } from 'zod';
import { router, authenticatedProcedure } from '../trpc/init';
import { prisma } from '@/lib/db';

export const userRouter = router({
  /**
   * Returns the authenticated user's basic profile information.
   *
   * Uses `authenticatedProcedure` (no org context required) so it works
   * even when the user hasn't selected an organization yet.
   */
  me: authenticatedProcedure
    .input(z.object({}))
    .query(async ({ ctx }) => {
      const user = await prisma.user.findUnique({
        where: { id: ctx.userId! },
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
        },
      });

      if (!user) {
        return null;
      }

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      };
    }),
});

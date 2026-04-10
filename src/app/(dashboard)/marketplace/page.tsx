import { Suspense } from 'react';
import { api } from '@/trpc/server';
import { MarketplaceClient } from './marketplace-client';

function MarketplaceLoadingSkeleton() {
  return (
    <>
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 mb-6">
        <div className="h-10 w-full bg-slate-700 rounded-lg animate-pulse" />
      </div>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-slate-800 rounded-xl p-5 border border-slate-700">
            <div className="h-5 w-40 bg-slate-700/50 rounded animate-pulse mb-3" />
            <div className="h-3 w-24 bg-slate-700/50 rounded animate-pulse mb-3" />
            <div className="space-y-1.5 mb-3">
              <div className="h-3 w-32 bg-slate-700/50 rounded animate-pulse" />
              <div className="h-3 w-28 bg-slate-700/50 rounded animate-pulse" />
            </div>
            <div className="h-9 w-full bg-slate-700 rounded-lg animate-pulse" />
          </div>
        ))}
      </div>
    </>
  );
}

async function MarketplaceContent() {
  try {
    const result = await api.catalog.listBundles({});

    // Serialize Date → ISO string
    const serializedItems = result.items.map((item: any) => ({
      id: item.id,
      name: item.name,
      category: item.category ?? null,
      createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
      products: (item.products ?? []).map((bp: any) => ({
        product: {
          id: bp.product.id,
          name: bp.product.name,
        },
      })),
    }));

    return (
      <MarketplaceClient
        initialBundles={serializedItems}
        initialNextCursor={result.nextCursor}
      />
    );
  } catch {
    return (
      <div className="bg-slate-800 rounded-xl border border-red-700/50 p-6">
        <p className="text-red-400 text-sm">
          Unable to load marketplace catalog. Please try refreshing the page.
        </p>
      </div>
    );
  }
}

export default async function MarketplacePage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Marketplace</h1>
        <p className="mt-1 text-slate-400">
          Compare pricing across distributors and purchase with one click
        </p>
      </div>

      <Suspense fallback={<MarketplaceLoadingSkeleton />}>
        <MarketplaceContent />
      </Suspense>
    </div>
  );
}

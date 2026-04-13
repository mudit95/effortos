import { requireAdmin } from '@/lib/admin';
import { ContentEditor } from './ContentEditor';

export const dynamic = 'force-dynamic';

export default async function AdminContentPage() {
  const check = await requireAdmin();
  if (!check.ok) return null;

  const { data } = await check.supabase
    .from('site_content')
    .select('*')
    .order('key');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Site content</h2>
        <p className="text-sm text-white/50 mt-1">Edit user-facing text across the app.</p>
      </div>
      <ContentEditor initial={data ?? []} />
    </div>
  );
}

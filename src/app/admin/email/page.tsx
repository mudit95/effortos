import { requireAdmin } from '@/lib/admin';
import { EmailComposer } from './EmailComposer';

export const dynamic = 'force-dynamic';

export default async function AdminEmailPage() {
  const check = await requireAdmin();
  if (!check.ok) return null;

  // Fetch recent email log
  const { supabase } = check;
  const { data: recentEmails } = await supabase
    .from('email_log')
    .select('id, email_to, email_type, subject, status, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold">Email</h2>
        <p className="text-sm text-white/50 mt-1">
          Send custom emails to users. Automated morning/afternoon/nightly emails run on schedule.
        </p>
      </div>

      {/* Composer */}
      <EmailComposer />

      {/* Recent email log */}
      <div>
        <h3 className="text-lg font-semibold mb-3">Recent emails</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-white/40 text-xs">
                <th className="px-4 py-2">Time</th>
                <th className="px-4 py-2">To</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Subject</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {(recentEmails || []).map((e: { id: string; email_to: string; email_type: string; subject: string; status: string; created_at: string }) => (
                <tr key={e.id} className="border-t border-white/[0.04]">
                  <td className="px-4 py-2 text-white/40 whitespace-nowrap">
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-white/70">{e.email_to}</td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      e.email_type === 'morning' ? 'bg-amber-500/10 text-amber-400' :
                      e.email_type === 'afternoon' ? 'bg-blue-500/10 text-blue-400' :
                      e.email_type === 'nightly' ? 'bg-indigo-500/10 text-indigo-400' :
                      'bg-cyan-500/10 text-cyan-400'
                    }`}>{e.email_type}</span>
                  </td>
                  <td className="px-4 py-2 text-white/60 truncate max-w-[200px]">{e.subject}</td>
                  <td className="px-4 py-2">
                    <span className={e.status === 'sent' ? 'text-green-400' : 'text-red-400'}>
                      {e.status}
                    </span>
                  </td>
                </tr>
              ))}
              {(!recentEmails || recentEmails.length === 0) && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-white/30">No emails sent yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

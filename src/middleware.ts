import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico (favicon)
     * - public files (icons, manifest, sw.js)
     */
    '/((?!_next/static|_next/image|favicon.ico|icon-.*|manifest.json|sw.js|timer-worker.js).*)',
  ],
};

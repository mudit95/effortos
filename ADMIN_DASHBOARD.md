# Admin Dashboard

## Setup

1. Run the new migration in Supabase:
   ```
   supabase/migrations/004_admin_dashboard.sql
   ```
   This adds `profiles.is_admin`, and three new tables: `coupons`,
   `coupon_redemptions`, `site_content`.

2. Promote yourself to admin from the SQL editor:
   ```sql
   update profiles set is_admin = true where email = 'mudit.mohilay@encora.com';
   ```

3. Visit `/admin` — the middleware redirects non-admins to `/dashboard`.

## Routes

- `/admin` — overview with at-a-glance stats
- `/admin/users` — list, search, extend trial (+days), grant premium (+months), toggle admin
- `/admin/coupons` — create / disable coupons
- `/admin/metrics` — signups, DAU, conversion, MRR estimate
- `/admin/content` — edit keyed site copy (landing hero, paywall, etc.)

## Coupon kinds

- `percent_off` — returns percent to UI at checkout. Fully wiring into Razorpay
  requires attaching a Razorpay Offer ID; currently the UI shows the discount
  to the user. Follow-up: pre-create Razorpay Offers and map coupon code → offer_id.
- `trial_extension` — extends `subscriptions.trial_ends_at` by N days immediately.
- `free_months` — sets `subscriptions.status = 'active'` and pushes
  `current_period_end` out by N months immediately.

## APIs

- `POST /api/admin/users/extend-trial` — `{ userId, days }`
- `POST /api/admin/users/grant-premium` — `{ userId, months }`
- `POST /api/admin/users/set-admin` — `{ userId, isAdmin }`
- `POST /api/admin/coupons` — create coupon
- `PATCH /api/admin/coupons` — toggle active
- `PUT /api/admin/content` — upsert content key
- `DELETE /api/admin/content` — delete content key
- `GET /api/admin/content` — public read of all keys (for frontend hydration)
- `POST /api/coupons/redeem` — `{ code }` (user-side, used by paywall)

## Phase 2 (not yet built)

- Razorpay Offer IDs for percent_off at checkout
- System health panel, announcements, feature flags, error logs, admin audit trail

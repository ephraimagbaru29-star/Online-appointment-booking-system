# Online Appointment Booking System

A responsive web application that lets customers view available appointment
slots and book a service online, while service providers manage availability,
review bookings, and confirm/reschedule/cancel appointments from a staff
dashboard.

Built to the project proposal:
- **Frontend:** HTML, CSS, JavaScript (responsive, no framework)
- **Backend:** Node.js + Express (API routes, availability checks, booking rules)
- **Database & authentication:** Supabase (PostgreSQL + Supabase Auth)

---

## Features (per the proposal)

- Customer registration and secure sign-in (Supabase Auth).
- Service list with description and appointment duration.
- Provider availability settings for working days, hours and optional breaks.
- Available time-slot display based on working hours and existing **active** bookings.
- Appointment booking form with customer name and contact details (note).
- Booking statuses: **Pending → Confirmed → Completed / Cancelled**.
- Staff dashboard with date, service and status filters.
- Customer dashboard showing upcoming and past appointments.
- Reschedule and cancellation workflow with clear status updates.
- **Conflict prevention:** two customers cannot book overlapping times with
  the same provider (transaction-safe, database-level check).

---

## Project structure

```
.
├── backend/                  # Node.js + Express API (also serves the frontend)
│   ├── package.json
│   ├── .env.example
│   ├── server.js              # entry point
│   └── src/
│       ├── app.js             # Express app (helmet, CORS, routes, static)
│       ├── config/            # env + Supabase clients (service-role + anon)
│       ├── middleware/        # auth (JWT + role), error handling
│       ├── routes/            # auth, profile, services, availability, slots, appointments, staff
│       ├── services/          # bookingEngine (slots + conflict prevention)
│       └── utils/             # time + http helpers
├── frontend/                 # static HTML/CSS/JS
│   ├── index.html             # sign in / sign up
│   ├── css/styles.css
│   ├── js/                    # api, auth, ui, booking, dashboards, services, availability
│   ├── customer/              # dashboard.html, book.html
│   └── staff/                 # dashboard.html, services.html, availability.html
├── supabase/migrations/
│   └── 0001_initial_schema.sql  # 4 tables + RLS + triggers + booking RPCs
└── README.md
```

---

## Prerequisites

- A free [Supabase](https://supabase.com) project.
- Node.js 18+ (built and tested on Node 22) and npm.
- If hosting separately: any static host for the frontend and a Node host for
  the backend.

---

## Setup

### 1. Create the database schema

In your Supabase dashboard, open the **SQL Editor**, create a new query, paste
the contents of `supabase/migrations/0001_initial_schema.sql`, and run it.

This creates the four tables — `profiles`, `services`, `availability`,
`appointments` — plus Row Level Security policies, a trigger that auto-creates
a customer profile on sign-up, and the `book_appointment` /
`reschedule_appointment` functions that prevent double-booking atomically.

### 2. Configure the backend

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env` and fill in your Supabase project values (Project Settings → API):

| Variable | Where to find it |
|---|---|
| `SUPABASE_URL` | Project Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Project Settings → API → `anon` `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → `service_role` **secret** key |
| `SCHEDULE_TIMEZONE` | IANA tz for the provider's schedule, e.g. `Africa/Lagos`, `Europe/London` |

> **Auth note:** sign-up is handled server-side with the service role key and
> creates a user with email confirmation bypassed, so customers can sign in
> immediately. If you prefer email confirmation, switch the backend to
> Supabase's `signUp` flow instead.

### 3. Install and run

```bash
cd backend
npm install
npm start
```

The API and frontend are both served from the same origin:
**http://localhost:4000**

- Frontend (sign in): http://localhost:4000/
- Customer booking: http://localhost:4000/customer/book.html
- Staff dashboard: http://localhost:4000/staff/dashboard.html

For development with auto-restart: `npm run dev`.

### 4. Make the first user a staff member

The first account you sign up is a **customer**. To manage services,
availability and bookings you need the **staff** role. After signing up once,
run this in the Supabase SQL Editor:

```sql
update public.profiles
set role = 'staff'
where email = 'you@example.com';
```

Then sign out and sign back in. Staff can also promote other users from the
API (`POST /api/staff/promote`) — see the API reference below.

### 5. Configure the provider

As a staff member:
1. **Services** (`/staff/services.html`) — add the services you offer with a
   duration in minutes.
2. **Availability** (`/staff/availability.html`) — set working days, start/end
   times and an optional break per day.

Customers can now book at `/customer/book.html`.

---

## API reference

All `/api` routes (except `/auth/*` and `/health`) require `Authorization:
Bearer <jwt>`. The frontend obtains the JWT at sign-in and attaches it
automatically.

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/api/health` | – | Service health & config |
| POST | `/api/auth/signup` | – | Create account, returns JWT + profile |
| POST | `/api/auth/signin` | – | Sign in, returns JWT + profile |
| POST | `/api/auth/signout` | – | Sign out (client discards token) |
| GET | `/api/auth/me` | auth | Current profile |
| GET/PATCH | `/api/profile/me` | auth | Read/update own profile |
| GET | `/api/services?all=true` | auth | List services (staff sees inactive with `all=true`) |
| GET | `/api/services/:id` | auth | One service |
| POST | `/api/services` | staff | Create service |
| PUT | `/api/services/:id` | staff | Update service |
| PATCH | `/api/services/:id/active` | staff | Activate/deactivate |
| DELETE | `/api/services/:id` | staff | Deactivate (soft delete) |
| GET | `/api/availability?providerId=` | auth | A provider's working hours |
| GET | `/api/availability/providers` | auth | List bookable staff |
| POST | `/api/availability` | staff | Upsert a working-day window (with breaks) |
| DELETE | `/api/availability/:id` | staff | Remove a working day |
| GET | `/api/slots?serviceId=&providerId=&date=` | auth | Available slots for a date |
| POST | `/api/appointments` | auth | Create a booking (conflict-checked) |
| GET | `/api/appointments?date&service_id&status&provider_id` | auth | List (customers: own; staff: all) |
| GET | `/api/appointments/:id` | auth | One appointment (own or staff) |
| POST | `/api/appointments/:id/cancel` | auth | Cancel (own, or staff) |
| PATCH | `/api/appointments/:id/status` | staff | Confirm / complete / cancel |
| POST | `/api/appointments/:id/reschedule` | staff | Reschedule (re-checked) |
| GET | `/api/staff` | staff | List staff |
| POST | `/api/staff/promote` | staff | Grant staff access (`{user_id}` or `{email}`) |
| POST | `/api/staff/demote` | staff | Revoke staff access |

---

## Booking rules & conflict prevention

Implemented exactly as the proposal specifies (section 10):

- Only slots within the provider's configured working hours are shown.
- Bookings in the past are rejected.
- The server re-checks availability before saving — two users cannot reserve
  the same slot.
- The check + insert run **inside a single Postgres transaction** in the
  `book_appointment` function (`SECURITY DEFINER`), which locks the provider
  row and re-tests for overlaps before inserting. This is the
  transaction-safe operation that prevents simultaneous requests from
  double-booking.
- Cancelled appointments no longer block the slot (excluded from the overlap
  test).
- One schedule time zone is used throughout and shown to customers.

---

## Security (section 11)

- Authentication is required for customer and staff dashboards.
- Customers can only access their own appointment records; staff access is
  role-restricted (enforced in middleware and RLS policies).
- Service IDs, dates, times and contact details are validated on the server.
- No payment-card details are stored (out of scope for v1).
- Secret keys (the Supabase service role key) are kept server-side; only the
  anon key is ever exposed (it is public by design and protected by RLS).
- Helmet sets security headers; CORS is restricted to the configured
  `FRONTEND_ORIGIN`. Use HTTPS in production.

---

## Limitations & future enhancements (section 16)

The first release manages appointment scheduling only. Online payments, SMS
reminders, calendar synchronisation, multiple branches and automated
waitlists are outside the initial scope and can be added later.

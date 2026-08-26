# Supabase setup (one-time)

1. Create a free account at https://supabase.com and a new project.
2. In the project, open **SQL Editor** → paste the contents of `schema.sql` → **Run**.
3. Open **Authentication → Users → Add user**. Create ONE user with an email +
   password. Turn OFF "email confirmation" for this user (Authentication →
   Providers → Email → disable "Confirm email"), or confirm it, so it can log in.
4. Open **Project Settings → API**. Copy the **Project URL** and the **anon
   public** API key.
5. Enter URL + anon key + the user's email/password:
   - Desktop: Settings tab → Cloud Sync section.
   - Phone: Cloud login screen.

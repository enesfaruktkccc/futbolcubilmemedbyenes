# Ultimate Football Arena — Online V3 foundation

This folder is the online-ready branch of the existing `futbolcubilmemedbyenes` repository. It keeps the current V2 game intact and adds a new `/v3/` app with Turkish responsive navigation, Supabase Auth UI (sign up, sign in, sign out, password reset), registered-player discovery, friend requests, friend-only DMs, presence, rooms, room invites, room chat, and an original 21-mode catalogue based on the reference game's public mechanics.

## Set up Supabase

1. Create or choose the Supabase project for this app.
2. In SQL Editor, run `supabase.sql` once.
3. In Authentication → URL Configuration, allow the deployed site's URL and its `/v3/` callback URL.
4. Put the project URL and the **public anon/publishable key** in `config.js`.
5. Serve from a web server (modules do not run from `file://`) or publish the repository on GitHub Pages. The existing repository Node server can also serve the folder.

Do not use the `service_role` key in `config.js`, HTML, or any browser bundle. The SQL intentionally prevents clients from inserting, editing, or deleting competitive game results and score totals. A server-side Edge Function/game engine must be added before competitive XP can be issued.

## Current implementation limits

- The new Auth, profile, player list, friend request, DM, presence, room, invite and lobby chat paths call Supabase; they require the schema and project config above.
- Password reset uses Supabase email delivery and requires correct Auth redirect URLs and SMTP settings.
- The catalogue covers the 17 solo and 4 multiplayer modes listed by the reference site, plus this product's arena styling. The current standalone playable game implementation is a small Futbol IQ question round. Other mechanics are catalogued and need their own game engines; the 4 multiplayer modes have room/invite support but are not synchronized competitive games yet.
- No sample chat, fake users, fake match scores, or fake leaderboard seed is included in V3.
- Realtime presence is ephemeral. A stable online indicator depends on a connected browser tab and Supabase Realtime.
- Verified live scores/player images are not connected. The site reference's branding, artwork and copy are not reused.

## Verify

Use two real Supabase accounts in separate browsers to verify signup/email confirmation, presence, friend requests, direct messages, room invites and lobby chat. Automated syntax and SQL policy review are expected before merge. Do not treat this foundation as production-ready competitive multiplayer until server-side game state/result validation and moderation controls are implemented.


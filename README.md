# Daily Diary – a simple calendar display for someone living with dementia

Two parts:

| Part | Address | Who uses it |
|---|---|---|
| **Display** | `/` | The tablet: Firefox in kiosk mode, full screen |
| **Admin panel** | `/admin` | Family and carers, from any phone or computer |

## What the display does

- **Home screen:** "Good afternoon, Margaret – Today is **Thursday**, 26th November 2026", a big clock, "It is afternoon", any **home messages** that are due right now (see below) and **today's plan**:
  - things already finished are greyed out and marked **Earlier**
  - the thing happening now is yellow and marked **Now**
  - the next thing is outlined and marked **Next**
  - a short line about **tomorrow**
- **◀ Yesterday** and **Tomorrow ▶** buttons step through the days one at a time (up to 7 days back). Stepping back to today returns to the home screen.
- **"See the next 4 weeks"** opens a calendar grid. Today is yellow, and Saturdays and Sundays have a red box. Each day shows a number for how many diary entries it has. Entries with the ⭐ picture count as routine (e.g. carer visits): they aren't counted and don't turn a day blue, but still show on the home and day screens. Days with something special on are blue, with a picture and the first item's name. Routines that happen every day or every weekday (carer visits, tablets) don't turn days blue, otherwise every day would look the same. They still appear on the day screens.
- **Touching a day** shows that day's full list ("Wednesday 2nd December – In 6 days"), with Day before / Next day buttons.
- **After 5 minutes without a touch** it goes back to the home screen showing today (the time can be changed in Settings).
- It checks for changes every minute, so updates from the admin panel show up within about a minute. If the internet drops, it keeps showing the last saved diary.
- At midnight it moves to the new day by itself. It asks the tablet to keep the screen on where the browser supports this, and blocks long-press menus and zooming.

## What the admin panel does

- **Diary:** add, edit or delete entries. Each entry has a title, a picture, a date, optional start and end times (no time means "All day"), optional details, and an "important" flag (red border).
  - **Repeats:** every day, weekdays, weekly, every 2 weeks, monthly, yearly, with an optional end date.
  - **Skip this day:** remove one date of a repeating entry (e.g. no carer visit on Christmas Day) without changing the others. Skipped dates can be put back.
  - "Coming up" lists the next 2 weeks to 3 months as the tablet will show them, with an option to hide everyday routines.
  - Each entry records who added it and who last changed it.
- **Home messages:** notes shown on the left of the home screen. Each one is shown on the chosen days of the week, either all day (permanent) or between set times, e.g. "Julie the carer comes at 9" on weekdays 7–9:30 am. A time range that crosses midnight (9 pm until 7 am) runs overnight into the next morning. Messages can be formatted with bold, italic, underline, text size, colour, highlight, centring and bullet lists, or edited as HTML. Only formatting is kept: links, pictures, scripts and the like are removed, so the tablet can't be taken off the diary. Messages can be switched off without deleting them. Up to 3 show at once, timed ones first.
- **Settings:** name to greet, inactivity timeout, number of weeks shown, 12- or 24-hour clock, and the tablet's display link.
- **People:** add or remove the people who can log in, and change your own password.

## Running it

You need Node.js 10.12 or newer (16 or newer recommended). There are no other dependencies.

```bash
cd dementia-diary
ADMIN_PASSWORD='choose-a-good-password' node server.js
```

On first run it creates the user `admin` and prints the **display link**. The data is kept in `data/db.json`, so back up that one file.

Options (environment variables):

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Port to listen on |
| `HOST` | `0.0.0.0` | Interface to listen on |
| `DATA_DIR` | `./data` | Where `db.json` is stored |
| `ADMIN_PASSWORD` | random (printed) | Password for the first `admin` user |
| `SECURE_COOKIE` | off | Set to `1` when served over HTTPS (it should be) |
| `TRUST_PROXY` | off | Set to `1` behind a reverse proxy, so login rate limiting sees real IPs |

Command-line helpers:

```bash
node server.js add-user Sarah 'her-password'     # add a user, or reset their password
node server.js remove-user Sarah
node server.js show-display-link
```

### Putting it online so family can update it remotely

The tablet and the admin users all need to reach the server. Some options:

- **Small cloud server / VPS** (cheapest reliable option): run `node server.js` behind Caddy or nginx for HTTPS. With Caddy the whole config is `diary.example.co.uk { reverse_proxy localhost:8080 }`. Set `SECURE_COOKIE=1 TRUST_PROXY=1`.
- **Raspberry Pi or home PC** plus a tunnel (Cloudflare Tunnel or Tailscale Funnel) for HTTPS without opening router ports.
- Keep it running with `systemd` or `pm2`. A sample systemd unit:

```ini
[Unit]
Description=Daily Diary
After=network.target

[Service]
WorkingDirectory=/opt/dementia-diary
ExecStart=/usr/bin/node server.js
Environment=PORT=8080 SECURE_COOKIE=1 TRUST_PROXY=1
Restart=always
User=diary

[Install]
WantedBy=multi-user.target
```

## Setting up the tablet

1. In the admin panel, go to **Settings → Tablet display link** and open that link **once** in Firefox on the tablet. The tablet remembers the key, and the key is removed from the address bar.
2. Set Firefox's home page to the plain address (`https://diary.example.co.uk/`).
3. Put the tablet into kiosk mode, e.g. with a kiosk launcher app (Fully Kiosk, SureLock, or Android's built-in **screen pinning**).
4. Recommended Android settings:
   - Screen timeout: never, or the longest available. Use "Stay awake while charging" in Developer options.
   - Keep it on the charger.
   - Turn off notifications, system updates during the day, and auto-rotate (lock to landscape).
   - Turn off Firefox's pull-to-refresh and its "Open in app" prompts.

If the tablet ever shows **"This screen needs setting up"**, open the display link on it again. This happens if the browser data was cleared or someone pressed "Make a new key".

## Security notes

- Passwords are hashed with scrypt. Login sessions last 30 days, in HttpOnly SameSite=Strict cookies. Five wrong passwords lock that IP out for 5 minutes.
- The display needs no password but does need the secret display key, so someone who only knows the web address can't read the diary. "Make a new key" in Settings revokes the old one.
- Every logged-in user can do everything, including adding and removing other users. Only give logins to people you trust.
- Use HTTPS when it is on the internet.

## Files

```
server.js            web server, API and storage (no dependencies)
public/index.html    tablet display
public/display.css   display styling (sizes scale to the screen)
public/display.js    display logic: views, idle timer, polling
public/admin.*       admin panel
public/shared.js     date and repeat logic shared by all three
data/db.json         all data (created on first run)
```

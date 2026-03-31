# Hellenic Cosmetics — OpenClaw Booking Manager Setup Plan

> **Purpose:** Replace the admin.html web dashboard with an AI assistant that manages bookings via Telegram. The salon owner talks to her OpenClaw instance (via Telegram) to view, confirm, reschedule, and delete bookings. OpenClaw also sends all customer emails directly — no SendGrid needed.

---

## Architecture Overview

```
Customer → helleniccosmetics.com → Netlify Function → Turso DB (booking saved)
                                                          ↓
                                              OpenClaw polls DB periodically
                                                          ↓
                                              Notifies salon owner via Telegram
                                                          ↓
                                    Owner replies: "confirm" / "reschedule" / "delete"
                                                          ↓
                                              OpenClaw updates DB + sends email to customer
```

**Key difference from the old system:** OpenClaw sends ALL emails (enquiry acknowledgements, confirmations, cancellations). The Netlify functions only handle saving bookings to the database — no email sending.

---

## Credentials (Chris will provide these)

1. **Turso Database:**
   - URL: `libsql://bookings-cskar10.aws-ap-northeast-1.turso.io`
   - Auth Token: eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NzQ5MTUyMDAsImlkIjoiMDE5ZDQxMjktNWMwMS03NDUxLWI0ZjktNDI4YjA3NjE4NmEwIiwicmlkIjoiYzdkMzRmNTctMDI3MC00NzY1LWJiMzAtYTgyYjEwZDY2YTgxIn0.BR_qjVjYOZlLYw8FzkqPwxC_8-KasHaef2dfzcYun2jHpkEk8Isoctk1P_wp1Mdpnz04kvwYvGSge7vrnTNHBg

2. **Email sending:** OpenClaw sends emails directly using its own email tools or via a configured SMTP account (e.g., Gmail with app password for `hellenic.cosmetics@gmail.com`)

3. **Admin email:** `hellenic.cosmetics@gmail.com`
   **password:** '@HellenicC01'

---

## Database (Turso/LibSQL)

### Connecting to the database
Use the Turso HTTP API to query:
```bash
curl -s -X POST "https://bookings-cskar10.aws-ap-northeast-1.turso.io/v2/pipeline" \
  -H "Authorization: Bearer [AUTH_TOKEN]" \
  -H "Content-Type: application/json" \
  -d '{"requests":[{"type":"execute","stmt":{"sql":"SELECT * FROM bookings"}},{"type":"close"}]}'
```

### Table: `bookings`
| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment booking ID |
| `name` | TEXT | Customer name |
| `email` | TEXT | Customer email |
| `phone` | TEXT | Customer phone |
| `service` | TEXT | Service name (see list below) |
| `appointment_datetime_local` | TEXT | Melbourne local time (`YYYY-MM-DD HH:MM:SS`) |
| `appointment_datetime_utc` | TEXT | UTC ISO timestamp |
| `created_at` | TEXT | ISO timestamp when booking was created |

**Unique constraint:** `(email, appointment_datetime_utc)` — prevents duplicate bookings.

### Table: `booking_locks`
| Column | Type | Description |
|--------|------|-------------|
| `email` | TEXT PK | Prevents multiple pending enquiries from the same email |

**IMPORTANT:** When a booking is **confirmed or deleted**, the corresponding lock in `booking_locks` MUST also be deleted, otherwise the customer can never book again.

---

## Services & Durations

| Service | Duration (minutes) |
|---------|-------------------|
| Brow Sculpt | 45 |
| Brow Sculpt & Dye | 60 |
| Brow Sculpt & Lamination | 70 |
| Brow Sculpt, Dye & Lamination | 90 |
| Male Brow Sculpting | 40 |
| Lash Filler Lash Lift & Tint | 80 |
| Korean Lash Lift & Tint | 90 |
| Lash Filler or Korean Lash Lift, Brow Lamination, Sculpt & Dye | 150 |
| Lash Filler or Korean Lash Lift, Brow Lamination & Sculpt | 135 |

---

## Operating Hours

- **Monday–Friday:** 5:30 PM – 9:00 PM
- **Sunday:** 10:00 AM – 4:00 PM
- **Saturday:** CLOSED
- **Timezone:** Australia/Melbourne (AEST/AEDT)
- **Minimum notice:** 48 hours in advance

---

## Step-by-Step Setup

### Step 1: Install OpenClaw on Windows

1. Install Node.js (v18+) from https://nodejs.org
2. Open PowerShell and run:
   ```
   npm install -g openclaw
   openclaw configure
   ```
3. During configuration:
   - Set up a Telegram bot (create one via @BotFather on Telegram)
   - Set the AI model (GitHub Copilot with Claude recommended)
   - Set workspace directory (default is fine)

### Step 2: Set Up Telegram Bot

1. Open Telegram, message @BotFather
2. Send `/newbot`
3. Name it something like "Hellenic Bookings"
4. Copy the bot token — you'll need it during `openclaw configure`
5. The salon owner messages the bot to start chatting

### Step 3: Set Up Email Sending

The OpenClaw instance needs to send emails to customers. Options:

**Option A — Gmail SMTP (simplest):**
1. Use `hellenic.cosmetics@gmail.com` with an App Password
2. Go to Google Account → Security → 2-Step Verification → App Passwords
3. Generate an app password for "Mail"
4. OpenClaw can send emails using curl + Gmail SMTP or a Node.js email script

**Option B — Use OpenClaw's built-in email tools if available**

Store the email credentials in the TOOLS.md file (see below).

### Step 4: Create Workspace Files

In the OpenClaw workspace directory, create these files:

#### `SOUL.md`
```markdown
# SOUL.md

You are the booking manager for **Hellenic Cosmetics**, a brow and lash salon in South Morang, Melbourne.

## Your Role
- Monitor the Turso database for new booking enquiries
- Notify the salon owner via Telegram when new bookings arrive
- Let her confirm, reschedule, or delete bookings through conversation
- Send emails to customers (enquiry acknowledgements, confirmations, cancellations)
- Provide daily schedule summaries

## Personality
- Professional but warm — you represent a beauty business
- Concise — the owner is busy with clients
- Proactive — alert her about new bookings, don't wait to be asked

## Important Rules
- All times are Melbourne time (AEST/AEDT)
- When confirming a booking, ALWAYS delete the booking lock (booking_locks table)
- When deleting a booking, ALSO delete the booking lock
- Include a calendar invite (.ics) attachment when confirming bookings
- Never modify the database schema
- Never share database credentials or customer personal info outside Telegram
- Send from: "Hellenic Cosmetics" <hellenic.cosmetics@gmail.com>
```

#### `USER.md`
```markdown
# USER.md

- **Name:** [Salon owner's first name]
- **Role:** Owner/operator of Hellenic Cosmetics
- **Timezone:** Australia/Melbourne
- **Contact:** Via this Telegram bot
```

#### `TOOLS.md`
```markdown
# TOOLS.md — Booking System Configuration

## Turso Database
- URL: libsql://bookings-cskar10.aws-ap-northeast-1.turso.io
- Auth Token: [eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NzQ5MTUyMDAsImlkIjoiMDE5ZDQxMjktNWMwMS03NDUxLWI0ZjktNDI4YjA3NjE4NmEwIiwicmlkIjoiYzdkMzRmNTctMDI3MC00NzY1LWJiMzAtYTgyYjEwZDY2YTgxIn0.BR_qjVjYOZlLYw8FzkqPwxC_8-KasHaef2dfzcYun2jHpkEk8Isoctk1P_wp1Mdpnz04kvwYvGSge7vrnTNHBg]

### Quick query command:
```bash
curl -s -X POST "https://bookings-cskar10.aws-ap-northeast-1.turso.io/v2/pipeline" \
  -H "Authorization: Bearer [TOKEN]" \
  -H "Content-Type: application/json" \
  -d '{"requests":[{"type":"execute","stmt":{"sql":"YOUR_SQL_HERE"}},{"type":"close"}]}'
```

## Email
- From: Hellenic Cosmetics <hellenic.cosmetics@gmail.com>
- SMTP: smtp.gmail.com:587
- Password: [@HellenicC01]
```

#### `HEARTBEAT.md`
```markdown
# Heartbeat Tasks

## Check for new bookings
- Query the Turso database for bookings created in the last 30 minutes
- SQL: SELECT * FROM bookings WHERE created_at > datetime('now', '-30 minutes') ORDER BY created_at DESC
- If new bookings found: notify the owner with details (name, service, date, time, phone)
- Format as a friendly summary, not raw data
- Also send an enquiry acknowledgement email to the customer
```

### Step 5: Test the Connection

Ask the agent to query the database:
```
"Check if the database is working"
```
It should run the curl command and return results.

### Step 6: Booking Workflows

The agent should handle these conversations naturally:

#### New Booking Notification (proactive via heartbeat)
When a new booking is detected:
```
📋 New booking enquiry!

Name: Sarah Johnson
Service: Brow Sculpt & Dye (60 min)
Date: Thursday 3 April, 5:30 PM
Phone: 0412 345 678
Email: sarah@email.com

Reply: "confirm 1", "reschedule 1 to [date] [time]", or "delete 1"
```

Also send an acknowledgement email to the customer (see email templates below).

#### "What bookings do I have today?"
Query and format as a readable list.

#### "Confirm booking #[id]" or "confirm 1"
1. Fetch the booking from Turso
2. Delete the booking lock: `DELETE FROM booking_locks WHERE email = '[email]'`
3. Send confirmation email to customer with .ics calendar invite attached
4. Notify the owner: "✅ Booking #1 confirmed. Email sent to Sarah."

#### "Reschedule booking #[id] to [new date] at [new time]"
1. Update: `UPDATE bookings SET appointment_datetime_local = '[date] [time]:00' WHERE id = [id]`
2. Delete the booking lock
3. Send confirmation email with the NEW date/time
4. Notify the owner: "✅ Booking #1 rescheduled to Friday 4 April at 6:00 PM. Email sent."

#### "Delete booking #[id]"
1. Get the email first
2. Delete the booking: `DELETE FROM bookings WHERE id = [id]`
3. Delete the lock: `DELETE FROM booking_locks WHERE email = '[email]'`
4. Optionally send cancellation email to customer
5. Notify the owner: "🗑️ Booking #1 deleted."

### Step 7: Parameterized Queries via Turso HTTP API

For queries with user data, use parameterized statements to prevent SQL injection:
```json
{
  "requests": [
    {
      "type": "execute",
      "stmt": {
        "sql": "SELECT * FROM bookings WHERE id = ?",
        "args": [{"type": "integer", "value": "1"}]
      }
    },
    {"type": "close"}
  ]
}
```

For text args:
```json
{"type": "text", "value": "sarah@email.com"}
```

### Step 8: Delete the Admin Page

Once everything is working:
1. Remove `admin.html` and `login.html` from the website
2. Remove the `getBookings.js` and `deleteBooking.js` Netlify functions
3. Remove `confirm-booking.js` (OpenClaw now handles confirmations)
4. Remove the Netlify Identity widget scripts from `index.html` if present
5. Remove `jsonwebtoken` from package.json dependencies
6. Update `netlify.toml` to remove the `/admin` redirect
7. Push changes to git

---

## Email Templates

### Enquiry Acknowledgement (sent when new booking detected)
**Subject:** Your Appointment Enquiry - [SERVICE]
```html
<div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
  <p>Dear [NAME],</p>
  <p>Thank you for your appointment enquiry with <strong>Hellenic Cosmetics</strong>.</p>
  <p><strong>Requested Date:</strong> [DATE]<br>
  <strong>Requested Time:</strong> [TIME]<br>
  <strong>Service:</strong> [SERVICE]<br>
  <strong>Phone:</strong> [PHONE]</p>
  <p>Your enquiry has been received. Our team will contact you shortly to confirm availability.</p>
  <hr style="margin: 25px 0;">
  <h3 style="color: #b8926a;">Future Bookings Policy</h3>
  <p>
    - A non-refundable deposit is required to secure your booking.<br>
    - Appointments may be rescheduled once with 48 hours' notice.<br>
    - Cancellations within 48 hours or no-shows forfeit the deposit.<br>
    - Please arrive on time. Late arrivals may need rescheduling.<br>
    - Frequent last-minute changes may affect future booking availability.
  </p>
  <hr style="margin: 25px 0;">
  <p style="text-align: center; color: red; font-weight: bold;">
    Please note: This email is an acknowledgement of your enquiry only.<br>
    A booking confirmation will follow within 48 hours.
  </p>
  <p>We look forward to welcoming you at our Melbourne studio.</p>
  <p><strong>Warm regards,</strong><br>
  <strong>Hellenic Cosmetics</strong></p>
</div>
```

### Confirmation Email (sent when owner confirms)
**Subject:** Your Appointment is Confirmed
```html
<div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
  <p>Dear [NAME],</p>
  <p>We are pleased to confirm your appointment with <strong>Hellenic Cosmetics</strong>.</p>
  <p><strong>Appointment Date:</strong> [DATE]<br>
  <strong>Appointment Time:</strong> [TIME]<br>
  <strong>Service:</strong> [SERVICE]<br>
  <strong>Phone:</strong> [PHONE]</p>
  <p>Your appointment has been confirmed. Please find your calendar invite attached.</p>
  <hr style="margin: 25px 0;">
  <h3 style="color: #b8926a;">Future Bookings Policy</h3>
  <p>
    - A non-refundable deposit is required to secure your booking.<br>
    - Appointments may be rescheduled once with 48 hours' notice.<br>
    - Cancellations within 48 hours or no-shows forfeit the deposit.<br>
    - Please arrive on time. Late arrivals may need rescheduling.<br>
    - Frequent last-minute changes may affect future booking availability.
  </p>
  <hr style="margin: 25px 0;">
  <p style="text-align: center; color: red; font-weight: bold;">
    This email confirms your appointment.
  </p>
  <p>We look forward to welcoming you at our Melbourne studio.</p>
  <p><strong>Warm regards,</strong><br>
  <strong>Hellenic Cosmetics</strong></p>
</div>
```

### ICS Calendar Invite Template
```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Hellenic Cosmetics//EN
CALSCALE:GREGORIAN
METHOD:REQUEST
BEGIN:VEVENT
UID:[BOOKING_ID]@helleniccosmetics.com
DTSTAMP:[NOW_UTC_FORMAT: YYYYMMDDTHHMMSSZ]
DTSTART:[START_UTC_FORMAT: YYYYMMDDTHHMMSSZ]
DTEND:[END_UTC_FORMAT: YYYYMMDDTHHMMSSZ]
SUMMARY:Confirmed Appointment - [SERVICE]
DESCRIPTION:Your appointment at Hellenic Cosmetics is confirmed.
ORGANIZER;CN=Hellenic Cosmetics:mailto:hellenic.cosmetics@gmail.com
ATTENDEE;CN=[NAME];ROLE=REQ-PARTICIPANT:mailto:[EMAIL]
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR
```

**UTC conversion:** Melbourne is UTC+10 (AEST) or UTC+11 (AEDT). DST starts first Sunday of October, ends first Sunday of April.

**Duration:** Use the service duration table above to calculate DTEND.

---

## Quick Reference

| Owner says | Agent does |
|-----------|-----------|
| "Show today's bookings" | Query DB, format as readable list |
| "Show this week" | Query DB for next 7 days |
| "Confirm #1" | Delete lock, send confirmation email with .ics |
| "Reschedule #1 to April 5 6pm" | Update DB, delete lock, send email |
| "Delete #1" | Delete booking + lock, notify owner |
| "How many bookings this month?" | COUNT query |
| "Any new bookings?" | Check recent entries |

---

## Notes

- The booking form on the website handles all validation (time windows, 48h notice, Saturday blocking) — the agent doesn't need to re-validate
- The `booking_locks` table prevents duplicate pending enquiries from the same email — ALWAYS clean up locks when confirming or deleting
- The website saves bookings to Turso. OpenClaw reads from Turso and manages everything else.
- SendGrid has been removed — OpenClaw sends all emails directly via Gmail SMTP
- Chris (the developer) can be reached for technical issues

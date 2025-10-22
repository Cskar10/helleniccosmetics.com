const { Client } = require("pg");
const sgMail = require("@sendgrid/mail");
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

exports.handler = async (event) => {
  try {
    const { id, action, newDate, newTime } = JSON.parse(event.body);

    const client = new Client({
      host: process.env.PGHOST,
      port: process.env.PGPORT,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      ssl: { rejectUnauthorized: false },
    });

    await client.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS booking_locks (
        email TEXT PRIMARY KEY
      );
    `);

    // Fetch existing booking
    const result = await client.query("SELECT * FROM bookings WHERE id=$1", [id]);
    if (result.rows.length === 0) {
      await client.end();
      return { statusCode: 404, body: JSON.stringify({ error: "Booking not found" }) };
    }

    let booking = result.rows[0];

    // If "change", update date/time
    if (action === "change") {
      if (!newDate || !newTime) {
        await client.end();
        return { statusCode: 400, body: JSON.stringify({ error: "Missing new date/time" }) };
      }

      await client.query(
        `UPDATE bookings SET appointment_datetime_local=$1 WHERE id=$2`,
        [`${newDate} ${newTime}:00`, id]
      );
      booking.appointment_datetime_local = `${newDate} ${newTime}:00`;
    }

    await client.query(
      `DELETE FROM booking_locks WHERE email = $1`,
      [booking.email.trim().toLowerCase()]
    );

    await client.end();

    // Build ICS calendar invite
    const startUtc = toUTCDate(booking.appointment_datetime_local);
    const durationMinutes = getServiceDuration(booking.service);
    const endUtc = new Date(
      startUtc.getTime() + durationMinutes * 60 * 1000
    );
    const icsContent = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Hellenic Cosmetics//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      `UID:${booking.id}@helleniccosmetics.com`,
      `DTSTAMP:${formatICSDate(new Date())}`,
      `DTSTART:${formatICSDate(startUtc)}`,
      `DTEND:${formatICSDate(endUtc)}`,
      `SUMMARY:${escapeICSText(`Confirmed Appointment - ${booking.service}`)}`,
      `DESCRIPTION:${escapeICSText("Your appointment at Hellenic Cosmetics is confirmed.")}`,
      `ORGANIZER;CN=Hellenic Cosmetics:mailto:bookings@helleniccosmetics.com`,
      `ATTENDEE;CN=${escapeICSText(booking.name)};ROLE=REQ-PARTICIPANT:mailto:${booking.email}`,
      "STATUS:CONFIRMED",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");

    const formattedDate = new Date(
      booking.appointment_datetime_local.split(" ")[0]
    ).toLocaleDateString("en-AU", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const msg = {
      to: booking.email,
      from: { email: "bookings@helleniccosmetics.com", name: "Hellenic Cosmetics" },
      subject: "Your Appointment is Confirmed",
      html: `
        <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
          <p>Dear ${booking.name},</p>

          <p>We are pleased to confirm your appointment with <strong>Hellenic Cosmetics</strong>.</p>

          <p><strong>Appointment Date:</strong> ${formattedDate}<br>
          <strong>Appointment Time:</strong> ${booking.appointment_datetime_local.split(" ")[1]}<br>
          <strong>Service:</strong> ${booking.service}<br>
          <strong>Phone:</strong> ${booking.phone || ""}</p>

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

          <p>We look forward to welcoming you at our Melbourne studio.<br>
          Please do not hesitate to reply to this email if you have any questions.</p>

          <p><strong>Warm regards,</strong><br>
          <strong>Hellenic Cosmetics</strong></p>
        </div>
      `,
      attachments: [
        {
          content: Buffer.from(icsContent).toString("base64"),
          filename: "appointment.ics",
          type: "text/calendar",
          disposition: "attachment",
        },
      ],
    };

    await sgMail.send(msg);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message:
          action === "change"
            ? "Booking updated and confirmation email sent."
            : "Booking accepted and confirmation email sent.",
      }),
    };
  } catch (err) {
    console.error("Confirm booking error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to confirm booking", details: err.message }),
    };
  }
};

const SERVICE_DURATIONS_MINUTES = {
  "Brow Sculpt": 45,
  "Brow Sculpt & Dye": 60,
  "Brow Sculpt & Lamination": 70,
  "Brow Sculpt, Dye & Lamination": 90,
  "Male Brow Sculpting": 40,
  "Lash Filler Lash Lift & Tint": 80,
  "Korean Lash Lift & Tint": 90,
  "Lash Filler or Korean Lash Lift, Brow Lamination, Sculpt & Dye": 150,
  "Lash Filler or Korean Lash Lift, Brow Lamination & Sculpt": 135,
};

function getServiceDuration(serviceName = "") {
  return SERVICE_DURATIONS_MINUTES[serviceName] || 60;
}

function toUTCDate(localDateTime) {
  const [datePart, timePart] = localDateTime.split(" ");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute, second] = timePart.split(":").map(Number);
  const offsetHours = getMelbourneOffset(year, month, day);
  return new Date(
    Date.UTC(year, month - 1, day, hour - offsetHours, minute, second || 0)
  );
}

function formatICSDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    "T" +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z"
  );
}

function escapeICSText(text = "") {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function getMelbourneOffset(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const dstStart = getFirstSunday(year, 10);
  const dstEnd = getFirstSunday(year + (month < 4 ? 0 : 1), 4);
  const isDST = date >= dstStart || date < dstEnd;
  return isDST ? 11 : 10;
}

function getFirstSunday(year, month) {
  const d = new Date(Date.UTC(year, month - 1, 1));
  while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}


const { Client } = require("pg");
const sgMail = require("@sendgrid/mail");

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

exports.handler = async (event) => {
  console.log("Incoming booking request:", event.body);

  try {
    const data = JSON.parse(event.body);
    const { name, email, date, time, service } = data;

    if (!name || !email || !date || !time || !service) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing required fields." }),
      };
    }

    // Parse date/time
    const [year, month, day] = date.split("-").map(Number);
    const [hour, minute] = time.split(":").map(Number);
    const melOffsetHours = getMelbourneOffset(year, month, day);

    const melbourneLocal = new Date(year, month - 1, day, hour, minute);
    const utcMillis = melbourneLocal.getTime() - melOffsetHours * 60 * 60 * 1000;
    const utcDate = new Date(utcMillis);

    const melbourneForDB = `${year}-${String(month).padStart(2, "0")}-${String(
      day
    ).padStart(2, "0")} ${String(hour).padStart(2, "0")}:${String(minute).padStart(
      2,
      "0"
    )}:00`;
    const utcForDB = utcDate.toISOString();

    // Rule 1: 48-hour minimum notice
    const nowMelbourne = new Date(
      new Date().getTime() + melOffsetHours * 60 * 60 * 1000
    );
    const hoursDifference = (melbourneLocal - nowMelbourne) / (1000 * 60 * 60);
    if (hoursDifference <= 48) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error:
            "Appointments must be booked at least 48 hours in advance. Please select a later date.",
        }),
      };
    }

    const dayOfWeek = melbourneLocal.getDay(); // 0 = Sunday, 6 = Saturday
    const isSunday = dayOfWeek === 0;

    // Rule 2: Booking time windows (Mon-Sat 5:30pm-9pm, Sun 10am-4pm)
    const withinWeekdayHours =
      (hour > 17 || (hour === 17 && minute >= 30)) &&
      (hour < 21 || (hour === 21 && minute === 0));
    const withinSundayHours =
      (hour > 10 || (hour === 10 && minute >= 0)) &&
      (hour < 16 || (hour === 16 && minute === 0));

    const isWithinAllowedHours = isSunday ? withinSundayHours : withinWeekdayHours;

    if (!isWithinAllowedHours) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error:
            "Bookings are available Monday-Saturday from 5:30 PM to 9:00 PM, and Sundays from 10:00 AM to 4:00 PM.",
        }),
      };
    }
    // Step 3: Connect to PostgreSQL
    const client = new Client({
      host: process.env.PGHOST,
      port: process.env.PGPORT,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      ssl: { rejectUnauthorized: false },
    });

    await client.connect();
    const insertQuery = `
      INSERT INTO bookings 
        (name, email, service, appointment_datetime_local, appointment_datetime_utc, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (email, appointment_datetime_utc) DO NOTHING
      RETURNING *;
    `;
    const values = [name, email, service, melbourneForDB, utcForDB];
    const result = await client.query(insertQuery, values);

    if (result.rowCount === 0) {
      await client.end();
      return {
        statusCode: 409,
        body: JSON.stringify({
          error:
            "You already have a pending enquiry for this email and time slot. Please wait for a confirmation or choose a different time.",
        }),
      };
    }

    const booking = result.rows[0];
    await client.end();

    const adminEmail = process.env.ADMIN_EMAIL;
    const formattedDate = new Date(date).toLocaleDateString("en-AU", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    // Policy text
    const policyText = `
Future Bookings Policy:
• A non-refundable deposit is required to secure your booking.
• Appointments may be rescheduled once with 48 hours' notice.
• Cancellations within 48 hours or no-shows forfeit the deposit.
• Please arrive on time. Late arrivals may need rescheduling.
• Frequent last-minute changes may affect future booking availability.
`;

    // Unified clean design
    const msg = {
      to: email,
      cc: adminEmail,
      from: { email: "bookings@helleniccosmetics.com", name: "Hellenic Cosmetics" },
      subject: `Your Appointment Enquiry – ${service}`,
      html: `
        <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
          <p>Dear ${name},</p>

          <p>Thank you for your appointment enquiry with <strong>Hellenic Cosmetics</strong>.</p>

          <p><strong>📅 Requested Date:</strong> ${formattedDate}<br>
          <strong>🕒 Requested Time:</strong> ${time}<br>
          <strong>💆 Service:</strong> ${service}</p>

          <p>Your enquiry has been received. Our team will contact you shortly to confirm availability.</p>

          <hr style="margin: 25px 0;">

          <h3 style="color: #b8926a;">Future Bookings Policy</h3>

          <p>
            • A non-refundable deposit is required to secure your booking.<br>
            • Appointments may be rescheduled once with 48 hours' notice.<br>
            • Cancellations within 48 hours or no-shows forfeit the deposit.<br>
            • Please arrive on time. Late arrivals may need rescheduling.<br>
            • Frequent last-minute changes may affect future booking availability.
          </p>

          <hr style="margin: 25px 0;">

          <p style="text-align: center; color: red; font-weight: bold;">
            ⚠️ Please note: This email is an acknowledgement of your enquiry only.<br>
            A booking confirmation will follow within 48 hours.
          </p>

          <p>We look forward to welcoming you at our Melbourne studio.<br>
          Please don’t hesitate to reply to this email if you have any questions.</p>

          <p><strong>Warm regards,</strong><br>
          <strong>Hellenic Cosmetics</strong></p>
        </div>
      `,
    };

    await sgMail.send(msg);
    console.info("Enquiry email sent successfully.");

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Enquiry submitted successfully! Email sent to client and admin.",
        booking,
      }),
    };
  } catch (error) {
    console.error("Booking error details:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Something went wrong while processing your booking.",
        details: error.message,
      }),
    };
  }
};

// --- Helper: DST-aware Melbourne offset ---
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


const { createClient } = require("@libsql/client");
// const sgMail = require("@sendgrid/mail");

// sgMail.setApiKey(process.env.SENDGRID_API_KEY);

exports.handler = async (event) => {
  console.log("Incoming booking request:", event.body);

  let normalizedEmail = null;

  try {
    const data = JSON.parse(event.body);
    const { name, email, phone, date, time, service } = data;

    const nameTrimmed = name?.trim();
    const emailTrimmed = email?.trim();
    const phoneTrimmed = phone?.trim();

    if (
      !nameTrimmed ||
      !emailTrimmed ||
      !phoneTrimmed ||
      !date ||
      !time ||
      !service
    ) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing required fields." }),
      };
    }

    const phoneDigits = phoneTrimmed.replace(/\D/g, "");
    if (phoneDigits.length < 8) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Phone number must contain at least 8 digits.",
        }),
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

    const dayOfWeek = melbourneLocal.getDay();
    const isSunday = dayOfWeek === 0;
    const isSaturday = dayOfWeek === 6;
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

    if (isSaturday) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Bookings are not available on Saturdays. Please choose another day.",
        }),
      };
    }

    const withinWeekdayHours =
      (hour > 17 || (hour === 17 && minute >= 30)) &&
      (hour < 21 || (hour === 21 && minute === 0));
    const withinSundayHours =
      (hour > 10 || (hour === 10 && minute >= 0)) &&
      (hour < 16 || (hour === 16 && minute === 0));

    if (!isSunday && !isWeekday) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error:
            "Bookings are available Monday-Friday from 5:30 PM to 9:00 PM, and Sundays from 10:00 AM to 4:00 PM.",
        }),
      };
    }

    const isWithinAllowedHours = isSunday ? withinSundayHours : withinWeekdayHours;

    if (!isWithinAllowedHours) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error:
            "Bookings are available Monday-Friday from 5:30 PM to 9:00 PM, and Sundays from 10:00 AM to 4:00 PM.",
        }),
      };
    }

    // Connect to Turso
    const client = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });

    normalizedEmail = emailTrimmed.toLowerCase();

    // Try to acquire lock
    const lockResult = await client.execute({
      sql: "INSERT OR IGNORE INTO booking_locks (email) VALUES (?)",
      args: [normalizedEmail],
    });

    if (lockResult.rowsAffected === 0) {
      return {
        statusCode: 409,
        body: JSON.stringify({
          error:
            "You already have a pending enquiry awaiting confirmation. Please wait for our response before booking again.",
        }),
      };
    }

    // Insert booking
    const createdAt = new Date().toISOString();
    try {
      await client.execute({
        sql: `INSERT INTO bookings (name, email, phone, service, appointment_datetime_local, appointment_datetime_utc, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [nameTrimmed, emailTrimmed, phoneTrimmed, service, melbourneForDB, utcForDB, createdAt],
      });
    } catch (insertErr) {
      // Duplicate booking — clean up lock
      if (insertErr.message && insertErr.message.includes("UNIQUE")) {
        await client.execute({ sql: "DELETE FROM booking_locks WHERE email = ?", args: [normalizedEmail] });
        return {
          statusCode: 409,
          body: JSON.stringify({
            error:
              "You already have a pending enquiry for this email and time slot. Please wait for a confirmation or choose a different time.",
          }),
        };
      }
      throw insertErr;
    }

    // Fetch the inserted booking
    const result = await client.execute({
      sql: "SELECT * FROM bookings WHERE email = ? AND appointment_datetime_utc = ?",
      args: [emailTrimmed, utcForDB],
    });
    const booking = result.rows[0];

    const adminEmail = process.env.ADMIN_EMAIL;
    const formattedDate = new Date(date).toLocaleDateString("en-AU", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const msg = {
      to: emailTrimmed,
      cc: adminEmail,
      from: { email: "bookings@helleniccosmetics.com", name: "Hellenic Cosmetics" },
      subject: `Your Appointment Enquiry - ${service}`,
      html: `
        <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
          <p>Dear ${nameTrimmed},</p>

          <p>Thank you for your appointment enquiry with <strong>Hellenic Cosmetics</strong>.</p>

          <p><strong>Requested Date:</strong> ${formattedDate}<br>
          <strong>Requested Time:</strong> ${time}<br>
          <strong>Service:</strong> ${service}<br>
          <strong>Phone:</strong> ${phoneTrimmed}</p>

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

          <p>We look forward to welcoming you at our Melbourne studio.<br>
          Please do not hesitate to reply to this email if you have any questions.</p>

          <p><strong>Warm regards,</strong><br>
          <strong>Hellenic Cosmetics</strong></p>
        </div>
      `,
    };

//    await sgMail.send(msg);
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
    // Attempt cleanup
    if (normalizedEmail) {
      try {
        const client = createClient({
          url: process.env.TURSO_DATABASE_URL,
          authToken: process.env.TURSO_AUTH_TOKEN,
        });
        await client.execute({ sql: "DELETE FROM booking_locks WHERE email = ?", args: [normalizedEmail] });
      } catch (cleanupError) {
        console.error("Booking cleanup error:", cleanupError);
      }
    }
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

const { createClient } = require("@libsql/client");

exports.handler = async (event) => {
  try {
    const { id, action, newDate, newTime } = JSON.parse(event.body);

    const client = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });

    // Fetch existing booking
    const result = await client.execute({ sql: "SELECT * FROM bookings WHERE id = ?", args: [id] });
    if (result.rows.length === 0) {
      return { statusCode: 404, body: JSON.stringify({ error: "Booking not found" }) };
    }

    let booking = result.rows[0];

    // If "change", update date/time
    if (action === "change") {
      if (!newDate || !newTime) {
        return { statusCode: 400, body: JSON.stringify({ error: "Missing new date/time" }) };
      }

      await client.execute({
        sql: "UPDATE bookings SET appointment_datetime_local = ? WHERE id = ?",
        args: [`${newDate} ${newTime}:00`, id],
      });
    }

    // Release the booking lock
    await client.execute({
      sql: "DELETE FROM booking_locks WHERE email = ?",
      args: [String(booking.email).trim().toLowerCase()],
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        message:
          action === "change"
            ? "Booking updated successfully."
            : "Booking confirmed successfully.",
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

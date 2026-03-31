const { createClient } = require("@libsql/client");
const jwt = require("jsonwebtoken");

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    // 1. Verify token
    const authHeader = event.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "").trim();

    if (!token) {
      return { statusCode: 401, body: JSON.stringify({ error: "Missing token" }) };
    }

    const decoded = jwt.decode(token);
    if (!decoded || !decoded.email) {
      return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
    }

    // 2. Parse request body
    const { id } = JSON.parse(event.body);
    if (!id) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing booking ID" }) };
    }

    // 3. Connect to Turso
    const client = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });

    // 4. Get the email before deleting
    const selectResult = await client.execute({
      sql: "SELECT email FROM bookings WHERE id = ?",
      args: [id],
    });

    // 5. Delete the booking
    await client.execute({ sql: "DELETE FROM bookings WHERE id = ?", args: [id] });

    // 6. Release booking lock
    if (selectResult.rows.length > 0) {
      const deletedEmail = String(selectResult.rows[0].email || "").trim().toLowerCase();
      if (deletedEmail) {
        await client.execute({
          sql: "DELETE FROM booking_locks WHERE email = ?",
          args: [deletedEmail],
        });
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: "Booking deleted successfully" }),
    };
  } catch (error) {
    console.error("Delete booking error:", error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};

const { createClient } = require("@libsql/client");
const jwt = require("jsonwebtoken");

exports.handler = async (event) => {
  try {
    // --- Authorization ---
    const authHeader = event.headers.authorization;
    if (!authHeader) return { statusCode: 401, body: "Unauthorized" };

    const token = authHeader.split(" ")[1];
    const decoded = jwt.decode(token);
    if (!decoded) return { statusCode: 401, body: "Invalid token" };

    // --- Connect to Turso ---
    const client = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });

    // --- Query bookings ---
    const result = await client.execute(
      "SELECT id, name, email, phone, service, appointment_datetime_local, appointment_datetime_utc, created_at FROM bookings ORDER BY appointment_datetime_local ASC"
    );

    // --- Format date/time for display ---
    const formatted = result.rows.map((b) => {
      let date = "Invalid Date";
      let time = "Invalid Time";

      const localDateTime = String(b.appointment_datetime_local || "");
      if (localDateTime.includes(" ")) {
        const [datePart, timePart] = localDateTime.split(" ");
        const parsed = new Date(datePart);
        if (!isNaN(parsed.getTime())) {
          date = parsed.toLocaleDateString("en-AU", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          });
        }
        time = timePart ? timePart.substring(0, 5) : "Invalid Time";
      }

      const createdAt = new Date(String(b.created_at || ""));
      const createdDate = !isNaN(createdAt.getTime())
        ? createdAt.toLocaleDateString("en-AU", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          })
        : "Invalid Date";

      return {
        id: b.id,
        name: b.name,
        email: b.email,
        service: b.service,
        phone: b.phone,
        date,
        time,
        created_at: createdDate,
      };
    });

    return {
      statusCode: 200,
      body: JSON.stringify(formatted),
    };
  } catch (error) {
    console.error("Error fetching bookings:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

document.getElementById("bookingForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const form = e.target;
  const submitBtn = form.querySelector("button[type='submit']");
  const messageEl = document.getElementById("bookingMessage");

  // Reset message state
  messageEl.textContent = "";
  messageEl.classList.add("hidden");

  if (submitBtn.disabled) return;
  submitBtn.disabled = true;
  submitBtn.textContent = "Sending...";

  const bookingData = {
    name: form.name.value.trim(),
    email: form.email.value.trim(),
    phone: form.phone.value.trim(),
    date: form.date.value,
    time: form.time.value,
    service: form.service.value,
  };

  const operatingHoursMessage =
    "Bookings are available Monday-Friday from 5:30 PM to 9:00 PM, and Sundays from 10:00 AM to 4:00 PM.";
  const saturdayClosedMessage =
    "We are closed on Saturdays. Please choose another day.";

  // --- Time validation (Mon-Fri 5:30pm-9pm, Sun 10am-4pm) ---
  const [hour, minute] = form.time.value.split(":").map(Number);
  const [year, month, day] = form.date.value.split("-").map(Number);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = Sunday
  const isSunday = dayOfWeek === 0;
  const isSaturday = dayOfWeek === 6;

  const digitsOnlyPhone = bookingData.phone.replace(/\D/g, "");
  if (digitsOnlyPhone.length < 8) {
    messageEl.textContent = "Please enter a valid phone number with at least 8 digits.";
    messageEl.classList.remove("hidden", "text-green-600");
    messageEl.classList.add("text-red-600");
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit";
    return;
  }

  if (isSaturday) {
    messageEl.textContent = saturdayClosedMessage;
    messageEl.classList.remove("hidden", "text-green-600");
    messageEl.classList.add("text-red-600");
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit";
    return;
  }
  const withinWeekdayHours =
    (hour > 17 || (hour === 17 && minute >= 30)) &&
    (hour < 21 || (hour === 21 && minute === 0));
  const withinSundayHours =
    (hour > 10 || (hour === 10 && minute >= 0)) &&
    (hour < 16 || (hour === 16 && minute === 0));

  const isWithinAllowedHours = isSunday ? withinSundayHours : withinWeekdayHours;

  if (!isWithinAllowedHours) {
    messageEl.textContent = isSunday
      ? "Sunday bookings are available between 10:00 AM and 4:00 PM."
      : operatingHoursMessage;
    messageEl.classList.remove("hidden", "text-green-600");
    messageEl.classList.add("text-red-600");
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit";
    return;
  }

  try {
    const response = await fetch("/.netlify/functions/booking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bookingData),
    });

    const result = await response.json();

    if (!response.ok) {
      // Handle specific validation errors from backend
      let message = result.error || "An error occurred. Please try again.";

      if (message.includes("48 hours")) {
        message = "Bookings must be made at least 48 hours in advance.";
      } else if (message.toLowerCase().includes("saturday")) {
        message = saturdayClosedMessage;
      } else if (message.toLowerCase().includes("phone")) {
        message = "Please enter a valid phone number with at least 8 digits.";
      } else if (
        message.includes("5:30 PM") ||
        message.includes("9:00 PM") ||
        message.includes("10:00 AM")
      ) {
        message = message.includes("10:00 AM")
          ? "Sunday bookings are available between 10:00 AM and 4:00 PM."
          : operatingHoursMessage;
      }

      messageEl.textContent = message;
      messageEl.classList.remove("hidden", "text-green-600");
      messageEl.classList.add("text-red-600");
      return;
    }

    // Success
    messageEl.textContent = "Thank you! Your appointment enquiry has been submitted successfully.";
    messageEl.classList.remove("hidden", "text-red-600");
    messageEl.classList.add("text-green-600");

    // Reset form and refresh page after short delay
    form.reset();
    setTimeout(() => location.reload(), 1500);
  } catch (err) {
    console.error(err);
    messageEl.textContent = "Something went wrong. Please try again.";
    messageEl.classList.remove("hidden", "text-green-600");
    messageEl.classList.add("text-red-600");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit";
  }
});
